import {
  calculateFiscalVatReport as calculateCore,
  type BoekhouderBeoordeling,
  type FiscalAdjustments,
  type FiscalReport,
} from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';
import { controleerIngediendeBtwPost } from './btwSubmissionValidator';

/**
 * Dutch fiscal policy guard around the production core.
 *
 * Rubriek 1c is not a generic custom VAT-rate bucket: the current Dutch
 * return guidance identifies the 13% sports-canteen forfait as the relevant
 * other-rate case. Do not permit arbitrary percentages here.
 */
export const NEDERLANDS_OVERIG_TARIEF_1C = 13 as const;

function protectLegitimateMerchantNames(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const description = String(row.description ?? '').trim();
    const first = description.toLowerCase().split(/\s+/)[0] ?? '';
    const exact = description.toLowerCase();
    if ((first === 'totaal' || first === 'saldo') && exact !== first) {
      return { ...row, description: `\u2063${row.description ?? ''}` };
    }
    return row;
  });
}

function validateSubmittedVat(rows: RawTransaction[]) {
  const problems:string[] = [];
  let checked = 0;
  let deviations = 0;
  for (const row of rows) {
    const hasSubmitted = row.submitted_amount_excl !== undefined || row.submitted_vat_amount !== undefined || row.submitted_vat_percentage !== undefined || row.submitted_section !== undefined;
    if (!hasSubmitted) continue;
    checked++;
    const result = controleerIngediendeBtwPost({
      id: row.id,
      amount_incl: row.amount_incl,
      amount_excl: row.submitted_amount_excl,
      btw_bedrag: row.submitted_vat_amount,
      btw_percentage: row.submitted_vat_percentage,
      rubriek: row.submitted_section as any,
      type: row.type,
      omschrijving: row.description,
    });
    if (result.status === 'afwijking') {
      deviations++;
      for (const problem of result.afwijkingen) problems.push(`${row.id}: ${problem}`);
    } else if (result.status === 'onvoldoende_gegevens') {
      problems.push(`${row.id}: aangeleverde BTW-gegevens zijn onvolledig en kunnen niet volledig worden gecontroleerd.`);
    }
  }
  return { checked, deviations, problems };
}

export function calculateFiscalVatReport(
  rows: RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  for (const [id, review] of Object.entries(overrides)) {
    if (review.classificatie === 'other_rate_output' && review.percentage !== NEDERLANDS_OVERIG_TARIEF_1C) {
      throw new Error(`BTW safety: rubriek 1c ondersteunt alleen het expliciet vastgelegde 13%-forfait (${id}).`);
    }
  }

  const safeRows = protectLegitimateMerchantNames(rows);
  const report = calculateCore(safeRows, overrides, adjustments);
  const submitted = validateSubmittedVat(rows);
  if (submitted.checked > 0) {
    report.audit.problems = [...report.audit.problems, ...submitted.problems];
    report.audit.ok = report.audit.ok && submitted.deviations === 0 && submitted.problems.length === 0;
  }
  return report;
}

export type {
  BtwPercentage,
  BoekhouderBeoordeling,
  FiscalAdjustments,
  FiscalClassification,
  FiscalReport,
  FiscalRule,
  FiscalSection,
  FiscalTransaction,
} from './btwFiscalSafeCore';

export { BOEKHOUDER_PERCENTAGE_OPTIES } from './btwFiscalSafeCore';
