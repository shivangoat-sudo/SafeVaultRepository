import type { RawTransaction } from './btwEngineSafe';

export type BtwPercentage = 0 | 9 | 21;
export type BoekhouderBeoordeling = { percentage: BtwPercentage; beoordeeld_door: string };
export const BOEKHOUDER_PERCENTAGE_OPTIES = [
  { percentage: 0 as const, label: '0%' },
  { percentage: 9 as const, label: '9%' },
  { percentage: 21 as const, label: '21%' },
];
export type FiscalClassification =
  | 'domestic_output_21' | 'domestic_output_9' | 'zero_rated_output' | 'exempt_output'
  | 'eu_output_0' | 'non_eu_output_0'
  | 'domestic_input_21' | 'domestic_input_9' | 'zero_rated_input' | 'exempt_input'
  | 'domestic_reverse_charge' | 'eu_reverse_charge' | 'non_eu_reverse_charge'
  | 'private_no_vat' | 'non_deductible_input' | 'unresolved';
export type FiscalSection = '1a'|'1b'|'1e'|'2a'|'3a'|'3b'|'4a'|'4b'|'5b'|'geen';
export interface FiscalRule { classification:FiscalClassification; section:FiscalSection; wetsbasis:string; explanation:string; requiresEvidence:boolean; }
export interface FiscalTransaction {
  id:string; date?:string; description?:string; type:'income'|'expense'; amount_incl_input:number; amount_excl:number|null;
  vat:{status:'known';rate:BtwPercentage;amount:number}|{status:'unknown';rate:null;amount:null};
  classification:FiscalClassification; section:FiscalSection; deductible:boolean; evidenceRequired:boolean;
  evidenceStatus:'not_required'|'required'|'human_confirmed'; confidence:'high'|'medium'|'low'; reason:string; rule:FiscalRule;
}
export interface FiscalOverview {
  output:{domestic21:number;domestic9:number;domesticReverse:number;euReverse:number;nonEuReverse:number;total:number};
  input:{domestic21:number;domestic9:number;reverseCharge:number;total:number};
  nonDeductible:number; netto:number; status:'af_te_dragen'|'terug_te_vorderen';
}
export interface FiscalReport {
  transactions:FiscalTransaction[]; overzicht:FiscalOverview;
  aangifte:{'1a':{grondslag:number;btw:number};'1b':{grondslag:number;btw:number};'1e':{grondslag:number;btw:number};'2a':{grondslag:number;btw:number};'3a':{grondslag:number;btw:number};'3b':{grondslag:number;btw:number};'4a':{grondslag:number;btw:number};'4b':{grondslag:number;btw:number};'5b':number};
  audit:{ok:boolean;problems:string[];input:number;known:number;unresolved:number;evidenceRequired:number;ignored:number};
  ignored:Array<{id:string;reason:string}>;
}

