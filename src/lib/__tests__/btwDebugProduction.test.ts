import { calculateFiscalVatReport } from '../btwFiscalSafeNormalized';
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
console.log('DEBUG_PRODUCTION', JSON.stringify(report.transactions.map((tx) => ({ id: tx.id, classification: tx.classification, section: tx.section, rate: tx.vat.status === 'known' ? tx.vat.rate : null, reason: tx.reason }))));
console.log('DEBUG_AUDIT', JSON.stringify(report.audit));
