import {
  autoClassify,
  type RawTransaction,
  type ClassificationMap,
  type AiProposalMap,
  type CalculateVatReportOptions,
  type BoekhouderBeoordeling,
  type ClassificationKey,
  type TransactionTableRow,
  type BtwPercentage,
} from './btwEngine';
import { BOEKHOUDER_PERCENTAGE_OPTIES, genereerStabielTransactieId } from './btwEngine';

export type { RawTransaction, ClassificationMap, AiProposalMap, CalculateVatReportOptions, BoekhouderBeoordeling, BtwPercentage };
export { genereerStabielTransactieId, BOEKHOUDER_PERCENTAGE_OPTIES };

/**
 * The only fiscal VAT representation exposed by the safety boundary.
 * Unknown is intentionally not representable as rate 0 or amount 0.
 */
export type SafeVat =
  | { status: 'known'; rate: 0 | 9 | 21; amount: number }
  | { status: 'unknown'; rate: null; amount: null };

export type SafeClassificationKey = ClassificationKey | 'twijfel_onvoldoende_informatie';

export interface SafeAppliedRule {
  classification: SafeClassificationKey;
  wetsartikel: string;
  omschrijving: string;
  korte_toelichting: string;
  rubriek: string;
}

export interface SafeProcessedTransaction {
  id: string;
  date?: string;
  type: 'income' | 'expense';
  description?: string;
  classification: SafeClassificationKey;
  amount_incl_input: number;
  bedrag_excl: number | null;
  bedrag_incl: number;
  aftrekbaar: boolean;
  applied_rule: SafeAppliedRule;
  herkend: boolean;
  herkenningsbron: string;
  classificatie_bron: string;
  ai_voorstellen?: ClassificationKey[];
  zekerheid: 'hoog' | 'gemiddeld' | 'laag';
  vat: SafeVat;
}

export interface SafeVatOverview {
  verschuldigd: {
    inkomsten_21: number;
    inkomsten_9: number;
    verlegde_btw: number;
    totaal: number;
  };
  aftrekbaar: {
    uitgaven_21: number;
    uitgaven_9: number;
    verlegde_btw: number;
    totaal: number;
  };
  niet_aftrekbaar_ter_info: number;
  netto_btw: number;
  status: 'af_te_dragen' | 'terug_te_vorderen';
  toelichting: string;
}

export interface SafeVatAudit {
  ok: boolean;
  problemen: string[];
  input_count: number;
  trusted_count: number;
  unresolved_count: number;
  ignored_count: number;
  financial_output_vat: number;
  financial_input_vat: number;
  identity_difference: number;
}

export interface SafeVatReport {
  transactions: SafeProcessedTransaction[];
  overzicht: SafeVatOverview;
  breakdown: {
    verschuldigde_btw_omzet_21: number;
    verschuldigde_btw_omzet_9: number;
    verlegde_btw_rubriek_2a: number;
    aftrekbare_btw_kosten_21: number;
    aftrekbare_btw_kosten_9: number;
    verschuldigde_btw_totaal: number;
    aftrekbare_btw_totaal: number;
  };
  btw_eindsaldo: number;
  herkenning: {
    totaal_transacties: number;
    automatisch_herkend: number;
    standaard_toegepast: number;
    percentage_herkend: number;
    controle_aanbevolen: SafeProcessedTransaction[];
  };
  audit: SafeVatAudit;
  genegeerde_samenvattingsregels: Array<{ id: string; reden: string }>;
  mogelijke_dubbele_transacties: string[][];
}

export type VatReport = SafeVatReport;

const DOUBT: SafeClassificationKey = 'twijfel_onvoldoende_informatie';
const VALID_RATES = new Set<number>([0, 9, 21]);
const VALID_CLASSIFICATIONS = new Set<string>([
  'omzet_algemeen_21', 'omzet_verlaagd_9', 'omzet_vrijgesteld_0',
  'kosten_algemeen_21', 'kosten_verlaagd_9', 'horeca_bua_9',
  'kosten_vrijgesteld_0', 'verlegd_21', 'prive_geen_btw',
]);

