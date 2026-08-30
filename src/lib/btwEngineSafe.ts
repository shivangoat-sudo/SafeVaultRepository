import {
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
  calculateVatReport as legacyCalculateVatReport,
} from './btwEngine';

export type { RawTransaction, ClassificationMap, AiProposalMap, CalculateVatReportOptions, BoekhouderBeoordeling, BtwPercentage };
export { genereerStabielTransactieId, BOEKHOUDER_PERCENTAGE_OPTIES } from './btwEngine';

/** The fiscal result is discriminated: unknown can never be represented as 0%. */
export type SafeVat =
  | { status: 'known'; rate: 0 | 9 | 21; amount: number }
  | { status: 'unknown'; rate: null; amount: null };

/**
 * Safe transaction model deliberately removes the legacy numeric VAT fields.
 * Consumers must use `vat.status` before reading the fiscal result.
 */
export type SafeProcessedTransaction = Omit<
  LegacyProcessedTransaction,
  'rate' | 'btw_bedrag' | '_btw_bedrag_precisie' | '_bedrag_excl_precisie'
> & {
  vat: SafeVat;
};

export type SafeVatReport = Omit<LegacyVatReport, 'transactions' | 'audit' | 'overzicht' | 'breakdown' | 'btw_eindsaldo'> & {
  transactions: SafeProcessedTransaction[];
  overzicht: LegacyVatReport['overzicht'];
  breakdown: LegacyVatReport['breakdown'];
  btw_eindsaldo: number;
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

const DOUBT: ClassificationKey = 'twijfel_onvoldoende_informatie';
const VALID_CLASSIFICATIONS = new Set<string>([
  'omzet_algemeen_21', 'omzet_verlaagd_9', 'omzet_vrijgesteld_0', 'kosten_algemeen_21',
  'kosten_verlaagd_9', 'horeca_bua_9', 'kosten_vrijgesteld_0', 'verlegd_21', 'prive_geen_btw',
]);
const VALID_RATES = new Set<number>([0, 9, 21]);

const SUMMARY_TERMS = [
  'eindtotaal', 'subtotaal', 'totaalbedrag', 'eindsaldo', 'btw eindsaldo', 'btw-eindsaldo',
  'totale btw', 'btw totaal', 'btw-totaal', 'btw verschuldigd', 'btw aftrekbaar', 'voorbelasting totaal',
  'te betalen btw', 'terug te ontvangen btw', 'terug te vorderen btw', 'saldo btw', 'jaaroverzicht',
  'kwartaaltotaal', 'maandtotaal', 'weektotaal', 'omzet totaal', 'totale omzet', 'kostentotaal',
  'totale kosten', 'samenvatting', 'totaal incl', 'totaal excl', 'grand total',
];
const SUMMARY_FIRST = new Set(['totaal', 'saldo', 'eindtotaal']);

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function validateInput(rows: RawTransaction[]): void {
  const ids = new Set<string>();
  for (const tx of rows) {
    if (!tx || typeof tx.id !== 'string' || !tx.id.trim()) throw new Error('BTW safety: transactie zonder geldig ID.');
    if (ids.has(tx.id)) throw new Error(`BTW safety: dubbel transactie-ID ${tx.id}.`);
    ids.add(tx.id);
    if (tx.type !== 'income' && tx.type !== 'expense') throw new Error(`BTW safety: ongeldige transactierichting ${tx.id}.`);
    if (!finite(tx.amount_incl)) throw new Error(`BTW safety: ongeldig bedrag ${tx.id}.`);
  }
}

function validateOverrides(
  rows: RawTransaction[],
  classifications: ClassificationMap,
  overrides: Record<string, BoekhouderBeoordeling>,
): void {
  const ids = new Map(rows.map((x) => [x.id, x.type]));
  for (const [id, value] of Object.entries(classifications)) {
    const type = ids.get(id);
    if (!type) throw new Error(`BTW safety: classificatie-override voor onbekende transactie ${id}.`);
    if (!VALID_CLASSIFICATIONS.has(value)) throw new Error(`BTW safety: ongeldige classificatie-override voor ${id}.`);
    if (overrides[id]) throw new Error(`BTW safety: zowel classificatie- als percentage-override voor ${id}.`);
    const income = value.startsWith('omzet_');
    const expense = value.startsWith('kosten_') || value === 'horeca_bua_9' || value === 'verlegd_21' || value === 'prive_geen_btw';
    if ((type === 'income' && !income) || (type === 'expense' && !expense)) {
      throw new Error(`BTW safety: classificatie-override ${value} past niet bij ${type}-transactie ${id}.`);
    }
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (!ids.has(id)) throw new Error(`BTW safety: percentage-override voor onbekende transactie ${id}.`);
    if (!value || !VALID_RATES.has(value.percentage)) throw new Error(`BTW safety: ongeldig BTW-percentage voor ${id}.`);
    if (typeof value.beoordeeld_door !== 'string' || value.beoordeeld_door.trim() === '') {
      throw new Error(`BTW safety: percentage-override voor ${id} mist een geldige menselijke beoordelaar.`);
    }
  }
}

function summaryCheck(tx: RawTransaction, total: number, others: number): string | null {
  const text = norm(`${tx.description ?? ''} ${tx.memo ?? ''}`);
  const term = SUMMARY_TERMS.find((x) => text.includes(x));
  if (term) return `Samenvattingsregel: omschrijving bevat "${term}".`;
  if (SUMMARY_FIRST.has(norm(tx.description).split(' ')[0] ?? '')) return 'Samenvattingsregel: omschrijving begint met totaal/saldo/eindtotaal.';
  if (others >= 2 && total - tx.amount_incl > 0 && Math.abs(tx.amount_incl - (total - tx.amount_incl)) <= 0.01) {
    return 'Samenvattingsregel: bedrag komt overeen met de som van de overige regels.';
  }
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
    id: tx.id,
    date: tx.date,
    type: tx.type,
    description: tx.description,
    classification: DOUBT,
    amount_incl_input: tx.amount_incl,
    bedrag_excl: tx.amount_incl,
    bedrag_incl: tx.amount_incl,
    aftrekbaar: false,
    applied_rule: rule,
    herkend: false,
    herkenningsbron: reason,
    classificatie_bron: 'twijfel_onvoldoende_informatie',
    zekerheid: 'laag',
    vat: { status: 'unknown', rate: null, amount: null },
  };
}

