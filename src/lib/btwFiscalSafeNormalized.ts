// Single production fiscal entrypoint. Historical filename retained for compatibility.
import { calculateProductionVatReport } from './btwProductionClassification';
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

export type FiscalReport = Omit<CoreFiscalReport, 'overzicht'> & {
  overzicht: Omit<CoreFiscalReport['overzicht'], 'status'> & {
    status: 'af_te_dragen' | 'terug_te_vorderen';
  };
};

export function calculateFiscalVatReport(
  rows: import('./btwSafeTypes').RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  const report = calculateProductionVatReport(rows, overrides, adjustments);
  return {
    ...report,
    overzicht: {
      ...report.overzicht,
      status: report.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
  };
}

export const tweeKolommenWeergave = coreTweeKolommenWeergave;
export const berekenBetrouwbaarheidsscore = coreBerekenBetrouwbaarheidsscore;
export { BOEKHOUDER_PERCENTAGE_OPTIES };
export type {
  BtwPercentage,
  BoekhouderBeoordeling,
  FiscalAdjustments,
  FiscalClassification,
  FiscalRule,
  FiscalSection,
  FiscalTransaction,
};
