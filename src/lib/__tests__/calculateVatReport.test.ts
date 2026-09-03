import { calculateFiscalVatReport, type BoekhouderBeoordeling } from '../btwFiscalSafePolicy';
import type { RawTransaction } from '../btwSafeTypes';

const review=(classificatie:BoekhouderBeoordeling['classificatie'],percentage?:number):BoekhouderBeoordeling=>({classificatie,beoordeeld_door:'Testboekhouder',...(percentage===undefined?{}:{percentage})});
const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
const unknownIncome=calculateFiscalVatReport([{id:'unknown-income',description:'',amount_incl:121,type:'income'}]);
assert(!unknownIncome.audit.ok,'Een onbeoordeelde onbekende transactie mag het fiscale rapport niet als compleet markeren.');
assert(unknownIncome.audit.unresolved===1,'Onvoldoende informatie moet unresolved zijn.');
assert(unknownIncome.audit.included===0,'Een unresolved transactie mag niet in de financiële totalen komen.');
assert(unknownIncome.aangifte['5a']===0&&unknownIncome.aangifte['5b']===0,'Unresolved btw mag niet in 5a/5b terechtkomen.');
assert(unknownIncome.transactions[0].vat.status==='unknown','Unresolved transactie moet onbekende btw hebben.');
const rows:RawTransaction[]=[{id:'sale-21',description:'Verkoop 21%',amount_incl:121,type:'income'},{id:'sale-9',description:'Verkoop 9%',amount_incl:109,type:'income'},{id:'buy-21',description:'Inkoop 21%',amount_incl:121,type:'expense'},{id:'buy-9',description:'Inkoop 9%',amount_incl:109,type:'expense'},{id:'eu-rc-21',description:'EU dienst verlegd',amount_incl:100,type:'expense'},{id:'eu-rc-9',description:'EU dienst laag tarief verlegd',amount_incl:100,type:'expense'}];
const overrides:Record<string,BoekhouderBeoordeling>={'sale-21':review('domestic_output_21'),'sale-9':review('domestic_output_9'),'buy-21':review('domestic_input_21'),'buy-9':review('domestic_input_9'),'eu-rc-21':review('eu_reverse_charge',21),'eu-rc-9':review('eu_reverse_charge',9)};
const report=calculateFiscalVatReport(rows,overrides);
assert(report.aangifte['1a'].btw===21,`1a moet €21 zijn, kreeg ${report.aangifte['1a'].btw}`);assert(report.aangifte['1b'].btw===9,`1b moet €9 zijn, kreeg ${report.aangifte['1b'].btw}`);assert(report.aangifte['4b'].btw===30,`4b moet €30 zijn, kreeg ${report.aangifte['4b'].btw}`);assert(report.aangifte['5b']===60,`5b moet €60 zijn, kreeg ${report.aangifte['5b']}`);assert(report.aangifte['5a']===60,`5a moet €60 zijn, kreeg ${report.aangifte['5a']}`);assert(report.overzicht.netto===0,`netto moet €0 zijn, kreeg ${report.overzicht.netto}`);assert(report.audit.unresolved===0&&report.audit.included===rows.length,'Alle expliciet bevestigde transacties moeten worden meegenomen.');
const merchantNamedTotaal=calculateFiscalVatReport([{id:'merchant-totaal',amount_incl:121,type:'income',description:'Totaal Energie'}],{'merchant-totaal':review('domestic_output_21')});assert(merchantNamedTotaal.audit.ignored===0,'Een echte merchantnaam die met Totaal begint mag niet als samenvattingsregel worden genegeerd.');assert(merchantNamedTotaal.aangifte['1a'].btw===21,'Totaal Energie moet als echte 21%-transactie worden verwerkt.');
const oneC=calculateFiscalVatReport([{id:'sports',amount_incl:113,type:'income',description:'Sportkantine forfait'}],{sports:review('other_rate_output',13)});assert(oneC.aangifte['1c'].btw===13,`1c 13%-forfait moet €13 zijn, kreeg ${oneC.aangifte['1c'].btw}`);

// De engine moet zelf duidelijke Nederlandse transactiebeschrijvingen kunnen herkennen.
const smart=calculateFiscalVatReport([
  {id:'smart-consultancy',amount_incl:1210,type:'income',description:'Factuur consultancy advies'},
  {id:'smart-kpn',amount_incl:121,type:'expense',description:'KPN zakelijk abonnement'},
  {id:'smart-ns',amount_incl:109,type:'expense',description:'NS Zakelijk reis naar klant'},
]);
assert(smart.transactions[0].classification==='domestic_output_21'&&smart.transactions[0].vat.status==='known','Duidelijke consultancy-omzet moet automatisch als 21% worden herkend.');
assert(smart.transactions[1].classification==='domestic_input_21'&&smart.transactions[1].vat.status==='known','Duidelijke Nederlandse telecomuitgave moet automatisch als 21% worden herkend.');
assert(smart.transactions[2].classification==='domestic_input_9'&&smart.transactions[2].vat.status==='known','Zakelijke NS-transactie moet automatisch als 9% worden herkend.');
assert(smart.audit.included===3&&smart.audit.unresolved===0,'Duidelijk herkenbare transacties mogen niet onnodig als unresolved eindigen.');

