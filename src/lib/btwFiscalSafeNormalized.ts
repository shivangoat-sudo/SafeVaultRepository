import {
  calculateFiscalVatReport as calculateRawFiscalVatReport,
  tweeKolommenWeergave as rawTweeKolommenWeergave,
  berekenBetrouwbaarheidsscore as rawBerekenBetrouwbaarheidsscore,
} from './btwFiscalSafe';
import type { FiscalReport, BoekhouderBeoordeling } from './btwFiscalSafe';
import type { RawTransaction } from './btwEngineSafe';

const moneyFromCents = (value: number) => value / 100;

/**
 * Compatibility boundary for the fiscal engine.
 * The underlying fiscal calculator historically represented VAT totals in cents
 * at several aggregation points while its public contract is euros. Normalize
 * those public monetary fields here so the frontend/report always receives euros.
 */
export function calculateFiscalVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}): FiscalReport {
  const raw = calculateRawFiscalVatReport(rows, overrides);
  const report: FiscalReport = structuredClone(raw);

  for (const transaction of report.transactions) {
    if (transaction.vat.status === 'known') {
      transaction.vat.amount = moneyFromCents(transaction.vat.amount);
    }
  }

  for (const key of ['domestic21', 'domestic9', 'domesticReverse', 'euReverse', 'nonEuReverse', 'total'] as const) {
    report.overzicht.output[key] = moneyFromCents(report.overzicht.output[key]);
  }
  for (const key of ['domestic21', 'domestic9', 'reverseCharge', 'total'] as const) {
    report.overzicht.input[key] = moneyFromCents(report.overzicht.input[key]);
  }
  report.overzicht.nonDeductible = moneyFromCents(report.overzicht.nonDeductible);
  report.overzicht.netto = moneyFromCents(report.overzicht.netto);

  for (const key of ['1a', '1b', '1e', '2a', '3a', '3b', '4a', '4b'] as const) {
    report.aangifte[key].grondslag = moneyFromCents(report.aangifte[key].grondslag);
    report.aangifte[key].btw = moneyFromCents(report.aangifte[key].btw);
  }
  report.aangifte['5b'] = moneyFromCents(report.aangifte['5b']);

  // The legacy aggregation currently does not populate 1e. Reconstruct it
  // from the classified zero-rated output transactions in the safe boundary.
  const zeroRatedBase = report.transactions
    .filter(t => t.classification === 'zero_rated_output')
    .reduce((sum, t) => sum + (t.amount_excl ?? 0), 0);
  report.aangifte['1e'] = { grondslag: zeroRatedBase, btw: 0 };

  return report;
}

export function tweeKolommenWeergave(report: FiscalReport) {
  return rawTweeKolommenWeergave(report);
}

export function berekenBetrouwbaarheidsscore(report: FiscalReport) {
  return rawBerekenBetrouwbaarheidsscore(report);
}

export * from './btwFiscalSafe';
