import os
import sys
from pathlib import Path

# Ensure backend in path
backend_path = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(backend_path))

from models import InvoiceData, InvoiceLineItem, TaxBreakdownItem, ExportExcelRequest
from ocr_engine import extract_invoice_data, intelligent_heuristic_fallback
from excel_generator import generate_invoices_excel, generate_single_invoice_excel

def test_ocr_and_excel():
    print("=== Testing AP OCR & Excel Generator ===")
    
    # 1. Test mock / sample extraction
    test_file_path = backend_path / "data" / "uploads" / "3770070d29c676d7b7b525f9f282e4f81a0973e15a2c2e520a02db89579484a3.pdf"
    
    if test_file_path.exists():
        print(f"Reading test PDF: {test_file_path.name}")
        with open(test_file_path, "rb") as f:
            pdf_bytes = f.read()
        
        inv = extract_invoice_data(pdf_bytes, "hotel_room_bill.pdf", "application/pdf")
        print(f"[OK] Extracted Invoice: Number={inv.invoice_number}, Date={inv.invoice_date}, Vendor={inv.vendor_name}, Total={inv.total_amount} {inv.currency}, Items={len(inv.line_items)}, Conf={inv.overall_confidence}")
        assert inv.invoice_number is not None, "Invoice number should not be None"
        assert len(inv.line_items) > 0, "Should have line items"
    else:
        print("Test file not found, creating synthetic invoice object...")
        inv = InvoiceData(
            id="test-1",
            file_name="invoice_101.pdf",
            file_hash="hash123",
            file_type="pdf",
            invoice_number="INV-2026-909",
            invoice_date="2026-08-20",
            due_date="2026-09-20",
            payment_terms="Net 30",
            currency="USD",
            currency_symbol="$",
            vendor_name="Acme Industrial Supplies LLC",
            vendor_tax_id="US-99887766",
            vendor_address="1200 Market St, San Francisco, CA",
            client_name="Smart Agro ERP Corp",
            client_tax_id="US-11223344",
            subtotal=4500.0,
            tax_amount=450.0,
            total_amount=4950.0,
            line_items=[
                InvoiceLineItem(
                    item_id="item-1",
                    description="Industrial Filter Cartridge Type A",
                    quantity=10.0,
                    unit="Units",
                    unit_price=250.0,
                    line_total=2500.0
                ),
                InvoiceLineItem(
                    item_id="item-2",
                    description="Hydraulic Fluid 50L Drum",
                    quantity=4.0,
                    unit="Drums",
                    unit_price=500.0,
                    line_total=2000.0
                )
            ],
            overall_confidence=0.96,
            confidence_level="High"
        )

    # 2. Test Excel Generation
    invoices = [inv]
    excel_bytes = generate_invoices_excel(invoices, include_summary=True, include_line_items=True)
    print(f"[OK] Excel generation successful. Total bytes generated: {len(excel_bytes)}")
    assert len(excel_bytes) > 1000, "Generated Excel file should have content"

    # Save to test output
    output_test_file = Path(__file__).resolve().parent / "test_output.xlsx"
    with open(output_test_file, "wb") as f:
        f.write(excel_bytes)
    print(f"[OK] Saved sample generated Excel to {output_test_file}")

    print("=== All Backend Verification Checks Passed Successfully! ===")

if __name__ == "__main__":
    test_ocr_and_excel()