function known(tx: LegacyProcessedTransaction): SafeProcessedTransaction {
  if (![0, 9, 21].includes(tx.rate) || !finite(tx.btw_bedrag)) {
    throw new Error(`BTW safety: legacy engine gaf een ongeldig fiscaal resultaat voor ${tx.id}.`);
  }
  return {
    id: tx.id,
    date: tx.date,
    type: tx.type,
    description: tx.description,
    classification: tx.classification,
    amount_incl_input: tx.amount_incl_input,
    bedrag_excl: tx.bedrag_excl,
    bedrag_incl: tx.bedrag_incl,
    aftrekbaar: tx.aftrekbaar,
    applied_rule: tx.applied_rule,
    herkend: true,
    herkenningsbron: tx.herkenningsbron,
    classificatie_bron: tx.classificatie_bron,
    ai_voorstellen: tx.ai_voorstellen,
    zekerheid: tx.zekerheid,
    vat: { status: 'known', rate: tx.rate, amount: tx.btw_bedrag },
  };
}

function automaticTrusted(a: ReturnType<typeof autoClassify>): boolean {
  return a.herkend && (a.bron === 'automatisch_regelgebaseerd' || a.bron === 'automatisch_omschrijving');
}

/** The single safe-layer definition of an unresolved transaction. */
export function isTwijfelgeval(tx: SafeProcessedTransaction): boolean {
  return tx.vat.status === 'unknown';
}

export function berekenBetrouwbaarheidsscore(report: SafeVatReport): number {
  let score = 100;
  if (!report.audit.ok) score -= Math.min(50, report.audit.problemen.length * 10);
  const total = report.audit.input_count;
  if (total > 0) score -= (report.audit.unresolved_count / total) * 20;
  score -= Math.min(10, report.mogelijke_dubbele_transacties.length * 2);
  return round2(Math.max(0, Math.min(100, score)));
}

