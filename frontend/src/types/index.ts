export type ConfidenceLevel = 'High' | 'Medium' | 'Low' | 'Needs Review';

export interface TaxBreakdownItem {
  tax_type: string;
  rate_percent?: number | null;
  tax_amount?: number | null;
}

export interface InvoiceLineItem {
  item_id?: string;
  description: string;
  hsn_sac?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  discount?: number | null;
  tax_rate_percent?: number | null;
  tax_amount?: number | null;
  line_total?: number | null;
  confidence?: number;
  is_reviewed?: boolean;
  /** Set at extraction time by the backend's classify_line_types(). Absent on
   * manually-added rows. Used to exclude non-goods rows (e.g. itemized freight)
   * from the frontend's own line-item-sum reconciliation check. */
  line_type?: 'Stock Item' | 'Service' | 'Additional Charge' | 'Discount' | 'Round Off' | string;
}

export interface InvoiceData {
  id: string;
  file_name: string;
  file_hash: string;
  file_type: string;
  file_url?: string | null;
  page_count: number;

  // 0. Document Classification — structured, not inferred from free-text notes.
  document_type?: 'TAX_INVOICE' | 'PURCHASE_ORDER' | 'QUOTATION' | 'DELIVERY_CHALLAN' | 'PROFORMA_INVOICE' | 'UNKNOWN';

  // 1. Header / Identification
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
  currency: string;
  currency_symbol: string;
  po_number?: string | null;
  grn_number?: string | null;

  // 2. Vendor / Supplier
  vendor_name?: string | null;
  vendor_address?: string | null;
  vendor_tax_id?: string | null;
  vendor_email?: string | null;
  vendor_phone?: string | null;

  // 3. Client / Buyer
  client_name?: string | null;
  client_address?: string | null;
  client_tax_id?: string | null;

  // 4. Financials
  subtotal?: number | null;
  tax_breakdown: TaxBreakdownItem[];
  tax_amount?: number | null;
  discount_amount?: number | null;
  additional_charges?: number | null;
  total_amount?: number | null;

  // 5. Line Items
  line_items: InvoiceLineItem[];

  // 6. Metadata & Confidence
  overall_confidence: number;
  confidence_level: ConfidenceLevel;
  missing_or_unclear_fields: string[];
  is_reviewed: boolean;
  ai_provider?: string | null;
  ai_model?: string | null;
  latency_ms?: number;
  extraction_notes?: string | null;
  raw_ocr_response?: any;

  // 7. Tally Integration
  /** Tally ledger name for this vendor. Defaults to vendor_name; can be overridden before submission. */
  tally_ledger_name?: string | null;

  // 8. Semantic Duplicate Detection (composite key: Invoice No + Vendor GSTIN/Name + Invoice Date)
  is_semantic_duplicate?: boolean;
  duplicate_of_invoice?: string | null;
  duplicate_vendor?: string | null;
  duplicate_date?: string | null;
  duplicate_file_name?: string | null;
}

export interface BatchExtractionResponse {
  success: boolean;
  invoices: InvoiceData[];
  total_processed: number;
  successful_count: number;
  failed_count: number;
  errors: { file: string; error: string }[];
}

export interface BatchSaveResultItem {
  id: string;
  status: 'success' | 'failed';
  error?: string | null;
}

export interface BatchSaveResponse {
  results: BatchSaveResultItem[];
  success_count: number;
  failed_count: number;
}

export interface AIConfig {
  provider: 'gemini' | 'anthropic' | 'openai' | 'qwen' | 'azure' | 'local_fallback';
  api_key?: string | null;
  model_name?: string | null;
  is_configured: boolean;
  supported_providers: string[];
}

export interface ExportExcelRequest {
  invoices: InvoiceData[];
  export_format: 'xlsx' | 'csv' | 'json';
  include_summary_sheet: boolean;
  include_line_items_sheet: boolean;
  currency_preference?: string;
}

export interface GSheetRecord {
  Timestamp?: string;
  'File Name'?: string;
  Merchant?: string;
  Date?: string;
  Category?: string;
  'Total Amount'?: string;
  Confidence?: string;
  'Read Status'?: string;
  Flag?: string;
  Provider?: string;
  'Latency (ms)'?: string;
  'File Hash'?: string;
  'Invoice No'?: string;
  'Taxable Amount'?: string;
  CGST?: string;
  SGST?: string;
  IGST?: string;
  Cess?: string;
  'Other Charges'?: string;
  'Total Tax'?: string;
  /** Tally ledger name — Col O in the Google Sheet */
  'Tally Ledger Name'?: string;
  Remarks?: string;
  [key: string]: any;
}

