import { calculateFiscalVatReport } from '../btwFiscalSafePolicy';

const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};

const bankOnly=calculateFiscalVatReport([{
  id:'tx_bank_only',amount_incl:121,type:'income',description:'Verkoop'
}],{});
assert(!bankOnly.audit.ok,'Een banktransactie zonder voldoende fiscale gegevens mag niet stilzwijgend als 21% worden berekend');
assert(bankOnly.transactions.length===1,'De banktransactie moet worden verwerkt en controleerbaar blijven');
assert(bankOnly.transactions[0].vat.status==='unknown','Onvoldoende fiscale informatie moet een onbekende BTW-status opleveren');
assert(bankOnly.transactions[0].vat.rate===null,'Onvoldoende fiscale informatie mag geen BTW-tarief invullen');
assert(bankOnly.transactions[0].vat.amount===null,'Onvoldoende fiscale informatie mag geen BTW-bedrag invullen');
assert(bankOnly.transactions[0].includedInTotals===false,'Onvoldoende fiscale informatie mag niet in financiële BTW-totalen terechtkomen');
assert(bankOnly.aangifte['1a'].btw===0,'Onvoldoende informatie mag niet automatisch in rubriek 1a terechtkomen');
assert(bankOnly.aangifte['5a']===0,'Onvoldoende informatie mag niet als verschuldigde BTW worden geteld');

const withIrrelevantSubmittedFields=calculateFiscalVatReport([{
  id:'tx_submitted_fields',amount_incl:121,type:'income',description:'Verkoop',
  submitted_amount_excl:110.99,submitted_vat_amount:10.01,submitted_vat_percentage:9,submitted_section:'1a'
}],{});
assert(!withIrrelevantSubmittedFields.audit.ok,'Irrelevante ingediende velden mogen onvoldoende bankbewijs niet omzetten in een bekende fiscale classificatie');
assert(withIrrelevantSubmittedFields.transactions[0].vat.status==='unknown','De banktransactie blijft onbekend wanneer alleen irrelevante klantvelden aanwezig zijn');
assert(withIrrelevantSubmittedFields.transactions[0].vat.rate===null,'Klantvelden mogen geen BTW-tarief afdwingen');
assert(withIrrelevantSubmittedFields.transactions[0].vat.amount===null,'Klantvelden mogen geen BTW-bedrag afdwingen');
assert(withIrrelevantSubmittedFields.aangifte['1a'].btw===0,'Klantvelden mogen geen BTW in rubriek 1a creëren');
assert(withIrrelevantSubmittedFields.aangifte['1b'].btw===0,'Klantvelden mogen geen BTW in rubriek 1b creëren');

const reviewed=calculateFiscalVatReport([{
  id:'tx_reviewed',amount_incl:121,type:'income',description:'Verkoop'
}],{
  tx_reviewed:{classificatie:'domestic_output_21',beoordeeld_door:'Boekhouder test'}
});
assert(reviewed.audit.ok,'Een expliciete boekhouderbeoordeling moet een geldige classificatie kunnen activeren');
assert(reviewed.transactions[0].vat.status==='known','Expliciete beoordeling moet een bekende BTW-status opleveren');
assert(reviewed.transactions[0].vat.rate===21,'De expliciet beoordeelde verkoop moet 21% gebruiken');
assert(reviewed.transactions[0].vat.amount===21,'€121 inclusief 21% bevat €21 BTW');
assert(reviewed.aangifte['1a'].btw===21,'De beoordeelde verkoop moet in rubriek 1a terechtkomen');

console.log('BTW production submission audit tests: OK');
