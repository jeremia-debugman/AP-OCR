import io
from typing import List, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from models import InvoiceData
from ocr_engine import build_line_item_rows

# Design Tokens / Colors for Professional Excel Styling
NAVY_HEADER_FILL = PatternFill(start_color="111A2E", end_color="111A2E", fill_type="solid")
TEAL_HEADER_FILL = PatternFill(start_color="16213A", end_color="16213A", fill_type="solid")
TOTAL_ROW_FILL = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
ALT_ROW_FILL = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
HIGH_CONF_FILL = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")  # light green
MED_CONF_FILL = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")   # light amber
LOW_CONF_FILL = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")   # light red

HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
TITLE_FONT = Font(name="Calibri", size=14, bold=True, color="111A2E")
BOLD_FONT = Font(name="Calibri", size=10, bold=True)
REGULAR_FONT = Font(name="Calibri", size=10)
MUTED_FONT = Font(name="Calibri", size=9, color="64748B", italic=True)

THIN_BORDER = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='thin', color='CBD5E1')
)
DOUBLE_BOTTOM_BORDER = Border(
    top=Side(style='thin', color='94A3B8'),
    bottom=Side(style='double', color='0F172A'),
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1')
)

ALIGN_LEFT = Alignment(horizontal='left', vertical='center')
ALIGN_RIGHT = Alignment(horizontal='right', vertical='center')
ALIGN_CENTER = Alignment(horizontal='center', vertical='center')

def auto_fit_columns(worksheet, min_width=12, max_width=45):
    for col in worksheet.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            val_str = str(cell.value or '')
            if cell.number_format and ('#,##' in cell.number_format or '%' in cell.number_format):
                val_len = len(val_str) + 6
            else:
                val_len = len(val_str)
            if val_len > max_len:
                max_len = val_len
        worksheet.column_dimensions[col_letter].width = max(min_width, min(max_len + 3, max_width))

