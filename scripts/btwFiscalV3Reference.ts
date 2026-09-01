import assert from 'node:assert/strict';
import { calculateFiscalVatReport } from '../src/lib/btwFiscalSafeV3';

const auto = calculateFiscalVatReport([
  { id:'sale', type:'income', amount_incl:121, description:'Verkoop software 21%' },
  { id:'buy', type:'expense', amount_incl:121, description:'Kantoorartikelen 21%' },
]);
assert.equal(auto.overzicht.output.total, 0);
assert.equal(auto.overzicht.input.total, 0);
assert.equal(auto.audit.included, 0);
assert.equal(auto.audit.evidenceRequired, 2);
assert.equal(auto.transactions[0].includedInTotals, false);
assert.equal(auto.transactions[0].vat.status, 'known');

const confirmed = calculateFiscalVatReport([
  { id:'sale', type:'income', amount_incl:121, description:'Verkoop software 21%' },
  { id:'buy', type:'expense', amount_incl:121, description:'Kantoorartikelen 21%' },
], {
  sale:{ percentage:21, beoordeeld_door:'Boekhouder' },
  buy:{ percentage:21, beoordeeld_door:'Boekhouder' },
});
assert.equal(confirmed.overzicht.output.total, 21);
assert.equal(confirmed.overzicht.input.total, 21);
assert.equal(confirmed.overzicht.netto, 0);
assert.equal(confirmed.aangifte['1a'].grondslag, 100);
assert.equal(confirmed.aangifte['5b'], 21);
assert.equal(confirmed.audit.ok, true);

const reverse = calculateFiscalVatReport([
  { id:'eu', type:'expense', amount_incl:100, description:'EU software btw verlegd', tegenrekening_iban:'IE00TEST' },
], { eu:{ classificatie:'eu_reverse_charge', beoordeeld_door:'Boekhouder' } });
assert.equal(reverse.aangifte['4b'].grondslag, 100);
assert.equal(reverse.aangifte['4b'].btw, 21);
assert.equal(reverse.aangifte['5b'], 21);
assert.equal(reverse.overzicht.netto, 0);

const exportCase = calculateFiscalVatReport([
  { id:'export', type:'income', amount_incl:100, description:'Export buiten EU' },
], { export:{ classificatie:'non_eu_output_0', beoordeeld_door:'Boekhouder' } });
assert.equal(exportCase.aangifte['3a'].grondslag, 100);
assert.equal(exportCase.overzicht.output.total, 0);

const duplicate = [{ id:'same', type:'income' as const, amount_incl:100, description:'A' }, { id:'same', type:'income' as const, amount_incl:100, description:'B' }];
assert.throws(() => calculateFiscalVatReport(duplicate));

const summaries = calculateFiscalVatReport([
  { id:'a', type:'income', amount_incl:121, description:'Verkoop 21%' },
  { id:'total', type:'income', amount_incl:121, description:'TOTAAL' },
], { a:{ percentage:21, beoordeeld_door:'Boekhouder' } });
assert.equal(summaries.ignored.length, 1);
assert.equal(summaries.overzicht.output.total, 21);

const large = Array.from({length:20_000}, (_,i) => ({ id:`tx-${i}`, type:'income' as const, amount_incl:109, description:'Verkoop boek 9%' }));
const largeReport = calculateFiscalVatReport(large);
assert.equal(largeReport.audit.input, 20_000);
assert.equal(largeReport.audit.included, 0);
assert.equal(largeReport.transactions.length, 20_000);
assert.equal(largeReport.audit.ok, true);

console.log('BTW fiscal V3 reference tests passed');
