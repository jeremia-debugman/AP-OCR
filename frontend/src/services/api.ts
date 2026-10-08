import { InvoiceData, BatchExtractionResponse, AIConfig, ExportExcelRequest, BatchSaveResponse } from '../types';

const API_BASE = '/api';

/** Wraps fetch with an AbortController timeout. Default: 120 seconds. */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s. The server may be busy — please try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  async extractInvoices(files: File[]): Promise<BatchExtractionResponse> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

    const response = await fetchWithTimeout(`${API_BASE}/extract`, {
      method: 'POST',
      body: formData,
    }, 180_000); // 3 min for AI extraction

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Extraction failed' }));
      throw new Error(err.detail || 'Failed to extract invoice data');
    }

    return response.json();
  },

  async exportToExcel(
    invoices: InvoiceData[],
    includeSummary: boolean = true,
    includeLineItems: boolean = true
  ): Promise<void> {
    const payload: ExportExcelRequest = {
      invoices,
      export_format: 'xlsx',
      include_summary_sheet: includeSummary,
      include_line_items_sheet: includeLineItems,
    };

    const response = await fetchWithTimeout(`${API_BASE}/export/excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, 30_000);

    if (!response.ok) {
      throw new Error('Failed to generate Excel export');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Extract filename from header if available
    const disposition = response.headers.get('Content-Disposition');
    let filename = `AP_Invoices_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async exportSingleInvoice(invoice: InvoiceData): Promise<void> {
    const response = await fetchWithTimeout(`${API_BASE}/export/single-excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoice),
    }, 30_000);

    if (!response.ok) {
      throw new Error('Failed to generate single invoice Excel');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanNum = (invoice.invoice_number || 'Invoice').replace(/[^a-zA-Z0-9-_]/g, '_');
    a.download = `Invoice_${cleanNum}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async exportToCsv(invoices: InvoiceData[]): Promise<void> {
    // Generate CSV client-side as well for instant download
    const headers = [
      'File Name', 'Invoice Number', 'Invoice Date', 'Due Date',
      'Vendor Name', 'Vendor Tax ID', 'Vendor Address', 'Client Name',
      'PO Number', 'GRN Number', 'Payment Terms', 'Currency',
      'Subtotal', 'Tax Amount', 'Discount', 'Additional Charges', 'Total Amount',
      'Confidence', 'Notes'
    ];

    const rows = invoices.map((inv) => [
      `"${inv.file_name}"`,
      `"${inv.invoice_number || 'Not Available'}"`,
      `"${inv.invoice_date || 'Not Available'}"`,
      `"${inv.due_date || 'Not Available'}"`,
      `"${(inv.vendor_name || 'Not Available').replace(/"/g, '""')}"`,
      `"${inv.vendor_tax_id || 'Not Available'}"`,
      `"${(inv.vendor_address || '').replace(/"/g, '""')}"`,
      `"${(inv.client_name || '').replace(/"/g, '""')}"`,
      `"${inv.po_number || 'Not Available'}"`,
      `"${inv.grn_number || 'Not Available'}"`,
      `"${inv.payment_terms || ''}"`,
      `"${inv.currency}"`,
      inv.subtotal ?? 0,
      inv.tax_amount ?? 0,
      inv.discount_amount ?? 0,
      inv.additional_charges ?? 0,
      inv.total_amount ?? 0,
      `"${Math.round(inv.overall_confidence * 100)}%"`,
      `"${(inv.extraction_notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AP_Invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async getConfig(): Promise<AIConfig> {
    const res = await fetchWithTimeout(`${API_BASE}/config`, {}, 8_000);
    if (!res.ok) throw new Error('Failed to load AI configuration');
    return res.json();
  },

  async updateConfig(config: Partial<AIConfig>): Promise<AIConfig> {
    const res = await fetchWithTimeout(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }, 8_000);
    return res.json();
  },

  async getSampleInvoices(): Promise<{ samples: { filename: string; size_bytes: number; url: string }[] }> {
    const res = await fetchWithTimeout(`${API_BASE}/sample-invoices`, {}, 8_000);
    return res.json();
  },

  async saveInvoice(invoice: InvoiceData): Promise<{ status: string; message: string }> {
    const res = await fetchWithTimeout(`${API_BASE}/invoices/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoice),
    }, 45_000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to save and sync invoice' }));
      throw new Error(err.detail || 'Failed to save and sync invoice');
    }
    return res.json();
  },

  /**
   * Saves a batch of invoices in one request. The backend tracks each invoice's
   * success/failure independently, so a duplicate/timeout/webhook error on one
   * invoice never hides or blocks the outcome of the others — callers must read
   * `results` per-invoice rather than treating this as pass/fail for the whole batch.
   */
  async batchSaveInvoices(invoices: InvoiceData[]): Promise<BatchSaveResponse> {
    const timeoutMs = Math.max(45_000, Math.min(180_000, 45_000 + invoices.length * 15_000));
    const res = await fetchWithTimeout(`${API_BASE}/invoices/batch-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoices }),
    }, timeoutMs);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to submit invoice batch' }));
      throw new Error(err.detail || 'Failed to submit invoice batch');
    }
    return res.json();
  },

  async exportToTallyExcel(invoices: InvoiceData[]): Promise<void> {
    const payload: ExportExcelRequest = {
      invoices,
      export_format: 'xlsx',
      include_summary_sheet: true,
      include_line_items_sheet: true,
    };
    const res = await fetch(`${API_BASE}/export/tally`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to export Tally Excel register');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    a.download = `Tally_Purchase_Register_${timestamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async getGSheetRecords(): Promise<{ records: any[]; webhook_url: string; sheet_view_url: string; gsheet_configured: boolean }> {
    const res = await fetch(`${API_BASE}/gsheet/records`);
    if (!res.ok) throw new Error('Failed to fetch GSheet database records');
    return res.json();
  },

  /**
   * Live Google Sheet ledger rows, fetched directly from the deployed webhook — the
   * single source of truth for duplicate detection (unlike getGSheetRecords, which
   * reflects the local CSV audit trail). Empty when unconfigured/unreachable/genuinely
   * empty, which correctly means "no known duplicates."
   */
  async getLiveGSheetRecords(): Promise<{ records: any[]; gsheet_configured: boolean }> {
    const res = await fetch(`${API_BASE}/gsheet/live-records`);
    if (!res.ok) throw new Error('Failed to fetch live Google Sheet records');
    return res.json();
  },

  async updateGSheetWebhook(webhook_url: string, sheet_view_url: string): Promise<{ status: string; configured: boolean }> {
    const res = await fetch(`${API_BASE}/gsheet/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_url, sheet_view_url }),
    });
    if (!res.ok) throw new Error('Failed to save webhook settings');
    return res.json();
  },

  async syncAllToGSheet(): Promise<{ status: string; synced?: number; message?: string }> {
    const res = await fetchWithTimeout(`${API_BASE}/gsheet/sync`, { method: 'POST' }, 30_000);
    if (!res.ok) throw new Error('Failed to trigger database backfill');
    return res.json();
  },

  async clearGSheetRecords(): Promise<{ status: string; message?: string }> {
    const res = await fetchWithTimeout(`${API_BASE}/gsheet/clear`, { method: 'POST' }, 20_000);
    if (!res.ok) throw new Error('Failed to clear database');
    return res.json();
  },
};