const SUMMARY_TERMS = [
  'eindtotaal', 'subtotaal', 'totaalbedrag', 'eindsaldo', 'btw eindsaldo', 'btw-eindsaldo',
  'totale btw', 'btw totaal', 'btw-totaal', 'btw verschuldigd', 'btw aftrekbaar',
  'voorbelasting totaal', 'te betalen btw', 'terug te ontvangen btw', 'terug te vorderen btw',
  'saldo btw', 'jaaroverzicht', 'kwartaaltotaal', 'maandtotaal', 'weektotaal', 'omzet totaal',
  'totale omzet', 'kostentotaal', 'totale kosten', 'samenvatting', 'grand total',
];
const SUMMARY_FIRST = new Set(['totaal', 'saldo', 'eindtotaal']);

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Money is represented in integer cents for all VAT calculations. */
function toCents(amount: number): number {
  if (!finite(amount)) throw new Error('BTW safety: bedrag moet een eindig getal zijn.');
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('BTW safety: bedrag is te groot voor veilige cent-berekening.');
  return cents;
}

function fromCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new Error('BTW safety: ongeldige centwaarde.');
  return cents / 100;
}

function roundRatio(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('BTW safety: ongeldige afrondingsberekening.');
  }
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(numerator) / denominator);
}

function vatFromGrossCents(grossCents: number, rate: 0 | 9 | 21): number {
  if (rate === 0) return 0;
  return roundRatio(grossCents * rate, 100 + rate);
}

function isIncomeClassification(value: string): boolean {
  return value.startsWith('omzet_');
}

function isExpenseClassification(value: string): boolean {
  return value.startsWith('kosten_') || value === 'horeca_bua_9' || value === 'verlegd_21' || value === 'prive_geen_btw';
}

function isReverseCharge(value: string): boolean {
  return value === 'verlegd_21';
}

function isNonDeductible(value: string): boolean {
  return value === 'horeca_bua_9' || value === 'kosten_vrijgesteld_0' || value === 'prive_geen_btw';
}

function validateInput(rows: unknown): asserts rows is RawTransaction[] {
  if (!Array.isArray(rows)) throw new Error('BTW safety: transacties moeten een array zijn.');
  const ids = new Set<string>();
  for (const tx of rows) {
    if (!tx || typeof tx !== 'object') throw new Error('BTW safety: ongeldige transactie.');
    if (typeof tx.id !== 'string' || !tx.id.trim()) throw new Error('BTW safety: transactie zonder geldig ID.');
    if (ids.has(tx.id)) throw new Error(`BTW safety: dubbel transactie-ID ${tx.id}.`);
    ids.add(tx.id);
    if (tx.type !== 'income' && tx.type !== 'expense') throw new Error(`BTW safety: ongeldige transactierichting ${tx.id}.`);
    if (!finite(tx.amount_incl)) throw new Error(`BTW safety: ongeldig bedrag ${tx.id}.`);
    toCents(tx.amount_incl);
  }
}

function validateOverrides(
  rows: RawTransaction[],
  classifications: ClassificationMap,
  percentageOverrides: Record<string, BoekhouderBeoordeling>,
): void {
  const ids = new Map(rows.map((x) => [x.id, x.type]));

  for (const [id, value] of Object.entries(classifications)) {
    const type = ids.get(id);
    if (!type) throw new Error(`BTW safety: classificatie-override voor onbekende transactie ${id}.`);
    if (!VALID_CLASSIFICATIONS.has(value)) throw new Error(`BTW safety: ongeldige classificatie-override voor ${id}.`);
    if (percentageOverrides[id]) throw new Error(`BTW safety: zowel classificatie- als percentage-override voor ${id}.`);
    if ((type === 'income' && !isIncomeClassification(value)) || (type === 'expense' && !isExpenseClassification(value))) {
      throw new Error(`BTW safety: classificatie-override ${value} past niet bij ${type}-transactie ${id}.`);
    }
  }

  for (const [id, value] of Object.entries(percentageOverrides)) {
    if (!ids.has(id)) throw new Error(`BTW safety: percentage-override voor onbekende transactie ${id}.`);
    if (!value || typeof value !== 'object' || !VALID_RATES.has((value as { percentage?: unknown }).percentage as number)) {
      throw new Error(`BTW safety: ongeldig BTW-percentage voor ${id}.`);
    }
    if (typeof value.beoordeeld_door !== 'string' || value.beoordeeld_door.trim() === '') {
      throw new Error(`BTW safety: percentage-override voor ${id} mist een geldige menselijke beoordelaar.`);
    }
    if (!Number.isFinite(value.percentage) || !Number.isInteger(value.percentage)) {
      throw new Error(`BTW safety: BTW-percentage voor ${id} moet een eindig geheel getal zijn.`);
    }
  }
}

