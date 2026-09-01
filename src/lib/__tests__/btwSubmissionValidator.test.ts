import { controleerIngediendeBtwPost } from '../btwSubmissionValidator';

const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};

const ok=controleerIngediendeBtwPost({id:'ok',amount_incl:121,btw_bedrag:21,btw_percentage:21,type:'income',rubriek:'1a'});
assert(ok.status==='correct','€121 inclusief 21% moet €21 btw opleveren');

const wrong=controleerIngediendeBtwPost({id:'wrong',amount_incl:121,btw_bedrag:10.01,btw_percentage:9,type:'income',rubriek:'1a'});
assert(wrong.status==='afwijking','Een 9%-post in 1a moet als afwijking worden gemarkeerd');
assert(wrong.afwijkingen.some(x=>x.includes('wijkt af')),'De afwijking in het btw-bedrag moet worden gemeld');

const excl=controleerIngediendeBtwPost({id:'excl',amount_excl:100,btw_bedrag:21,btw_percentage:21,type:'income',rubriek:'1a'});
assert(excl.status==='correct','€100 exclusief + €21 bij 21% moet correct zijn');

const incomplete=controleerIngediendeBtwPost({id:'incomplete',amount_incl:121,type:'income'});
assert(incomplete.status==='onvoldoende_gegevens','Zonder tarief en btw-bedrag mag de controle niet gokken');

const wrongSection=controleerIngediendeBtwPost({id:'section',amount_incl:109,btw_bedrag:9,btw_percentage:9,type:'income',rubriek:'1a'});
assert(wrongSection.status==='afwijking','9% omzet in 1a moet worden afgekeurd');

const inputIn5a=controleerIngediendeBtwPost({id:'input5a',amount_incl:121,btw_bedrag:21,btw_percentage:21,type:'expense',rubriek:'5a'});
assert(inputIn5a.status==='afwijking','Een gewone inkoop hoort niet in 5a');

console.log('BTW submission validator tests: OK');
