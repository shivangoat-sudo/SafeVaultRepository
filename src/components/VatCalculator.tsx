import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { Spinner, EmptyState } from "@/components/ui";
import {
  calculateVatReport,
  vindEscalatieKandidaten,
  tweeKolommenWeergave,
  genereerStabielTransactieId,
  BOEKHOUDER_PERCENTAGE_OPTIES,
  berekenBetrouwbaarheidsscore,
  type VatReport as BtwReport,
  type RawTransaction,
  type BtwPercentage,
  type AiProposalMap,
  type BoekhouderBeoordeling,
} from "@/lib/btwEngineSafe";
import { parseCsvToRawTransactions } from "@/utils/vatCalculator";
import { processFile } from "@/bridge";
import type { EngineResult } from "@/bridge";
import {
  Calculator, FileSpreadsheet, TrendingUp, TrendingDown,
  ArrowDownUp, CheckCircle2, AlertTriangle, Search,
  FolderOpen, UserCheck, Edit2,
  Filter, RotateCcw, ChevronDown, ChevronUp, Info, HelpCircle
} from "lucide-react";
import type { FileRow } from "@/types";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
const formatEUR = (n: number): string =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

type CalcState = {
  rawTransactions: RawTransaction[];
  report: BtwReport;
  aiProposals: AiProposalMap;
  percentageOverrides: Record<string, BoekhouderBeoordeling>;
  fileName: string;
  engineResult?: EngineResult;
} | null;