// Merchant/contextherkenning: de bankomschrijving hoeft het product niet letterlijk te noemen.
const merchantContext=calculateFiscalVatReport([
  {id:'gall',amount_incl:121,type:'expense',description:'GALL & GALL'},
  {id:'pathe',amount_incl:109,type:'expense',description:'Pathé bioscoop'},
  {id:'basic-fit',amount_incl:109,type:'expense',description:'BASIC-FIT'},
  {id:'coolblue',amount_incl:121,type:'expense',description:'Coolblue'},
]);
assert(merchantContext.transactions[0].classification==='domestic_input_21','GALL & GALL moet via merchantcontext automatisch 21% worden herkend zonder dat wijn/drank in de omschrijving staat.');
assert(merchantContext.transactions[1].classification==='domestic_input_9','Pathé moet via merchantcontext automatisch als bioscoop/9% worden herkend.');
assert(merchantContext.transactions[2].classification==='domestic_input_9','Basic-Fit moet via merchantcontext automatisch als sport/9% worden herkend.');
assert(merchantContext.transactions[3].classification==='domestic_input_21','Coolblue moet via merchantcontext automatisch als algemene goederen/21% worden herkend.');
assert(merchantContext.audit.included===4&&merchantContext.audit.unresolved===0,'Bekende merchants mogen niet onnodig in de handmatige wachtrij terechtkomen.');

// Product-/dienstregels: de engine koppelt herkenbare omschrijvingen aan het Nederlandse tarief.
const dutchRules=calculateFiscalVatReport([
  {id:'food',amount_incl:109,type:'income',description:'Verkoop brood en voedingsmiddelen'},
  {id:'book',amount_incl:109,type:'income',description:'Verkoop schoolboek'},
  {id:'flowers',amount_incl:109,type:'income',description:'Verkoop bloemboeket'},
  {id:'hair',amount_incl:109,type:'income',description:'Kapsalon knipbeurt'},
  {id:'alcohol',amount_incl:121,type:'income',description:'Verkoop wijn'},
  {id:'electronics',amount_incl:121,type:'income',description:'Verkoop laptop'},
]);
assert(dutchRules.transactions[0].classification==='domestic_output_9','Voedingsmiddelen moeten automatisch 9% zijn.');
assert(dutchRules.transactions[1].classification==='domestic_output_9','Boeken moeten automatisch 9% zijn.');
assert(dutchRules.transactions[2].classification==='domestic_output_9','Sierteeltproducten moeten automatisch 9% zijn.');
assert(dutchRules.transactions[3].classification==='domestic_output_9','Kappersdiensten moeten automatisch 9% zijn.');
assert(dutchRules.transactions[4].classification==='domestic_output_21','Alcoholhoudende dranken moeten automatisch 21% zijn.');
assert(dutchRules.transactions[5].classification==='domestic_output_21','Elektronica moet automatisch 21% zijn.');
assert(dutchRules.transactions.every(tx=>tx.vat.status==='known'&&tx.includedInTotals),'Duidelijke wettelijke tariefregels moeten zonder boekhouderoverride worden verwerkt.');
assert(dutchRules.transactions[0].rule.wetsbasis.includes('Tabel I'),'De toegepaste 9%-regel moet de wettelijke basis tonen.');

// Als 9% en 21% signalen beide voorkomen, geldt de afgesproken bankregel: 21%.
const mixed=calculateFiscalVatReport([{id:'mixed',amount_incl:121,type:'expense',description:'Supermarkt eten en alcohol'}]);
assert(mixed.transactions[0].classification==='domestic_input_21','Een omschrijving met zowel 9%- als 21%-signalen moet volgens de productpolicy 21% worden.');
assert(mixed.audit.unresolved===0,'Een gemengde 9%/21%-omschrijving mag niet naar de boekhouder worden doorgeschoven.');

// Buitenlandse IBAN alleen is nooit bewijs voor verlegging.
const foreignService=calculateFiscalVatReport([{id:'foreign-service',amount_incl:121,type:'expense',description:'Software subscription',tegenrekening_iban:'DE12345678901234567890'}]);
assert(foreignService.transactions[0].classification==='unresolved','Buitenlandse IBAN + algemene serviceomschrijving mag niet automatisch reverse charge worden.');
assert(foreignService.aangifte['4a'].btw===0&&foreignService.aangifte['4b'].btw===0,'Onbewezen buitenlandse verlegging mag niet automatisch in 4a/4b terechtkomen.');

// Logies is sinds 1 januari 2026 21% en mag niet met de oude 9%-regel worden behandeld.
const lodging2026=calculateFiscalVatReport([{id:'hotel',amount_incl:121,type:'income',description:'Hotel overnachting Amsterdam 2026'}]);
assert(lodging2026.transactions[0].classification==='domestic_output_21','Logies in 2026 moet 21% zijn.');

let threw=false;try{calculateFiscalVatReport([{id:'bad-1c',amount_incl:105,type:'income',description:'Onbekend overig tarief'}],{'bad-1c':review('other_rate_output',5)});}catch{threw=true}assert(threw,'Een willekeurig 1c-tarief moet worden geweigerd.');
threw=false;try{calculateFiscalVatReport([{id:'bad',amount_incl:121,type:'expense'}],{bad:review('domestic_output_21')});}catch{threw=true}assert(threw,'Een omzetclassificatie op een expense-transactie moet worden geweigerd.');
threw=false;try{calculateFiscalVatReport([{id:'dup',amount_incl:121,type:'income'},{id:'dup',amount_incl:109,type:'income'}]);}catch{threw=true}assert(threw,'Dubbele transactie-ID moet worden geweigerd.');
console.log('OK: veilige fiscale rapportage, merchant-contextherkenning, slimme Nederlandse product-/dienstregels, mixed-rate policy, unresolved fail-closed, Nederlandse 1c-policy, merchant-summary safety, verlegging 9/21%, classificatievalidatie en reconciliatie.');
