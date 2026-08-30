import assert from 'node:assert/strict';
import { calculateVatReport, isTwijfelgeval } from '../src/lib/btwEngineSafe';

const unknownIncome = calculateVatReport([
  { id: 'unknown-income', type: 'income', amount_incl: 121, description: 'Onbekende klantbetaling' },
]);
assert.equal(unknownIncome.overzicht.verschuldigd.totaal, 0);
assert.equal(unknownIncome.overzicht.aftrekbaar.totaal, 0);
assert.equal(unknownIncome.overzicht.netto_btw, 0);
assert.equal(unknownIncome.herkenning.controle_aanbevolen.length, 1);
assert.equal(isTwijfelgeval(unknownIncome.transactions[0]), true);
assert.equal(unknownIncome.transactions[0].btw_bedrag, 0);
assert.equal(unknownIncome.transactions[0].classification, 'twijfel_onvoldoende_informatie');

const unknownExpense = calculateVatReport([
  { id: 'unknown-expense', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' },
]);
assert.equal(unknownExpense.overzicht.aftrekbaar.totaal, 0);
assert.equal(unknownExpense.herkenning.controle_aanbevolen.length, 1);
assert.equal(isTwijfelgeval(unknownExpense.transactions[0]), true);

const knownIncome = calculateVatReport([
  { id: 'known-income', type: 'income', amount_incl: 109, description: 'Verkoop boek' },
]);
assert.equal(knownIncome.overzicht.verschuldigd.inkomsten_9, 9);
assert.equal(knownIncome.overzicht.verschuldigd.totaal, 9);
assert.equal(knownIncome.audit.ok, true);

const foreignService = calculateVatReport([
  { id: 'foreign-service', type: 'expense', amount_incl: 121, description: 'OpenAI subscription', tegenrekening_iban: 'IE00TEST' },
]);
assert.equal(foreignService.overzicht.verschuldigd.verlegde_btw, 25.41);
assert.equal(foreignService.overzicht.aftrekbaar.verlegde_btw, 25.41);
assert.equal(foreignService.overzicht.netto_btw, 0);
assert.equal(foreignService.audit.ok, true);

const manuallyResolved = calculateVatReport(
  [{ id: 'manual-expense', type: 'expense', amount_incl: 121, description: 'Onbekende leverancier' }],
  { percentageOverrides: { 'manual-expense': { percentage: 21, beoordeeld_door: 'Smoke Test' } } }
);
assert.equal(manuallyResolved.overzicht.aftrekbaar.uitgaven_21, 21);
assert.equal(manuallyResolved.herkenning.controle_aanbevolen.length, 0);
assert.equal(manuallyResolved.audit.ok, true);

for (const report of [unknownIncome, unknownExpense, knownIncome, foreignService, manuallyResolved]) {
  assert.equal(
    report.overzicht.verschuldigd.totaal - report.overzicht.aftrekbaar.totaal,
    report.overzicht.netto_btw,
    'Netto BTW must equal verschuldigd minus aftrekbaar'
  );
}

console.log('BTW safety smoke tests passed');
