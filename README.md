# Smart Agro ERP — Accounts Payable (AP) OCR Invoice Extraction Module

A production-ready, template-agnostic Accounts Payable document extraction web application. Built for enterprise AP teams to upload single and batch invoices, automatically extract structured data with high-accuracy Vision AI, review and edit line items interactively with document side-by-side preview, and export clean, multi-sheet formatted Excel (`.xlsx`) files.

---

## 🌟 Core Features & Capabilities

1. **Multi-Format & Multi-Page Document Ingestion**
   - Single & batch (multi-file) upload for **PDF, JPG, JPEG, PNG, WEBP**.
   - Handles multi-page PDFs seamlessly using PyMuPDF high-DPI rasterization.
   - Extracts all line items across multi-page tables and totals from final summary blocks.

2. **Template-Agnostic AI Vision & Anti-Hallucination OCR**
   - Multi-provider AI Vision engine (Google Gemini 1.5/2.0 Flash, Claude 3.5 Sonnet, OpenAI GPT-4o, Alibaba Qwen-VL, Azure Vision, or Native PyMuPDF Heuristic).
   - **Strict Zero-Hallucination Policy**: If a field is missing, obscured, or ambiguous (e.g. PO Number or GRN), it is left blank or explicitly marked as `"Not Available"`—never guessed.
   - Preserves Vendor, Client/Buyer, and Date context (invoice numbers are not treated as globally unique).

3. **Extracted Data Structure**
   - **Header Identifiers**: Invoice #, Invoice Date, Due Date, Payment Terms, Currency, PO # (extraction only), GRN # (extraction only).
   - **Vendor Details**: Supplier Name, Tax/GST/VAT ID, Registered Address, Contact.
   - **Buyer / Client**: Customer Name, Tax ID, Billing Address.
   - **Financials**: Subtotal, Tax Breakdown (CGST, SGST, IGST, VAT, Sales Tax), Discount, Additional Charges, Grand Total.
   - **Line Items**: Description, HSN/SAC code, Quantity, Unit, Unit Price, Discount, Tax %, Line Total.

4. **Interactive Split-Pane Review Workspace**
   - **Document Viewer**: Interactive image & PDF viewer with Zoom In/Out, Rotate 90°, Fit Width, and Fullscreen.
   - **Line Items Editor**: Editable table with live line total recalculation, add row, duplicate row, and delete row.
   - **Reconciliation Validator**: Compares $\sum(\text{Line Items})$ vs $\text{Grand Total}$ and alerts if any discrepancy exists with a 1-click reconcile button.
   - **Batch Overview Table**: Search, filter by confidence (High, Medium, Low), multi-select checkboxes, and selective batch export.

5. **Enterprise Multi-Sheet Excel Export (`.xlsx`)**
   - Generated via Python `openpyxl` with corporate dark navy headers (`#111A2E`), bold white text, cell borders, currency formatting, and `=SUM(...)` Excel formulas.
   - **Sheet 1: Invoices Summary**: Master invoice register with all header fields, confidence score, and review status.
   - **Sheet 2: Line Items Detail**: Master itemized breakdown linking every line item to its invoice number, vendor, unit rates, and totals.
   - **Sheet 3: Single Invoice Export**: Dedicated layout for exporting individual reviewed invoices.
   - Also supports **CSV Export** for downstream ERP data pipelines.

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+**
- **Node.js 18+**

### 1. Install Backend Dependencies
```bash
pip install -r backend/requirements.txt
```

### 2. Install Frontend Dependencies & Build
```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. Run the Application
You can launch both backend and frontend with:

**Option A: Using the Launcher Script (Windows)**
```cmd
start.bat
```

**Option B: Manual Terminal Execution**
```bash
# Terminal 1 - Backend FastAPI Server (Port 8001)
python -m uvicorn backend.main:app --reload --port 8001

# Terminal 2 - Frontend Vite Dev Server (Port 5174)
cd frontend
npm run dev -- --port 5174
```

Open your browser at **`http://localhost:5174`** (or `http://localhost:8001` when running the production bundle).

---

## ⚙️ Configuration (Optional Vision AI API Keys)

Create a `.env` file in the root directory:
```env
# AI Provider: 'gemini', 'anthropic', 'openai', 'qwen', or 'local_fallback'
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Optional overrides
# ANTHROPIC_API_KEY=your_claude_key_here
# OPENAI_API_KEY=your_openai_key_here
```

*Note: You can also configure your Vision AI Provider and API key dynamically inside the app by clicking the **AI Settings** button.*

---

## 🧪 Verification & Automated Tests

Run the full end-to-end verification test suite:
```bash
python test_e2e_ap_ocr.py
```
This tests document rasterization, OCR extraction, line-item normalization, reconciliation, and validates generated multi-sheet Excel workbooks.