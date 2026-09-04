import assert from 'node:assert/strict';
import { calculateFiscalVatReport, tweeKolommenWeergave } from '../btwFiscalSafeNormalized';
import type { RawTransaction } from '../btwSafeTypes';

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
assert.equal(report.audit.unresolved, 0);
assert.equal(report.audit.included, rows.length);
assert.equal(view.twijfelgevallen.length, 0);
assert.equal(report.audit.problems.length, 0);

const byId = (id: string) => report.transactions.find(tx => tx.id === id)!;
const expect = (id: string, classification: string, section: string, rate: number, deductible: boolean) => {
  const tx = byId(id);
  assert.equal(tx.classification, classification, `${id}: verkeerde classificatie`);
  assert.equal(tx.section, section, `${id}: verkeerde rubriek`);
  assert.equal(tx.vat.status, 'known', `${id}: btw ontbreekt`);
  assert.equal(tx.vat.rate, rate, `${id}: verkeerd tarief`);
  assert.equal(tx.deductible, deductible, `${id}: verkeerde aftrekbaarheid`);
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

const ambiguous: RawTransaction[] = [
  { id:'cafe', type:'expense', amount_incl:423.5, description:'Café De Hoek' },
  { id:'jumbo', type:'expense', amount_incl:28.4, description:'Jumbo Zakelijk' },
  { id:'generic', type:'expense', amount_incl:100, description:'Algemene betaling' },
];
const ambiguousReport = calculateFiscalVatReport(ambiguous);
assert.ok(ambiguousReport.transactions.every(t => t.classification === 'unresolved'));
assert.ok(ambiguousReport.transactions.every(t => t.includedInTotals === false));

// Large-document regression: 4,500 supported bank transactions.
const largeRows: RawTransaction[] = Array.from({ length: 4500 }, (_, i) => ({
  id: `large-${i}`,
  type: 'expense',
  amount_incl: 121,
  description: i % 4 === 0 ? 'Kantoorbenodigdheden' : i % 4 === 1 ? 'PostNL Pakketten' : i % 4 === 2 ? 'Albert Heijn Zakelijk voedingsmiddelen' : 'OpenAI LLC',
}));
const started = Date.now();
const largeReport = calculateFiscalVatReport(largeRows);
const elapsed = Date.now() - started;
assert.equal(largeReport.transactions.length, 4500);
assert.equal(largeReport.audit.unresolved, 0);
assert.equal(largeReport.transactions.filter(t => t.includedInTotals).length, 4500);
assert.equal(tweeKolommenWeergave(largeReport).twijfelgevallen.length, 0);
assert.ok(elapsed < 15000, `4500 transacties duurden ${elapsed} ms`);

console.log('OK: SafeVault maximizes automatic VAT recognition, keeps genuine ambiguity fail-closed, and handles 4,500 supported transactions without manual classification.');