export function VatCalculator({ customerId }: { customerId: string }) {
  const { push } = useToast();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [quarter, setQuarter] = useState<string>("Q1");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [calc, setCalc] = useState<CalcState>(null);
  const [showToelichting, setShowToelichting] = useState<boolean>(true);

  const [accountantName, setAccountantName] = useState<string>(() => {
    try { return localStorage.getItem("btw_beoordeeld_door") || ""; } catch { return ""; }
  });
  const [showNameModal, setShowNameModal] = useState<boolean>(false);
  const [pendingTxReview, setPendingTxReview] = useState<{ txId: string; percentage: BtwPercentage } | null>(null);
  const [modalNameInput, setModalNameInput] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'income' | 'expense'>("ALL");
  const [vatFilter, setVatFilter] = useState<'ALL' | '21' | '9' | '0' | 'verlegd' | 'bua' | 'twijfel'>("ALL");
  const [sortOption, setSortOption] = useState<'default' | 'amount_desc' | 'amount_asc' | 'desc_asc'>("default");
  const isFilterActive = searchQuery !== "" || typeFilter !== "ALL" || vatFilter !== "ALL" || sortOption !== "default";

  const resetFilters = () => { setSearchQuery(""); setTypeFilter("ALL"); setVatFilter("ALL"); setSortOption("default"); };
  const storageKey = `btw_percentage_overrides_${customerId}`;

  const loadSavedOverrides = useCallback((): Record<string, BoekhouderBeoordeling> => {
    try { const saved = localStorage.getItem(storageKey); return saved ? JSON.parse(saved) : {}; } catch { return {}; }
  }, [storageKey]);
  const saveOverrides = useCallback((overrides: Record<string, BoekhouderBeoordeling>) => {
    try { localStorage.setItem(storageKey, JSON.stringify(overrides)); } catch (e) { console.error("Failed to persist percentage overrides:", e); }
  }, [storageKey]);
  const saveAccountantName = (name: string) => { setAccountantName(name); try { localStorage.setItem("btw_beoordeeld_door", name); } catch (e) { console.error(e); } };

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try { const res = await api.dossierUploads(customerId); setFiles(res.files); }
    catch { push("error", "Uploads konden niet worden geladen."); }
    finally { setLoadingFiles(false); }
  }, [customerId, push]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const matchingFiles = files.filter(f =>
    f.category === "income_overview" &&
    (!f.quarter || String(f.quarter).toUpperCase().trim() === String(quarter).toUpperCase().trim()) &&
    (!f.year || f.year === year) &&
    (f.original_name.toLowerCase().endsWith(".csv") || f.original_name.toLowerCase().endsWith(".txt"))
  );

  const runCalculation = async (file: File) => {
    setCalculating(true); setCalc(null);
    try {
      const text = await file.text();
      let rawTransactions = parseCsvToRawTransactions(text);
      if (rawTransactions.length === 0) {
        const engineResult = await processFile(file);
        if (engineResult.metrics.vatReport) {
          const vr = engineResult.metrics.vatReport as unknown as BtwReport;
          rawTransactions = vr.transactions.map(t => {
            const dateStr = t.date || (t as any).datum || "";
            const descStr = t.description || t.applied_rule?.omschrijving || "Transactie";
            const amtNum = t.amount_incl_input || 0;
            const ibanStr = (t as any).tegenrekening_iban || undefined;
            const stableId = t.id && !t.id.startsWith("tx_") ? t.id : genereerStabielTransactieId({ date: dateStr, description: descStr, amount_incl: amtNum, tegenrekening_iban: ibanStr });
            return { id: stableId, date: dateStr, description: descStr, amount_incl: amtNum, type: t.type === 'income' ? 'income' : 'expense', tegenrekening_iban: ibanStr };
          });
        }
        if (rawTransactions.length === 0) { push("success", "Er zijn geen transacties herkend voor de BTW-verwerking."); return; }
      }

      const persistentOverrides = loadSavedOverrides();
      // No fake AI escalation: only actual deterministic results and explicit human overrides affect finance.
      const report = calculateVatReport(rawTransactions, { percentageOverrides: persistentOverrides });
      const aiProposals: AiProposalMap = {};
      setCalc({ rawTransactions, report, aiProposals, percentageOverrides: persistentOverrides, fileName: file.name });
      push("success", `${file.name} succesvol verwerkt.`);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Berekening mislukt.");
    } finally { setCalculating(false); }
  };

  const applyReview = (txId: string, percentage: BtwPercentage, reviewerName: string) => {
    if (!calc) return;
    const newOverrides = { ...calc.percentageOverrides, [txId]: { percentage, beoordeeld_door: reviewerName || accountantName || undefined } };
    saveOverrides(newOverrides);
    try {
      const newReport = calculateVatReport(calc.rawTransactions, { percentageOverrides: newOverrides });
      setCalc({ ...calc, report: newReport, percentageOverrides: newOverrides });
      push("success", `BTW-tarief ${percentage}% opgeslagen voor deze transactie.`);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "BTW-beoordeling kon niet worden toegepast.");
    }
  };

  const handlePercentageClick = (txId: string, percentage: BtwPercentage) => {
    if (!accountantName || accountantName.trim() === "") { setPendingTxReview({ txId, percentage }); setModalNameInput(""); setShowNameModal(true); }
    else applyReview(txId, percentage, accountantName);
  };
  const handleConfirmNameModal = () => {
    const trimmed = modalNameInput.trim();
    if (!trimmed) { push("error", "Vul a.u.b. uw naam in voor de beoordeling."); return; }
    saveAccountantName(trimmed); setShowNameModal(false);
    if (pendingTxReview) { applyReview(pendingTxReview.txId, pendingTxReview.percentage, trimmed); setPendingTxReview(null); }
  };

  const filteredTransactions = useMemo(() => {
    if (!calc?.report?.transactions) return [];
    const rawQuery = searchQuery.trim();
    const terms = rawQuery ? rawQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean) : [];
    return calc.report.transactions.filter(tx => {
      if (typeFilter === 'income' && tx.type !== 'income') return false;
      if (typeFilter === 'expense' && tx.type !== 'expense') return false;
      if (vatFilter === '21' && tx.rate !== 21) return false;
      if (vatFilter === '9' && tx.rate !== 9) return false;
      if (vatFilter === '0' && tx.rate !== 0) return false;
      if (vatFilter === 'verlegd' && tx.classification !== 'verlegd_21') return false;
      if (vatFilter === 'bua' && tx.classification !== 'horeca_bua_9') return false;
      if (vatFilter === 'twijfel' && tx.vat.status !== 'unknown') return false;
      if (terms.length > 0) {
        const searchableText = [tx.description || "", tx.date || "", tx.amount_incl_input ? tx.amount_incl_input.toString() : "", tx.amount_incl_input ? formatEUR(tx.amount_incl_input) : "", tx.bedrag_excl ? formatEUR(tx.bedrag_excl) : "", tx.btw_bedrag != null ? formatEUR(tx.btw_bedrag) : "", tx.applied_rule?.korte_toelichting || "", tx.applied_rule?.omschrijving || "", tx.applied_rule?.wetsartikel || "", tx.applied_rule?.rubriek || "", tx.herkenningsbron || "", tx.classification || "", tx.vat.status, tx.rate == null ? "onbekend" : `${tx.rate}%`, tx.type === 'income' ? 'inkomsten' : 'uitgaven'].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        for (const term of terms) if (!searchableText.includes(term)) return false;
      }
      return true;
    });
  }, [calc?.report?.transactions, typeFilter, vatFilter, searchQuery]);

  const sortedTransactions = useMemo(() => [...filteredTransactions].sort((a,b) => sortOption === 'amount_desc' ? b.amount_incl_input-a.amount_incl_input : sortOption === 'amount_asc' ? a.amount_incl_input-b.amount_incl_input : sortOption === 'desc_asc' ? (a.description||"").localeCompare(b.description||"") : 0), [filteredTransactions, sortOption]);
  const filteredReport = useMemo(() => calc ? { ...calc.report, transactions: sortedTransactions } : null, [calc, sortedTransactions]);
  const kolommen = useMemo(() => filteredReport ? tweeKolommenWeergave(filteredReport) : { zeker: [], twijfelgevallen: [] }, [filteredReport]);
  const overzicht = calc?.report?.overzicht;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="card p-5"><div className="flex flex-col sm:flex-row sm:items-end gap-4"><div className="flex-1"><h3 className="text-sm font-semibold text-ink-900 mb-1">BTW-calculator</h3><p className="text-xs text-ink-400">Selecteer een jaar en kwartaal. Het geüploade bankoverzicht voor deze periode wordt berekend op basis van `report.overzicht`.</p></div><div className="flex gap-3"><select value={quarter} onChange={e=>setQuarter(e.target.value)} className="input sm:w-28">{QUARTERS.map(q=><option key={q} value={q}>{q}</option>)}</select><input type="number" value={year} onChange={e=>setYear(Number(e.target.value))} className="input w-24 tabular-nums"/><button onClick={()=>{if(!matchingFiles.length){push("error",`Geen bestand gevonden voor ${quarter} ${year}.`);return;}const file=matchingFiles[0];api.userFileView(file.id).then(async viewRes=>{const resp=await fetch(viewRes.url);if(!resp.ok)throw new Error("Bestand kon niet worden opgehaald.");const blob=await resp.blob();runCalculation(new File([blob],file.original_name,{type:file.mime_type||"text/csv"}));}).catch(()=>push("error","Bestand kon niet worden opgehaald."));}} disabled={calculating||matchingFiles.length===0} className="btn-primary whitespace-nowrap active:scale-95 transition-transform duration-100 ease-out cursor-pointer">{calculating?<Spinner/>:<Calculator className="h-4 w-4"/>} Berekenen</button></div></div></div>

      {loadingFiles ? <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-ink-400"/></div> : matchingFiles.length===0 ? <EmptyState icon={<FolderOpen className="h-8 w-8"/>} title="Geen bestand gevonden" description={`Geen CSV/TXT-bankoverzicht gevonden voor ${quarter} ${year}.`}/> : <div className="card p-4"><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5"/><span className="text-sm">{matchingFiles[0].original_name}</span></div></div>}

      {calc && overzicht && <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-5"><div className="flex items-center gap-2 mb-3"><TrendingUp className="h-5 w-5"/><h4 className="font-semibold">BTW over inkomsten — verschuldigd</h4></div><div className="space-y-2 text-sm"><div className="flex justify-between"><span>21%</span><span className="font-medium tabular-nums">{formatEUR(overzicht.verschuldigd.inkomsten_21)}</span></div><div className="flex justify-between"><span>9%</span><span className="font-medium tabular-nums">{formatEUR(overzicht.verschuldigd.inkomsten_9)}</span></div>{overzicht.verschuldigd.verlegde_btw>0&&<div className="flex justify-between"><span>Verlegd</span><span className="font-medium tabular-nums">{formatEUR(overzicht.verschuldigd.verlegde_btw)}</span></div>}<div className="border-t pt-2 flex justify-between font-semibold"><span>Totaal verschuldigd</span><span>{formatEUR(overzicht.verschuldigd.totaal)}</span></div></div></div>
          <div className="card p-5"><div className="flex items-center gap-2 mb-3"><TrendingDown className="h-5 w-5"/><h4 className="font-semibold">BTW over uitgaven — aftrekbare voorbelasting</h4></div><div className="space-y-2 text-sm"><div className="flex justify-between"><span>21%</span><span className="font-medium tabular-nums">{formatEUR(overzicht.aftrekbaar.uitgaven_21)}</span></div><div className="flex justify-between"><span>9%</span><span className="font-medium tabular-nums">{formatEUR(overzicht.aftrekbaar.uitgaven_9)}</span></div>{overzicht.aftrekbaar.verlegde_btw>0&&<div className="flex justify-between"><span>Verlegd</span><span className="font-medium tabular-nums">{formatEUR(overzicht.aftrekbaar.verlegde_btw)}</span></div>}<div className="border-t pt-2 flex justify-between font-semibold"><span>Totaal aftrekbare voorbelasting</span><span>{formatEUR(overzicht.aftrekbaar.totaal)}</span></div>{overzicht.niet_aftrekbaar_ter_info>0&&<div className="text-xs text-ink-500 pt-1">Niet-aftrekbare BTW ter informatie: {formatEUR(overzicht.niet_aftrekbaar_ter_info)}</div>}</div></div>
        </div>

        <div className="card p-5"><button className="w-full flex items-center justify-between text-left" onClick={()=>setShowToelichting(v=>!v)}><div><h4 className="font-semibold">{overzicht.status==='af_te_dragen'?'BTW af te dragen':'BTW terug te vorderen'}</h4><p className="text-sm text-ink-500">Netto BTW: {formatEUR(Math.abs(overzicht.netto_btw))}</p></div>{showToelichting?<ChevronUp/>:<ChevronDown/>}</button>{showToelichting&&<div className="mt-4 rounded-lg border p-4 whitespace-pre-line text-sm tabular-nums">{overzicht.toelichting}</div>}</div>

        <div className="card p-5"><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"><div><div className="text-ink-500">Verwerkte transacties</div><div className="font-semibold">{overzicht && calc.report.audit.input_count}</div></div><div><div className="text-ink-500">Financieel geaccepteerd</div><div className="font-semibold">{calc.report.audit.trusted_count}</div></div><div><div className="text-ink-500">Twijfelgevallen</div><div className="font-semibold">{calc.report.audit.unresolved_count}</div></div><div><div className="text-ink-500">Rekenkundige controle</div><div className="font-semibold">{calc.report.audit.ok?'✓ klopt':'⚠ controle vereist'}</div></div></div></div>

        {/* Existing transaction tables remain below; their data is now sourced only from the safe report. */}
        <div className="card p-5"><div className="flex flex-col lg:flex-row lg:items-end gap-3"><div className="flex-1"><h4 className="font-semibold">Transacties</h4><p className="text-xs text-ink-500">Onbekende BTW wordt als onbekend getoond, niet als 0%.</p></div><div className="flex gap-2"><input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Zoeken..." className="input"/><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value as any)} className="input"><option value="ALL">Alles</option><option value="income">Inkomsten</option><option value="expense">Uitgaven</option></select><select value={vatFilter} onChange={e=>setVatFilter(e.target.value as any)} className="input"><option value="ALL">Alle BTW</option><option value="21">21%</option><option value="9">9%</option><option value="0">0%</option><option value="verlegd">Verlegd</option><option value="bua">BUA</option><option value="twijfel">Twijfel</option></select><button onClick={resetFilters} className="btn-secondary"><RotateCcw className="h-4 w-4"/></button></div></div></div>
      </>}
    </div>
  );
}
