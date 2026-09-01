import type { RawTransaction } from './btwSafeTypes';

export type BtwPercentage = 0 | 9 | 21;
export type FiscalSection = '1a'|'1b'|'1c'|'1d'|'1e'|'2a'|'3a'|'3b'|'4a'|'4b'|'5a'|'5b'|'geen';
export type FiscalClassification =
  | 'domestic_output_21'|'domestic_output_9'|'other_rate_output'|'private_use_adjustment'|'zero_rated_output'|'exempt_output'
  | 'eu_output_0'|'non_eu_output_0'|'domestic_input_21'|'domestic_input_9'
  | 'non_deductible_input_21'|'non_deductible_input_9'|'horeca_bua_9'|'zero_rated_input'|'exempt_input'
  | 'domestic_reverse_charge'|'eu_reverse_charge'|'non_eu_reverse_charge'|'private_no_vat'|'unresolved';

export interface BoekhouderBeoordeling {
  classificatie: Exclude<FiscalClassification,'unresolved'|'private_use_adjustment'>;
  beoordeeld_door: string;
  percentage?: number;
}
export interface FiscalAdjustments {
  rubriek1c?: { grondslag: number; btw: number };
  rubriek1d?: { grondslag: number; btw: number };
}
export const BOEKHOUDER_PERCENTAGE_OPTIES=[{percentage:0 as const,label:'0%'},{percentage:9 as const,label:'9%'},{percentage:21 as const,label:'21%'}];
export const FISCAL_CLASSIFICATION_OPTIONS: Array<{value: BoekhouderBeoordeling['classificatie'];label:string;sections:string}> = [
 {value:'domestic_output_21',label:'Omzet binnenland — 21%',sections:'1a'},
 {value:'domestic_output_9',label:'Omzet binnenland — 9%',sections:'1b'},
 {value:'other_rate_output',label:'Omzet — overig tarief',sections:'1c'},
 {value:'zero_rated_output',label:'Omzet — 0% / niet bij u belast',sections:'1e'},
 {value:'eu_output_0',label:'Intracommunautaire levering/dienst',sections:'3b'},
 {value:'non_eu_output_0',label:'Uitvoer buiten EU',sections:'3a'},
 {value:'domestic_reverse_charge',label:'Binnenlandse verlegging',sections:'2a'},
 {value:'eu_reverse_charge',label:'Inkoop EU — verlegd',sections:'4b'},
 {value:'non_eu_reverse_charge',label:'Inkoop buiten EU — verlegd',sections:'4a'},
 {value:'domestic_input_21',label:'Inkoop binnenland — 21% aftrekbaar',sections:'5b'},
 {value:'domestic_input_9',label:'Inkoop binnenland — 9% aftrekbaar',sections:'5b'},
 {value:'non_deductible_input_21',label:'Inkoop — 21% niet aftrekbaar',sections:'geen'},
 {value:'non_deductible_input_9',label:'Inkoop — 9% niet aftrekbaar',sections:'geen'},
 {value:'horeca_bua_9',label:'Horeca — niet aftrekbaar',sections:'geen'},
 {value:'zero_rated_input',label:'Inkoop — 0%',sections:'geen'},
 {value:'exempt_output',label:'Vrijgestelde omzet',sections:'geen'},
 {value:'exempt_input',label:'Vrijgestelde inkoop',sections:'geen'},
 {value:'private_no_vat',label:'Privé-uitgave / opname',sections:'geen'}
];
export interface FiscalRule { classification:FiscalClassification; section:FiscalSection; wetsbasis:string; explanation:string; requiresEvidence:boolean }
export interface FiscalTransaction {
 id:string; date?:string; description?:string; type:'income'|'expense'; amount_incl_input:number; amount_excl:number|null;
 vat:{status:'known';rate:number;amount:number}|{status:'unknown';rate:null;amount:null}; classification:FiscalClassification; section:FiscalSection;
 deductible:boolean; evidenceRequired:boolean; evidenceStatus:'required'|'human_confirmed'; confidence:'high'|'low'; includedInTotals:boolean; reason:string; rule:FiscalRule;
}
export interface FiscalReport {
 transactions:FiscalTransaction[];
 overzicht:{output:{domestic21:number;domestic9:number;domesticOther:number;domesticReverse:number;euReverse:number;nonEuReverse:number;privateUse:number;total:number};input:{domestic21:number;domestic9:number;reverseCharge:number;total:number};nonDeductible:number;netto:number;status:'af_te_dragen'|'terug_te_vorderen'};
 aangifte:{'1a':{grondslag:number;btw:number};'1b':{grondslag:number;btw:number};'1c':{grondslag:number;btw:number};'1d':{grondslag:number;btw:number};'1e':{grondslag:number;btw:number};'2a':{grondslag:number;btw:number};'3a':{grondslag:number;btw:number};'3b':{grondslag:number;btw:number};'4a':{grondslag:number;btw:number};'4b':{grondslag:number;btw:number};'5a':number;'5b':number};
 audit:{ok:boolean;problems:string[];input:number;known:number;unresolved:number;evidenceRequired:number;ignored:number;included:number};
 ignored:Array<{id:string;reason:string}>;
}

