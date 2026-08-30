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
} from "@/lib/btwEngine";
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

  // Accountant name state & persistence
  const [accountantName, setAccountantName] = useState<string>(() => {
    try {
      return localStorage.getItem("btw_beoordeeld_door") || "";
    } catch {
      return "";
    }
  });

  // Modal state for prompting accountant name when required
  const [showNameModal, setShowNameModal] = useState<boolean>(false);
  const [pendingTxReview, setPendingTxReview] = useState<{ txId: string; percentage: BtwPercentage } | null>(null);
  const [modalNameInput, setModalNameInput] = useState<string>("");

  // Filter & Search states for transaction tables
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'income' | 'expense'>("ALL");
  const [vatFilter, setVatFilter] = useState<'ALL' | '21' | '9' | '0' | 'verlegd' | 'bua' | 'twijfel'>("ALL");
  const [sortOption, setSortOption] = useState<'default' | 'amount_desc' | 'amount_asc' | 'desc_asc'>("default");

  const isFilterActive = searchQuery !== "" || typeFilter !== "ALL" || vatFilter !== "ALL" || sortOption !== "default";

  const resetFilters = () => {
    setSearchQuery("");
    setTypeFilter("ALL");
    setVatFilter("ALL");
    setSortOption("default");
  };

  const storageKey = `btw_percentage_overrides_${customerId}`;

  const loadSavedOverrides = useCallback((): Record<string, BoekhouderBeoordeling> => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, [storageKey]);

  const saveOverrides = useCallback((overrides: Record<string, BoekhouderBeoordeling>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(overrides));
    } catch (e) {
      console.error("Failed to persist percentage overrides:", e);
    }
  }, [storageKey]);

  const saveAccountantName = (name: string) => {
    setAccountantName(name);
    try {
      localStorage.setItem("btw_beoordeeld_door", name);
    } catch (e) {
      console.error("Failed to persist accountant name:", e);
    }
  };

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await api.dossierUploads(customerId);
      setFiles(res.files);
    } catch {
      push("error", "Uploads konden niet worden geladen.");
    } finally {
      setLoadingFiles(false);
    }
  }, [customerId, push]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const matchingFiles = files.filter(
    (f) =>
      (f.category === "income_overview") &&
      (!f.quarter || String(f.quarter).toUpperCase().trim() === String(quarter).toUpperCase().trim()) &&
      (!f.year || f.year === year) &&
      (f.original_name.toLowerCase().endsWith(".csv") ||
       f.original_name.toLowerCase().endsWith(".txt"))
  );

  const runCalculation = async (file: File) => {
    setCalculating(true);
    setCalc(null);
    try {
      const text = await file.text();
      let rawTransactions = parseCsvToRawTransactions(text);

      if (rawTransactions.length === 0) {
        // Fallback for non-standard CSV or legacy bridge
        const engineResult = await processFile(file);
        
        if (engineResult.metrics.vatReport) {
          const vr = engineResult.metrics.vatReport as unknown as BtwReport;
          const rawTx: RawTransaction[] = vr.transactions.map((t) => {
            const dateStr = t.date || (t as any).datum || "";
            const descStr = t.description || t.applied_rule?.omschrijving || "Transactie";
            const amtNum = t.amount_incl_input || 0;
            const ibanStr = (t as any).tegenrekening_iban || undefined;
            const stableId = t.id && !t.id.startsWith("tx_")
              ? t.id
              : genereerStabielTransactieId({ date: dateStr, description: descStr, amount_incl: amtNum, tegenrekening_iban: ibanStr });

            return {
              id: stableId,
              date: dateStr,
              description: descStr,
              amount_incl: amtNum,
              type: t.type === 'income' ? 'income' : 'expense',
              tegenrekening_iban: ibanStr
            };
          });
          rawTransactions = rawTx;
        }

        if (rawTransactions.length === 0) {
          push("success", "Er zijn geen transacties herkend voor de BTW-verwerking.");
          setCalculating(false);
          return;
        }
      }

      // Read persistent overrides
      const persistentOverrides = loadSavedOverrides();

      // STAP 1 — Automatisch berekenen met btwEngine
      let report = calculateVatReport(rawTransactions, { percentageOverrides: persistentOverrides });
      const aiProposals: AiProposalMap = {};

      // STAP 2 — Escaleren bij onzekerheid (automatisering via kandidaten)
      const kandidaten = vindEscalatieKandidaten(report);
      if (kandidaten.length > 0) {
        report = calculateVatReport(rawTransactions, { aiProposals, percentageOverrides: persistentOverrides });
      }

      setCalc({
        rawTransactions,
        report,
        aiProposals,
        percentageOverrides: persistentOverrides,
        fileName: file.name
      });
      push("success", `${file.name} succesvol verwerkt.`);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Berekening mislukt.");
    } finally {
      setCalculating(false);
    }
  };

  const applyReview = (txId: string, percentage: BtwPercentage, reviewerName: string) => {
    if (!calc) return;

    const newOverrides: Record<string, BoekhouderBeoordeling> = {
      ...calc.percentageOverrides,
      [txId]: {
        percentage,
        beoordeeld_door: reviewerName || accountantName || undefined
      }
    };

    saveOverrides(newOverrides);

    const newReport = calculateVatReport(calc.rawTransactions, {
      aiProposals: calc.aiProposals,
      percentageOverrides: newOverrides,
    });

    setCalc({
      ...calc,
      report: newReport,
      percentageOverrides: newOverrides,
    });

    push("success", `BTW-tarief ${percentage}% opgeslagen voor deze transactie.`);
  };

  const handlePercentageClick = (txId: string, percentage: BtwPercentage) => {
    if (!accountantName || accountantName.trim() === "") {
      setPendingTxReview({ txId, percentage });
      setModalNameInput("");
      setShowNameModal(true);
    } else {
      applyReview(txId, percentage, accountantName);
    }
  };

  const handleConfirmNameModal = () => {
    const trimmed = modalNameInput.trim();
    if (!trimmed) {
      push("error", "Vul a.u.b. uw naam in voor de beoordeling.");
      return;
    }
    saveAccountantName(trimmed);
    setShowNameModal(false);
    if (pendingTxReview) {
      applyReview(pendingTxReview.txId, pendingTxReview.percentage, trimmed);
      setPendingTxReview(null);
    }
  };

  // Filter & Sort transactions for the tables
  const filteredTransactions = useMemo(() => {
    if (!calc?.report?.transactions) return [];

    const rawQuery = searchQuery.trim();
    const terms = rawQuery
      ? rawQuery
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/\s+/)
          .filter(Boolean)
      : [];

    return calc.report.transactions.filter((tx) => {
      if (typeFilter === 'income' && tx.type !== 'income') return false;
      if (typeFilter === 'expense' && tx.type !== 'expense') return false;

      if (vatFilter === '21' && tx.rate !== 21) return false;
      if (vatFilter === '9' && tx.rate !== 9) return false;
      if (vatFilter === '0' && tx.rate !== 0) return false;
      if (vatFilter === 'verlegd' && tx.classification !== 'verlegd_21') return false;
      if (vatFilter === 'bua' && tx.classification !== 'horeca_bua_9') return false;
      if (vatFilter === 'twijfel' && tx.zekerheid !== 'laag') return false;

      if (terms.length > 0) {
        const searchableText = [
          tx.description || "",
          tx.date || "",
          tx.amount_incl_input ? tx.amount_incl_input.toString() : "",
          tx.amount_incl_input ? formatEUR(tx.amount_incl_input) : "",
          tx.bedrag_excl ? formatEUR(tx.bedrag_excl) : "",
          tx.btw_bedrag ? formatEUR(tx.btw_bedrag) : "",
          tx.applied_rule?.korte_toelichting || "",
          tx.applied_rule?.omschrijving || "",
          tx.applied_rule?.wetsartikel || "",
          tx.applied_rule?.rubriek || "",
          tx.herkenningsbron || "",
          tx.classification || "",
          `${tx.rate}%`,
          tx.type === 'income' ? 'inkomsten' : 'uitgaven'
        ]
          .join(" ")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        for (const term of terms) {
          if (!searchableText.includes(term)) return false;
        }
      }

      return true;
    });
  }, [calc?.report?.transactions, typeFilter, vatFilter, searchQuery]);

  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      if (sortOption === 'amount_desc') {
        return b.amount_incl_input - a.amount_incl_input;
      }
      if (sortOption === 'amount_asc') {
        return a.amount_incl_input - b.amount_incl_input;
      }
      if (sortOption === 'desc_asc') {
        return (a.description || "").localeCompare(b.description || "");
      }
      return 0;
    });
  }, [filteredTransactions, sortOption]);

  const filteredReport = useMemo(() => {
    return calc ? {
      ...calc.report,
      transactions: sortedTransactions,
    } : null;
  }, [calc, sortedTransactions]);

  const kolommen = useMemo(() => {
    return filteredReport ? tweeKolommenWeergave(filteredReport) : { zeker: [], twijfelgevallen: [] };
  }, [filteredReport]);

  const overzicht = calc?.report?.overzicht;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-ink-900 mb-1">BTW-calculator</h3>
            <p className="text-xs text-ink-400">
              Selecteer een jaar en kwartaal. Het geüploade bankoverzicht voor deze periode wordt berekend op basis van `report.overzicht`.
            </p>
          </div>
          <div className="flex gap-3">
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)} className="input sm:w-28">
              {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="input w-24 tabular-nums" />
            <button
              onClick={() => {
                if (matchingFiles.length === 0) {
                  push("error", `Geen bestand gevonden voor ${quarter} ${year}.`);
                  return;
                }
                const file = matchingFiles[0];
                api.userFileView(file.id).then(async (viewRes) => {
                  const resp = await fetch(viewRes.url);
                  if (!resp.ok) throw new Error("Bestand kon niet worden opgehaald.");
                  const blob = await resp.blob();
                  const csvFile = new File([blob], file.original_name, { type: file.mime_type || "text/csv" });
                  runCalculation(csvFile);
                }).catch(() => push("error", "Bestand kon niet worden opgehaald."));
              }}
              disabled={calculating || matchingFiles.length === 0}
              className="btn-primary whitespace-nowrap active:scale-95 transition-transform duration-100 ease-out cursor-pointer"
            >
              {calculating ? <Spinner /> : <Calculator className="h-4 w-4" />} Berekenen
            </button>
          </div>
        </div>
      </div>

      {/* File status */}
      {loadingFiles ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : matchingFiles.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FileSpreadsheet}
            title={`Geen bankoverzicht voor ${quarter} ${year}`}
            subtitle="Upload een 'Bankoverzicht Inkomsten en uitgaven' (.csv / .txt) voor deze periode om de BTW-calculator te gebruiken."
          />
        </div>
      ) : null}

      {/* Calculating state */}
      {calculating && (
        <div className="card p-8 flex flex-col items-center justify-center">
          <Spinner className="h-6 w-6 text-brand-500" />
          <p className="mt-3 text-sm text-ink-500">Bezig met berekenen…</p>
        </div>
      )}

      {/* Results */}
      {!calculating && calc && overzicht && (
        <div className="animate-fade-in space-y-4">
          <div className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Calculator className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">BTW-overzicht — {quarter} {year}</h3>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {calc.report.herkenning.automatisch_herkend} van de {calc.report.herkenning.totaal_transacties} transacties automatisch herkend ({calc.report.herkenning.percentage_herkend}%)
                  </p>
                </div>
              </div>

              {/* Accountant Info & Reliability Score Badge */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 rounded-lg border border-brand-200 text-xs text-brand-800 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />
                  <span>Betrouwbaarheid: {berekenBetrouwbaarheidsscore(calc.report).toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-ink-50 rounded-lg border border-ink-200 text-xs text-ink-700">
                  <UserCheck className="h-3.5 w-3.5 text-brand-600" />
                  <span>Beoordeeld door: <strong>{accountantName || "Nog niet ingesteld"}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setModalNameInput(accountantName);
                      setPendingTxReview(null);
                      setShowNameModal(true);
                    }}
                    className="ml-1 text-brand-600 hover:text-brand-700 p-0.5 cursor-pointer"
                    title="Naam wijzigen"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                </div>
                <span className="text-xs text-ink-400 flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {calc.fileName}
                </span>
              </div>
            </div>

            {/* DEEL 5 — VALIDATIE IN DE FRONTEND: Toon report.audit.ok als false */}
            {!calc.report.audit.ok && (
              <div className="mb-5 p-4 rounded-lg bg-danger-50 border border-danger-200 text-danger-900 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm text-danger-800">
                  <AlertTriangle className="h-5 w-5 text-danger-600 shrink-0" />
                  <span>Audit controle mislukt (report.audit.ok = false)</span>
                </div>
                <p className="text-xs text-danger-700">
                  De automatische zelfcontrole heeft de volgende inconsistenties gevonden in de berekening:
                </p>
                <ul className="list-disc pl-5 text-xs space-y-1 font-mono text-danger-900">
                  {calc.report.audit.problemen.map((prob, idx) => (
                    <li key={idx}>{prob}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Mogelijke dubbele transacties */}
            {calc.report.mogelijke_dubbele_transacties.length > 0 && (
              <div className="mb-5 p-4 rounded-lg bg-warning-50 border border-warning-200 space-y-1 text-warning-900">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-600 shrink-0" />
                  <p className="text-xs font-bold uppercase tracking-wider">
                    Mogelijke dubbele transacties gesignaleerd ({calc.report.mogelijke_dubbele_transacties.length})
                  </p>
                </div>
                <p className="text-xs text-warning-800">
                  De volgende transacties hebben een gelijke datum, omschrijving en bedrag. Beide zijn apart verwerkt in de berekening (niet automatisch samengevoegd):
                </p>
                <ul className="text-xs space-y-1 pl-5 list-disc text-warning-900 mt-1">
                  {calc.report.mogelijke_dubbele_transacties.map((dub, idx) => (
                    <li key={idx}>
                      <strong>{dub.datum || "Geen datum"}</strong> — {dub.omschrijving} ({formatEUR(dub.bedrag)})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* DEEL 4 — LEIDENDE BTW-WEERGAVE VIA REPORT.OVERZICHT */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* SECTIE: BTW over inkomsten (verschuldigd) */}
              <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-ink-100">
                    <TrendingUp className="h-4 w-4 text-brand-600 shrink-0" />
                    <h4 className="text-sm font-bold text-ink-900">
                      BTW over inkomsten (verschuldigd)
                    </h4>
                  </div>
                  <div className="space-y-2.5 text-xs text-ink-700">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">21% BTW over inkomsten:</span>
                      <span className="font-medium tabular-nums text-ink-900">{formatEUR(overzicht.verschuldigd.inkomsten_21)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">9% BTW over inkomsten:</span>
                      <span className="font-medium tabular-nums text-ink-900">{formatEUR(overzicht.verschuldigd.inkomsten_9)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">Verlegde BTW (buitenlandse diensten):</span>
                      <span className="font-medium tabular-nums text-ink-900">{formatEUR(overzicht.verschuldigd.verlegde_btw)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t-2 border-ink-200 flex items-center justify-between bg-brand-50/50 p-2.5 rounded-lg">
                  <span className="text-xs font-bold text-brand-900">Totaal verschuldigd:</span>
                  <span className="text-sm font-bold tabular-nums text-brand-700">{formatEUR(overzicht.verschuldigd.totaal)}</span>
                </div>
              </div>

              {/* SECTIE: BTW over uitgaven (aftrekbaar) */}
              <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-ink-100">
                    <TrendingDown className="h-4 w-4 text-success-600 shrink-0" />
                    <h4 className="text-sm font-bold text-ink-900">
                      BTW over uitgaven (aftrekbaar)
                    </h4>
                  </div>
                  <div className="space-y-2.5 text-xs text-ink-700">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">21% aftrekbare BTW over uitgaven:</span>
                      <span className="font-medium tabular-nums text-ink-900">{formatEUR(overzicht.aftrekbaar.uitgaven_21)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">9% aftrekbare BTW over uitgaven:</span>
                      <span className="font-medium tabular-nums text-ink-900">{formatEUR(overzicht.aftrekbaar.uitgaven_9)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-600">Verlegde BTW (aftrekbaar):</span>
                      <span className="font-medium tabular-nums text-ink-900">{formatEUR(overzicht.aftrekbaar.verlegde_btw)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t-2 border-ink-200 flex items-center justify-between bg-success-50/50 p-2.5 rounded-lg">
                  <span className="text-xs font-bold text-success-900">Totaal aftrekbare voorbelasting:</span>
                  <span className="text-sm font-bold tabular-nums text-success-700">{formatEUR(overzicht.aftrekbaar.totaal)}</span>
                </div>
              </div>
            </div>

            {/* INFORMATIEF EXTRAATJE */}
            <div className="mb-6 p-3.5 rounded-lg bg-ink-50 border border-ink-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-ink-700">
                <Info className="h-4 w-4 text-ink-500 shrink-0" />
                <span>Niet-aftrekbare BTW (BUA/horeca):</span>
                <span className="text-ink-400 text-[11px]">(Informatief extraatje — geen onderdeel van bovenstaande optelling)</span>
              </div>
              <span className="font-semibold text-ink-900 tabular-nums">{formatEUR(overzicht.niet_aftrekbaar_ter_info)}</span>
            </div>

            {/* SECTIE: Af te dragen / Terug te vorderen (eindresultaat, prominent) */}
            <div className={`rounded-xl border p-6 transition-colors ${
              overzicht.status === 'af_te_dragen'
                ? "border-danger-300 bg-danger-50/70"
                : "border-success-300 bg-success-50/70"
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <ArrowDownUp className={`h-5 w-5 ${
                      overzicht.status === 'af_te_dragen' ? "text-danger-600" : "text-success-600"
                    }`} />
                    <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                      overzicht.status === 'af_te_dragen'
                        ? "bg-danger-100 text-danger-800 border-danger-200"
                        : "bg-success-100 text-success-800 border-success-200"
                    }`}>
                      {overzicht.status === 'af_te_dragen' ? "Af te dragen" : "Terug te vorderen"}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-ink-900 mt-2">
                    {overzicht.status === 'af_te_dragen' ? "Af te dragen aan Belastingdienst" : "Terug te vorderen van Belastingdienst"}
                  </h3>
                  <p className="text-xs text-ink-500 mt-0.5">
                    Definitieve netto BTW-positie op basis van report.overzicht
                  </p>
                </div>

                <div className="text-left sm:text-right">
                  <p className={`text-3xl font-extrabold tabular-nums ${
                    overzicht.status === 'af_te_dragen' ? "text-danger-700" : "text-success-700"
                  }`}>
                    {formatEUR(Math.abs(overzicht.netto_btw))}
                  </p>
                  <p className="text-xs font-medium text-ink-500 mt-1">
                    Netto BTW ({overzicht.status === 'af_te_dragen' ? "te betalen" : "te ontvangen"})
                  </p>
                </div>
              </div>

              {/* Uitklapbaar/zichtbaar blok met toelichting uit overzicht.toelichting */}
              <div className="mt-5 pt-4 border-t border-ink-200/60">
                <button
                  type="button"
                  onClick={() => setShowToelichting(!showToelichting)}
                  className="flex items-center justify-between w-full text-xs font-semibold text-ink-700 hover:text-ink-900 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5 text-brand-600" />
                    Specificatie & Toelichting (Kant-en-klaar)
                  </span>
                  {showToelichting ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {showToelichting && (
                  <div className="mt-3 p-4 rounded-lg bg-white/80 border border-ink-200/80 text-xs font-mono text-ink-800 whitespace-pre-wrap leading-relaxed shadow-2xs">
                    {overzicht.toelichting}
                  </div>
                )}
              </div>
            </div>

            {/* Summary bar */}
            <div className="mt-6 pt-4 border-t border-ink-100 grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-ink-500 mb-1 flex items-center gap-1"><FolderOpen className="h-3 w-3" /> Totaal verwerkt</p>
                <p className="text-sm font-semibold text-ink-800 tabular-nums">{calc.report.herkenning.totaal_transacties} regels</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning-600" /> Twijfelgevallen</p>
                <p className={`text-sm font-semibold tabular-nums ${kolommen.twijfelgevallen.length > 0 ? "text-warning-700" : "text-ink-800"}`}>
                  {kolommen.twijfelgevallen.length} {kolommen.twijfelgevallen.length === 1 ? "regel" : "regels"}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500 mb-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-brand-600" /> Genegeerde samenvattingen</p>
                <p className="text-sm font-semibold text-ink-800 tabular-nums">
                  {calc.report.genegeerde_samenvattingsregels?.length || 0} {calc.report.genegeerde_samenvattingsregels?.length === 1 ? "regel" : "regels"}
                </p>
              </div>
            </div>
          </div>

          {/* TRANSACTIETABELLEN & FILTERING */}
          <div className="space-y-4">
            <div className="card p-4 bg-white border border-ink-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-brand-600" />
                  <h4 className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                    Transacties Filteren & Sorteren
                  </h4>
                  <span className="text-xs text-ink-500 font-normal">
                    ({sortedTransactions.length} van {calc.report.transactions.length} getoond)
                  </span>
                  {isFilterActive && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-50 text-brand-700 border border-brand-200">
                      Filter actief
                    </span>
                  )}
                </div>

                {isFilterActive && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1 active:scale-95 transition-transform cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Filters herstellen
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Zoek omschrijving, bedrag, regel, rubriek..."
                    className="input pl-8 py-1.5 text-xs w-full"
                  />
                </div>

                <div>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as 'ALL' | 'income' | 'expense')}
                    className="input py-1.5 text-xs w-full"
                  >
                    <option value="ALL">Alle types (Inkomsten & Uitgaven)</option>
                    <option value="income">Alleen Inkomsten</option>
                    <option value="expense">Alleen Uitgaven</option>
                  </select>
                </div>

                <div>
                  <select
                    value={vatFilter}
                    onChange={(e) => setVatFilter(e.target.value as any)}
                    className="input py-1.5 text-xs w-full"
                  >
                    <option value="ALL">Alle BTW-tarieven & Categorieën</option>
                    <option value="21">21% BTW</option>
                    <option value="9">9% BTW</option>
                    <option value="0">0% BTW / Vrijgesteld</option>
                    <option value="verlegd">BTW Verlegd (21%)</option>
                    <option value="bua">Horeca / BUA (niet aftrekbaar)</option>
                    <option value="twijfel">Alleen Twijfelgevallen</option>
                  </select>
                </div>

                <div>
                  <select
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value as 'default' | 'amount_desc' | 'amount_asc' | 'desc_asc')}
                    className="input py-1.5 text-xs w-full"
                  >
                    <option value="default">Sorteer: Standaard volgorde</option>
                    <option value="amount_desc">Prijs/Bedrag: Hoog naar Laag</option>
                    <option value="amount_asc">Prijs/Bedrag: Laag naar Hoog</option>
                    <option value="desc_asc">Omschrijving: A - Z</option>
                  </select>
                </div>
              </div>
            </div>

            {isFilterActive && sortedTransactions.length === 0 && (
              <div className="card p-8 text-center bg-white border border-ink-200">
                <p className="text-sm font-semibold text-ink-800 mb-1">Geen transacties gevonden</p>
                <p className="text-xs text-ink-500 mb-4">Er zijn geen resultaten die voldoen aan de geselecteerde filtercriteria.</p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Filters herstellen
                </button>
              </div>
            )}

            {/* SECTIE: TWIJFELGEVALLEN */}
            {kolommen.twijfelgevallen.length > 0 && (
              <div className="card overflow-hidden border-warning-200">
                <div className="border-b border-warning-100 bg-warning-50/60 px-5 py-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-warning-900 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning-600" />
                      Twijfelgevallen ({kolommen.twijfelgevallen.length})
                    </h3>
                    <p className="text-xs text-warning-700 mt-0.5">
                      Deze transacties vereisen uw beoordeling als boekhouder. Kies het toepasselijke BTW-percentage om de regel definitief af te handelen.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto max-h-[50vh]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-warning-100 bg-warning-50/30 text-left text-xs font-medium text-warning-800 uppercase tracking-wide">
                        <th className="px-4 py-3">Omschrijving</th>
                        <th className="px-4 py-3 text-right">Bedrag</th>
                        <th className="px-4 py-3 text-center">Type</th>
                        <th className="px-4 py-3 text-center">Huidige BTW</th>
                        <th className="px-4 py-3">Reden twijfel / Toepassen percentage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-warning-100/50">
                      {kolommen.twijfelgevallen.map((row) => {
                        return (
                          <tr key={row.transactie_id} className="hover:bg-warning-50/20 transition-colors">
                            <td className="px-4 py-3 max-w-[280px]">
                              <p className="text-ink-900 font-medium truncate">{row.omschrijving || "(geen omschrijving)"}</p>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-900 font-medium whitespace-nowrap">{row.bedrag}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
                                row.type === 'Inkomsten'
                                  ? "bg-success-50 text-success-700 border-success-200"
                                  : "bg-ink-100 text-ink-600 border-ink-200"
                              }`}>
                                {row.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-warning-100 text-warning-800 border border-warning-200">
                                {row.btw}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[360px]">
                              <p className="text-xs text-warning-800 font-medium mb-1.5">{row.toegepaste_regel}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-ink-500 font-medium">Kies tarief:</span>
                                <div className="inline-flex gap-1.5">
                                  {BOEKHOUDER_PERCENTAGE_OPTIES.map((opt) => (
                                    <button
                                      key={opt.percentage}
                                      type="button"
                                      onClick={() => handlePercentageClick(row.transactie_id, opt.percentage)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white text-ink-800 border border-ink-300 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-300 active:scale-95 transition-transform duration-100 ease-out shadow-xs cursor-pointer"
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SECTIE: ZEKER */}
            <div className="card overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-3 flex items-center justify-between bg-ink-50/50">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success-600" />
                    Zeker ({kolommen.zeker.length})
                  </h3>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Automatisch geclassificeerde regels en door de boekhouder definitief goedgekeurde transacties.
                  </p>
                </div>
              </div>

              {kolommen.zeker.length === 0 ? (
                <div className="p-8 text-center text-xs text-ink-400">
                  Nog geen goedgekeurde of eenduidige transacties in deze categorie.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                        <th className="px-4 py-3">Omschrijving</th>
                        <th className="px-4 py-3 text-right">Bedrag</th>
                        <th className="px-4 py-3 text-center">Type</th>
                        <th className="px-4 py-3 text-center">BTW</th>
                        <th className="px-4 py-3">Toegepaste regel</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {kolommen.zeker.map((row) => {
                        return (
                          <tr key={row.transactie_id} className="hover:bg-ink-50/50 transition-colors">
                            <td className="px-4 py-3 max-w-[300px]">
                              <p className="text-ink-800 truncate">{row.omschrijving || "(geen omschrijving)"}</p>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-800 whitespace-nowrap">{row.bedrag}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
                                row.type === 'Inkomsten'
                                  ? "bg-success-50 text-success-700 border-success-200"
                                  : "bg-ink-100 text-ink-600 border-ink-200"
                              }`}>
                                {row.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
                                row.btw === '21%' ? "bg-brand-50 text-brand-700 border-brand-200"
                                : row.btw === '9%' ? "bg-success-50 text-success-700 border-success-200"
                                : "bg-ink-100 text-ink-600 border-ink-200"
                              }`}>
                                {row.btw}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[320px]">
                              <p className="text-xs text-ink-600">{row.toegepaste_regel}</p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Idle state */}
      {!calculating && !calc && matchingFiles.length > 0 && (
        <div className="card">
          <EmptyState
            icon={Search}
            title="Klaar om te berekenen"
            subtitle={`${matchingFiles.length} bestand gevonden voor ${quarter} ${year}. Klik op Berekenen om de BTW te berekenen.`}
          />
        </div>
      )}

      {/* Modal for Accountant Name Prompt */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 backdrop-blur-xs p-4">
          <div className="card w-full max-w-md p-6 bg-white shadow-xl animate-scale-in">
            <h3 className="text-base font-semibold text-ink-900 mb-2 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-brand-600" />
              Naam Boekhouder Invoeren
            </h3>
            <p className="text-xs text-ink-500 mb-4">
              Vul uw naam in ter verantwoording van handmatige BTW-beoordelingen. Deze naam wordt gekoppeld aan de geselecteerde transacties.
            </p>

            <div className="mb-5">
              <label className="block text-xs font-medium text-ink-700 mb-1">
                Uw Naam / Initialen
              </label>
              <input
                type="text"
                value={modalNameInput}
                onChange={(e) => setModalNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmNameModal();
                }}
                placeholder="bv. J. Jansen (Boekhouder)"
                className="input w-full"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNameModal(false)}
                className="btn-secondary text-xs cursor-pointer"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={handleConfirmNameModal}
                className="btn-primary text-xs cursor-pointer"
              >
                Opslaan & Toepassen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
