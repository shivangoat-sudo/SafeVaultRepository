import {
  calculateVatReport as calculateBtwReport,
  type RawTransaction as BtwRawTransaction,
  type NettoBtwOverzicht
} from "./btwEngine.js";

export type RawTransaction = BtwRawTransaction;
export type { NettoBtwOverzicht };

export interface ClassifiedTransaction {
  id: string;
  category: string;
  applied_rule: string;
  excl_amount: number;
  vat_amount: number;
}

export interface VatReport {
  totaal_incl_21: number;
  totaal_excl_21: number;
  totaal_incl_9: number;
  totaal_excl_9: number;
  totale_btw_21: number;
  totale_btw_9: number;
  niet_aftrekbare_btw: number;
  totaal_aftrekbaar: number;
  btw_eindsaldo: number;
  total_processed: number;
  overzicht: NettoBtwOverzicht;
  transactions: ClassifiedTransaction[];
}

export type VatRate = 0 | 9 | 21;

export interface InvoiceLine {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  net_amount?: number;
  gross_amount?: number;
  vat_rate?: VatRate;
  vatRate?: VatRate;
  vat_amount?: number;
}

export interface InvoiceLineDetail {
  description: string;
  lineExcl: number;
  lineVat: number;
  lineIncl: number;
  vatRate: VatRate;
}

export interface InvoiceVatResult {
  subtotal: number;
  vat21: number;
  vat9: number;
  totalVat: number;
  grandTotal: number;
  lines: InvoiceLineDetail[];
}

export const round2 = (num: number): number => {
  if (isNaN(num)) return 0;
  const sign = num < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(num) + Number.EPSILON) * 100)) / 100;
};

export const isValidVatRate = (rate: number): rate is VatRate => {
  return [0, 9, 21].includes(rate);
};

export const calculateNetAmount = (grossAmount: number, vatRate: number): number => {
  const net = grossAmount / (1 + vatRate / 100);
  return round2(net);
};

export const calculateVatAmount = (netAmount: number, vatRate: number): number => {
  return round2(netAmount * (vatRate / 100));
};

export const calculateGrossAmount = (netAmount: number, vatRate: number): number => {
  return round2(netAmount + calculateVatAmount(netAmount, vatRate));
};

export const calculateVatFromGross = (grossAmount: number, vatRate: number): number => {
  const net = calculateNetAmount(grossAmount, vatRate);
  return round2(grossAmount - net);
};

export const calculateInvoiceVat = (lines: InvoiceLine[]): InvoiceVatResult => {
  let subtotal = 0;
  let vat21 = 0;
  let vat9 = 0;
  let grandTotal = 0;
  const processedLines: InvoiceLineDetail[] = [];

  for (const line of lines) {
    const vatRate = (line.vatRate ?? line.vat_rate ?? 0) as VatRate;
    let lineExcl = 0;
    if (line.net_amount !== undefined) {
      lineExcl = line.net_amount;
    } else if (line.gross_amount !== undefined) {
      lineExcl = calculateNetAmount(line.gross_amount, vatRate);
    } else {
      const qty = line.quantity ?? 1;
      const price = line.unitPrice ?? 0;
      lineExcl = round2(qty * price);
    }

    const lineVat = line.vat_amount !== undefined ? line.vat_amount : calculateVatAmount(lineExcl, vatRate);
    const lineIncl = round2(lineExcl + lineVat);

    subtotal = round2(subtotal + lineExcl);
    if (vatRate === 21) vat21 = round2(vat21 + lineVat);
    if (vatRate === 9) vat9 = round2(vat9 + lineVat);
    grandTotal = round2(grandTotal + lineIncl);

    processedLines.push({
      description: line.description ?? '',
      lineExcl,
      lineVat,
      lineIncl,
      vatRate
    });
  }

  return {
    subtotal,
    vat21,
    vat9,
    totalVat: round2(vat21 + vat9),
    grandTotal,
    lines: processedLines
  };
};

export const validateLine = (excl: number, vat: number, incl: number): boolean => {
  return Math.abs(round2(excl + vat) - round2(incl)) < 0.01;
};

export function calculateVatReport(
  rawTransactions: RawTransaction[]
): VatReport {
  const btwTransactions = rawTransactions.map(tx => ({
    id: tx.id,
    type: (tx.type === 'income' || (tx.type as unknown) === 'Inkomsten') ? ('income' as const) : ('expense' as const),
    amount_incl: tx.amount_incl,
    description: tx.description,
    date: tx.date,
    memo: tx.memo,
    tegenrekening_iban: tx.tegenrekening_iban,
  }));

  const btwReport = calculateBtwReport(btwTransactions);

  return {
    totaal_incl_21: btwReport.totaal_incl_21,
    totaal_excl_21: btwReport.totaal_excl_21,
    totaal_incl_9: btwReport.totaal_incl_9,
    totaal_excl_9: btwReport.totaal_excl_9,
    totale_btw_21: btwReport.totale_btw_21,
    totale_btw_9: btwReport.totale_btw_9,
    niet_aftrekbare_btw: btwReport.niet_aftrekbare_btw,
    totaal_aftrekbaar: btwReport.breakdown.aftrekbare_btw_totaal,
    btw_eindsaldo: btwReport.btw_eindsaldo,
    total_processed: btwReport.herkenning.totaal_transacties,
    overzicht: btwReport.overzicht,
    transactions: btwReport.transactions.map(t => ({
      id: t.id,
      category: t.classification,
      applied_rule: t.applied_rule.korte_toelichting,
      excl_amount: t.bedrag_excl,
      vat_amount: t.btw_bedrag,
    }))
  };
}
