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
  berekenBetrouwbaarheidsscore as coreBerekenBetrouwbaarheidsscore,
} from './btwFiscalSafeCore';

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

function addEvidenceState(report: FiscalReport): FiscalReport {
  const transactions: FiscalTransaction[] = report.transactions.map((tx) => {
    // Bankgegevens zijn voldoende om de transactieanalyse en btw-berekening
    // te starten. Voor een definitieve 5b-claim kan bewijs/documentatie nog wel
    // vereist zijn. Dat mag nooit veranderen in een handmatige classificatietaak.
    const needsDocument =
      tx.type === 'expense' &&
      tx.deductible &&
      (tx.classification === 'domestic_input_21' ||
        tx.classification === 'domestic_input_9' ||
        tx.classification === 'domestic_reverse_charge' ||
        tx.classification === 'eu_reverse_charge' ||
        tx.classification === 'non_eu_reverse_charge');

    if (!needsDocument) return tx;

    const evidenceStatus: FiscalTransaction['evidenceStatus'] =
      tx.evidenceStatus === 'human_confirmed' ? 'human_confirmed' : 'required';

    return {
      ...tx,
      evidenceRequired: true,
      evidenceStatus,
    };
  });

  const evidenceRequired = transactions.filter((tx) => tx.evidenceRequired).length;
  return {
    ...report,
    transactions,
    audit: { ...report.audit, evidenceRequired },
  };
}

function rebuildAuditState(report: FiscalReport): FiscalReport {
  // The production context bridge can replace an initial unresolved
  // classification with a deterministic classification. The core report was
  // calculated before that replacement, so its old unresolved warning must not
  // survive when the final transaction set contains no unresolved rows.
  const problems = report.audit.problems.filter((problem) => {
    if (report.audit.unresolved === 0 && /vereisen boekhoudkundige beoordeling voordat het rapport fiscaal compleet is/i.test(problem)) {
      return false;
    }
    return true;
  });

  return {
    ...report,
    audit: {
      ...report.audit,
      problems,
      ok: problems.length === 0,
    },
  };
}

export function calculateFiscalVatReport(
  rows: import('./btwSafeTypes').RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  const report = calculateProductionVatReport(rows, overrides, adjustments);
  return rebuildAuditState(addEvidenceState({
    ...report,
    overzicht: {
      ...report.overzicht,
      status: report.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
  }));
}

/**
 * "Twijfelgevallen" betekent dat de fiscale classificatie niet zelfstandig
 * kon worden vastgesteld. Een ontbrekend document maakt geen twijfelgeval van
 * een transactie die SafeVault al fiscaal heeft geclassificeerd.
 */
export function tweeKolommenWeergave(report: FiscalReport) {
  return {
    zeker: report.transactions.filter((t) => t.includedInTotals && t.confidence === 'high'),
    twijfelgevallen: report.transactions.filter(
      (t) => t.classification === 'unresolved' || (!t.includedInTotals && t.confidence === 'low'),
    ),
  };
}

export function berekenBetrouwbaarheidsscore(report: FiscalReport) {
  return coreBerekenBetrouwbaarheidsscore(toCoreReport(report));
}

export { BOEKHOUDER_PERCENTAGE_OPTIES };
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
