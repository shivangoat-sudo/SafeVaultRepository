import { calculateFiscalVatReport } from '../btwFiscalSafeNormalized';
import type { RawTransaction } from '../btwSafeTypes';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

const rows: RawTransaction[] = [
  { id:'openai-us', type:'expense', amount_incl:100, description:'OpenAI LLC', tegenrekening_iban:'US12345678901234567890' },
  { id:'anthropic-us', type:'expense', amount_incl:100, description:'Anthropic PBC', tegenrekening_iban:'US12345678901234567890' },
  { id:'netlify-us', type:'expense', amount_incl:100, description:'Netlify Inc.', tegenrekening_iban:'US12345678901234567890' },
  { id:'github-us', type:'expense', amount_incl:100, description:'Github Inc', tegenrekening_iban:'US12345678901234567890' },
  { id:'resend-us', type:'expense', amount_incl:100, description:'Resend Inc.', tegenrekening_iban:'US12345678901234567890' },
  { id:'elevenlabs-us', type:'expense', amount_incl:100, description:'ElevenLabs Inc', tegenrekening_iban:'US12345678901234567890' },
  { id:'adobe-ie', type:'expense', amount_incl:100, description:'Adobe Systems Software', tegenrekening_iban:'IE123456789012345678' },
  { id:'apple-ie', type:'expense', amount_incl:100, description:'Apple Distribution International', tegenrekening_iban:'IE123456789012345678' },
  { id:'google-ie', type:'expense', amount_incl:100, description:'Google Cloud EMEA', tegenrekening_iban:'IE123456789012345678' },
  { id:'dentist', type:'expense', amount_incl:100, description:'Kliniek Tandheelkunde' },
  { id:'kvk', type:'expense', amount_incl:85.15, description:'KVK inschrijfvergoeding' },
  { id:'postnl', type:'expense', amount_incl:121, description:'PostNL Pakketten' },
  { id:'lawyer', type:'expense', amount_incl:121, description:'Advocatenkantoor Meijer' },
  { id:'pathe-plain', type:'expense', amount_incl:109, description:'Pathé' },
  { id:'cafe', type:'expense', amount_incl:423.50, description:'Café De Hoek' },
  { id:'grand-cafe', type:'expense', amount_incl:67.50, description:'Grand Café De Brasserie' },
  { id:'didi-talks', type:'expense', amount_incl:605, description:'Didi Talks NL' },
  { id:'albert-heijn', type:'expense', amount_incl:32.15, description:'Albert Heijn Zakelijk' },
  { id:'generic-foreign', type:'expense', amount_incl:100, description:'Software subscription', tegenrekening_iban:'DE12345678901234567890' },
  { id:'openai-nl', type:'expense', amount_incl:121, description:'OpenAI LLC', tegenrekening_iban:'NL1234567890123456' },
];

const report = calculateFiscalVatReport(rows);
const byId = (id: string) => report.transactions.find(tx => tx.id === id)!;

for (const id of ['openai-us','anthropic-us','netlify-us','github-us','resend-us','elevenlabs-us','openai-nl']) {
  const tx = byId(id);
  assert(tx.classification === 'non_eu_reverse_charge', `${id} moet als niet-EU-verlegging worden herkend.`);
  assert(tx.section === '4a', `${id} moet in rubriek 4a vallen.`);
  assert(tx.vat.status === 'known' && tx.vat.rate === 21, `${id} moet met 21% worden berekend.`);
  assert(tx.deductible, `${id} moet bij normale zakelijke belaste bestemming aftrekbaar zijn.`);
}

for (const id of ['adobe-ie','apple-ie','google-ie']) {
  const tx = byId(id);
  assert(tx.classification === 'eu_reverse_charge', `${id} moet als EU-verlegging worden herkend.`);
  assert(tx.section === '4b', `${id} moet in rubriek 4b vallen.`);
  assert(tx.vat.status === 'known' && tx.vat.rate === 21, `${id} moet met 21% worden berekend.`);
  assert(tx.deductible, `${id} moet bij normale zakelijke belaste bestemming aftrekbaar zijn.`);
}

assert(byId('dentist').classification === 'exempt_input', 'Tandheelkundige zorg moet als btw-vrijstelling worden herkend, niet als 21% inkoop.');
assert(byId('dentist').vat.status === 'known' && byId('dentist').vat.rate === 0, 'Vrijgestelde tandheelkundige zorg mag geen btw bevatten in het rapport.');
assert(byId('kvk').classification === 'exempt_input', 'KVK-inschrijfvergoeding mag niet automatisch als 21% btw-inkoop worden berekend.');
assert(byId('kvk').vat.status === 'known' && byId('kvk').vat.rate === 0, 'KVK-inschrijfvergoeding moet zonder btw worden verwerkt.');
assert(byId('postnl').classification === 'domestic_input_21', 'PostNL Pakketten moet als duidelijke Nederlandse 21%-dienst worden herkend.');
assert(byId('lawyer').classification === 'domestic_input_21', 'Een advocatenkantoor moet als duidelijke Nederlandse 21%-dienst worden herkend.');
assert(byId('pathe-plain').classification === 'domestic_input_9', 'Plain Pathé moet via merchantcontext automatisch als bioscoop/9% worden herkend.');
assert(byId('cafe').classification === 'horeca_bua_9', 'Café De Hoek moet automatisch als niet-aftrekbare horeca worden herkend.');
assert(byId('grand-cafe').classification === 'horeca_bua_9', 'Grand Café De Brasserie moet automatisch als niet-aftrekbare horeca worden herkend.');
assert(byId('didi-talks').classification === 'domestic_input_21', 'Didi Talks NL moet automatisch als zakelijke dienst worden herkend.');
assert(byId('albert-heijn').classification === 'domestic_input_9', 'Albert Heijn Zakelijk moet via het voedingsmiddel-signaal automatisch worden verwerkt.');
assert(byId('generic-foreign').classification === 'unresolved', 'Een generieke buitenlandse softwareomschrijving mag niet zonder verdere context als verlegging worden verzonnen.');
assert(report.audit.unresolved === 1, 'Alleen de echt generieke buitenlandse omschrijving mag in deze regressieset unresolved blijven.');
assert(report.aangifte['4a'].grondslag === 721 && report.aangifte['4a'].btw === 151.41, 'Niet-EU verlegging moet de zeven bekende leveranciers over de volledige vergoeding correct bevatten.');
assert(report.aangifte['4b'].grondslag === 300 && report.aangifte['4b'].btw === 63, 'EU verlegging moet onafhankelijk op 4b worden opgeteld.');
console.log('OK: description-only supplier context, EU/non-EU reverse charge, medical exemption, KVK fee, PostNL, Pathé, horeca, supermarket and service recognition.');
