import assert from 'node:assert/strict';
import { calculateFiscalVatReport } from '../src/lib/btwFiscalSafeCore';
import { parseCsvToRawTransactions } from '../src/utils/vatCsvParser';

const review = (classificatie: Parameters<typeof calculateFiscalVatReport>[1][string]['classificatie'], percentage?: number) => ({
  classificatie,
  beoordeeld_door: 'Smoke Test',
  ...(percentage === undefined ? {} : { percentage }),
});

const unknownIncome = calculateFiscalVatReport([{ id: 'unknown-income', type: 'income', amount_incl: 121, description: 'Onbekende klantbetaling' }]);
assert.equal(unknownIncome.aangifte['1a'].btw, 21);
assert.equal(unknownIncome.aangifte['5a'], 21);
assert.equal(unknownIncome.aangifte['5b'], 0);
assert.equal(unknownIncome.overzicht.netto, 21);
assert.equal(unknownIncome.audit.unresolved, 0);
assert.equal(unknownIncome.audit.ok, true);
assert.equal(unknownIncome.transactions[0].vat.status, 'known');
assert.equal(unknownIncome.transactions[0].confidence, 'low');

const unknownExpense = calculateFiscalVatReport([{ id: 'unknown-expense', type: 'expense', amount_incl: 121, description: 'Onbekende zakelijke inkoop' }]);
assert.equal(unknownExpense.aangifte['5b'], 21);
assert.equal(unknownExpense.overzicht.netto, -21);
assert.equal(unknownExpense.audit.unresolved, 0);
assert.equal(unknownExpense.audit.ok, true);
assert.equal(unknownExpense.transactions[0].confidence, 'low');

const knownIncome = calculateFiscalVatReport(
  [{ id: 'known-income', type: 'income', amount_incl: 109, description: 'Verkoop boek' }],
  { 'known-income': review('domestic_output_9') }
);
assert.equal(knownIncome.aangifte['1b'].grondslag, 100);
assert.equal(knownIncome.aangifte['1b'].btw, 9);
assert.equal(knownIncome.aangifte['5a'], 9);
assert.equal(knownIncome.overzicht.netto, 9);
assert.equal(knownIncome.audit.ok, true);

const knownExpense = calculateFiscalVatReport(
  [{ id: 'known-expense', type: 'expense', amount_incl: 121, description: 'Software abonnement' }],
  { 'known-expense': review('domestic_input_21') }
);
assert.equal(knownExpense.aangifte['5b'], 21);
assert.equal(knownExpense.overzicht.netto, -21);

const nonDeductible = calculateFiscalVatReport(
  [{ id: 'horeca', type: 'expense', amount_incl: 109, description: 'Restaurant diner' }],
  { horeca: review('horeca_bua_9') }
);
assert.equal(nonDeductible.aangifte['5b'], 0);
assert.equal(nonDeductible.overzicht.nonDeductible, 9);

const foreignService = calculateFiscalVatReport(
  [{ id: 'foreign-service', type: 'expense', amount_incl: 100, description: 'Buitenlandse dienst' }],
  { 'foreign-service': review('non_eu_reverse_charge', 21) }
);
assert.equal(foreignService.aangifte['4a'].grondslag, 100);
assert.equal(foreignService.aangifte['4a'].btw, 21);
assert.equal(foreignService.aangifte['5b'], 21);
assert.equal(foreignService.overzicht.netto, 0);
assert.equal(foreignService.audit.ok, true);

const euLow = calculateFiscalVatReport(
  [{ id: 'eu-low', type: 'expense', amount_incl: 100, description: 'EU dienst laag tarief' }],
  { 'eu-low': review('eu_reverse_charge', 9) }
);
assert.equal(euLow.aangifte['4b'].btw, 9);
assert.equal(euLow.aangifte['5b'], 9);

const exportCase = calculateFiscalVatReport(
  [{ id: 'export', type: 'income', amount_incl: 100, description: 'Export buiten EU' }],
  { export: review('non_eu_output_0', 0) }
);
assert.equal(exportCase.aangifte['3a'].grondslag, 100);
assert.equal(exportCase.aangifte['5a'], 0);

const intra = calculateFiscalVatReport(
  [{ id: 'intra', type: 'income', amount_incl: 100, description: 'Intracommunautaire levering' }],
  { intra: review('eu_output_0', 0) }
);
assert.equal(intra.aangifte['3b'].grondslag, 100);
assert.equal(intra.aangifte['5a'], 0);

