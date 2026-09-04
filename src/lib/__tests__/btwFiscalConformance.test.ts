import assert from 'node:assert/strict';
import { calculateFiscalVatReport, tweeKolommenWeergave } from '../btwFiscalSafeNormalized';
import type { RawTransaction } from '../btwSafeTypes';

const expense = (id: string, description: string, amount = 121, iban?: string): RawTransaction => ({ id, type: 'expense', amount_incl: amount, description, tegenrekening_iban: iban });
const income = (id: string, description: string, amount = 121, iban?: string): RawTransaction => ({ id, type: 'income', amount_incl: amount, description, tegenrekening_iban: iban });

const deterministicRows: RawTransaction[] = [
  income('out21', 'Verkoop zakelijke dienstverlening 21%'),
  income('out9', 'Verkoop boek 9%'),
  income('out0', 'Export goederen buiten EU 0%'),
  income('outExempt', 'Vrijgesteld onderwijs'),
  expense('in21', 'Kantoorbenodigdheden factuur 21%'),
  expense('in9', 'Boeken zakelijke aankoop 9%'),
  expense('zeroIn', 'Inkoop 0%'),
  expense('reverseNL', 'Btw verlegd binnenland', 121, 'NL00TEST'),
  expense('reverseEU', 'Btw verlegd EU', 121, 'IE00TEST'),
  expense('reverseNonEU', 'Btw verlegd buiten EU', 121, 'US00TEST'),
  expense('noVat', 'Salarisbetaling medewerker'),
  expense('postnl', 'PostNL Pakketten'),
  expense('hotel', 'Hotel overnachting zakelijke reis'),
  expense('foodSpecific', 'Albert Heijn Zakelijk voedingsmiddelen'),
];

const deterministic = calculateFiscalVatReport(deterministicRows);
const byId = (id: string) => deterministic.transactions.find(tx => tx.id === id)!;

const expected: Record<string, [string, string, number, boolean]> = {
  out21: ['domestic_output_21', '1a', 21, false],
  out9: ['domestic_output_9', '1b', 9, false],
  out0: ['non_eu_output_0', '3a', 0, false],
  outExempt: ['exempt_output', '1e', 0, false],
  in21: ['domestic_input_21', '5b', 21, true],
  in9: ['domestic_input_9', '5b', 9, true],
  zeroIn: ['zero_rated_input', '5b', 0, false],
  reverseNL: ['domestic_reverse_charge', '2a', 21, true],
  reverseEU: ['eu_reverse_charge', '4b', 21, true],
  reverseNonEU: ['non_eu_reverse_charge', '4a', 21, true],
  noVat: ['private_no_vat', 'geen', 0, false],
  postnl: ['domestic_input_21', '5b', 21, true],
  hotel: ['domestic_input_21', '5b', 21, true],
  foodSpecific: ['domestic_input_9', '5b', 9, true],
};

for (const [id, [classification, section, rate, deductible]] of Object.entries(expected)) {
  const tx = byId(id);
  assert.equal(tx.classification, classification, `${id}: classification`);
  assert.equal(tx.section, section, `${id}: section`);
  assert.equal(tx.vat.status, 'known', `${id}: VAT must be known`);
  assert.equal(tx.vat.status === 'known' ? tx.vat.rate : null, rate, `${id}: rate`);
  assert.equal(tx.deductible, deductible, `${id}: deductibility`);
  assert.equal(tx.includedInTotals, true, `${id}: included`);
}

const adjusted = calculateFiscalVatReport([], {}, {
  rubriek1c: { grondslag: 100, btw: 13 },
  rubriek1d: { grondslag: 50, btw: 10 },
});
assert.deepEqual(adjusted.aangifte['1c'], { grondslag: 100, btw: 13 });
assert.deepEqual(adjusted.aangifte['1d'], { grondslag: 50, btw: 10 });

const withSummary = calculateFiscalVatReport([
  income('real', 'Verkoop dienst 21%', 121),
  expense('summary', 'Totaal btw € 21,00', 21),
]);
assert.equal(withSummary.audit.ignored, 1);
assert.equal(withSummary.transactions.some(tx => tx.id === 'summary'), false);
assert.equal(withSummary.aangifte['1a'].btw, 21);

const knownSupplierProcessor = calculateFiscalVatReport([
  expense('openai-processor', 'OpenAI LLC', 24.20, 'NL00PROCESSOR'),
]);
assert.equal(byId('reverseNL').classification, 'domestic_reverse_charge');
assert.equal(knownSupplierProcessor.transactions[0].classification, 'non_eu_reverse_charge');
assert.equal(knownSupplierProcessor.transactions[0].section, '4a');

const ambiguousRows = [
  expense('cafeOnly', 'Café De Hoek', 423.50),
  expense('supermarketOnly', 'Albert Heijn Zakelijk', 32.15),
  expense('hotelMixed', 'Hotel De Zon all-in ontbijt', 150),
  expense('supermarketMixed', 'Jumbo Zakelijk boodschappen', 80),
  expense('restaurantGeneric', 'Restaurant De Molen', 145),
];
const ambiguousReport = calculateFiscalVatReport(ambiguousRows);
const ambiguousView = tweeKolommenWeergave(ambiguousReport);

for (const row of ambiguousRows) {
  const tx = ambiguousReport.transactions.find(t => t.id === row.id);
  assert.ok(tx, `${row.id}: transaction must remain visible`);
  assert.equal(tx?.classification, 'unresolved', `${row.id}: must fail closed`);
  assert.equal(tx?.vat.status, 'unknown', `${row.id}: must not invent a VAT amount`);
  assert.equal(tx?.includedInTotals, false, `${row.id}: must not affect VAT totals`);
  assert.equal(tx?.description, row.description, `${row.id}: original description must be preserved`);
}
assert.equal(ambiguousView.twijfelgevallen.length, ambiguousRows.length);
assert.equal(ambiguousReport.audit.unresolved, ambiguousRows.length);
assert.equal(ambiguousReport.audit.problems.length, 1);
assert.match(ambiguousReport.audit.problems[0], /5 transactie\(s\) vereisen boekhoudkundige beoordeling/);

const explicitRows = calculateFiscalVatReport([
  expense('foodExplicit', 'Albert Heijn Zakelijk voedingsmiddelen 9%', 32.15),
  expense('hotelExplicit', 'Hotel De Zon logies 21%', 150),
  expense('horecaExplicit', 'Café De Hoek eten en drinken 9%', 121),
]);
assert.equal(explicitRows.audit.unresolved, 0);
assert.equal(explicitRows.transactions.find(t => t.id === 'foodExplicit')?.vat.status, 'known');
assert.equal(explicitRows.transactions.find(t => t.id === 'hotelExplicit')?.vat.status, 'known');
assert.equal(explicitRows.transactions.find(t => t.id === 'horecaExplicit')?.classification, 'horeca_bua_9');

assert.equal(deterministic.aangifte['5a'], deterministic.overzicht.output.total);
assert.equal(deterministic.aangifte['5b'], deterministic.overzicht.input.total);
assert.equal(deterministic.audit.included, deterministic.transactions.filter(tx => tx.includedInTotals).length);
assert.equal(deterministic.audit.known, deterministic.transactions.filter(tx => tx.vat.status === 'known').length);

console.log('OK: fiscal conformance matrix, special sections, summary exclusion, supplier identity, ambiguity fail-closed behavior and return-total reconciliation.');
