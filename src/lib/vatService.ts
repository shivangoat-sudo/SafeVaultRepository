/**
 * Compatibility VAT service.
 *
 * The production fiscal calculator lives in btwFiscalSafePolicy/core. This
 * adapter remains only for legacy callers that already provide a pre-reviewed
 * domestic 21%/9% rate. It deliberately fails closed for reverse-charge and
 * other cases that require the full fiscal model.
 */
import { calculateFiscalVatReport, type BoekhouderBeoordeling, type FiscalClassification } from './btwFiscalSafePolicy';

export interface VatReturnInput {
  companyId: string;
  period: string;
  year: number;
  quarter?: string;
}

export interface VatReturnResult {
  period: string;
  year: number;
  quarter: string | null;
  turnover21: number;
  vat21: number;
  turnover9: number;
  vat9: number;
  inputVat: number;
  amountPayable: number;
  amountRefundable: number;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) throw new Error('BTW service: ongeldig bedrag.');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function domesticClassification(rate: number, direction: 'income' | 'expense', deductible: boolean): FiscalClassification {
  if (direction === 'income') return rate === 21 ? 'domestic_output_21' : rate === 9 ? 'domestic_output_9' : 'zero_rated_output';
  if (rate === 21) return deductible ? 'domestic_input_21' : 'non_deductible_input_21';
  if (rate === 9) return deductible ? 'domestic_input_9' : 'non_deductible_input_9';
  return 'zero_rated_input';
}

/**
 * Compatibility adapter. Expenses are only deductible when isDeductible is
 * explicitly true. Reverse-charge, foreign VAT and other special regimes must
 * use the full evidence-gated fiscal calculator instead.
 */
export function generateVatReturn(
  transactions: Array<{
    direction: 'income' | 'expense';
    amountIncl: number;
    vatRate: number | null;
    vatAmount: number;
    vatStatus?: string;
    isVatRevenue?: boolean;
    isDeductible?: boolean;
  }>,
  input: VatReturnInput,
): VatReturnResult {
  const rows: Array<{ id: string; type: 'income' | 'expense'; amount_incl: number; description: string; override: BoekhouderBeoordeling }> = [];

  transactions.forEach((t, index) => {
    if (!Number.isFinite(t.amountIncl) || !Number.isFinite(t.vatAmount)) {
      throw new Error(`BTW service: ongeldig bedrag op transactie ${index + 1}.`);
    }
    if (t.vatStatus === 'reverse_charge' || t.vatStatus === 'verlegd') {
      throw new Error('BTW service: verleggingsregelingen moeten via de volledige fiscale calculator worden verwerkt.');
    }
    if (t.vatStatus === 'none' || t.vatStatus === 'uncertain' || t.vatRate === null) return;
    if (t.isVatRevenue === false && t.direction === 'income') return;
    if (t.vatRate !== 0 && t.vatRate !== 9 && t.vatRate !== 21) {
      throw new Error(`BTW service: niet-ondersteund btw-tarief ${t.vatRate}%.`);
    }

    const classification = domesticClassification(t.vatRate, t.direction, t.isDeductible === true);
    rows.push({
      id: `compat-${index + 1}`,
      type: t.direction,
      amount_incl: t.amountIncl,
      description: 'Legacy reviewed VAT service',
      override: {
        classificatie: classification,
        beoordeeld_door: 'Legacy adapter',
        percentage: t.vatRate,
      },
    });
  });

  const overrides: Record<string, BoekhouderBeoordeling> = Object.fromEntries(rows.map(row => [row.id, row.override]));
  const report = calculateFiscalVatReport(rows.map(({ override: _override, ...row }) => row), overrides);

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    if (t.vatStatus === 'none' || t.vatStatus === 'uncertain' || t.vatRate === null) continue;
    const row = rows.find(r => r.id === `compat-${i + 1}`);
    if (!row) continue;
    const calculated = report.transactions.find(r => r.id === row.id)?.vat;
    const expected = calculated?.status === 'known' ? calculated.amount : 0;
    if (Math.abs(expected - t.vatAmount) > 0.01) {
      throw new Error(`BTW service: opgegeven btw wijkt af van de veilige berekening op transactie ${i + 1}.`);
    }
  }

  const turnover21 = report.aangifte['1a'].grondslag;
  const turnover9 = report.aangifte['1b'].grondslag;
  const vat21 = report.aangifte['1a'].btw;
  const vat9 = report.aangifte['1b'].btw;
  const inputVat = report.aangifte['5b'];
  const net = round2(vat21 + vat9 - inputVat);

  return {
    period: input.period,
    year: input.year,
    quarter: input.quarter ?? null,
    turnover21,
    vat21,
    turnover9,
    vat9,
    inputVat,
    amountPayable: net > 0 ? net : 0,
    amountRefundable: net < 0 ? Math.abs(net) : 0,
  };
}
