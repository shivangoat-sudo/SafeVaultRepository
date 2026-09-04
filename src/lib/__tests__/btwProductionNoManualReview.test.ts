import { calculateFiscalVatReport, tweeKolommenWeergave } from '../btwFiscalSafeNormalized';
import type { RawTransaction } from '../btwSafeTypes';

// These are transactions for which the bank data contains enough deterministic
// information to classify the fiscal treatment without a bookkeeper selecting a
// tariff. Genuine ambiguity is tested separately in btwFiscalConformance.test.ts.
const rows: RawTransaction[] = [
  { id:'openai', type:'expense', amount_incl:24.20, description:'OpenAI LLC' },
  { id:'dentist', type:'expense', amount_incl:3025, description:'Kliniek Tandheelkunde' },
  { id:'elevenlabs', type:'expense', amount_incl:30, description:'ElevenLabs Inc' },
  { id:'kvk', type:'expense', amount_incl:15, description:'KVK Nederland' },
  { id:'netlify', type:'expense', amount_incl:19, description:'Netlify Inc.' },
  { id:'apple', type:'expense', amount_incl:149, description:'Apple Distribution International' },
  { id:'github', type:'expense', amount_incl:21, description:'Github Inc' },
  { id:'adobe', type:'expense', amount_incl:62.91, description:'Adobe Systems Software' },
  { id:'postnl', type:'expense', amount_incl:18.50, description:'PostNL Pakketten' },
  { id:'ah', type:'expense', amount_incl:32.15, description:'Albert Heijn Zakelijk — voedingsmiddelen' },
  { id:'anthropic', type:'expense', amount_incl:24.20, description:'Anthropic PBC' },
  { id:'didi', type:'expense', amount_incl:605, description:'Didi Talks NL — marketingdienst' },
  { id:'resend', type:'expense', amount_incl:20, description:'Resend Inc.' },
  { id:'google', type:'expense', amount_incl:68.45, description:'Google Cloud EMEA' },
  { id:'lawyer', type:'expense', amount_incl:1815, description:'Advocatenkantoor Meijer — juridisch advies' },
];

const report = calculateFiscalVatReport(rows);
const view = tweeKolommenWeergave(report);

if (report.audit.unresolved !== 0) throw new Error(`Geen enkele deterministisch classificeerbare voorbeeldtransactie mag unresolved zijn; kreeg ${report.audit.unresolved}.`);
if (report.audit.included !== rows.length) throw new Error(`Alle ${rows.length} deterministische transacties moeten automatisch in het berekeningsrapport staan.`);
if (view.twijfelgevallen.length !== 0) throw new Error(`Geen enkele deterministisch classificeerbare voorbeeldtransactie mag als handmatige twijfelclassificatie worden getoond; kreeg ${view.twijfelgevallen.length}.`);
if (report.audit.evidenceRequired !== 13) throw new Error(`Er moeten precies 13 normale aftrekbare inkooptransacties apart als bewijsgevoelig worden gemarkeerd; kreeg ${report.audit.evidenceRequired}.`);
if (report.audit.problems.length !== 0) throw new Error(`Het productierapport mag voor deterministische transacties geen fiscale auditproblemen bevatten; kreeg ${report.audit.problems.join(' | ')}.`);

const byId = (id: string) => report.transactions.find(tx => tx.id === id)!;
const expect = (id: string, classification: string, section: string, rate: number, deductible: boolean) => {
  const tx = byId(id);
  if (tx.classification !== classification) throw new Error(`${id}: verkeerde classificatie ${tx.classification}`);
  if (tx.section !== section) throw new Error(`${id}: verkeerde rubriek ${tx.section}`);
  if (tx.vat.status !== 'known' || tx.vat.rate !== rate) throw new Error(`${id}: verkeerde btw-behandeling`);
  if (tx.deductible !== deductible) throw new Error(`${id}: verkeerde aftrekbaarheid`);
};
const vatAmount = (id: string) => {
  const vat = byId(id).vat;
  if (vat.status !== 'known') throw new Error(`${id}: btw-bedrag ontbreekt ondanks bekende classificatie.`);
  return vat.amount;
};

expect('openai', 'non_eu_reverse_charge', '4a', 21, true);
expect('anthropic', 'non_eu_reverse_charge', '4a', 21, true);
expect('elevenlabs', 'non_eu_reverse_charge', '4a', 21, true);
expect('netlify', 'non_eu_reverse_charge', '4a', 21, true);
expect('github', 'non_eu_reverse_charge', '4a', 21, true);
expect('resend', 'non_eu_reverse_charge', '4a', 21, true);
expect('adobe', 'eu_reverse_charge', '4b', 21, true);
expect('apple', 'eu_reverse_charge', '4b', 21, true);
expect('google', 'eu_reverse_charge', '4b', 21, true);
expect('dentist', 'exempt_input', '5b', 0, false);
expect('kvk', 'exempt_input', '5b', 0, false);
expect('postnl', 'domestic_input_21', '5b', 21, true);
expect('ah', 'domestic_input_9', '5b', 9, true);
expect('didi', 'domestic_input_21', '5b', 21, true);
expect('lawyer', 'domestic_input_21', '5b', 21, true);

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sum = (ids: string[]) => round2(ids.reduce((total, id) => total + vatAmount(id), 0));
const expected4a = sum(['openai','elevenlabs','netlify','github','anthropic','resend']);
const expected4b = sum(['apple','adobe','google']);
const expected5b = sum(['openai','anthropic','elevenlabs','netlify','github','resend','adobe','apple','google','postnl','ah','didi','lawyer']);

if (report.aangifte['4a'].grondslag !== 138.40 || report.aangifte['4a'].btw !== expected4a)
  throw new Error(`Rubriek 4a is onjuist: ${JSON.stringify(report.aangifte['4a'])}; verwacht grondslag 138.40 en btw ${expected4a}.`);
if (report.aangifte['4b'].grondslag !== 280.36 || report.aangifte['4b'].btw !== expected4b)
  throw new Error(`Rubriek 4b is onjuist: ${JSON.stringify(report.aangifte['4b'])}; verwacht grondslag 280.36 en btw ${expected4b}.`);
if (report.aangifte['5b'] !== expected5b)
  throw new Error(`Rubriek 5b is onjuist: kreeg ${report.aangifte['5b']}, verwacht ${expected5b}.`);
if (report.aangifte['5a'] !== report.overzicht.output.total)
  throw new Error(`Rubriek 5a sluit niet aan op het onafhankelijke verschuldigde-btw totaal: ${report.aangifte['5a']} vs ${report.overzicht.output.total}.`);
if (report.aangifte['5b'] !== report.overzicht.input.total)
  throw new Error(`Rubriek 5b sluit niet aan op het voorbelastingtotaal: ${report.aangifte['5b']} vs ${report.overzicht.input.total}.`);
if (report.audit.included !== report.transactions.filter(t => t.includedInTotals).length)
  throw new Error('Audit included-count sluit niet aan op de transacties die daadwerkelijk in de berekening zitten.');

console.log('OK: deterministic bank-only production regression set is fully classified without manual fiscal review; exact 4a/4b/5a/5b totals reconcile and documentary evidence remains separate from classification.');
