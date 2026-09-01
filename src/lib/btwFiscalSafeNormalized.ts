// Single production fiscal entrypoint. Historical filename retained for compatibility.
export { calculateFiscalVatReport, tweeKolommenWeergave, berekenBetrouwbaarheidsscore } from './btwFiscalSafeCore';
export { BOEKHOUDER_PERCENTAGE_OPTIES } from './btwFiscalSafeCore';
export { FISCAL_CLASSIFICATION_OPTIONS } from './btwFiscalSafeUiOptions';
export type { FiscalReport, BoekhouderBeoordeling, FiscalClassification, FiscalSection, FiscalTransaction, BtwPercentage, FiscalAdjustments } from './btwFiscalSafeCore';
