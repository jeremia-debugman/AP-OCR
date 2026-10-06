import React, { useState, useEffect } from 'react';
import { InvoiceExtractionView } from './views/InvoiceExtractionView';
import { GSheetView } from './views/GSheetView';
import { Toast } from './components/Toast';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  FileText, Database, Settings, CheckCircle2,
  HelpCircle, BarChart3, Receipt, Landmark, RefreshCw, FileText as TaxIcon, History, WifiOff
} from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'ocr' | 'gsheet'>('ocr');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [logoFailed, setLogoFailed] = useState<boolean>(false);

  // Check backend health on mount
  useEffect(() => {
    let failureCount = 0;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch('/api/health', { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          failureCount = 0;
          setBackendOffline(false);
        } else {
          failureCount++;
          if (failureCount >= 2) setBackendOffline(true);
        }
      } catch {
        failureCount++;
        if (failureCount >= 2) setBackendOffline(true);
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    // Error toasts are pinned; success toasts auto-dismiss via Toast component
  };

  const dismissToast = () => setToastMessage(null);

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-[#0F172A] font-sans overflow-hidden selection:bg-blue-500/20 selection:text-blue-700">
      
      {/* 1. Left Sidebar Navigation */}
      <aside className="w-[240px] flex-shrink-0 bg-white border-r border-[#E2E8F0] flex flex-col h-full select-none">
        
        {/* Brand Header */}
        <div className="px-4 py-4 border-b border-[#E2E8F0] flex items-center gap-2.5 relative">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#0A2558] via-[#D4AF37] to-[#0A2558]" />
          {!logoFailed ? (
            <img
              src="/pkc-logo.png"
              alt="PKC Management Consulting"
              className="w-9 h-9 object-contain shrink-0"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="w-9 h-9 rounded-md bg-[#0A2558] text-[#D4AF37] flex items-center justify-center font-bold text-[11px] tracking-wide shrink-0 border border-[#D4AF37]/50 shadow-sm">
              PKC
            </div>
          )}
          <div className="text-left min-w-0">
            <div className="text-[13px] font-bold text-[#0A2558] tracking-wide leading-tight truncate">
              PKC Management Consulting
            </div>
            <div className="text-[10px] text-slate-450 font-semibold uppercase tracking-wider">
              Accounts Payable ERP
            </div>
          </div>
        </div>

        {/* Navigation Section */}
        <div className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
          {/* Main items */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">
              Operations
            </div>
            <button
              onClick={() => setActiveTab('ocr')}
              className={`w-full flex items-center gap-2.5 pl-2 pr-2.5 py-2 rounded-md text-[12.5px] font-semibold transition border-l-2 ${
                activeTab === 'ocr'
                  ? 'bg-[#0A2558]/[0.06] text-[#0A2558] border-l-[#D4AF37]'
                  : 'text-slate-600 border-l-transparent hover:text-[#0A2558] hover:bg-slate-50'
              }`}
            >
              <FileText className={`w-4 h-4 ${activeTab === 'ocr' ? 'text-[#0A2558]' : 'text-slate-400'}`} />
              <span>Invoices / AP Queue</span>
            </button>

            <button
              onClick={() => setActiveTab('gsheet')}
              className={`w-full flex items-center gap-2.5 pl-2 pr-2.5 py-2 rounded-md text-[12.5px] font-semibold transition border-l-2 ${
                activeTab === 'gsheet'
                  ? 'bg-[#0A2558]/[0.06] text-[#0A2558] border-l-[#D4AF37]'
                  : 'text-slate-600 border-l-transparent hover:text-[#0A2558] hover:bg-slate-50'
              }`}
            >
              <Database className={`w-4 h-4 ${activeTab === 'gsheet' ? 'text-[#0A2558]' : 'text-slate-400'}`} />
              <span>Google Sheet DB</span>
            </button>
          </div>

          {/* Placeholder items */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">
              Financials
            </div>
            
            <div className="flex items-center gap-2.5 px-2.5 py-2 text-[12.5px] text-slate-400 cursor-not-allowed select-none opacity-60">
              <Landmark className="w-4 h-4 text-slate-300" />
              <span>Bank Feeds & Recon</span>
            </div>

            <div className="flex items-center gap-2.5 px-2.5 py-2 text-[12.5px] text-slate-400 cursor-not-allowed select-none opacity-60">
              <RefreshCw className="w-4 h-4 text-slate-300" />
              <span>Ledger Sync (Tally)</span>
            </div>

            <div className="flex items-center gap-2.5 px-2.5 py-2 text-[12.5px] text-slate-400 cursor-not-allowed select-none opacity-60">
              <TaxIcon className="w-4 h-4 text-slate-300" />
              <span>GST Input Credit Match</span>
            </div>

            <div className="flex items-center gap-2.5 px-2.5 py-2 text-[12.5px] text-slate-400 cursor-not-allowed select-none opacity-60">
              <History className="w-4 h-4 text-slate-300" />
              <span>Audit Logs</span>
            </div>
          </div>
        </div>

      </aside>

        {/* 2. Main Work Area Container */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          
          {/* Minimalist Top Header Bar */}
          <header className="h-[56px] border-b border-[#E2E8F0] bg-white px-6 flex items-center justify-between flex-shrink-0 select-none">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-bold text-[#0A2558]">
                PKC Management Consulting
              </span>
              <span className="text-[#D4AF37] font-bold">—</span>
              <span className="text-[12.5px] font-semibold text-slate-500">
                AP Automation
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                title="Help & Documentation"
                className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-[#0A2558] hover:border-[#0A2558]/30 hover:bg-slate-50 transition"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          {/* Backend offline banner */}
          {backendOffline && (
            <div className="flex items-center gap-2.5 px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-[12px] font-semibold">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>Backend server is offline or unreachable. Upload and extraction are unavailable until it reconnects.</span>
            </div>
          )}

          {/* Scrollable Work View */}
          <main className="flex-1 overflow-y-auto bg-[#F8FAFC]">
            {activeTab === 'ocr' ? (
              <ErrorBoundary fallbackLabel="Invoice Extraction crashed unexpectedly.">
                <InvoiceExtractionView showToast={showToast} />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary fallbackLabel="Google Sheet DB view crashed unexpectedly.">
                <GSheetView showToast={showToast} />
              </ErrorBoundary>
            )}
          </main>
        </div>

      {/* AI Settings Dialog */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onConfigSaved={(conf) => {
          showToast(`Vision AI Provider updated to ${conf.provider.toUpperCase()}`);
        }}
      />

      {/* Toast notifications */}
      <Toast message={toastMessage} onDismiss={dismissToast} />
    </div>
  );
};
