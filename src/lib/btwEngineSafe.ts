import {
  calculateVatReport as legacyCalculateVatReport,
  autoClassify,
  type VatReport as LegacyVatReport,
  type RawTransaction,
  type ClassificationMap,
  type AiProposalMap,
  type CalculateVatReportOptions,
  type BoekhouderBeoordeling,
  type ClassificationKey,
  type ProcessedTransaction as LegacyProcessedTransaction,
  type AppliedRule,
  type TransactionTableRow,
  type BtwPercentage,
} from './btwEngine';

export type { RawTransaction, ClassificationMap, AiProposalMap, CalculateVatReportOptions, BoekhouderBeoordeling, BtwPercentage };

/** Unknown VAT is structurally different from a real 0% VAT transaction. */
export type SafeVat =
  | { status: 'known'; rate: 0 | 9 | 21; amount: number }
  | { status: 'unknown'; rate: null; amount: null };

export type SafeProcessedTransaction = Omit<LegacyProcessedTransaction, 'rate' | 'btw_bedrag'> & {
  rate: 0 | 9 | 21 | null;
  btw_bedrag: number | null;
  vat: SafeVat;
};

export type SafeVatReport = Omit<LegacyVatReport, 'transactions' | 'audit'> & {
  transactions: SafeProcessedTransaction[];
  audit: LegacyVatReport['audit'] & {
    input_count: number;
    trusted_count: number;
    unresolved_count: number;
    ignored_count: number;
    financial_output_vat: number;
    financial_input_vat: number;
    identity_difference: number;
  };
};

export type { SafeVatReport as VatReport };
export { genereerStabielTransactieId, BOEKHOUDER_PERCENTAGE_OPTIES, berekenBetrouwbaarheidsscore } from './btwEngine';

const DOUBT = 'twijfel_onvoldoende_informatie' as ClassificationKey;
const VALID_CLASSIFICATIONS = new Set<string>([
  'omzet_algemeen_21','omzet_verlaagd_9','omzet_vrijgesteld_0','kosten_algemeen_21',
  'kosten_verlaagd_9','horeca_bua_9','kosten_vrijgesteld_0','verlegd_21','prive_geen_btw'
]);
const VALID_RATES = new Set([0, 9, 21]);
const SUMMARY_TERMS = [
  'eindtotaal','subtotaal','totaalbedrag','eindsaldo','btw eindsaldo','btw-eindsaldo',
  'totale btw','btw totaal','btw-totaal','btw verschuldigd','btw aftrekbaar','voorbelasting totaal',
  'te betalen btw','terug te ontvangen btw','terug te vorderen btw','saldo btw','jaaroverzicht',
  'kwartaaltotaal','maandtotaal','weektotaal','omzet totaal','totale omzet','kostentotaal',
  'totale kosten','samenvatting','totaal incl','totaal excl','grand total'
];
const SUMMARY_FIRST = new Set(['totaal','saldo','eindtotaal']);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function validateInput(rows: RawTransaction[]) {
  const ids = new Set<string>();
  for (const tx of rows) {
    if (!tx || typeof tx.id !== 'string' || !tx.id.trim()) throw new Error('BTW safety: transactie zonder geldig ID.');
    if (ids.has(tx.id)) throw new Error(`BTW safety: dubbel transactie-ID ${tx.id}.`);
    ids.add(tx.id);
    if (tx.type !== 'income' && tx.type !== 'expense') throw new Error(`BTW safety: ongeldige transactierichting ${tx.id}.`);
    if (!finite(tx.amount_incl)) throw new Error(`BTW safety: ongeldig bedrag ${tx.id}.`);
  }
}

function validateOverrides(rows: RawTransaction[], classifications: ClassificationMap, overrides: Record<string, BoekhouderBeoordeling>) {
  const ids = new Set(rows.map(x => x.id));
  for (const [id, value] of Object.entries(classifications)) {
    if (!ids.has(id)) throw new Error(`BTW safety: classificatie-override voor onbekende transactie ${id}.`);
    if (!VALID_CLASSIFICATIONS.has(value)) throw new Error(`BTW safety: ongeldige classificatie-override voor ${id}.`);
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (!ids.has(id)) throw new Error(`BTW safety: percentage-override voor onbekende transactie ${id}.`);
    if (!value || !VALID_RATES.has(value.percentage)) throw new Error(`BTW safety: ongeldig BTW-percentage voor ${id}.`);
    if (value.beoordeeld_door !== undefined && typeof value.beoordeeld_door !== 'string') throw new Error(`BTW safety: ongeldige beoordelaar voor ${id}.`);
  }
}

