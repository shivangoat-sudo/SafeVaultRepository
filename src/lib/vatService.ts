/**
 * Compatibility VAT service.
 *
 * The production fiscal calculator lives in btwFiscalSafePolicy/core. This
 * adapter remains only for legacy callers that already provide a pre-reviewed
 * domestic 21%/9% rate. It deliberately fails closed for reverse-charge and
 * other cases that require the full fiscal model.
 */
import { calculateFiscalVatReport } from './btwFiscalSafePolicy';

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
  const rows = transactions.map((t, index) => {
    if (!Number.isFinite(t.amountIncl) || !Number.isFinite(t.vatAmount)) {
      throw new Error(`BTW service: ongeldig bedrag op transactie ${index + 1}.`);
    }
    if (t.vatStatus === 'reverse_charge' || t.vatStatus === 'verlegd') {
      throw new Error('BTW service: verleggingsregelingen moeten via de volledige fiscale calculator worden verwerkt.');
    }
    if (t.vatStatus === 'none' || t.vatStatus === 'uncertain' || t.vatRate === null) return null;
    if (t.isVatRevenue === false && t.direction === 'income') return null;
    if (t.vatRate !== 0 && t.vatRate !== 9 && t.vatRate !== 21) {
      throw new Error(`BTW service: niet-ondersteund btw-tarief ${t.vatRate}%.`);
    }

    const id = `compat-${index + 1}`;
    if (t.direction === 'income') {
      const classification = t.vatRate === 21 ? 'domestic_output_21' : t.vatRate === 9 ? 'domestic_output_9' : 'zero_rated_output';
      return { id, type: 'income' as const, amount_incl: t.amountIncl, description: 'Legacy reviewed VAT service', override: { classificatie: classification as any, beoordeeld_door: 'Legacy adapter', percentage: t.vatRate } };
    }

    const classification = t.vatRate === 21
      ? (t.isDeductible === true ? 'domestic_input_21' : 'non_deductible_input_21')
      : t.vatRate === 9
        ? (t.isDeductible === true ? 'domestic_input_9' : 'non_deductible_input_9')
        : 'zero_rated_input';
    return { id, type: 'expense' as const, amount_incl: t.amountIncl, description: 'Legacy reviewed VAT service', override: { classificatie: classification as any, beoordeeld_door: 'Legacy adapter', percentage: t.vatRate } };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  const overrides: Record<string, { classificatie: any; beoordeeld_door: string; percentage?: number }> = {};
  for (const row of rows) overrides[row.id] = row.override;
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
