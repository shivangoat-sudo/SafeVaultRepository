import { calculateFiscalVatReport as calculateV4, berekenBetrouwbaarheidsscore } from './btwFiscalSafeV4';
import type { FiscalReport, FiscalTransaction, BtwPercentage, BoekhouderBeoordeling, FiscalClassification, FiscalSection } from './btwFiscalSafeV4';
export { berekenBetrouwbaarheidsscore };
export { calculateV4 as calculateFiscalVatReport };
export type { FiscalReport, FiscalTransaction, BtwPercentage, BoekhouderBeoordeling, FiscalClassification, FiscalSection };
export const BOEKHOUDER_PERCENTAGE_OPTIES = [
  { percentage: 0 as const, label: '0%' },
  { percentage: 9 as const, label: '9%' },
  { percentage: 21 as const, label: '21%' },
];
export function tweeKolommenWeergave(report: FiscalReport) {
  const map = (t: FiscalTransaction) => ({
    transactie_id: t.id,
    omschrijving: t.description ?? '',
    type: t.type,
    btw: t.vat.status === 'known' ? `${t.vat.rate}% — €${t.vat.amount.toFixed(2)}` : 'onbekend',
    bedrag: `€${t.amount_incl_input.toFixed(2)}`,
    toegepaste_regel: t.reason,
  });
  return {
    zeker: report.transactions.filter(t => t.includedInTotals).map(map),
    twijfelgevallen: report.transactions.filter(t => !t.includedInTotals).map(map),
  };
}
