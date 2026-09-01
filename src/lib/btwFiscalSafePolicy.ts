import {
  calculateFiscalVatReport as calculateCore,
  type BoekhouderBeoordeling,
  type FiscalAdjustments,
  type FiscalReport,
} from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Dutch fiscal policy guard around the production core.
 *
 * A bank transaction is a financial input, not a submitted invoice record.
 * The BTW engine therefore MUST NOT require submitted invoice VAT fields or
 * a human invoice review before calculating a bank-based analysis.
 *
 * Human review remains possible through explicit overrides, but it is an
 * override/correction path, not a prerequisite for processing every row.
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

  // Deliberately no controleerIngediendeBtwPost() call here.
  // submitted_amount_excl / submitted_vat_amount / submitted_vat_percentage /
  // submitted_section are optional source fields and must never block or
  // invalidate a bank-based BTW calculation.
  return calculateCore(protectLegitimateMerchantNames(rows), overrides, adjustments);
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