def generate_invoices_excel(invoices: List[InvoiceData], include_summary: bool = True, include_line_items: bool = True) -> bytes:
    """
    Generates a beautifully formatted multi-sheet Excel (.xlsx) file containing:
    1. Invoices Summary Sheet (Master high-level invoice register)
    2. Line Items Detail Sheet (Detailed line-by-line item register across all invoices)
    """
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # -------------------------------------------------------------
    # 1. INVOICES SUMMARY SHEET
    # -------------------------------------------------------------
    if include_summary or not include_line_items:
        ws_summary = wb.create_sheet(title="Invoices Summary")
        ws_summary.views.sheetView[0].showGridLines = True
        ws_summary.freeze_panes = "A2"

        summary_headers = [
            "File Name",
            "Invoice Number",
            "Invoice Date",
            "Due Date",
            "Vendor / Supplier",
            "Vendor Tax/GST ID",
            "Vendor Address",
            "Client / Buyer",
            "PO Number",
            "GRN Number",
            "Payment Terms",
            "Currency",
            "Subtotal",
            "Tax Amount",
            "Discount",
            "Addl Charges",
            "Total Amount",
            "Line Items Count",
            "Confidence",
            "Status",
            "Extraction Notes"
        ]

        # Write Header
        ws_summary.row_dimensions[1].height = 28
        for col_idx, header in enumerate(summary_headers, 1):
            cell = ws_summary.cell(row=1, column=col_idx, value=header)
            cell.font = HEADER_FONT
            cell.fill = NAVY_HEADER_FILL
            cell.alignment = ALIGN_CENTER if header in ["Currency", "Status", "Confidence", "Invoice Date", "Due Date", "Line Items Count"] else (ALIGN_RIGHT if "Amount" in header or header in ["Subtotal", "Discount", "Addl Charges", "Tax Amount"] else ALIGN_LEFT)
            cell.border = THIN_BORDER

        row_idx = 2
        for inv in invoices:
            ws_summary.row_dimensions[row_idx].height = 20
            row_fill = ALT_ROW_FILL if row_idx % 2 == 0 else PatternFill(fill_type=None)

            values = [
                inv.file_name,
                inv.invoice_number or "Not Available",
                inv.invoice_date or "Not Available",
                inv.due_date or "Not Available",
                inv.vendor_name or "Not Available",
                inv.vendor_tax_id or "Not Available",
                inv.vendor_address or "",
                inv.client_name or "",
                inv.po_number or "Not Available",
                inv.grn_number or "Not Available",
                inv.payment_terms or "",
                inv.currency,
                inv.subtotal if inv.subtotal is not None else 0.0,
                inv.tax_amount if inv.tax_amount is not None else 0.0,
                inv.discount_amount or 0.0,
                inv.additional_charges or 0.0,
                inv.total_amount if inv.total_amount is not None else 0.0,
                len(inv.line_items),
                f"{int(inv.overall_confidence * 100)}% ({inv.confidence_level})",
                "Reviewed" if inv.is_reviewed else "Pending Review",
                inv.extraction_notes or ""
            ]

            for col_idx, val in enumerate(values, 1):
                cell = ws_summary.cell(row=row_idx, column=col_idx, value=val)
                cell.font = REGULAR_FONT
                cell.border = THIN_BORDER
                cell.fill = row_fill

                # Alignment & number formatting
                header_name = summary_headers[col_idx - 1]
                if header_name in ["Subtotal", "Tax Amount", "Discount", "Addl Charges", "Total Amount"]:
                    cell.alignment = ALIGN_RIGHT
                    cell.number_format = '#,##0.00'
                elif header_name in ["Invoice Date", "Due Date", "Currency", "Status", "Line Items Count"]:
                    cell.alignment = ALIGN_CENTER
                elif header_name == "Confidence":
                    cell.alignment = ALIGN_CENTER
                    if inv.confidence_level == "High":
                        cell.fill = HIGH_CONF_FILL
                    elif inv.confidence_level == "Medium":
                        cell.fill = MED_CONF_FILL
                    else:
                        cell.fill = LOW_CONF_FILL
                else:
                    cell.alignment = ALIGN_LEFT
                    if val == "Not Available":
                        cell.font = MUTED_FONT

            row_idx += 1

        # Summary Totals Row
        if len(invoices) > 0:
            ws_summary.row_dimensions[row_idx].height = 24
            tot_label = ws_summary.cell(row=row_idx, column=1, value=f"Total ({len(invoices)} Invoices)")
            tot_label.font = BOLD_FONT
            tot_label.border = DOUBLE_BOTTOM_BORDER
            tot_label.fill = TOTAL_ROW_FILL

            for c in range(2, len(summary_headers) + 1):
                cell = ws_summary.cell(row=row_idx, column=c)
                cell.font = BOLD_FONT
                cell.border = DOUBLE_BOTTOM_BORDER
                cell.fill = TOTAL_ROW_FILL
                
                header_name = summary_headers[c - 1]
                col_letter = get_column_letter(c)
                if header_name in ["Subtotal", "Tax Amount", "Discount", "Addl Charges", "Total Amount"]:
                    cell.value = f"=SUM({col_letter}2:{col_letter}{row_idx-1})"
                    cell.number_format = '#,##0.00'
                    cell.alignment = ALIGN_RIGHT
                elif header_name == "Line Items Count":
                    cell.value = f"=SUM({col_letter}2:{col_letter}{row_idx-1})"
                    cell.number_format = '#,##0'
                    cell.alignment = ALIGN_CENTER

        auto_fit_columns(ws_summary)

    # -------------------------------------------------------------
    # 2. LINE ITEMS DETAIL SHEET
    # -------------------------------------------------------------
    if include_line_items:
        ws_items = wb.create_sheet(title="Line Items Detail")
        ws_items.views.sheetView[0].showGridLines = True
        ws_items.freeze_panes = "A2"

        items_headers = [
            "File Name",
            "Invoice Number",
            "Vendor Name",
            "Invoice Date",
            "Item #",
            "Description",
            "HSN / SAC",
            "Quantity",
            "Unit",
            "Unit Price",
            "Discount",
            "Tax Rate (%)",
            "Tax Amount",
            "Line Total",
            "Currency"
        ]

        ws_items.row_dimensions[1].height = 28
        for col_idx, header in enumerate(items_headers, 1):
            cell = ws_items.cell(row=1, column=col_idx, value=header)
            cell.font = HEADER_FONT
            cell.fill = TEAL_HEADER_FILL
            cell.alignment = ALIGN_CENTER if header in ["Item #", "Unit", "Currency", "Invoice Date", "HSN / SAC"] else (ALIGN_RIGHT if "Rate" in header or "Price" in header or "Amount" in header or "Total" in header or "Quantity" in header or "Discount" in header else ALIGN_LEFT)
            cell.border = THIN_BORDER

        row_idx = 2
        item_counter = 1
        for inv in invoices:
            for item in inv.line_items:
                ws_items.row_dimensions[row_idx].height = 19
                row_fill = ALT_ROW_FILL if row_idx % 2 == 0 else PatternFill(fill_type=None)

                values = [
                    inv.file_name,
                    inv.invoice_number or "Not Available",
                    inv.vendor_name or "Not Available",
                    inv.invoice_date or "Not Available",
                    item_counter,
                    item.description or "Not Available",
                    item.hsn_sac or "",
                    item.quantity if item.quantity is not None else 1.0,
                    item.unit or "",
                    item.unit_price if item.unit_price is not None else 0.0,
                    item.discount or 0.0,
                    item.tax_rate_percent if item.tax_rate_percent is not None else 0.0,
                    item.tax_amount if item.tax_amount is not None else 0.0,
                    item.line_total if item.line_total is not None else 0.0,
                    inv.currency
                ]

                for col_idx, val in enumerate(values, 1):
                    cell = ws_items.cell(row=row_idx, column=col_idx, value=val)
                    cell.font = REGULAR_FONT
                    cell.border = THIN_BORDER
                    cell.fill = row_fill

                    header_name = items_headers[col_idx - 1]
                    if header_name in ["Unit Price", "Discount", "Tax Amount", "Line Total"]:
                        cell.alignment = ALIGN_RIGHT
                        cell.number_format = '#,##0.00'
                    elif header_name == "Tax Rate (%)":
                        cell.alignment = ALIGN_RIGHT
                        cell.number_format = '0.0"%"'
                    elif header_name == "Quantity":
                        cell.alignment = ALIGN_RIGHT
                        cell.number_format = '#,##0.00'
                    elif header_name in ["Item #", "Unit", "Currency", "Invoice Date"]:
                        cell.alignment = ALIGN_CENTER
                    else:
                        cell.alignment = ALIGN_LEFT
                        if val == "Not Available":
                            cell.font = MUTED_FONT

                row_idx += 1
                item_counter += 1

        # Totals Row for Line Items
        if row_idx > 2:
            ws_items.row_dimensions[row_idx].height = 24
            tot_label = ws_items.cell(row=row_idx, column=1, value=f"Total ({item_counter - 1} Items)")
            tot_label.font = BOLD_FONT
            tot_label.border = DOUBLE_BOTTOM_BORDER
            tot_label.fill = TOTAL_ROW_FILL

            for c in range(2, len(items_headers) + 1):
                cell = ws_items.cell(row=row_idx, column=c)
                cell.font = BOLD_FONT
                cell.border = DOUBLE_BOTTOM_BORDER
                cell.fill = TOTAL_ROW_FILL

                header_name = items_headers[c - 1]
                col_letter = get_column_letter(c)
                if header_name in ["Tax Amount", "Line Total", "Discount"]:
                    cell.value = f"=SUM({col_letter}2:{col_letter}{row_idx-1})"
                    cell.number_format = '#,##0.00'
                    cell.alignment = ALIGN_RIGHT

        auto_fit_columns(ws_items)

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()

