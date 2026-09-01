import assert from 'node:assert/strict';
import { parseCsvToRawTransactions } from '../src/utils/vatCsvParser';

const csv = [
  'Datum;Af Bij;Bedrag;Naam / Omschrijving;Tegenrekening;Mededelingen',
  '2026-01-01;Bij;121,50;Klant A;NL00TEST;factuur',
  '2026-01-02;Af;1.234,56;Leverancier B;NL00TEST;kosten',
  '2026-01-03;Af;1234.56;Leverancier C;NL00TEST;kosten',
  '2026-01-04;Bij;€ 99,95;Klant D;NL00TEST;factuur',
  '2026-01-05;Af;(10,25);Leverancier E;NL00TEST;kosten',
].join('\n');
const rows = parseCsvToRawTransactions(csv);
assert.equal(rows.length, 5);
assert.equal(rows[0].amount_incl, 121.5);
assert.equal(rows[1].amount_incl, 1234.56);
assert.equal(rows[2].amount_incl, 1234.56);
assert.equal(rows[3].amount_incl, 99.95);
assert.equal(rows[4].amount_incl, 10.25);
assert.equal(new Set(rows.map(r => r.id)).size, rows.length);

assert.throws(() => parseCsvToRawTransactions('Datum;Af Bij;Bedrag\n2026-01-01;Bij;abc'));
assert.throws(() => parseCsvToRawTransactions('Datum;Bedrag\n2026-01-01;121,00'));

const large = ['Datum;Af Bij;Bedrag;Naam / Omschrijving', ...Array.from({length: 100_000}, (_, i) => `2026-01-01;Bij;109,00;Transactie ${i}`)].join('\n');
const largeRows = parseCsvToRawTransactions(large);
assert.equal(largeRows.length, 100_000);
assert.equal(new Set(largeRows.map(r => r.id)).size, 100_000);

console.log('BTW CSV safety reference tests passed');
