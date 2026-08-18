import type { ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  open?: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "4xl";
  footer?: ReactNode;
};

export function Modal({ open = true, onClose, title, children, size = "md", footer }: ModalProps) {
  if (!open) return null;
  const sizeClass = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    "4xl": "max-w-5xl",
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${sizeClass} card max-h-[90vh] flex flex-col animate-slide-up`}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="border-t border-ink-100 px-5 py-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
