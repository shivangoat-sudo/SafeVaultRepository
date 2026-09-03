import { calculateFiscalVatReport, type BoekhouderBeoordeling } from '../btwFiscalSafePolicy';
import type { RawTransaction } from '../btwSafeTypes';

const review = (classificatie: BoekhouderBeoordeling['classificatie'], percentage?: number): BoekhouderBeoordeling => ({
  classificatie,
  beoordeeld_door: 'Testboekhouder',
  ...(percentage === undefined ? {} : { percentage }),
});

const rows: RawTransaction[] = [
  { id: 'sale-21', description: 'Verkoop 21%', amount_incl: 121, type: 'income' },
  { id: 'sale-9', description: 'Verkoop 9%', amount_incl: 109, type: 'income' },
  { id: 'buy-21', description: 'Inkoop 21%', amount_incl: 121, type: 'expense' },
  { id: 'buy-9', description: 'Inkoop 9%', amount_incl: 109, type: 'expense' },
  { id: 'eu-rc-21', description: 'EU dienst verlegd', amount_incl: 100, type: 'expense' },
  { id: 'eu-rc-9', description: 'EU dienst laag tarief verlegd', amount_incl: 100, type: 'expense' },
];

const overrides: Record<string, BoekhouderBeoordeling> = {
  'sale-21': review('domestic_output_21'),
  'sale-9': review('domestic_output_9'),
  'buy-21': review('domestic_input_21'),
  'buy-9': review('domestic_input_9'),
  'eu-rc-21': review('eu_reverse_charge', 21),
  'eu-rc-9': review('eu_reverse_charge', 9),
};

const report = calculateFiscalVatReport(rows, overrides);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(report.aangifte['1a'].btw === 21, `1a moet €21 zijn, kreeg ${report.aangifte['1a'].btw}`);
assert(report.aangifte['1b'].btw === 9, `1b moet €9 zijn, kreeg ${report.aangifte['1b'].btw}`);
assert(report.aangifte['4b'].btw === 30, `4b moet €30 zijn, kreeg ${report.aangifte['4b'].btw}`);
assert(report.aangifte['5b'] === 60, `5b moet €60 zijn, kreeg ${report.aangifte['5b']}`);
assert(report.aangifte['5a'] === 60, `5a moet €60 zijn, kreeg ${report.aangifte['5a']}`);
assert(report.overzicht.netto === 0, `netto moet €0 zijn, kreeg ${report.overzicht.netto}`);
assert(report.audit.unresolved === 0, 'Er mogen geen onopgeloste transacties zijn na expliciete beoordeling.');
assert(report.audit.included === rows.length, 'Alle bevestigde transacties moeten worden meegenomen.');

const merchantNamedTotaal = calculateFiscalVatReport(
  [{ id: 'merchant-totaal', amount_incl: 121, type: 'income', description: 'Totaal Energie' }],
  { 'merchant-totaal': review('domestic_output_21') },
);
assert(merchantNamedTotaal.audit.ignored === 0, 'Een echte merchantnaam die met Totaal begint mag niet als samenvattingsregel worden genegeerd.');
assert(merchantNamedTotaal.aangifte['1a'].btw === 21, 'Totaal Energie moet als echte 21%-transactie worden verwerkt.');

const oneC = calculateFiscalVatReport(
  [{ id: 'sports', amount_incl: 113, type: 'income', description: 'Sportkantine forfait' }],
  { sports: review('other_rate_output', 13) },
);
assert(oneC.aangifte['1c'].btw === 13, `1c 13%-forfait moet €13 zijn, kreeg ${oneC.aangifte['1c'].btw}`);
let threw = false;
try {
  calculateFiscalVatReport(
    [{ id: 'bad-1c', amount_incl: 105, type: 'income', description: 'Onbekend overig tarief' }],
    { 'bad-1c': review('other_rate_output', 5) },
  );
} catch {
  threw = true;
}
assert(threw, 'Een willekeurig 1c-tarief moet worden geweigerd.');

threw = false;
try {
  calculateFiscalVatReport([{ id: 'bad', amount_incl: 121, type: 'expense' }], {
    bad: review('domestic_output_21'),
  });
} catch {
  threw = true;
}
assert(threw, 'Een omzetclassificatie op een expense-transactie moet worden geweigerd.');

threw = false;
try {
  calculateFiscalVatReport([
    { id: 'dup', amount_incl: 121, type: 'income' },
    { id: 'dup', amount_incl: 109, type: 'income' },
  ]);
} catch {
  threw = true;
}
assert(threw, 'Dubbele transactie-ID moet worden geweigerd.');

console.log('OK: veilige fiscale rapportage, Nederlandse 1c-policy, merchant-summary safety, verlegging 9/21%, fail-closed classificatie en reconciliatie.');