function summaryCheck(tx: RawTransaction): string | null {
  const text = norm(`${tx.description ?? ''} ${tx.memo ?? ''}`);
  const term = SUMMARY_TERMS.find((x) => text.includes(x));
  if (term) return `Samenvattingsregel: omschrijving bevat "${term}".`;
  const first = norm(tx.description).split(' ')[0] ?? '';
  if (SUMMARY_FIRST.has(first)) return 'Samenvattingsregel: omschrijving begint met totaal/saldo/eindtotaal.';
  return null;
}

function makeRule(classification: SafeClassificationKey, reason: string, summary = false): SafeAppliedRule {
  return {
    classification,
    wetsartikel: summary ? 'Niet van toepassing: samenvattingsregel' : 'Fiscale grondslag vereist controle van de onderliggende factuur/brongegevens',
    omschrijving: summary
      ? 'Deze regel is structureel als samenvatting herkend en wordt niet als individuele transactie verwerkt.'
      : 'De transactie is niet automatisch financieel geaccepteerd zonder voldoende classificatiebewijs.',
    korte_toelichting: reason,
    rubriek: summary ? 'Genegeerde samenvattingsregel' : 'Twijfelgeval — niet meegenomen in financiële BTW-totalen',
  };
}

function unresolved(tx: RawTransaction, reason: string): SafeProcessedTransaction {
  return {
    id: tx.id,
    date: tx.date,
    type: tx.type,
    description: tx.description,
    classification: DOUBT,
    amount_incl_input: tx.amount_incl,
    bedrag_excl: null,
    bedrag_incl: tx.amount_incl,
    aftrekbaar: false,
    applied_rule: makeRule(DOUBT, reason),
    herkend: false,
    herkenningsbron: reason,
    classificatie_bron: 'twijfel_onvoldoende_informatie',
    zekerheid: 'laag',
    vat: { status: 'unknown', rate: null, amount: null },
  };
}

function calculateKnown(
  tx: RawTransaction,
  classification: ClassificationKey,
  source: string,
  certainty: 'hoog' | 'gemiddeld' | 'laag',
): SafeProcessedTransaction {
  const grossCents = toCents(tx.amount_incl);
  let rate: 0 | 9 | 21;
  switch (classification) {
    case 'omzet_verlaagd_9':
    case 'kosten_verlaagd_9':
    case 'horeca_bua_9': rate = 9; break;
    case 'omzet_algemeen_21':
    case 'kosten_algemeen_21':
    case 'verlegd_21': rate = 21; break;
    case 'omzet_vrijgesteld_0':
    case 'kosten_vrijgesteld_0':
    case 'prive_geen_btw': rate = 0; break;
    default: throw new Error(`BTW safety: onbekende classificatie ${classification}.`);
  }

  const vatCents = vatFromGrossCents(grossCents, rate);
  const netCents = grossCents - vatCents;
  const deduct = tx.type === 'expense' && !isNonDeductible(classification);

  return {
    id: tx.id,
    date: tx.date,
    type: tx.type,
    description: tx.description,
    classification,
    amount_incl_input: tx.amount_incl,
    bedrag_excl: fromCents(netCents),
    bedrag_incl: tx.amount_incl,
    aftrekbaar: deduct,
    applied_rule: makeRule(classification, source),
    herkend: true,
    herkenningsbron: source,
    classificatie_bron: source,
    zekerheid: certainty,
    vat: { status: 'known', rate, amount: fromCents(vatCents) },
  };
}

