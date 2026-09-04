import assert from 'node:assert/strict';
import { enrichVatTransactions } from '../btwOnlineContext';
import type { RawTransaction } from '../btwSafeTypes';

const rows: RawTransaction[] = [
  { id: 'openai', type: 'expense', amount_incl: 24.2, description: 'OpenAI LLC' },
  { id: 'ah', type: 'expense', amount_incl: 32.15, description: 'Albert Heijn Zakelijk' },
  { id: 'didi', type: 'expense', amount_incl: 605, description: 'Didi Talks NL marketingdienst' },
  { id: 'law', type: 'expense', amount_incl: 1815, description: 'Advocatenkantoor Meijer' },
  { id: 'dentist', type: 'expense', amount_incl: 3025, description: 'Kliniek Tandheelkunde' },
  { id: 'postnl', type: 'expense', amount_incl: 18.5, description: 'PostNL Pakketten' },
];

const enriched = await enrichVatTransactions(rows);
const text = (id: string) => enriched.find(r => r.id === id)?.description ?? '';

assert.match(text('openai'), /niet-EU software\/IT-leverancier; 4a verlegd 21%/i);
assert.match(text('ah'), /supermarkt\/voedingsmiddelenhandel; 9%-categorie/i);
assert.match(text('didi'), /marketingdienst; 21%-categorie/i);
assert.match(text('law'), /professionele zakelijke dienstverlening; 21%-categorie/i);
assert.match(text('dentist'), /tandheelkundige medische behandeling/i);
assert.match(text('postnl'), /PostNL pakketdienst; 21%/i);

console.log('OK: deterministic VAT context is enriched before manual review for supported merchant/context cases.');
