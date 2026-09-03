import { calculateFiscalVatReport as calculatePolicyReport } from './btwFiscalSafePolicy';
import type { BoekhouderBeoordeling, FiscalAdjustments, FiscalReport } from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Production transaction-context bridge.
 *
 * The fiscal policy remains the sole calculator. This layer only adds a
 * deterministic, auditable context signal when the bank line contains a
 * strong supplier/service identity. It never invents a VAT rate and never
 * treats a foreign IBAN by itself as reverse charge.
 */
const countryOf = (row: RawTransaction) => String(row.tegenrekening_iban ?? '').replace(/\s/g, '').toUpperCase().slice(0, 2);
const textOf = (row: RawTransaction) => `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
const hasFiscalSignal = (text: string) => /(?:^|[^0-9])(?:0|9|21)\s*%|\b(?:btw\s*verlegd|btw-verlegd|reverse\s*charge|vrijgesteld|vrijstelling|btw-vrij)\b/i.test(text);

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
  const country = countryOf(row);
  if (!country || country === 'NL' || hasFiscalSignal(textOf(row))) return null;
  const text = textOf(row);
  if (NON_EU_SOFTWARE.some(pattern => pattern.test(text)) && country === 'US') return 'non_eu';
  if (EU_SOFTWARE.some(pattern => pattern.test(text)) && country === 'IE') return 'eu';
  return null;
}

function addMarker(row: RawTransaction, marker: string): RawTransaction {
  return { ...row, description: `${String(row.description ?? '').trim()} [SafeVault context: ${marker}]` };
}

function enrichDeterministicContext(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const text = textOf(row);
    if (foreignSupplierSignal(row) === 'non_eu') return addMarker(row, 'btw verlegd');
    if (foreignSupplierSignal(row) === 'eu') return addMarker(row, 'btw verlegd');

    // Strong medical identity: the exemption applies to qualifying personal
    // healthcare, including dentists. The engine still records the result as
    // an exemption rather than pretending there is deductible input VAT.
    if (row.type === 'expense' && /\b(kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i.test(text) && !hasFiscalSignal(text)) {
      return addMarker(row, 'vrijgesteld tandheelkundige behandeling');
    }

    // KVK registration fees are treated as non-VAT statutory fees in the
    // production context layer. If the bank line explicitly contains VAT
    // evidence, that evidence wins and the row is left to the fiscal engine.
    if (row.type === 'expense' && /\b(kvk|kamer\s+van\s+koophandel)\b/i.test(text) && !hasFiscalSignal(text)) {
      return addMarker(row, 'vrijgesteld');
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
