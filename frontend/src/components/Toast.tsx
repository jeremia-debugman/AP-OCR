import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';

interface ToastProps {
  message: string | null;
  onDismiss?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  const isError = message
    ? /error|fail|timeout|unavailable|crash|invalid|unsupported|too large/i.test(message)
    : false;

  useEffect(() => {
    if (message) {
      setVisible(true);
      // Auto-dismiss only success messages after 3.5s; errors stay pinned
      if (!isError) {
        const t = setTimeout(() => {
          setVisible(false);
          onDismiss?.();
        }, 3500);
        return () => clearTimeout(t);
      }
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!message || !visible) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.18)] text-[12.5px] font-semibold animate-fade-in transition-all
        ${isError
          ? 'bg-red-600 text-white min-w-[280px] max-w-[480px]'
          : 'bg-[#1F2937] text-white'
        }`}
    >
      {isError
        ? <AlertTriangle className="w-4 h-4 shrink-0" />
        : <CheckCircle2 className="w-4 h-4 shrink-0 text-green-400" />
      }
      <span className="flex-1">{message}</span>
      {isError && (
        <button
          onClick={() => { setVisible(false); onDismiss?.(); }}
          className="ml-1 hover:opacity-70 transition"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
