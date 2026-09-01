import { calculateFiscalVatReport } from '../btwFiscalSafePolicy';
import type { RawTransaction } from '../btwSafeTypes';

type Review = Parameters<typeof calculateFiscalVatReport>[1];

const rows: RawTransaction[] = [
  { id: 's21', description: 'Verkoop', amount_incl: 121, type: 'income' },
  { id: 's9', description: 'Verkoop laag tarief', amount_incl: 109, type: 'income' },
  { id: 'p21', description: 'Inkoop', amount_incl: 121, type: 'expense' },
  { id: 'p9', description: 'Inkoop laag tarief', amount_incl: 109, type: 'expense' },
];

const overrides: Review = {
  s21: { classificatie: 'domestic_output_21', beoordeeld_door: 'Testboekhouder' },
  s9: { classificatie: 'domestic_output_9', beoordeeld_door: 'Testboekhouder' },
  p21: { classificatie: 'domestic_input_21', beoordeeld_door: 'Testboekhouder' },
  p9: { classificatie: 'domestic_input_9', beoordeeld_door: 'Testboekhouder' },
};

const report = calculateFiscalVatReport(rows, overrides);

if (report.aangifte['1a'].btw !== 21) throw new Error(`1a verwacht €21, kreeg ${report.aangifte['1a'].btw}`);
if (report.aangifte['1b'].btw !== 9) throw new Error(`1b verwacht €9, kreeg ${report.aangifte['1b'].btw}`);
if (report.aangifte['5b'] !== 30) throw new Error(`5b verwacht €30, kreeg ${report.aangifte['5b']}`);
if (report.aangifte['5a'] !== 30) throw new Error(`5a verwacht €30, kreeg ${report.aangifte['5a']}`);
if (report.overzicht.netto !== 0) throw new Error(`netto verwacht €0, kreeg ${report.overzicht.netto}`);

console.log('OK: VAT regression test verifies the production fiscal policy facade.');
