import assert from 'node:assert/strict';
import { calculateFiscalVatReport } from '../src/lib/btwFiscalSafeNormalized';

const rows = [
  { id:'sale21', type:'income' as const, amount_incl:121, description:'Verkoop software 21%' },
  { id:'sale9', type:'income' as const, amount_incl:109, description:'Verkoop boek 9%' },
  { id:'buy21', type:'expense' as const, amount_incl:121, description:'Kantoorartikelen 21%' },
  { id:'buy9', type:'expense' as const, amount_incl:109, description:'Boek 9%' },
  { id:'restaurant', type:'expense' as const, amount_incl:109, description:'Restaurant diner' },
  { id:'domesticRc', type:'expense' as const, amount_incl:100, description:'Onderaanneming btw verlegd', tegenrekening_iban:'NL00TEST' },
  { id:'eu', type:'expense' as const, amount_incl:100, description:'Software EU btw verlegd', tegenrekening_iban:'IE00TEST' },
  { id:'nonEu', type:'expense' as const, amount_incl:100, description:'Software VS btw verlegd', tegenrekening_iban:'US00TEST' },
  { id:'exempt', type:'income' as const, amount_incl:100, description:'Vrijgestelde prestatie' },
  { id:'zero', type:'income' as const, amount_incl:100, description:'Export 0%-tarief' },
  { id:'summary', type:'income' as const, amount_incl:874, description:'TOTAAL' },
];

const r = calculateFiscalVatReport(rows, {
  buy21:{percentage:21, beoordeeld_door:'test-boekhouder'},
  buy9:{percentage:9, beoordeeld_door:'test-boekhouder'},
  domesticRc:{percentage:21, beoordeeld_door:'test-boekhouder'},
  eu:{percentage:21, beoordeeld_door:'test-boekhouder'},
  nonEu:{percentage:21, beoordeeld_door:'test-boekhouder'},
});

assert.equal(r.aangifte['1a'].btw, 21);
assert.equal(r.aangifte['1b'].btw, 9);
assert.equal(r.aangifte['2a'].btw, 21);
assert.equal(r.aangifte['4b'].btw, 21);
assert.equal(r.aangifte['4a'].btw, 21);
assert.equal(r.aangifte['5b'], 21 + 9 + 21 + 21 + 21);
assert.equal(r.overzicht.nonDeductible, 9);
assert.equal(r.ignored.length, 1);
assert.equal(r.audit.input, 11);
assert.equal(r.audit.ok, true);
assert.equal(r.overzicht.output.total - r.overzicht.input.total, r.overzicht.netto);
assert.equal(r.transactions.find(x => x.id === 'exempt')?.classification, 'exempt_output');
assert.equal(r.transactions.find(x => x.id === 'zero')?.classification, 'zero_rated_output');
assert.equal(r.transactions.find(x => x.id === 'zero')?.section, '1e');
assert.equal(r.transactions.find(x => x.id === 'domesticRc')?.section, '2a');
assert.equal(r.transactions.find(x => x.id === 'eu')?.section, '4b');
assert.equal(r.transactions.find(x => x.id === 'nonEu')?.section, '4a');
assert.equal(r.transactions.find(x => x.id === 'domesticRc')?.amount_excl, 100);
assert.deepEqual(r.transactions.find(x => x.id === 'domesticRc')?.vat, { status:'known', rate:21, amount:21 });
console.log('Dutch VAT fiscal reference tests passed');