export function calculateVatReport(rawTransactions: RawTransaction[], options: CalculateVatReportOptions = {}): SafeVatReport {
  validateInput(rawTransactions);
  const classifications = options.classifications ?? {};
  const percentageOverrides = options.percentageOverrides ?? {};
  validateOverrides(rawTransactions, classifications, percentageOverrides);

  // There is no AI classifier connected to this production boundary. Rejecting
  // proposals is safer than pretending an AI escalation actually happened.
  if (options.aiProposals && Object.keys(options.aiProposals).length > 0) {
    throw new Error('BTW safety: AI-classificatie is niet aangesloten op de productie-safety boundary; gebruik een expliciete menselijke beoordeling.');
  }

  // Structural filtering happens before any fiscal interpretation.
  const total = rawTransactions.reduce((sum, tx) => sum + tx.amount_incl, 0);
  const candidates: RawTransaction[] = [];
  const ignored: Array<{ raw: RawTransaction; reden: string }> = [];
  for (const tx of rawTransactions) {
    const reason = summaryCheck(tx, total, rawTransactions.length - 1);
    if (reason) ignored.push({ raw: tx, reden: reason });
    else candidates.push(tx);
  }

  const trusted: RawTransaction[] = [];
  const unresolvedRows: SafeProcessedTransaction[] = [];
  for (const tx of candidates) {
    // A human-reviewed override is explicit evidence and may enter the fiscal engine.
    if (classifications[tx.id] || percentageOverrides[tx.id]) {
      trusted.push(tx);
      continue;
    }

    const auto = autoClassify(tx.description, tx.type, tx.memo, tx.tegenrekening_iban);
    if (automaticTrusted(auto)) trusted.push(tx);
    else unresolvedRows.push(unresolved(tx, auto.herkenningsbron || 'Onvoldoende informatie voor automatische fiscale classificatie.'));
  }

  // The legacy module is used only as a controlled deterministic calculator for
  // already trusted rows. It never sees unresolved or summary rows.
  const legacy = legacyCalculateVatReport(trusted, {
    classifications,
    percentageOverrides,
    aiProposals: {},
  });
  const knownRows = legacy.transactions.map(known);
  const transactions = [...knownRows, ...unresolvedRows];

  const inputCount = rawTransactions.length;
  const trustedCount = knownRows.length;
  const unresolvedCount = unresolvedRows.length;
  const ignoredCount = ignored.length;
  const problems = [...legacy.audit.problemen];

  if (trustedCount + unresolvedCount + ignoredCount !== inputCount) {
    problems.push(`Regelaantal-controle faalt: zeker (${trustedCount}) + twijfel (${unresolvedCount}) + genegeerd (${ignoredCount}) != input (${inputCount}).`);
  }

  // Reconcile directly from safe, financially accepted transaction results.
  // No legacy aggregate is used to derive these values.
  const outputVat = round2(knownRows.reduce((sum, tx) => {
    if (tx.classification === 'verlegd_21') return sum + tx.vat.amount;
    return tx.type === 'income' ? sum + tx.vat.amount : sum;
  }, 0));
  const inputVat = round2(knownRows.reduce((sum, tx) => {
    return tx.type === 'expense' && tx.aftrekbaar ? sum + tx.vat.amount : sum;
  }, 0));
  const output21 = round2(knownRows.reduce((sum, tx) => tx.type === 'income' && tx.classification === 'omzet_algemeen_21' ? sum + tx.vat.amount : sum, 0));
  const output9 = round2(knownRows.reduce((sum, tx) => tx.type === 'income' && tx.classification === 'omzet_verlaagd_9' ? sum + tx.vat.amount : sum, 0));
  const reverse = round2(knownRows.reduce((sum, tx) => tx.classification === 'verlegd_21' ? sum + tx.vat.amount : sum, 0));
  const input21 = round2(knownRows.reduce((sum, tx) => tx.type === 'expense' && tx.aftrekbaar && tx.classification === 'kosten_algemeen_21' ? sum + tx.vat.amount : sum, 0));
  const input9 = round2(knownRows.reduce((sum, tx) => tx.type === 'expense' && tx.aftrekbaar && tx.classification === 'kosten_verlaagd_9' ? sum + tx.vat.amount : sum, 0));
  const nonDeductible = round2(knownRows.reduce((sum, tx) => tx.classification === 'horeca_bua_9' ? sum + tx.vat.amount : sum, 0));

  const net = round2(outputVat - inputVat);
  const overview = {
    verschuldigd: {
      inkomsten_21: output21,
      inkomsten_9: output9,
      verlegde_btw: reverse,
      totaal: round2(output21 + output9 + reverse),
    },
    aftrekbaar: {
      uitgaven_21: input21,
      uitgaven_9: input9,
      verlegde_btw: reverse,
      totaal: round2(input21 + input9 + reverse),
    },
    niet_aftrekbaar_ter_info: nonDeductible,
    netto_btw: net,
    status: net >= 0 ? 'af_te_dragen' as const : 'terug_te_vorderen' as const,
    toelichting: net >= 0
      ? `€${formatEuro(net)} verschuldigde BTW\n− €${formatEuro(inputVat)} aftrekbare voorbelasting\n= €${formatEuro(net)} af te dragen`
      : `€${formatEuro(outputVat)} verschuldigde BTW\n− €${formatEuro(inputVat)} aftrekbare voorbelasting\n= −€${formatEuro(Math.abs(net))}\n€${formatEuro(Math.abs(net))} terug te vorderen`,
  };

  const breakdown = {
    verschuldigde_btw_omzet_21: output21,
    verschuldigde_btw_omzet_9: output9,
    verlegde_btw_rubriek_2a: reverse,
    aftrekbare_btw_kosten_21: input21,
    aftrekbare_btw_kosten_9: input9,
    verschuldigde_btw_totaal: overview.verschuldigd.totaal,
    aftrekbare_btw_totaal: overview.aftrekbaar.totaal,
  };

  if (overview.verschuldigd.totaal !== outputVat) problems.push(`Onafhankelijke outputcontrole faalt: breakdown (${overview.verschuldigd.totaal}) != transacties (${outputVat}).`);
  if (overview.aftrekbaar.totaal !== inputVat) problems.push(`Onafhankelijke inputcontrole faalt: breakdown (${overview.aftrekbaar.totaal}) != transacties (${inputVat}).`);
  if (round2(overview.verschuldigd.totaal - overview.aftrekbaar.totaal) !== net) problems.push('Onafhankelijke netto-controle faalt.');
  if (unresolvedRows.some((tx) => tx.vat.status !== 'unknown' || tx.vat.rate !== null || tx.vat.amount !== null)) problems.push('Safety-controle faalt: onbekende transactie heeft een bekend BTW-resultaat.');

  return {
    ...legacy,
    transactions,
    overzicht: overview,
    breakdown,
    btw_eindsaldo: net,
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
      identity_difference: round2(net - overview.netto_btw),
    },
  };
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

