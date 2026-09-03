// Single production fiscal entrypoint. Historical filename retained for compatibility.
import {
  calculateFiscalVatReport as calculatePolicyReport,
  NEDERLANDS_OVERIG_TARIEF_1C,
} from './btwFiscalSafePolicy';
import type {
  BtwPercentage,
  BoekhouderBeoordeling,
  FiscalAdjustments,
  FiscalClassification,
  FiscalReport as CoreFiscalReport,
  FiscalRule,
  FiscalSection,
  FiscalTransaction,
} from './btwFiscalSafeCore';
import {
  BOEKHOUDER_PERCENTAGE_OPTIES,
  tweeKolommenWeergave as coreTweeKolommenWeergave,
  berekenBetrouwbaarheidsscore as coreBerekenBetrouwbaarheidsscore,
} from './btwFiscalSafeCore';

/**
 * Public production report shape.
 *
 * The core historically exposed the internal status literal `af_te_drager`.
 * The production UI contract is `af_te_dragen`. Normalize that compatibility
 * detail here so the frontend does not need to change and runtime/type values
 * stay aligned.
 */
export type FiscalReport = Omit<CoreFiscalReport, 'overzicht'> & {
  overzicht: Omit<CoreFiscalReport['overzicht'], 'status'> & {
    status: 'af_te_dragen' | 'terug_te_vorderen';
  };
};

function toCoreReport(report: FiscalReport): CoreFiscalReport {
  return {
    ...report,
    overzicht: {
      ...report.overzicht,
      status: report.overzicht.status === 'af_te_dragen' ? 'af_te_drager' : 'terug_te_vorderen',
    },
  };
}

export function calculateFiscalVatReport(
  rows: import('./btwSafeTypes').RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  const report = calculatePolicyReport(rows, overrides, adjustments);
  return {
    ...report,
    overzicht: {
      ...report.overzicht,
      status: report.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
  };
}

/**
 * Compatibility wrappers keep the core's historical internal status type out
 * of the production/UI contract. The frontend remains completely unchanged.
 */
export function tweeKolommenWeergave(report: FiscalReport) {
  return coreTweeKolommenWeergave(toCoreReport(report));
}

export function berekenBetrouwbaarheidsscore(report: FiscalReport) {
  return coreBerekenBetrouwbaarheidsscore(toCoreReport(report));
}

export { NEDERLANDS_OVERIG_TARIEF_1C, BOEKHOUDER_PERCENTAGE_OPTIES };
export { FISCAL_CLASSIFICATION_OPTIONS } from './btwFiscalSafeUiOptions';
export type {
  BtwPercentage,
  BoekhouderBeoordeling,
  FiscalAdjustments,
  FiscalClassification,
  FiscalRule,
  FiscalSection,
  FiscalTransaction,
};
