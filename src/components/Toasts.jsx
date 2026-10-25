import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);

const TONE_BORDER = {
  info: 'border-l-info',
  success: 'border-l-ok',
  warning: 'border-l-warn',
  error: 'border-l-err',
};

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 7000);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 border border-l-2 border-line bg-surface px-3 py-2.5 ${TONE_BORDER[toast.tone] ?? TONE_BORDER.info}`}
    >
      <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-[4px] text-ink-2 transition-colors duration-150 hover:bg-black/[0.04] hover:text-ink"
        aria-label="Dismiss notification"
      >
        <X size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message, tone = 'info') => {
    const id = ++counter.current;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:right-6 sm:w-[360px]"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
