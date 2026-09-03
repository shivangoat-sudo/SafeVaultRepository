import type { RawTransaction } from './btwSafeTypes';

export type BtwPercentage = 0 | 9 | 21;
export type FiscalSection = '1a'|'1b'|'1c'|'1d'|'1e'|'2a'|'3a'|'3b'|'4a'|'4b'|'5a'|'5b'|'geen';
export type FiscalClassification =
  | 'domestic_output_21'|'domestic_output_9'|'other_rate_output'|'private_use_adjustment'
  | 'zero_rated_output'|'exempt_output'|'eu_output_0'|'non_eu_output_0'
  | 'domestic_input_21'|'domestic_input_9'|'non_deductible_input_21'|'non_deductible_input_9'
  | 'horeca_bua_9'|'zero_rated_input'|'exempt_input'
  | 'domestic_reverse_charge'|'eu_reverse_charge'|'non_eu_reverse_charge'
  | 'private_no_vat'|'unresolved';
export interface BoekhouderBeoordeling { classificatie: Exclude<FiscalClassification,'unresolved'>; beoordeeld_door:string; percentage?:number; }
export interface FiscalAdjustments { rubriek1c?:{grondslag:number;btw:number}; rubriek1d?:{grondslag:number;btw:number} }
export const BOEKHOUDER_PERCENTAGE_OPTIES=[{percentage:0 as const,label:'0%'},{percentage:9 as const,label:'9%'},{percentage:21 as const,label:'21%'}];
export interface FiscalRule { classification:FiscalClassification;section:FiscalSection;wetsbasis:string;explanation:string;requiresEvidence:boolean }
export interface FiscalTransaction { id:string;date?:string;description?:string;type:'income'|'expense';amount_incl_input:number;amount_excl:number|null;vat:{status:'known';rate:number;amount:number}|{status:'unknown';rate:null;amount:null};classification:FiscalClassification;section:FiscalSection;deductible:boolean;evidenceRequired:boolean;evidenceStatus:'required'|'human_confirmed'|'not_required';confidence:'high'|'low';includedInTotals:boolean;reason:string;rule:FiscalRule;transactie_id:string;omschrijving:string;bedrag:number;btw:number|null;toegepaste_regel:string; }
export interface FiscalReport { transactions:FiscalTransaction[]; overzicht:{output:{domestic21:number;domestic9:number;domesticOther:number;domesticReverse:number;euReverse:number;nonEuReverse:number;privateUse:number;total:number};input:{domestic21:number;domestic9:number;reverseCharge:number;total:number};nonDeductible:number;netto:number;status:'af_te_drager'|'terug_te_vorderen'}; aangifte:{'1a':{grondslag:number;btw:number};'1b':{grondslag:number;btw:number};'1c':{grondslag:number;btw:number};'1d':{grondslag:number;btw:number};'1e':{grondslag:number;btw:number};'2a':{grondslag:number;btw:number};'3a':{grondslag:number;btw:number};'3b':{grondslag:number;btw:number};'4a':{grondslag:number;btw:number};'4b':{grondslag:number;btw:number};'5a':number;'5b':number}; audit:{ok:boolean;problems:string[];input:number;known:number;unresolved:number;evidenceRequired:number;ignored:number;included:number}; ignored:Array<{id:string;reason:string}>; }
const cents=(n:number)=>{if(!Number.isFinite(n))throw new Error('BTW safety: ongeldig bedrag.');const c=Math.round(n*100);if(!Number.isSafeInteger(c))throw new Error('BTW safety: bedrag te groot.');return c;};
const euros=(c:number)=>c/100; const add=(a:number,b:number)=>euros(cents(a)+cents(b)); const norm=(s?:string)=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
const reverse=(x:FiscalClassification)=>x==='domestic_reverse_charge'||x==='eu_reverse_charge'||x==='non_eu_reverse_charge';
const deductible=(x:FiscalClassification)=>x==='domestic_input_21'||x==='domestic_input_9'||reverse(x);
const EU=new Set(['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);
const SUMMARY_TERMS=/\b(subtotaal|eindtotaal|eindsaldo|jaaroverzicht|kwartaaltotaal|maandtotaal|btw totaal|btw-totaal|totale btw|voorbelasting totaal|te betalen btw|terug te vorderen btw|grand total|samenvatting)\b/i;
function isSummary(t:RawTransaction){const text=norm(`${t.description} ${t.memo}`);if(SUMMARY_TERMS.test(text))return true;const first=norm(t.description).split(' ')[0]??'';return first==='totaal'||first==='saldo'||first==='eindtotaal';}
function section(x:FiscalClassification):FiscalSection { if(x==='domestic_output_21')return'1a';if(x==='domestic_output_9')return'1b';if(x==='other_rate_output')return'1c';if(x==='private_use_adjustment')return'1d';if(x==='zero_rated_output'||x==='exempt_output')return'1e';if(x==='domestic_reverse_charge')return'2a';if(x==='non_eu_output_0')return'3a';if(x==='eu_output_0')return'3b';if(x==='non_eu_reverse_charge')return'4a';if(x==='eu_reverse_charge')return'4b';if(x.startsWith('domestic_input_')||x.startsWith('non_deductible_input_')||x==='horeca_bua_9'||x==='zero_rated_input'||x==='exempt_input')return'5b';return'geen'; }
function rule(x:FiscalClassification):FiscalRule { const s=section(x);const explanation:Record<FiscalSection,string>={'1a':'Binnenlandse omzet belast tegen 21% (Wet OB 1968, art. 9 lid 1).','1b':'Binnenlandse omzet belast tegen 9% indien de prestatie onder Tabel I valt (Wet OB 1968, art. 9 lid 2).','1c':'Overig tarief; alleen gebruiken voor een expliciete fiscale correctie, zoals het 13%-forfait voor sportkantines.','1d':'Privégebruik; alleen via een expliciete fiscale correctie.','1e':'0%-tarief of vrijstelling; de wettelijke voorwaarden bepalen de behandeling.','2a':'Binnenlandse verlegging; verschuldigde en aftrekbare btw worden afzonderlijk verwerkt waar aftrek is toegestaan.','3a':'Uitvoer buiten de EU; 0% alleen indien aan de voorwaarden voor uitvoer is voldaan.','3b':'Intracommunautaire levering/dienst; voorwaarden en ICP-verplichtingen moeten kloppen.','4a':'Inkoop buiten de EU met verlegging.','4b':'Inkoop uit de EU met verlegging.','5a':'Totaal verschuldigde btw.','5b':'Voorbelasting; aftrek alleen voor zover wettelijk toegestaan.','geen':'Geen financiële btw-post.'};return{classification:x,section:s,wetsbasis:`Btw-aangifte rubriek ${s==='geen'?'—':s}`,explanation:explanation[s],requiresEvidence:false}; }
type ClassificationHit={x:FiscalClassification;reason:string;confidence:'high'|'low';p?:number};

const NL_SERVICE_21=/\b(consultancy|consultant|adviesbureau|adviesdiensten|accountancy|accountant|boekhoud(?:ing|er)|administratiekantoor|juridisch advies|advocaat|notaris|marketing|reclame|advertising|webdesign|website|webhosting|hosting|softwareontwikkeling|ict[- ]?(?:dienst|diensten|beheer)|it[- ]?(?:dienst|diensten|support)|cloud[- ]?(?:dienst|diensten)|saas|logistiek|transportdienst|vrachtvervoer|installatie|onderhoudscontract|reparatiebedrijf|drukwerk|drukkerij)\b/i;
const NL_SERVICE_9=/\b(kapper|kapsalon|fietsenmaker|fietsreparatie|fiets reparatie|schoenenreparatie|schoenmaker|kledingreparatie|personenvervoer|taxi|openbaar vervoer|ov[- ]?chipkaart|treinreis|busreis|tramreis|metroreis|boek|boeken|tijdschrift|periodiek|e[- ]?boek)\b/i;
const EXEMPT_SERVICE=/\b(verzekeringspremie|verzekering premie|zorgverzekering|bankrente|rente|medische behandeling|tandartsbehandeling|tandheelkundige behandeling)\b/i;
const DOMESTIC_21_MERCHANT=/\b(kpn|vodafone|odido|ziggo|transip|exact online|afas|staples nederland|schoonmaakbedrijf)\b/i;
const DOMESTIC_9_MERCHANT=/\b(ns zakelijk|nederlandse spoorwegen|arriva|ret|gvb|connexxion)\b/i;

function domesticContext(tx:RawTransaction){const country=String(tx.tegenrekening_iban??'').replace(/\s/g,'').toUpperCase().slice(0,2);return !country||country==='NL';}

function classifyFromText(tx:RawTransaction):ClassificationHit|null {
  const text=norm(`${tx.description} ${tx.memo}`);
  if(!text)return null;

  if(/\b(priv[eé](?:-opname| opname)?|priveopname|prive storting|privestorting)\b/i.test(text))
    return{x:'private_no_vat',reason:'Privétransactie herkend; geen btw-prestatie.',confidence:'high'};

  if(tx.type==='expense'&&/\b(belastingdienst|belastingaanslag|inkomstenbelasting|loonheffing|premie volksverzekering)\b/i.test(text))
    return{x:'private_no_vat',reason:'Belastingbetaling herkend; dit is geen btw op een inkoop.',confidence:'low'};

  if(tx.type==='expense'&&/\b(bankkosten|bank fee|rekeningkosten|betaalrekening|overboekingkosten)\b/i.test(text))
    return{x:'exempt_input',reason:'Betalingsverkeer/bankkosten herkend; financiële dienstverlening is vaak van btw vrijgesteld.',confidence:'low'};

  if(/\b(export|uitvoer|exporteren)\b/i.test(text)&&tx.type==='income')
    return{x:'non_eu_output_0',reason:'Uitvoer-signaal gevonden; 0% alleen toepassen als de wettelijke uitvoervoorwaarden zijn vervuld.',confidence:'low'};

  if(/\b(vrijgesteld|vrijstelling|btw-vrij|zonder btw wegens vrijstelling)\b/i.test(text))
    return{x:tx.type==='income'?'exempt_output':'exempt_input',reason:'Expliciete vermelding van vrijstelling.',confidence:'high'};

  const pct0=/(^|[^0-9])0\s*%([^0-9]|$)/.test(text),pct9=/(^|[^0-9])9\s*%([^0-9]|$)/.test(text),pct21=/(^|[^0-9])21\s*%([^0-9]|$)/.test(text);

  if(/\b(btw verlegd|btw-verlegd|verlegde btw|reverse charge)\b/i.test(text)){
    const country=String(tx.tegenrekening_iban??'').replace(/\s/g,'').toUpperCase().slice(0,2);
    if(country&&/^[A-Z]{2}$/.test(country))
      return{x:country==='NL'?'domestic_reverse_charge':EU.has(country)?'eu_reverse_charge':'non_eu_reverse_charge',reason:`Expliciet verleggingssignaal met landcode ${country}.`,confidence:'high'};
  }

  if(pct0)return{x:tx.type==='income'?'zero_rated_output':'zero_rated_input',reason:'Expliciet 0%-tarief in de bankomschrijving.',confidence:'high'};
  if(pct9)return{x:tx.type==='income'?'domestic_output_9':'domestic_input_9',reason:'Expliciet 9%-tarief in de bankomschrijving.',confidence:'high'};
  if(pct21)return{x:tx.type==='income'?'domestic_output_21':'domestic_input_21',reason:'Expliciet 21%-tarief in de bankomschrijving.',confidence:'high'};

  if(EXEMPT_SERVICE.test(text))
    return{x:tx.type==='income'?'exempt_output':'exempt_input',reason:'De omschrijving noemt een dienst die in de genoemde vorm onder een btw-vrijstelling kan vallen.',confidence:'low'};

  // Duidelijke Nederlandse 9%-prestaties uit Tabel I. Deze regels gebruiken
  // uitsluitend de omschrijving en worden niet toegepast wanneer de IBAN een
  // buitenlands land aanduidt. Voor voorbelasting blijft de zakelijke context
  // bepalend; de omschrijving is hier alleen voldoende voor het tarief.
  if(domesticContext(tx)&&NL_SERVICE_9.test(text))
    return{x:tx.type==='income'?'domestic_output_9':'domestic_input_9',reason:'De omschrijving wijst op een herkenbare Nederlandse 9%-prestatie uit Tabel I.',confidence:'high'};

  // De hoofdregel is 21%. Voor duidelijk herkenbare Nederlandse zakelijke
  // diensten/leveringen kan de omschrijving daarom automatisch 21% opleveren.
  // Buitenlandse tegenpartijen worden hier bewust niet automatisch als
  // reverse charge aangemerkt: alleen een buitenlandse IBAN is daarvoor geen
  // voldoende fiscale grond.
  if(domesticContext(tx)&&(NL_SERVICE_21.test(text)||DOMESTIC_21_MERCHANT.test(text)))
    return{x:tx.type==='income'?'domestic_output_21':'domestic_input_21',reason:'De omschrijving herkent een duidelijke Nederlandse zakelijke prestatie waarop de algemene 21%-regel van toepassing is.',confidence:'high'};

  // Specifieke Nederlandse OV-vervoerders: 9% is het tarief voor personenvervoer.
  // De aftrekbaarheid hangt wel af van zakelijke reisvoorwaarden; daarom wordt
  // deze regel alleen automatisch gebruikt wanneer de transactieomschrijving
  // zelf een zakelijke vervoerscontext bevat.
  if(domesticContext(tx)&&DOMESTIC_9_MERCHANT.test(text)&&/\b(zakelijk|business|werk|bedrijf|reis|reizen)\b/i.test(text))
    return{x:tx.type==='income'?'domestic_output_9':'domestic_input_9',reason:'Nederlandse personenvervoer-transactie met zakelijke context; 9%-tarief toegepast.',confidence:'high'};

  // Geen reverse-charge meer op basis van alleen een buitenlandse IBAN plus
  // een algemeen woord als software/service. Dat kan tot onjuiste 4a/4b-posts
  // leiden wanneer de leverancier toch Nederlandse btw factureert.
  return null;
}

function classify(tx:RawTransaction):ClassificationHit { const hit=classifyFromText(tx);if(hit)return hit;return{x:'unresolved',reason:'De omschrijving bevat onvoldoende specifieke fiscale informatie om het btw-tarief of de fiscale behandeling veilig vast te stellen.',confidence:'low'}; }
function overrideClassification(tx:RawTransaction,o:BoekhouderBeoordeling){if(!o.beoordeeld_door?.trim())throw new Error(`BTW safety: beoordelaar ontbreekt voor ${tx.id}.`);const income=new Set<FiscalClassification>(['domestic_output_21','domestic_output_9','other_rate_output','private_use_adjustment','zero_rated_output','exempt_output','eu_output_0','non_eu_output_0']);const expense=new Set<FiscalClassification>(['domestic_input_21','domestic_input_9','non_deductible_input_21','non_deductible_input_9','horeca_bua_9','zero_rated_input','exempt_input','domestic_reverse_charge','eu_reverse_charge','non_eu_reverse_charge','private_no_vat']);if(!(tx.type==='income'?income:expense).has(o.classificatie))throw new Error(`BTW safety: classificatie ${o.classificatie} past niet bij ${tx.type}-transactie ${tx.id}.`);if(o.classificatie==='other_rate_output'&&o.percentage!==13)throw new Error(`BTW safety: rubriek 1c vereist het expliciete 13%-forfait voor ${tx.id}.`);return o.classificatie;}
function known(tx:RawTransaction,x:FiscalClassification,reason:string,manual:boolean,p?:number,confidence:'high'|'low'='high'):FiscalTransaction { const rate=x==='other_rate_output'?(p??13):x==='domestic_output_21'||x==='domestic_input_21'||x==='non_deductible_input_21'||x==='private_use_adjustment'?21:x==='domestic_output_9'||x==='domestic_input_9'||x==='non_deductible_input_9'||x==='horeca_bua_9'?9:reverse(x)?(p===9?9:21):0;const gross=cents(Math.abs(tx.amount_incl));const vat=rate===0?0:reverse(x)?Math.round(gross*rate/100):Math.round(gross*rate/(100+rate));const base=reverse(x)?gross:gross-vat;const ded=tx.type==='expense'&&deductible(x);const amountIncl=euros(gross);const amountExcl=euros(base);const vatAmount=euros(vat);const appliedRule=rule(x);return{id:tx.id,date:tx.date,description:tx.description,type:tx.type,amount_incl_input:amountIncl,amount_excl:amountExcl,vat:{status:'known',rate,amount:vatAmount},classification:x,section:section(x),deductible:ded,evidenceRequired:false,evidenceStatus:manual?'human_confirmed':'not_required',confidence,includedInTotals:true,reason,rule:appliedRule,transactie_id:tx.id,omschrijving:tx.description??'',bedrag:amountIncl,btw:vatAmount,toegepaste_regel:appliedRule.explanation};}
function unresolved(tx:RawTransaction,reason:string):FiscalTransaction { const amount=euros(cents(Math.abs(tx.amount_incl)));const appliedRule=rule('unresolved');return{id:tx.id,date:tx.date,description:tx.description,type:tx.type,amount_incl_input:amount,amount_excl:null,vat:{status:'unknown',rate:null,amount:null},classification:'unresolved',section:'geen',deductible:false,evidenceRequired:true,evidenceStatus:'required',confidence:'low',includedInTotals:false,reason,rule:appliedRule,transactie_id:tx.id,omschrijving:tx.description??'',bedrag:amount,btw:null,toegepaste_regel:'Niet berekend: onvoldoende informatie; eerst boekhoudkundig beoordelen.'};}
function validate(rows:RawTransaction[]){const ids=new Set<string>();for(const t of rows){if(!t||typeof t.id!=='string'||!t.id.trim()||ids.has(t.id))throw new Error(`BTW safety: ongeldig of dubbel transactie-ID ${t?.id??''}.`);ids.add(t.id);if(t.type!=='income'&&t.type!=='expense')throw new Error(`BTW safety: ongeldige richting ${t.id}.`);cents(t.amount_incl);}}
export function calculateFiscalVatReport(rows:RawTransaction[],overrides:Record<string,BoekhouderBeoordeling>={},adjustments:FiscalAdjustments={}):FiscalReport { if(!Array.isArray(rows))throw new Error('BTW safety: transacties moeten een array zijn.');validate(rows);for(const id of Object.keys(overrides))if(!rows.some(r=>r.id===id))throw new Error(`BTW safety: beoordeling verwijst naar onbekende transactie ${id}.`);const transactions:FiscalTransaction[]=[];const ignored:FiscalReport['ignored']=[];for(const tx of rows){if(isSummary(tx)){ignored.push({id:tx.id,reason:'Samenvattingsregel genegeerd; alleen individuele transacties worden berekend.'});continue;}const review=overrides[tx.id];if(review){transactions.push(known(tx,overrideClassification(tx,review),`Handmatig fiscaal bevestigd door ${review.beoordeeld_door}.`,true,review.percentage,'high'));continue;}const a=classify(tx);transactions.push(a.x==='unresolved'?unresolved(tx,a.reason):known(tx,a.x,a.reason,false,a.p,a.confidence));}
const empty=()=>({grondslag:0,btw:0});const aangifte={'1a':empty(),'1b':empty(),'1c':empty(),'1d':empty(),'1e':empty(),'2a':empty(),'3a':empty(),'3b':empty(),'4a':empty(),'4b':empty(),'5a':0,'5b':0};let o21=0,o9=0,oo=0,pu=0,dr=0,er=0,nr=0,i21=0,i9=0,ri=0,nd=0;for(const t of transactions){const v=t.vat.status==='known'?t.vat.amount:0;const b=t.amount_excl??0;if(!t.includedInTotals||t.vat.status!=='known')continue;switch(t.section){case'1a':aangifte['1a'].grondslag=add(aangifte['1a'].grondslag,b);aangifte['1a'].btw=add(aangifte['1a'].btw,v);o21=add(o21,v);break;case'1b':aangifte['1b'].grondslag=add(aangifte['1b'].grondslag,b);aangifte['1b'].btw=add(aangifte['1b'].btw,v);o9=add(o9,v);break;case'1c':aangifte['1c'].grondslag=add(aangifte['1c'].grondslag,b);aangifte['1c'].btw=add(aangifte['1c'].btw,v);oo=add(oo,v);break;case'1d':aangifte['1d'].grondslag=add(aangifte['1d'].grondslag,b);aangifte['1d'].btw=add(aangifte['1d'].btw,v);pu=add(pu,v);break;case'1e':aangifte['1e'].grondslag=add(aangifte['1e'].grondslag,b);break;case'2a':aangifte['2a'].grondslag=add(aangifte['2a'].grondslag,b);aangifte['2a'].btw=add(aangifte['2a'].btw,v);dr=add(dr,v);if(t.deductible)ri=add(ri,v);break;case'3a':aangifte['3a'].grondslag=add(aangifte['3a'].grondslag,b);break;case'3b':aangifte['3b'].grondslag=add(aangifte['3b'].grondslag,b);break;case'4a':aangifte['4a'].grondslag=add(aangifte['4a'].grondslag,b);aangifte['4a'].btw=add(aangifte['4a'].btw,v);nr=add(nr,v);if(t.deductible)ri=add(ri,v);break;case'4b':aangifte['4b'].grondslag=add(aangifte['4b'].grondslag,b);aangifte['4b'].btw=add(aangifte['4b'].btw,v);er=add(er,v);if(t.deductible)ri=add(ri,v);break;case'5b':if(t.deductible&&t.classification==='domestic_input_21')i21=add(i21,v);if(t.deductible&&t.classification==='domestic_input_9')i9=add(i9,v);break;}if(t.type==='expense'&&!t.deductible)nd=add(nd,v);}
const m1c=Number(adjustments.rubriek1c?.btw??0),m1d=Number(adjustments.rubriek1d?.btw??0);if(adjustments.rubriek1c)aangifte['1c']={grondslag:Number(adjustments.rubriek1c.grondslag??0),btw:m1c};if(adjustments.rubriek1d)aangifte['1d']={grondslag:Number(adjustments.rubriek1d.grondslag??0),btw:m1d};const out=add(add(add(add(add(o21,o9),oo),dr),add(er,nr)),add(m1c,m1d));const inp=add(add(i21,i9),ri);const net=add(out,-inp);aangifte['5a']=out;aangifte['5b']=inp;const independentOut=transactions.filter(t=>t.includedInTotals&&t.vat.status==='known'&&(t.type==='income'||reverse(t.classification))).reduce((s,t)=>add(s,t.vat.status==='known'?t.vat.amount:0),add(m1c,m1d));const independentIn=transactions.filter(t=>t.includedInTotals&&t.type==='expense'&&t.deductible&&t.vat.status==='known').reduce((s,t)=>add(s,t.vat.status==='known'?t.vat.amount:0),0);const unresolvedCount=transactions.filter(t=>t.vat.status==='unknown').length;const problems:string[]=[];if(independentOut!==out)problems.push('Onafhankelijke verschuldigde-btw controle faalt.');if(independentIn!==inp)problems.push('Onafhankelijke voorbelastingcontrole faalt.');if(add(independentOut,-independentIn)!==net)problems.push('Onafhankelijke nettocontrole faalt.');if(unresolvedCount>0)problems.push(`${unresolvedCount} transactie(s) vereisen boekhoudkundige beoordeling voordat het rapport fiscaal compleet is.`);return{transactions,overzicht:{output:{domestic21:o21,domestic9:o9,domesticOther:oo,domesticReverse:dr,euReverse:er,nonEuReverse:nr,privateUse:pu,total:out},input:{domestic21:i21,domestic9:i9,reverseCharge:ri,total:inp},nonDeductible:nd,netto:net,status:net>=0?'af_te_drager':'terug_te_vorderen'},aangifte,audit:{ok:problems.length===0,problems,input:rows.length,known:transactions.filter(t=>t.vat.status==='known').length,unresolved:unresolvedCount,evidenceRequired:transactions.filter(t=>t.evidenceRequired).length,ignored:ignored.length,included:transactions.filter(t=>t.includedInTotals).length},ignored};}
export function berekenBetrouwbaarheidsscore(r:FiscalReport){if(r.audit.input===0)return 100;return Math.max(0,Math.min(100,Number((100-r.audit.unresolved/r.audit.input*20-(r.audit.ok?0:50)).toFixed(2))));}
export function tweeKolommenWeergave(r:FiscalReport){return{zeker:r.transactions.filter(t=>t.includedInTotals&&t.confidence==='high'),twijfelgevallen:r.transactions.filter(t=>t.evidenceRequired||(!t.includedInTotals&&t.confidence==='low'))};}
