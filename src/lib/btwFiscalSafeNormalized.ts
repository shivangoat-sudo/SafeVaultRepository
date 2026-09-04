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

    const horecaMention = /\b(?:café|cafe|grand\s+café|grand\s+cafe|restaurant|horeca|hotelrestaurant)\b/i.test(text);
    const horecaHasExplicitRate = /\b(?:9\s*%|21\s*%|0\s*%)\b/i.test(text);
    const horecaHasAlcohol = /\b(?:alcohol|wijn|bier|sterke\s+drank|borrel|cocktail|pils)\b/i.test(text);
    const horecaHasSpecificFoodContext = /\b(?:voedsel|maaltijd|eten|drinken|lunch|diner|ontbijt|menu)\b/i.test(text);
    const horecaAmbiguity = horecaMention && !horecaHasExplicitRate && (horecaHasAlcohol || !horecaHasSpecificFoodContext);

    const lodgingAmbiguity =
      /\b(?:hotel|pension|vakantiehuis|camping|overnachting|logies)\b/i.test(text) &&
      /\b(?:all[- ]?in|ontbijt|restaurant|diner|lunch|zwembad|spa|faciliteit|pakket)\b/i.test(text) &&
      !/\b(?:9\s*%|21\s*%|gesplitst|splitsing|factuur)\b/i.test(text);

    const medicalAmbiguity =
      /\b(?:tandarts|tandheelkunde|kliniek|medische\s+behandeling|zorgkliniek)\b/i.test(text) &&
      /\b(?:cosmetisch|cosmetica|bleken|whitening|esthetisch|lip|botox|filler|schoonheids)\b/i.test(text);

    return retailAmbiguity || horecaAmbiguity || lodgingAmbiguity || medicalAmbiguity;
  };

  return {
    rows: rows.map((row) => {
      if (!isAmbiguous(row)) return row;
      originalTextById.set(row.id, { description: row.description, memo: row.memo });
      return {
        ...row,
        description: '[SafeVault: ambigue bankomschrijving - geen automatische fiscale classificatie]',
        memo: '',
      };
    }),
    originalTextById,
  };
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

/**
 * Defence-in-depth: production context patches are allowed to enrich known
 * contexts, but they can never re-enable a bank-only classification which is
 * explicitly ambiguous. This guard runs after the production bridge and
 * repairs totals, audit counts and return boxes consistently.
 */
