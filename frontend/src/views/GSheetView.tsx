import React, { useState, useEffect } from 'react';
import { 
  Download, RefreshCw, FileSpreadsheet, CheckCircle2, AlertCircle, 
  ExternalLink, Copy, Search, ShieldCheck, Send, Sparkles, Trash2, 
  Calendar, Filter, X, ArrowUpDown
} from 'lucide-react';
import { api } from '../services/api';
import { GSheetRecord, InvoiceData } from '../types';

interface GSheetViewProps {
  showToast: (msg: string) => void;
}

export const GSheetView: React.FC<GSheetViewProps> = ({ showToast }) => {
  const [records, setRecords] = useState<GSheetRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [sheetViewUrl, setSheetViewUrl] = useState<string>('');
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [savingWebhook, setSavingWebhook] = useState<boolean>(false);
  const [syncingAll, setSyncingAll] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activePreset, setActivePreset] = useState<string>('all');
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);

  const appsScriptCode = `// =======================================================================
// PKC Management Consulting - AP OCR Apps Script Extensions (Tally & Accounts Payable)
// =======================================================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('PKC AP Automation')
      .addItem('Setup Invoice Sheet Headers', 'setupInvoiceSheet')
      .addItem('Export Approved to Tally (Excel)', 'exportApprovedToTally')
      .addToUi();
}

function setupInvoiceSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var headers = [
    "Timestamp", "File Name", "Vendor Name", "Invoice Date", "Expense Category", 
    "Invoice Number", "Vendor GSTIN", "Taxable Amount", "CGST", "SGST", "IGST", 
    "Total Amount", "Confidence", "Approval Status", "Approver Name", "Approval Date", 
    "Remarks"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setFontWeight("bold");
  range.setBackground("#0F2942");
  range.setFontColor("#FFFFFF");
  
  var cell = sheet.getRange("N2:N5000");
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(["Pending", "Approved", "Rejected"], true).build();
  cell.setDataValidation(rule);
  
  SpreadsheetApp.getUi().alert("Invoice sheet headers setup complete! Approval Status validation dropdown has been configured.");
}

function exportApprovedToTally() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert("No invoice records found in sheet.");
    return;
  }
  
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  
  var colIdx = {};
  for (var i = 0; i < headers.length; i++) {
    colIdx[headers[i].trim()] = i;
  }
  
  if (colIdx["Approval Status"] === undefined) {
    SpreadsheetApp.getUi().alert("Could not find 'Approval Status' column. Please run 'Setup Invoice Sheet Headers' first.");
    return;
  }
  
  var approvedData = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var status = row[colIdx["Approval Status"]];
    if (status && String(status).trim().toLowerCase() === "approved") {
      var item = {};
      for (var key in colIdx) {
        item[key] = row[colIdx[key]];
      }
      approvedData.push(item);
    }
  }
  
  if (approvedData.length === 0) {
    SpreadsheetApp.getUi().alert("No entries with 'Approved' status found to export!");
    return;
  }
  
  var csvContent = generateTallyCSV(approvedData);
  var base64Csv = Utilities.base64Encode(csvContent, Utilities.Charset.UTF_8);
  
  var html = "<div style='font-family:sans-serif;padding:10px;'>" +
             "<h3 style='color:#0F2942;margin-top:0;'>Tally Export Ready</h3>" +
             "<p>Found <b>" + approvedData.length + "</b> approved purchase entries.</p>" +
             "<a href='data:text/csv;charset=utf-8;base64," + base64Csv + "' download='Tally_Purchase_Register.csv' style='display:inline-block;padding:10px 18px;background:#10B981;color:white;text-decoration:none;border-radius:6px;font-weight:bold;margin-bottom:10px;'>Download CSV for Tally</a>" +
             "<p style='color:#6B7280;font-size:11px;margin:0;'>This file can be opened directly in Microsoft Excel and imported into Tally.</p>" +
             "</div>";
             
  var userInterface = HtmlService.createHtmlOutput(html)
      .setWidth(360)
      .setHeight(180);
      
  SpreadsheetApp.getUi().showModalDialog(userInterface, 'PKC Management Consulting - Tally Export');
}

function generateTallyCSV(data) {
  var tallyHeaders = [
    "Voucher Date", "Voucher No", "Voucher Type", "Ref No", "Ref Date",
    "Party Ledger Name", "GSTIN/UIN", "Expense Ledger", "Purchase Value (Taxable Amount)",
    "CGST Amount", "SGST Amount", "IGST Amount", "Total Amount", "Narration"
  ];
  
  var rows = [tallyHeaders.join(",")];
  
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    
    var dateVal = r["Invoice Date"] || r["Timestamp"] || "";
    var dateStr = "";
    if (dateVal) {
      if (dateVal instanceof Date) {
        dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else {
        dateStr = String(dateVal).split("T")[0];
      }
    }
    
    var voucherNo = r["Invoice Number"] || "";
    var partyName = r["Vendor Name"] || "Cash/General Vendor";
    var gstin = r["Vendor GSTIN"] || "";
    var expenseLedger = r["Expense Category"] || "Purchase Account";
    var taxable = parseFloat(r["Taxable Amount"] || 0);
    var cgst = parseFloat(r["CGST"] || 0);
    var sgst = parseFloat(r["SGST"] || 0);
    var igst = parseFloat(r["IGST"] || 0);
    var total = parseFloat(r["Total Amount"] || 0);
    var narration = "Tally import from PKC Management Consulting AP OCR. Ref Invoice No: " + voucherNo + ". Remarks: " + (r["Remarks"] || "");
    
    var row = [
      escapeCsv(dateStr),
      escapeCsv(voucherNo),
      "Purchase",
      escapeCsv(voucherNo),
      escapeCsv(dateStr),
      escapeCsv(partyName),
      escapeCsv(gstin),
      escapeCsv(expenseLedger),
      taxable.toFixed(2),
      cgst.toFixed(2),
      sgst.toFixed(2),
      igst.toFixed(2),
      total.toFixed(2),
      escapeCsv(narration)
    ];
    
    rows.push(row.join(","));
  }
  
  return rows.join("\\r\\n");
}

function escapeCsv(val) {
  if (val === null || val === undefined) return "";
  var str = String(val).replace(/"/g, '""');
  if (str.indexOf(",") !== -1 || str.indexOf("\\n") !== -1 || str.indexOf('"') !== -1) {
    return '"' + str + '"';
  }
  return str;
}

// =======================================================================
// Webhook handler in Code.gs
// =======================================================================
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var body = JSON.parse(e.postData.contents);
    
    // Clear all rows action
    if (body.action === "clear_all" || body.action === "flush") {
      var activeSheet = ss.getActiveSheet();
      var lastRow = activeSheet.getLastRow();
      if (lastRow > 1) {
        activeSheet.deleteRows(2, lastRow - 1);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Sheet rows cleared" })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var activeSheet = ss.getActiveSheet();
    if (activeSheet.getLastRow() === 0) {
      setupInvoiceSheet();
    }
    
    var row = [
      body.timestamp || new Date().toISOString(),
      body.file_name || "",
      body.merchant || "", 
      body.date || "",     
      body.category || "Purchase Account", 
      body.invoice_no || "",
      body.vendor_tax_id || body.gstin || "", 
      body.taxable_amount || "",
      body.cgst || "",
      body.sgst || "",
      body.igst || "",
      body.total || "",
      body.confidence || "",
      "Pending", 
      "",        
      "",        
      body.remarks || ""
    ];
    activeSheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ status: "success", row: activeSheet.getLastRow() })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
`;

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const data = await api.getGSheetRecords();
      setRecords(data.records || []);
      setWebhookUrl(data.webhook_url || '');
      setSheetViewUrl(data.sheet_view_url || '');
      setIsConfigured(data.gsheet_configured || false);
    } catch (err) {
      console.error('Failed to load GSheet records', err);
      showToast('Error loading spreadsheet database');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWebhook = async () => {
    setSavingWebhook(true);
    try {
      const res = await api.updateGSheetWebhook(webhookUrl, sheetViewUrl);
      setIsConfigured(res.configured);
      showToast(res.configured ? 'Google Sheet connection saved!' : 'Webhook URL cleared');
    } catch (err) {
      showToast('Failed to save Webhook URL');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleSyncAll = async () => {
    if (!webhookUrl) {
      showToast('Please enter and save your Google Apps Script Webhook URL first!');
      return;
    }
    setSyncingAll(true);
    try {
      const res = await api.syncAllToGSheet();
      if (res.status === 'ok') {
        showToast(`Successfully synced ${res.synced || records.length} records to Google Sheet!`);
        fetchRecords();
      } else {
        showToast(`Sync failed: ${res.message || 'Unknown error'}`);
      }
    } catch (err: any) {
      showToast(`Sync error: ${err.message}`);
    } finally {
      setSyncingAll(false);
    }
  };

  const handleClearDatabase = async () => {
    if (!window.confirm('Are you sure you want to flush and wipe all entries from the database? This will give you a clean slate.')) {
      return;
    }
    try {
      showToast('Flushing database entries...');
      const res = await api.clearGSheetRecords();
      setRecords([]); // Instantly clear UI state
      showToast(res.message || 'Database flushed cleanly! All entries cleared.');
      await fetchRecords();
    } catch (err: any) {
      showToast(`Failed to clear database: ${err.message}`);
    }
  };

  // Helper to extract comparable YYYY-MM-DD from record date/timestamp
  const parseRecordDate = (r: GSheetRecord): string => {
    const d = r.Date || r['Invoice Date'] || r.Timestamp || '';
    if (!d) return '';
    const match = d.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const dmy = d.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) {
      const day = dmy[1].padStart(2, '0');
      const month = dmy[2].padStart(2, '0');
      const year = dmy[3];
      return `${year}-${month}-${day}`;
    }
    return d.slice(0, 10);
  };

  const setPresetDate = (preset: 'all' | 'today' | 'this_month' | 'last_30') => {
    setActivePreset(preset);
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'this_month') {
      const firstDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      setStartDate(firstDay);
      setEndDate(todayStr);
    } else if (preset === 'last_30') {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      const pastStr = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`;
      setStartDate(pastStr);
      setEndDate(todayStr);
    }
  };

  const mapRecordToInvoice = (r: GSheetRecord): InvoiceData => {
    const total = parseFloat(r['Total Amount'] || '0');
    const cgst = parseFloat(r.CGST || '0');
    const sgst = parseFloat(r.SGST || '0');
    const igst = parseFloat(r.IGST || '0');
    const taxable = parseFloat(r['Taxable Amount'] || '0') || (total - cgst - sgst - igst);

    return {
      id: r['File Hash'] || Math.random().toString(),
      file_name: r['File Name'] || '',
      file_hash: r['File Hash'] || '',
      file_type: 'pdf',
      page_count: 1,
      invoice_number: r['Invoice No'] || r['Invoice Number'] || '',
      invoice_date: r.Date || '',
      vendor_name: r.Merchant || r['Vendor Name'] || '',
      vendor_tax_id: r.CGST || r.SGST ? r.IGST : '',
      client_name: 'PKC Management Consulting',
      client_tax_id: '29AAACS1234K1Z8',
      subtotal: taxable,
      tax_breakdown: [
        { tax_type: 'CGST', tax_amount: cgst },
        { tax_type: 'SGST', tax_amount: sgst },
        { tax_type: 'IGST', tax_amount: igst }
      ],
      tax_amount: cgst + sgst + igst,
      total_amount: total,
      currency: 'INR',
      currency_symbol: '₹',
      line_items: [],
      overall_confidence: parseFloat(r.Confidence || '1.0'),
      confidence_level: (r.Flag as any) || 'High',
      missing_or_unclear_fields: [],
      is_reviewed: true,
      extraction_notes: r.Remarks || ''
    };
  };

  const filteredRecords = records.filter((r) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || (
      (r['File Name'] || '').toLowerCase().includes(q) ||
      (r.Merchant || '').toLowerCase().includes(q) ||
      (r.Category || '').toLowerCase().includes(q) ||
      (r.Date || '').toLowerCase().includes(q) ||
      (r['Invoice No'] || '').toLowerCase().includes(q)
    );
    if (!matchesSearch) return false;

    // Status filter
    if (statusFilter !== 'all') {
      const flag = (r.Flag || '').toLowerCase();
      if (statusFilter === 'high' && !flag.includes('high')) return false;
      if (statusFilter === 'medium' && !flag.includes('medium')) return false;
      if (statusFilter === 'low' && !flag.includes('low') && !flag.includes('review')) return false;
    }

    // Date filter
    const rDate = parseRecordDate(r);
    if (startDate && rDate && rDate < startDate) return false;
    if (endDate && rDate && rDate > endDate) return false;

    return true;
  });

  const filteredTotalAmount = filteredRecords.reduce((acc, r) => acc + (parseFloat(r['Total Amount'] || '0') || 0), 0);

  const handleExportFilteredExcel = async () => {
    if (filteredRecords.length === 0) {
      showToast('No records match your filter criteria to export.');
      return;
    }
    try {
      showToast(`Generating Excel export for ${filteredRecords.length} record(s)...`);
      const mappedInvoices = filteredRecords.map(mapRecordToInvoice);
      await api.exportToExcel(mappedInvoices, true, true);
      showToast('Excel workbook downloaded successfully!');
    } catch (err: any) {
      showToast(`Export error: ${err.message}`);
    }
  };

  const handleExportFilteredToTally = async () => {
    if (filteredRecords.length === 0) {
      showToast('No records match your filter criteria to export for Tally.');
      return;
    }
    try {
      showToast(`Compiling ${filteredRecords.length} records for Tally import...`);
      const mappedInvoices = filteredRecords.map(mapRecordToInvoice);
      await api.exportToTallyExcel(mappedInvoices);
      showToast('Tally Purchase Register download completed!');
    } catch (err: any) {
      showToast(`Export failed: ${err.message}`);
    }
  };

  const handleExportFilteredCsv = async () => {
    if (filteredRecords.length === 0) {
      showToast('No records to export as CSV.');
      return;
    }
    try {
      const mappedInvoices = filteredRecords.map(mapRecordToInvoice);
      await api.exportToCsv(mappedInvoices);
      showToast('CSV export downloaded!');
    } catch (err: any) {
      showToast(`Export error: ${err.message}`);
    }
  };

  const copyAppsScript = () => {
    navigator.clipboard.writeText(appsScriptCode);
    showToast('Google Apps Script copied to clipboard!');
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6 pb-12 text-slate-900 bg-[#F8FAFC]">
      {/* Header card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-lg bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              Google Sheet Database & Purchase Register
              <span className="ml-2 text-[9px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200/60">
                Online Registry
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Approved and submitted invoices logged in database, filterable by date range, and exportable to Excel / Tally.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {sheetViewUrl && (
            <a
              href={sheetViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md transition shadow-sm"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Live Google Sheet
            </a>
          )}
          <button
            onClick={handleExportFilteredExcel}
            className="flex items-center gap-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 px-4 py-2 rounded-md transition shadow-sm"
            title="Export filtered records as formatted Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
            Export Filtered Excel ({filteredRecords.length})
          </button>
          <button
            onClick={handleExportFilteredToTally}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 bg-white border border-slate-300 px-3.5 py-2 rounded-md transition"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Tally Export
          </button>
          <button
            onClick={fetchRecords}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 px-3 py-2 rounded-md transition shadow-sm"
            title="Refresh database records live from server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleClearDatabase}
            className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-2 rounded-md transition shadow-sm"
            title="Wipe and flush all records for a clean slate"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Flush DB</span>
          </button>
        </div>
      </div>

      {/* Database Stat Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Invoices Logged</div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">{records.length} Records</div>
          <div className="text-xs text-slate-500 mt-0.5">Full historical register</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Filtered View Total</div>
          <div className="text-xl font-bold font-mono text-blue-700 mt-1">
            ₹{filteredTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{filteredRecords.length} matching invoices</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Database Sync Mode</div>
          <div className="text-sm font-bold text-slate-900 mt-1.5 flex items-center gap-1.5">
            Local CSV + Webhook
            <ShieldCheck className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Auto-synced on approval submit</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Google Sheet Status</div>
          <div className="mt-1 flex items-center">
            {isConfigured ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200/50">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Webhook Linked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-amber-50 text-amber-800 px-2 py-0.5 rounded border border-amber-200/50">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Connection Pending
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Finance approval workflow ready</div>
        </div>
      </div>

      {/* Date Filter & Search Controls Bar */}
      <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-blue-600" />
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Filter by Date Range & Search
            </div>
          </div>
          {(startDate || endDate || searchQuery || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setSearchQuery('');
                setStatusFilter('all');
                setActivePreset('all');
              }}
              className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 transition"
            >
              <X className="w-3.5 h-3.5" />
              Reset All Filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200 text-xs">
            <button
              onClick={() => setPresetDate('all')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                activePreset === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setPresetDate('today')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                activePreset === 'today' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setPresetDate('this_month')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                activePreset === 'this_month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setPresetDate('last_30')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                activePreset === 'last_30' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 30 Days
            </button>
          </div>

          {/* Date Pickers */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2.5 py-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <label className="text-[10px] font-bold text-slate-400 uppercase">From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="text-xs text-slate-800 outline-none bg-transparent font-mono cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2.5 py-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <label className="text-[10px] font-bold text-slate-400 uppercase">To:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="text-xs text-slate-800 outline-none bg-transparent font-mono cursor-pointer"
              />
            </div>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-md px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none cursor-pointer"
          >
            <option value="all">All Confidence Flags</option>
            <option value="high">High Confidence (≥75%)</option>
            <option value="medium">Medium Confidence</option>
            <option value="low">Needs Review / Low</option>
          </select>

          {/* Text Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by vendor, invoice #, or file name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 focus:border-blue-600 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Webhook Connection & Controls */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              Google Sheet Webhook Integration
              <Sparkles className="w-4 h-4 text-blue-600" />
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Connect a Google Sheet Webhook to automatically push reviewed invoice rows to your accounts sheet for finance approval.
            </p>
          </div>
          <button
            onClick={() => setShowScriptModal(!showScriptModal)}
            className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 self-start sm:self-auto transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {showScriptModal ? 'Hide Apps Script Setup Guide' : 'Apps Script Setup Guide & Code'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
              Google Apps Script Web App Webhook URL (POST)
            </label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="w-full bg-white border border-slate-200 focus:border-blue-600 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 font-mono outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
              Direct Google Sheet URL (Spreadsheet View)
            </label>
            <input
              type="url"
              value={sheetViewUrl}
              onChange={(e) => setSheetViewUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/1ABC.../edit"
              className="w-full bg-white border border-slate-200 focus:border-blue-600 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 font-mono outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || !webhookUrl}
            className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-xs px-4 py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className={`w-3.5 h-3.5 ${syncingAll ? 'animate-bounce' : ''}`} />
            {syncingAll ? 'Batch Backfilling Invoices...' : 'Force Sync All Past Invoices to Google Sheet'}
          </button>

          <button
            onClick={handleSaveWebhook}
            disabled={savingWebhook}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 py-2 rounded-md transition"
          >
            {savingWebhook ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {showScriptModal && (
          <div className="bg-slate-50 border border-slate-200 p-5 rounded-lg space-y-4 text-xs mt-4">
            <div className="space-y-2 border-b border-slate-200 pb-3">
              <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider">Step-by-Step Google Sheet Integration Guide</h3>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-600 text-[11px] leading-relaxed">
                <li>Create a brand new spreadsheet at <a href="https://sheets.new" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-semibold">https://sheets.new</a></li>
                <li>From the top menu of Google Sheets, open <span className="font-semibold text-slate-900">Extensions → Apps Script</span>.</li>
                <li>Delete any default code in <span className="font-mono text-blue-700">Code.gs</span> and paste the Apps Script code below.</li>
                <li>Click <span className="font-semibold text-slate-900">Save</span> (floppy disk icon).</li>
                <li>Click top right <span className="font-semibold text-slate-900">Deploy → New deployment</span>.</li>
                <li>Select type: <span className="font-semibold text-slate-900">Web app</span>.</li>
                <li>Configure settings: Execute as: <span className="font-bold text-blue-700">Me</span> | Who has access: <span className="font-bold text-blue-700">Anyone</span>.</li>
                <li>Click <span className="font-semibold text-slate-900">Deploy</span>, authorize permissions, and copy the Web App URL!</li>
                <li>Paste the URL in the connection box above and click <span className="font-semibold text-slate-900">Save Settings</span>.</li>
                <li>In your Google Sheet, refresh and click the new menu item <span className="font-bold text-blue-700">PKC AP Automation → Setup Invoice Sheet Headers</span> to automatically format columns with approval dropdowns.</li>
              </ol>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px]">Google Apps Script Source (Code.gs)</span>
                <button onClick={copyAppsScript} className="flex items-center gap-1 bg-white hover:bg-slate-50 border border-slate-300 px-3 py-1 rounded text-slate-700 text-xs font-semibold transition">
                  <Copy className="w-3.5 h-3.5" /> Copy Code
                </button>
              </div>
              <pre className="font-mono text-[10px] leading-relaxed overflow-x-auto p-3 bg-white rounded border border-slate-200 text-slate-700 max-h-60 overflow-y-auto">
                {appsScriptCode}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Database Table Card */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
          <div className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <span>Invoices Database</span>
            <span className="text-[11px] font-normal text-slate-500">
              (Showing <span className="font-bold text-blue-700">{filteredRecords.length}</span> of {records.length} records — Total: <span className="font-bold text-slate-900">₹{filteredTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportFilteredExcel}
              className="flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 px-3 py-1.5 rounded-md transition shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              <span>Export to Excel (.xlsx)</span>
            </button>
            <button
              onClick={handleExportFilteredCsv}
              className="flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 px-3 py-1.5 rounded-md transition shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
            Loading database records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-1">
            <div className="font-semibold text-slate-700">No matching invoices found.</div>
            <div>
              {records.length > 0
                ? 'Try adjusting your date range or search query filters above.'
                : 'Verify and submit invoices in the Invoices / AP Queue tab to see them recorded here!'}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">File Name</th>
                  <th className="py-3 px-4">Vendor</th>
                  <th className="py-3 px-4">Invoice Date</th>
                  <th className="py-3 px-4 text-right">Taxable Amount</th>
                  <th className="py-3 px-4 text-right">Total Amount</th>
                  <th className="py-3 px-4 text-center">Confidence</th>
                  <th className="py-3 px-4 text-center">Status / Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
                {filteredRecords.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">{r.Timestamp}</td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">{r['Invoice No'] || r['Invoice Number'] || '—'}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900 max-w-xs truncate" title={r['File Name']}>{r['File Name']}</td>
                    <td className="py-3 px-4 text-slate-800">{r.Merchant || r['Vendor Name'] || '—'}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">{r.Date || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">
                      ₹{parseFloat(r['Taxable Amount'] || '0').toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      ₹{parseFloat(r['Total Amount'] || '0').toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        parseFloat(r.Confidence || '0') >= 0.75 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                      }`}>
                        {Math.round(parseFloat(r.Confidence || '0') * 100)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        r.Flag === 'High' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : r.Flag === 'Medium' ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-rose-50 text-rose-800 border border-rose-100'
                      }`}>
                        {r.Flag || 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
