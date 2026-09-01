import { calculateFiscalVatReport } from '../btwFiscalSafePolicy';

const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};

const correct=calculateFiscalVatReport([{
  id:'tx_correct',amount_incl:121,type:'income',description:'Verkoop',
  submitted_amount_excl:100,submitted_vat_amount:21,submitted_vat_percentage:21,submitted_section:'1a'
}],{tx_correct:{classificatie:'domestic_output_21',beoordeeld_door:'Test'}});
assert(correct.audit.ok,'Correct ingediende BTW mag de productie-audit niet laten falen');

const incorrect=calculateFiscalVatReport([{
  id:'tx_wrong',amount_incl:121,type:'income',description:'Verkoop',
  submitted_amount_excl:110.99,submitted_vat_amount:10.01,submitted_vat_percentage:9,submitted_section:'1a'
}],{tx_wrong:{classificatie:'domestic_output_21',beoordeeld_door:'Test'}});
assert(!incorrect.audit.ok,'Een foutieve ingediende BTW-post moet de productie-audit laten falen');
assert(incorrect.audit.problems.some(p=>p.includes('tx_wrong')),'De afwijking moet aan de transactie worden gekoppeld');

const absent=calculateFiscalVatReport([{
  id:'tx_bank_only',amount_incl:121,type:'income',description:'Verkoop'
}],{});
assert(absent.audit.problems.length>0,'Een niet-beoordeelde banktransactie blijft een fiscale controlewaarschuwing');

console.log('BTW production submission audit tests: OK');
