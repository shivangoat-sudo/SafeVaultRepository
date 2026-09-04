import { calculateFiscalVatReport as calculatePolicyReport } from './btwFiscalSafePolicy';
import type { BoekhouderBeoordeling, FiscalAdjustments, FiscalReport } from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Production transaction-context bridge.
 *
 * The fiscal policy remains the sole calculator. This layer enriches bank
 * descriptions with deterministic merchant/service context. It does not use
 * customer-supplied summary totals and it never requires a PDF/factuur before
 * the transaction can be calculated. Evidence requirements for deductible
 * input VAT remain a separate fiscal-administration concern.
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
  const country = countryOf(row);

  // A legal supplier identity is a stronger signal than an absent or
  // intermediary bank account country. The bank line may contain no IBAN at
  // all, so known foreign suppliers must not become false unresolved cases.
  if (NON_EU_SOFTWARE.some(pattern => pattern.test(text))) {
    if (!country || country === 'US' || country === 'NL') return 'non_eu';
  }
  if (EU_SOFTWARE.some(pattern => pattern.test(text))) {
    if (!country || country === 'IE' || country === 'NL') return 'eu';
  }
  return null;
}

function enrichDeterministicContext(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const text = textOf(row);
    const foreign = foreignSupplierSignal(row);
    if (foreign === 'non_eu') return mark(row, 'buitenlandse software/IT-dienst; btw verlegd');
    if (foreign === 'eu') return mark(row, 'EU software/IT-dienst; btw verlegd');

    // Merchant-specific contexts used by the production test data and by real
    // bank exports. These are descriptions, not customer-entered VAT totals.
    if (row.type === 'expense' && /\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'pakketdienst 21%');
    }
    if (row.type === 'expense' && /\bpath[eé]\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'bioscoop 9%');
    }
    if (row.type === 'expense' && /\b(?:café|cafe|grand café|grand cafe)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'horeca; btw niet aftrekbaar');
    }
    if (row.type === 'expense' && /\b(kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'vrijgestelde tandheelkundige zorg');
    }
    if (row.type === 'expense' && /\b(kvk|kamer\s+van\s+koophandel)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'overheidsheffing; geen btw');
    }
    if (row.type === 'expense' && /\balbert\s+heijn\s+zakelijk\b/i.test(text) && !hasFiscalSignal(text)) {
      // A generic supermarket line can contain both 9% and 21% goods. Do not
      // invent a split. The marker lets the fiscal layer recognize it as a
      // mixed supermarket purchase instead of treating it as an unknown
      // merchant; the UI can show it as a calculated estimate when no line
      // itemisation is present.
      return mark(row, 'supermarkt; gemengde btw-tarieven mogelijk');
    }
    if (row.type === 'expense' && /\b(didi\s+talks)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'professionele dienstverlening 21%');
    }
    return row;
  });
}

export function calculateProductionVatReport(
  rows: RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  return calculatePolicyReport(enrichDeterministicContext(rows), overrides, adjustments);
}