function summaryCheck(tx: RawTransaction, total: number, others: number) {
  const text = norm(`${tx.description ?? ''} ${tx.memo ?? ''}`);
  const term = SUMMARY_TERMS.find(x => text.includes(x));
  if (term) return `Samenvattingsregel: omschrijving bevat "${term}".`;
  if (SUMMARY_FIRST.has(norm(tx.description).split(' ')[0] ?? '')) return 'Samenvattingsregel: omschrijving begint met totaal/saldo/eindtotaal.';
  if (others >= 2 && total - tx.amount_incl > 0 && Math.abs(tx.amount_incl - (total - tx.amount_incl)) <= 0.01) return 'Samenvattingsregel: bedrag komt overeen met de som van de overige regels.';
  return null;
}

function unresolved(tx: RawTransaction, reason: string): SafeProcessedTransaction {
  const rule: AppliedRule = {
    classification: DOUBT,
    wetsartikel: 'Niet automatisch vast te stellen op basis van beschikbare transactiegegevens',
    omschrijving: 'Onvoldoende informatie om de fiscale behandeling betrouwbaar vast te stellen. Niet financieel meegenomen totdat een boekhouder de classificatie bevestigt.',
    korte_toelichting: reason,
    rubriek: 'Twijfelgeval — niet meegenomen in financiële BTW-totalen',
  };
  return {
    id: tx.id, date: tx.date, type: tx.type, description: tx.description,
    classification: DOUBT, rate: null, amount_incl_input: tx.amount_incl,
    bedrag_excl: tx.amount_incl, btw_bedrag: null, bedrag_incl: tx.amount_incl,
    _bedrag_excl_precisie: tx.amount_incl, _btw_bedrag_precisie: 0,
    aftrekbaar: false, applied_rule: rule, herkend: false,
    herkenningsbron: reason, classificatie_bron: 'conflict_gedetecteerd', zekerheid: 'laag',
    vat: { status: 'unknown', rate: null, amount: null },
  };
}

function known(tx: LegacyProcessedTransaction): SafeProcessedTransaction {
  const rate = tx.rate as 0 | 9 | 21;
  return { ...tx, rate, btw_bedrag: tx.btw_bedrag, vat: { status: 'known', rate, amount: tx.btw_bedrag } };
}

function automaticTrusted(a: ReturnType<typeof autoClassify>) {
  return a.herkend && (a.bron === 'automatisch_regelgebaseerd' || a.bron === 'automatisch_omschrijving');
}

export function isTwijfelgeval(tx: SafeProcessedTransaction) {
  return tx.vat.status === 'unknown' || tx.herkend === false || tx.zekerheid === 'laag';
}

