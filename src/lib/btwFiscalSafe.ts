import type { RawTransaction } from './btwEngineSafe';

export type BtwPercentage = 0 | 9 | 21;
export type BoekhouderBeoordeling = { percentage: BtwPercentage; beoordeeld_door: string };
export const BOEKHOUDER_PERCENTAGE_OPTIES: Array<{ percentage: BtwPercentage; label: string }> = [
  { percentage: 0, label: '0%' },
  { percentage: 9, label: '9%' },
  { percentage: 21, label: '21%' },
];

export type FiscalClassification =
  | 'domestic_output_21' | 'domestic_output_9' | 'zero_rated_output' | 'exempt_output'
  | 'domestic_input_21' | 'domestic_input_9' | 'zero_rated_input' | 'exempt_input'
  | 'domestic_reverse_charge' | 'eu_reverse_charge' | 'non_eu_reverse_charge'
  | 'private_no_vat' | 'non_deductible_input' | 'unresolved';

export type FiscalSection = '1a' | '1b' | '1e' | '2a' | '3a' | '3b' | '4a' | '4b' | '5b' | 'geen';

export interface FiscalRule {
  classification: FiscalClassification;
  section: FiscalSection;
  wetsbasis: string;
  explanation: string;
  requiresEvidence: boolean;
}

export interface FiscalTransaction {
  id: string;
  date?: string;
  description?: string;
  type: 'income' | 'expense';
  amount_incl_input: number;
  amount_excl: number | null;
  vat: { status: 'known'; rate: BtwPercentage; amount: number } | { status: 'unknown'; rate: null; amount: null };
  classification: FiscalClassification;
  section: FiscalSection;
  deductible: boolean;
  evidenceRequired: boolean;
  evidenceStatus: 'not_required' | 'required' | 'human_confirmed';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  rule: FiscalRule;
}

export interface FiscalOverview {
  output: { domestic21: number; domestic9: number; domesticReverse: number; euReverse: number; nonEuReverse: number; total: number };
  input: { domestic21: number; domestic9: number; reverseCharge: number; total: number };
  nonDeductible: number;
  netto: number;
  status: 'af_te_dragen' | 'terug_te_vorderen';
}

export interface FiscalReport {
  transactions: FiscalTransaction[];
  overzicht: FiscalOverview;
  aangifte: {
    '1a': { grondslag: number; btw: number };
    '1b': { grondslag: number; btw: number };
    '1e': { grondslag: number; btw: number };
    '2a': { grondslag: number; btw: number };
    '3a': { grondslag: number; btw: number };
    '3b': { grondslag: number; btw: number };
    '4a': { grondslag: number; btw: number };
    '4b': { grondslag: number; btw: number };
    '5b': number;
  };
  audit: { ok: boolean; problems: string[]; input: number; known: number; unresolved: number; evidenceRequired: number; ignored: number };
  ignored: Array<{ id: string; reason: string }>;
}

