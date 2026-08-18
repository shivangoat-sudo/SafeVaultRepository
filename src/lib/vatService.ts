/**
 * VAT Service — genereert BTW aangifte vanuit opgeslagen transacties.
 * Alle financiële berekeningen gaan via de centrale VAT engine.
 */
import { round2, calculateNetAmount, calculateVatFromGross, type VatRate } from "./vatEngine.ts";

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

/**
 * Bereken BTW aangifte uit een lijst van transacties.
 * Elke transactie heeft: direction (income/expense), amountIncl, vatRate, vatAmount.
 */
export function generateVatReturn(
  transactions: Array<{
    direction: "income" | "expense";
    amountIncl: number;
    vatRate: number | null;
    vatAmount: number;
    vatStatus?: string;
    isVatRevenue?: boolean;
  }>,
  input: VatReturnInput
): VatReturnResult {
  let turnover21 = 0, vat21 = 0;
  let turnover9 = 0, vat9 = 0;
  let inputVat = 0;

  for (const t of transactions) {
    // Skip niet-btw transacties
    if (t.vatStatus === "none" || t.vatStatus === "uncertain") continue;
    if (t.vatRate === null) continue;

    const rate = t.vatRate as VatRate;
    const excl = calculateNetAmount(t.amountIncl, rate);
    const vat = t.vatAmount || calculateVatFromGross(t.amountIncl, rate);

    if (t.direction === "income" && t.isVatRevenue !== false) {
      if (rate === 21) { turnover21 = round2(turnover21 + excl); vat21 = round2(vat21 + vat); }
      else if (rate === 9) { turnover9 = round2(turnover9 + excl); vat9 = round2(vat9 + vat); }
    } else if (t.direction === "expense") {
      inputVat = round2(inputVat + vat);
    }
  }

  const totalSalesVat = round2(vat21 + vat9);
  const net = round2(totalSalesVat - inputVat);

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
