import assert from 'node:assert/strict';
import { calculateFiscalVatReport } from '../src/lib/btwFiscalSafeV3';

const other=calculateFiscalVatReport([{id:'other',type:'income',amount_incl:113,description:'Historische prestatie'}],{other:{classificatie:'other_rate_output',percentage:13,beoordeeld_door:'Boekhouder'}});
assert.equal(other.aangifte['1c'].grondslag,100); assert.equal(other.aangifte['1c'].btw,13); assert.equal(other.aangifte['5a'],13);
const reverse9=calculateFiscalVatReport([{id:'r9',type:'expense',amount_incl:100,description:'Verlegd'}],{r9:{classificatie:'eu_reverse_charge',percentage:9,beoordeeld_door:'Boekhouder'}});
assert.equal(reverse9.aangifte['4b'].btw,9); assert.equal(reverse9.aangifte['5b'],9); assert.equal(reverse9.overzicht.netto,0);
const adjustment=calculateFiscalVatReport([],{}, {rubriek1c:{grondslag:100,btw:13},rubriek1d:{grondslag:500,btw:105}});
assert.equal(adjustment.aangifte['1c'].btw,13); assert.equal(adjustment.aangifte['1d'].btw,105); assert.equal(adjustment.aangifte['5a'],118); assert.equal(adjustment.overzicht.netto,118); assert.equal(adjustment.audit.ok,true);
assert.throws(()=>calculateFiscalVatReport([{id:'bad',type:'income',amount_incl:100,description:'bad'}],{bad:{classificatie:'other_rate_output',percentage:21,beoordeeld_door:'Boekhouder'}}));
assert.throws(()=>calculateFiscalVatReport([{id:'bad',type:'expense',amount_incl:100,description:'bad'}],{bad:{classificatie:'eu_reverse_charge',percentage:13,beoordeeld_door:'Boekhouder'}}));
console.log('BTW fiscal edge-case tests passed');
