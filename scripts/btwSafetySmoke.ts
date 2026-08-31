import assert from 'node:assert/strict';
import { calculateVatReport, isTwijfelgeval } from '../src/lib/btwEngineSafe';

const unknownIncome = calculateVatReport([{ id: 'unknown-income', type: 'income', amount_incl: 121, description: 'Onbekende klantbetaling' }]);
assert.equal(unknownIncome.overzicht.verschuldigd.totaal, 0);
assert.equal(unknownIncome.overzicht.aftrekbaar.totaal, 0);
assert.equal(unknownIncome.overzicht.netto_btw, 0);
assert.equal(unknownIncome.herkenning.controle_aanbevolen.length, 1);
assert.equal(isTwijfelgeval(unknownIncome.transactions[0]), true);
assert.deepEqual(unknownIncome.transactions[0].vat, { status: 'unknown', rate: null, amount: null });

const unknownExpense = calculateVatReport([{ id: 'unknown-expense', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' }]);
assert.equal(unknownExpense.overzicht.aftrekbaar.totaal, 0);
assert.equal(isTwijfelgeval(unknownExpense.transactions[0]), true);

const knownZero = calculateVatReport(
  [{ id: 'known-zero', type: 'income', amount_incl: 100, description: 'Overheidsvergoeding' }],
  { classifications: { 'known-zero': 'omzet_vrijgesteld_0' } }
);
assert.deepEqual(knownZero.transactions[0].vat, { status: 'known', rate: 0, amount: 0 });
assert.equal(isTwijfelgeval(knownZero.transactions[0]), false);

const knownIncome = calculateVatReport([{ id: 'known-income', type: 'income', amount_incl: 109, description: 'Verkoop boek' }]);
assert.equal(knownIncome.overzicht.verschuldigd.inkomsten_9, 9);
assert.equal(knownIncome.overzicht.netto_btw, 9);

const knownExpense = calculateVatReport(
  [{ id: 'known-expense', type: 'expense', amount_incl: 121, description: 'Software abonnement' }],
  { classifications: { 'known-expense': 'kosten_algemeen_21' } }
);
assert.equal(knownExpense.overzicht.aftrekbaar.uitgaven_21, 21);

const nonDeductible = calculateVatReport(
  [{ id: 'horeca', type: 'expense', amount_incl: 109, description: 'Restaurant diner' }],
  { classifications: { horeca: 'horeca_bua_9' } }
);
assert.equal(nonDeductible.overzicht.aftrekbaar.totaal, 0);
assert.equal(nonDeductible.overzicht.niet_aftrekbaar_ter_info, 9);

const foreignService = calculateVatReport([{ id: 'foreign-service', type: 'expense', amount_incl: 121, description: 'OpenAI subscription', tegenrekening_iban: 'IE00TEST' }]);
assert.equal(foreignService.overzicht.verschuldigd.verlegde_btw, 25.41);
assert.equal(foreignService.overzicht.aftrekbaar.verlegde_btw, 25.41);
assert.equal(foreignService.overzicht.netto_btw, 0);

const manuallyResolved = calculateVatReport(
  [{ id: 'manual-expense', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' }],
  { percentageOverrides: { 'manual-expense': { percentage: 21, beoordeeld_door: 'Smoke Test' } } }
);
assert.equal(manuallyResolved.overzicht.aftrekbaar.uitgaven_21, 21);
assert.equal(manuallyResolved.herkenning.controle_aanbevolen.length, 0);
assert.deepEqual(manuallyResolved.transactions[0].vat, { status: 'known', rate: 21, amount: 21 });

for (const percentage of [0, 9, 21] as const) {
  const report = calculateVatReport(
    [{ id: `override-${percentage}`, type: 'income', amount_incl: percentage === 21 ? 121 : percentage === 9 ? 109 : 100, description: 'Onbekende omzet' }],
    { percentageOverrides: { [`override-${percentage}`]: { percentage, beoordeeld_door: 'Smoke Test' } } }
  );
  assert.equal(report.transactions[0].vat.status, 'known');
  assert.equal(report.transactions[0].vat.rate, percentage);
}

const invalidOverrides: unknown[] = [null, undefined, NaN, Infinity, -21, 99, '21', 'abc'];
for (const percentage of invalidOverrides) {
  assert.throws(() => calculateVatReport(
    [{ id: 'bad-override', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' }],
    { percentageOverrides: { 'bad-override': { percentage: percentage as 0 | 9 | 21, beoordeeld_door: 'Test' } } }
  ));
}
assert.throws(() => calculateVatReport(
  [{ id: 'missing-reviewer', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' }],
  { percentageOverrides: { 'missing-reviewer': { percentage: 21 } } }
));
assert.throws(() => calculateVatReport(
  [{ id: 'missing-id', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' }],
  { percentageOverrides: { 'not-present': { percentage: 21, beoordeeld_door: 'Test' } } }
));
assert.throws(() => calculateVatReport(
  [{ id: 'bad-direction', type: 'income', amount_incl: 121, description: 'Verkoop boek' }],
  { classifications: { 'bad-direction': 'kosten_algemeen_21' } }
));
assert.throws(() => calculateVatReport([
  { id: 'duplicate', type: 'income', amount_incl: 100, description: 'A' },
  { id: 'duplicate', type: 'income', amount_incl: 100, description: 'B' },
]));
assert.throws(() => calculateVatReport([{ id: 'nan', type: 'income', amount_incl: NaN, description: 'Verkoop' }]));
assert.throws(() => calculateVatReport([{ id: 'inf', type: 'income', amount_incl: Infinity, description: 'Verkoop' }]));
assert.throws(() => calculateVatReport(null as never));

const summary = calculateVatReport([
  { id: 'sale-a', type: 'income', amount_incl: 1210, description: 'Verkoop' },
  { id: 'sale-b', type: 'income', amount_incl: 2420, description: 'Verkoop' },
  { id: 'summary', type: 'income', amount_incl: 3630, description: 'TOTAAL' },
]);
assert.equal(summary.genegeerde_samenvattingsregels.length, 1);
assert.equal(summary.audit.input_count, 3);
assert.equal(summary.audit.ignored_count, 1);

const largeDataset = Array.from({ length: 10_000 }, (_, i) => ({ id: `scale-${i}`, type: 'income' as const, amount_incl: 109, description: 'Verkoop boek' }));
const largeReport = calculateVatReport(largeDataset);
assert.equal(largeReport.audit.input_count, 10_000);
assert.equal(largeReport.audit.trusted_count, 10_000);
assert.equal(largeReport.audit.unresolved_count, 0);
assert.equal(largeReport.audit.ignored_count, 0);
assert.equal(largeReport.audit.ok, true);
assert.equal(largeReport.overzicht.verschuldigd.totaal, 90_000);

for (const report of [unknownIncome, unknownExpense, knownZero, knownIncome, knownExpense, nonDeductible, foreignService, manuallyResolved, largeReport]) {
  assert.equal(report.overzicht.verschuldigd.totaal - report.overzicht.aftrekbaar.totaal, report.overzicht.netto_btw);
  assert.equal(report.audit.trusted_count + report.audit.unresolved_count + report.audit.ignored_count, report.audit.input_count);
}

console.log('BTW safety smoke tests passed');
