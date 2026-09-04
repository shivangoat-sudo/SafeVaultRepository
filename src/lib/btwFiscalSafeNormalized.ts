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

/**
 * Sommige merchantnamen zeggen niet genoeg over de fiscale samenstelling van
 * de aankoop. Voorbeelden zijn een supermarkt (mix van 9% en 21%), horeca
 * (alcohol kan 21% zijn) en logies met ontbijt/all-in (21% + 9%). In die gevallen
 * mag een bankomschrijving alleen geen tarief verzinnen. We verbergen uitsluitend
 * voor de fiscale classifier de ambigue tekst; de oorspronkelijke omschrijving
 * blijft zichtbaar in het uiteindelijke rapport.
 */
function maskBankOnlyAmbiguity(rows: import('./btwSafeTypes').RawTransaction[]): {
  rows: import('./btwSafeTypes').RawTransaction[];
  originalTextById: Map<string, { description?: string; memo?: string }>;
} {
  const originalTextById = new Map<string, { description?: string; memo?: string }>();

  const isAmbiguous = (row: import('./btwSafeTypes').RawTransaction) => {
    const text = `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!text) return false;

    const retailAmbiguity =
      /\b(?:albert\s+heijn|jumbo|plus|lidl|aldi|supermarkt|slijterij|drankenspeciaalzaak)\b/i.test(text) &&
      !/\b(?:9\s*%|21\s*%|0\s*%|geneesmiddelen?|medicijnen?|voedingsmiddelen?|alcohol|wijn|bier|sterke\s+drank|slijterij)\b/i.test(text);

    const horecaAmbiguity =
      /\b(?:café|cafe|grand\s+café|grand\s+cafe|restaurant|horeca|hotelrestaurant)\b/i.test(text) &&
      !/\b(?:9\s*%|21\s*%|btw|alcohol|wijn|bier|sterke\s+drank|voedsel|maaltijd|eten|drinken|horeca\s+ter\s+plaatse)\b/i.test(text);

    const lodgingAmbiguity =
      /\b(?:hotel|pension|vakantiehuis|camping|overnachting|logies)\b/i.test(text) &&
      /\b(?:all[- ]?in|ontbijt|restaurant|diner|lunch|zwembad|spa|faciliteit|pakket)\b/i.test(text) &&
      !/\b(?:9\s*%|21\s*%|gesplitst|splitsing|factuur)\b/i.test(text);

    const medicalAmbiguity =
      /\b(?:tandarts|tandheelkunde|kliniek|medische\s+behandeling|zorgkliniek)\b/i.test(text) &&
      /\b(?:cosmetisch|cosmetica|bleken|whitening|esthetisch|lip|botox|filler|schoonheids)\b/i.test(text);

    return retailAmbiguity || horecaAmbiguity || lodgingAmbiguity || medicalAmbiguity;
  };

  const maskedRows = rows.map((row) => {
    if (!isAmbiguous(row)) return row;
    originalTextById.set(row.id, { description: row.description, memo: row.memo });
    return {
      ...row,
      description: '[SafeVault: ambigue bankomschrijving - geen automatische fiscale classificatie]',
      memo: '',
    };
  });

  return { rows: maskedRows, originalTextById };
}

function restoreOriginalText(
  report: FiscalReport,
  originalTextById: Map<string, { description?: string; memo?: string }>,
): FiscalReport {
  if (originalTextById.size === 0) return report;
  const transactions = report.transactions.map((tx) => {
    const original = originalTextById.get(tx.id);
    if (!original) return tx;
    const description = original.description ?? tx.description;
    const memo = original.memo ?? '';
    return {
      ...tx,
      description,
      omschrijving: description ?? tx.omschrijving,
      reason:
        tx.classification === 'unresolved'
          ? 'De bankomschrijving is niet specifiek genoeg om het tarief/de fiscale behandeling veilig vast te stellen.'
          : tx.reason,
    };
  });
  return { ...report, transactions };
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
  const { rows: classifierRows, originalTextById } = maskBankOnlyAmbiguity(rows);
  const report = calculateProductionVatReport(classifierRows, overrides, adjustments);
  return rebuildAuditState(addEvidenceState(restoreOriginalText({
    ...report,
    overzicht: {
      ...report.overzicht,
      status: report.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
  }, originalTextById)));
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
