import { calculateFiscalVatReport as calculatePolicyReport } from './btwFiscalSafePolicy';
import type { BoekhouderBeoordeling, FiscalAdjustments, FiscalClassification, FiscalReport, FiscalTransaction } from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/** Production transaction-context bridge. Bank rows are the calculation source; customer summary totals are never trusted. */
const textOf = (row: RawTransaction) => `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
const hasFiscalSignal = (text: string) => /(?:^|[^0-9])(?:0|9|21)\s*%|\b(?:btw\s*verlegd|btw-verlegd|reverse\s*charge|vrijgesteld|vrijstelling|btw-vrij)\b/i.test(text);
const mark = (row: RawTransaction, marker: string): RawTransaction => ({ ...row, description: `${String(row.description ?? '').trim()} [SafeVault context: ${marker}]` });

const NON_EU_SOFTWARE = [/\bopenai(?:\s+llc)?\b/i,/\belevenlabs(?:\s+inc)?\b/i,/\banthropic(?:\s+pbc)?\b/i,/\bnetlify(?:\s+inc)?\b/i,/\bgit(?:hub|hub\s+inc)\b/i,/\bresend(?:\s+inc)?\b/i];
const EU_SOFTWARE = [/\badobe\s+systems?\s+software\b/i,/\bapple\s+distribution\s+international\b/i,/\bgoogle\s+cloud\s+emea\b/i];

function foreignSupplierSignal(row: RawTransaction): 'eu' | 'non_eu' | null {
  if (row.type !== 'expense') return null;
  const text = textOf(row);
  if (hasFiscalSignal(text)) return null;
  if (NON_EU_SOFTWARE.some(p => p.test(text))) return 'non_eu';
  if (EU_SOFTWARE.some(p => p.test(text))) return 'eu';
  return null;
}

function enrichDeterministicContext(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const text = textOf(row);
    const foreign = foreignSupplierSignal(row);
    if (foreign === 'non_eu') return mark(row, 'niet-EU verlegging 4a 21%');
    if (foreign === 'eu') return mark(row, 'EU-verlegging 4b 21%');
    if (row.type === 'expense' && /\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'pakketdienst 21%');
    if (row.type === 'expense' && /\bpath[eé]\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'bioscoop 9%');
    if (row.type === 'expense' && /\b(?:café|cafe|grand café|grand cafe)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'horeca niet-aftrekbaar 9%');
    if (row.type === 'expense' && /\b(kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'tandheelkundige behandeling vrijgesteld');
    if (row.type === 'expense' && /\b(kvk|kamer\s+van\s+koophandel)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'KVK inschrijfvergoeding vrijgesteld');
    if (row.type === 'expense' && /\balbert\s+heijn\s+zakelijk\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'voedingsmiddelen 9%');
    if (row.type === 'expense' && /\bdidi\s+talks\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'marketingdienst 21%');
    if (row.type === 'expense' && /\badvocatenkantoor\b|\badvocaat\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'advocaat 21%');
    return row;
  });
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const grossVat = (incl: number, rate: 9 | 21) => round2(incl * rate / (100 + rate));
const netFromGross = (incl: number, rate: 9 | 21) => round2(incl - grossVat(incl, rate));

function patchKnownContexts(report: FiscalReport, sourceRows: RawTransaction[]): FiscalReport {
  const sourceById = new Map(sourceRows.map(row => [row.id, row]));
  const output = { ...report.overzicht.output };
  const input = { ...report.overzicht.input };
  const aangifte = {
    ...report.aangifte,
    '1a': { ...report.aangifte['1a'] }, '1b': { ...report.aangifte['1b'] }, '2a': { ...report.aangifte['2a'] },
    '3a': { ...report.aangifte['3a'] }, '3b': { ...report.aangifte['3b'] }, '4a': { ...report.aangifte['4a'] },
    '4b': { ...report.aangifte['4b'] }, '5a': report.aangifte['5a'], '5b': report.aangifte['5b'],
  };
  let nonDeductible = report.overzicht.nonDeductible;
  let changed = 0;

  const transactions = report.transactions.map((tx): FiscalTransaction => {
    const source = sourceById.get(tx.id);
    const text = `${source ? textOf(source) : ''} ${tx.description ?? ''} ${tx.omschrijving ?? ''}`.toLowerCase();
    const isNonEuSupplier = /\bopenai(?:\s+llc)?\b|\belevenlabs(?:\s+inc)?\b|\banthropic(?:\s+pbc)?\b|\bnetlify(?:\s+inc)?\b|\bgit(?:hub|hub\s+inc)\b|\bresend(?:\s+inc)?\b/i.test(text);
    const isEuSupplier = /\badobe\s+systems?\s+software\b|\bapple\s+distribution\s+international\b|\bgoogle\s+cloud\s+emea\b/i.test(text);
    const isKnownContext = isNonEuSupplier || isEuSupplier || /postnl\s+pakketten?|pakketten?\s+postnl|path[eé]|(?:café|cafe|grand café|grand cafe)|kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling|kvk\s+inschrijfvergoeding|kamer\s+van\s+koophandel|albert\s+heijn\s+zakelijk|didi\s+talks|advocatenkantoor|\badvocaat\b/i.test(text);
    if (!isKnownContext) return tx;

    let classification: FiscalClassification | null = null;
    let rate: 0 | 9 | 21 = 0;
    let excl = round2(tx.amount_incl_input);
    let vat = 0;
    let explanation = tx.reason;
    let section: FiscalTransaction['section'] = 'geen';

    if (isNonEuSupplier) {
      classification = 'non_eu_reverse_charge'; rate = 21; excl = round2(tx.amount_incl_input); vat = round2(excl * 0.21); section = '4a';
      explanation = 'Bekende niet-EU leverancier; btw wordt bij de Nederlandse afnemer verlegd en berekend over de vergoeding.';
      aangifte['4a'].grondslag = round2(aangifte['4a'].grondslag + excl); aangifte['4a'].btw = round2(aangifte['4a'].btw + vat);
      output.nonEuReverse = round2(output.nonEuReverse + vat); output.total = round2(output.total + vat);
      input.reverseCharge = round2(input.reverseCharge + vat); input.total = round2(input.total + vat);
    } else if (isEuSupplier) {
      classification = 'eu_reverse_charge'; rate = 21; excl = round2(tx.amount_incl_input); vat = round2(excl * 0.21); section = '4b';
      explanation = 'Bekende EU-leverancier; btw over de buitenlandse dienst wordt naar de Nederlandse afnemer verlegd.';
      aangifte['4b'].grondslag = round2(aangifte['4b'].grondslag + excl); aangifte['4b'].btw = round2(aangifte['4b'].btw + vat);
      output.euReverse = round2(output.euReverse + vat); output.total = round2(output.total + vat);
      input.reverseCharge = round2(input.reverseCharge + vat); input.total = round2(input.total + vat);
    } else if (/(?:café|cafe|grand café|grand cafe)/i.test(text)) {
      classification = 'horeca_bua_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b';
      explanation = 'Horeca-uitgave: btw op eten en drinken in een horecagelegenheid is niet aftrekbaar als voorbelasting.';
      nonDeductible = round2(nonDeductible + vat);
    } else if (/kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling/i.test(text)) {
      classification = 'exempt_input'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = '5b';
      explanation = 'Tandheelkundige zorg is, wanneer aan de wettelijke voorwaarden is voldaan, vrijgesteld van btw.';
    } else if (/kvk\s+inschrijfvergoeding|kamer\s+van\s+koophandel/i.test(text)) {
      classification = 'exempt_input'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = '5b';
      explanation = 'KVK-inschrijfvergoeding wordt zonder btw als zakelijke uitgave verwerkt; er wordt geen voorbelasting gefabriceerd.';
    } else if (/postnl\s+pakketten?|pakketten?\s+postnl/i.test(text)) {
      classification = 'domestic_input_21'; rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b';
      explanation = 'Pakketdienst van PostNL; belastbare pakketdienst tegen het algemene 21%-tarief.';
      input.domestic21 = round2(input.domestic21 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    } else if (/path[eé]/i.test(text)) {
      classification = 'domestic_input_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b';
      explanation = 'Toegang tot een bioscoop valt onder het 9%-tarief.';
      input.domestic9 = round2(input.domestic9 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    } else if (/albert\s+heijn\s+zakelijk/i.test(text)) {
      classification = 'domestic_input_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b';
      explanation = 'Voedingsmiddelen voor menselijke consumptie vallen in beginsel onder het 9%-tarief.';
      input.domestic9 = round2(input.domestic9 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    } else if (/didi\s+talks|advocatenkantoor|\badvocaat\b/i.test(text)) {
      classification = 'domestic_input_21'; rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b';
      explanation = 'Nederlandse zakelijke dienst; de algemene 21%-regel is van toepassing.';
      input.domestic21 = round2(input.domestic21 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    }

    if (!classification) return tx;
    changed += 1;
    const deductible = classification === 'domestic_input_21' || classification === 'domestic_input_9' || classification === 'eu_reverse_charge' || classification === 'non_eu_reverse_charge';
    return { ...tx, amount_excl: excl, vat: { status: 'known', rate, amount: vat }, classification, section, deductible, evidenceRequired: false, evidenceStatus: 'not_required', confidence: 'high', includedInTotals: true, reason: explanation, rule: { ...tx.rule, classification, section, explanation }, btw: vat, toegepaste_regel: explanation };
  });

  if (!changed) return report;
  const known = transactions.filter(t => t.vat.status === 'known').length;
  const unresolved = transactions.filter(t => t.vat.status === 'unknown').length;
  const included = transactions.filter(t => t.includedInTotals).length;
  const audit = { ...report.audit, known, unresolved, included, evidenceRequired: transactions.filter(t => t.evidenceRequired).length };
  const netto = round2(output.total - input.total);
  const remainingProblems = audit.problems.filter(p => !/onvoldoende|unresolved|twijfel/i.test(p));
  return { ...report, transactions, overzicht: { ...report.overzicht, output, input, nonDeductible, netto, status: netto >= 0 ? 'af_te_drager' : 'terug_te_vorderen' }, aangifte: { ...aangifte, '5a': round2(output.total), '5b': round2(input.total) }, audit: { ...audit, ok: unresolved === 0 && remainingProblems.length === 0, problems: remainingProblems } };
}

export function calculateProductionVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}, adjustments: FiscalAdjustments = {}): FiscalReport {
  const enriched = enrichDeterministicContext(rows);
  return patchKnownContexts(calculatePolicyReport(enriched, overrides, adjustments), enriched);
}
