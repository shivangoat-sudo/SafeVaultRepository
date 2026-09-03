import assert from 'node:assert/strict';
import { calculateFiscalVatReport } from '../src/lib/btwFiscalSafeCore';
import { parseCsvToRawTransactions } from '../src/utils/vatCsvParser';

const review = (classificatie: Parameters<typeof calculateFiscalVatReport>[1][string]['classificatie'], percentage?: number) => ({
  classificatie,
  beoordeeld_door: 'Smoke Test',
  ...(percentage === undefined ? {} : { percentage }),
});

// Bank data without sufficient fiscal evidence must fail closed.
const unknownIncome = calculateFiscalVatReport([
  { id: 'unknown-income', type: 'income', amount_incl: 121, description: 'Onbekende klantbetaling' },
]);
assert.equal(unknownIncome.aangifte['1a'].btw, 0);
assert.equal(unknownIncome.aangifte['5a'], 0);
assert.equal(unknownIncome.overzicht.netto, 0);
assert.equal(unknownIncome.audit.unresolved, 1);
assert.equal(unknownIncome.audit.included, 0);
assert.equal(unknownIncome.audit.ok, false);
assert.equal(unknownIncome.transactions[0].vat.status, 'unknown');
assert.equal(unknownIncome.transactions[0].vat.rate, null);
assert.equal(unknownIncome.transactions[0].vat.amount, null);
assert.equal(unknownIncome.transactions[0].includedInTotals, false);

const unknownExpense = calculateFiscalVatReport([
  { id: 'unknown-expense', type: 'expense', amount_incl: 121, description: 'Onbekende zakelijke inkoop' },
]);
assert.equal(unknownExpense.aangifte['5b'], 0);
assert.equal(unknownExpense.overzicht.netto, 0);
assert.equal(unknownExpense.audit.unresolved, 1);
assert.equal(unknownExpense.audit.ok, false);
assert.equal(unknownExpense.transactions[0].vat.status, 'unknown');

// Explicit 9% text is high-confidence and can be calculated automatically.
const explicitNine = calculateFiscalVatReport([
  { id: 'automatic-9', type: 'income', amount_incl: 109, description: 'Verkoop boek 9%' },
]);
assert.equal(explicitNine.transactions[0].classification, 'domestic_output_9');
assert.equal(explicitNine.transactions[0].vat.status, 'known');
assert.equal(explicitNine.transactions[0].vat.rate, 9);
assert.equal(explicitNine.aangifte['1b'].btw, 9);
assert.equal(explicitNine.aangifte['1a'].btw, 0);

// Irrelevant submitted/customer-calculated fields must not override bank data.
const withIrrelevantSubmittedFields = calculateFiscalVatReport([{
  id: 'submitted-fields',
  amount_incl: 121,
  type: 'income',
  description: 'Onbekende klantbetaling',
  submitted_amount_excl: 110.99,
  submitted_vat_amount: 10.01,
  submitted_vat_percentage: 9,
  submitted_section: '1a',
}], {});
assert.equal(withIrrelevantSubmittedFields.transactions[0].vat.status, 'unknown');
assert.equal(withIrrelevantSubmittedFields.transactions[0].vat.rate, null);
assert.equal(withIrrelevantSubmittedFields.transactions[0].vat.amount, null);
assert.equal(withIrrelevantSubmittedFields.aangifte['1a'].btw, 0);
assert.equal(withIrrelevantSubmittedFields.aangifte['1b'].btw, 0);
assert.equal(withIrrelevantSubmittedFields.audit.ok, false);

// A bookkeeper review is the explicit path to a known fiscal result.
const knownIncome = calculateFiscalVatReport(
  [{ id: 'known-income', type: 'income', amount_incl: 109, description: 'Verkoop boek' }],
  { 'known-income': review('domestic_output_9') },
);
assert.equal(knownIncome.aangifte['1b'].grondslag, 100);
assert.equal(knownIncome.aangifte['1b'].btw, 9);
assert.equal(knownIncome.aangifte['5a'], 9);
assert.equal(knownIncome.overzicht.netto, 9);
assert.equal(knownIncome.audit.ok, true);

const knownExpense = calculateFiscalVatReport(
  [{ id: 'known-expense', type: 'expense', amount_incl: 121, description: 'Software abonnement' }],
  { 'known-expense': review('domestic_input_21') },
);
assert.equal(knownExpense.aangifte['5b'], 21);
assert.equal(knownExpense.overzicht.netto, -21);
assert.equal(knownExpense.audit.ok, true);

const nonDeductible = calculateFiscalVatReport(
  [{ id: 'horeca', type: 'expense', amount_incl: 109, description: 'Restaurant diner' }],
  { horeca: review('horeca_bua_9') },
);
assert.equal(nonDeductible.aangifte['5b'], 0);
assert.equal(nonDeductible.overzicht.nonDeductible, 9);
assert.equal(nonDeductible.audit.ok, true);

const foreignService = calculateFiscalVatReport(
  [{ id: 'foreign-service', type: 'expense', amount_incl: 100, description: 'Buitenlandse dienst' }],
  { 'foreign-service': review('non_eu_reverse_charge', 21) },
);
assert.equal(foreignService.aangifte['4a'].grondslag, 100);
assert.equal(foreignService.aangifte['4a'].btw, 21);
assert.equal(foreignService.aangifte['5b'], 21);
assert.equal(foreignService.overzicht.netto, 0);
assert.equal(foreignService.audit.ok, true);

