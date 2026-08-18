import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type StatCardProps = {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  onClick?: () => void;
};

export function StatCard({ label, value, sub, icon: Icon, tone = "neutral", onClick }: StatCardProps) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-100 text-ink-600",
    brand: "bg-brand-50 text-brand-600",
    success: "bg-success-50 text-success-600",
    warning: "bg-warning-50 text-warning-600",
    danger: "bg-danger-50 text-danger-600",
  };
  const clickable = !!onClick;
  return (
    <div
      className={`card p-5 transition-shadow hover:shadow-cardHover ${clickable ? "cursor-pointer hover:border-brand-300" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink-500">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-ink-900 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-400">{sub}</p>}
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EmptyState({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-medium text-ink-700">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Laden"
    />
  );
}

export function PageHeader({ title, subtitle, action, onBack }: { title: string; subtitle?: string; action?: ReactNode; onBack?: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 hover:bg-ink-50 hover:text-ink-800 transition-colors flex-shrink-0"
            aria-label="Terug naar overzicht"
            title="Terug"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

// ===== CSV / text file viewer =====
// Renders CSV content as a scrollable table. Falls back to raw text for non-CSV.
export function CsvViewer({ url, fileName }: { url: string; fileName?: string }) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(url)
      .then((r) => r.text())
      .then((text) => setContent(text))
      .catch(() => setError("Bestand kon niet worden ingelezen."))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return <div className="flex w-full justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>;
  if (error) return <div className="flex w-full justify-center py-12"><EmptyState icon={FileText} title={error} /></div>;

  const isCsv = (fileName ?? "").toLowerCase().endsWith(".csv") || content.includes(";") || content.includes(",");

  if (!isCsv) {
    return (
      <div className="w-full p-4">
        <pre className="text-sm text-ink-700 whitespace-pre-wrap font-mono bg-white rounded-lg border border-ink-200 p-4 overflow-auto max-h-[60vh]">{content}</pre>
      </div>
    );
  }

  // Parse CSV — handles quoted fields, semicolons (Dutch) and commas
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return <div className="flex w-full justify-center py-12"><EmptyState icon={FileText} title="Bestand is leeg" /></div>;

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = false;
        } else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ";" || ch === ",") { result.push(current); current = ""; }
        else current += ch;
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  const maxCols = Math.max(headers.length, ...rows.map((r) => r.length));

  return (
    <div className="w-full p-4">
      <div className="text-xs text-ink-400 mb-2">{rows.length} rijen · {maxCols} kolommen</div>
      <div className="overflow-auto max-h-[60vh] rounded-lg border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-ink-50 border-b border-ink-200">
              <th className="px-2 py-2 text-left text-xs font-medium text-ink-400 tabular-nums w-10">#</th>
              {Array.from({ length: maxCols }).map((_, ci) => (
                <th key={ci} className="px-3 py-2 text-left text-xs font-semibold text-ink-700 whitespace-nowrap border-l border-ink-100">
                  {headers[ci] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-ink-50/50">
                <td className="px-2 py-1.5 text-xs text-ink-400 tabular-nums">{ri + 1}</td>
                {Array.from({ length: maxCols }).map((_, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-ink-700 whitespace-nowrap border-l border-ink-100">
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