export function vindEscalatieKandidaten(report: SafeVatReport) {
  return report.transactions.filter(isTwijfelgeval).map((tx) => ({
    transactie: tx,
    aanbevolen_zoekacties: [
      `Controleer de onderliggende factuur/bon voor "${tx.description ?? ''}".`,
      'Controleer BTW-tarief, BTW-bedrag, BTW-id en eventuele tekst "btw verlegd".',
      'Controleer bij buitenlandse prestaties vestigingsplaats, B2B/B2C-status en verleggingsregeling.',
    ],
  }));
}

export function tweeKolommenWeergave(report: SafeVatReport): { zeker: TransactionTableRow[]; twijfelgevallen: TransactionTableRow[] } {
  const zeker: TransactionTableRow[] = [];
  const twijfelgevallen: TransactionTableRow[] = [];
  for (const tx of report.transactions) {
    const twijfel = isTwijfelgeval(tx);
    const row: TransactionTableRow = {
      transactie_id: tx.id,
      omschrijving: tx.description ?? '(geen omschrijving)',
      bedrag: formatEuro(tx.amount_incl_input),
      type: tx.type === 'income' ? 'Inkomsten' : 'Uitgaven',
      btw: twijfel ? 'Onbekend' : `${tx.vat.rate}%`,
      toegepaste_regel: tx.applied_rule.korte_toelichting,
    };
    (twijfel ? twijfelgevallen : zeker).push(row);
  }
  return { zeker, twijfelgevallen };
}
