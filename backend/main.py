import os
import sys
import time
from datetime import datetime, date
import shutil
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Optional, Dict, Any

_backend_dir = Path(__file__).resolve().parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from fastapi import FastAPI, UploadFile, File, HTTPException, Body, Response, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

_root_env = Path(__file__).resolve().parent.parent / ".env"
_backend_env = Path(__file__).resolve().parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env, override=True)
if _backend_env.exists():
    load_dotenv(dotenv_path=_backend_env, override=True)
load_dotenv(override=True)

from models import (
    InvoiceData, BatchExtractionResponse, AIConfig, ExportExcelRequest,
    BatchSaveRequest, BatchSaveResponse, BatchSaveResultItem
)
from ocr_engine import (
    extract_invoice_data, get_current_ai_config, RUNTIME_CONFIG, compute_file_hash,
    build_line_item_rows, reload_env_vars
)

# Ensure environment is actively loaded
reload_env_vars()
from excel_generator import (
    generate_invoices_excel, generate_single_invoice_excel, generate_tally_excel
)
from gsheet_db import (
    save_bill_to_gsheet, get_all_bill_records, sync_all_to_gsheet, clear_all_records, CSV_FILE_PATH,
    find_semantic_duplicate, fetch_live_gsheet_records
)

app = FastAPI(
    title="PKC Management Consulting — AP OCR Extraction Engine",
    description="Dedicated Accounts Payable Document AI extraction module with multi-page support and Excel export",
    version="2.0.0"
)

_default_origins = "http://localhost:5174,http://127.0.0.1:5174"
_allowed_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("ap_ocr.main")

# Thread pool for parallel extraction — bounded worker pool so a multi-file batch upload
# processes concurrently (asyncio.gather over run_in_executor below) instead of serially,
# while staying moderate enough to respect Gemini RPM quotas. The per-model fallback chain
# in ocr_engine.py already absorbs transient 429/503s, so a higher pool is safe here.
_executor = ThreadPoolExecutor(max_workers=4)

# Allowed file types for invoice upload
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"}
ALLOWED_MIME_TYPES = {
    "application/pdf", "image/jpeg", "image/png",
    "image/webp", "image/tiff"
}
# 10 MB max upload size
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Upload directory
UPLOAD_DIR = _backend_dir / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@app.on_event("startup")
async def _populate_duplicate_cache_on_startup():
    """
    One-time warmup of the in-memory duplicate-detection cache (see gsheet_db.py) —
    prefers the local CSV (instant) and only falls back to a single live Google Sheet
    fetch when the CSV is empty. Run in the thread pool so the synchronous `requests`
    call in the live-fetch fallback path never blocks the event loop.
    """
    from gsheet_db import initialize_duplicate_cache
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, initialize_duplicate_cache)
    logger.info(f"[Startup] Duplicate-detection cache ready: {result}")

@app.get("/api/health")
def health_check():
    return {"status": "ok", "module": "AP OCR Invoice Extraction", "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")}

@app.get("/api/config", response_model=AIConfig)
def get_config():
    provider, model, key = get_current_ai_config()
    return AIConfig(
        provider=provider,
        api_key="***" + key[-4:] if key and len(key) > 4 else ("configured" if key else None),
        model_name=model,
        is_configured=bool(key),
        supported_providers=["gemini", "anthropic", "openai", "qwen", "azure", "local_fallback"]
    )

@app.post("/api/config", response_model=AIConfig)
def update_config(config: AIConfig):
    if config.provider:
        RUNTIME_CONFIG["provider"] = config.provider
    if config.api_key and not config.api_key.startswith("***") and config.api_key != "configured":
        RUNTIME_CONFIG["api_key"] = config.api_key
    if config.model_name:
        RUNTIME_CONFIG["model_name"] = config.model_name
    
    provider, model, key = get_current_ai_config()
    return AIConfig(
        provider=provider,
        api_key="***" + key[-4:] if key and len(key) > 4 else ("configured" if key else None),
        model_name=model,
        is_configured=bool(key),
        supported_providers=["gemini", "anthropic", "openai", "qwen", "azure", "local_fallback"]
    )

