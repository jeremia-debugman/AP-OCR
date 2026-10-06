import os
import re
import csv
import json
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import requests
from dotenv import load_dotenv

logger = logging.getLogger("reimbursements.gsheet")

_root_env = Path(__file__).resolve().parent.parent / ".env"
_backend_env = Path(__file__).resolve().parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env, override=True)
if _backend_env.exists():
    load_dotenv(dotenv_path=_backend_env, override=True)

# Local spreadsheet database files
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CSV_FILE_PATH = DATA_DIR / "bills_database.csv"
CLAIMS_CSV_PATH = DATA_DIR / "claims_database.csv"
APPROVAL_LOG_CSV_PATH = DATA_DIR / "approval_log.csv"
LOCAL_POLICIES_JSON = DATA_DIR / "policies_store.json"

CSV_HEADERS = [
    "Timestamp", "File Name", "Merchant", "Date", "Category", "Total Amount", 
    "Confidence", "Read Status", "Flag", "Provider", "Latency (ms)", "File Hash", 
    "Invoice No", "Taxable Amount", "CGST", "SGST", "IGST", "Cess", 
    "Other Charges", "Total Tax", "Tally Ledger Name", "Remarks"
]

CLAIMS_HEADERS = [
    "Claim ID", "Employee", "Employee Email/ID", "Bill/File Link", "Vendor Name", 
    "Vendor GSTIN", "Invoice Number", "Invoice Date", "Expense Type", "Taxable Amount", 
    "CGST", "SGST", "IGST", "Total Amount", "Policy Status", "Policy Limit", 
    "Excess Amount", "Approval Status", "Approver", "Approval Date", "Approver Remarks", 
    "Final Claim Status", "Created Date", "Updated Date", "Original OCR Values"
]

APPROVAL_LOG_HEADERS = [
    "Claim ID", "Action", "Action By", "Action Date/Time", "Remarks"
]

