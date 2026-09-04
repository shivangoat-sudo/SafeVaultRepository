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
import type { RawTransaction } from './btwSafeTypes';

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

const normalizedText = (row: RawTransaction) => `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();

function isBankOnlyAmbiguous(row: RawTransaction): boolean {
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
  return (retailMention && !retailSpecific)
    || (horecaMention && !horecaSpecificRate && (horecaAlcohol || !horecaFood))
    || (lodgingMention && lodgingMixed && !lodgingSpecific)
    || (medicalMention && medicalCosmetic);
}

function hasContradictoryFiscalEvidence(row: RawTransaction): boolean {
  const text = normalizedText(row);
  if (!text) return false;
  const rates = new Set<number>();
  for (const match of text.matchAll(/(?:^|[^0-9])(0|9|21)\s*%(?:[^0-9]|$)/gi)) rates.add(Number(match[1]));
  const reverse = /\b(?:btw\s*verlegd|btw-verlegd|verlegde btw|reverse\s*charge)\b/i.test(text);
  const exemption = /\b(?:vrijgesteld|vrijstelling|btw-vrij)\b/i.test(text);
  return rates.size > 1 || (reverse && (rates.size > 0 || exemption)) || (exemption && rates.size > 0);
}

function isClearlyExemptInsurance(row: RawTransaction): boolean {
  if (row.type !== 'expense') return false;
  const text = normalizedText(row);
  return /\b(?:verzekeringspremie|verzekering(?:s)?premie|premie\s+(?:verzekering|zorgverzekering|autoverzekering|aansprakelijkheidsverzekering|beroepsaansprakelijkheidsverzekering|rechtsbijstandverzekering|arbeidsongeschiktheidsverzekering|inboedelverzekering|opstalverzekering|reisverzekering)|zorgverzekering|autoverzekering|aansprakelijkheidsverzekering|beroepsaansprakelijkheidsverzekering|rechtsbijstandverzekering|arbeidsongeschiktheidsverzekering|inboedelverzekering|opstalverzekering|reisverzekering)\b/i.test(text);
}

function unresolvedTransaction(row: RawTransaction, reason: string): FiscalTransaction {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    type: row.type,
    amount_incl_input: row.amount_incl,
    amount_excl: null,
    vat: { status: 'unknown', rate: null, amount: null },
    classification: 'unresolved',
    section: 'geen',
    deductible: false,
    evidenceRequired: true,
    evidenceStatus: 'required',
    confidence: 'low',
    includedInTotals: false,
    reason,
    rule: {
      classification: 'unresolved',
      section: 'geen',
      wetsbasis: 'BTW safety gate',
      explanation: reason,
      requiresEvidence: true,
    },
    transactie_id: row.id,
    omschrijving: row.description ?? '',
    bedrag: row.amount_incl,
    btw: null,
    toegepaste_regel: 'Geen automatische fiscale classificatie; beoordeling vereist.',
  };
}

function exemptInsuranceTransaction(row: RawTransaction): FiscalTransaction {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    type: row.type,
    amount_incl_input: row.amount_incl,
    amount_excl: Number(row.amount_incl.toFixed(2)),
    vat: { status: 'known', rate: 0, amount: 0 },
    classification: 'exempt_input',
    section: '5b',
    deductible: false,
    evidenceRequired: false,
    evidenceStatus: 'not_required',
    confidence: 'high',
    includedInTotals: true,
    reason: 'Verzekeringspremie herkend als btw-vrijgesteld; geen btw-bedrag uit de banktransactie gefabriceerd.',
    rule: {
      classification: 'exempt_input',
      section: '5b',
      wetsbasis: 'Belastingdienst – vrijstelling voor verzekeringen',
      explanation: 'Verzekeringspremie: vrijgesteld van btw; andere verzekeraar-diensten kunnen wel belast zijn.',
      requiresEvidence: false,
    },
    transactie_id: row.id,
    omschrijving: row.description ?? '',
    bedrag: Number(row.amount_incl.toFixed(2)),
    btw: 0,
    toegepaste_regel: 'Verzekeringspremie: vrijgesteld van btw.',
  };
}

function addEvidenceState(report: FiscalReport): FiscalReport {
  const transactions = report.transactions.map((tx) => {
    const needsDocument = tx.type === 'expense' && tx.deductible && (
      tx.classification === 'domestic_input_21' || tx.classification === 'domestic_input_9' ||
      tx.classification === 'domestic_reverse_charge' || tx.classification === 'eu_reverse_charge' ||
      tx.classification === 'non_eu_reverse_charge'
    );
    return needsDocument ? { ...tx, evidenceRequired: true, evidenceStatus: tx.evidenceStatus === 'human_confirmed' ? 'human_confirmed' as const : 'required' as const } : tx;
  });
  return { ...report, transactions, audit: { ...report.audit, evidenceRequired: transactions.filter((tx) => tx.evidenceRequired).length } };
}

export function calculateFiscalVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}, adjustments: FiscalAdjustments = {}): FiscalReport {
  const contradictory = rows.filter(hasContradictoryFiscalEvidence);
  const ambiguous = rows.filter((row) => !isClearlyExemptInsurance(row) && isBankOnlyAmbiguous(row));
  const insurance = rows.filter(isClearlyExemptInsurance);
  const blockedIds = new Set([...contradictory, ...ambiguous, ...insurance].map((row) => row.id));
  const classifierRows = rows.filter((row) => !blockedIds.has(row.id));
  const base = calculateProductionVatReport(classifierRows, overrides, adjustments);
  const appended: FiscalTransaction[] = [
    ...insurance.map(exemptInsuranceTransaction),
    ...contradictory.map((row) => unresolvedTransaction(row, 'Tegenstrijdige fiscale signalen in de bankomschrijving; geen tarief of verleggingsbehandeling gegokt.')),
    ...ambiguous.map((row) => unresolvedTransaction(row, 'De bankomschrijving is niet specifiek genoeg om de fiscale behandeling veilig vast te stellen.')),
  ];
  const transactions = [...base.transactions, ...appended];
  const unresolved = transactions.filter((tx) => tx.classification === 'unresolved').length;
  const known = transactions.length - unresolved;
  const included = transactions.filter((tx) => tx.includedInTotals).length;
  const unresolvedProblem = 'Een of meer transacties vereisen boekhoudkundige beoordeling door onvoldoende of tegenstrijdige bankinformatie.';
  const filteredBaseProblems = base.audit.problems.filter((problem) => !(unresolved === 0 && /vereisen boekhoudkundige beoordeling voordat het rapport fiscaal compleet is/i.test(problem)));
  const problems = unresolved > 0 || ambiguous.length + contradictory.length > 0
    ? [...filteredBaseProblems, ...(filteredBaseProblems.includes(unresolvedProblem) ? [] : [unresolvedProblem])]
    : filteredBaseProblems;
  const normalized: FiscalReport = {
    ...base,
    transactions,
    overzicht: {
      ...base.overzicht,
      status: base.overzicht.status === 'af_te_drager' ? 'af_te_dragen' : 'terug_te_vorderen',
    },
    audit: {
      ...base.audit,
      input: rows.length,
      known,
      unresolved,
      included,
      evidenceRequired: transactions.filter((tx) => tx.evidenceRequired).length,
      problems,
      ok: problems.length === 0,
    },
  };
  return addEvidenceState(normalized);
}

export function tweeKolommenWeergave(report: FiscalReport) {
  return {
    zeker: report.transactions.filter((t) => t.includedInTotals && t.confidence === 'high'),
    twijfelgevallen: report.transactions.filter((t) => t.classification === 'unresolved' || (!t.includedInTotals && t.confidence === 'low')),
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
