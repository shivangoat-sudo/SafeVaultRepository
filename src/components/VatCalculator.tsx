import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { EmptyState, Spinner } from "@/components/ui";
import { parseCsvToRawTransactions } from "@/utils/vatCalculator";
import { calculateVatReport, tweeKolommenWeergave, berekenBetrouwbaarheidsscore, BOEKHOUDER_PERCENTAGE_OPTIES, type VatReport, type RawTransaction, type BtwPercentage, type BoekhouderBeoordeling } from "@/lib/btwEngineSafe";
import { Calculator, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp, ArrowDownUp, FileSpreadsheet, UserCheck } from "lucide-react";
import type { FileRow } from "@/types";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
const eur = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

export function VatCalculator({ customerId }: { customerId: string }) {
  const { push } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState<string>("Q1");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [report, setReport] = useState<VatReport | null>(null);
  const [rawTransactions, setRawTransactions] = useState<RawTransaction[]>([]);
  const [overrides, setOverrides] = useState<Record<string, BoekhouderBeoordeling>>({});
  const [reviewer, setReviewer] = useState("");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try { setFiles((await api.dossierUploads(customerId)).files); }
    catch { push("error", "Uploads konden niet worden geladen."); }
    finally { setLoading(false); }
  }, [customerId, push]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const matchingFiles = useMemo(() => files.filter(f => f.category === "income_overview" && (!f.quarter || String(f.quarter).toUpperCase() === quarter) && (!f.year || f.year === year) && (/\.(csv|txt)$/i.test(f.original_name))), [files, quarter, year]);

  const runCalculation = async (file: File, nextOverrides = overrides) => {
    setCalculating(true);
    try {
      const rows = parseCsvToRawTransactions(await file.text());
      if (!rows.length) throw new Error("Geen transacties uit het CSV-bestand kunnen worden gelezen.");
      setRawTransactions(rows);
      setReport(calculateVatReport(rows, { percentageOverrides: nextOverrides }));
    } catch (e) { push("error", e instanceof Error ? e.message : "BTW-berekening mislukt."); }
    finally { setCalculating(false); }
  };

  const selectAndCalculate = async () => {
    if (!matchingFiles.length) { push("error", `Geen bestand gevonden voor ${quarter} ${year}.`); return; }
    try {
      const f = matchingFiles[0];
      const view = await api.userFileView(f.id);
      const response = await fetch(view.url);
      if (!response.ok) throw new Error("Bestand kon niet worden opgehaald.");
      await runCalculation(new File([await response.blob()], f.original_name, { type: f.mime_type || "text/csv" }));
    } catch (e) { push("error", e instanceof Error ? e.message : "Bestand kon niet worden opgehaald."); }
  };

  const applyReview = (id: string, percentage: BtwPercentage) => {
    const name = reviewer.trim();
    if (!name) { push("error", "Vul eerst de naam van de boekhouder in."); return; }
    const nextOverrides = { ...overrides, [id]: { percentage, beoordeeld_door: name } };
    setOverrides(nextOverrides);
    if (report) setReport(calculateVatReport(rawTransactions, { percentageOverrides: nextOverrides }));
  };

  const columns = report ? tweeKolommenWeergave(report) : { zeker: [], twijfelgevallen: [] };
  const o = report?.overzicht;
  const explanation = o ? `${eur(o.verschuldigd.totaal)} verschuldigde BTW\n− ${eur(o.aftrekbaar.totaal)} aftrekbare voorbelasting\n= ${o.status === "af_te_dragen" ? eur(o.netto_btw) + " af te dragen" : "−" + eur(Math.abs(o.netto_btw)) + " terug te vorderen"}` : "";

  return <div className="space-y-4">
    <div className="card p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-sm font-semibold">BTW-calculator</h3><p className="text-xs text-ink-400">Berekening loopt uitsluitend via de veilige BTW-safety boundary.</p></div><div className="flex gap-3"><select value={quarter} onChange={e => setQuarter(e.target.value)} className="input w-24">{QUARTERS.map(q => <option key={q}>{q}</option>)}</select><input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="input w-24" /><button onClick={selectAndCalculate} disabled={calculating || !matchingFiles.length} className="btn-primary">{calculating ? <Spinner /> : <Calculator className="h-4 w-4" />} Berekenen</button></div></div></div>
    {loading && <div className="card p-8 flex justify-center"><Spinner /></div>}
    {!loading && !matchingFiles.length && <div className="card"><EmptyState icon={FileSpreadsheet} title={`Geen bankoverzicht voor ${quarter} ${year}`} subtitle="Upload een CSV/TXT bankoverzicht voor deze periode." /></div>}
    {report && o && <div className="space-y-4">
      {!report.audit.ok && <div className="card p-4 border-danger-200 bg-danger-50"><div className="flex items-center gap-2 font-bold text-danger-800"><AlertTriangle className="h-4 w-4" /> Audit controle mislukt</div><ul className="mt-2 list-disc pl-5 text-xs">{report.audit.problemen.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      <div className="card p-6"><div className="flex flex-wrap justify-between gap-3 mb-5"><div><h3 className="font-semibold">BTW-overzicht — {quarter} {year}</h3><p className="text-xs text-ink-500">{report.audit.trusted_count} financieel geaccepteerd · {report.audit.unresolved_count} twijfelgevallen · {report.audit.ignored_count} genegeerd</p></div><div className="text-xs font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Betrouwbaarheid: {berekenBetrouwbaarheidsscore(report).toFixed(1)}%</div></div>
        <div className="grid md:grid-cols-2 gap-5"><div className="rounded-xl border p-5"><h4 className="font-bold text-sm flex gap-2 items-center"><TrendingUp className="h-4 w-4" /> BTW over inkomsten (verschuldigd)</h4><div className="mt-4 space-y-2 text-xs"><div className="flex justify-between"><span>21%</span><b>{eur(o.verschuldigd.inkomsten_21)}</b></div><div className="flex justify-between"><span>9%</span><b>{eur(o.verschuldigd.inkomsten_9)}</b></div><div className="flex justify-between"><span>Verlegd</span><b>{eur(o.verschuldigd.verlegde_btw)}</b></div></div><div className="mt-4 border-t pt-3 flex justify-between font-bold"><span>Totaal verschuldigd</span><span>{eur(o.verschuldigd.totaal)}</span></div></div><div className="rounded-xl border p-5"><h4 className="font-bold text-sm flex gap-2 items-center"><TrendingDown className="h-4 w-4" /> BTW over uitgaven (aftrekbaar)</h4><div className="mt-4 space-y-2 text-xs"><div className="flex justify-between"><span>21%</span><b>{eur(o.aftrekbaar.uitgaven_21)}</b></div><div className="flex justify-between"><span>9%</span><b>{eur(o.aftrekbaar.uitgaven_9)}</b></div><div className="flex justify-between"><span>Verlegd</span><b>{eur(o.aftrekbaar.verlegde_btw)}</b></div></div><div className="mt-4 border-t pt-3 flex justify-between font-bold"><span>Totaal aftrekbare voorbelasting</span><span>{eur(o.aftrekbaar.totaal)}</span></div></div></div>
        <div className="mt-5 rounded-xl border p-5"><div className="flex justify-between items-center"><div className="flex gap-2 items-center"><ArrowDownUp className="h-5 w-5" /><div><div className="text-xs font-bold uppercase">{o.status === "af_te_dragen" ? "Af te dragen" : "Terug te vorderen"}</div><div className="font-bold">{o.status === "af_te_dragen" ? "Af te dragen aan Belastingdienst" : "Terug te vorderen van Belastingdienst"}</div></div></div><div className="text-2xl font-extrabold">{eur(Math.abs(o.netto_btw))}</div></div><pre className="mt-4 rounded-lg bg-ink-50 p-4 text-xs whitespace-pre-wrap">{explanation}</pre></div>
      </div>
      {columns.twijfelgevallen.length > 0 && <div className="card overflow-hidden border-warning-200"><div className="p-4 bg-warning-50"><h3 className="font-semibold flex gap-2"><AlertTriangle className="h-4 w-4" /> Twijfelgevallen ({columns.twijfelgevallen.length})</h3><p className="text-xs mt-1">Niet financieel meegenomen. Een boekhouder moet het tarief expliciet bevestigen.</p><div className="mt-3 flex items-center gap-2"><UserCheck className="h-4 w-4" /><input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Naam boekhouder" className="input max-w-xs" /></div></div><div className="overflow-x-auto"><table className="w-full text-xs"><tbody>{columns.twijfelgevallen.map(row => <tr key={row.transactie_id} className="border-t"><td className="p-3">{row.omschrijving}</td><td className="p-3 text-right">{row.bedrag}</td><td className="p-3">{row.toegepaste_regel}</td><td className="p-3">{BOEKHOUDER_PERCENTAGE_OPTIES.map(opt => <button key={opt.percentage} onClick={() => applyReview(row.transactie_id, opt.percentage)} className="btn-secondary mr-1">{opt.label}</button>)}</td></tr>)}</tbody></table></div></div>}
      <div className="card overflow-hidden"><div className="p-4 bg-ink-50"><h3 className="font-semibold">Zeker ({columns.zeker.length})</h3></div><div className="overflow-x-auto"><table className="w-full text-xs"><tbody>{columns.zeker.map(row => <tr key={row.transactie_id} className="border-t"><td className="p-3">{row.omschrijving}</td><td className="p-3">{row.type}</td><td className="p-3">{row.btw}</td><td className="p-3">{row.bedrag}</td><td className="p-3">{row.toegepaste_regel}</td></tr>)}</tbody></table></div></div>
    </div>}
  </div>;
}