const norm=(s?:string)=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
const cents=(n:number)=>{if(!Number.isFinite(n))throw Error('BTW safety: ongeldig bedrag.');const c=Math.round(n*100);if(!Number.isSafeInteger(c))throw Error('BTW safety: bedrag te groot.');return c};
const euros=(c:number)=>{if(!Number.isSafeInteger(c))throw Error('BTW safety: ongeldige centwaarde.');return c/100};
const add=(a:number,b:number)=>euros(cents(a)+cents(b));
const validRate=(n:number)=>Number.isFinite(n)&&n>0&&n<=100;
const reverse=(x:FiscalClassification)=>x==='domestic_reverse_charge'||x==='eu_reverse_charge'||x==='non_eu_reverse_charge';
const income=(x:FiscalClassification)=>['domestic_output_21','domestic_output_9','other_rate_output','private_use_adjustment','zero_rated_output','exempt_output','eu_output_0','non_eu_output_0'].includes(x);
const deductible=(x:FiscalClassification)=>['domestic_input_21','domestic_input_9','domestic_reverse_charge','eu_reverse_charge','non_eu_reverse_charge'].includes(x);
const summary=(t:RawTransaction)=>/\b(totaal|subtotaal|eindtotaal|eindsaldo|samenvatting|grand total|jaaroverzicht|kwartaaltotaal|maandtotaal|btw totaal|totale btw|voorbelasting totaal|te betalen btw|terug te vorderen btw)\b/.test(norm(`${t.description} ${t.memo}`));
const empty=()=>({grondslag:0,btw:0});

