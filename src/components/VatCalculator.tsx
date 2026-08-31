import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { EmptyState, Spinner } from "@/components/ui";
import { parseCsvToRawTransactions } from "@/utils/vatCsvParser";
import { calculateFiscalVatReport, tweeKolommenWeergave, berekenBetrouwbaarheidsscore, BOEKHOUDER_PERCENTAGE_OPTIES, type FiscalReport, type BtwPercentage, type BoekhouderBeoordeling } from "@/lib/btwFiscalSafeNormalized";
import type { RawTransaction } from "@/lib/btwEngineSafe";
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
  const [report, setReport] = useState<FiscalReport | null>(null);
  const [rawTransactions, setRawTransactions] = useState<RawTransaction[]>([]);
  const [overrides, setOverrides] = useState<Record<string, BoekhouderBeoordeling>>({});
  const [reviewer, setReviewer] = useState("");

  const loadFiles = useCallback(async () => { setLoading(true); try { setFiles((await api.dossierUploads(customerId)).files); } catch { push("error", "Uploads konden niet worden geladen."); } finally { setLoading(false); } }, [customerId, push]);
  useEffect(() => { loadFiles(); }, [loadFiles]);
  const matchingFiles = useMemo(() => files.filter(f => f.category === "income_overview" && (!f.quarter || String(f.quarter).toUpperCase() === quarter) && (!f.year || f.year === year) && (/\.(csv|txt)$/i.test(f.original_name))), [files, quarter, year]);

  const runCalculation = async (file: File, nextOverrides = overrides) => {
    setCalculating(true);
    try { const rows = parseCsvToRawTransactions(await file.text()); if (!rows.length) throw new Error("Geen transacties uit het CSV-bestand kunnen worden gelezen."); setRawTransactions(rows); setReport(calculateFiscalVatReport(rows, nextOverrides)); }
    catch (e) { push("error", e instanceof Error ? e.message : "BTW-berekening mislukt."); } finally { setCalculating(false); }
  };
  const selectAndCalculate = async () => { if (!matchingFiles.length) { push("error", `Geen bestand gevonden voor ${quarter} ${year}.`); return; } try { const f=matchingFiles[0]; const view=await api.userFileView(f.id); const response=await fetch(view.url); if(!response.ok) throw new Error("Bestand kon niet worden opgehaald."); await runCalculation(new File([await response.blob()], f.original_name, { type:f.mime_type || "text/csv" })); } catch(e) { push("error", e instanceof Error ? e.message : "Bestand kon niet worden opgehaald."); } };
  const applyReview = (id: string, percentage: BtwPercentage) => { const name=reviewer.trim(); if(!name){push("error","Vul eerst de naam van de boekhouder in.");return;} const next={...overrides,[id]:{percentage,beoordeeld_door:name}}; setOverrides(next); if(report) setReport(calculateFiscalVatReport(rawTransactions,next)); };
  const columns = report ? tweeKolommenWeergave(report) : { zeker: [], twijfelgevallen: [] };

  return <div className="space-y-4">
    <div className="card p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-sm font-semibold">BTW-calculator</h3><p className="text-xs text-ink-400">Nederlandse btw-classificatie met expliciete aangifterubrieken en audit.</p></div><div className="flex gap-3"><select value={quarter} onChange={e=>setQuarter(e.target.value)} className="input w-24">{QUARTERS.map(q=><option key={q}>{q}</option>)}</select><input type="number" value={year} onChange={e=>setYear(Number(e.target.value))} className="input w-24"/><button onClick={selectAndCalculate} disabled={calculating||!matchingFiles.length} className="btn-primary">{calculating?<Spinner/>:<Calculator className="h-4 w-4"/>} Berekenen</button></div></div></div>
    {loading&&<div className="card p-8 flex justify-center"><Spinner/></div>}
    {!loading&&!matchingFiles.length&&<div className="card"><EmptyState icon={FileSpreadsheet} title={`Geen bankoverzicht voor ${quarter} ${year}`} subtitle="Upload een CSV/TXT bankoverzicht voor deze periode."/></div>}
    {report&&<div className="space-y-4">
      {!report.audit.ok&&<div className="card p-4 border-danger-200 bg-danger-50"><div className="flex items-center gap-2 font-bold text-danger-800"><AlertTriangle className="h-4 w-4"/> Audit controle mislukt</div><ul className="mt-2 list-disc pl-5 text-xs">{report.audit.problems.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}
      <div className="card p-6"><div className="flex flex-wrap justify-between gap-3 mb-5"><div><h3 className="font-semibold">BTW-overzicht — {quarter} {year}</h3><p className="text-xs text-ink-500">{report.audit.known} bekend · {report.audit.unresolved} twijfelgevallen · {report.audit.ignored} samenvattingen genegeerd · {report.audit.evidenceRequired} regels met bewijscontrole</p></div><div className="text-xs font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/> Betrouwbaarheid: {berekenBetrouwbaarheidsscore(report).toFixed(1)}%</div></div>
        <div className="grid md:grid-cols-2 gap-5"><div className="rounded-xl border p-5"><h4 className="font-bold text-sm flex gap-2 items-center"><TrendingUp className="h-4 w-4"/> Verschuldigde btw</h4><div className="mt-4 space-y-2 text-xs"><div className="flex justify-between"><span>1a — 21%</span><b>{eur(report.aangifte['1a'].btw)}</b></div><div className="flex justify-between"><span>1b — 9%</span><b>{eur(report.aangifte['1b'].btw)}</b></div><div className="flex justify-between"><span>2a — binnenlandse verlegging</span><b>{eur(report.aangifte['2a'].btw)}</b></div><div className="flex justify-between"><span>4a — buiten EU</span><b>{eur(report.aangifte['4a'].btw)}</b></div><div className="flex justify-between"><span>4b — binnen EU</span><b>{eur(report.aangifte['4b'].btw)}</b></div></div><div className="mt-4 border-t pt-3 flex justify-between font-bold"><span>Totaal verschuldigd</span><span>{eur(report.overzicht.output.total)}</span></div></div>
        <div className="rounded-xl border p-5"><h4 className="font-bold text-sm flex gap-2 items-center"><TrendingDown className="h-4 w-4"/> Aftrekbare voorbelasting</h4><div className="mt-4 space-y-2 text-xs"><div className="flex justify-between"><span>5b — Nederlandse btw 21%</span><b>{eur(report.overzicht.input.domestic21)}</b></div><div className="flex justify-between"><span>5b — Nederlandse btw 9%</span><b>{eur(report.overzicht.input.domestic9)}</b></div><div className="flex justify-between"><span>5b — verlegde btw</span><b>{eur(report.overzicht.input.reverseCharge)}</b></div></div><div className="mt-4 border-t pt-3 flex justify-between font-bold"><span>Totaal 5b</span><span>{eur(report.aangifte['5b'])}</span></div></div></div>
        <div className="mt-5 rounded-xl border p-5"><div className="flex justify-between items-center"><div className="flex gap-2 items-center"><ArrowDownUp className="h-5 w-5"/><div><div className="text-xs font-bold uppercase">{report.overzicht.status==='af_te_dragen'?"Af te dragen":"Terug te vorderen"}</div><div className="font-bold">{report.overzicht.status==='af_te_dragen'?"Aan Belastingdienst":"Van Belastingdienst"}</div></div></div><div className="text-2xl font-extrabold">{eur(Math.abs(report.overzicht.netto))}</div></div><pre className="mt-4 rounded-lg bg-ink-50 p-4 text-xs whitespace-pre-wrap">{eur(report.overzicht.output.total)} verschuldigde btw\n− {eur(report.overzicht.input.total)} aftrekbare voorbelasting\n= {report.overzicht.netto>=0?eur(report.overzicht.netto)+" af te dragen":"−"+eur(Math.abs(report.overzicht.netto))+" terug te vorderen"}</pre></div></div>
      {columns.twijfelgevallen.length>0&&<div className="card overflow-hidden border-warning-200"><div className="p-4 bg-warning-50"><h3 className="font-semibold flex gap-2"><AlertTriangle className="h-4 w-4"/> Twijfelgevallen ({columns.twijfelgevallen.length})</h3><p className="text-xs mt-1">Niet financieel meegenomen totdat een boekhouder de fiscale behandeling bevestigt.</p><div className="mt-3 flex items-center gap-2"><UserCheck className="h-4 w-4"/><input value={reviewer} onChange={e=>setReviewer(e.target.value)} placeholder="Naam boekhouder" className="input max-w-xs"/></div></div><div className="overflow-x-auto"><table className="w-full text-xs"><tbody>{columns.twijfelgevallen.map(row=><tr key={row.transactie_id} className="border-t"><td className="p-3">{row.omschrijving}</td><td className="p-3 text-right">{row.bedrag}</td><td className="p-3">{row.toegepaste_regel}</td><td className="p-3">{BOEKHOUDER_PERCENTAGE_OPTIES.map(opt=><button key={opt.percentage} onClick={()=>applyReview(row.transactie_id,opt.percentage)} className="btn-secondary mr-1">{opt.label}</button>)}</td></tr>)}</tbody></table></div></div>}
      <div className="card overflow-hidden"><div className="p-4 bg-ink-50"><h3 className="font-semibold">Aangiftecontrole</h3><p className="text-xs text-ink-500">Alleen expliciet onderbouwde transacties worden in de aangifterubrieken opgenomen.</p></div><div className="grid md:grid-cols-3 gap-3 p-4 text-xs">{(['1a','1b','2a','4a','4b'] as const).map(k=><div key={k} className="rounded border p-3"><b>Rubriek {k}</b><div>Grondslag: {eur(report.aangifte[k].grondslag)}</div><div>BTW: {eur(report.aangifte[k].btw)}</div></div>)}<div className="rounded border p-3"><b>Rubriek 5b</b><div>Voorbelasting: {eur(report.aangifte['5b'])}</div></div></div></div>
      <div className="card overflow-hidden"><div className="p-4 bg-ink-50"><h3 className="font-semibold">Verwerkte transacties ({columns.zeker.length})</h3></div><div className="overflow-x-auto"><table className="w-full text-xs"><tbody>{columns.zeker.map(row=><tr key={row.transactie_id} className="border-t"><td className="p-3">{row.omschrijving}</td><td className="p-3">{row.type}</td><td className="p-3">{row.btw}</td><td className="p-3">{row.bedrag}</td><td className="p-3">{row.toegepaste_regel}</td></tr>)}</tbody></table></div></div>
    </div>}
  </div>;
}
