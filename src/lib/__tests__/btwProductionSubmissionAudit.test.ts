import { calculateFiscalVatReport } from '../btwFiscalSafePolicy';

const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};

const bankOnly=calculateFiscalVatReport([{
  id:'tx_bank_only',amount_incl:121,type:'income',description:'Verkoop'
}],{});
assert(bankOnly.audit.ok,'Een banktransactie zonder factuurgegevens moet zonder auditfout berekend kunnen worden');
assert(bankOnly.transactions.length===1,'De banktransactie moet daadwerkelijk worden verwerkt');
assert(bankOnly.transactions[0].vat.status==='known','Een berekenbare banktransactie moet bekende BTW opleveren');
assert(bankOnly.transactions[0].vat.rate===21,'Een gewone binnenlandse verkoop moet volgens het algemene Nederlandse tarief op 21% uitkomen');
assert(bankOnly.transactions[0].vat.amount===21,'€121 inclusief 21% bevat €21 BTW');

const withIrrelevantSubmittedFields=calculateFiscalVatReport([{
  id:'tx_submitted_fields',amount_incl:121,type:'income',description:'Verkoop',
  submitted_amount_excl:110.99,submitted_vat_amount:10.01,submitted_vat_percentage:9,submitted_section:'1a'
}],{});
assert(withIrrelevantSubmittedFields.audit.ok,'Optionele ingediende factuurvelden mogen een bankgebaseerde berekening niet laten falen');
assert(withIrrelevantSubmittedFields.transactions[0].vat.status==='known','De banktransactie blijft berekenbaar wanneer optionele factuurvelden aanwezig zijn');
assert(withIrrelevantSubmittedFields.transactions[0].vat.rate===21,'De BTW-berekening moet op de banktransactie en fiscale classificatie gebaseerd blijven, niet op ingediende factuurvelden');
assert(withIrrelevantSubmittedFields.transactions[0].vat.amount===21,'De banktransactie bepaalt de berekende BTW: €121 inclusief 21% bevat €21 BTW');

console.log('BTW production submission audit tests: OK');
