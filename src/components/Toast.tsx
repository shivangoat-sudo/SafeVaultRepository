import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

type Toast = {
  id: string;
  kind: "success" | "error" | "info" | "warning";
  message: string;
};

type ToastContextValue = {
  push: (kind: Toast["kind"], message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  const remove = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-ink-200 bg-white px-4 py-3 shadow-cardHover animate-slide-up"
          >
            {t.kind === "success" && <CheckCircle2 className="h-5 w-5 text-success-600 flex-shrink-0 mt-0.5" />}
            {t.kind === "error" && <AlertCircle className="h-5 w-5 text-danger-600 flex-shrink-0 mt-0.5" />}
            {t.kind === "info" && <Info className="h-5 w-5 text-brand-600 flex-shrink-0 mt-0.5" />}
            {t.kind === "warning" && <AlertTriangle className="h-5 w-5 text-warning-600 flex-shrink-0 mt-0.5" />}
            <p className="text-sm text-ink-800 flex-1">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-ink-400 hover:text-ink-600 flex-shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