/**
 * Explicit policy for what may cross the financial boundary automatically.
 * Combined deterministic signals are accepted; AI statuses are accepted only
 * when supplied by a real external classifier. This safe boundary itself does
 * not invent AI proposals.
 */
function isTrustedSource(source: string): boolean {
  return source === 'automatisch_regelgebaseerd'
    || source === 'automatisch_omschrijving'
    || source === 'automatisch_gecombineerd'
    || source === 'ai_consensus_unaniem'
    || source === 'ai_consensus_meerderheid'
    || source === 'handmatig'
    || source === 'handmatig_percentage';
}

/** The single official unresolved definition for the safe model. */
export function isTwijfelgeval(tx: SafeProcessedTransaction): boolean {
  return tx.vat.status === 'unknown';
}

function findDuplicateGroups(rows: RawTransaction[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const tx of rows) {
    const key = `${tx.date ?? ''}|${norm(tx.description)}|${tx.type}|${tx.amount_incl.toFixed(2)}|${norm(tx.tegenrekening_iban)}`;
    const list = groups.get(key) ?? [];
    list.push(tx.id);
    groups.set(key, list);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

function buildOverview(rows: SafeProcessedTransaction[]): SafeVatOverview {
  let output21 = 0;
  let output9 = 0;
  let reverseOutput = 0;
  let input21 = 0;
  let input9 = 0;
  let reverseInput = 0;
  let nonDeductible = 0;

  for (const tx of rows) {
    if (tx.vat.status !== 'known') continue;
    const vat = tx.vat.amount;
    if (tx.type === 'income') {
      if (tx.classification === 'omzet_algemeen_21') output21 += vat;
      else if (tx.classification === 'omzet_verlaagd_9') output9 += vat;
      else if (isReverseCharge(tx.classification)) reverseOutput += vat;
    } else {
      if (tx.classification === 'kosten_algemeen_21' && tx.aftrekbaar) input21 += vat;
      else if (tx.classification === 'kosten_verlaagd_9' && tx.aftrekbaar) input9 += vat;
      else if (isReverseCharge(tx.classification)) {
        reverseOutput += vat;
        if (tx.aftrekbaar) reverseInput += vat;
      } else if (isNonDeductible(tx.classification)) nonDeductible += vat;
    }
  }

  output21 = fromCents(toCents(output21));
  output9 = fromCents(toCents(output9));
  reverseOutput = fromCents(toCents(reverseOutput));
  input21 = fromCents(toCents(input21));
  input9 = fromCents(toCents(input9));
  reverseInput = fromCents(toCents(reverseInput));
  nonDeductible = fromCents(toCents(nonDeductible));

  const outputTotal = fromCents(toCents(output21 + output9 + reverseOutput));
  const inputTotal = fromCents(toCents(input21 + input9 + reverseInput));
  const net = fromCents(toCents(outputTotal - inputTotal));

  return {
    verschuldigd: { inkomsten_21: output21, inkomsten_9: output9, verlegde_btw: reverseOutput, totaal: outputTotal },
    aftrekbaar: { uitgaven_21: input21, uitgaven_9: input9, verlegde_btw: reverseInput, totaal: inputTotal },
    niet_aftrekbaar_ter_info: nonDeductible,
    netto_btw: net,
    status: net >= 0 ? 'af_te_dragen' : 'terug_te_vorderen',
    toelichting: `${outputTotal.toFixed(2)} verschuldigde BTW − ${inputTotal.toFixed(2)} aftrekbare voorbelasting = ${net.toFixed(2)} netto BTW`,
  };
}

function independentAudit(rows: SafeProcessedTransaction[], overview: SafeVatOverview): { output: number; input: number; net: number; difference: number; problems: string[] } {
  let outputCents = 0;
  let inputCents = 0;
  for (const tx of rows) {
    if (tx.vat.status !== 'known') continue;
    const vatCents = toCents(tx.vat.amount);
    if (tx.type === 'income' && (tx.classification.startsWith('omzet_') || isReverseCharge(tx.classification))) outputCents += vatCents;
    if (tx.type === 'expense' && tx.aftrekbaar) inputCents += vatCents;
  }
  const output = fromCents(outputCents);
  const input = fromCents(inputCents);
  const net = fromCents(outputCents - inputCents);
  const problems: string[] = [];
  if (output !== overview.verschuldigd.totaal) problems.push(`Onafhankelijke outputcontrole faalt: transacties ${output.toFixed(2)} != rapport ${overview.verschuldigd.totaal.toFixed(2)}.`);
  if (input !== overview.aftrekbaar.totaal) problems.push(`Onafhankelijke inputcontrole faalt: transacties ${input.toFixed(2)} != rapport ${overview.aftrekbaar.totaal.toFixed(2)}.`);
  if (net !== overview.netto_btw) problems.push(`Onafhankelijke nettocontrole faalt: transacties ${net.toFixed(2)} != rapport ${overview.netto_btw.toFixed(2)}.`);
  if (rows.some((tx) => isTwijfelgeval(tx) && (tx.vat.rate !== null || tx.vat.amount !== null))) problems.push('Unknown-transactie bevat onverwacht een numeriek BTW-resultaat.');
  return { output, input, net, difference: net - overview.netto_btw, problems };
}

export function calculateVatReport(rawTransactions: RawTransaction[], options: CalculateVatReportOptions = {}): SafeVatReport {
  validateInput(rawTransactions);
  const classifications = options.classifications ?? {};
  const percentageOverrides = options.percentageOverrides ?? {};
  validateOverrides(rawTransactions, classifications, percentageOverrides);

  // AI is not connected to this production boundary. Never simulate it.
  if (options.aiProposals && Object.keys(options.aiProposals).length > 0) {
    throw new Error('BTW safety: AI-classificatie is niet aangesloten; gebruik een expliciete menselijke beoordeling.');
  }

  // Structural filtering occurs before classification or fiscal calculation.
  const candidates: RawTransaction[] = [];
  const ignored: Array<{ id: string; reden: string }> = [];
  for (const tx of rawTransactions) {
    const reason = summaryCheck(tx);
    if (reason) ignored.push({ id: tx.id, reden: reason });
    else candidates.push(tx);
  }

  const unresolvedRows: SafeProcessedTransaction[] = [];
  const trustedRows: SafeProcessedTransaction[] = [];

  for (const tx of candidates) {
    if (classifications[tx.id]) {
      trustedRows.push(calculateKnown(tx, classifications[tx.id], 'handmatig', 'hoog'));
      continue;
    }

    if (percentageOverrides[tx.id]) {
      const percentage = percentageOverrides[tx.id].percentage;
      const classification: ClassificationKey = tx.type === 'income'
        ? (percentage === 21 ? 'omzet_algemeen_21' : percentage === 9 ? 'omzet_verlaagd_9' : 'omzet_vrijgesteld_0')
        : (percentage === 21 ? 'kosten_algemeen_21' : percentage === 9 ? 'kosten_verlaagd_9' : 'kosten_vrijgesteld_0');
      trustedRows.push(calculateKnown(tx, classification, 'handmatig_percentage', 'hoog'));
      continue;
    }

    const auto = autoClassify(tx.description, tx.type, tx.memo, tx.tegenrekening_iban);
    if (auto.herkend && isTrustedSource(auto.bron) && VALID_CLASSIFICATIONS.has(auto.classification)) {
      trustedRows.push(calculateKnown(tx, auto.classification as ClassificationKey, auto.bron, auto.zekerheid === 'hoog' ? 'hoog' : 'gemiddeld'));
    } else {
      unresolvedRows.push(unresolved(tx, auto.herkenningsbron || 'Onvoldoende informatie voor automatische fiscale classificatie.'));
    }
  }

  const transactions = [...trustedRows, ...unresolvedRows];
  const overview = buildOverview(trustedRows);
  const reconciliation = independentAudit(trustedRows, overview);
  const problems = [...reconciliation.problems];
  const inputCount = rawTransactions.length;
  const trustedCount = trustedRows.length;
  const unresolvedCount = unresolvedRows.length;
  const ignoredCount = ignored.length;
  if (trustedCount + unresolvedCount + ignoredCount !== inputCount) {
    problems.push(`Regelaantal-controle faalt: zeker (${trustedCount}) + twijfel (${unresolvedCount}) + genegeerd (${ignoredCount}) != input (${inputCount}).`);
  }

  const duplicates = findDuplicateGroups(rawTransactions);
  if (duplicates.length > 0) problems.push(`Mogelijke dubbele transacties gevonden: ${duplicates.length} groep(en).`);

  const output21 = fromCents(trustedRows.filter((tx) => tx.classification === 'omzet_algemeen_21' && tx.vat.status === 'known').reduce((s, tx) => s + toCents(tx.vat.status === 'known' ? tx.vat.amount : 0), 0));
  const output9 = fromCents(trustedRows.filter((tx) => tx.classification === 'omzet_verlaagd_9' && tx.vat.status === 'known').reduce((s, tx) => s + toCents(tx.vat.status === 'known' ? tx.vat.amount : 0), 0));
  const reverse = fromCents(trustedRows.filter((tx) => isReverseCharge(tx.classification) && tx.type === 'expense' && tx.vat.status === 'known').reduce((s, tx) => s + toCents(tx.vat.status === 'known' ? tx.vat.amount : 0), 0));
  const input21 = fromCents(trustedRows.filter((tx) => tx.classification === 'kosten_algemeen_21' && tx.aftrekbaar && tx.vat.status === 'known').reduce((s, tx) => s + toCents(tx.vat.status === 'known' ? tx.vat.amount : 0), 0));
  const input9 = fromCents(trustedRows.filter((tx) => tx.classification === 'kosten_verlaagd_9' && tx.aftrekbaar && tx.vat.status === 'known').reduce((s, tx) => s + toCents(tx.vat.status === 'known' ? tx.vat.amount : 0), 0));

  return {
    transactions,
    overzicht: overview,
    breakdown: {
      verschuldigde_btw_omzet_21: output21,
      verschuldigde_btw_omzet_9: output9,
      verlegde_btw_rubriek_2a: reverse,
      aftrekbare_btw_kosten_21: input21,
      aftrekbare_btw_kosten_9: input9,
      verschuldigde_btw_totaal: overview.verschuldigd.totaal,
      aftrekbare_btw_totaal: overview.aftrekbaar.totaal,
    },
    btw_eindsaldo: overview.netto_btw,
    herkenning: {
      totaal_transacties: inputCount,
      automatisch_herkend: trustedCount,
      standaard_toegepast: unresolvedCount,
      percentage_herkend: inputCount === 0 ? 0 : fromCents(toCents((trustedCount / inputCount) * 100)),
      controle_aanbevolen: unresolvedRows,
    },
    audit: {
      ok: problems.length === 0,
      problemen: problems,
      input_count: inputCount,
      trusted_count: trustedCount,
      unresolved_count: unresolvedCount,
      ignored_count: ignoredCount,
      financial_output_vat: reconciliation.output,
      financial_input_vat: reconciliation.input,
      identity_difference: reconciliation.difference,
    },
    genegeerde_samenvattingsregels: ignored,
    mogelijke_dubbele_transacties: duplicates,
  };
}

export function berekenBetrouwbaarheidsscore(report: SafeVatReport): number {
  let score = 100;
  if (!report.audit.ok) score -= Math.min(50, report.audit.problemen.length * 10);
  if (report.audit.input_count > 0) score -= (report.audit.unresolved_count / report.audit.input_count) * 20;
  score -= Math.min(10, report.mogelijke_dubbele_transacties.length * 2);
  return Math.max(0, Math.min(100, Number(score.toFixed(2))));
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
      btw: twijfel ? 'Onbekend' : `${tx.vat.status === 'known' ? tx.vat.rate : 'Onbekend'}%`,
      toegepaste_regel: tx.applied_rule.korte_toelichting,
    };
    (twijfel ? twijfelgevallen : zeker).push(row);
  }
  return { zeker, twijfelgevallen };
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