const EU = new Set(['AT','BE','BG','HR','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);
const norm=(s?:string)=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
const country=(iban?:string)=>String(iban??'').replace(/\s/g,'').slice(0,2).toUpperCase()||null;
const cents=(n:number)=>{if(!Number.isFinite(n))throw new Error('BTW safety: ongeldig bedrag.');const c=Math.round(n*100);if(!Number.isSafeInteger(c))throw new Error('BTW safety: bedrag te groot.');return c;};
const euros=(c:number)=>c/100;
const grossVat=(gross:number,rate:BtwPercentage)=>rate===0?0:Math.round(gross*rate/(100+rate));
const baseVat=(base:number,rate:9|21)=>Math.round(base*rate/100);
const isSummary=(tx:RawTransaction)=>/(^|\s)(totaal|subtotaal|eindtotaal|saldo|samenvatting|grand total)(\s|$)|totale btw|btw totaal|kwartaaltotaal|maandtotaal/.test(norm(`${tx.description} ${tx.memo}`));

function rule(classification:FiscalClassification):FiscalRule {
  const rules:Record<FiscalClassification,FiscalRule>={
    domestic_output_21:{classification,section:'1a',wetsbasis:'Btw-aangifte rubriek 1a',explanation:'Binnenlandse belaste omzet tegen 21%.',requiresEvidence:true},
    domestic_output_9:{classification,section:'1b',wetsbasis:'Btw-aangifte rubriek 1b',explanation:'Binnenlandse belaste omzet tegen 9%.',requiresEvidence:true},
    zero_rated_output:{classification,section:'1e',wetsbasis:'Btw-aangifte rubriek 1e',explanation:'Binnenlandse/overige prestaties tegen 0%; export en intracommunautaire leveringen worden apart als 3a/3b behandeld.',requiresEvidence:true},
    eu_output_0:{classification,section:'3b',wetsbasis:'Btw-aangifte rubriek 3b',explanation:'Intracommunautaire levering/dienst met 0%; voorwaarden en ICP-verplichting moeten uit de administratie blijken.',requiresEvidence:true},
    non_eu_output_0:{classification,section:'3a',wetsbasis:'Btw-aangifte rubriek 3a',explanation:'Uitvoer naar buiten EU met 0%; uitvoer moet aantoonbaar zijn.',requiresEvidence:true},
    exempt_output:{classification,section:'geen',wetsbasis:'Btw-vrijstelling',explanation:'Vrijgestelde omzet bevat geen Nederlandse btw en is niet hetzelfde als 0%.',requiresEvidence:true},
    domestic_input_21:{classification,section:'5b',wetsbasis:'Btw-aangifte rubriek 5b',explanation:'Nederlandse voorbelasting 21%; alleen aftrekbaar bij zakelijke belaste bestemming en voldoende factuurbewijs.',requiresEvidence:true},
    domestic_input_9:{classification,section:'5b',wetsbasis:'Btw-aangifte rubriek 5b',explanation:'Nederlandse voorbelasting 9%; alleen aftrekbaar bij zakelijke belaste bestemming en voldoende factuurbewijs.',requiresEvidence:true},
    zero_rated_input:{classification,section:'geen',wetsbasis:'0%-inkoop',explanation:'Geen Nederlandse btw om als voorbelasting af te trekken.',requiresEvidence:false},
    exempt_input:{classification,section:'geen',wetsbasis:'Vrijgestelde inkoop',explanation:'Geen Nederlandse btw om als voorbelasting af te trekken.',requiresEvidence:false},
    domestic_reverse_charge:{classification,section:'2a',wetsbasis:'Btw-aangifte rubriek 2a',explanation:'Binnenlandse verlegging. Verschuldigde btw in 2a; eventuele aftrek in 5b na beoordeling.',requiresEvidence:true},
    eu_reverse_charge:{classification,section:'4b',wetsbasis:'Btw-aangifte rubriek 4b',explanation:'Goederen/diensten uit een EU-land waarbij Nederlandse btw naar u is verlegd.',requiresEvidence:true},
    non_eu_reverse_charge:{classification,section:'4a',wetsbasis:'Btw-aangifte rubriek 4a',explanation:'Diensten/leveringen uit buiten-EU-land waarbij Nederlandse btw naar u is verlegd.',requiresEvidence:true},
    private_no_vat:{classification,section:'geen',wetsbasis:'Privégebruik/aftrekbeperking',explanation:'Geen aftrekbare voorbelasting.',requiresEvidence:true},
    non_deductible_input:{classification,section:'geen',wetsbasis:'Aftrekbeperking',explanation:'Btw niet automatisch als aftrekbare voorbelasting verwerkt.',requiresEvidence:true},
    unresolved:{classification,section:'geen',wetsbasis:'Onvoldoende fiscale feiten',explanation:'Een bankregel bevat onvoldoende feiten om de fiscale behandeling veilig vast te stellen.',requiresEvidence:true},
  }; return rules[classification];
}

type Decision={classification:FiscalClassification;rate:BtwPercentage;reason:string;confidence:'high'|'medium'|'low';deductible:boolean;evidence:'required'|'not_required'|'human_confirmed'};

function classify(tx:RawTransaction, override?:BoekhouderBeoordeling):Decision {
  const d=norm(`${tx.description} ${tx.memo}`); const c=country(tx.tegenrekening_iban);
  if(override){
    if(override.percentage===0){
      if(tx.type==='income'&&c&&c!=='NL'&&/export|uitvoer|eu|intracommunautair|eu-land/.test(d)) return {classification:EU.has(c)?'eu_output_0':'non_eu_output_0',rate:0,reason:`0% handmatig bevestigd door ${override.beoordeeld_door}; buitenlandse bestemming vereist bewijs.`,confidence:'high',deductible:false,evidence:'human_confirmed'};
      return {classification:tx.type==='income'?'zero_rated_output':'zero_rated_input',rate:0,reason:`0% handmatig bevestigd door ${override.beoordeeld_door}.`,confidence:'high',deductible:false,evidence:'human_confirmed'};
    }
    return {classification:tx.type==='income'?(override.percentage===21?'domestic_output_21':'domestic_output_9'):(override.percentage===21?'domestic_input_21':'domestic_input_9'),rate:override.percentage,reason:`Handmatig bevestigd door ${override.beoordeeld_door}.`,confidence:'high',deductible:tx.type==='expense',evidence:'human_confirmed'};
  }
  if(/priv[eé].*(opname|betaling)|eigen opname|privé/.test(d)) return {classification:'private_no_vat',rate:0,reason:'Privékarakter herkend; niet aftrekbaar.',confidence:'high',deductible:false,evidence:'required'};
  if(/vrijgesteld|exempt|vrijstelling/.test(d)) return {classification:tx.type==='income'?'exempt_output':'exempt_input',rate:0,reason:'Vrijstelling expliciet genoemd.',confidence:'high',deductible:false,evidence:'required'};
  if(tx.type==='expense'&&/restaurant|horeca|lunch|diner|café|cafe/.test(d)) return {classification:'non_deductible_input',rate:/21\s*%/.test(d)?21:9,reason:'Horeca ter plaatse is niet automatisch aftrekbaar; beoordeling van de concrete situatie blijft vereist.',confidence:'medium',deductible:false,evidence:'required'};
  const foreignReverse=tx.type==='expense'&&/btw\s*verlegd|verlegde btw|reverse charge|vat reverse|tax reverse/.test(d)&&c&&c!=='NL';
  if(foreignReverse) return {classification:EU.has(c!)?'eu_reverse_charge':'non_eu_reverse_charge',rate:21,reason:`Buitenlandse verlegging op basis van tegenrekeningland (${c}); fiscale grondslag wordt als exclusief Nederlandse btw behandeld.`,confidence:'medium',deductible:true,evidence:'required'};
  if(tx.type==='expense'&&/binnenland|nederland|nl|btw\s*verlegd|verlegde btw|reverse charge/.test(d)&&/btw\s*verlegd|verlegde btw|reverse charge/.test(d)) return {classification:'domestic_reverse_charge',rate:21,reason:'Binnenlandse verlegging expliciet genoemd; aftrek alleen na controle van voorwaarden.',confidence:/binnenland|nederland|nl/.test(d)?'high':'low',deductible:true,evidence:'required'};
  if(tx.type==='income'&&/export|uitvoer|buiten de eu|niet[- ]eu/.test(d)) return {classification:'non_eu_output_0',rate:0,reason:'Uitvoer buiten EU herkend; uitvoerbewijs vereist.',confidence:'medium',deductible:false,evidence:'required'};
  if(tx.type==='income'&&/intracommunautair|eu[- ]levering|levering eu|naar duitsland|naar belgië|naar belgie|naar frankrijk|naar spanje|naar itali[eë]|naar europa/.test(d)) return {classification:'eu_output_0',rate:0,reason:'Intracommunautaire levering/dienst vermoed; btw-id, vervoer/prestatie en ICP moeten worden gecontroleerd.',confidence:'medium',deductible:false,evidence:'required'};
  if(tx.type==='income'&&/21\s*%/.test(d)) return {classification:'domestic_output_21',rate:21,reason:'21% expliciet vermeld; factuur/prestatie blijft bewijs.',confidence:'high',deductible:false,evidence:'required'};
  if(tx.type==='income'&&/9\s*%/.test(d)) return {classification:'domestic_output_9',rate:9,reason:'9% expliciet vermeld; factuur/prestatie blijft bewijs.',confidence:'high',deductible:false,evidence:'required'};
  if(tx.type==='expense'&&/21\s*%/.test(d)) return {classification:'domestic_input_21',rate:21,reason:'21% expliciet vermeld; geldige factuur en zakelijk/belast gebruik moeten worden gecontroleerd.',confidence:'high',deductible:true,evidence:'required'};
  if(tx.type==='expense'&&/9\s*%/.test(d)) return {classification:'domestic_input_9',rate:9,reason:'9% expliciet vermeld; geldige factuur en zakelijk/belast gebruik moeten worden gecontroleerd.',confidence:'high',deductible:true,evidence:'required'};
  return {classification:'unresolved',rate:0,reason:'Onvoldoende fiscale feiten; niet meegenomen in financiële btw-totalen.',confidence:'low',deductible:false,evidence:'required'};
}

function makeTx(tx:RawTransaction,d:Decision):FiscalTransaction{
  const amount=cents(tx.amount_incl); const reverse=['domestic_reverse_charge','eu_reverse_charge','non_eu_reverse_charge'].includes(d.classification); const vatC=d.classification==='unresolved'?null:(reverse?baseVat(amount,d.rate as 9|21):grossVat(amount,d.rate)); const excl=vatC===null?null:euros(reverse?amount:amount-vatC); const r=rule(d.classification);
  return {id:tx.id,date:tx.date,description:tx.description,type:tx.type,amount_incl_input:tx.amount_incl,amount_excl:excl,vat:vatC===null?{status:'unknown',rate:null,amount:null}:{status:'known',rate:d.rate,amount:euros(vatC)},classification:d.classification,section:r.section,deductible:d.deductible,evidenceRequired:r.requiresEvidence,evidenceStatus:d.evidence,confidence:d.confidence,reason:d.reason,rule:r};
}

export function calculateFiscalVatReport(rows:RawTransaction[],overrides:Record<string,BoekhouderBeoordeling>={}):FiscalReport{
  const transactions:FiscalTransaction[]=[],ignored:FiscalReport['ignored']=[];
  for(const tx of rows){if(isSummary(tx)){ignored.push({id:tx.id,reason:'Samenvattingsregel genegeerd.'});continue;}transactions.push(makeTx(tx,classify(tx,overrides[tx.id])));}
  const a={'1a':{grondslag:0,btw:0},'1b':{grondslag:0,btw:0},'1e':{grondslag:0,btw:0},'2a':{grondslag:0,btw:0},'3a':{grondslag:0,btw:0},'3b':{grondslag:0,btw:0},'4a':{grondslag:0,btw:0},'4b':{grondslag:0,btw:0},'5b':0};
  let d21=0,d9=0,dr=0,er=0,ner=0,i21=0,i9=0,ri=0,nonDed=0;
  for(const t of transactions){if(t.vat.status!=='known')continue;const v=t.vat.amount,b=t.amount_excl??0;
    if(t.classification==='domestic_output_21'){d21+=v;a['1a'].grondslag+=b;a['1a'].btw+=v;}
    else if(t.classification==='domestic_output_9'){d9+=v;a['1b'].grondslag+=b;a['1b'].btw+=v;}
    else if(t.classification==='zero_rated_output'){a['1e'].grondslag+=b;}
    else if(t.classification==='eu_output_0'){a['3b'].grondslag+=b;}
    else if(t.classification==='non_eu_output_0'){a['3a'].grondslag+=b;}
    else if(t.classification==='domestic_reverse_charge'){dr+=v;a['2a'].grondslag+=b;a['2a'].btw+=v;if(t.deductible&&t.evidenceStatus==='human_confirmed'){ri+=v;a['5b']+=v;}}
    else if(t.classification==='eu_reverse_charge'){er+=v;a['4b'].grondslag+=b;a['4b'].btw+=v;if(t.deductible&&t.evidenceStatus==='human_confirmed'){ri+=v;a['5b']+=v;}}
    else if(t.classification==='non_eu_reverse_charge'){ner+=v;a['4a'].grondslag+=b;a['4a'].btw+=v;if(t.deductible&&t.evidenceStatus==='human_confirmed'){ri+=v;a['5b']+=v;}}
    else if(t.classification==='domestic_input_21'&&t.deductible&&t.evidenceStatus==='human_confirmed'){i21+=v;a['5b']+=v;}
    else if(t.classification==='domestic_input_9'&&t.deductible&&t.evidenceStatus==='human_confirmed'){i9+=v;a['5b']+=v;}
    else if(t.type==='expense')nonDed+=v;
  }
  const output=euros(cents(d21+d9+dr+er+ner)),input=euros(cents(i21+i9+ri)),netto=euros(cents(output-input));
  const unresolved=transactions.filter(t=>t.classification==='unresolved').length,evidence=transactions.filter(t=>t.evidenceRequired).length,problems:string[]=[];
  const outputCheck=euros(cents(transactions.filter(t=>t.vat.status==='known'&&(t.type==='income'||['domestic_reverse_charge','eu_reverse_charge','non_eu_reverse_charge'].includes(t.classification))).reduce((s,t)=>s+(t.vat.status==='known'?t.vat.amount:0),0)));
  const inputCheck=euros(cents(transactions.filter(t=>t.vat.status==='known'&&t.type==='expense'&&t.deductible&&t.evidenceStatus==='human_confirmed').reduce((s,t)=>s+(t.vat.status==='known'?t.vat.amount:0),0)));
  if(outputCheck!==output)problems.push('Onafhankelijke verschuldigde-btw-reconciliatie faalt.');
  if(inputCheck!==input)problems.push('Onafhankelijke voorbelasting-reconciliatie faalt.');
  if(euros(cents(output-input))!==netto)problems.push('Netto btw-reconciliatie faalt.');
  return {transactions,overzicht:{output:{domestic21:euros(cents(d21)),domestic9:euros(cents(d9)),domesticReverse:euros(cents(dr)),euReverse:euros(cents(er)),nonEuReverse:euros(cents(ner)),total:output},input:{domestic21:euros(cents(i21)),domestic9:euros(cents(i9)),reverseCharge:euros(cents(ri)),total:input},nonDeductible:euros(cents(nonDed)),netto,status:netto>=0?'af_te_dragen':'terug_te_vorderen'},aangifte:a,audit:{ok:problems.length===0,problems,input:rows.length,known:transactions.length-unresolved,unresolved,evidenceRequired:evidence,ignored:ignored.length},ignored};
}

export function tweeKolommenWeergave(report:FiscalReport){return {zeker:report.transactions.filter(t=>t.classification!=='unresolved').map(t=>({transactie_id:t.id,omschrijving:t.description??'',type:t.type,btw:t.vat.status==='known'?`${t.vat.rate}% — €${t.vat.amount.toFixed(2)}`:'onbekend',bedrag:`€${t.amount_incl_input.toFixed(2)}`,toegepaste_regel:t.reason})),twijfelgevallen:report.transactions.filter(t=>t.classification==='unresolved').map(t=>({transactie_id:t.id,omschrijving:t.description??'',bedrag:`€${t.amount_incl_input.toFixed(2)}`,toegepaste_regel:t.reason}))};}
export function berekenBetrouwbaarheidsscore(report:FiscalReport){if(report.audit.input===0)return 100;return Math.max(0,Math.min(100,100-(report.audit.unresolved/report.audit.input)*40-(report.audit.evidenceRequired/report.audit.input)*10-(report.audit.ok?0:30)));}
