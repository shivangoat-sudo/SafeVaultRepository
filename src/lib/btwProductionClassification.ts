import { calculateFiscalVatReport as calculatePolicyReport } from './btwFiscalSafePolicy';
import type { BoekhouderBeoordeling, FiscalAdjustments, FiscalReport } from './btwFiscalSafeCore';
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
  const country = countryOf(row);

  // Known legal supplier identities are usable context even when a bank CSV
  // has no counterparty IBAN. A Dutch IBAN can also belong to a payment
  // processor, so it must not erase an otherwise explicit supplier identity.
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

    if (row.type === 'expense' && /\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'pakketdienst 21%');
    }
    if (row.type === 'expense' && /\bpath[eé]\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'bioscoop 9%');
    }
    if (row.type === 'expense' && /\b(?:café|cafe|grand café|grand cafe)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'horeca');
    }
    if (row.type === 'expense' && /\b(kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'vrijgestelde tandheelkundige zorg');
    }
    if (row.type === 'expense' && /\b(kvk|kamer\s+van\s+koophandel)\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'vrijgesteld');
    }
    if (row.type === 'expense' && /\balbert\s+heijn\s+zakelijk\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'voedingsmiddelen');
    }
    if (row.type === 'expense' && /\bdidi\s+talks\b/i.test(text) && !hasFiscalSignal(text)) {
      return mark(row, 'marketing');
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
