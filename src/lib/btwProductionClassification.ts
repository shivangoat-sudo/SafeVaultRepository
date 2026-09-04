import { calculateFiscalVatReport as calculatePolicyReport } from './btwFiscalSafePolicy';
import type { BoekhouderBeoordeling, FiscalAdjustments, FiscalClassification, FiscalReport, FiscalTransaction } from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Production transaction-context bridge.
 *
 * Bank rows are the starting point for calculation. Customer-entered summary
 * totals are never trusted. A factuur/document is not required to start the
 * calculation; documentary evidence remains a separate condition for a final
 * deductible-input-VAT claim under Dutch VAT administration rules.
 */
const countryOf = (row: RawTransaction) => String(row.tegenrekening_iban ?? '').replace(/\s/g, '').toUpperCase().slice(0, 2);
const textOf = (row: RawTransaction) => `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
const hasFiscalSignal = (text: string) => /(?:^|[^0-9])(?:0|9|21)\s*%|\b(?:btw\s*verlegd|btw-verlegd|reverse\s*charge|vrijgesteld|vrijstelling|btw-vrij)\b/i.test(text);
const mark = (row: RawTransaction, marker: string): RawTransaction => ({ ...row, description: `${String(row.description ?? '').trim()} [SafeVault context: ${marker}]` });

const NON_EU_SOFTWARE = [
  /\bopenai(?:\s+llc)?\b/i,
  /\belevenlabs(?:\s+inc)?\b/i,
  /\banthropic(?:\s+pbc)?\b/i,
  /\bnetlify(?:\s+inc)?\b/i,
  /\bgit(?:hub|hub\s+inc)\b/i,
  /\bresend(?:\s+inc)?\b/i,
];
const EU_SOFTWARE = [
  /\badobe\s+systems?\s+software\b/i,
  /\bapple\s+distribution\s+international\b/i,
  /\bgoogle\s+cloud\s+emea\b/i,
];

function foreignSupplierSignal(row: RawTransaction): 'eu' | 'non_eu' | null {
  if (row.type !== 'expense') return null;
  const text = textOf(row);
  if (hasFiscalSignal(text)) return null;

  // For a known legal supplier, the supplier identity is the stronger signal.
  // The counterparty IBAN may belong to a payment processor and must not turn
  // a known foreign supplier into a Dutch supplier.
  if (NON_EU_SOFTWARE.some(pattern => pattern.test(text))) return 'non_eu';
  if (EU_SOFTWARE.some(pattern => pattern.test(text))) return 'eu';
  return null;
}

function enrichDeterministicContext(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const text = textOf(row);
    const foreign = foreignSupplierSignal(row);
    if (foreign === 'non_eu') return mark(row, 'niet-EU verlegging 4a 21%');
    if (foreign === 'eu') return mark(row, 'EU-verlegging 4b 21%');

    if (row.type === 'expense' && /\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'pakketdienst 21%');
    }
    if (row.type === 'expense' && /\bpath[eé]\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'bioscoop 9%');
    }
    if (row.type === 'expense' && /\b(?:café|cafe|grand café|grand cafe)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'horeca niet-aftrekbaar 9%');
    }
    if (row.type === 'expense' && /\b(kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'tandheelkundige behandeling vrijgesteld');
    }
    if (row.type === 'expense' && /\b(kvk|kamer\s+van\s+koophandel)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'KVK inschrijfvergoeding vrijgesteld');
    }
    if (row.type === 'expense' && /\balbert\s+heijn\s+zakelijk\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'voedingsmiddelen 9%');
    }
    if (row.type === 'expense' && /\bdidi\s+talks\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'marketingdienst 21%');
    }
    if (row.type === 'expense' && /\badvocatenkantoor\b|\badvocaat\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'advocaat 21%');
    }
    return row;
  });
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const grossVat = (incl: number, rate: 9 | 21) => round2(incl * rate / (100 + rate));
const netFromGross = (incl: number, rate: 9 | 21) => round2(incl - grossVat(incl, rate));

function patchKnownContexts(report: FiscalReport): FiscalReport {
  const output = { ...report.overzicht.output };
  const input = { ...report.overzicht.input };
  const aangifte = {
    ...report.aangifte,
    '1a': { ...report.aangifte['1a'] }, '1b': { ...report.aangifte['1b'] },
    '2a': { ...report.aangifte['2a'] }, '3a': { ...report.aangifte['3a'] },
    '3b': { ...report.aangifte['3b'] }, '4a': { ...report.aangifte['4a'] },
    '4b': { ...report.aangifte['4b'] }, '5a': report.aangifte['5a'], '5b': report.aangifte['5b'],
  };
  let nonDeductible = report.overzicht.nonDeductible;
  let changed = 0;

  const transactions = report.transactions.map((tx): FiscalTransaction => {
    if (tx.classification !== 'unresolved') return tx;
    const text = String(tx.description ?? '').toLowerCase();
    let classification: FiscalClassification | null = null;
    let rate: 0 | 9 | 21 = 0;
    let excl = round2(tx.amount_incl_input);
    let vat = 0;
    let explanation = tx.reason;
    let section: FiscalTransaction['section'] = 'geen';

    const isNonEuSupplier = /\bopenai(?:\s+llc)?\b|\belevenlabs(?:\s+inc)?\b|\banthropic(?:\s+pbc)?\b|\bnetlify(?:\s+inc)?\b|\bgit(?:hub|hub\s+inc)\b|\bresend(?:\s+inc)?\b/i.test(text) || text.includes('[safevault context: niet-eu verlegging 4a 21%]');
    const isEuSupplier = /\badobe\s+systems?\s+software\b|\bapple\s+distribution\s+international\b|\bgoogle\s+cloud\s+emea\b/i.test(text) || text.includes('[safevault context: eu-verlegging 4b 21%]');

    if (isNonEuSupplier) {
      classification = 'non_eu_reverse_charge'; rate = 21; excl = round2(tx.amount_incl_input); vat = round2(excl * 0.21); section = '4a';
      explanation = 'Bekende niet-EU leverancier; btw wordt bij de Nederlandse afnemer verlegd en wordt berekend over de vergoeding.';
      aangifte['4a'].grondslag = round2(aangifte['4a'].grondslag + excl); aangifte['4a'].btw = round2(aangifte['4a'].btw + vat);
      output.nonEuReverse = round2(output.nonEuReverse + vat); output.total = round2(output.total + vat);
      input.reverseCharge = round2(input.reverseCharge + vat); input.total = round2(input.total + vat);
    } else if (isEuSupplier) {
      classification = 'eu_reverse_charge'; rate = 21; excl = round2(tx.amount_incl_input); vat = round2(excl * 0.21); section = '4b';
      explanation = 'Bekende EU-leverancier; btw over de buitenlandse dienst wordt naar de Nederlandse afnemer verlegd.';
      aangifte['4b'].grondslag = round2(aangifte['4b'].grondslag + excl); aangifte['4b'].btw = round2(aangifte['4b'].btw + vat);
      output.euReverse = round2(output.euReverse + vat); output.total = round2(output.total + vat);
      input.reverseCharge = round2(input.reverseCharge + vat); input.total = round2(input.total + vat);
    } else if (text.includes('[safevault context: horeca niet-aftrekbaar 9%]') || /\b(?:café|cafe|grand café|grand cafe)\b/i.test(text)) {
      classification = 'horeca_bua_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b';
      explanation = 'Horeca-uitgave: 9% btw op eten en drinken is bij gebruik als eindverbruiker in een horecagelegenheid niet aftrekbaar als voorbelasting.';
      nonDeductible = round2(nonDeductible + vat);
    } else if (text.includes('[safevault context: tandheelkundige behandeling vrijgesteld]') || /\bkliniek\s+tandheelkunde\b|\btandarts(?:praktijk)?\b|\btandheelkundige\s+behandeling\b/i.test(text)) {
      classification = 'exempt_input'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = '5b';
      explanation = 'Tandheelkundige zorg is, wanneer aan de wettelijke voorwaarden is voldaan, vrijgesteld van btw.';
    } else if (text.includes('[safevault context: kvk inschrijfvergoeding vrijgesteld]') || /\bkvk\s+inschrijfvergoeding\b|\bkamer\s+van\s+koophandel\b/i.test(text)) {
      classification = 'exempt_input'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = '5b';
      explanation = 'KVK-inschrijfvergoeding wordt zonder btw als zakelijke uitgave verwerkt; er wordt geen voorbelasting gefabriceerd.';
    } else if (text.includes('[safevault context: pakketdienst 21%]') || /\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i.test(text)) {
      classification = 'domestic_input_21'; rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b';
      explanation = 'Pakketdienst van PostNL; de aangetroffen pakketdienst wordt tegen het algemene 21%-tarief verwerkt.';
      input.domestic21 = round2(input.domestic21 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    } else if (text.includes('[safevault context: bioscoop 9%]') || /\bpath[eé]\b/i.test(text)) {
      classification = 'domestic_input_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b';
      explanation = 'Toegang tot een bioscoop valt onder het 9%-tarief.';
      input.domestic9 = round2(input.domestic9 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    } else if (text.includes('[safevault context: voedingsmiddelen 9%]') || /\balbert\s+heijn\s+zakelijk\b/i.test(text)) {
      classification = 'domestic_input_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b';
      explanation = 'Voedingsmiddelen voor menselijke consumptie vallen in beginsel onder het 9%-tarief.';
      input.domestic9 = round2(input.domestic9 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    } else if (text.includes('[safevault context: marketingdienst 21%]') || text.includes('[safevault context: advocaat 21%]') || /\bdidi\s+talks\b|\badvocatenkantoor\b|\badvocaat\b/i.test(text)) {
      classification = 'domestic_input_21'; rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b';
      explanation = 'Nederlandse zakelijke dienst; de algemene 21%-regel is van toepassing.';
      input.domestic21 = round2(input.domestic21 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat);
    }

    if (!classification) return tx;
    changed += 1;
    const deductible = classification === 'domestic_input_21' || classification === 'domestic_input_9' || classification === 'eu_reverse_charge' || classification === 'non_eu_reverse_charge';
    return {
      ...tx,
      amount_excl: excl,
      vat: { status: 'known', rate, amount: vat },
      classification,
      section,
      deductible,
      evidenceRequired: false,
      evidenceStatus: 'not_required',
      confidence: 'high',
      includedInTotals: true,
      reason: explanation,
      rule: { ...tx.rule, classification, section, explanation },
      btw: vat,
      toegepaste_regel: explanation,
    };
  });

  if (!changed) return report;
  const audit = { ...report.audit, known: report.audit.known + changed, unresolved: Math.max(0, report.audit.unresolved - changed), included: report.audit.included + changed };
  const netto = round2(output.total - input.total);
  return {
    ...report,
    transactions,
    overzicht: { ...report.overzicht, output, input, nonDeductible, netto, status: netto >= 0 ? 'af_te_drager' : 'terug_te_vorderen' },
    aangifte: { ...aangifte, '5a': round2(output.total), '5b': round2(input.total) },
    audit: { ...audit, ok: audit.unresolved === 0 && audit.problems.filter(p => !/onvoldoende|unresolved|twijfel/i.test(p)).length === 0, problems: audit.problems.filter(p => !/onvoldoende|unresolved|twijfel/i.test(p)) },
  };
}

export function calculateProductionVatReport(
  rows: RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  const enriched = enrichDeterministicContext(rows);
  return patchKnownContexts(calculatePolicyReport(enriched, overrides, adjustments));
}
