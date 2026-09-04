import { calculateFiscalVatReport } from '../btwFiscalSafeNormalized';
import type { RawTransaction } from '../btwSafeTypes';

const rows: RawTransaction[] = [
  { id:'cafe', type:'expense', amount_incl:423.50, description:'Café De Hoek' },
  { id:'openai', type:'expense', amount_incl:24.20, description:'OpenAI LLC' },
  { id:'grand-cafe', type:'expense', amount_incl:67.50, description:'Grand Café De Brasserie' },
  { id:'dentist', type:'expense', amount_incl:3025, description:'Kliniek Tandheelkunde' },
  { id:'elevenlabs', type:'expense', amount_incl:30, description:'ElevenLabs Inc' },
  { id:'kvk', type:'expense', amount_incl:15, description:'KVK Nederland' },
  { id:'netlify', type:'expense', amount_incl:19, description:'Netlify Inc.' },
  { id:'apple', type:'expense', amount_incl:149, description:'Apple Distribution International' },
  { id:'github', type:'expense', amount_incl:21, description:'Github Inc' },
  { id:'adobe', type:'expense', amount_incl:62.91, description:'Adobe Systems Software' },
  { id:'postnl', type:'expense', amount_incl:18.50, description:'PostNL Pakketten' },
  { id:'ah', type:'expense', amount_incl:32.15, description:'Albert Heijn Zakelijk' },
  { id:'anthropic', type:'expense', amount_incl:24.20, description:'Anthropic PBC' },
  { id:'didi', type:'expense', amount_incl:605, description:'Didi Talks NL' },
  { id:'resend', type:'expense', amount_incl:20, description:'Resend Inc.' },
  { id:'google', type:'expense', amount_incl:68.45, description:'Google Cloud EMEA' },
  { id:'lawyer', type:'expense', amount_incl:1815, description:'Advocatenkantoor Meijer' },
];

const report = calculateFiscalVatReport(rows);

if (report.audit.unresolved !== 0) throw new Error(`Geen enkele voorbeeldtransactie mag unresolved zijn; kreeg ${report.audit.unresolved}.`);
if (report.audit.evidenceRequired !== 0) throw new Error('Een banktransactie mag de berekening niet blokkeren omdat er nog geen factuur is aangeleverd.');
if (report.audit.included !== rows.length) throw new Error(`Alle ${rows.length} transacties moeten automatisch in het berekeningsrapport staan.`);
if (!report.audit.ok) throw new Error(`Audit moet groen zijn: ${report.audit.problems.join(' | ')}`);

const byId = (id: string) => report.transactions.find(tx => tx.id === id)!;
const expect = (id: string, classification: string, section: string, rate: number, deductible: boolean) => {
  const tx = byId(id);
  if (tx.classification !== classification) throw new Error(`${id}: verkeerde classificatie ${tx.classification}`);
  if (tx.section !== section) throw new Error(`${id}: verkeerde rubriek ${tx.section}`);
  if (tx.vat.status !== 'known' || tx.vat.rate !== rate) throw new Error(`${id}: verkeerde btw-behandeling`);
  if (tx.deductible !== deductible) throw new Error(`${id}: verkeerde aftrekbaarheid`);
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
expect('cafe', 'horeca_bua_9', '5b', 9, false);
expect('grand-cafe', 'horeca_bua_9', '5b', 9, false);
expect('dentist', 'exempt_input', '5b', 0, false);
expect('kvk', 'exempt_input', '5b', 0, false);
expect('postnl', 'domestic_input_21', '5b', 21, true);
expect('ah', 'domestic_input_9', '5b', 9, true);
expect('didi', 'domestic_input_21', '5b', 21, true);
expect('lawyer', 'domestic_input_21', '5b', 21, true);

console.log('OK: production regression set is automatically classified with zero manual classifications and calculation is not blocked by missing invoices.');