function enforceFailClosedAmbiguity(
  report: FiscalReport,
  rows: import('./btwSafeTypes').RawTransaction[],
): FiscalReport {
  const originalById = new Map(rows.map((row) => [row.id, row]));
  const isAmbiguous = (row: import('./btwSafeTypes').RawTransaction) => {
    const text = `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const retailAmbiguity =
      /\b(?:albert\s+heijn|jumbo|plus|lidl|aldi|supermarkt|slijterij|drankenspeciaalzaak)\b/i.test(text) &&
      !/\b(?:9\s*%|21\s*%|0\s*%|geneesmiddelen?|medicijnen?|voedingsmiddelen?|alcohol|wijn|bier|sterke\s+drank|slijterij)\b/i.test(text);
    const horecaMention = /\b(?:café|cafe|grand\s+café|grand\s+cafe|restaurant|horeca|hotelrestaurant)\b/i.test(text);
    const horecaHasExplicitRate = /\b(?:9\s*%|21\s*%|0\s*%)\b/i.test(text);
    const horecaHasAlcohol = /\b(?:alcohol|wijn|bier|sterke\s+drank|borrel|cocktail|pils)\b/i.test(text);
    const horecaHasSpecificFoodContext = /\b(?:voedsel|maaltijd|eten|drinken|lunch|diner|ontbijt|menu)\b/i.test(text);
    const horecaAmbiguity = horecaMention && !horecaHasExplicitRate && (horecaHasAlcohol || !horecaHasSpecificFoodContext);
    const lodgingAmbiguity =
      /\b(?:hotel|pension|vakantiehuis|camping|overnachting|logies)\b/i.test(text) &&
      /\b(?:all[- ]?in|ontbijt|restaurant|diner|lunch|zwembad|spa|faciliteit|pakket)\b/i.test(text) &&
      !/\b(?:9\s*%|21\s*%|gesplitst|splitsing|factuur)\b/i.test(text);
    const medicalAmbiguity =
      /\b(?:tandarts|tandheelkunde|kliniek|medische\s+behandeling|zorgkliniek)\b/i.test(text) &&
      /\b(?:cosmetisch|cosmetica|bleken|whitening|esthetisch|lip|botox|filler|schoonheids)\b/i.test(text);
    return retailAmbiguity || horecaAmbiguity || lodgingAmbiguity || medicalAmbiguity;
  };

  const blockedIds = new Set(rows.filter(isAmbiguous).map((row) => row.id));
  if (!blockedIds.size) return report;

  const blocked = report.transactions.filter((tx) => blockedIds.has(tx.id) && tx.includedInTotals);
  if (!blocked.length) return report;

  const output = { ...report.overzicht.output };
  const input = { ...report.overzicht.input };
  let nonDeductible = report.overzicht.nonDeductible;
  const aangifte = {
    ...report.aangifte,
    '1a': { ...report.aangifte['1a'] }, '1b': { ...report.aangifte['1b'] },
    '1c': { ...report.aangifte['1c'] }, '1d': { ...report.aangifte['1d'] },
    '1e': { ...report.aangifte['1e'] }, '2a': { ...report.aangifte['2a'] },
    '3a': { ...report.aangifte['3a'] }, '3b': { ...report.aangifte['3b'] },
    '4a': { ...report.aangifte['4a'] }, '4b': { ...report.aangifte['4b'] },
  };

  const subtract = (value: number, amount: number) => Math.max(0, Math.round((value - amount + Number.EPSILON) * 100) / 100);
  for (const tx of blocked) {
    const vat = tx.vat.status === 'known' ? tx.vat.amount : 0;
    const base = tx.amount_excl ?? (tx.amount_incl_input - vat);
    if (tx.type === 'expense') {
      if (tx.deductible) {
        input.domestic21 = tx.classification === 'domestic_input_21' ? subtract(input.domestic21, vat) : input.domestic21;
        input.domestic9 = tx.classification === 'domestic_input_9' ? subtract(input.domestic9, vat) : input.domestic9;
        input.reverseCharge = (tx.classification === 'domestic_reverse_charge' || tx.classification === 'eu_reverse_charge' || tx.classification === 'non_eu_reverse_charge') ? subtract(input.reverseCharge, vat) : input.reverseCharge;
        input.total = subtract(input.total, vat);
        aangifte['5b'] = input.total;
        if (tx.section === '4a') aangifte['4a'].btw = subtract(aangifte['4a'].btw, vat), aangifte['4a'].grondslag = subtract(aangifte['4a'].grondslag, base);
        if (tx.section === '4b') aangifte['4b'].btw = subtract(aangifte['4b'].btw, vat), aangifte['4b'].grondslag = subtract(aangifte['4b'].grondslag, base);
      } else {
        nonDeductible = subtract(nonDeductible, vat);
      }
    } else {
      if (tx.section === '1a') aangifte['1a'].btw = subtract(aangifte['1a'].btw, vat), aangifte['1a'].grondslag = subtract(aangifte['1a'].grondslag, base);
      if (tx.section === '1b') aangifte['1b'].btw = subtract(aangifte['1b'].btw, vat), aangifte['1b'].grondslag = subtract(aangifte['1b'].grondslag, base);
      if (tx.section === '2a') aangifte['2a'].btw = subtract(aangifte['2a'].btw, vat), aangifte['2a'].grondslag = subtract(aangifte['2a'].grondslag, base);
      if (tx.section === '3a') aangifte['3a'].grondslag = subtract(aangifte['3a'].grondslag, base);
      if (tx.section === '3b') aangifte['3b'].grondslag = subtract(aangifte['3b'].grondslag, base);
      output.total = subtract(output.total, vat);
    }
  }

  const transactions = report.transactions.map((tx) => {
    if (!blockedIds.has(tx.id)) return tx;
    return {
      ...tx,
      amount_excl: null,
      vat: { status: 'unknown' as const, rate: null, amount: null },
      classification: 'unresolved' as FiscalClassification,
      section: 'geen' as FiscalSection,
      deductible: false,
      evidenceRequired: false,
      evidenceStatus: 'not_required' as const,
      confidence: 'low' as const,
      includedInTotals: false,
      reason: 'De bankomschrijving is niet specifiek genoeg om het tarief/de fiscale behandeling veilig vast te stellen.',
      rule: { ...tx.rule, classification: 'unresolved' as FiscalClassification, section: 'geen' as FiscalSection, explanation: 'Geen automatische fiscale classificatie: de bankomschrijving is onvoldoende specifiek.', requiresEvidence: false } as FiscalRule,
      btw: null,
      toegepaste_regel: 'Fail-closed: onvoldoende specifieke bankinformatie.',
    };
  });

  const unresolved = transactions.filter((tx) => tx.classification === 'unresolved').length;
  const included = transactions.filter((tx) => tx.includedInTotals).length;
  const known = transactions.filter((tx) => tx.vat.status === 'known').length;
  const ignored = report.audit.ignored;
  const evidenceRequired = transactions.filter((tx) => tx.evidenceRequired).length;
  const problems = [...report.audit.problems.filter(Boolean)];
  const extra = transactions.filter((tx) => tx.classification === 'unresolved' && blockedIds.has(tx.id)).map((tx) => `Transactie ${tx.id}: fiscale behandeling niet vastgesteld.`);
  for (const problem of extra) if (!problems.includes(problem)) problems.push(problem);
  aangifte['5a'] = Math.max(0, Math.round((output.total + aangifte['2a'].btw + aangifte['3a'].btw + aangifte['3b'].btw + aangifte['4a'].btw + aangifte['4b'].btw + aangifte['1a'].btw + aangifte['1b'].btw + aangifte['1c'].btw + aangifte['1d'].btw + aangifte['1e'].btw + Number(report.aangifte['5a'] - report.overzicht.output.total) + Number.EPSILON) * 100) / 100);

  // 5a is the production model's total output VAT; keep it aligned with the
  // report output object rather than manufacturing new VAT for blocked rows.
  aangifte['5a'] = output.total;
  const netto = Math.round((output.total - input.total) * 100) / 100;

  return {
    ...report,
    transactions,
    overzicht: {
      ...report.overzicht,
      output,
      input,
      nonDeductible,
      netto,
      status: netto >= 0 ? 'af_te_dragen' : 'terug_te_vorderen',
    },
    aangifte: { ...report.aangifte, ...aangifte, '5a': output.total, '5b': input.total },
    audit: { ...report.audit, unresolved, known, evidenceRequired, included, ignored, problems, ok: false },
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
    const evidenceStatus: FiscalTransaction['evidenceStatus'] =
      tx.evidenceStatus === 'human_confirmed' ? 'human_confirmed' : 'required';
    return { ...tx, evidenceRequired: true, evidenceStatus };
  });
  const evidenceRequired = transactions.filter((tx) => tx.evidenceRequired).length;
  return { ...report, transactions, audit: { ...report.audit, evidenceRequired } };
}

function rebuildAuditState(report: FiscalReport): FiscalReport {
  const problems = report.audit.problems.filter((problem) => {
    if (report.audit.unresolved === 0 && /vereisen boekhoudkundige beoordeling voordat het rapport fiscaal compleet is/i.test(problem)) return false;
    return true;
  });
  return { ...report, audit: { ...report.audit, problems, ok: problems.length === 0 } };
}

export function calculateFiscalVatReport(
  rows: import('./btwSafeTypes').RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  const { rows: classifierRows, originalTextById } = maskBankOnlyAmbiguity(rows);
  const baseReport = calculateProductionVatReport(classifierRows, overrides, adjustments);
  const restored = restoreOriginalText({
    ...baseReport,
    overzicht: {
      ...baseReport.overzicht,
      status: baseReport.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
  }, originalTextById);
  const blocked = enforceFailClosedAmbiguity(restored, rows);
  return rebuildAuditState(addEvidenceState(blocked));
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
