import type { RawTransaction } from './btwEngineSafe';

export type BtwPercentage = 0 | 9 | 21;
export type FiscalSection = '1a' | '1b' | '1e' | '2a' | '3a' | '3b' | '4a' | '4b' | '5b' | 'geen';
export type FiscalClassification =
  | 'domestic_output_21' | 'domestic_output_9' | 'zero_rated_output' | 'exempt_output'
  | 'eu_output_0' | 'non_eu_output_0'
  | 'domestic_input_21' | 'domestic_input_9' | 'zero_rated_input' | 'exempt_input'
  | 'domestic_reverse_charge' | 'eu_reverse_charge' | 'non_eu_reverse_charge'
  | 'private_no_vat' | 'non_deductible_input' | 'unresolved';

export type BoekhouderBeoordeling = {
  percentage?: BtwPercentage;
  classificatie?: Exclude<FiscalClassification, 'unresolved'>;
  beoordeeld_door: string;
};

export const BOEKHOUDER_PERCENTAGE_OPTIES = [
  { percentage: 0 as const, label: '0%' },
  { percentage: 9 as const, label: '9%' },
  { percentage: 21 as const, label: '21%' },
];

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
  includedInTotals: boolean;
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
    '1a': { grondslag: number; btw: number }; '1b': { grondslag: number; btw: number }; '1e': { grondslag: number; btw: number };
    '2a': { grondslag: number; btw: number }; '3a': { grondslag: number; btw: number }; '3b': { grondslag: number; btw: number };
    '4a': { grondslag: number; btw: number }; '4b': { grondslag: number; btw: number }; '5b': number;
  };
  audit: { ok: boolean; problems: string[]; input: number; known: number; unresolved: number; evidenceRequired: number; ignored: number; included: number };
  ignored: Array<{ id: string; reason: string }>;
}