function section(x:FiscalClassification):FiscalSection {
 if(x==='domestic_output_21')return'1a'; if(x==='domestic_output_9')return'1b'; if(x==='other_rate_output')return'1c'; if(x==='private_use_adjustment')return'1d'; if(x==='zero_rated_output'||x==='exempt_output')return x==='zero_rated_output'?'1e':'geen';
 if(x==='domestic_reverse_charge')return'2a'; if(x==='non_eu_output_0')return'3a'; if(x==='eu_output_0')return'3b'; if(x==='non_eu_reverse_charge')return'4a'; if(x==='eu_reverse_charge')return'4b'; if(x.startsWith('domestic_input_'))return'5b'; return'geen';
}
function rule(x:FiscalClassification):FiscalRule {
 const s=section(x); const explanation:Record<FiscalSection,string>={
  '1a':'Binnenlandse leveringen/diensten tegen hoog tarief (21%).','1b':'Binnenlandse leveringen/diensten tegen laag tarief (9%).','1c':'Leveringen/diensten tegen een overig tarief, behalve 0%; alleen op expliciete fiscale bevestiging.','1d':'Privégebruik; alleen via expliciete jaar-/boekhoudkundige correctie, niet uit een losse bankregel.','1e':'0%-tarief of niet bij u belast; voorwaarden en bewijs moeten door de boekhouder worden vastgesteld.','2a':'Binnenlandse verlegging naar u; verschuldigde btw wordt zelf berekend en kan, indien aan voorwaarden voldaan, als voorbelasting worden afgetrokken.','3a':'Uitvoer buiten de EU; uitvoerbewijs vereist.','3b':'Intracommunautaire levering/dienst; btw-id, plaats van dienst/levering en ICP-voorwaarden moeten aantoonbaar zijn.','4a':'Goederen/diensten van buiten de EU waarbij Nederlandse btw naar u is verlegd.','4b':'Goederen/diensten uit een ander EU-land waarbij Nederlandse btw naar u is verlegd.','5a':'Totaal verschuldigde btw uit rubrieken 1 t/m 4.','5b':'Aftrekbare voorbelasting; alleen voor zover aan de wettelijke aftrekvoorwaarden is voldaan.','geen':'Geen financiële BTW-post.'};
 return{classification:x,section:s,wetsbasis:`Btw-aangifte rubriek ${s==='geen'?'—':s}`,explanation:explanation[s],requiresEvidence:true};
}
function rateFor(x:FiscalClassification,o:BoekhouderBeoordeling):number {
 if(x==='domestic_output_21'||x==='domestic_input_21'||x==='non_deductible_input_21')return 21;
 if(x==='domestic_output_9'||x==='domestic_input_9'||x==='non_deductible_input_9'||x==='horeca_bua_9')return 9;
 if(x==='other_rate_output'){if(!validRate(o.percentage??NaN)||[9,21].includes(o.percentage!))throw Error('BTW safety: 1c vereist een expliciet overig BTW-tarief (niet 0%, 9% of 21%).');return o.percentage!;}
 if(reverse(x)){const r=o.percentage??21;if(r!==9&&r!==21)throw Error('BTW safety: verlegging vereist 9% of 21%.');return r;}
 return 0;
}
function decide(t:RawTransaction,o?:BoekhouderBeoordeling){
 if(!o)return{x:'unresolved' as const,r:0,d:false,reason:'Niet financieel meegenomen: expliciete boekhoudkundige bevestiging vereist.'};
 if(!o.beoordeeld_door.trim())throw Error(`BTW safety: beoordelaar ontbreekt voor ${t.id}.`);
 if(o.classificatie==='private_use_adjustment')throw Error('BTW safety: privégebruik-correcties moeten als expliciete rubriek 1d-correctie worden aangeleverd.');
 if((t.type==='income'&&!income(o.classificatie))||(t.type==='expense'&&income(o.classificatie)))throw Error(`BTW safety: classificatie ${o.classificatie} past niet bij ${t.type}-transactie ${t.id}.`);
 const r=rateFor(o.classificatie,o); return{x:o.classificatie,r,d:t.type==='expense'&&deductible(o.classificatie),reason:`Handmatig fiscaal bevestigd door ${o.beoordeeld_door}.`};
}
function make(t:RawTransaction,o?:BoekhouderBeoordeling):FiscalTransaction {
 const q=decide(t,o),rr=rule(q.x),gross=cents(Math.abs(t.amount_incl)); const v=q.x==='unresolved'?null:reverse(q.x)?Math.round(gross*q.r/100):Math.round(gross*q.r/(100+q.r)); const base=v===null?null:reverse(q.x)?gross:gross-v;
 return{id:t.id,date:t.date,description:t.description,type:t.type,amount_incl_input:Math.abs(t.amount_incl),amount_excl:base===null?null:euros(base),vat:v===null?{status:'unknown',rate:null,amount:null}:{status:'known',rate:q.r,amount:euros(v)},classification:q.x,section:rr.section,deductible:q.d,evidenceRequired:true,evidenceStatus:o?'human_confirmed':'required',confidence:o?'high':'low',includedInTotals:!!o,reason:q.reason,rule:rr};
}