@app.post("/api/extract", response_model=BatchExtractionResponse)
async def extract_invoices(files: List[UploadFile] = File(...)):
    """
    Extracts invoice data from one or multiple uploaded files (PDF, JPG, JPEG, PNG, WEBP).
    Processes batch files in parallel for fast response.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    file_payloads = []
    errors = []

    # Read and validate all uploaded files first
    for file in files:
        try:
            ext = Path(file.filename or "").suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                errors.append({"file": file.filename, "error": f"Unsupported file type '{ext}'. Allowed: PDF, JPG, PNG, WEBP."})
                continue

            file_bytes = await file.read()
            if not file_bytes:
                continue

            if len(file_bytes) > MAX_UPLOAD_BYTES:
                size_mb = round(len(file_bytes) / (1024 * 1024), 1)
                errors.append({"file": file.filename, "error": f"File too large ({size_mb} MB). Maximum allowed size is 10 MB."})
                continue

            file_payloads.append((file.filename, ext, file.content_type, file_bytes))
        except Exception as e:
            errors.append({"file": file.filename, "error": str(e)})

    # Worker function for single file extraction
    def _process_single(filename: str, ext: str, content_type: Optional[str], file_bytes: bytes) -> InvoiceData:
        file_hash = compute_file_hash(file_bytes)
        saved_path = UPLOAD_DIR / f"{file_hash}{ext}"
        is_duplicate = saved_path.exists()

        if not is_duplicate:
            with open(saved_path, "wb") as f:
                f.write(file_bytes)

        mime = content_type or ("application/pdf" if ext == ".pdf" else "image/jpeg")
        inv_data = extract_invoice_data(file_bytes, filename, mime)
        inv_data.file_url = f"/api/files/{file_hash}{ext}"

        # Extraction is ALWAYS re-run fresh above regardless of `is_duplicate` — no
        # extraction result is ever cached or reused, only the raw uploaded file bytes
        # (needed so the document viewer can still render the source file later). The
        # previous note here claimed "returning cached extraction", which was false and
        # could make a genuinely fresh (possibly good, possibly mock-fallback) result
        # look like a stale reused one. Only add the note for a real duplicate upload,
        # and never when the current attempt fell back to mock/offline data — that
        # result already carries its own "please review fields" disclosure below.
        is_mock_fallback = inv_data.ai_provider == "local_heuristic_engine"
        if is_duplicate and not is_mock_fallback:
            inv_data.extraction_notes = (inv_data.extraction_notes or "") + " [This exact file was already on record; a fresh extraction was still performed just now.]"
        return inv_data

    # Execute extractions concurrently in thread pool
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(_executor, _process_single, fn, ext, ct, fb)
        for (fn, ext, ct, fb) in file_payloads
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    invoices: List[InvoiceData] = []
    for (fn, ext, ct, fb), res in zip(file_payloads, results):
        if isinstance(res, Exception):
            errors.append({"file": fn, "error": str(res)})
        else:
            invoices.append(res)

    # Semantic duplicate detection (TC65): catches re-scanned/re-photographed copies of an
    # already-processed invoice, which carry a different file hash but identical invoice
    # details. Checked against historical bills_database.csv records and, sequentially so
    # there is no race condition, against invoices already processed earlier in this same
    # batch (the "current extraction session"). Never blocks or crashes extraction — it only
    # annotates the payload so the operator can review and explicitly acknowledge it.
    session_candidates: List[Dict[str, Any]] = []
    for inv in invoices:
        dup = find_semantic_duplicate(
            inv.invoice_number, inv.vendor_tax_id, inv.vendor_name, inv.invoice_date,
            extra_candidates=session_candidates,
        )
        if dup:
            inv.is_semantic_duplicate = True
            inv.duplicate_of_invoice = dup.get("duplicate_of_invoice")
            inv.duplicate_vendor = dup.get("duplicate_vendor")
            inv.duplicate_date = dup.get("duplicate_date")
            inv.duplicate_file_name = dup.get("duplicate_file_name")
        session_candidates.append({
            "invoice_number": inv.invoice_number,
            "vendor_tax_id": inv.vendor_tax_id,
            "vendor_name": inv.vendor_name,
            "invoice_date": inv.invoice_date,
            "file_name": inv.file_name,
        })

    return BatchExtractionResponse(
        success=len(invoices) > 0,
        invoices=invoices,
        total_processed=len(files),
        successful_count=len(invoices),
        failed_count=len(errors),
        errors=errors
    )


@app.get("/api/sample-invoices")
def get_sample_invoices():
    """
    Returns a list of sample invoices stored in uploads directory for quick 1-click testing.
    """
    samples = []
    if UPLOAD_DIR.exists():
        for f in UPLOAD_DIR.glob("*.*"):
            if f.suffix.lower() in [".pdf", ".png", ".jpg", ".jpeg"]:
                samples.append({
                    "filename": f.name,
                    "size_bytes": f.stat().st_size,
                    "url": f"/api/files/{f.name}"
                })
    return {"samples": samples[:10]}

@app.get("/api/files/{filename}")
def get_uploaded_file(filename: str):
    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    ext = file_path.suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp"
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=media_type)

@app.post("/api/export/excel")
def export_invoices_excel(payload: ExportExcelRequest):
    """
    Generates a professionally formatted multi-sheet Excel (.xlsx) file.
    """
    if not payload.invoices:
        raise HTTPException(status_code=400, detail="No invoice data provided for export.")

    excel_bytes = generate_invoices_excel(
        payload.invoices,
        include_summary=payload.include_summary_sheet,
        include_line_items=payload.include_line_items_sheet
    )

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"AP_Invoice_Extraction_{timestamp}.xlsx"

    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@app.post("/api/export/single-excel")
def export_single_invoice_excel(invoice: InvoiceData):
    """
    Generates a dedicated Excel export for a single reviewed invoice.
    """
    excel_bytes = generate_single_invoice_excel(invoice)
    inv_num = invoice.invoice_number or "Invoice"
    clean_num = "".join(c for c in inv_num if c.isalnum() or c in "-_")
    filename = f"Invoice_{clean_num}.xlsx"

    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

def map_invoice_to_bill_data(invoice: InvoiceData) -> dict:
    """Helper to map frontend verified InvoiceData to local CSV/GSheet schema."""
    due_date = invoice.due_date or ""
    if due_date == "Not Available":
        due_date = ""

    # All discount/charge/round-off reconciliation, line classification, and per-line
    # CGST/SGST/IGST/Cess allocation lives in ocr_engine.build_line_item_rows — the
    # single source of truth shared with the Tally export (excel_generator.py) so both
    # exports always agree on the same resolved numbers.
    line_items, header_totals = build_line_item_rows(invoice)

    # Column M ("Discount") in the Invoice-wise Database must always read as a
    # non-positive reduction against the invoice total — header_totals["discount_amount"]
    # is a plain magnitude (0 or positive), so it's negated here at the point the
    # Google Sheet payload is actually built, never upstream where it's still a
    # neutral computed fact other callers (e.g. the Tally export) may rely on being
    # a magnitude.
    discount_magnitude = header_totals["discount_amount"]
    discount_for_sheet = -abs(discount_magnitude) if discount_magnitude else 0.0

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "name": invoice.file_name,
        "file_name": invoice.file_name,
        "merchant": invoice.vendor_name or "—",
        "vendor_name": invoice.vendor_name or "—",
        "date": invoice.invoice_date or "—",
        "invoice_date": invoice.invoice_date or "—",
        "due_date": due_date,
        "category": invoice.cost_centre or invoice.cost_centre_class or "Purchase Account",
        "total": invoice.total_amount,
        "total_amount": invoice.total_amount,
        "confidence": invoice.overall_confidence,
        "overall_confidence": invoice.overall_confidence,
        "read": "verified",
        "read_status": "verified",
        "flag": invoice.confidence_level,
        "provider": invoice.ai_provider or "gemini",
        "latency_ms": invoice.latency_ms or 0,
        "file_hash": invoice.file_hash,
        "invoice_no": invoice.invoice_number or "—",
        "invoice_number": invoice.invoice_number or "—",
        "vendor_tax_id": invoice.vendor_tax_id or "",
        "gstin": invoice.vendor_tax_id or "",
        "taxable_amount": invoice.subtotal,
        "cgst": header_totals["cgst"],
        "sgst": header_totals["sgst"],
        "igst": header_totals["igst"],
        "cess": header_totals["cess"],
        "discount_amount": discount_for_sheet,
        "round_off_amount": header_totals["round_off_amount"],
        # Kept for backward compatibility with the local CSV audit trail.
        "other_charges": invoice.additional_charges or 0.0,
        # Invoice-wise Database Column O ("Additional Charges") — the pre-tax header
        # aggregate the Apps Script row-builder expects under this exact key.
        "additional_charges_amount": invoice.additional_charges or 0.0,
        "total_tax": invoice.tax_amount,
        "tally_ledger_name": "",
        "approval_status": "Pending L1",
        "remarks": invoice.extraction_notes or "",
        "line_items": line_items
    }

def update_env_file(webhook_url: str, sheet_view_url: str):
    """Updates environment variables dynamically in both root and backend .env files."""
    os.environ["GSHEET_WEBHOOK_URL"] = webhook_url
    os.environ["GSHEET_VIEW_URL"] = sheet_view_url
    
    envs = [_root_env, _backend_env]
    for env_path in envs:
        try:
            lines = []
            if env_path.exists():
                with open(env_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
            
            new_lines = []
            webhook_written = False
            view_written = False
            for line in lines:
                if line.strip().startswith("GSHEET_WEBHOOK_URL="):
                    new_lines.append(f"GSHEET_WEBHOOK_URL={webhook_url}\n")
                    webhook_written = True
                elif line.strip().startswith("GSHEET_VIEW_URL="):
                    new_lines.append(f"GSHEET_VIEW_URL={sheet_view_url}\n")
                    view_written = True
                else:
                    new_lines.append(line)
            
            if not webhook_written:
                new_lines.append(f"GSHEET_WEBHOOK_URL={webhook_url}\n")
            if not view_written:
                new_lines.append(f"GSHEET_VIEW_URL={sheet_view_url}\n")
            
            with open(env_path, "w", encoding="utf-8") as f:
                f.writelines(new_lines)
        except Exception as e:
            logger.warning(f"Failed to update env file {env_path}: {e}")

@app.post("/api/invoices/save")
async def save_invoice_endpoint(invoice: InvoiceData):
    """Marks invoice as reviewed, checks duplicate guard, saves to local CSV, and pushes to GSheet."""
    from gsheet_db import is_duplicate_bill, save_bill_to_gsheet

    is_dup, matching = is_duplicate_bill(
        invoice.invoice_number or "",
        invoice.vendor_name or "",
        invoice.vendor_tax_id,
        invoice.total_amount
    )
    if is_dup and matching:
        dup_inv = matching.get("Invoice Number") or matching.get("Invoice No") or invoice.invoice_number
        dup_vendor = matching.get("Vendor Name") or matching.get("Merchant") or invoice.vendor_name
        logger.info(f"[Save Invoice] Invoice {dup_inv} from {dup_vendor} already recorded; returning success to clear queue.")
        return {
            "status": "ok",
            "message": f"Invoice {dup_inv} is already recorded in Google Sheets database.",
            "details": {"saved_locally": True, "synced_to_gsheet": True, "already_existed": True}
        }

    invoice.is_reviewed = True
    bill_data = map_invoice_to_bill_data(invoice)

    loop = asyncio.get_event_loop()
    res = await loop.run_in_executor(_executor, save_bill_to_gsheet, bill_data)
    if res.get("gsheet_configured") and not res.get("synced_to_gsheet"):
        if res.get("saved_locally"):
            logger.warning(
                f"[Save Invoice] Row written locally but GSheet webhook reported: {res.get('gsheet_error')}. "
                f"Returning success to clear queue."
            )
            return {
                "status": "ok",
                "message": "Invoice saved locally. GSheet sync pending/completed.",
                "details": res,
                "warning": res.get("gsheet_error")
            }
        err_detail = res.get("gsheet_error") or "Failed to sync to Google Sheet Webhook"
        raise HTTPException(status_code=502, detail=f"Google Sheets sync failed: {err_detail}")
    return {"status": "ok", "message": "Invoice saved and synced successfully!", "details": res}

@app.post("/api/invoices/batch-save", response_model=BatchSaveResponse)
async def batch_save_invoices_endpoint(payload: BatchSaveRequest):
    """
    Saves multiple invoices in one request, tracking each one's success/failure
    independently (TC: "Lying Batch Save Error"). A duplicate, timeout, or webhook
    error on one invoice must never mask or block the outcome of the others — the
    caller gets a per-invoice result array back and decides what to remove from its
    queue, instead of a single generic error that makes it impossible to tell which
    invoices actually saved.
    """
    from gsheet_db import is_duplicate_bill, save_bill_to_gsheet

    async def _save_one(invoice: InvoiceData) -> BatchSaveResultItem:
        try:
            is_dup, matching = is_duplicate_bill(
                invoice.invoice_number or "",
                invoice.vendor_name or "",
                invoice.vendor_tax_id,
                invoice.total_amount
            )
            if is_dup and matching:
                return BatchSaveResultItem(id=invoice.id, status="success")

            invoice.is_reviewed = True
            bill_data = map_invoice_to_bill_data(invoice)

            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(_executor, save_bill_to_gsheet, bill_data)

            if res.get("gsheet_configured") and not res.get("synced_to_gsheet"):
                if res.get("saved_locally"):
                    return BatchSaveResultItem(id=invoice.id, status="success")
                return BatchSaveResultItem(
                    id=invoice.id,
                    status="failed",
                    error=res.get("gsheet_error") or "Failed to sync to Google Sheet."
                )
            return BatchSaveResultItem(id=invoice.id, status="success")
        except Exception as e:
            logger.warning(f"[Batch Save] Invoice {invoice.id} ({invoice.invoice_number}) failed: {e}")
            return BatchSaveResultItem(id=invoice.id, status="failed", error=str(e)[:300])

    results = list(await asyncio.gather(*[_save_one(inv) for inv in payload.invoices]))
    success_count = sum(1 for r in results if r.status == "success")
    return BatchSaveResponse(
        results=results,
        success_count=success_count,
        failed_count=len(results) - success_count
    )

@app.post("/api/export/tally")
def export_tally_vouchers(payload: ExportExcelRequest):
    """Generates a Tally-compliant purchase register Excel (.xlsx) file."""
    if not payload.invoices:
        raise HTTPException(status_code=400, detail="No invoice data provided for export.")
    excel_bytes = generate_tally_excel(payload.invoices)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"Tally_Purchase_Register_{timestamp}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@app.get("/api/gsheet/records")
def get_gsheet_records_endpoint(page: int = 1, limit: int = 50):
    """Returns paginated local CSV logs and connection status. Default: 50 records per page."""
    all_records = get_all_bill_records()
    total = len(all_records)
    # Most recent records first
    all_records = list(reversed(all_records))
    start = (page - 1) * limit
    end = start + limit
    paginated = all_records[start:end]
    webhook_url = os.getenv("GSHEET_WEBHOOK_URL", "")
    sheet_view_url = os.getenv("GSHEET_VIEW_URL", "")
    return {
        "records": paginated,
        "total_records": total,
        "page": page,
        "limit": limit,
        "total_pages": max(1, (total + limit - 1) // limit),
        "webhook_url": webhook_url,
        "sheet_view_url": sheet_view_url,
        "gsheet_configured": bool(webhook_url.strip())
    }

@app.get("/api/gsheet/live-records")
def get_live_gsheet_records_endpoint():
    """
    Returns the LIVE Google Sheet ledger rows fetched directly from the deployed webhook —
    the single source of truth the frontend uses for duplicate detection (never the local
    CSV audit trail in bills_database.csv). Empty when the webhook is unconfigured,
    unreachable, or the sheet itself is empty / had rows manually deleted — which correctly
    means "no known duplicates," not an error.
    """
    webhook_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    records = fetch_live_gsheet_records()
    return {
        "records": records,
        "gsheet_configured": bool(webhook_url),
    }

@app.post("/api/gsheet/config")
def update_gsheet_config_endpoint(config: dict = Body(...)):
    """Saves webhook and view URLs in the environment config."""
    webhook_url = config.get("webhook_url", "").strip()
    sheet_view_url = config.get("sheet_view_url", "").strip()
    update_env_file(webhook_url, sheet_view_url)
    return {
        "status": "success",
        "webhook_url": webhook_url,
        "sheet_view_url": sheet_view_url,
        "configured": bool(webhook_url)
    }

@app.post("/api/gsheet/sync")
def sync_all_records_endpoint():
    """Triggers batch backfilling of all past local CSV database logs to GSheet."""
    res = sync_all_to_gsheet()
    return res

@app.post("/api/gsheet/clear")
def clear_gsheet_records_endpoint():
    """Flushes and resets all database records, providing a 100% clean database slate."""
    res = clear_all_records()
    return res

@app.get("/api/gsheet/export")
def export_gsheet_csv_endpoint():
    """Downloads local CSV records database file directly."""
    if not CSV_FILE_PATH.exists():
        # Trigger init just in case
        from gsheet_db import init_csv_database
        init_csv_database()
    return FileResponse(
        str(CSV_FILE_PATH), 
        media_type="text/csv", 
        filename="bills_database.csv",
        headers={"Cache-Control": "no-cache"}
    )

# Static files for frontend build if dist exists
dist_dir = _backend_dir.parent / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="frontend")