const exportCase = calculateFiscalVatReport(
  [{ id: 'export', type: 'income', amount_incl: 100, description: 'Export buiten EU' }],
  { export: review('non_eu_output_0', 0) },
);
assert.equal(exportCase.aangifte['3a'].grondslag, 100);
assert.equal(exportCase.aangifte['5a'], 0);

const intra = calculateFiscalVatReport(
  [{ id: 'intra', type: 'income', amount_incl: 100, description: 'Intracommunautaire levering' }],
  { intra: review('eu_output_0', 0) },
);
assert.equal(intra.aangifte['3b'].grondslag, 100);
assert.equal(intra.aangifte['5a'], 0);

// Structural input validation.
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
assert.throws(() => calculateFiscalVatReport([
  { id: 'bad-reviewer', type: 'expense', amount_incl: 121, description: 'Inkoop' },
], { 'bad-reviewer': { classificatie: 'domestic_input_21', beoordeeld_door: '' } }));
assert.throws(() => calculateFiscalVatReport([
  { id: 'unknown-id', type: 'expense', amount_incl: 121, description: 'Inkoop' },
], { missing: review('domestic_input_21') }));

const summary = calculateFiscalVatReport([
  { id: 'sale-a', type: 'income', amount_incl: 121, description: 'Verkoop' },
  { id: 'summary', type: 'income', amount_incl: 121, description: 'TOTAAL' },
], { 'sale-a': review('domestic_output_21') });
assert.equal(summary.ignored.length, 1);
assert.equal(summary.audit.included, 1);
assert.equal(summary.overzicht.output.total, 21);

const ambiguousDirectionCsv = 'Datum;Naam / Omschrijving;Af Bij;Bedrag (EUR)\n20260831;Test;onbekend;100,00\n';
assert.throws(() => parseCsvToRawTransactions(ambiguousDirectionCsv));

// 10,000-row stress test. Every row is explicitly classified so the expected
// fiscal totals do not depend on keyword heuristics.
const templates = [
  (i: number) => ({ id: `scale-${i}`, type: 'income' as const, amount_incl: 109, description: 'Verkoop boek 9%' }),
  (i: number) => ({ id: `scale-${i}`, type: 'income' as const, amount_incl: 121, description: 'Verkoop software 21%' }),
  (i: number) => ({ id: `scale-${i}`, type: 'expense' as const, amount_incl: 100, description: 'Buitenlandse dienst', tegenrekening_iban: 'US123456789' }),
  (i: number) => ({ id: `scale-${i}`, type: 'expense' as const, amount_incl: 109, description: 'Restaurant diner' }),
  (i: number) => ({ id: `scale-${i}`, type: 'expense' as const, amount_incl: 109, description: 'Inkoop boodschappen' }),
  (i: number) => ({ id: `scale-${i}`, type: 'expense' as const, amount_incl: 109, description: 'Inkoop boeken' }),
  (i: number) => ({ id: `scale-${i}`, type: 'expense' as const, amount_incl: 121, description: 'KPN Zakelijk' }),
  (i: number) => ({ id: `scale-${i}`, type: 'expense' as const, amount_incl: 100, description: 'Vrijgestelde dienst' }),
];
const largeDataset = Array.from({ length: 10_000 }, (_, i) => templates[i % templates.length](i));
const largeOverrides: Record<string, ReturnType<typeof review>> = {};
for (let i = 0; i < largeDataset.length; i += 1) {
  switch (i % templates.length) {
    case 0: largeOverrides[`scale-${i}`] = review('domestic_output_9'); break;
    case 1: largeOverrides[`scale-${i}`] = review('domestic_output_21'); break;
    case 2: largeOverrides[`scale-${i}`] = review('non_eu_reverse_charge', 21); break;
    case 3: largeOverrides[`scale-${i}`] = review('horeca_bua_9'); break;
    case 4: largeOverrides[`scale-${i}`] = review('domestic_input_9'); break;
    case 5: largeOverrides[`scale-${i}`] = review('domestic_input_9'); break;
    case 6: largeOverrides[`scale-${i}`] = review('domestic_input_21'); break;
    case 7: largeOverrides[`scale-${i}`] = review('exempt_input'); break;
  }
}
const largeReport = calculateFiscalVatReport(largeDataset, largeOverrides);
assert.equal(largeReport.audit.input, 10_000);
assert.equal(largeReport.audit.included, 10_000);
assert.equal(largeReport.audit.unresolved, 0);
assert.equal(largeReport.audit.ignored, 0);
assert.equal(largeReport.audit.ok, true);
assert.equal(largeReport.aangifte['1a'].btw, 26_250);
assert.equal(largeReport.aangifte['1b'].btw, 11_250);
assert.equal(largeReport.aangifte['4a'].btw, 26_250);
assert.equal(largeReport.aangifte['5a'], 63_750);
assert.equal(largeReport.aangifte['5b'], 75_000);
assert.equal(largeReport.overzicht.nonDeductible, 11_250);
assert.equal(largeReport.overzicht.netto, -11_250);
assert.equal(largeReport.transactions.length, 10_000);
assert.ok(largeReport.transactions.every(t => t.confidence === 'high'));

for (const report of [unknownIncome, unknownExpense, explicitNine, withIrrelevantSubmittedFields, knownIncome, knownExpense, nonDeductible, foreignService, exportCase, intra, summary, largeReport]) {
  assert.equal(report.overzicht.output.total - report.overzicht.input.total, report.overzicht.netto);
  assert.equal(report.audit.included + report.audit.unresolved + report.audit.ignored, report.audit.input);
}

console.log('BTW safety smoke tests passed: fail-closed inference, explicit review path, validation, and 10,000-row stress test');
