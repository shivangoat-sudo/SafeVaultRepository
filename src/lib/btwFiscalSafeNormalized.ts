// Single production fiscal entrypoint. Historical filename retained for compatibility.
export { calculateFiscalVatReport, NEDERLANDS_OVERIG_TARIEF_1C } from './btwFiscalSafePolicy';
export { BOEKHOUDER_PERCENTAGE_OPTIES } from './btwFiscalSafeCore';
export { tweeKolommenWeergave, berekenBetrouwbaarheidsscore } from './btwFiscalSafeCore';
export { FISCAL_CLASSIFICATION_OPTIONS } from './btwFiscalSafeUiOptions';
export type { FiscalReport, BoekhouderBeoordeling, FiscalClassification, FiscalSection, FiscalTransaction, BtwPercentage, FiscalAdjustments, FiscalRule } from './btwFiscalSafePolicy';