const EU = new Set(['AT','BE','BG','HR','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);
const norm = (s?: string) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const country = (iban?: string) => String(iban ?? '').replace(/\s/g, '').slice(0, 2).toUpperCase() || null;
const cents = (n: number) => { if (!Number.isFinite(n)) throw new Error('BTW safety: ongeldig bedrag.'); const c = Math.round(n * 100); if (!Number.isSafeInteger(c)) throw new Error('BTW safety: bedrag te groot.'); return c; };
const euros = (c: number) => { if (!Number.isSafeInteger(c)) throw new Error('BTW safety: ongeldige centwaarde.'); return c / 100; };
const grossVat = (grossCents: number, rate: BtwPercentage) => rate === 0 ? 0 : Math.round(grossCents * rate / (100 + rate));
const baseVat = (baseCents: number, rate: 9 | 21) => Math.round(baseCents * rate / 100);
const isSummary = (tx: RawTransaction) => /(\b(totaal|subtotaal|eindtotaal|saldo|samenvatting|grand total|totaalbedrag|eindsaldo|jaaroverzicht|kwartaaltotaal|maandtotaal|btw totaal|totale btw|voorbelasting totaal)\b)/.test(norm(`${tx.description} ${tx.memo}`));
const reverse = (c: FiscalClassification) => c === 'domestic_reverse_charge' || c === 'eu_reverse_charge' || c === 'non_eu_reverse_charge';
const incomeClass = (c: FiscalClassification) => c.startsWith('domestic_output') || c.endsWith('_output') || c === 'eu_output_0' || c === 'non_eu_output_0';
const expenseClass = (c: FiscalClassification) => !incomeClass(c) && c !== 'unresolved';

function rule(classification: FiscalClassification): FiscalRule {
  const rules: Record<FiscalClassification, FiscalRule> = {
    domestic_output_21: { classification, section: '1a', wetsbasis: 'Btw-aangifte rubriek 1a', explanation: 'Binnenlandse omzet tegen het algemene tarief van 21%.', requiresEvidence: true },
    domestic_output_9: { classification, section: '1b', wetsbasis: 'Btw-aangifte rubriek 1b', explanation: 'Binnenlandse omzet tegen het lage tarief van 9%.', requiresEvidence: true },
    zero_rated_output: { classification, section: '1e', wetsbasis: 'Btw-aangifte rubriek 1e', explanation: 'Prestatie waarop het 0%-tarief in Nederland van toepassing is.', requiresEvidence: true },
    exempt_output: { classification, section: 'geen', wetsbasis: 'Btw-vrijstelling', explanation: 'Vrijgestelde omzet; geen Nederlandse btw en geen rubriek 1.', requiresEvidence: true },
    eu_output_0: { classification, section: '3b', wetsbasis: 'Btw-aangifte rubriek 3b', explanation: 'Intracommunautaire levering/dienst; voorwaarden en ICP-gegevens moeten aantoonbaar zijn.', requiresEvidence: true },
    non_eu_output_0: { classification, section: '3a', wetsbasis: 'Btw-aangifte rubriek 3a', explanation: 'Uitvoer naar buiten de EU; uitvoerbewijs is vereist.', requiresEvidence: true },
    domestic_input_21: { classification, section: '5b', wetsbasis: 'Btw-aangifte rubriek 5b / art. 15 Wet OB', explanation: 'Nederlandse voorbelasting tegen 21%; zakelijke belaste bestemming en geldige factuur vereist.', requiresEvidence: true },
    domestic_input_9: { classification, section: '5b', wetsbasis: 'Btw-aangifte rubriek 5b / art. 15 Wet OB', explanation: 'Nederlandse voorbelasting tegen 9%; zakelijke belaste bestemming en geldige factuur vereist.', requiresEvidence: true },
    zero_rated_input: { classification, section: 'geen', wetsbasis: '0%-inkoop', explanation: '0% betekent geen Nederlandse btw op deze inkoop om als voorbelasting af te trekken.', requiresEvidence: true },
    exempt_input: { classification, section: 'geen', wetsbasis: 'Vrijgestelde inkoop', explanation: 'Geen Nederlandse btw om als voorbelasting af te trekken.', requiresEvidence: true },
    domestic_reverse_charge: { classification, section: '2a', wetsbasis: 'Btw-aangifte rubriek 2a', explanation: 'Binnenlandse verlegging: verschuldigde btw in 2a; aftrek alleen voor zover aan art. 15 Wet OB is voldaan.', requiresEvidence: true },
    eu_reverse_charge: { classification, section: '4b', wetsbasis: 'Btw-aangifte rubriek 4b', explanation: 'Goederen/diensten uit EU-land waarbij Nederlandse btw naar de afnemer is verlegd.', requiresEvidence: true },
    non_eu_reverse_charge: { classification, section: '4a', wetsbasis: 'Btw-aangifte rubriek 4a', explanation: 'Diensten/leveringen uit buiten-EU waarbij Nederlandse btw naar de afnemer is verlegd.', requiresEvidence: true },
    private_no_vat: { classification, section: 'geen', wetsbasis: 'Privé-uitgave', explanation: 'Privé-uitgave: geen aftrekbare voorbelasting.', requiresEvidence: true },
    non_deductible_input: { classification, section: 'geen', wetsbasis: 'Aftrekbeperking', explanation: 'Btw niet als aftrekbare voorbelasting verwerkt.', requiresEvidence: true },
    unresolved: { classification, section: 'geen', wetsbasis: 'Onvoldoende fiscale feiten', explanation: 'De bankregel bevat onvoldoende feiten voor een veilige fiscale conclusie.', requiresEvidence: true },
  };
  return rules[classification];
}

type Decision = { classification: FiscalClassification; rate: BtwPercentage; reason: string; confidence: 'high' | 'medium' | 'low'; deductible: boolean; evidence: 'required' | 'not_required' | 'human_confirmed' };

function decisionForOverride(tx: RawTransaction, o: BoekhouderBeoordeling): Decision {
  if (!o.beoordeeld_door.trim()) throw new Error(`BTW safety: beoordelaar ontbreekt voor ${tx.id}.`);
  let classification = o.classificatie;
  if (!classification) {
    if (o.percentage === undefined) throw new Error(`BTW safety: override voor ${tx.id} mist percentage of classificatie.`);
    if (o.percentage === 0) {
      const d = norm(`${tx.description} ${tx.memo}`); const c = country(tx.tegenrekening_iban);
      if (tx.type === 'income' && c && c !== 'NL' && /export|uitvoer|intracommunautair|eu-land|eu levering/.test(d)) classification = EU.has(c) ? 'eu_output_0' : 'non_eu_output_0';
      else classification = tx.type === 'income' ? 'zero_rated_output' : 'zero_rated_input';
    } else classification = tx.type === 'income' ? (o.percentage === 21 ? 'domestic_output_21' : 'domestic_output_9') : (o.percentage === 21 ? 'domestic_input_21' : 'domestic_input_9');
  }
  if (classification === 'unresolved') throw new Error(`BTW safety: unresolved mag niet handmatig bevestigd worden (${tx.id}).`);
  if ((tx.type === 'income' && !incomeClass(classification)) || (tx.type === 'expense' && !expenseClass(classification))) throw new Error(`BTW safety: classificatie past niet bij transactie ${tx.id}.`);
  const rate: BtwPercentage = classification.includes('_21') || classification === 'domestic_reverse_charge' || classification.endsWith('reverse_charge') ? 21 : classification.includes('_9') ? 9 : 0;
  return { classification, rate, reason: `Handmatig fiscaal bevestigd door ${o.beoordeeld_door}.`, confidence: 'high', deductible: tx.type === 'expense' && !['non_deductible_input','private_no_vat','exempt_input','zero_rated_input'].includes(classification), evidence: 'human_confirmed' };
}

function autoDecision(tx: RawTransaction): Decision {
  const d = norm(`${tx.description} ${tx.memo}`); const c = country(tx.tegenrekening_iban);
  if (/priv[eé].*(opname|betaling)|eigen opname|privé/.test(d)) return { classification: 'private_no_vat', rate: 0, reason: 'Privékarakter vermoed; menselijke controle vereist.', confidence: 'high', deductible: false, evidence: 'required' };
  if (/vrijgesteld|exempt|vrijstelling/.test(d)) return { classification: tx.type === 'income' ? 'exempt_output' : 'exempt_input', rate: 0, reason: 'Vrijstelling expliciet genoemd; bewijs vereist.', confidence: 'high', deductible: false, evidence: 'required' };
  if (tx.type === 'expense' && /restaurant|horeca|lunch|diner|café|cafe/.test(d)) return { classification: 'non_deductible_input', rate: /21\s*%/.test(d) ? 21 : /9\s*%/.test(d) ? 9 : 0, reason: 'Horeca ter plaatse is in beginsel niet aftrekbaar; concrete situatie moet worden gecontroleerd.', confidence: 'medium', deductible: false, evidence: 'required' };
  const rev = tx.type === 'expense' && /btw\s*verlegd|verlegde btw|reverse charge|vat reverse/.test(d);
  if (rev && c && c !== 'NL') return { classification: EU.has(c) ? 'eu_reverse_charge' : 'non_eu_reverse_charge', rate: 21, reason: `Buitenlandse verlegging vermoed op basis van omschrijving en land ${c}; bewijs vereist.`, confidence: 'medium', deductible: true, evidence: 'required' };
  if (rev) return { classification: 'domestic_reverse_charge', rate: 21, reason: 'Binnenlandse verlegging vermoed; bewijs vereist.', confidence: 'medium', deductible: true, evidence: 'required' };
  if (tx.type === 'income' && /export|uitvoer|buiten de eu|niet[- ]eu/.test(d)) return { classification: 'non_eu_output_0', rate: 0, reason: 'Uitvoer buiten EU vermoed; uitvoerbewijs vereist.', confidence: 'medium', deductible: false, evidence: 'required' };
  if (tx.type === 'income' && /intracommunautair|eu[- ]levering|levering eu|naar duitsland|naar belgië|naar belgie|naar frankrijk|naar spanje|naar itali[eë]|naar europa/.test(d)) return { classification: 'eu_output_0', rate: 0, reason: 'Intracommunautaire prestatie vermoed; btw-id, plaats van dienst/levering en ICP moeten worden gecontroleerd.', confidence: 'medium', deductible: false, evidence: 'required' };
  if (tx.type === 'income' && /21\s*%/.test(d)) return { classification: 'domestic_output_21', rate: 21, reason: '21% expliciet genoemd; factuur/prestatie moet worden gecontroleerd.', confidence: 'high', deductible: false, evidence: 'required' };
  if (tx.type === 'income' && /9\s*%/.test(d)) return { classification: 'domestic_output_9', rate: 9, reason: '9% expliciet genoemd; factuur/prestatie moet worden gecontroleerd.', confidence: 'high', deductible: false, evidence: 'required' };
  if (tx.type === 'expense' && /21\s*%/.test(d)) return { classification: 'domestic_input_21', rate: 21, reason: '21% expliciet genoemd; factuur en zakelijke/belaste bestemming moeten worden gecontroleerd.', confidence: 'high', deductible: true, evidence: 'required' };
  if (tx.type === 'expense' && /9\s*%/.test(d)) return { classification: 'domestic_input_9', rate: 9, reason: '9% expliciet genoemd; factuur en zakelijke/belaste bestemming moeten worden gecontroleerd.', confidence: 'high', deductible: true, evidence: 'required' };
  return { classification: 'unresolved', rate: 0, reason: 'Onvoldoende fiscale feiten; niet meegenomen in financiële BTW-totalen.', confidence: 'low', deductible: false, evidence: 'required' };
}

function makeTransaction(tx: RawTransaction, decision: Decision): FiscalTransaction {
  const ruleData = rule(decision.classification);
  const gross = cents(Math.abs(tx.amount_incl));
  const vatCents = decision.classification === 'unresolved' ? null : reverse(decision.classification) ? baseVat(gross, decision.rate as 9 | 21) : grossVat(gross, decision.rate);
  const netCents = vatCents === null ? null : reverse(decision.classification) ? gross : gross - vatCents;
  const confirmed = decision.evidence === 'human_confirmed';
  return {
    id: tx.id, date: tx.date, description: tx.description, type: tx.type, amount_incl_input: Math.abs(tx.amount_incl),
    amount_excl: netCents === null ? null : euros(netCents),
    vat: vatCents === null ? { status: 'unknown', rate: null, amount: null } : { status: 'known', rate: decision.rate, amount: euros(vatCents) },
    classification: decision.classification, section: ruleData.section, deductible: decision.deductible,
    evidenceRequired: ruleData.requiresEvidence, evidenceStatus: decision.evidence, confidence: decision.confidence,
    includedInTotals: confirmed && decision.classification !== 'unresolved', reason: decision.reason, rule: ruleData,
  };
}

function add(a: number, b: number) { return euros(cents(a) + cents(b)); }
function emptyBox() { return { grondslag: 0, btw: 0 }; }

export function calculateFiscalVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}): FiscalReport {
  if (!Array.isArray(rows)) throw new Error('BTW safety: transacties moeten een array zijn.');
  const ids = new Set<string>();
  for (const tx of rows) {
    if (!tx || typeof tx.id !== 'string' || !tx.id.trim() || ids.has(tx.id)) throw new Error(`BTW safety: ongeldig of dubbel transactie-ID ${tx?.id ?? '(leeg)'}.`);
    ids.add(tx.id);
    if (tx.type !== 'income' && tx.type !== 'expense') throw new Error(`BTW safety: ongeldige richting ${tx.id}.`);
    if (!Number.isFinite(tx.amount_incl)) throw new Error(`BTW safety: ongeldig bedrag ${tx.id}.`);
    cents(tx.amount_incl);
  }
  for (const id of Object.keys(overrides)) if (!ids.has(id)) throw new Error(`BTW safety: override voor onbekende transactie ${id}.`);

  const transactions: FiscalTransaction[] = [];
  const ignored: FiscalReport['ignored'] = [];
  for (const tx of rows) {
    if (isSummary(tx)) { ignored.push({ id: tx.id, reason: 'Samenvattingsregel genegeerd; geen individuele boeking.' }); continue; }
    transactions.push(makeTransaction(tx, overrides[tx.id] ? decisionForOverride(tx, overrides[tx.id]) : autoDecision(tx)));
  }

  const a = { '1a': emptyBox(), '1b': emptyBox(), '1e': emptyBox(), '2a': emptyBox(), '3a': emptyBox(), '3b': emptyBox(), '4a': emptyBox(), '4b': emptyBox(), '5b': 0 };
  let output21 = 0, output9 = 0, domesticReverse = 0, euReverse = 0, nonEuReverse = 0, input21 = 0, input9 = 0, reverseInput = 0, nonDeductible = 0;

  for (const tx of transactions) {
    if (!tx.includedInTotals || tx.vat.status !== 'known') continue;
    const vat = tx.vat.amount; const base = tx.amount_excl ?? 0;
    switch (tx.section) {
      case '1a': a['1a'].grondslag = add(a['1a'].grondslag, base); a['1a'].btw = add(a['1a'].btw, vat); output21 = add(output21, vat); break;
      case '1b': a['1b'].grondslag = add(a['1b'].grondslag, base); a['1b'].btw = add(a['1b'].btw, vat); output9 = add(output9, vat); break;
      case '1e': a['1e'].grondslag = add(a['1e'].grondslag, base); break;
      case '2a': a['2a'].grondslag = add(a['2a'].grondslag, base); a['2a'].btw = add(a['2a'].btw, vat); domesticReverse = add(domesticReverse, vat); if (tx.deductible) reverseInput = add(reverseInput, vat); break;
      case '3a': a['3a'].grondslag = add(a['3a'].grondslag, base); break;
      case '3b': a['3b'].grondslag = add(a['3b'].grondslag, base); break;
      case '4a': a['4a'].grondslag = add(a['4a'].grondslag, base); a['4a'].btw = add(a['4a'].btw, vat); nonEuReverse = add(nonEuReverse, vat); if (tx.deductible) reverseInput = add(reverseInput, vat); break;
      case '4b': a['4b'].grondslag = add(a['4b'].grondslag, base); a['4b'].btw = add(a['4b'].btw, vat); euReverse = add(euReverse, vat); if (tx.deductible) reverseInput = add(reverseInput, vat); break;
      case '5b': if (tx.deductible) { if (tx.classification === 'domestic_input_21') input21 = add(input21, vat); else if (tx.classification === 'domestic_input_9') input9 = add(input9, vat); } break;
    }
    if (tx.type === 'expense' && !tx.deductible) nonDeductible = add(nonDeductible, vat);
  }

  a['5b'] = add(add(input21, input9), reverseInput);
  const outputTotal = add(add(add(output21, output9), domesticReverse), add(euReverse, nonEuReverse));
  const inputTotal = a['5b'];
  const netto = add(outputTotal, -inputTotal);
  const included = transactions.filter(t => t.includedInTotals).length;
  const evidenceRequired = transactions.filter(t => t.evidenceRequired && !t.includedInTotals).length;
  const unresolved = transactions.filter(t => t.classification === 'unresolved').length;
  const problems: string[] = [];
  if (transactions.some(t => t.includedInTotals && t.evidenceStatus !== 'human_confirmed')) problems.push('Een financieel opgenomen transactie is niet menselijk bevestigd.');
  if (transactions.some(t => t.classification === 'unresolved' && t.includedInTotals)) problems.push('Een unresolved transactie is financieel opgenomen.');
  const expectedOutput = transactions.filter(t => t.includedInTotals && t.type === 'income' && t.vat.status === 'known').reduce((s,t) => add(s,t.vat.amount),0) + transactions.filter(t => t.includedInTotals && reverse(t.classification) && t.vat.status === 'known').reduce((s,t)=>add(s,t.vat.amount),0);
  const expectedInput = transactions.filter(t => t.includedInTotals && t.type === 'expense' && t.deductible && t.vat.status === 'known').reduce((s,t)=>add(s,t.vat.amount),0);
  if (Math.abs(expectedOutput - outputTotal) > 0.0001) problems.push('Onafhankelijke verschuldigde-btw reconciliatie faalt.');
  if (Math.abs(expectedInput - inputTotal) > 0.0001) problems.push('Onafhankelijke voorbelasting-reconciliatie faalt.');
  if (Math.abs(add(expectedOutput, -expectedInput) - netto) > 0.0001) problems.push('Onafhankelijke netto-btw reconciliatie faalt.');

  return {
    transactions,
    overzicht: { output: { domestic21: output21, domestic9: output9, domesticReverse, euReverse, nonEuReverse, total: outputTotal }, input: { domestic21: input21, domestic9: input9, reverseCharge: reverseInput, total: inputTotal }, nonDeductible, netto, status: netto >= 0 ? 'af_te_dragen' : 'terug_te_vorderen' },
    aangifte: a,
    audit: { ok: problems.length === 0, problems, input: rows.length, known: transactions.filter(t => t.classification !== 'unresolved').length, unresolved, evidenceRequired, ignored: ignored.length, included },
    ignored,
  };
}

export function tweeKolommenWeergave(report: FiscalReport) {
  return {
    zeker: report.transactions.filter(t => t.includedInTotals).map(t => ({ transactie_id: t.id, omschrijving: t.description ?? '', type: t.type, btw: t.vat.status === 'known' ? `${t.vat.rate}% — €${t.vat.amount.toFixed(2)}` : 'onbekend', bedrag: `€${t.amount_incl_input.toFixed(2)}`, toegepaste_regel: t.reason })),
    twijfelgevallen: report.transactions.filter(t => !t.includedInTotals).map(t => ({ transactie_id: t.id, omschrijving: t.description ?? '', type: t.type, bedrag: `€${t.amount_incl_input.toFixed(2)}`, classificatie: t.classification, toegepaste_regel: t.reason })),
  };
}

export function berekenBetrouwbaarheidsscore(report: FiscalReport) {
  if (report.audit.input === 0) return 100;
  const unresolvedPenalty = (report.audit.unresolved / report.audit.input) * 35;
  const reviewPenalty = (report.audit.evidenceRequired / report.audit.input) * 15;
  const failurePenalty = report.audit.ok ? 0 : 50;
  return Math.max(0, Math.min(100, 100 - unresolvedPenalty - reviewPenalty - failurePenalty));
}