const EU = new Set(['AT','BE','BG','HR','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);
const cents = (n: number) => Math.round(n * 100);
const euros = (n: number) => cents(n) / 100;
const grossVat = (gross: number, rate: BtwPercentage) => rate === 0 ? 0 : Math.round(cents(gross) * rate / (100 + rate));
const baseVat = (base: number, rate: BtwPercentage) => Math.round(cents(base) * rate / 100);
const norm = (s?: string) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const isSummary = (tx: RawTransaction) => /(^|\s)(totaal|subtotaal|eindtotaal|saldo|samenvatting|grand total)(\s|$)|totale btw|btw totaal|kwartaaltotaal|maandtotaal/.test(norm(`${tx.description} ${tx.memo}`));

function countryFromIban(iban?: string) { const c = String(iban ?? '').replace(/\s/g, '').slice(0,2).toUpperCase(); return c || null; }
function foreignKind(tx: RawTransaction) {
  const c = countryFromIban(tx.tegenrekening_iban);
  if (!c || c === 'NL') return null;
  return EU.has(c) ? 'eu' as const : 'non_eu' as const;
}

function rule(classification: FiscalClassification): FiscalRule {
  const rules: Record<FiscalClassification, FiscalRule> = {
    domestic_output_21: { classification, section:'1a', wetsbasis:'Wet OB 1968; tarief 21%', explanation:'Binnenlandse belaste omzet tegen het algemene tarief.', requiresEvidence:true },
    domestic_output_9: { classification, section:'1b', wetsbasis:'Wet OB 1968; tarief 9%', explanation:'Binnenlandse belaste omzet tegen het verlaagde tarief.', requiresEvidence:true },
    zero_rated_output: { classification, section:'3a', wetsbasis:'Wet OB 1968; 0%-tarief', explanation:'0%-belaste prestatie. Dit is niet hetzelfde als vrijgesteld.', requiresEvidence:true },
    exempt_output: { classification, section:'geen', wetsbasis:'Wet OB 1968; vrijstelling', explanation:'Vrijgestelde prestatie; geen Nederlandse btw in rekening.', requiresEvidence:true },
    domestic_input_21: { classification, section:'5b', wetsbasis:'Wet OB 1968; aftrek voorbelasting', explanation:'Nederlandse btw op zakelijke inkoop, alleen aftrekbaar bij geldige factuur en overige voorwaarden.', requiresEvidence:true },
    domestic_input_9: { classification, section:'5b', wetsbasis:'Wet OB 1968; aftrek voorbelasting', explanation:'Nederlandse btw op zakelijke inkoop, alleen aftrekbaar bij geldige factuur en overige voorwaarden.', requiresEvidence:true },
    zero_rated_input: { classification, section:'5b', wetsbasis:'Wet OB 1968; 0%-tarief', explanation:'0%-inkoop bevat geen Nederlandse btw; er is dus geen btw-bedrag om af te trekken.', requiresEvidence:false },
    exempt_input: { classification, section:'geen', wetsbasis:'Wet OB 1968; vrijstelling', explanation:'Vrijgestelde inkoop bevat geen Nederlandse btw en leidt niet tot voorbelasting.', requiresEvidence:false },
    domestic_reverse_charge: { classification, section:'2a', wetsbasis:'Wet OB 1968; binnenlandse verleggingsregeling', explanation:'Binnenlandse verleggingsregeling. De afnemer geeft de verlegde btw aan in 2a en trekt die alleen onder voorwaarden af in 5b.', requiresEvidence:true },
    eu_reverse_charge: { classification, section:'4b', wetsbasis:'Btw-aangifte rubriek 4b', explanation:'EU-goederen/diensten waarvoor Nederlandse btw door verlegging moet worden aangegeven; niet automatisch 2a.', requiresEvidence:true },
    non_eu_reverse_charge: { classification, section:'4a', wetsbasis:'Btw-aangifte rubriek 4a', explanation:'Diensten/leveringen uit landen buiten de EU waarbij Nederlandse btw naar de afnemer is verlegd.', requiresEvidence:true },
    private_no_vat: { classification, section:'geen', wetsbasis:'Aftrekbeperking privégebruik', explanation:'Privé-uitgave is geen aftrekbare voorbelasting.', requiresEvidence:true },
    non_deductible_input: { classification, section:'geen', wetsbasis:'Aftrekbeperking', explanation:'Btw is niet als voorbelasting verwerkt; reden moet controleerbaar zijn.', requiresEvidence:true },
    unresolved: { classification, section:'geen', wetsbasis:'Onvoldoende fiscale feiten', explanation:'Niet genoeg informatie om veilig een fiscale behandeling vast te leggen.', requiresEvidence:true },
  };
  return rules[classification];
}

function classify(tx: RawTransaction, override?: BoekhouderBeoordeling): { classification: FiscalClassification; rate: BtwPercentage; reason: string; confidence:'high'|'medium'|'low'; deductible:boolean; evidence:'required'|'not_required'|'human_confirmed' } {
  const d = norm(`${tx.description} ${tx.memo}`);
  if (override) {
    const rate = override.percentage;
    if (rate === 0) return { classification: tx.type === 'income' ? 'zero_rated_output' : 'zero_rated_input', rate, reason:`Handmatig bevestigd door ${override.beoordeeld_door}.`, confidence:'high', deductible:false, evidence:'human_confirmed' };
    return { classification: tx.type === 'income' ? (rate === 21 ? 'domestic_output_21' : 'domestic_output_9') : (rate === 21 ? 'domestic_input_21' : 'domestic_input_9'), rate, reason:`Handmatig bevestigd door ${override.beoordeeld_door}.`, confidence:'high', deductible:tx.type === 'expense', evidence:'human_confirmed' };
  }
  if (/priv[eé].*(opname|betaling)|eigen opname|privé/.test(d)) return { classification:'private_no_vat', rate:0, reason:'Privékarakter herkend; geen voorbelasting.', confidence:'high', deductible:false, evidence:'required' };
  if (/vrijgesteld|exempt/.test(d)) return { classification: tx.type === 'income' ? 'exempt_output' : 'exempt_input', rate:0, reason:'Vrijstelling expliciet genoemd; 0%-tarief wordt niet als vrijstelling geïnterpreteerd.', confidence:'medium', deductible:false, evidence:'required' };
  if (/0\s*%|0%-tarief|zero[- ]rated/.test(d)) return { classification: tx.type === 'income' ? 'zero_rated_output' : 'zero_rated_input', rate:0, reason:'0%-tarief expliciet genoemd.', confidence:'medium', deductible:false, evidence:'required' };
  if (/restaurant|horeca|lunch|diner|café|cafe/.test(d) && tx.type === 'expense') return { classification:'non_deductible_input', rate:9, reason:'Horeca-uitgave gemarkeerd als niet automatisch aftrekbaar; BUA/zakelijk gebruik vereist beoordeling.', confidence:'medium', deductible:false, evidence:'required' };
  const foreign = foreignKind(tx);
  if (foreign && /btw\s*verlegd|verlegde btw|reverse charge|vat reverse|tax reverse/.test(d) && tx.type === 'expense') return { classification: foreign === 'eu' ? 'eu_reverse_charge' : 'non_eu_reverse_charge', rate:21, reason:`Buitenlandse verlegging herkend (${foreign === 'eu' ? 'EU' : 'buiten EU'}); grondslag is exclusief btw.`, confidence:'medium', deductible:false, evidence:'required' };
  if (/btw\s*verlegd|verlegde btw|reverse charge/.test(d) && tx.type === 'expense') return { classification:'domestic_reverse_charge', rate:21, reason:'Binnenlandse verlegging herkend; buitenlandse herkomst is niet vastgesteld.', confidence:'low', deductible:false, evidence:'required' };
  if (tx.type === 'income' && /verkoop|factuur|omzet|dienst|abonnement|consult|advies/.test(d)) {
    if (/boek|eten|voeding|kapper|fiets|hotel/.test(d)) return { classification:'domestic_output_9', rate:9, reason:'Waarschijnlijke 9%-omzet; onderliggende prestatie/factuur moet dit bevestigen.', confidence:'medium', deductible:false, evidence:'required' };
    if (/21\s*%|algemeen/.test(d)) return { classification:'domestic_output_21', rate:21, reason:'21%-tarief expliciet genoemd.', confidence:'high', deductible:false, evidence:'required' };
  }
  if (tx.type === 'expense') {
    if (/9\s*%|boek|eten|voeding|kapper|fiets/.test(d)) return { classification:'domestic_input_9', rate:9, reason:'Waarschijnlijke 9%-inkoop; geldige btw-factuur en aftrekvoorwaarden moeten worden bevestigd.', confidence:'medium', deductible:true, evidence:'required' };
    if (/21\s*%|software|kantoor|hosting|abonnement|computer|laptop/.test(d)) return { classification:'domestic_input_21', rate:21, reason:'Waarschijnlijke 21%-inkoop; geldige btw-factuur en aftrekvoorwaarden moeten worden bevestigd.', confidence:'medium', deductible:true, evidence:'required' };
  }
  return { classification:'unresolved', rate:0, reason:'Onvoldoende informatie voor een veilige fiscale classificatie.', confidence:'low', deductible:false, evidence:'required' };
}

export function calculateFiscalVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}): FiscalReport {
  const ignored: FiscalReport['ignored'] = [];
  const transactions: FiscalTransaction[] = [];
  for (const tx of rows) {
    if (isSummary(tx)) { ignored.push({ id:tx.id, reason:'Samenvattingsregel; niet als transactie verwerkt.' }); continue; }
    const c = classify(tx, overrides[tx.id]);
    const r = rule(c.classification);
    const reverse = c.classification === 'domestic_reverse_charge' || c.classification === 'eu_reverse_charge' || c.classification === 'non_eu_reverse_charge';
    const vat = c.classification === 'unresolved' ? null : (reverse ? baseVat(tx.amount_incl, c.rate) : grossVat(tx.amount_incl, c.rate));
    const excl = vat === null ? null : (reverse ? euros(cents(tx.amount_incl)) : euros(cents(tx.amount_incl) - vat));
    transactions.push({ id:tx.id, date:tx.date, description:tx.description, type:tx.type, amount_incl_input:tx.amount_incl, amount_excl:excl, vat:vat === null ? {status:'unknown',rate:null,amount:null} : {status:'known',rate:c.rate,amount:euros(vat)}, classification:c.classification, section:r.section, deductible:c.deductible, evidenceRequired:r.requiresEvidence || c.evidence === 'required', evidenceStatus:c.evidence, confidence:c.confidence, reason:c.reason, rule:r });
  }
  let d21=0,d9=0,domRev=0,euRev=0,nonEuRev=0,in21=0,in9=0,revIn=0,nonDed=0;
  const aang = { '1a':{grondslag:0,btw:0},'1b':{grondslag:0,btw:0},'1e':{grondslag:0,btw:0},'2a':{grondslag:0,btw:0},'3a':{grondslag:0,btw:0},'3b':{grondslag:0,btw:0},'4a':{grondslag:0,btw:0},'4b':{grondslag:0,btw:0},'5b':0 };
  for (const t of transactions) {
    if (t.vat.status !== 'known') continue;
    const v=t.vat.amount, b=t.amount_excl ?? 0;
    if (t.classification==='domestic_output_21') { d21+=v; aang['1a'].grondslag+=b; aang['1a'].btw+=v; }
    else if (t.classification==='domestic_output_9') { d9+=v; aang['1b'].grondslag+=b; aang['1b'].btw+=v; }
    else if (t.classification==='domestic_reverse_charge') { domRev+=v; aang['2a'].grondslag+=b; aang['2a'].btw+=v; if(t.deductible){revIn+=v;aang['5b']+=v;} }
    else if (t.classification==='eu_reverse_charge') { euRev+=v; aang['4b'].grondslag+=b; aang['4b'].btw+=v; if(t.deductible){revIn+=v;aang['5b']+=v;} }
    else if (t.classification==='non_eu_reverse_charge') { nonEuRev+=v; aang['4a'].grondslag+=b; aang['4a'].btw+=v; if(t.deductible){revIn+=v;aang['5b']+=v;} }
    else if (t.classification==='domestic_input_21' && t.deductible) { in21+=v; aang['5b']+=v; }
    else if (t.classification==='domestic_input_9' && t.deductible) { in9+=v; aang['5b']+=v; }
    else if (t.type==='expense' && v>0) nonDed+=v;
  }
  const output=euros(cents(d21+d9+domRev+euRev+nonEuRev));
  const input=euros(cents(in21+in9+revIn));
  const netto=euros(cents(output-input));
  const evidenceRequired=transactions.filter(t=>t.evidenceRequired).length;
  const unresolved=transactions.filter(t=>t.classification==='unresolved').length;
  const problems:string[]=[];
  if (transactions.length+ignored.length!==rows.length) problems.push('Transactie-aantallen sluiten niet aan.');
  if (aang['5b'] !== input) problems.push('Rubriek 5b sluit niet aan op aftrekbare voorbelasting.');
  return { transactions, overzicht:{output:{domestic21:euros(cents(d21)),domestic9:euros(cents(d9)),domesticReverse:euros(cents(domRev)),euReverse:euros(cents(euRev)),nonEuReverse:euros(cents(nonEuRev)),total:output},input:{domestic21:euros(cents(in21)),domestic9:euros(cents(in9)),reverseCharge:euros(cents(revIn)),total:input},nonDeductible:euros(cents(nonDed)),netto:netto,status:netto>=0?'af_te_dragen':'terug_te_vorderen'},aangifte:{'1a':{grondslag:euros(cents(aang['1a'].grondslag)),btw:euros(cents(aang['1a'].btw))},'1b':{grondslag:euros(cents(aang['1b'].grondslag)),btw:euros(cents(aang['1b'].btw))},'1e':{grondslag:0,btw:0},'2a':{grondslag:euros(cents(aang['2a'].grondslag)),btw:euros(cents(aang['2a'].btw))},'3a':{grondslag:0,btw:0},'3b':{grondslag:0,btw:0},'4a':{grondslag:euros(cents(aang['4a'].grondslag)),btw:euros(cents(aang['4a'].btw))},'4b':{grondslag:euros(cents(aang['4b'].grondslag)),btw:euros(cents(aang['4b'].btw))},'5b':input},audit:{ok:problems.length===0,problems,input:rows.length,known:transactions.filter(t=>t.vat.status==='known').length,unresolved,evidenceRequired,ignored:ignored.length},ignored};
}

export function tweeKolommenWeergave(report: FiscalReport) {
  const zeker = report.transactions.filter(t=>t.vat.status==='known').map(t=>({transactie_id:t.id,omschrijving:t.description??'(geen omschrijving)',bedrag:new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(t.amount_incl_input),type:t.type==='income'?'Inkomsten':'Uitgaven',btw:`${t.vat.rate}%`,toegepaste_regel:`Rubriek ${t.section}: ${t.reason}`}));
  const twijfelgevallen = report.transactions.filter(t=>t.vat.status==='unknown').map(t=>({transactie_id:t.id,omschrijving:t.description??'(geen omschrijving)',bedrag:new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(t.amount_incl_input),type:t.type==='income'?'Inkomsten':'Uitgaven',btw:'Onbekend',toegepaste_regel:t.reason}));
  return { zeker, twijfelgevallen };
}
export function berekenBetrouwbaarheidsscore(report: FiscalReport) { let score=100; if(!report.audit.ok) score-=30; if(report.audit.unresolved) score-=Math.min(40,report.audit.unresolved/report.audit.input*40); if(report.audit.evidenceRequired) score-=Math.min(20,report.audit.evidenceRequired/report.audit.input*20); return Math.max(0,Number(score.toFixed(2))); }