assert.throws(() => calculateFiscalVatReport([
  { id: 'bad-direction', type: 'income', amount_incl: 121, description: 'Verkoop' },
], { 'bad-direction': review('domestic_input_21') }));
assert.throws(() => calculateFiscalVatReport([
  { id: 'duplicate', type: 'income', amount_incl: 100, description: 'A' },
  { id: 'duplicate', type: 'income', amount_incl: 100, description: 'B' },
]));
assert.throws(() => calculateFiscalVatReport([{ id: 'nan', type: 'income', amount_incl: Number.NaN, description: 'Verkoop' }]));
assert.throws(() => calculateFiscalVatReport([{ id: 'inf', type: 'income', amount_incl: Number.POSITIVE_INFINITY, description: 'Verkoop' }]));
assert.throws(() => calculateFiscalVatReport(null as never));
assert.throws(() => calculateFiscalVatReport([{ id: 'bad-reviewer', type: 'expense', amount_incl: 121, description: 'Inkoop' }], { 'bad-reviewer': { classificatie: 'domestic_input_21', beoordeeld_door: '' } }));
assert.throws(() => calculateFiscalVatReport([{ id: 'unknown-id', type: 'expense', amount_incl: 121, description: 'Inkoop' }], { missing: review('domestic_input_21') }));

const summary = calculateFiscalVatReport([
  { id: 'sale-a', type: 'income', amount_incl: 121, description: 'Verkoop' },
  { id: 'summary', type: 'income', amount_incl: 121, description: 'TOTAAL' },
], { 'sale-a': review('domestic_output_21') });
assert.equal(summary.ignored.length, 1);
assert.equal(summary.audit.included, 1);
assert.equal(summary.overzicht.output.total, 21);

const ambiguousDirectionCsv = 'Datum;Naam / Omschrijving;Af Bij;Bedrag (EUR)\n20260831;Test;onbekend;100,00\n';
assert.throws(() => parseCsvToRawTransactions(ambiguousDirectionCsv));

// 10,000-row mixed stress test. This deliberately exercises multiple
// Dutch-rate/rule paths rather than only repeating one transaction shape.
const templates = [
  (i:number) => ({ id:`scale-${i}`, type:'income' as const, amount_incl:109, description:'Verkoop boek' }),
  (i:number) => ({ id:`scale-${i}`, type:'income' as const, amount_incl:121, description:'Onbekende klantbetaling' }),
  (i:number) => ({ id:`scale-${i}`, type:'expense' as const, amount_incl:100, description:'OpenAI LLC', tegenrekening_iban:'US123456789' }),
  (i:number) => ({ id:`scale-${i}`, type:'expense' as const, amount_incl:109, description:'Café De Hoek' }),
  (i:number) => ({ id:`scale-${i}`, type:'expense' as const, amount_incl:109, description:'Jumbo Supermarkten' }),
  (i:number) => ({ id:`scale-${i}`, type:'expense' as const, amount_incl:121, description:'KPN Zakelijk' }),
  (i:number) => ({ id:`scale-${i}`, type:'expense' as const, amount_incl:121, description:'Onbekende zakelijke inkoop' }),
  (i:number) => ({ id:`scale-${i}`, type:'expense' as const, amount_incl:1450, description:'Bankkosten' }),
];
const largeDataset = Array.from({ length: 10_000 }, (_, i) => templates[i % templates.length](i));
const largeReport = calculateFiscalVatReport(largeDataset);
assert.equal(largeReport.audit.input, 10_000);
assert.equal(largeReport.audit.included, 10_000);
assert.equal(largeReport.audit.unresolved, 0);
assert.equal(largeReport.audit.ignored, 0);
assert.equal(largeReport.audit.ok, true);
assert.equal(largeReport.aangifte['1a'].btw, 18_750);
assert.equal(largeReport.aangifte['1b'].btw, 11_250);
assert.equal(largeReport.aangifte['4a'].btw, 26_250);
assert.equal(largeReport.aangifte['5a'], 56_250);
assert.equal(largeReport.aangifte['5b'], 63_750);
assert.equal(largeReport.overzicht.nonDeductible, 11_250);
assert.equal(largeReport.overzicht.netto, -7_500);
assert.equal(largeReport.transactions.length, 10_000);
assert.ok(largeReport.transactions.some(t => t.confidence === 'low'));
assert.ok(largeReport.transactions.some(t => t.classification === 'domestic_output_9'));
assert.ok(largeReport.transactions.some(t => t.classification === 'domestic_output_21'));
assert.ok(largeReport.transactions.some(t => t.classification === 'non_eu_reverse_charge'));
assert.ok(largeReport.transactions.some(t => t.classification === 'horeca_bua_9'));
assert.ok(largeReport.transactions.some(t => t.classification === 'domestic_input_9'));
assert.ok(largeReport.transactions.some(t => t.classification === 'domestic_input_21'));
assert.ok(largeReport.transactions.some(t => t.classification === 'exempt_input'));

for (const report of [unknownIncome, unknownExpense, knownIncome, knownExpense, nonDeductible, foreignService, euLow, exportCase, intra, summary, largeReport]) {
  assert.equal(report.overzicht.output.total - report.overzicht.input.total, report.overzicht.netto);
  assert.equal(report.audit.included + report.audit.unresolved + report.audit.ignored, report.audit.input);
}

console.log('BTW safety smoke tests passed: automatic classification, Dutch rule cases, and 10,000-row stress test');
