import React, { useState, useRef, useEffect, useMemo } from 'react';
import { InvoiceData, InvoiceLineItem, AIConfig } from '../types';
import { api } from '../services/api';
import { DocumentViewer } from '../components/DocumentViewer';
import { LineItemsEditor } from '../components/LineItemsEditor';
import { SettingsModal } from '../components/SettingsModal';
import {
  UploadCloud, FileText, CheckCircle2, AlertTriangle, AlertCircle,
  Download, Settings, RefreshCw, RotateCcw, Trash2, Eye, Table, Check,
  Search, Filter, ChevronRight, Sparkles, FileSpreadsheet, Plus, ExternalLink
} from 'lucide-react';

// Standard Indian GSTIN format: 2-digit state code, 10-char PAN, 1-digit entity code, 'Z', 1 checksum char
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

interface MoneyInputProps {
  label: string;
  value: number | null | undefined;
  currencySymbol: string;
  onChange: (val: number) => void;
  isGrandTotal?: boolean;
  inputColorClass?: string;
  labelColorClass?: string;
  alertState?: boolean;
}

const MoneyInput: React.FC<MoneyInputProps> = ({
  label,
  value,
  currencySymbol,
  onChange,
  isGrandTotal = false,
  inputColorClass = "text-slate-900",
  labelColorClass = "text-slate-500",
  alertState = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const numVal = value ?? 0;
  const formattedVal = numVal.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div>
      <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${labelColorClass}`}>
        {label} ({currencySymbol})
      </label>
      <input
        type="text"
        value={isFocused ? inputValue : formattedVal}
        onFocus={() => {
          setIsFocused(true);
          setInputValue(numVal === 0 ? '' : String(numVal));
        }}
        onBlur={() => {
          setIsFocused(false);
          const parsed = parseFloat(inputValue.replace(/,/g, ''));
          onChange(isNaN(parsed) ? 0 : Math.round((parsed + Number.EPSILON) * 100) / 100);
        }}
        onChange={(e) => {
          setInputValue(e.target.value);
          const parsed = parseFloat(e.target.value.replace(/,/g, ''));
          if (!isNaN(parsed)) {
            onChange(Math.round((parsed + Number.EPSILON) * 100) / 100);
          }
        }}
        placeholder="0.00"
        className={`w-full bg-white border ${
          alertState
            ? 'border-2 border-red-500 focus:border-red-600 shadow-sm text-sm font-mono font-bold text-red-700 py-2 px-2.5'
            : isGrandTotal
            ? 'border-2 border-blue-600 focus:border-blue-700 shadow-sm text-sm font-mono font-bold text-blue-700 py-2 px-2.5'
            : 'border-slate-200 focus:border-blue-600 text-xs font-mono font-semibold py-1.5 px-2.5'
        } focus:ring-1 ${alertState ? 'focus:ring-red-600' : 'focus:ring-blue-600'} rounded-lg outline-none tracking-tight ${inputColorClass}`}
      />
    </div>
  );
};

interface InvoiceExtractionViewProps {
  showToast: (msg: string) => void;
}

export const InvoiceExtractionView: React.FC<InvoiceExtractionViewProps> = ({ showToast }) => {
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'split' | 'batch_table'>('split');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [sampleInvoices, setSampleInvoices] = useState<{ filename: string; size_bytes: number; url: string }[]>([]);
  const [lastFailedFiles, setLastFailedFiles] = useState<File[]>([]);
  const [existingGSheetRecords, setExistingGSheetRecords] = useState<any[]>([]);
  const [discrepancyOverrideMap, setDiscrepancyOverrideMap] = useState<Record<string, boolean>>({});
  // Immutable snapshot of each invoice's original OCR extraction (TC86), keyed by invoice id.
  // Never written to after the initial extraction — edits to `invoices` must not mutate this.
  const [originalInvoicesMap, setOriginalInvoicesMap] = useState<Record<string, InvoiceData>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadConfig();
    loadSamples();
    loadGSheetRecords();
  }, []);

  // Duplicate detection must use the LIVE Google Sheet ledger as its single source of
  // truth (never the local CSV audit trail) — a row deleted in the Sheet must stop
  // counting as a duplicate on the very next extraction, with no stale local fallback.
  const loadGSheetRecords = async () => {
    try {
      const res = await api.getLiveGSheetRecords();
      setExistingGSheetRecords(res.records || []);
    } catch (err) {
      console.error('Failed to load live GSheet records:', err);
      // Fetch failure must not surface stale/cached data — an empty list correctly
      // resolves duplicate checks to "none found" rather than blocking on old state.
      setExistingGSheetRecords([]);
    }
  };

  const loadConfig = async () => {
    try {
      const conf = await api.getConfig();
      setAiConfig(conf);
    } catch (err) {
      console.error('Failed to load AI config:', err);
    }
  };

  const loadSamples = async () => {
    try {
      const res = await api.getSampleInvoices();
      setSampleInvoices(res.samples || []);
    } catch (err) {
      console.error('Failed to load samples:', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const normalizeStr = (s: string | number | null | undefined): string => {
    if (!s) return '';
    const clean = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    return clean.replace(/^0+/, '');
  };

  // Translates raw fetch/network/backend errors into a clean, actionable message instead
  // of a generic "Failed to fetch" or a raw exception string reaching the operator.
  const getFriendlyErrorMessage = (err: any, context: 'extract' | 'save' | 'gsheet' | 'export' = 'extract'): string => {
    const raw = (err && err.message) || String(err || '');
    const lower = raw.toLowerCase();
    const isNetworkFailure =
      (err && err.name === 'TypeError' && lower.includes('fetch')) ||
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('load failed');
    if (isNetworkFailure) {
      return 'Cannot connect to OCR server. Ensure local backend is running on port 8001.';
    }
    if (context === 'gsheet' || lower.includes('webhook') || lower.includes('google sheet') || lower.includes('gsheet')) {
      return 'Failed to push to Google Sheet. Check webhook connection.';
    }
    if (lower.includes('corrupt') || lower.includes('unreadable') || lower.includes('cannot parse') || lower.includes('failed to parse') || lower.includes('invalid pdf') || lower.includes('invalid image')) {
      return 'Unreadable or corrupted file. Please re-upload a clear file.';
    }
    return raw || 'Something went wrong. Please try again.';
  };

  const processFiles = async (files: File[]) => {
    setIsProcessing(true);
    setLastFailedFiles([]);
    setUploadProgress({ current: 0, total: files.length, filename: files[0].name });

    try {
      const res = await api.extractInvoices(files);
      if (res.invoices && res.invoices.length > 0) {
        setInvoices((prev) => {
          const combined = [...prev, ...res.invoices];
          if (combined.length > 0 && !selectedInvoiceId) {
            setSelectedInvoiceId(combined[0].id);
          }
          return combined;
        });
        // Snapshot each invoice's pristine OCR extraction (TC86) before any operator edits.
        setOriginalInvoicesMap((prev) => {
          const next = { ...prev };
          for (const inv of res.invoices) {
            next[inv.id] = JSON.parse(JSON.stringify(inv));
          }
          return next;
        });
        showToast(`Successfully extracted ${res.invoices.length} invoice(s)`);
      }
      if (res.errors && res.errors.length > 0) {
        const friendly = getFriendlyErrorMessage({ message: res.errors[0].error }, 'extract');
        showToast(
          res.errors.length === 1
            ? `${res.errors[0].file}: ${friendly}`
            : `${res.errors.length} file(s) failed extraction. ${friendly}`
        );
      }
    } catch (err: any) {
      console.error('Upload failed:', err);
      setLastFailedFiles(files);
      showToast(getFriendlyErrorMessage(err, 'extract'));
    } finally {
      setIsProcessing(false);
      setUploadProgress(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processFiles(Array.from(files));
    }
  };

  const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

  const parseToYYYYMMDD = (dateStr: string | null | undefined): string => {
    if (!dateStr || dateStr === 'Not Available' || dateStr.trim() === '') return '';
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const parts = trimmed.split(/[\/\-\.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        return `${y}-${m}-${d}`;
      } else if (parts[2].length === 4) {
        let d = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10);
        const y = parts[2];
        if (d > 12 && m <= 12) {
          return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        } else if (m > 12 && d <= 12) {
          return `${y}-${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
        } else if (!isNaN(d) && !isNaN(m)) {
          return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
      }
    }

    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) {
      const dt = new Date(parsed);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  };

  const calculateDueDate = (
    invoiceDateStr: string | null | undefined,
    paymentTermsStr: string | null | undefined
  ): string => {
    const validInvDate = parseToYYYYMMDD(invoiceDateStr);
    const baseDate = validInvDate ? new Date(validInvDate) : new Date();

    let days = 30;
    if (paymentTermsStr && paymentTermsStr.trim() !== '') {
      const match = paymentTermsStr.match(/\b(\d+)\b/);
      if (match) {
        days = parseInt(match[1], 10);
      } else if (/receipt/i.test(paymentTermsStr) || /immediate/i.test(paymentTermsStr)) {
        days = 0;
      }
    }

    baseDate.setDate(baseDate.getDate() + days);
    const y = baseDate.getFullYear();
    const m = String(baseDate.getMonth() + 1).padStart(2, '0');
    const d = String(baseDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Semantic Duplicate Detection (TC65) — composite key: Invoice No + (Vendor GSTIN, fallback
  // Vendor Name) + Invoice Date. Recomputed live from the CURRENT (possibly hand-edited) field
  // values on every render, so — unlike a one-time extraction-time snapshot — it stays accurate
  // as the operator corrects OCR misreads during review, matching how the existing loose
  // duplicate check below (isDuplicateInvoice) already behaves.
  const normInvoiceNumber = (s: string | null | undefined): string =>
    !s ? '' : String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normVendorTaxId = (s: string | null | undefined): string =>
    !s ? '' : String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normVendorName = (s: string | null | undefined): string =>
    !s ? '' : String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  interface SemanticDuplicateMatch {
    duplicate_of_invoice: string;
    duplicate_vendor: string;
    duplicate_date: string;
    duplicate_file_name: string;
  }

  const findSemanticDuplicateMatch = (
    inv: InvoiceData,
    gsheetRecords: any[],
    queueInvoices: InvoiceData[]
  ): SemanticDuplicateMatch | null => {
    const normInv = normInvoiceNumber(inv.invoice_number);
    const normDate = parseToYYYYMMDD(inv.invoice_date);
    if (!normInv || !normDate) return null;

    const normGstin = normVendorTaxId(inv.vendor_tax_id);
    const normVendor = normVendorName(inv.vendor_name);
    if (!normGstin && !normVendor) return null;

    const compositeMatch = (
      candInvoiceNo: any,
      candGstin: any,
      candVendor: any,
      candDate: any
    ): boolean => {
      const cInv = normInvoiceNumber(candInvoiceNo);
      if (!cInv || cInv !== normInv) return false;
      const cDate = parseToYYYYMMDD(candDate);
      if (!cDate || cDate !== normDate) return false;
      const cGstin = normVendorTaxId(candGstin);
      const cVendor = normVendorName(candVendor);
      if (normGstin && cGstin && normGstin === cGstin) return true;
      if (normVendor && cVendor && normVendor === cVendor) return true;
      return false;
    };

    // 1. Historical records — the LIVE Google Sheet ledger (single source of truth,
    // fetched via api.getLiveGSheetRecords() into existingGSheetRecords), never the
    // local CSV audit trail. Field names match the Sheet's own header row.
    for (const rec of gsheetRecords) {
      const recInvoiceNo = rec['Invoice Number'] || rec['Invoice No'] || rec['invoice_no'];
      const recGstin = rec['Vendor GSTIN'] || rec['gstin'];
      const recVendor = rec['Vendor Name'] || rec['Merchant'] || rec['vendor_name'];
      const recDate = rec['Invoice Date'] || rec['Date'] || rec['invoice_date'];
      if (compositeMatch(recInvoiceNo, recGstin, recVendor, recDate)) {
        return {
          duplicate_of_invoice: String(recInvoiceNo || ''),
          duplicate_vendor: String(recGstin || recVendor || ''),
          duplicate_date: parseToYYYYMMDD(recDate) || String(recDate || ''),
          duplicate_file_name: String(rec['File Name'] || rec['file_name'] || ''),
        };
      }
    }

    // 2. Current extraction session (other invoices already in the active batch queue)
    for (const q of queueInvoices) {
      if (q.id === inv.id) continue;
      if (compositeMatch(q.invoice_number, q.vendor_tax_id, q.vendor_name, q.invoice_date)) {
        return {
          duplicate_of_invoice: q.invoice_number || '',
          duplicate_vendor: q.vendor_tax_id || q.vendor_name || '',
          duplicate_date: parseToYYYYMMDD(q.invoice_date) || q.invoice_date || '',
          duplicate_file_name: q.file_name || '',
        };
      }
    }

    return null;
  };

  const handleInvoiceChange = (id: string, field: keyof InvoiceData, value: any) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const updated = { ...inv, [field]: value };

        // Auto-recalculate grand total from sub-components
        if (['subtotal', 'tax_amount', 'discount_amount', 'additional_charges'].includes(field as string)) {
          const sub = typeof updated.subtotal === 'number' ? updated.subtotal : (parseFloat(updated.subtotal as any) || 0);
          const tax = typeof updated.tax_amount === 'number' ? updated.tax_amount : (parseFloat(updated.tax_amount as any) || 0);
          const disc = typeof updated.discount_amount === 'number' ? updated.discount_amount : (parseFloat(updated.discount_amount as any) || 0);
          const addl = typeof updated.additional_charges === 'number' ? updated.additional_charges : (parseFloat(updated.additional_charges as any) || 0);
          updated.total_amount = round2(Math.max(0, sub + tax + addl - disc));
        }

        return updated;
      })
    );
  };

  const handleLineItemsChange = (id: string, updatedItems: InvoiceLineItem[]) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;

        // additional_charges is pre-tax-only (matches the backend: it sums the
        // taxable base of "Additional Charge" rows like itemized freight, never
        // their tax — the header/derived tax_amount below already covers every
        // line's tax, freight included, so adding addl's own tax again here would
        // double it). Subtotal stays goods-only, same convention as the backend's
        // own subtotal field; tax_amount is summed across ALL lines (goods AND
        // charges) since it represents the invoice's total tax, not just goods'.
        const goodsItems = updatedItems.filter((it) => it.line_type !== 'Additional Charge');

        const goodsBaseSum = goodsItems.reduce((acc, it) => {
          const q = parseFloat(it.quantity as any) || 0;
          const p = parseFloat(it.unit_price as any) || 0;
          const d = parseFloat(it.discount as any) || 0;
          return acc + Math.max(0, q * p - d);
        }, 0);
        const goodsTaxSum = goodsItems.reduce((acc, it) => acc + (it.tax_amount || 0), 0);
        const goodsLineTotalSum = goodsItems.reduce((acc, it) => acc + (it.line_total || 0), 0);
        const allLineTaxSum = updatedItems.reduce((acc, it) => acc + (it.tax_amount || 0), 0);

        const newSubtotal = round2(goodsBaseSum > 0 ? goodsBaseSum : goodsLineTotalSum - goodsTaxSum);
        const newTax = round2(allLineTaxSum);
        const addl = inv.additional_charges || 0;
        const invDisc = inv.discount_amount || 0;
        const newGrandTotal = round2(Math.max(0, newSubtotal + newTax + addl - invDisc));

        return {
          ...inv,
          line_items: updatedItems,
          subtotal: newSubtotal,
          tax_amount: newTax > 0 ? newTax : inv.tax_amount,
          total_amount: newGrandTotal,
        };
      })
    );
  };

  const handleRecalculateGrandTotal = (id: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const items = inv.line_items ?? [];
        // Same pre-tax/all-tax convention as handleLineItemsChange.
        const goodsPretaxSum = items
          .filter((it) => it.line_type !== 'Additional Charge')
          .reduce((acc, it) => acc + Math.max(0, (it.line_total ?? 0) - (it.tax_amount ?? 0)), 0);
        const allTaxSum = items.reduce((acc, it) => acc + (it.tax_amount ?? 0), 0);
        const addl = inv.additional_charges || 0;
        const disc = inv.discount_amount || 0;
        const grand = Math.max(0, goodsPretaxSum + allTaxSum + addl - disc);
        return {
          ...inv,
          total_amount: round2(grand),
        };
      })
    );
    showToast('Grand total reconciled to match line items!');
  };

  const currentInvoice = invoices.find((inv) => inv.id === selectedInvoiceId) || (invoices.length > 0 ? invoices[0] : null);

  const isDuplicateInvoice = (inv: InvoiceData | null): boolean => {
    if (!inv || !inv.invoice_number) return false;
    const invNo = normalizeStr(inv.invoice_number);
    if (!invNo) return false;

    const vName = normalizeStr(inv.vendor_name);
    const gstin = normalizeStr(inv.vendor_tax_id);
    const totalAmt = inv.total_amount != null ? Math.round(inv.total_amount * 100) / 100 : null;

    // 1. Check the live Google Sheet ledger (existingGSheetRecords is sourced from
    // api.getLiveGSheetRecords() — the single source of truth, not local CSV history)
    const inDb = existingGSheetRecords.some((rec) => {
      const recInv = normalizeStr(rec['Invoice No'] || rec['Invoice Number'] || rec['invoice_no']);
      if (!recInv || recInv !== invNo) return false;

      const recVendor = normalizeStr(rec['Merchant'] || rec['Vendor Name'] || rec['vendor_name']);
      const recGstin = normalizeStr(rec['Vendor GSTIN'] || rec['gstin']);
      const recTotalRaw = rec['Total Amount'] || rec['total_amount'];
      const recTotal = recTotalRaw != null ? Math.round(parseFloat(recTotalRaw) * 100) / 100 : null;

      if (vName && recVendor && (vName === recVendor || vName.includes(recVendor) || recVendor.includes(vName))) return true;
      if (gstin && recGstin && gstin === recGstin) return true;
      if (totalAmt !== null && recTotal !== null && Math.abs(totalAmt - recTotal) < 0.01) return true;
      if (!vName && !gstin) return true;
      return false;
    });
    if (inDb) return true;

    // 2. Check other items in active queue
    return invoices.some((q) => {
      if (q.id === inv.id || !q.invoice_number) return false;
      const qInv = normalizeStr(q.invoice_number);
      if (!qInv || qInv !== invNo) return false;

      const qVendor = normalizeStr(q.vendor_name);
      const qGstin = normalizeStr(q.vendor_tax_id);
      const qTotal = q.total_amount != null ? Math.round(q.total_amount * 100) / 100 : null;

      if (vName && qVendor && (vName === qVendor || vName.includes(qVendor) || qVendor.includes(vName))) return true;
      if (gstin && qGstin && gstin === qGstin) return true;
      if (totalAmt !== null && qTotal !== null && Math.abs(totalAmt - qTotal) < 0.01) return true;
      if (!vName && !gstin) return true;
      return false;
    });
  };

  const isDuplicateCurrentInvoice = useMemo(() => {
    return isDuplicateInvoice(currentInvoice);
  }, [currentInvoice, existingGSheetRecords, invoices]);

  // Mandatory Field Gatekeeping (TC87)
  const isFieldEmpty = (v: string | null | undefined) => !v || v.trim() === '' || v === 'Not Available';
  const missingMandatoryFields: string[] = [];
  if (currentInvoice) {
    if (isFieldEmpty(currentInvoice.invoice_number)) missingMandatoryFields.push('Invoice Number');
    if (!parseToYYYYMMDD(currentInvoice.invoice_date)) missingMandatoryFields.push('Invoice Date');
    if (isFieldEmpty(currentInvoice.vendor_name)) missingMandatoryFields.push('Vendor Name');
    if (!currentInvoice.total_amount || currentInvoice.total_amount <= 0) missingMandatoryFields.push('Grand Total');
  }
  const hasMissingMandatoryFields = missingMandatoryFields.length > 0;

  // Financial Reconciliation Gatekeeping (TC74, TC73)
  const reconSubtotal = currentInvoice?.subtotal || 0;
  const reconTax = currentInvoice?.tax_amount || 0;
  const reconAddl = currentInvoice?.additional_charges || 0;
  const reconDisc = currentInvoice?.discount_amount || 0;
  const reconTotal = currentInvoice?.total_amount || 0;
  const financialDiscrepancy = Math.abs((reconSubtotal + reconTax + reconAddl - reconDisc) - reconTotal);
  const hasFinancialDiscrepancy = currentInvoice != null && financialDiscrepancy > 1.0;
  const isDiscrepancyOverridden = currentInvoice ? !!discrepancyOverrideMap[currentInvoice.id] : false;
  const blocksOnDiscrepancy = hasFinancialDiscrepancy && !isDiscrepancyOverridden;

  // GSTIN Regex Validation (TC75, TC39)
  const gstinValue = (currentInvoice?.vendor_tax_id || '').trim();
  const isGstinInvalid = gstinValue !== '' && !GSTIN_REGEX.test(gstinValue.toUpperCase());

  // Date Range Checks (TC28, TC29) — soft warnings only, do not block submit
  const parsedInvoiceDateForCheck = currentInvoice ? parseToYYYYMMDD(currentInvoice.invoice_date) : '';
  const todayDateObj = new Date();
  todayDateObj.setHours(0, 0, 0, 0);
  const thirtyDaysAgoObj = new Date(todayDateObj);
  thirtyDaysAgoObj.setDate(thirtyDaysAgoObj.getDate() - 30);
  let isFutureDatedInvoice = false;
  let isStaleInvoice = false;
  if (parsedInvoiceDateForCheck) {
    const invDateObj = new Date(`${parsedInvoiceDateForCheck}T00:00:00`);
    if (!isNaN(invDateObj.getTime())) {
      isFutureDatedInvoice = invDateObj.getTime() > todayDateObj.getTime();
      isStaleInvoice = invDateObj.getTime() < thirtyDaysAgoObj.getTime();
    }
  }

  // Duplicate Detection (TC65) — hash/queue match (isDuplicateCurrentInvoice) and the
  // composite-key semantic match (Invoice No + GSTIN/Vendor + Date) are treated as one
  // unified "duplicate" signal: no acknowledgment checkbox, just delete the card.
  const semanticDuplicateMatch = currentInvoice
    ? findSemanticDuplicateMatch(currentInvoice, existingGSheetRecords, invoices)
    : null;
  const isSemanticDuplicate = semanticDuplicateMatch != null;
  const isAnyDuplicate = isDuplicateCurrentInvoice || isSemanticDuplicate;

  // Non-Invoice Document Rejection (TC66, TC67, TC68) — a Purchase Order, Quotation, or
  // Delivery Challan must never enter the AP ledger. Hard block, no override — the only
  // way past this gate is to correct a wrong OCR classification or delete the card.
  const NON_INVOICE_DOCUMENT_TYPES = ['PURCHASE_ORDER', 'QUOTATION', 'DELIVERY_CHALLAN'];
  const DOCUMENT_TYPE_LABELS: Record<string, string> = {
    TAX_INVOICE: 'Tax Invoice',
    PURCHASE_ORDER: 'Purchase Order',
    QUOTATION: 'Quotation',
    DELIVERY_CHALLAN: 'Delivery Challan',
    PROFORMA_INVOICE: 'Proforma Invoice',
    UNKNOWN: 'Unknown Document',
  };
  const isNonInvoiceDocument = !!currentInvoice && NON_INVOICE_DOCUMENT_TYPES.includes(currentInvoice.document_type || '');

  // Reset to Original OCR Value (TC86) — whether the current card has been hand-edited
  // since extraction, i.e. whether there is anything for the Reset button to restore.
  const originalForCurrentInvoice = currentInvoice ? originalInvoicesMap[currentInvoice.id] : undefined;
  const isCurrentInvoiceModified =
    !!currentInvoice && !!originalForCurrentInvoice &&
    JSON.stringify(currentInvoice) !== JSON.stringify(originalForCurrentInvoice);

  const isSubmitBlocked =
    isNonInvoiceDocument || isAnyDuplicate || hasMissingMandatoryFields || blocksOnDiscrepancy;

  const handleSubmitSingleInvoice = async () => {
    if (!currentInvoice) return;
    if (isNonInvoiceDocument) {
      showToast(`Submission blocked: This document is classified as a ${DOCUMENT_TYPE_LABELS[currentInvoice.document_type || 'UNKNOWN']}, not a Tax Invoice.`);
      return;
    }
    if (isAnyDuplicate) {
      showToast("Submission blocked: Duplicate invoice detected. Delete this card to dismiss it.");
      return;
    }
    if (hasMissingMandatoryFields) {
      showToast(`Submission blocked: Missing mandatory field(s) — ${missingMandatoryFields.join(', ')}.`);
      return;
    }
    if (blocksOnDiscrepancy) {
      showToast("Submission blocked: Please confirm the arithmetic discrepancy override before submitting.");
      return;
    }
    try {
      const invNum = currentInvoice.invoice_number || currentInvoice.file_name;
      showToast(`Submitting invoice ${invNum} to Finance for approval...`);
      const invDueDate = parseToYYYYMMDD(currentInvoice.due_date) || calculateDueDate(currentInvoice.invoice_date, currentInvoice.payment_terms);
      const invoiceToSave: InvoiceData = {
        ...currentInvoice,
        due_date: invDueDate,
        is_reviewed: true
      };

      await api.saveInvoice(invoiceToSave);

      // Real-time sync: Append saved record to frontend state
      setExistingGSheetRecords((prev) => [
        ...prev,
        {
          'Invoice No': invoiceToSave.invoice_number,
          'Merchant': invoiceToSave.vendor_name,
          'Vendor GSTIN': invoiceToSave.vendor_tax_id,
          'Total Amount': invoiceToSave.total_amount
        }
      ]);

      const targetId = currentInvoice.id;
      const remaining = invoices.filter((inv) => inv.id !== targetId);
      setInvoices(remaining);
      setSelectedIds((prev) => prev.filter((id) => id !== targetId));

      if (remaining.length > 0) {
        const nextPending = remaining.find((inv) => !inv.is_reviewed) || remaining[0];
        setSelectedInvoiceId(nextPending.id);
      } else {
        setSelectedInvoiceId(null);
      }

      showToast(`Invoice ${invNum} submitted to GSheet and removed from queue!`);
    } catch (err: any) {
      showToast(`Failed to submit invoice: ${getFriendlyErrorMessage(err, 'save')}`);
    }
  };

  const handleSubmitAllReviewed = async () => {
    const reviewed = invoices.filter((inv) => inv.is_reviewed);
    if (reviewed.length === 0) {
      showToast("No invoices are marked as Reviewed & Verified yet.");
      return;
    }

    showToast(`Submitting ${reviewed.length} reviewed invoice(s) to Finance & GSheet...`);

    const payload = reviewed.map((inv) => ({
      ...inv,
      due_date: parseToYYYYMMDD(inv.due_date) || calculateDueDate(inv.invoice_date, inv.payment_terms),
      is_reviewed: true,
    }));

    try {
      const res = await api.batchSaveInvoices(payload);

      const succeededIds = new Set(res.results.filter((r) => r.status === 'success').map((r) => r.id));
      const failedResults = res.results.filter((r) => r.status === 'failed');

      if (succeededIds.size > 0) {
        // Real-time sync: append newly-saved records to the local duplicate-check cache.
        setExistingGSheetRecords((prev) => [
          ...prev,
          ...payload
            .filter((inv) => succeededIds.has(inv.id))
            .map((inv) => ({
              'Invoice No': inv.invoice_number,
              'Merchant': inv.vendor_name,
              'Vendor GSTIN': inv.vendor_tax_id,
              'Total Amount': inv.total_amount,
            })),
        ]);
      }

      // Only remove invoices that actually succeeded — failed ones stay on screen so
      // retrying the batch can never re-submit (and duplicate) an invoice that already saved.
      const remaining = invoices.filter((inv) => !succeededIds.has(inv.id));
      setInvoices(remaining);
      setSelectedIds((prev) => prev.filter((id) => !succeededIds.has(id)));

      if (remaining.length > 0) {
        const nextPending = remaining.find((inv) => !inv.is_reviewed) || remaining[0];
        setSelectedInvoiceId(nextPending.id);
      } else {
        setSelectedInvoiceId(null);
      }

      if (failedResults.length === 0) {
        showToast(`Successfully submitted ${res.success_count} reviewed invoice(s) to GSheet!`);
      } else if (succeededIds.size === 0) {
        showToast(
          `Submission failed for all ${failedResults.length} invoice(s). ${failedResults[0].error || 'Please retry.'}`
        );
      } else {
        const failedLabels = failedResults
          .map((r) => {
            const inv = payload.find((p) => p.id === r.id);
            return inv?.invoice_number || inv?.file_name || r.id;
          })
          .join(', ');
        showToast(
          `Partial Success: ${res.success_count} of ${res.results.length} invoice(s) submitted. ` +
          `Failed, needs retry — ${failedLabels}.`
        );
      }
    } catch (err: any) {
      // The whole request failed before any per-invoice result came back (network/timeout) —
      // nothing was removed from the queue, so the full batch is always safe to retry.
      showToast(`Batch submission failed: ${getFriendlyErrorMessage(err, 'gsheet')}`);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === filteredInvoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredInvoices.map((inv) => inv.id));
    }
  };

  const handleToggleSelectId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleDeleteInvoice = (id: string) => {
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    setSelectedIds((prev) => prev.filter((i) => i !== id));
    if (selectedInvoiceId === id) {
      const remaining = invoices.filter((inv) => inv.id !== id);
      setSelectedInvoiceId(remaining.length > 0 ? remaining[0].id : null);
    }
    showToast('Invoice removed from batch');
  };

  // Reset to Original OCR Value (TC86) — restores this card's header fields and line
  // items to the pristine snapshot captured at extraction time, discarding all operator
  // edits, and clears any per-card override state that was based on the edited values.
  const handleResetToOriginal = (id: string) => {
    const original = originalInvoicesMap[id];
    if (!original) return;
    const restored: InvoiceData = JSON.parse(JSON.stringify(original));
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? restored : inv)));
    setDiscrepancyOverrideMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    showToast('Invoice reset to original OCR extraction.');
  };

  const handleExportAllExcel = async () => {
    if (invoices.length === 0) {
      showToast('No invoices to export');
      return;
    }
    try {
      showToast('Generating professional Excel workbook...');
      await api.exportToExcel(invoices, true, true);
      showToast('Excel workbook downloaded successfully!');
    } catch (err: any) {
      showToast(`Export error: ${getFriendlyErrorMessage(err, 'export')}`);
    }
  };

  const handleExportSelectedExcel = async () => {
    const targets = invoices.filter((inv) => selectedIds.includes(inv.id));
    if (targets.length === 0) {
      showToast('Please select at least one invoice to export');
      return;
    }
    try {
      showToast(`Exporting ${targets.length} selected invoice(s)...`);
      await api.exportToExcel(targets, true, true);
      showToast('Excel file downloaded!');
    } catch (err: any) {
      showToast(`Export error: ${getFriendlyErrorMessage(err, 'export')}`);
    }
  };

  const handleExportCurrentInvoice = async () => {
    if (!currentInvoice) return;
    try {
      showToast(`Exporting ${currentInvoice.invoice_number || 'Invoice'} to Excel...`);
      await api.exportSingleInvoice(currentInvoice);
      showToast('Invoice Excel downloaded!');
    } catch (err: any) {
      showToast(`Export error: ${getFriendlyErrorMessage(err, 'export')}`);
    }
  };

  const handleExportCsv = async () => {
    if (invoices.length === 0) return;
    try {
      await api.exportToCsv(invoices);
      showToast('CSV export downloaded!');
    } catch (err: any) {
      showToast(`Export error: ${getFriendlyErrorMessage(err, 'export')}`);
    }
  };

  // Filtered invoices for batch table
  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      (inv.invoice_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.vendor_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.file_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;
    if (confidenceFilter === 'all') return true;
    if (confidenceFilter === 'high') return inv.confidence_level === 'High';
    if (confidenceFilter === 'medium') return inv.confidence_level === 'Medium';
    if (confidenceFilter === 'low') return inv.confidence_level === 'Low' || inv.confidence_level === 'Needs Review';
    return true;
  });

  // Calculate batch metrics
  const totalAmountSum = invoices.reduce((acc, inv) => acc + (inv.total_amount || 0), 0);
  const highConfCount = invoices.filter((inv) => inv.confidence_level === 'High').length;
  const needsReviewCount = invoices.filter((inv) => !inv.is_reviewed || inv.confidence_level === 'Needs Review' || inv.confidence_level === 'Low').length;

  // Check reconciliation mismatch for current invoice.
  // additional_charges is pre-tax-only (mirrors the backend: it sums the taxable
  // base of "Additional Charge" rows like itemized freight, never their tax — that
  // tax is already folded into the all-lines tax sum added below). So the expected
  // total is built the same way the backend derives it: goods-only pre-tax line
  // sum + ALL lines' tax (goods and charges alike) + additional charges - discount.
  // Comparing raw tax-inclusive line totals directly against Grand Total, or
  // re-adding a charge row's own tax on top of additional_charges, both produce
  // false mismatches whenever an invoice carries taxed shipping/freight charges.
  const currentGoodsPretaxSum = (currentInvoice?.line_items ?? [])
    .filter((item) => item.line_type !== 'Additional Charge')
    .reduce((acc, item) => acc + Math.max(0, (item.line_total || 0) - (item.tax_amount || 0)), 0);
  const currentAllLinesTaxSum = (currentInvoice?.line_items ?? []).reduce((acc, item) => acc + (item.tax_amount || 0), 0);
  const currentExpectedTotal = currentGoodsPretaxSum + currentAllLinesTaxSum + (currentInvoice?.additional_charges || 0) - (currentInvoice?.discount_amount || 0);
  const currentGrandTotal = currentInvoice?.total_amount || 0;
  const isReconciliationMismatch = !!currentInvoice && Math.abs(currentExpectedTotal - currentGrandTotal) > 0.05 && (currentInvoice.line_items?.length ?? 0) > 0;

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto pb-32 text-slate-900">
      {/* Top Header & Metrics Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0A2558] border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] font-bold text-lg shadow-sm">
            AP
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900 tracking-wide">
                AP OCR Invoice Extraction Workspace
              </h1>
            </div>
            <p className="text-[11px] text-slate-500">
              Intelligent Document Processing, Automated Reconciliation &amp; Tally Ledger Sync
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Settings button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-[#0A2558] bg-white border border-slate-300 hover:border-[#0A2558]/30 rounded-md transition flex items-center gap-1.5 shadow-sm"
            title="Configure Vision AI Provider and API Key"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500" />
            <span>AI Settings</span>
            {aiConfig?.is_configured && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            )}
          </button>

          {/* Retry button - appears only when last extraction failed */}
          {lastFailedFiles.length > 0 && !isProcessing && (
            <button
              type="button"
              onClick={() => processFiles(lastFailedFiles)}
              className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 border border-amber-700 rounded-md transition flex items-center gap-1.5 shadow-sm"
              title={`Retry extraction of ${lastFailedFiles.length} file(s)`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry ({lastFailedFiles.length} file{lastFailedFiles.length > 1 ? 's' : ''})
            </button>
          )}

          {/* Mode Switcher */}
          {invoices.length > 0 && (
            <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition flex items-center gap-1.5 ${
                  viewMode === 'split'
                    ? 'bg-white text-slate-950 border border-slate-200/50 shadow-sm font-bold'
                    : 'text-slate-50 hover:text-slate-800'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Split Review
              </button>
              <button
                type="button"
                onClick={() => setViewMode('batch_table')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition flex items-center gap-1.5 ${
                  viewMode === 'batch_table'
                    ? 'bg-white text-slate-950 border border-slate-200/50 shadow-sm font-bold'
                    : 'text-slate-50 hover:text-slate-800'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                Batch Table ({invoices.length})
              </button>
            </div>
          )}

          {/* Submit Reviewed Button */}
          {invoices.length > 0 && invoices.filter((i) => i.is_reviewed).length > 0 && (
            <button
              type="button"
              onClick={handleSubmitAllReviewed}
              className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition flex items-center gap-1.5 shadow-sm"
              title="Submit all reviewed invoices to Google Sheets and remove from queue"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-100" />
              Submit {invoices.filter((i) => i.is_reviewed).length} Reviewed
            </button>
          )}

          {/* Master Excel Export Button */}
          {invoices.length > 0 && (
            <button
              type="button"
              onClick={handleExportAllExcel}
              className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-850 rounded-md transition flex items-center gap-2 shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
              Export All to Excel (.xlsx)
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards (When invoices exist) */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">
              Total Invoices
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-1">
              {invoices.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {invoices.filter((i) => i.is_reviewed).length} marked reviewed
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">
              Batch Total Value
            </div>
            <div className="text-lg font-bold font-mono text-slate-900 mt-1">
              {currentInvoice?.currency_symbol || '₹'}{totalAmountSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Across {invoices.length} invoices
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">
              Clean Extractions %
            </div>
            <div className="text-lg font-bold font-mono text-blue-600 mt-1 flex items-center gap-1.5">
              {Math.round((highConfCount / invoices.length) * 100)}%
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {highConfCount} of {invoices.length} bills parsed cleanly
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-450">
              Pending Verification
            </div>
            <div className="text-lg font-bold font-mono text-amber-600 mt-1">
              {needsReviewCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Requires human adjustment
            </div>
          </div>
        </div>
      )}

      {/* Upload Zone (Hero state when empty, compact when invoices exist) */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg transition-all duration-200 text-center ${
          invoices.length === 0
            ? 'p-10 bg-white border-slate-300 hover:border-[#0A2558]/50 hover:bg-[#0A2558]/[0.02]'
            : 'p-4 bg-white border-slate-200 hover:border-[#0A2558]/40 hover:bg-slate-50'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
        />

        {isProcessing ? (
          <div className="py-6 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
            <div className="text-sm font-semibold text-slate-900">
              Processing & Extracting with AI Document Vision...
            </div>
            <div className="text-xs text-slate-500">
              Rasterizing pages, reading line items, normalizing taxes and currencies...
            </div>
          </div>
        ) : invoices.length === 0 ? (
          <div className="max-w-xl mx-auto space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-[#0A2558]/5 border border-[#0A2558]/15 text-[#0A2558] flex items-center justify-center mx-auto shadow-sm transition-colors">
              <UploadCloud className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Upload Single or Batch Invoices
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Drag and drop your PDF invoices, scanned images (JPG, PNG), or multi-page documents here.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2.5 text-xs font-bold text-white bg-[#0A2558] hover:bg-[#0f3460] rounded-md transition-colors flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#D4AF37]" />
                Select Invoices from Computer
              </button>
            </div>
            <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500 pt-2 border-t border-slate-200">
              <span>✓ Multi-page PDF support</span>
              <span>✓ Auto-reconciliation engine</span>
              <span>✓ Line item extraction</span>
              <span>✓ Tally Excel export</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#0A2558]/5 text-[#0A2558] flex items-center justify-center shrink-0">
                <UploadCloud className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800">Add more invoices to batch</div>
                <div className="text-[11px] text-slate-500">Supports PDF, JPG, PNG (Single or Multi-file)</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:text-[#0A2558] hover:border-[#0A2558]/30 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-[#D4AF37]" />
              Upload More Files
            </button>
          </div>
        )}
      </div>

      {/* Main Workspace Content (When invoices exist) */}
      {invoices.length > 0 && viewMode === 'split' && (
        <div className="space-y-4">
          {/* Horizontal Invoice Switcher Strip */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
              Batch Invoices ({invoices.length}):
            </span>
            {invoices.map((inv, idx) => {
              const isSelected = inv.id === currentInvoice?.id;
              const isDup = isDuplicateInvoice(inv);
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => setSelectedInvoiceId(inv.id)}
                  className={`px-3 py-1.5 rounded border text-left shrink-0 transition flex items-center gap-2.5 ${
                    isSelected
                      ? isDup
                        ? 'bg-red-50 border-red-500 text-red-950 shadow-sm'
                        : 'bg-slate-100 border-blue-650 text-slate-900 shadow-sm'
                      : isDup
                      ? 'bg-red-50/50 border-red-200 text-red-900 hover:border-red-300'
                      : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-400'
                  }`}
                >
                  <div className="text-xs font-mono font-bold text-slate-400">
                    #{idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate max-w-[140px] flex items-center gap-1">
                      {isDup && <span className="text-red-600 font-bold">⚠️</span>}
                      <span className={isDup ? 'text-red-950 font-bold' : 'text-slate-900'}>
                        {inv.invoice_number || inv.file_name}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate max-w-[140px] font-mono">
                      {inv.vendor_name || 'Vendor N/A'} • {inv.currency_symbol}{inv.total_amount ?? 0}
                    </div>
                  </div>
                  {isDup ? (
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[9px] font-extrabold uppercase shrink-0">
                      Dup
                    </span>
                  ) : (
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        inv.confidence_level === 'High'
                          ? 'bg-emerald-500'
                          : inv.confidence_level === 'Medium'
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      title={`Confidence: ${inv.confidence_level}`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Split Pane: Left Document Viewer, Right Extraction Form */}
          {currentInvoice && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Column: Document Preview (5 cols) */}
              <div className="lg:col-span-5 sticky top-4">
                <DocumentViewer
                  fileUrl={currentInvoice.file_url}
                  fileName={currentInvoice.file_name}
                  fileType={currentInvoice.file_type}
                  pageCount={currentInvoice.page_count}
                />
              </div>

              {/* Right Column: Structured Invoice Review & Edit Form (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                {/* Top Status & Confidence Bar */}
                <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div
                      className={`px-2.5 py-1 rounded border text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                        currentInvoice.confidence_level === 'High'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                          : currentInvoice.confidence_level === 'Medium'
                          ? 'bg-amber-50 text-amber-700 border-amber-200/50'
                          : 'bg-rose-50 text-rose-700 border-rose-200/50'
                      }`}
                    >
                      <Sparkles className="w-3 h-3" />
                      {Math.round(currentInvoice.overall_confidence * 100)}% {currentInvoice.confidence_level} Confidence
                    </div>
                    <span className="text-xs text-slate-500 font-mono">
                      Engine: {currentInvoice.ai_model || 'Document AI'} ({currentInvoice.latency_ms || 50}ms)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleInvoiceChange(currentInvoice.id, 'is_reviewed', !currentInvoice.is_reviewed)
                      }
                      className={`px-3 py-1.5 text-xs font-bold rounded border transition flex items-center gap-1.5 ${
                        currentInvoice.is_reviewed
                          ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      {currentInvoice.is_reviewed ? 'Reviewed & Verified' : 'Mark Reviewed'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetToOriginal(currentInvoice.id)}
                      disabled={!isCurrentInvoiceModified}
                      className={`px-3 py-1.5 text-xs font-bold rounded border transition flex items-center gap-1.5 ${
                        isCurrentInvoiceModified
                          ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
                          : 'text-slate-300 bg-slate-50 border-slate-200 cursor-not-allowed'
                      }`}
                      title={isCurrentInvoiceModified ? 'Discard edits and restore the original OCR extraction' : 'No edits to reset'}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset to OCR
                    </button>
                    <button
                      type="button"
                      onClick={handleExportCurrentInvoice}
                      className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition flex items-center gap-1"
                      title="Export single invoice to Excel"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteInvoice(currentInvoice.id)}
                      className="p-1.5 text-slate-400 hover:text-red-650 rounded hover:bg-slate-100 transition"
                      title="Delete invoice"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Non-Invoice Document Rejection Gate (TC66, TC67, TC68) — hard block, no override.
                    Rendered first/topmost since it is the most fundamental reason a card can't be submitted. */}
                {isNonInvoiceDocument && currentInvoice.document_type && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-900 flex items-center gap-2 flex-wrap shadow-sm font-semibold">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="font-bold text-red-950">⛔ {DOCUMENT_TYPE_LABELS[currentInvoice.document_type]} Detected</span>
                    <span className="text-red-700 font-normal">— not a valid Tax Invoice, cannot be submitted to AP.</span>
                  </div>
                )}

                {/* Duplicate Invoice Alert (TC65) — unifies the file/queue-hash match (isDuplicateCurrentInvoice)
                    and the composite-key semantic match (Invoice No + GSTIN/Vendor + Date) into one signal.
                    No acknowledgment checkbox: the only path forward is deleting the card. */}
                {isAnyDuplicate && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-900 flex items-center gap-2 flex-wrap shadow-sm font-semibold">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="font-bold text-red-950">🔴 Duplicate Invoice Detected</span>
                    <span className="text-red-700 font-normal">
                      {semanticDuplicateMatch
                        ? `Matches Invoice #${semanticDuplicateMatch.duplicate_of_invoice} (${semanticDuplicateMatch.duplicate_date}) — Original File: ${semanticDuplicateMatch.duplicate_file_name || 'Unknown'}.`
                        : `Matches Invoice #${currentInvoice.invoice_number} already in the register or batch.`}
                    </span>
                  </div>
                )}

                {/* Mandatory Field Gatekeeping Warning (TC87) */}
                {hasMissingMandatoryFields && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-900 flex items-center gap-2 flex-wrap shadow-sm font-semibold">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="font-bold text-red-950">Missing Required:</span>
                    {missingMandatoryFields.map((f) => (
                      <span
                        key={f}
                        className="px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200/50 font-bold text-[10px] uppercase"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {/* Flagged / Missing Fields Warning Notice */}
                {currentInvoice.missing_or_unclear_fields.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-250 text-xs text-amber-800 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-amber-900">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Fields Requiring Review or Not Explicitly Detected:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {currentInvoice.missing_or_unclear_fields.map((f, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200/50 font-semibold text-[10px] uppercase"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Card 1: Invoice Header / Identification */}
                <div className="p-5 rounded-lg bg-white border border-slate-200 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      1. Invoice Header & Identification
                    </h3>
                    <span className="text-[11px] text-slate-500">Core AP Document Identifiers</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
                    {/* Invoice Number */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Invoice Number
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.invoice_number || ''}
                        onChange={(e) =>
                          handleInvoiceChange(currentInvoice.id, 'invoice_number', e.target.value)
                        }
                        placeholder="Not Available"
                        className={`w-full bg-white border ${isFieldEmpty(currentInvoice.invoice_number) ? 'border-red-500' : 'border-slate-200'} focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 outline-none font-bold`}
                      />
                    </div>

                    {/* Invoice Date */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Invoice Date
                      </label>
                      <input
                        type="date"
                        value={parseToYYYYMMDD(currentInvoice.invoice_date)}
                        onChange={(e) => {
                          const newInvDate = e.target.value;
                          handleInvoiceChange(currentInvoice.id, 'invoice_date', newInvDate);
                          if (!currentInvoice.due_date || currentInvoice.due_date === 'Not Available') {
                            const calculated = calculateDueDate(newInvDate, currentInvoice.payment_terms);
                            handleInvoiceChange(currentInvoice.id, 'due_date', calculated);
                          }
                        }}
                        className={`w-full bg-white border ${!parseToYYYYMMDD(currentInvoice.invoice_date) ? 'border-red-500' : 'border-slate-200'} focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 outline-none`}
                      />
                      {(isFutureDatedInvoice || isStaleInvoice) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {isFutureDatedInvoice && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200/50 font-bold text-[9px] uppercase">
                              ⚠ Future-dated invoice
                            </span>
                          )}
                          {isStaleInvoice && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200/50 font-bold text-[9px] uppercase">
                              ⚠ Invoice exceeds 30-day processing window
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Due Date */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Due Date
                      </label>
                      <input
                        type="date"
                        value={
                          parseToYYYYMMDD(currentInvoice.due_date) ||
                          calculateDueDate(currentInvoice.invoice_date, currentInvoice.payment_terms)
                        }
                        onChange={(e) =>
                          handleInvoiceChange(currentInvoice.id, 'due_date', e.target.value)
                        }
                        className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>

                    {/* Payment Terms */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Payment Terms
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.payment_terms || ''}
                        onChange={(e) => {
                          const newTerms = e.target.value;
                          handleInvoiceChange(currentInvoice.id, 'payment_terms', newTerms);
                          const recalculated = calculateDueDate(currentInvoice.invoice_date, newTerms);
                          handleInvoiceChange(currentInvoice.id, 'due_date', recalculated);
                        }}
                        placeholder="e.g. Net 30"
                        className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none"
                      />
                    </div>

                    {/* Currency */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Currency
                      </label>
                      <select
                        value={currentInvoice.currency}
                        onChange={(e) => {
                          const curr = e.target.value;
                          const symMap: Record<string, string> = {
                            USD: '$',
                            INR: '₹',
                            EUR: '€',
                            GBP: '£',
                            CAD: '$',
                            AUD: '$',
                            AED: 'AED ',
                          };
                          handleInvoiceChange(currentInvoice.id, 'currency', curr);
                          handleInvoiceChange(currentInvoice.id, 'currency_symbol', symMap[curr] || '₹');
                        }}
                        className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 outline-none"
                      >
                        <option value="USD">USD ($)</option>
                        <option value="INR">INR (₹)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="CAD">CAD ($)</option>
                        <option value="AUD">AUD ($)</option>
                        <option value="AED">AED</option>
                      </select>
                    </div>

                    {/* PO Number */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        PO Number <span className="text-[9px] text-slate-400 font-normal">(Extraction)</span>
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.po_number || ''}
                        onChange={(e) =>
                          handleInvoiceChange(currentInvoice.id, 'po_number', e.target.value)
                        }
                        placeholder="Not Available"
                        className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs font-mono text-blue-750 outline-none"
                      />
                    </div>

                    {/* GRN Number */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        GRN Number <span className="text-[9px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={currentInvoice.grn_number || ''}
                        onChange={(e) =>
                          handleInvoiceChange(currentInvoice.id, 'grn_number', e.target.value)
                        }
                        placeholder="Not Available"
                        className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 outline-none"
                      />
                    </div>

                    {/* Page Count */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Total Document Pages
                      </label>
                      <div className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-650">
                        {currentInvoice.page_count} Page(s)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 2: Vendor & Buyer Entities */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Vendor / Supplier Box */}
                  <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-3 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                      2. Vendor / Supplier Details
                    </h3>
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Vendor Name</label>
                        <input
                          type="text"
                          value={currentInvoice.vendor_name || ''}
                          onChange={(e) =>
                            handleInvoiceChange(currentInvoice.id, 'vendor_name', e.target.value)
                          }
                          placeholder="Not Available"
                          className={`w-full bg-white border ${isFieldEmpty(currentInvoice.vendor_name) ? 'border-red-500' : 'border-slate-200'} focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs font-semibold text-slate-900 outline-none`}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Vendor Tax / GST / VAT ID</label>
                        <input
                          type="text"
                          value={currentInvoice.vendor_tax_id || ''}
                          onChange={(e) =>
                            handleInvoiceChange(currentInvoice.id, 'vendor_tax_id', e.target.value)
                          }
                          placeholder="Not Available"
                          className={`w-full bg-white border ${isGstinInvalid ? 'border-red-500' : 'border-slate-200'} focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs font-mono text-slate-800 outline-none`}
                        />
                        {isGstinInvalid && (
                          <p className="mt-1 text-[10px] font-semibold text-red-600">
                            Invalid GSTIN format (e.g. 29ABCDE1234F1Z5)
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Vendor Address</label>
                        <textarea
                          rows={2}
                          value={currentInvoice.vendor_address || ''}
                          onChange={(e) =>
                            handleInvoiceChange(currentInvoice.id, 'vendor_address', e.target.value)
                          }
                          placeholder="Vendor physical / registered address"
                          className="w-full bg-white border border-slate-200 focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-slate-700 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Buyer / Client Box */}
                  <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-3 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                      3. Client / Buyer Details
                    </h3>
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Client / Customer Name</label>
                        <input
                          type="text"
                          value={currentInvoice.client_name || ''}
                          onChange={(e) =>
                            handleInvoiceChange(currentInvoice.id, 'client_name', e.target.value)
                          }
                          placeholder="PKC Management Consulting"
                          className="w-full bg-white border border-slate-200 focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs font-semibold text-slate-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Client Tax / GST ID</label>
                        <input
                          type="text"
                          value={currentInvoice.client_tax_id || ''}
                          onChange={(e) =>
                            handleInvoiceChange(currentInvoice.id, 'client_tax_id', e.target.value)
                          }
                          placeholder="Client Tax ID"
                          className="w-full bg-white border border-slate-200 focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs font-mono text-slate-800 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Billing Address</label>
                        <textarea
                          rows={2}
                          value={currentInvoice.client_address || ''}
                          onChange={(e) =>
                            handleInvoiceChange(currentInvoice.id, 'client_address', e.target.value)
                          }
                          placeholder="Client billing address"
                          className="w-full bg-white border border-slate-200 focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-slate-700 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 3: Line Items Editor */}
                <div className="p-5 rounded-lg bg-white border border-slate-200 shadow-sm">
                  <LineItemsEditor
                    items={currentInvoice.line_items ?? []}
                    currencySymbol={currentInvoice.currency_symbol}
                    onChange={(updated) => handleLineItemsChange(currentInvoice.id, updated)}
                  />
                </div>

                {/* Card 4: Financial Summary & Reconciliation */}
                <div className="p-5 rounded-lg bg-white border border-slate-200 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      4. Financial Summary & Totals
                    </h3>
                    <span className="text-[11px] text-slate-500">Payable amount breakdown</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
                    {/* Subtotal */}
                    <MoneyInput
                      label="Subtotal"
                      value={currentInvoice.subtotal}
                      currencySymbol={currentInvoice.currency_symbol}
                      onChange={(val) => handleInvoiceChange(currentInvoice.id, 'subtotal', val)}
                    />

                    {/* Tax Amount */}
                    <MoneyInput
                      label="Tax Amount"
                      value={currentInvoice.tax_amount}
                      currencySymbol={currentInvoice.currency_symbol}
                      onChange={(val) => handleInvoiceChange(currentInvoice.id, 'tax_amount', val)}
                    />

                    {/* Discount */}
                    <MoneyInput
                      label="Discount"
                      value={currentInvoice.discount_amount}
                      currencySymbol={currentInvoice.currency_symbol}
                      onChange={(val) => handleInvoiceChange(currentInvoice.id, 'discount_amount', val)}
                      inputColorClass="text-amber-700 font-semibold"
                    />

                    {/* Additional Charges */}
                    <MoneyInput
                      label="Addl Charges"
                      value={currentInvoice.additional_charges}
                      currencySymbol={currentInvoice.currency_symbol}
                      onChange={(val) => handleInvoiceChange(currentInvoice.id, 'additional_charges', val)}
                    />

                    {/* Total Amount / Grand Total */}
                    <MoneyInput
                      label="Grand Total"
                      value={currentInvoice.total_amount}
                      currencySymbol={currentInvoice.currency_symbol}
                      onChange={(val) => handleInvoiceChange(currentInvoice.id, 'total_amount', val)}
                      isGrandTotal={true}
                      labelColorClass="text-blue-700 font-bold"
                      alertState={hasFinancialDiscrepancy || missingMandatoryFields.includes('Grand Total')}
                    />
                  </div>

                  {/* Reconciliation Banner */}
                  <div
                    className={`p-3 rounded-lg border flex items-center justify-between gap-3 text-xs ${
                      !isReconciliationMismatch
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {!isReconciliationMismatch ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-650 shrink-0" />
                          <span className="font-semibold">
                            Total matches line items sum. Ready to save.
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="font-semibold">
                            Grand Total ({currentInvoice.currency_symbol}{(currentInvoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) differs from Line Items + Charges ({currentInvoice.currency_symbol}{currentExpectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).
                          </span>
                        </>
                      )}
                    </div>

                    {isReconciliationMismatch && (
                      <button
                        type="button"
                        onClick={() => handleRecalculateGrandTotal(currentInvoice.id)}
                        className="px-2.5 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded transition shrink-0"
                      >
                        Reconcile Total
                      </button>
                    )}
                  </div>

                  {/* Financial Reconciliation Gatekeeping (TC74, TC73) */}
                  {hasFinancialDiscrepancy && (
                    <div className="p-3 rounded-lg border bg-red-50 border-red-300 text-red-900 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>
                          Arithmetic discrepancy of {currentInvoice.currency_symbol}
                          {financialDiscrepancy.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} between
                          (Subtotal + Tax + Addl Charges − Discount) and Grand Total exceeds the {currentInvoice.currency_symbol}1.00 tolerance.
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isDiscrepancyOverridden}
                          onChange={(e) =>
                            setDiscrepancyOverrideMap((prev) => ({ ...prev, [currentInvoice.id]: e.target.checked }))
                          }
                          className="rounded border-red-400 text-red-600 accent-red-600 cursor-pointer"
                        />
                        Confirm submission with unreconciled arithmetic discrepancy
                      </label>
                    </div>
                  )}
                </div>

                {/* Extraction Notes */}
                {currentInvoice.extraction_notes && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 space-y-1">
                    <div className="text-[10px] font-bold text-slate-655 uppercase tracking-wider">
                      OCR Model Notes:
                    </div>
                    <p>{currentInvoice.extraction_notes}</p>
                  </div>
                )}

                {/* Submit & Sync Actions — a duplicate or non-invoice card gets a one-click
                    Delete/Dismiss action instead of a disabled Submit button; no multi-step
                    override to read or confirm. */}
                <div className="flex gap-2.5 pt-4 border-t border-slate-200 mt-4">
                  {isNonInvoiceDocument ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteInvoice(currentInvoice.id)}
                      className="flex-1 py-2.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 shadow-sm bg-red-600 hover:bg-red-700 text-white"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Dismiss / Delete</span>
                    </button>
                  ) : isAnyDuplicate ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteInvoice(currentInvoice.id)}
                      className="flex-1 py-2.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 shadow-sm bg-red-600 hover:bg-red-700 text-white"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Invoice</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmitSingleInvoice}
                      disabled={isSubmitBlocked}
                      className={`flex-1 py-2.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 shadow-sm ${
                        isSubmitBlocked
                          ? 'bg-red-100 text-red-700 border border-red-300 cursor-not-allowed shadow-none'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {hasMissingMandatoryFields ? (
                        <>
                          <AlertCircle className="w-4 h-4 text-red-600" />
                          <span>Missing Required Fields</span>
                        </>
                      ) : blocksOnDiscrepancy ? (
                        <>
                          <AlertCircle className="w-4 h-4 text-red-600" />
                          <span>Confirm Discrepancy Override to Submit</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Submit for Approval (Push to GSheet)</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        showToast("Generating Tally purchase voucher export...");
                        await api.exportToTallyExcel([currentInvoice]);
                        showToast("Tally Excel downloaded!");
                      } catch (err: any) {
                        showToast(`Export failed: ${getFriendlyErrorMessage(err, 'export')}`);
                      }
                    }}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 bg-white border border-slate-350 rounded-md transition flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-605" />
                    Tally Export
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Batch Table View Mode */}
      {invoices.length > 0 && viewMode === 'batch_table' && (
        <div className="space-y-4">
          {/* Filter / Search Bar */}
          <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-450 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by invoice #, vendor, or file name..."
                  className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none"
                />
              </div>

              <select
                value={confidenceFilter}
                onChange={(e) => setConfidenceFilter(e.target.value)}
                className="bg-white border border-slate-200 focus:border-blue-600 rounded-lg px-3 py-1.5 text-xs text-slate-700 outline-none"
              >
                <option value="all">All Confidence</option>
                <option value="high">High Confidence Only</option>
                <option value="medium">Medium Confidence</option>
                <option value="low">Needs Review / Low</option>
              </select>
            </div>

            {/* Batch Action Toolbar */}
            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportSelectedExcel}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition flex items-center gap-1.5 shadow-sm"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  Export {selectedIds.length} Selected (.xlsx)
                </button>
              )}
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-350 rounded-md transition flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-cyan-600" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Master Batch Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredInvoices.length && filteredInvoices.length > 0}
                      onChange={handleToggleSelectAll}
                      className="rounded border-slate-300 text-blue-600 accent-blue-650 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3">File Name</th>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Vendor</th>
                  <th className="py-2.5 px-3">Buyer / Client</th>
                  <th className="py-2.5 px-3">PO #</th>
                  <th className="py-2.5 px-3 text-center">Items</th>
                  <th className="py-2.5 px-3 text-right">Total Amount</th>
                  <th className="py-2.5 px-3 text-center">Confidence</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-slate-400">
                      No invoices found matching current filter.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={`hover:bg-slate-50 transition ${
                        selectedIds.includes(inv.id) ? 'bg-slate-50/50' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(inv.id)}
                          onChange={() => handleToggleSelectId(inv.id)}
                          className="rounded border-slate-300 text-blue-605 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[150px]" title={inv.file_name}>
                            {inv.file_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {inv.invoice_number || <span className="text-slate-400 italic">Not Available</span>}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {inv.invoice_date || <span className="text-slate-400 italic">Not Available</span>}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {inv.vendor_name || <span className="text-slate-400 italic">Not Available</span>}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {inv.client_name || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {inv.po_number || <span className="text-slate-400">Not Available</span>}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        {inv.line_items?.length ?? 0}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 text-sm">
                        {inv.currency_symbol}{(inv.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                            inv.confidence_level === 'High'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-250/50'
                              : inv.confidence_level === 'Medium'
                              ? 'bg-amber-50 text-amber-700 border-amber-250/50'
                              : 'bg-rose-50 text-rose-700 border-rose-250/50'
                          }`}
                        >
                          {inv.confidence_level}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            inv.is_reviewed
                              ? 'bg-emerald-55 text-emerald-800 border border-emerald-200/50'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          {inv.is_reviewed ? 'Reviewed' : 'Pending'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedInvoiceId(inv.id);
                              setViewMode('split');
                            }}
                            className="p-1 text-slate-400 hover:text-slate-800 rounded hover:bg-slate-100 transition"
                            title="Inspect in Split Reviewer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => api.exportSingleInvoice(inv)}
                            className="p-1 text-slate-400 hover:text-blue-650 rounded hover:bg-slate-100 transition"
                            title="Export single invoice to Excel"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteInvoice(inv.id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 transition"
                            title="Delete invoice"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Bottom Export Bar when Invoices Exist */}
      {invoices.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white/95 border border-slate-200 rounded-lg shadow-xl px-5 py-3 flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
            <span className="font-bold text-slate-900">{invoices.length} Invoices</span>
            <span className="text-slate-500 font-mono">
              ({currentInvoice?.currency_symbol || '₹'}{totalAmountSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {invoices.filter((i) => i.is_reviewed).length > 0 && (
              <button
                type="button"
                onClick={handleSubmitAllReviewed}
                className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition flex items-center gap-1.5 shadow-sm"
                title="Submit all reviewed invoices to Google Sheets and remove from queue"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-100" />
                Push {invoices.filter((i) => i.is_reviewed).length} Reviewed to GSheet
              </button>
            )}
            <button
              type="button"
              onClick={handleExportAllExcel}
              className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition flex items-center gap-1.5 shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4 text-blue-400" />
              Export All Excel
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 bg-white border border-slate-350 rounded-md transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-cyan-600" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear all invoices from current batch?')) {
                  setInvoices([]);
                  setSelectedIds([]);
                  setSelectedInvoiceId(null);
                  showToast('Batch cleared');
                }
              }}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-red-650 bg-transparent rounded-lg transition"
            >
              Clear Batch
            </button>
          </div>
        </div>
      )}

      {/* AI Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onConfigSaved={(conf) => {
          setAiConfig(conf);
          showToast(`Vision AI Provider set to ${conf.provider.toUpperCase()}`);
        }}
      />
    </div>
  );
};