def generate_single_invoice_excel(invoice: InvoiceData) -> bytes:
    """
    Generates a dedicated single invoice Excel sheet with header cards and line-item table.
    """
    return generate_invoices_excel([invoice], include_summary=True, include_line_items=True)

def generate_tally_excel(invoices: List[InvoiceData]) -> bytes:
    """
    Generates a Tally-compliant purchase register Excel sheet, one row per resolved
    line item (via ocr_engine.build_line_item_rows — the same resolver behind the
    Google Sheet Item-wise Database, so both exports always agree).

    Schema conflict resolution (per the AP OCR / Tally integration rules):
    - "Stock Item" rows: Item Name / HSN / Billed Quantity / Item Rate / Item Amount
      are populated. Item Amount is the line's NET amount (gross less any per-item
      discount, already resolved by build_line_item_rows), and Item Rate is derived
      from that net amount so Tally's inventory valuation is never overstated by an
      un-netted discount. Ledger Name / Ledger Amount are left blank — Tally posts
      these against inventory, not a ledger.
    - "Service" / "Discount" / "Additional Charge" / "Round Off" rows: routed
      exclusively to Ledger Name / Ledger Amount. Item Name, Billed Quantity, and
      Item Rate are left completely blank so Tally never mistakes these for physical
      inventory movements.
    """
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # Remove default sheet

    ws = wb.create_sheet(title="Tally Purchase Register")
    ws.views.sheetView[0].showGridLines = True
    ws.freeze_panes = "A2"

    headers = [
        "Voucher Date",
        "Voucher No",
        "Voucher Type",
        "Party Ledger Name",
        "GSTIN / UIN",
        "Item Name",
        "HSN / SAC",
        "Billed Quantity",
        "Item Rate",
        "Item Amount",
        "Ledger Name",
        "Ledger Amount",
        "CGST Amount",
        "SGST Amount",
        "IGST Amount",
        "Line Total",
        "Narration"
    ]

    NUMERIC_HEADERS = {"Billed Quantity", "Item Rate", "Item Amount", "Ledger Amount",
                        "CGST Amount", "SGST Amount", "IGST Amount", "Line Total"}
    CENTER_HEADERS = {"Voucher Date", "Voucher Type"}

    # Header format
    ws.row_dimensions[1].height = 28
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = HEADER_FONT
        cell.fill = TEAL_HEADER_FILL
        cell.alignment = ALIGN_CENTER if header in CENTER_HEADERS else (ALIGN_RIGHT if header in NUMERIC_HEADERS else ALIGN_LEFT)
        cell.border = THIN_BORDER

    row_idx = 2
    voucher_count = 0
    for inv in invoices:
        line_items, _header_totals = build_line_item_rows(inv)
        if not line_items:
            continue
        voucher_count += 1

        v_date = inv.invoice_date or ""
        v_no = inv.invoice_number or ""

        narration = f"AP Invoice Import. Vendor: {inv.vendor_name or ''}. No: {v_no}. File: {inv.file_name}"
        if inv.po_number:
            narration += f", PO Ref: {inv.po_number}"
        if inv.extraction_notes:
            narration += f" - {inv.extraction_notes}"

        for li in line_items:
            line_type = li.get("line_type") or "Stock Item"
            is_stock_item = line_type == "Stock Item"

            cgst_amt = li.get("cgst") or 0.0
            sgst_amt = li.get("sgst") or 0.0
            igst_amt = li.get("igst") or 0.0
            line_total = li.get("line_total") if li.get("line_total") is not None else 0.0

            if is_stock_item:
                item_name = li.get("description") or "Item"
                hsn_sac = li.get("hsn_sac") or ""
                qty = li.get("quantity") if li.get("quantity") is not None else 1.0
                # Net Amount = Gross Item Total - Discount Amount (already resolved as
                # taxable_amount by build_line_item_rows) — used for both Item Amount
                # and the derived Item Rate so inventory valuation is never overstated.
                item_amount = li.get("taxable_amount") or 0.0
                item_rate = round(item_amount / qty, 2) if qty else item_amount
                ledger_name = ""
                ledger_amount = ""
            else:
                item_name = ""
                hsn_sac = ""
                qty = ""
                item_rate = ""
                item_amount = ""
                ledger_name = li.get("description") or line_type
                ledger_amount = li.get("taxable_amount") or 0.0

            ws.row_dimensions[row_idx].height = 20
            row_fill = ALT_ROW_FILL if row_idx % 2 == 0 else PatternFill(fill_type=None)

            values = [
                v_date,
                v_no,
                "Purchase",
                inv.vendor_name or "Not Available",
                inv.vendor_tax_id or "Not Available",
                item_name,
                hsn_sac,
                qty,
                item_rate,
                item_amount,
                ledger_name,
                ledger_amount,
                cgst_amt,
                sgst_amt,
                igst_amt,
                line_total,
                narration
            ]

            for col_idx, val in enumerate(values, 1):
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.font = REGULAR_FONT
                cell.border = THIN_BORDER
                cell.fill = row_fill

                header_name = headers[col_idx - 1]
                if header_name in NUMERIC_HEADERS:
                    cell.alignment = ALIGN_RIGHT
                    if val != "":
                        cell.number_format = '#,##0.00' if header_name != "Billed Quantity" else '#,##0.00##'
                elif header_name in CENTER_HEADERS:
                    cell.alignment = ALIGN_CENTER
                else:
                    cell.alignment = ALIGN_LEFT
                    if val == "Not Available":
                        cell.font = MUTED_FONT

            row_idx += 1

    # Add Summary row if there are rows
    if row_idx > 2:
        ws.row_dimensions[row_idx].height = 24
        tot_label = ws.cell(row=row_idx, column=1, value=f"Total ({voucher_count} Vouchers / {row_idx - 2} Lines)")
        tot_label.font = BOLD_FONT
        tot_label.border = DOUBLE_BOTTOM_BORDER
        tot_label.fill = TOTAL_ROW_FILL

        for c in range(2, len(headers) + 1):
            cell = ws.cell(row=row_idx, column=c)
            cell.font = BOLD_FONT
            cell.border = DOUBLE_BOTTOM_BORDER
            cell.fill = TOTAL_ROW_FILL

            header_name = headers[c - 1]
            col_letter = get_column_letter(c)
            if header_name in ("Item Amount", "Ledger Amount", "CGST Amount", "SGST Amount", "IGST Amount", "Line Total"):
                cell.value = f"=SUM({col_letter}2:{col_letter}{row_idx-1})"
                cell.number_format = '#,##0.00'
                cell.alignment = ALIGN_RIGHT

    auto_fit_columns(ws)

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()

