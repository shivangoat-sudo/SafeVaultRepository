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

function normalizedText(row: import('./btwSafeTypes').RawTransaction): string {
  return `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
}

function isBankOnlyAmbiguous(row: import('./btwSafeTypes').RawTransaction): boolean {
  const text = normalizedText(row);
  if (!text) return false;

  const retailMention = /\b(?:albert\s+heijn|jumbo|plus|lidl|aldi|supermarkt|slijterij|drankenspeciaalzaak)\b/i.test(text);
  const retailSpecific = /(?:9\s*%|21\s*%|0\s*%|geneesmiddelen?|medicijnen?|voedingsmiddelen?|alcohol|wijn|bier|sterke\s+drank)/i.test(text);

  const horecaMention = /(?:café|cafe|grand\s+café|grand\s+cafe|restaurant|horeca|hotelrestaurant)/i.test(text);
  const horecaSpecificRate = /(?:9\s*%|21\s*%|0\s*%)/i.test(text);
  const horecaAlcohol = /(?:alcohol|wijn|bier|sterke\s+drank|borrel|cocktail|pils)/i.test(text);
  const horecaFood = /(?:voedsel|maaltijd|eten|drinken|lunch|diner|ontbijt|menu)/i.test(text);

  const lodgingMention = /\b(?:hotel|pension|vakantiehuis|camping|overnachting|logies)\b/i.test(text);
  const lodgingMixed = /\b(?:all[- ]?in|ontbijt|restaurant|diner|lunch|zwembad|spa|faciliteit|pakket)\b/i.test(text);
  const lodgingSpecific = /(?:9\s*%|21\s*%|gesplitst|splitsing|factuur)/i.test(text);

  const medicalMention = /\b(?:tandarts|tandheelkunde|kliniek|medische\s+behandeling|zorgkliniek)\b/i.test(text);
  const medicalCosmetic = /\b(?:cosmetisch|cosmetica|bleken|whitening|esthetisch|lip|botox|filler|schoonheids)\b/i.test(text);

  return (
    (retailMention && !retailSpecific) ||
    (horecaMention && !horecaSpecificRate && (horecaAlcohol || !horecaFood)) ||
    (lodgingMention && lodgingMixed && !lodgingSpecific) ||
    (medicalMention && medicalCosmetic)
  );
}

function maskAmbiguousRows(rows: import('./btwSafeTypes').RawTransaction[]): {
  rows: import('./btwSafeTypes').RawTransaction[];
  originalTextById: Map<string, { description?: string; memo?: string }>;
} {
  const originalTextById = new Map<string, { description?: string; memo?: string }>();
  const masked = rows.map((row) => {
    if (!isBankOnlyAmbiguous(row)) return row;
    originalTextById.set(row.id, { description: row.description, memo: row.memo });
    return {
      ...row,
      description: '[SafeVault: ambigue bankomschrijving - geen automatische fiscale classificatie]',
      memo: '',
    };
  });
  return { rows: masked, originalTextById };
}

/**
 * Some bank descriptions contain an unambiguous insurance-premium signal.
 * Insurance premiums are VAT-exempt, but other insurer services can be taxable.
 * We therefore use a strict premium/insurance pattern and mask the raw text
 * before the generic 21% fallback layer can see the merchant word "verzekering".
 * The masked marker explicitly contains the fiscal fact "vrijgesteld" so the
 * existing safe core can classify it without inventing a rate.
 */
function isClearlyExemptInsurance(row: import('./btwSafeTypes').RawTransaction): boolean {
  if (row.type !== 'expense') return false;
  const text = normalizedText(row);
  if (!text) return false;
  return /\b(?:verzekeringspremie|verzekering(?:s)?premie|premie\s+(?:verzekering|zorgverzekering|autoverzekering|aansprakelijkheidsverzekering|beroepsaansprakelijkheidsverzekering|rechtsbijstandverzekering|arbeidsongeschiktheidsverzekering|inboedelverzekering|opstalverzekering|reisverzekering)|zorgverzekering|autoverzekering|aansprakelijkheidsverzekering|beroepsaansprakelijkheidsverzekering|rechtsbijstandverzekering|arbeidsongeschiktheidsverzekering|inboedelverzekering|opstalverzekering|reisverzekering)\b/i.test(text);
}

function maskClearlyExemptInsuranceRows(rows: import('./btwSafeTypes').RawTransaction[]): {
  rows: import('./btwSafeTypes').RawTransaction[];
  originalTextById: Map<string, { description?: string; memo?: string }>;
} {
  const originalTextById = new Map<string, { description?: string; memo?: string }>();
  const masked = rows.map((row) => {
    if (!isClearlyExemptInsurance(row)) return row;
    originalTextById.set(row.id, { description: row.description, memo: row.memo });
    return {
      ...row,
      description: '[SafeVault: vrijgesteld verzekeringspremie]',
      memo: '',
    };
  });
  return { rows: masked, originalTextById };
}

function mergeOriginalTexts(
  first: Map<string, { description?: string; memo?: string }>,
  second: Map<string, { description?: string; memo?: string }>,
): Map<string, { description?: string; memo?: string }> {
  const merged = new Map(first);
  for (const [id, value] of second) merged.set(id, value);
  return merged;
}

function restoreOriginalText(
  report: FiscalReport,
  originalTextById: Map<string, { description?: string; memo?: string }>,
): FiscalReport {
  if (!originalTextById.size) return report;
  return {
    ...report,
    transactions: report.transactions.map((tx) => {
      const original = originalTextById.get(tx.id);
      if (!original) return tx;
      const description = original.description ?? tx.description;
      return {
        ...tx,
        description,
        omschrijving: description ?? tx.omschrijving,
        reason:
          tx.classification === 'unresolved'
            ? 'De bankomschrijving is niet specifiek genoeg om het tarief/de fiscale behandeling veilig vast te stellen.'
            : tx.reason,
      };
    }),
  };
}

function addEvidenceState(report: FiscalReport): FiscalReport {
  const transactions: FiscalTransaction[] = report.transactions.map((tx) => {
    const needsDocument =
      tx.type === 'expense' &&
      tx.deductible &&
      (tx.classification === 'domestic_input_21' ||
        tx.classification === 'domestic_input_9' ||
        tx.classification === 'domestic_reverse_charge' ||
        tx.classification === 'eu_reverse_charge' ||
        tx.classification === 'non_eu_reverse_charge');
    if (!needsDocument) return tx;
    return {
      ...tx,
      evidenceRequired: true,
      evidenceStatus: tx.evidenceStatus === 'human_confirmed' ? 'human_confirmed' : 'required',
    };
  });

  return {
    ...report,
    transactions,
    audit: {
      ...report.audit,
      evidenceRequired: transactions.filter((tx) => tx.evidenceRequired).length,
    },
  };
}

function rebuildAuditState(report: FiscalReport): FiscalReport {
  const problems = report.audit.problems.filter((problem) => {
    if (report.audit.unresolved === 0 && /vereisen boekhoudkundige beoordeling voordat het rapport fiscaal compleet is/i.test(problem)) {
      return false;
    }
    return true;
  });
  return { ...report, audit: { ...report.audit, problems, ok: problems.length === 0 } };
}

export function calculateFiscalVatReport(
  rows: import('./btwSafeTypes').RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  const ambiguous = maskAmbiguousRows(rows);
  const insurance = maskClearlyExemptInsuranceRows(ambiguous.rows);
  const classifierRows = insurance.rows;
  const originalTextById = mergeOriginalTexts(ambiguous.originalTextById, insurance.originalTextById);
  const report = calculateProductionVatReport(classifierRows, overrides, adjustments);
  const restored = restoreOriginalText({
    ...report,
    overzicht: {
      ...report.overzicht,
      status: report.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
  }, originalTextById);
  return rebuildAuditState(addEvidenceState(restored));
}

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