def init_csv_database():
    """Ensures the local CSV database files exist with proper headers."""
    # 1. Bills database
    needs_init_bills = True
    if CSV_FILE_PATH.exists():
        try:
            with open(CSV_FILE_PATH, mode="r", encoding="utf-8") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                if header == CSV_HEADERS:
                    needs_init_bills = False
        except Exception:
            pass
    if needs_init_bills:
        with open(CSV_FILE_PATH, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)
        logger.info(f"Initialized local bills CSV database at {CSV_FILE_PATH}")

    # 2. Claims database
    needs_init_claims = True
    if CLAIMS_CSV_PATH.exists():
        try:
            with open(CLAIMS_CSV_PATH, mode="r", encoding="utf-8") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                if header == CLAIMS_HEADERS:
                    needs_init_claims = False
        except Exception:
            pass
    if needs_init_claims:
        with open(CLAIMS_CSV_PATH, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(CLAIMS_HEADERS)
        logger.info(f"Initialized local claims CSV database at {CLAIMS_CSV_PATH}")

    # 3. Approval Log database
    needs_init_log = True
    if APPROVAL_LOG_CSV_PATH.exists():
        try:
            with open(APPROVAL_LOG_CSV_PATH, mode="r", encoding="utf-8") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                if header == APPROVAL_LOG_HEADERS:
                    needs_init_log = False
        except Exception:
            pass
    if needs_init_log:
        with open(APPROVAL_LOG_CSV_PATH, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(APPROVAL_LOG_HEADERS)
        logger.info(f"Initialized local approval log CSV database at {APPROVAL_LOG_CSV_PATH}")

init_csv_database()

def normalize_code(s: Any) -> str:
    if not s:
        return ""
    clean = re.sub(r'[^a-zA-Z0-9]', '', str(s)).lower()
    return clean.lstrip('0')

def fetch_live_gsheet_records(timeout: float = 8.0) -> List[Dict[str, Any]]:
    """
    Fetches the live Invoice Database rows directly from the deployed Google Sheet
    webhook (Apps Script doGet). This is the single source of truth for duplicate
    detection — local bills_database.csv history is never consulted for this purpose,
    so a row deleted in the Sheet stops counting as a duplicate immediately, and stale
    local test data can never resurrect a false positive.

    Returns [] (never raises) whenever there's nothing to compare against: no webhook
    configured, the webhook unreachable, or the sheet genuinely empty / had rows
    manually deleted. An empty result correctly means "no known duplicates" — it must
    NOT trigger a fallback to outdated local history.
    """
    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    if not gsheet_url:
        return []
    try:
        res = requests.get(gsheet_url, timeout=timeout)
        if res.ok:
            data = res.json()
            if isinstance(data, list):
                return data
            logger.warning(f"Live GSheet fetch returned unexpected shape ({type(data).__name__}); treating as empty (clean state).")
            return []
        logger.warning(f"Live GSheet fetch returned HTTP {res.status_code}; treating as empty (clean state).")
        return []
    except Exception as e:
        logger.warning(f"Live GSheet fetch failed ({e}); treating as empty (clean state).")
        return []

# =======================================================================
# IN-MEMORY DUPLICATE-DETECTION CACHE ("Ticking Time Bomb" fix)
# =======================================================================
# is_duplicate_bill/find_semantic_duplicate used to call fetch_live_gsheet_records()
# on every single invoice — a full, unpaginated live HTTP fetch of the whole Invoice
# Database sheet, capped at an 8s timeout. As the sheet grows, that fetch eventually
# exceeds 8s, and the timeout is swallowed and treated as "sheet is empty" — silently
# and permanently disabling duplicate detection exactly when data volume (and
# duplicate risk) is highest, with no error surfaced anywhere. It also meant a batch
# of N invoices paid for N separate live full-sheet fetches.
#
# This cache is populated once at startup (see initialize_duplicate_cache) and kept
# in sync on every successful save (see save_bill_to_gsheet), so duplicate checks
# become O(1) bucket lookups against local memory instead of network calls.
_dup_cache_lock = threading.Lock()
_dup_cache_by_invoice: Dict[str, List[Dict[str, Any]]] = {}
_dup_cache_ready = False

def _add_record_to_cache(rec: Dict[str, Any]) -> None:
    """
    Indexes one record (live-GSheet-shaped or local-CSV-shaped dict, both are
    supported since the two schemas use different column-name casing/spelling) into
    the cache under every normalized-invoice-number spelling any lookup path might
    use, so a single cache serves both is_duplicate_bill (normalize_code, which
    strips leading zeros) and find_semantic_duplicate (normalize_invoice_number,
    which doesn't) without either function needing to change its own comparison
    logic.
    """
    inv_no = rec.get("Invoice Number") or rec.get("Invoice No") or rec.get("invoice_no")
    keys = {normalize_code(inv_no), normalize_invoice_number(inv_no)}
    keys.discard("")
    if not keys:
        return
    with _dup_cache_lock:
        for key in keys:
            _dup_cache_by_invoice.setdefault(key, []).append(rec)

def _seed_csv_from_live_records(live_records: List[Dict[str, Any]]) -> None:
    """
    One-time write of live-GSheet rows into the local CSV so every subsequent
    backend restart populates the cache from disk (instant) instead of hitting the
    network again. Only the columns the local CSV schema actually has are carried
    over — this audit-trail CSV predates GSTIN/Discount/Round Off and stays that way.
    """
    def g(rec: Dict[str, Any], *keys: str) -> str:
        for k in keys:
            val = rec.get(k)
            if val not in (None, ""):
                return str(val)
        return ""

    try:
        rows = []
        for rec in live_records:
            rows.append([
                g(rec, "Timestamp"), g(rec, "File Name"), g(rec, "Vendor Name", "Merchant"),
                g(rec, "Invoice Date", "Date"), g(rec, "Expense Category", "Category"),
                g(rec, "Total Amount"), g(rec, "Confidence"), "synced", g(rec, "Flag") or "None",
                g(rec, "Provider") or "gemini", g(rec, "Latency (ms)") or "0", g(rec, "File Hash"),
                g(rec, "Invoice Number", "Invoice No"), g(rec, "Taxable Amount"), g(rec, "CGST"),
                g(rec, "SGST"), g(rec, "IGST"), g(rec, "Cess"), g(rec, "Other Charges"),
                g(rec, "Total Tax"), g(rec, "Tally Ledger Name"), g(rec, "Remarks"),
            ])
        with open(CSV_FILE_PATH, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)
            writer.writerows(rows)
        logger.info(f"Seeded local bills CSV with {len(rows)} record(s) fetched from the live Google Sheet.")
    except Exception as e:
        logger.warning(f"Failed to seed local CSV from live Sheet records (non-fatal): {e}")

def initialize_duplicate_cache() -> Dict[str, Any]:
    """
    Populates the in-memory duplicate-detection cache once at backend startup.
    Prefers the local bills_database.csv (instant, no network call) whenever it
    already has historical records; only falls back to a one-time live Google Sheet
    fetch when the CSV is empty/missing, and immediately persists that fetch's rows
    into the CSV so every later startup uses the fast local path instead.
    """
    global _dup_cache_ready

    with _dup_cache_lock:
        _dup_cache_by_invoice.clear()
        _dup_cache_ready = False

    csv_records = get_all_bill_records()
    if csv_records:
        for rec in csv_records:
            _add_record_to_cache(rec)
        source, count = "local_csv", len(csv_records)
    else:
        # Generous one-time timeout — this only ever runs once per process start,
        # unlike the old per-request 8s cap that ran on every single invoice.
        live_records = fetch_live_gsheet_records(timeout=20.0)
        for rec in live_records:
            _add_record_to_cache(rec)
        if live_records:
            _seed_csv_from_live_records(live_records)
        source, count = "live_gsheet_seed", len(live_records)

    with _dup_cache_lock:
        _dup_cache_ready = True

    logger.info(
        f"Duplicate-detection cache initialized from {source}: {count} record(s), "
        f"{len(_dup_cache_by_invoice)} unique invoice-number key(s)."
    )
    return {"source": source, "record_count": count, "unique_invoice_numbers": len(_dup_cache_by_invoice)}

def is_duplicate_bill(
    invoice_no: str,
    merchant: str,
    vendor_tax_id: Optional[str] = None,
    total_amount: Optional[float] = None
):
    """
    Checks if a bill is a duplicate using normalized matching against the in-memory
    cache (O(1) bucket lookup by invoice number, instead of a live full-sheet fetch):
    1. Normalized Invoice # matches AND Normalized Vendor Name matches
    2. Normalized Invoice # matches AND Normalized GSTIN matches
    3. Normalized Invoice # matches AND Total Amount matches
    """
    clean_inv = normalize_code(invoice_no)
    if not clean_inv or clean_inv in ["notavailable", "null", "none", "—", "-"]:
        return False, None

    clean_merchant = normalize_code(merchant)
    clean_gstin = normalize_code(vendor_tax_id)
    clean_total = round(float(total_amount), 2) if total_amount is not None else None

    if not _dup_cache_ready:
        initialize_duplicate_cache()

    with _dup_cache_lock:
        candidates = list(_dup_cache_by_invoice.get(clean_inv, []))

    for rec in candidates:
        rec_merchant = normalize_code(rec.get("Vendor Name") or rec.get("Merchant") or rec.get("vendor_name"))
        rec_gstin = normalize_code(rec.get("Vendor GSTIN") or rec.get("vendor_tax_id") or rec.get("gstin"))

        rec_total_raw = rec.get("Total Amount") or rec.get("total_amount")
        try:
            rec_total = round(float(rec_total_raw), 2) if rec_total_raw not in (None, "") else None
        except Exception:
            rec_total = None

        # Condition 1: Vendor Name match (exact or substring)
        if clean_merchant and rec_merchant and (clean_merchant == rec_merchant or clean_merchant in rec_merchant or rec_merchant in clean_merchant):
            return True, rec
        # Condition 2: GSTIN match
        if clean_gstin and rec_gstin and clean_gstin == rec_gstin:
            return True, rec
        # Condition 3: Total Amount match
        if clean_total is not None and rec_total is not None and abs(clean_total - rec_total) < 0.01:
            return True, rec
        # Condition 4: Invoice No matches when vendor info is missing/incomplete
        if not clean_merchant and not clean_gstin:
            return True, rec
        if not rec_merchant and not rec_gstin:
            return True, rec

    return False, None

# =======================================================================
# SEMANTIC DUPLICATE DETECTION (Composite Key: Invoice No + Vendor GSTIN/Name + Invoice Date)
# =======================================================================
# Catches re-scanned / re-photographed copies of an already-processed invoice, which
# have a different file SHA-256 hash (see main.py's file-hash cache check) and therefore
# never trip the file-level duplicate detector, but carry identical invoice details.

def normalize_invoice_number(s: Any) -> str:
    """Lowercase, alphanumeric-only. e.g. 'INV/26-27/001' -> 'inv2627001'."""
    if not s:
        return ""
    return re.sub(r'[^a-zA-Z0-9]', '', str(s)).lower()

def normalize_vendor_tax_id(s: Any) -> str:
    """Uppercase, alphanumeric-only GSTIN/tax ID."""
    if not s:
        return ""
    return re.sub(r'[^a-zA-Z0-9]', '', str(s)).upper()

def normalize_vendor_name(s: Any) -> str:
    """Lowercase, alphanumeric-only vendor name (used as GSTIN fallback)."""
    if not s:
        return ""
    return re.sub(r'[^a-zA-Z0-9]', '', str(s)).lower()

def normalize_invoice_date(s: Any) -> str:
    """Standardizes a date value to ISO YYYY-MM-DD. Returns '' if unparseable."""
    if not s:
        return ""
    text = str(s).strip()
    if not text or text.lower() in ("not available", "null", "none", "—", "-"):
        return ""

    iso_match = re.match(r'^(\d{4}-\d{2}-\d{2})', text)
    if iso_match:
        return iso_match.group(1)

    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""

def _semantic_composite_match(
    norm_inv: str, norm_gstin: str, norm_vendor: str, norm_date: str,
    cand_invoice_no: Any, cand_vendor_tax_id: Any, cand_vendor_name: Any, cand_invoice_date: Any,
) -> bool:
    """True if a candidate record's normalized fields satisfy the composite key match."""
    cand_inv = normalize_invoice_number(cand_invoice_no)
    if not cand_inv or cand_inv != norm_inv:
        return False

    cand_date = normalize_invoice_date(cand_invoice_date)
    if not cand_date or cand_date != norm_date:
        return False

    cand_gstin = normalize_vendor_tax_id(cand_vendor_tax_id)
    cand_vendor = normalize_vendor_name(cand_vendor_name)

    if norm_gstin and cand_gstin and norm_gstin == cand_gstin:
        return True
    if norm_vendor and cand_vendor and norm_vendor == cand_vendor:
        return True
    return False

def find_semantic_duplicate(
    invoice_number: Optional[str],
    vendor_tax_id: Optional[str],
    vendor_name: Optional[str],
    invoice_date: Optional[str],
    extra_candidates: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, str]]:
    """
    Finds a semantic duplicate using the composite key:
    norm(invoice_number) == existing AND (norm(vendor_tax_id) == existing OR norm(vendor_name) == existing)
    AND invoice_date == existing invoice_date.

    Checks the LIVE Google Sheet ledger first (single source of truth — never local CSV
    history), then any `extra_candidates` (e.g. other invoices already processed in the
    current extraction session/batch). Each candidate dict uses keys: invoice_number,
    vendor_tax_id, vendor_name, invoice_date, file_name.

    Returns a dict with duplicate_of_invoice / duplicate_vendor / duplicate_date /
    duplicate_file_name on match, or None. Never raises — an unmatched or malformed
    record is simply skipped so extraction is never blocked or crashed. Checked
    against the in-memory duplicate-detection cache (O(1) bucket lookup by invoice
    number) rather than a live full-sheet fetch per invoice — see
    initialize_duplicate_cache. An empty/uninitialized cache correctly resolves to
    "no duplicate" (clean state) rather than falling back to stale data.
    """
    norm_inv = normalize_invoice_number(invoice_number)
    norm_date = normalize_invoice_date(invoice_date)
    if not norm_inv or not norm_date:
        return None

    norm_gstin = normalize_vendor_tax_id(vendor_tax_id)
    norm_vendor = normalize_vendor_name(vendor_name)
    if not norm_gstin and not norm_vendor:
        return None

    if not _dup_cache_ready:
        initialize_duplicate_cache()

    try:
        with _dup_cache_lock:
            candidates = list(_dup_cache_by_invoice.get(norm_inv, []))

        for rec in candidates:
            if _semantic_composite_match(
                norm_inv, norm_gstin, norm_vendor, norm_date,
                rec.get("Invoice Number") or rec.get("Invoice No"),
                rec.get("Vendor GSTIN"),
                rec.get("Vendor Name") or rec.get("Merchant"),
                rec.get("Invoice Date") or rec.get("Date"),
            ):
                return {
                    "duplicate_of_invoice": rec.get("Invoice Number") or rec.get("Invoice No", "") or "",
                    "duplicate_vendor": rec.get("Vendor GSTIN") or rec.get("Vendor Name") or rec.get("Merchant", "") or "",
                    "duplicate_date": rec.get("Invoice Date") or rec.get("Date", "") or "",
                    "duplicate_file_name": rec.get("File Name", "") or "",
                }
    except Exception as e:
        logger.warning(f"Semantic duplicate lookup against cache failed (non-fatal): {e}")

    for cand in (extra_candidates or []):
        try:
            if _semantic_composite_match(
                norm_inv, norm_gstin, norm_vendor, norm_date,
                cand.get("invoice_number"), cand.get("vendor_tax_id"), cand.get("vendor_name"), cand.get("invoice_date"),
            ):
                return {
                    "duplicate_of_invoice": cand.get("invoice_number", "") or "",
                    "duplicate_vendor": cand.get("vendor_tax_id") or cand.get("vendor_name", "") or "",
                    "duplicate_date": cand.get("invoice_date", "") or "",
                    "duplicate_file_name": cand.get("file_name", "") or "",
                }
        except Exception as e:
            logger.warning(f"Semantic duplicate lookup against session candidate failed (non-fatal): {e}")

    return None

# Legacy fallback endpoint preservation
def save_bill_to_gsheet(bill_data: Dict[str, Any]) -> Dict[str, Any]:
    """Saves extracted bill details into local bills CSV and Google Sheets if webhook configured."""
    if _root_env.exists():
        load_dotenv(dotenv_path=_root_env, override=True)

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    file_name = str(bill_data.get("name") or "unknown.pdf")
    merchant = str(bill_data.get("merchant") or "—")
    date = str(bill_data.get("date") or "—")
    due_date = str(bill_data.get("due_date") or "")
    category = str(bill_data.get("category") or "Miscellaneous")
    total = str(bill_data.get("total") if bill_data.get("total") is not None else "0.00")
    confidence = str(round(float(bill_data.get("confidence", 1.0)), 2))
    read_status = str(bill_data.get("read") or "ai")
    flag = str(bill_data.get("flag") or "None")
    provider = str(bill_data.get("provider") or "gemini")
    latency_ms = str(bill_data.get("latency_ms") or "0")
    file_hash = str(bill_data.get("file_hash") or "")
    invoice_no = str(bill_data.get("invoice_no") or "—")
    taxable_amount = str(bill_data.get("taxable_amount") if bill_data.get("taxable_amount") is not None else "")
    cgst = str(bill_data.get("cgst") if bill_data.get("cgst") is not None else "")
    sgst = str(bill_data.get("sgst") if bill_data.get("sgst") is not None else "")
    igst = str(bill_data.get("igst") if bill_data.get("igst") is not None else "")
    cess = str(bill_data.get("cess") if bill_data.get("cess") is not None else "")
    other_charges = str(bill_data.get("other_charges") if bill_data.get("other_charges") is not None else "")
    additional_charges_amount = str(bill_data.get("additional_charges_amount") if bill_data.get("additional_charges_amount") is not None else "")
    discount_amount = str(bill_data.get("discount_amount") if bill_data.get("discount_amount") is not None else "")
    round_off_amount = str(bill_data.get("round_off_amount") if bill_data.get("round_off_amount") is not None else "")
    total_tax = str(bill_data.get("total_tax") if bill_data.get("total_tax") is not None else "")
    tally_ledger_name = str(bill_data.get("tally_ledger_name") or "")  # left blank for manual ledger mapping — no vendor-name fallback
    remarks = str(bill_data.get("remarks") or "")

    row = [
        timestamp, file_name, merchant, date, category, total, confidence, 
        read_status, flag, provider, latency_ms, file_hash, invoice_no, 
        taxable_amount, cgst, sgst, igst, cess, other_charges, total_tax, tally_ledger_name, remarks
    ]

    try:
        existing_rows = []
        if CSV_FILE_PATH.exists():
            with open(CSV_FILE_PATH, mode="r", encoding="utf-8") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                for r in reader:
                    existing_rows.append(r)

        clean_inv = re.sub(r'[^a-zA-Z0-9]', '', invoice_no).lower()
        clean_merchant = re.sub(r'[^a-zA-Z0-9]', '', merchant).lower()

        updated = False
        if clean_inv:
            for idx, r in enumerate(existing_rows):
                if len(r) > 12:
                    ex_inv = re.sub(r'[^a-zA-Z0-9]', '', r[12]).lower()
                    ex_merch = re.sub(r'[^a-zA-Z0-9]', '', r[2]).lower()
                    if ex_inv == clean_inv and (not clean_merchant or ex_merch == clean_merchant):
                        existing_rows[idx] = row
                        updated = True
                        break

        if not updated:
            existing_rows.append(row)

        with open(CSV_FILE_PATH, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)
            writer.writerows(existing_rows)

        logger.info(f"Saved/Updated bill record in local CSV database: {file_name}")
    except Exception as e:
        logger.error(f"Failed to write/upsert to local CSV: {e}")

    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    synced_to_gsheet = False
    gsheet_error = None

    if gsheet_url:
        try:
            vendor_tax_id = str(bill_data.get("vendor_tax_id") or bill_data.get("gstin") or "")
            payload = {
                "timestamp": timestamp,
                "file_name": file_name,
                "merchant": merchant,
                "date": date,
                "due_date": due_date,
                "category": category,
                "total": total,
                "confidence": confidence,
                "read_status": read_status,
                "flag": flag,
                "provider": provider,
                "latency_ms": latency_ms,
                "file_hash": file_hash,
                "invoice_no": invoice_no,
                "vendor_tax_id": vendor_tax_id,
                "gstin": vendor_tax_id,
                "taxable_amount": taxable_amount,
                "cgst": cgst,
                "sgst": sgst,
                "igst": igst,
                "cess": cess,
                "discount_amount": discount_amount,
                "round_off_amount": round_off_amount,
                "other_charges": other_charges,
                "additional_charges_amount": additional_charges_amount,
                "total_tax": total_tax,
                "tally_ledger_name": tally_ledger_name,
                "approval_status": bill_data.get("approval_status", "Pending L1"),
                "remarks": remarks,
                "line_items": bill_data.get("line_items", []),
                "row_data": row
            }
            res = requests.post(gsheet_url, json=payload, timeout=60)
            if res.ok:
                synced_to_gsheet = True
                logger.info("Successfully pushed bill record to Google Sheet Webhook!")
                # Keep the in-memory duplicate-detection cache perfectly in sync the
                # instant a save succeeds — no reboot/re-fetch needed for this
                # invoice to immediately start counting as a known duplicate.
                _add_record_to_cache({
                    "Invoice Number": invoice_no,
                    "Vendor Name": merchant,
                    "Vendor GSTIN": vendor_tax_id,
                    "Total Amount": total,
                    "Invoice Date": date,
                    "File Name": file_name,
                })
            else:
                gsheet_error = f"HTTP {res.status_code}: {res.text[:200]}"
        except Exception as e:
            gsheet_error = str(e)
            logger.warning(f"Failed to push to Google Sheet Webhook: {e}")

    return {
        "saved_locally": True,
        "csv_path": str(CSV_FILE_PATH),
        "synced_to_gsheet": synced_to_gsheet,
        "gsheet_configured": bool(gsheet_url),
        "gsheet_error": gsheet_error
    }

def get_all_bill_records() -> List[Dict[str, str]]:
    init_csv_database()
    records = []
    try:
        with open(CSV_FILE_PATH, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                records.append(dict(r))
    except Exception as e:
        logger.error(f"Error reading CSV database: {e}")
    return records

def sync_all_to_gsheet(gsheet_url: Optional[str] = None) -> Dict[str, Any]:
    if _root_env.exists():
        load_dotenv(dotenv_path=_root_env, override=True)
    if not gsheet_url:
        gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    if not gsheet_url:
        return {"status": "error", "message": "No Google Sheet Webhook URL configured."}

    records = get_all_bill_records()
    if not records:
        return {"status": "ok", "synced": 0, "message": "No records to sync."}

    payload_list = []
    for r in records:
        payload_list.append({
            "timestamp": r.get("Timestamp", ""),
            "file_name": r.get("File Name", ""),
            "merchant": r.get("Merchant", ""),
            "date": r.get("Date", ""),
            "due_date": r.get("Due Date", ""),
            "category": r.get("Category", ""),
            "total": r.get("Total Amount", ""),
            "confidence": r.get("Confidence", ""),
            "read_status": r.get("Read Status", ""),
            "flag": r.get("Flag", ""),
            "provider": r.get("Provider", ""),
            "latency_ms": r.get("Latency (ms)", ""),
            "file_hash": r.get("File Hash", ""),
            "invoice_no": r.get("Invoice No", ""),
            "vendor_tax_id": r.get("Vendor GSTIN", ""),
            "gstin": r.get("Vendor GSTIN", ""),
            "taxable_amount": r.get("Taxable Amount", ""),
            "cgst": r.get("CGST", ""),
            "sgst": r.get("SGST", ""),
            "igst": r.get("IGST", ""),
            "cess": r.get("Cess", ""),
            "other_charges": r.get("Other Charges", ""),
            "total_tax": r.get("Total Tax", ""),
            "tally_ledger_name": r.get("Tally Ledger Name", ""),
            "approval_status": r.get("Approval Status") or "Pending L1",
            "remarks": r.get("Remarks", ""),
            "line_items": r.get("line_items", [])
        })

    try:
        logger.info(f"Attempting batch sync of {len(payload_list)} records to GSheet (timeout=60s)...")
        res = requests.post(gsheet_url, json=payload_list, timeout=60)
        if res.ok:
            logger.info(f"Successfully batch synced {len(records)} records to Google Sheet!")
            return {"status": "ok", "synced": len(records), "message": f"Successfully batch synced {len(records)} records."}
        else:
            logger.warning(f"Batch POST returned HTTP {res.status_code}. Retrying items sequentially...")
    except Exception as batch_err:
        logger.warning(f"Batch POST failed ({batch_err}). Retrying items sequentially with 60s timeout...")

    # Sequential fallback per invoice
    success_count = 0
    errors = []
    for idx, item in enumerate(payload_list, 1):
        try:
            r_item = requests.post(gsheet_url, json=item, timeout=60)
            if r_item.ok:
                success_count += 1
            else:
                err_msg = f"Item {idx} ({item.get('file_name')}): HTTP {r_item.status_code}"
                errors.append(err_msg)
                logger.warning(err_msg)
        except Exception as item_err:
            err_msg = f"Item {idx} ({item.get('file_name')}): {str(item_err)}"
            errors.append(err_msg)
            logger.warning(err_msg)

    return {
        "status": "ok" if success_count > 0 else ("ok" if len(records) == 0 else "error"),
        "synced": success_count,
        "total": len(records),
        "errors": errors,
        "message": f"Synced {success_count}/{len(records)} records to Google Sheet."
    }


# =======================================================================
# EXTENDED MULTI-SHEET DATABASE OPERATIONS
# =======================================================================

def fetch_policies_from_gsheet() -> Optional[List[Dict[str, Any]]]:
    """Fetches active policy rules directly from Google Sheet via doGet Web App call."""
    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    if not gsheet_url:
        return None
    try:
        res = requests.get(f"{gsheet_url}?action=get_policies", timeout=5)
        if res.ok:
            data = res.json()
            if isinstance(data, list):
                logger.info("Successfully fetched policies from Google Sheet!")
                return data
    except Exception as e:
        logger.warning(f"Failed to fetch policies from Google Sheet: {e}")
    return None

def save_policy_to_gsheet(policy_rule: Dict[str, Any]) -> Dict[str, Any]:
    """Pushes a saved policy rule to Google Sheets via Webhook."""
    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    if not gsheet_url:
        return {"status": "local_only"}
    try:
        payload = {
            "action": "save_policy",
            "policy": {
                "Rule ID": policy_rule.get("rule_id", ""),
                "Expense Type": policy_rule.get("expense_type", ""),
                "Rule Type": policy_rule.get("rule_type", ""),
                "Limit": str(policy_rule.get("limit", 0)),
                "Approval Required": str(policy_rule.get("approval_required", True)).lower(),
                "Active/Inactive": "Active" if policy_rule.get("active", True) else "Inactive",
                "Effective From": policy_rule.get("effective_from" or ""),
                "Effective To": policy_rule.get("effective_to" or "")
            }
        }
        res = requests.post(gsheet_url, json=payload, timeout=5)
        if res.ok:
            return {"status": "ok"}
    except Exception as e:
        logger.warning(f"Failed to sync policy to Google Sheet: {e}")
    return {"status": "error"}

def save_claim_to_gsheet(claim_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Saves a claim and its bills into the local CLAIMS_CSV_PATH spreadsheet
    and logs/updates it in Google Sheets if GSHEET_WEBHOOK_URL is configured.
    """
    init_csv_database()
    
    claim_id = claim_data.get("id")
    employee = claim_data.get("employee")
    email = f"{employee.lower().replace(' ', '')}@claimdesk.com" if employee else ""
    dept = claim_data.get("dept")
    category = claim_data.get("category")
    
    policy_status = claim_data.get("policy_status", "Within Policy")
    policy_limit = str(claim_data.get("max_allowable") or "")
    excess_amount = str(claim_data.get("excess_amount", 0.0))
    raw_status = claim_data.get("approval_status")
    approval_status = "Pending L1" if (not raw_status or raw_status == "Pending") else raw_status
    
    approver = claim_data.get("approver") or ""
    approval_date = claim_data.get("approval_date") or ""
    approver_remarks = claim_data.get("approver_remarks") or ""
    final_claim_status = claim_data.get("status", "submitted")
    created_date = claim_data.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updated_date = claim_data.get("updated_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    bills = claim_data.get("bills", [])
    if not bills:
        # Placeholder bill row if no bills
        bills = [{}]

    claim_rows = []
    for b in bills:
        bill_link = f"/api/uploads/{b.get('file_hash')}" if b.get("file_hash") else ""
        orig_dict = b.get("original_ocr") or {}
        orig_json_str = json.dumps(orig_dict) if orig_dict else ""
        
        row_dict = {
            "Claim ID": claim_id,
            "Employee": employee,
            "Employee Email/ID": email,
            "Bill/File Link": bill_link,
            "Vendor Name": b.get("merchant") or "—",
            "Vendor GSTIN": b.get("invoice_no") or "—", # Use GSTIN if available
            "Invoice Number": b.get("invoice_no") or "—",
            "Invoice Date": b.get("date") or "—",
            "Expense Type": category,
            "Taxable Amount": str(b.get("taxable_amount") or ""),
            "CGST": str(b.get("cgst") or ""),
            "SGST": str(b.get("sgst") or ""),
            "IGST": str(b.get("igst") or ""),
            "Total Amount": str(b.get("total") or 0.0),
            "Policy Status": policy_status,
            "Policy Limit": policy_limit,
            "Excess Amount": excess_amount,
            "Approval Status": approval_status,
            "Approver": approver,
            "Approval Date": approval_date,
            "Approver Remarks": approver_remarks,
            "Final Claim Status": final_claim_status,
            "Created Date": created_date,
            "Updated Date": updated_date,
            "Original OCR Values": orig_json_str
        }
        claim_rows.append(row_dict)

    # 1. Update local CSV database
    # Read existing
    existing_rows = []
    try:
        if CLAIMS_CSV_PATH.exists():
            with open(CLAIMS_CSV_PATH, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    existing_rows.append(dict(r))
    except Exception as e:
        logger.error(f"Error reading claims CSV database: {e}")

    # Remove matching Claim ID rows
    filtered_rows = [r for r in existing_rows if r.get("Claim ID") != claim_id]
    # Add new rows
    filtered_rows.extend(claim_rows)

    # Write back
    try:
        with open(CLAIMS_CSV_PATH, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CLAIMS_HEADERS)
            writer.writeheader()
            for r in filtered_rows:
                writer.writerow(r)
        logger.info(f"Saved claim {claim_id} rows to local CSV database.")
    except Exception as e:
        logger.error(f"Failed to write to local claims CSV: {e}")

    # 2. Push to Google Sheet Webhook if configured
    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    synced = False
    if gsheet_url:
        try:
            payload = {
                "action": "save_claim",
                "claims": claim_rows
            }
            res = requests.post(gsheet_url, json=payload, timeout=5)
            if res.ok:
                synced = True
                logger.info("Successfully pushed claim data to Google Sheets!")
        except Exception as e:
            logger.warning(f"Failed to push claim data to Google Sheets: {e}")

    return {
        "saved_locally": True,
        "synced_to_gsheet": synced
    }

def log_approval_to_gsheet(claim_id: str, action: str, action_by: str, remarks: str) -> Dict[str, Any]:
    """Logs an approval action event in local CSV and Google Sheets."""
    init_csv_database()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    row = [claim_id, action, action_by, timestamp, remarks]

    try:
        with open(APPROVAL_LOG_CSV_PATH, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(row)
        logger.info(f"Approval action '{action}' logged locally for claim {claim_id}.")
    except Exception as e:
        logger.error(f"Failed to log approval locally: {e}")

    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    synced = False
    if gsheet_url:
        try:
            payload = {
                "action": "log_approval",
                "claim_id": claim_id,
                "log_action": action,
                "action_by": action_by,
                "action_date": timestamp,
                "remarks": remarks
            }
            res = requests.post(gsheet_url, json=payload, timeout=5)
            if res.ok:
                synced = True
        except Exception as e:
            logger.warning(f"Failed to push approval log to Google Sheets: {e}")

    return {
        "saved_locally": True,
        "synced_to_gsheet": synced
    }

def clear_all_records() -> Dict[str, Any]:
    """Wipes all local CSV databases (bills, claims, logs) and resets them with clean headers."""
    with open(CSV_FILE_PATH, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADERS)

    with open(CLAIMS_CSV_PATH, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CLAIMS_HEADERS)

    with open(APPROVAL_LOG_CSV_PATH, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(APPROVAL_LOG_HEADERS)

    logger.info("Cleared and flushed all local CSV database records.")

    # Also notify Google Sheet Webhook to clear rows if configured
    gsheet_url = os.getenv("GSHEET_WEBHOOK_URL", "").strip()
    gsheet_cleared = False
    if gsheet_url:
        try:
            res = requests.post(gsheet_url, json={"action": "clear_all"}, timeout=5)
            if res.ok:
                gsheet_cleared = True
                logger.info("Triggered remote Google Sheet database clear via webhook.")
        except Exception as e:
            logger.warning(f"Failed to trigger GSheet webhook clear: {e}")

    return {
        "status": "ok",
        "message": "All database records have been cleared and reset with clean headers.",
        "gsheet_cleared": gsheet_cleared
    }

