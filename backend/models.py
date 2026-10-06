import os
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

class TaxBreakdownItem(BaseModel):
    tax_type: str = "GST"  # CGST, SGST, IGST, VAT, Sales Tax, Cess, Other
    rate_percent: Optional[float] = None
    tax_amount: Optional[float] = None

class InvoiceLineItem(BaseModel):
    item_id: Optional[str] = None
    description: str = "Item / Service"
    hsn_sac: Optional[str] = None
    quantity: Optional[float] = 1.0
    unit: Optional[str] = None  # e.g., pcs, hrs, kg, boxes, month, etc.
    unit_price: Optional[float] = None
    discount: Optional[float] = 0.0
    tax_rate_percent: Optional[float] = None
    tax_amount: Optional[float] = None
    line_total: Optional[float] = None
    confidence: Optional[float] = 1.0
    is_reviewed: Optional[bool] = False
    # Set at extraction time by ocr_engine.classify_line_types() — "Stock Item",
    # "Service", "Additional Charge", "Discount", or "Round Off". Lets the frontend
    # exclude non-goods rows (e.g. itemized freight) from its own line-item-sum
    # reconciliation check without re-implementing the classifier client-side.
    line_type: Optional[str] = None

class InvoiceData(BaseModel):
    id: str  # Unique system extraction ID (uuid)
    file_name: str
    file_hash: str
    file_type: str  # pdf, jpeg, png, etc.
    file_url: Optional[str] = None
    page_count: int = 1

    # 0. Document Classification — structured, not inferred from free-text notes.
    # Non-invoice documents (PO/Quotation/Delivery Challan) must never enter the AP ledger.
    document_type: Literal[
        "TAX_INVOICE", "PURCHASE_ORDER", "QUOTATION", "DELIVERY_CHALLAN", "PROFORMA_INVOICE", "UNKNOWN"
    ] = "UNKNOWN"

    # ERP Specific Header Fields
    gst_registration: Optional[str] = None
    voucher_type: Optional[str] = "Purchase"
    voucher_no: Optional[str] = "Auto Generated"
    voucher_date: Optional[str] = None
    gst_treatment: Optional[str] = "Regular"
    source_of_supply: Optional[str] = None
    destination_of_supply: Optional[str] = None
    cost_centre_class: Optional[str] = None
    cost_centre: Optional[str] = None

    # 1. Header / Identification
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    payment_terms: Optional[str] = None
    currency: str = "INR"  # USD, EUR, INR, GBP, CAD, AUD, etc.
    currency_symbol: str = "₹"  # $, €, ₹, £, etc.
    po_number: Optional[str] = None
    grn_number: Optional[str] = None
    
    # 2. Vendor / Supplier
    vendor_name: Optional[str] = None
    vendor_address: Optional[str] = None
    vendor_tax_id: Optional[str] = None  # GSTIN, VAT ID, Tax ID, EIN
    vendor_email: Optional[str] = None
    vendor_phone: Optional[str] = None
    
    # 3. Client / Buyer (for duplicate context & entity matching)
    client_name: Optional[str] = None
    client_address: Optional[str] = None
    client_tax_id: Optional[str] = None
    
    # 4. Financial Summary
    subtotal: Optional[float] = None
    tax_breakdown: List[TaxBreakdownItem] = Field(default_factory=list)
    tax_amount: Optional[float] = None
    discount_amount: Optional[float] = 0.0
    additional_charges: Optional[float] = 0.0  # shipping, freight, packaging, etc.
    round_off_amount: Optional[float] = 0.0  # signed — can be a small positive or negative rounding adjustment
    total_amount: Optional[float] = None
    
    # 5. Line Items
    line_items: List[InvoiceLineItem] = Field(default_factory=list)
    
    # 6. Extraction Metadata & Review Status
    overall_confidence: float = 0.0  # 0.0 to 1.0
    confidence_level: Literal["High", "Medium", "Low", "Needs Review"] = "Needs Review"
    missing_or_unclear_fields: List[str] = Field(default_factory=list)
    is_reviewed: bool = False
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = None
    latency_ms: Optional[int] = 0
    extraction_notes: Optional[str] = None
    raw_ocr_response: Optional[Dict[str, Any]] = None

    # 7. Tally Integration
    tally_ledger_name: Optional[str] = None  # Defaults to vendor_name if not set

    # 8. Semantic Duplicate Detection (composite key: Invoice No + Vendor GSTIN/Name + Invoice Date)
    is_semantic_duplicate: bool = False
    duplicate_of_invoice: Optional[str] = None
    duplicate_vendor: Optional[str] = None
    duplicate_date: Optional[str] = None
    duplicate_file_name: Optional[str] = None

class BatchExtractionResponse(BaseModel):
    success: bool
    invoices: List[InvoiceData]
    total_processed: int
    successful_count: int
    failed_count: int
    errors: List[Dict[str, str]] = Field(default_factory=list)

class AIConfig(BaseModel):
    provider: Literal["gemini", "anthropic", "openai", "qwen", "azure", "local_fallback"] = "gemini"
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    is_configured: bool = False
    supported_providers: List[str] = ["gemini", "anthropic", "openai", "qwen", "azure", "local_fallback"]

class BatchSaveResultItem(BaseModel):
    id: str
    status: Literal["success", "failed"]
    error: Optional[str] = None

class BatchSaveRequest(BaseModel):
    invoices: List[InvoiceData]

class BatchSaveResponse(BaseModel):
    results: List[BatchSaveResultItem]
    success_count: int
    failed_count: int

class ExportExcelRequest(BaseModel):
    invoices: List[InvoiceData]
    export_format: Literal["xlsx", "csv", "json"] = "xlsx"
    include_summary_sheet: bool = True
    include_line_items_sheet: bool = True
    currency_preference: Optional[str] = None
