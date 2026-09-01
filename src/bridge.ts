import { calculateVatReport, vindEscalatieKandidaten, type SafeVatReport } from "./lib/btwEngineSafe";
import { parseCsvToRawTransactions } from "./utils/vatCsvParser";

export type ReviewItem = {
  description: string;
  amountIncl: number;
  direction: string;
  reviewReason?: string;
  legalBasis: string;
};

export type AuditItem = {
  description: string;
  amountIncl: number;
  effectiveDirection: string;
  direction: string;
  vatRate: number | null;
  legalBasis: string;
};

export type EngineResult = {
  transactions: Record<string, unknown>[];
  items: Record<string, unknown>[];
  adjustments: Record<string, unknown>[];
  metrics: {
    /** @deprecated Compatibility fields; use vatReport.overzicht for financial truth. */
    totaal_incl_21: number;
    totaal_excl_21: number;
    totaal_incl_9: number;
    totaal_excl_9: number;
    totale_btw_21: number;
    totale_btw_9: number;
    niet_aftrekbare_btw: number;
    btw_eindsaldo: number;
    vatReport?: SafeVatReport;

    totalRevenueIncl: number;
    totalRevenueExcl: number;
    outputVat21: number;
    outputVat9: number;
    totalOutputVat: number;
    deductibleInputVat21: number;
    deductibleInputVat9: number;
    totalDeductibleInputVat: number;
    nonDeductibleVatBUA: number;
    euVerlegdVat: number;
    netVatResult: number;
    totalRowsProcessed: number;
    rowsRequiringReview: number;
  };
  validation: {
    status: string;
    validation_runs: number;
  };
  reviewQueue: ReviewItem[];
  auditTrail: AuditItem[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toLegacyMetrics(report: SafeVatReport): EngineResult["metrics"] {
  const trusted = report.transactions.filter((tx) => tx.vat.status === 'known');
  const income21 = trusted.filter((tx) => tx.type === 'income' && tx.classification === 'omzet_algemeen_21');
  const income9 = trusted.filter((tx) => tx.type === 'income' && tx.classification === 'omzet_verlaagd_9');

  const totalRevenueIncl = round2(trusted.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + tx.bedrag_incl, 0));
  const totalRevenueExcl = round2(trusted.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + (tx.bedrag_excl ?? 0), 0));

  return {
    totaal_incl_21: round2(income21.reduce((sum, tx) => sum + tx.bedrag_incl, 0)),
    totaal_excl_21: round2(income21.reduce((sum, tx) => sum + (tx.bedrag_excl ?? 0), 0)),
    totaal_incl_9: round2(income9.reduce((sum, tx) => sum + tx.bedrag_incl, 0)),
    totaal_excl_9: round2(income9.reduce((sum, tx) => sum + (tx.bedrag_excl ?? 0), 0)),
    totale_btw_21: report.overzicht.verschuldigd.inkomsten_21,
    totale_btw_9: report.overzicht.verschuldigd.inkomsten_9,
    niet_aftrekbare_btw: report.overzicht.niet_aftrekbaar_ter_info,
    btw_eindsaldo: report.overzicht.netto_btw,
    vatReport: report,
    totalRevenueIncl,
    totalRevenueExcl,
    outputVat21: report.overzicht.verschuldigd.inkomsten_21,
    outputVat9: report.overzicht.verschuldigd.inkomsten_9,
    totalOutputVat: report.overzicht.verschuldigd.totaal,
    deductibleInputVat21: report.overzicht.aftrekbaar.uitgaven_21,
    deductibleInputVat9: report.overzicht.aftrekbaar.uitgaven_9,
    totalDeductibleInputVat: report.overzicht.aftrekbaar.totaal,
    nonDeductibleVatBUA: report.overzicht.niet_aftrekbaar_ter_info,
    euVerlegdVat: report.overzicht.verschuldigd.verlegde_btw,
    netVatResult: report.overzicht.netto_btw,
    totalRowsProcessed: report.audit.input_count,
    rowsRequiringReview: report.audit.unresolved_count,
  };
}

export async function processFile(file: File): Promise<EngineResult> {
  const text = await file.text();
  const rawTransactions = parseCsvToRawTransactions(text);
  if (rawTransactions.length === 0) throw new Error("Geen transacties uit het CSV-bestand kunnen worden gelezen.");

  const report = calculateVatReport(rawTransactions);
  const metrics = toLegacyMetrics(report);
  const escalation = vindEscalatieKandidaten(report);

  const reviewQueue: ReviewItem[] = escalation.map((candidate) => ({
    description: candidate.transactie.description ?? '',
    amountIncl: candidate.transactie.amount_incl_input,
    direction: candidate.transactie.type === 'income' ? 'INKOMST' : 'UITGAVE',
    reviewReason: candidate.transactie.herkenningsbron,
    legalBasis: candidate.transactie.applied_rule.korte_toelichting,
  }));

  const auditTrail: AuditItem[] = report.transactions.map((tx) => ({
    description: tx.description ?? '',
    amountIncl: tx.bedrag_incl,
    effectiveDirection: tx.type === 'income' ? 'INKOMST' : 'UITGAVE',
    direction: tx.type === 'income' ? 'INKOMST' : 'UITGAVE',
    vatRate: tx.vat.status === 'known' ? tx.vat.rate : null,
    legalBasis: tx.applied_rule.korte_toelichting,
  }));

  return {
    transactions: report.transactions as unknown as Record<string, unknown>[],
    items: [],
    adjustments: [],
    metrics,
    validation: {
      status: report.audit.ok ? 'SUCCESS_SAFE_BOUNDARY' : 'REVIEW_REQUIRED',
      validation_runs: 1,
    },
    reviewQueue,
    auditTrail,
  };
}

export async function processFiles(files: File[]): Promise<EngineResult> {
  if (files.length === 0) {
    return {
      transactions: [], items: [], adjustments: [],
      metrics: {
        totaal_incl_21: 0, totaal_excl_21: 0, totaal_incl_9: 0, totaal_excl_9: 0,
        totale_btw_21: 0, totale_btw_9: 0, niet_aftrekbare_btw: 0, btw_eindsaldo: 0,
        totalRevenueIncl: 0, totalRevenueExcl: 0, outputVat21: 0, outputVat9: 0,
        totalOutputVat: 0, deductibleInputVat21: 0, deductibleInputVat9: 0,
        totalDeductibleInputVat: 0, nonDeductibleVatBUA: 0, euVerlegdVat: 0,
        netVatResult: 0, totalRowsProcessed: 0, rowsRequiringReview: 0,
      },
      validation: { status: 'EMPTY_INPUT', validation_runs: 0 }, reviewQueue: [], auditTrail: [],
    };
  }
  const texts = await Promise.all(files.map((f) => f.text()));
  const combinedText = texts.join("\n");
  return processFile(new File([combinedText], "combined.csv", { type: "text/csv" }));
}
