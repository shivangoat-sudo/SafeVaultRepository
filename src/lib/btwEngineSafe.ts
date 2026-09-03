/*
 * Compatibility shim only. Production VAT calculations live in the Dutch
 * fiscal policy/core entrypoint. This file intentionally contains no second
 * calculation engine, so there cannot be two competing fiscal truths.
 */
export {
  calculateFiscalVatReport as calculateVatReport,
  berekenBetrouwbaarheidsscore,
  tweeKolommenWeergave,
  BOEKHOUDER_PERCENTAGE_OPTIES,
} from './btwFiscalSafeNormalized';
export type {
  FiscalReport as VatReport,
  FiscalTransaction as SafeProcessedTransaction,
  FiscalRule as SafeAppliedRule,
  FiscalClassification as ClassificationKey,
  FiscalAdjustments,
  BoekhouderBeoordeling,
  BtwPercentage,
} from './btwFiscalSafeNormalized';
export type { RawTransaction } from './btwSafeTypes';

export function vindEscalatieKandidaten(report: import('./btwFiscalSafeNormalized').FiscalReport) {
  return report.transactions
    .filter(t => !t.includedInTotals)
    .map(transactie => ({ transactie }));
}
