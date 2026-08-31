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

type ClassificationDecision = { classification:FiscalClassification; rate:BtwPercentage; reason:string; confidence:'high'|'medium'|'low'; deductible:boolean; evidence:'required'|'not_required'|'human_confirmed' };
const EU = new Set(['AT','BE','BG','HR','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);
const cents=(n:number)=>{if(!Number.isFinite(n))throw new Error('BTW safety: ongeldig bedrag.');const c=Math.round(n*100);if(!Number.isSafeInteger(c))throw new Error('BTW safety: bedrag te groot.');return c;};
const euros=(c:number)=>c/100;
const grossVat=(gross:number,rate:BtwPercentage)=>rate===0?0:Math.round(gross*rate/(100+rate));
const baseVat=(base:number,rate:9|21)=>Math.round(base*rate/100);
const norm=(s?:string)=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
const isSummary=(tx:RawTransaction)=>/(^|\s)(totaal|subtotaal|eindtotaal|saldo|samenvatting|grand total)(\s|$)|totale btw|btw totaal|kwartaaltotaal|maandtotaal/.test(norm(`${tx.description} ${tx.memo}`));
const country=(iban?:string)=>String(iban??'').replace(/\s/g,'').slice(0,2).toUpperCase()||null;
const foreign=(tx:RawTransaction)=>{const c=country(tx.tegenrekening_iban);return !c||c==='NL'?null:(EU.has(c)?'eu':'non_eu');};

function rule(classification:FiscalClassification):FiscalRule {
  const r:Record<FiscalClassification,FiscalRule>={
    domestic_output_21:{classification,section:'1a',wetsbasis:'Btw-aangifte rubriek 1a',explanation:'Binnenlandse belaste omzet tegen 21%.',requiresEvidence:true},
    domestic_output_9:{classification,section:'1b',wetsbasis:'Btw-aangifte rubriek 1b',explanation:'Binnenlandse belaste omzet tegen 9%.',requiresEvidence:true},
    zero_rated_output:{classification,section:'1e',wetsbasis:'Btw-aangifte rubriek 1e; 0% of niet bij u belast',explanation:'0% is niet hetzelfde als vrijgesteld; concrete buitenlandse/overige 0%-situaties moeten op de prestatie worden bevestigd.',requiresEvidence:true},
    exempt_output:{classification,section:'geen',wetsbasis:'Btw-vrijstelling',explanation:'Vrijgestelde omzet heeft geen Nederlandse btw.',requiresEvidence:true},
    domestic_input_21:{classification,section:'5b',wetsbasis:'Btw-aangifte rubriek 5b',explanation:'Nederlandse voorbelasting tegen 21%; alleen aftrekbaar als aan de wettelijke voorwaarden is voldaan.',requiresEvidence:true},
    domestic_input_9:{classification,section:'5b',wetsbasis:'Btw-aangifte rubriek 5b',explanation:'Nederlandse voorbelasting tegen 9%; alleen aftrekbaar als aan de wettelijke voorwaarden is voldaan.',requiresEvidence:true},
    zero_rated_input:{classification,section:'geen',wetsbasis:'0%-inkoop',explanation:'Geen Nederlandse btw om als voorbelasting af te trekken.',requiresEvidence:false},
    exempt_input:{classification,section:'geen',wetsbasis:'Vrijgestelde inkoop',explanation:'Geen Nederlandse btw om af te trekken.',requiresEvidence:false},
    domestic_reverse_charge:{classification,section:'2a',wetsbasis:'Btw-aangifte rubriek 2a',explanation:'Binnenlandse verlegging; verschuldigde btw in 2a en eventuele aftrek in 5b alleen bij aftrekrecht.',requiresEvidence:true},
    eu_reverse_charge:{classification,section:'4b',wetsbasis:'Btw-aangifte rubriek 4b',explanation:'EU-inkoop waarbij Nederlandse btw wordt verlegd.',requiresEvidence:true},
    non_eu_reverse_charge:{classification,section:'4a',wetsbasis:'Btw-aangifte rubriek 4a',explanation:'Buiten-EU-inkoop waarbij Nederlandse btw wordt verlegd.',requiresEvidence:true},
    private_no_vat:{classification,section:'geen',wetsbasis:'Privégebruik/aftrekbeperking',explanation:'Geen aftrekbare voorbelasting.',requiresEvidence:true},
    non_deductible_input:{classification,section:'geen',wetsbasis:'Aftrekbeperking',explanation:'Btw niet als aftrekbare voorbelasting verwerkt.',requiresEvidence:true},
    unresolved:{classification,section:'geen',wetsbasis:'Onvoldoende fiscale feiten',explanation:'Niet genoeg informatie voor een veilige fiscale classificatie.',requiresEvidence:true},
  }; return r[classification];
}

function classify(tx:RawTransaction, override?:BoekhouderBeoordeling):ClassificationDecision {
  const d=norm(`${tx.description} ${tx.memo}`);
  if(override){
    if(override.percentage===0)return {classification:tx.type==='income'?'zero_rated_output':'zero_rated_input',rate:0,reason:`Handmatig bevestigd door ${override.beoordeeld_door}.`,confidence:'high',deductible:false,evidence:'human_confirmed'};
    return {classification:tx.type==='income'?(override.percentage===21?'domestic_output_21':'domestic_output_9'):(override.percentage===21?'domestic_input_21':'domestic_input_9'),rate:override.percentage,reason:`Handmatig bevestigd door ${override.beoordeeld_door}.`,confidence:'high',deductible:tx.type==='expense',evidence:'human_confirmed'};
  }
  if(/priv[eé].*(opname|betaling)|eigen opname|privé/.test(d))return {classification:'private_no_vat',rate:0,reason:'Privékarakter herkend.',confidence:'high',deductible:false,evidence:'required'};
  if(/vrijgesteld|exempt/.test(d))return {classification:tx.type==='income'?'exempt_output':'exempt_input',rate:0,reason:'Vrijstelling expliciet genoemd.',confidence:'high',deductible:false,evidence:'required'};
  if(/0\s*%|0%-tarief|zero[- ]rated/.test(d))return {classification:tx.type==='income'?'zero_rated_output':'zero_rated_input',rate:0,reason:'0%-tarief expliciet genoemd; concrete rubriek moet op prestatie worden bevestigd.',confidence:'medium',deductible:false,evidence:'required'};
  if(tx.type==='expense'&&/restaurant|horeca|lunch|diner|café|cafe/.test(d))return {classification:'non_deductible_input',rate:9,reason:'Horeca: niet automatisch aftrekbaar; BUA/zakelijk doel moet worden beoordeeld.',confidence:'medium',deductible:false,evidence:'required'};
  const f=foreign(tx);
  if(tx.type==='expense'&&f&&/btw\s*verlegd|verlegde btw|reverse charge|vat reverse|tax reverse/.test(d))return {classification:f==='eu'?'eu_reverse_charge':'non_eu_reverse_charge',rate:21,reason:`Buitenlandse verlegging (${f==='eu'?'EU':'buiten EU'}); bedrag geïnterpreteerd als fiscale grondslag exclusief Nederlandse btw.`,confidence:'medium',deductible:false,evidence:'required'};
  if(tx.type==='expense'&&/btw\s*verlegd|verlegde btw|reverse charge/.test(d))return {classification:'domestic_reverse_charge',rate:21,reason:'Binnenlandse verlegging; buitenlandse herkomst niet vastgesteld.',confidence:'low',deductible:false,evidence:'required'};
  if(tx.type==='income'&&/21\s*%|verkoop software|verkoop|omzet/.test(d))return {classification:'domestic_output_21',rate:21,reason:'21%-omzet op basis van expliciete omschrijving; factuur/prestatie blijft bewijs.',confidence:/21\s*%/.test(d)?'high':'medium',deductible:false,evidence:'required'};
  if(tx.type==='income'&&/9\s*%|boek|eten|voeding|kapper|hotel/.test(d))return {classification:'domestic_output_9',rate:9,reason:'9%-omzet op basis van omschrijving; prestatie moet worden bevestigd.',confidence:/9\s*%/.test(d)?'high':'medium',deductible:false,evidence:'required'};
  if(tx.type==='expense'&&/21\s*%|software|kantoor|hosting|abonnement|computer|laptop/.test(d))return {classification:'domestic_input_21',rate:21,reason:'21%-inkoop; factuur en aftrekvoorwaarden moeten worden bevestigd.',confidence:/21\s*%/.test(d)?'high':'medium',deductible:true,evidence:'required'};
  if(tx.type==='expense'&&/9\s*%|boek|eten|voeding|kapper|fiets/.test(d))return {classification:'domestic_input_9',rate:9,reason:'9%-inkoop; factuur en aftrekvoorwaarden moeten worden bevestigd.',confidence:/9\s*%/.test(d)?'high':'medium',deductible:true,evidence:'required'};
  return {classification:'unresolved',rate:0,reason:'Onvoldoende informatie; niet meegenomen in fiscale totalen.',confidence:'low',deductible:false,evidence:'required'};
}

function makeTx(tx:RawTransaction,d:ClassificationDecision):FiscalTransaction{
  const gross=cents(tx.amount_incl), reverse=d.classification==='domestic_reverse_charge'||d.classification==='eu_reverse_charge'||d.classification==='non_eu_reverse_charge';
  const vatC= d.classification==='unresolved'?null:(reverse?baseVat(gross,d.rate as 9|21):grossVat(gross,d.rate));
  const excl=vatC===null?null:euros(reverse?gross:gross-vatC); const r=rule(d.classification);
  return {id:tx.id,date:tx.date,description:tx.description,type:tx.type,amount_incl_input:tx.amount_incl,amount_excl:excl,vat:vatC===null?{status:'unknown',rate:null,amount:null}:{status:'known',rate:d.rate,amount:euros(vatC)},classification:d.classification,section:r.section,deductible:d.deductible,evidenceRequired:r.requiresEvidence,evidenceStatus:d.evidence,confidence:d.confidence,reason:d.reason,rule:r};
}

export function calculateFiscalVatReport(rows:RawTransaction[],overrides:Record<string,BoekhouderBeoordeling>={}):FiscalReport{
  const ignored:FiscalReport['ignored']=[], transactions:FiscalTransaction[]=[];
  for(const tx of rows){if(isSummary(tx)){ignored.push({id:tx.id,reason:'Samenvattingsregel genegeerd.'});continue;}transactions.push(makeTx(tx,classify(tx,overrides[tx.id])));}
  const a={ '1a':{grondslag:0,btw:0}, '1b':{grondslag:0,btw:0}, '1e':{grondslag:0,btw:0}, '2a':{grondslag:0,btw:0}, '3a':{grondslag:0,btw:0}, '3b':{grondslag:0,btw:0}, '4a':{grondslag:0,btw:0}, '4b':{grondslag:0,btw:0}, '5b':0 };
  let d21=0,d9=0,dr=0,er=0,ner=0,i21=0,i9=0,ri=0,nonDed=0;
  for(const t of transactions){if(t.vat.status!=='known')continue;const v=t.vat.amount,b=t.amount_excl??0;
    if(t.classification==='domestic_output_21'){d21+=v;a['1a'].grondslag+=b;a['1a'].btw+=v;}
    else if(t.classification==='domestic_output_9'){d9+=v;a['1b'].grondslag+=b;a['1b'].btw+=v;}
    else if(t.classification==='domestic_reverse_charge'){dr+=v;a['2a'].grondslag+=b;a['2a'].btw+=v;if(t.deductible&&t.evidenceStatus==='human_confirmed'){ri+=v;a['5b']+=v;}}
    else if(t.classification==='eu_reverse_charge'){er+=v;a['4b'].grondslag+=b;a['4b'].btw+=v;if(t.deductible&&t.evidenceStatus==='human_confirmed'){ri+=v;a['5b']+=v;}}
    else if(t.classification==='non_eu_reverse_charge'){ner+=v;a['4a'].grondslag+=b;a['4a'].btw+=v;if(t.deductible&&t.evidenceStatus==='human_confirmed'){ri+=v;a['5b']+=v;}}
    else if(t.classification==='domestic_input_21'&&t.deductible&&t.evidenceStatus==='human_confirmed'){i21+=v;a['5b']+=v;}
    else if(t.classification==='domestic_input_9'&&t.deductible&&t.evidenceStatus==='human_confirmed'){i9+=v;a['5b']+=v;}
    else if(t.type==='expense'&&v>0)nonDed+=v;
  }
  const output=euros(cents(d21+d9+dr+er+ner)), input=euros(cents(i21+i9+ri)), netto=euros(cents(output-input));
  const unresolved=transactions.filter(t=>t.classification==='unresolved').length, evidence=transactions.filter(t=>t.evidenceRequired).length;
  const problems:string[]=[]; if(transactions.filter(t=>t.vat.status==='known').some(t=>t.amount_excl===null))problems.push('Bekende btw-transactie zonder grondslag.');
  const independentOutput=euros(cents(transactions.filter(t=>t.vat.status==='known'&&t.type==='income').reduce((s,t)=>s+t.vat.amount,0)+transactions.filter(t=>t.vat.status==='known'&&(t.classification==='domestic_reverse_charge'||t.classification==='eu_reverse_charge'||t.classification==='non_eu_reverse_charge')).reduce((s,t)=>s+t.vat.amount,0)));
  if(independentOutput!==output)problems.push('Onafhankelijke verschuldigde-btw-reconciliatie faalt.');
  const independentInput=euros(cents(transactions.filter(t=>t.vat.status==='known'&&t.type==='expense'&&t.deductible&&t.evidenceStatus==='human_confirmed').reduce((s,t)=>s+t.vat.amount,0)));
  if(independentInput!==input)problems.push('Onafhankelijke voorbelasting-reconciliatie faalt.');
  if(Math.abs(output-input-netto)>0.001)problems.push('Netto btw sluit niet aan.');
  return {transactions,overzicht:{output:{domestic21:euros(cents(d21)),domestic9:euros(cents(d9)),domesticReverse:euros(cents(dr)),euReverse:euros(cents(er)),nonEuReverse:euros(cents(ner)),total:output},input:{domestic21:euros(cents(i21)),domestic9:euros(cents(i9)),reverseCharge:euros(cents(ri)),total:input},nonDeductible:euros(cents(nonDed)),netto:netto,status:netto>=0?'af_te_drage':'terug_te_vorderen'},aangifte:a,audit:{ok:problems.length===0,input:rows.length,known:transactions.length-unresolved,unresolved,evidenceRequired:evidence,ignored:ignored.length},ignored};
}

export function tweeKolommenWeergave(report:FiscalReport){return {zeker:report.transactions.filter(t=>t.classification!=='unresolved').map(t=>({transactie_id:t.id,omschrijving:t.description??'',type:t.type,btw:t.vat.status==='known'?`${t.vat.rate}% — €${t.vat.amount.toFixed(2)}`:'onbekend',bedrag:`€${t.amount_incl_input.toFixed(2)}`,toegepaste_regel:t.reason})),twijfelgevallen:report.transactions.filter(t=>t.classification==='unresolved').map(t=>({transactie_id:t.id,omschrijving:t.description??'',bedrag:`€${t.amount_incl_input.toFixed(2)}`,toegepaste_regel:t.reason}))};}
export function berekenBetrouwbaarheidsscore(report:FiscalReport){if(report.audit.input===0)return 100;const unresolvedPenalty=report.audit.unresolved/report.audit.input;const evidencePenalty=report.audit.evidenceRequired/report.audit.input;return Math.max(0,Math.min(100,100-unresolvedPenalty*40-evidencePenalty*10-(report.audit.ok?0:30)));}