export function calculateFiscalVatReport(rows:RawTransaction[],overrides:Record<string,BoekhouderBeoordeling>={},adjustments: FiscalAdjustments={}):FiscalReport {
 if(!Array.isArray(rows))throw Error('BTW safety: transacties moeten een array zijn.');
 const ids=new Set<string>(); for(const t of rows){if(!t||typeof t.id!=='string'||!t.id.trim()||ids.has(t.id))throw Error(`BTW safety: ongeldig of dubbel transactie-ID ${t?.id??''}.`);ids.add(t.id);if(t.type!=='income'&&t.type!=='expense')throw Error(`BTW safety: ongeldige richting ${t.id}.`);cents(t.amount_incl)}
 for(const id of Object.keys(overrides))if(!ids.has(id))throw Error(`BTW safety: override voor onbekende transactie ${id}.`);
 const ts:FiscalTransaction[]=[],ignored:FiscalReport['ignored']=[]; for(const t of rows){if(summary(t)){ignored.push({id:t.id,reason:'Samenvattingsregel genegeerd; geen individuele boeking.'});continue}ts.push(make(t,overrides[t.id]));}
 const a={'1a':empty(),'1b':empty(),'1c':empty(),'1d':empty(),'1e':empty(),'2a':empty(),'3a':empty(),'3b':empty(),'4a':empty(),'4b':empty(),'5a':0,'5b':0};
 if(adjustments.rubriek1c){a['1c']={grondslag:euros(cents(adjustments.rubriek1c.grondslag)),btw:euros(cents(adjustments.rubriek1c.btw))};if(a['1c'].btw<0||a['1c'].grondslag<0)throw Error('BTW safety: 1c-correctie mag niet negatief zijn.');}
 if(adjustments.rubriek1d){a['1d']={grondslag:euros(cents(adjustments.rubriek1d.grondslag)),btw:euros(cents(adjustments.rubriek1d.btw))};if(a['1d'].btw<0||a['1d'].grondslag<0)throw Error('BTW safety: 1d-correctie mag niet negatief zijn.');}
 let o21=0,o9=0,oo=0,dr=0,er=0,nr=0,i21=0,i9=0,ri=0,nd=0;
 for(const t of ts){if(!t.includedInTotals||t.vat.status!=='known')continue;const v=t.vat.amount,b=t.amount_excl??0;switch(t.section){case'1a':a['1a'].grondslag=add(a['1a'].grondslag,b);a['1a'].btw=add(a['1a'].btw,v);o21=add(o21,v);break;case'1b':a['1b'].grondslag=add(a['1b'].grondslag,b);a['1b'].btw=add(a['1b'].btw,v);o9=add(o9,v);break;case'1c':a['1c'].grondslag=add(a['1c'].grondslag,b);a['1c'].btw=add(a['1c'].btw,v);oo=add(oo,v);break;case'1e':a['1e'].grondslag=add(a['1e'].grondslag,b);break;case'2a':a['2a'].grondslag=add(a['2a'].grondslag,b);a['2a'].btw=add(a['2a'].btw,v);dr=add(dr,v);if(t.deductible)ri=add(ri,v);break;case'3a':a['3a'].grondslag=add(a['3a'].grondslag,b);break;case'3b':a['3b'].grondslag=add(a['3b'].grondslag,b);break;case'4a':a['4a'].grondslag=add(a['4a'].grondslag,b);a['4a'].btw=add(a['4a'].btw,v);nr=add(nr,v);if(t.deductible)ri=add(ri,v);break;case'4b':a['4b'].grondslag=add(a['4b'].grondslag,b);a['4b'].btw=add(a['4b'].btw,v);er=add(er,v);if(t.deductible)ri=add(ri,v);break;case'5b':if(t.deductible&&t.classification==='domestic_input_21')i21=add(i21,v);if(t.deductible&&t.classification==='domestic_input_9')i9=add(i9,v);break}if(t.type==='expense'&&!t.deductible)nd=add(nd,v)}
 const out=add(add(add(add(o21,o9),oo),add(dr,er)),add(nr,a['1d'].btw)); const inp=add(add(i21,i9),ri); const net=add(out,-inp); a['5a']=out; a['5b']=inp;
 const unresolved=ts.filter(t=>t.classification==='unresolved').length, included=ts.filter(t=>t.includedInTotals).length, evidenceRequired=ts.filter(t=>!t.includedInTotals).length, problems:string[]=[];
 if(unresolved>0)problems.push(`${unresolved} transactie(s) hebben nog geen expliciete fiscale beoordeling.`); if(ts.some(t=>t.includedInTotals&&t.evidenceStatus!=='human_confirmed'))problems.push('Niet-bevestigde post in financiële totalen.');
 const independentOut=ts.filter(t=>t.includedInTotals&&t.vat.status==='known'&&((t.type==='income'&&!['exempt_output','zero_rated_output','eu_output_0','non_eu_output_0'].includes(t.classification))||reverse(t.classification))).reduce((s,t)=>add(s,t.vat.amount),a['1d'].btw+a['1c'].btw);
 const independentIn=ts.filter(t=>t.includedInTotals&&t.type==='expense'&&t.deductible&&t.vat.status==='known').reduce((s,t)=>add(s,t.vat.amount),0);
 if(independentOut!==out)problems.push(`Onafhankelijke verschuldigde-BTW controle faalt (${independentOut.toFixed(2)} != ${out.toFixed(2)}).`); if(independentIn!==inp)problems.push(`Onafhankelijke voorbelastingcontrole faalt (${independentIn.toFixed(2)} != ${inp.toFixed(2)}).`); if(add(independentOut,-independentIn)!==net)problems.push('Onafhankelijke nettocontrole faalt.');
 return{transactions:ts,overzicht:{output:{domestic21:o21,domestic9:o9,domesticOther:oo,domesticReverse:dr,euReverse:er,nonEuReverse:nr,privateUse:a['1d'].btw,total:out},input:{domestic21:i21,domestic9:i9,reverseCharge:ri,total:inp},nonDeductible:nd,netto:net,status:net>=0?'af_te_dragen':'terug_te_vorderen'},aangifte:a,audit:{ok:problems.length===0,problems,input:rows.length,known:ts.filter(t=>t.classification!=='unresolved').length,unresolved,evidenceRequired,ignored:ignored.length,included},ignored};
}
export function tweeKolommenWeergave(r:FiscalReport){return{zeker:r.transactions.filter(t=>t.includedInTotals).map(t=>({transactie_id:t.id,omschrijving:t.description??'',type:t.type,btw:t.vat.status==='known'?`${t.vat.rate}% — €${t.vat.amount.toFixed(2)}`:'onbekend',bedrag:`€${t.amount_incl_input.toFixed(2)}`,toegepaste_regel:t.reason})),twijfelgevallen:r.transactions.filter(t=>!t.includedInTotals).map(t=>({transactie_id:t.id,omschrijving:t.description??'',type:t.type,bedrag:`€${t.amount_incl_input.toFixed(2)}`,classificatie:t.classification,toegepaste_regel:t.reason}))};}
export function berekenBetrouwbaarheidsscore(r:FiscalReport){if(r.audit.input===0)return 100;const u=r.audit.unresolved/r.audit.input*35;const e=r.audit.evidenceRequired/r.audit.input*15;return Math.max(0,Math.min(100,100-u-e-(r.audit.ok?0:50)));}