export function calculateVatReport(rawTransactions: RawTransaction[], options: CalculateVatReportOptions = {}): SafeVatReport {
  validateInput(rawTransactions);
  const classifications = options.classifications ?? {};
  const percentageOverrides = options.percentageOverrides ?? {};
  validateOverrides(rawTransactions, classifications, percentageOverrides);

  const total = rawTransactions.reduce((s, x) => s + x.amount_incl, 0);
  const candidates: RawTransaction[] = [];
  const ignored: Array<{ raw: RawTransaction; reden: string }> = [];
  for (const tx of rawTransactions) {
    const reason = summaryCheck(tx, total, rawTransactions.length - 1);
    if (reason) ignored.push({ raw: tx, reden: reason }); else candidates.push(tx);
  }

  const trusted: RawTransaction[] = [];
  const unresolvedRows: SafeProcessedTransaction[] = [];
  for (const tx of candidates) {
    if (classifications[tx.id] || percentageOverrides[tx.id]) { trusted.push(tx); continue; }
    const a = autoClassify(tx.description, tx.type, tx.memo, tx.tegenrekening_iban);
    if (automaticTrusted(a)) trusted.push(tx);
    else unresolvedRows.push(unresolved(tx, a.herkenningsbron || 'Onvoldoende informatie voor automatische fiscale classificatie.'));
  }

  const legacy = legacyCalculateVatReport(trusted, { classifications, aiProposals: {}, percentageOverrides });
  const knownRows = legacy.transactions.map(known);
  const transactions = [...knownRows, ...unresolvedRows];
  const problems = [...legacy.audit.problemen];
  const inputCount = rawTransactions.length;
  const trustedCount = knownRows.length;
  const unresolvedCount = unresolvedRows.length;
  const ignoredCount = ignored.length;
  if (trustedCount + unresolvedCount + ignoredCount !== inputCount) problems.push(`Regelaantal-controle faalt: zeker (${trustedCount}) + twijfel (${unresolvedCount}) + genegeerd (${ignoredCount}) != input (${inputCount}).`);

  const outputVat = round2(legacy.overzicht.verschuldigd.totaal);
  const inputVat = round2(legacy.overzicht.aftrekbaar.totaal);
  const expectedNet = round2(outputVat - inputVat);
  const identityDifference = round2(expectedNet - legacy.overzicht.netto_btw);
  if (identityDifference !== 0) problems.push(`Eindidentiteit faalt: verschuldigd (${outputVat}) - aftrekbaar (${inputVat}) != netto (${legacy.overzicht.netto_btw}).`);
  if (unresolvedRows.some(x => x.vat.status !== 'unknown' || x.vat.amount !== null)) problems.push('Safety-controle faalt: onbekende transactie heeft een financieel BTW-bedrag.');

  return {
    ...legacy,
    genegeerde_samenvattingsregels: ignored as unknown as LegacyVatReport['genegeerde_samenvattingsregels'],
    transactions,
    herkenning: {
      ...legacy.herkenning,
      totaal_transacties: inputCount,
      automatisch_herkend: trustedCount,
      standaard_toegepast: unresolvedCount,
      percentage_herkend: inputCount === 0 ? 0 : round2((trustedCount / inputCount) * 100),
      controle_aanbevolen: unresolvedRows as unknown as LegacyProcessedTransaction[],
    },
    audit: {
      ...legacy.audit,
      ok: problems.length === 0,
      problemen,
      input_count: inputCount,
      trusted_count: trustedCount,
      unresolved_count: unresolvedCount,
      ignored_count: ignoredCount,
      financial_output_vat: outputVat,
      financial_input_vat: inputVat,
      identity_difference: identityDifference,
    },
  };
}

export function vindEscalatieKandidaten(report: SafeVatReport) {
  return report.transactions.filter(isTwijfelgeval).map(tx => ({
    transactie: tx,
    aanbevolen_zoekacties: [
      `Controleer de onderliggende factuur/bon voor "${tx.description ?? ''}".`,
      'Controleer BTW-tarief, BTW-bedrag, BTW-id en eventuele tekst "btw verlegd".',
      'Controleer bij buitenlandse prestaties vestigingsplaats, B2B/B2C-status en verleggingsregeling.',
    ],
  }));
}

function formatEuro(n: number) { return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n); }

export function tweeKolommenWeergave(report: SafeVatReport): { zeker: TransactionTableRow[]; twijfelgevallen: TransactionTableRow[] } {
  const zeker: TransactionTableRow[] = [], twijfelgevallen: TransactionTableRow[] = [];
  for (const tx of report.transactions) {
    const row: TransactionTableRow = {
      transactie_id: tx.id,
      omschrijving: tx.description ?? '(geen omschrijving)',
      bedrag: formatEuro(tx.amount_incl_input),
      type: tx.type === 'income' ? 'Inkomsten' : 'Uitgaven',
      btw: isTwijfelgeval(tx) ? 'Onbekend' : `${tx.rate}%`,
      toegepaste_regel: tx.applied_rule.korte_toelichting,
    };
    (isTwijfelgeval(tx) ? twijfelgevallen : zeker).push(row);
  }
  return { zeker, twijfelgevallen };
}
