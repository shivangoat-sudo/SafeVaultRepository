// Deprecated compatibility entrypoint. The evidence-gated V3 engine is the only fiscal implementation.
export { calculateFiscalVatReport, tweeKolommenWeergave, berekenBetrouwbaarheidsscore, BOEKHOUDER_PERCENTAGE_OPTIES } from './btwFiscalSafeV3';
export type { FiscalReport, BoekhouderBeoordeling, FiscalClassification, FiscalSection, FiscalTransaction, BtwPercentage } from './btwFiscalSafeV3';
