import assert from 'node:assert/strict';
import { calculateFiscalVatReport, tweeKolommenWeergave } from '../btwFiscalSafeNormalized';
import { parseCsvToRawTransactions } from '../../utils/vatCsvParser';
import type { RawTransaction } from '../btwSafeTypes';

const expense = (id: string, description: string, amount = 121): RawTransaction => ({ id, type: 'expense', amount_incl: amount, description });
const income = (id: string, description: string, amount = 121): RawTransaction => ({ id, type: 'income', amount_incl: amount, description });

const rows: RawTransaction[] = [
  income('sales21', 'Verkoop zakelijke dienstverlening 21%'),
  income('sales9', 'Verkoop boek 9%'),
  income('export', 'Export goederen buiten EU 0%'),
  expense('office', 'Kantoorbenodigdheden kantoorartikelen'),
  expense('hardware', 'Laptop computer zakelijke aankoop'),
  expense('fuel', 'Benzine tankstation'),
  expense('software', 'Software licentie zakelijke administratie'),
  expense('hotel', 'Hotel overnachting zakelijke reis'),
  expense('food', 'Supermarkt voedingsmiddelen'),
  expense('books', 'Boeken zakelijke aankoop'),
  expense('water', 'Drinkwater'),
  expense('flowers', 'Bloemboeket'),
  expense('medicine', 'Geneesmiddelen'),
  expense('taxi', 'Taxi zakelijke reis'),
  expense('barber', 'Kapper'),
  expense('bike', 'Fietsreparatie'),
  expense('cinema', 'Bioscoopkaartje'),
  expense('sport', 'Sportclub contributie'),
  expense('salary', 'Salarisbetaling medewerker'),
  expense('loan', 'Aflossing lening bank'),
  expense('tax', 'Belastingdienst btw-aangifte'),
  expense('bank', 'Bankkosten rekening'),
  expense('non-eu', 'OpenAI LLC'),
  expense('eu', 'Adobe Systems Software'),
  expense('explicit', 'Leverancier factuur 21%'),
  expense('ambiguous', 'Betaling leverancier'),
];

const report = calculateFiscalVatReport(rows);
const view = tweeKolommenWeergave(report);

assert.equal(report.audit.included, rows.length - 1, 'Alle herkenbare transacties moeten worden verwerkt; alleen de bewust ambigue regel blijft buiten fiscale totalen.');
assert.equal(report.audit.unresolved, 1, 'Alleen de bewust ambigue transactie mag unresolved blijven.');
assert.equal(view.twijfelgevallen.length, 1, 'Alleen de bewust ambigue transactie mag als twijfelgeval terugkomen.');
assert.equal(report.audit.problems.length, 1, 'De ambigue transactie moet als enige auditprobleem blijven bestaan.');

const byId = (id: string) => report.transactions.find(tx => tx.id === id)!;
const expectKnown = (id: string, classification: string, section: string, rate: number, deductible: boolean) => {
  const tx = byId(id);
  assert.equal(tx.classification, classification, `${id}: classificatie`);
  assert.equal(tx.section, section, `${id}: rubriek`);
  assert.equal(tx.vat.status, 'known', `${id}: btw-status`);
  if (tx.vat.status === 'known') assert.equal(tx.vat.rate, rate, `${id}: tarief`);
  assert.equal(tx.deductible, deductible, `${id}: aftrekbaarheid`);
  assert.equal(tx.includedInTotals, true, `${id}: moet worden opgenomen`);
};

expectKnown('sales21', 'domestic_output_21', '1a', 21, false);
expectKnown('sales9', 'domestic_output_9', '1b', 9, false);
expectKnown('export', 'non_eu_output_0', '3a', 0, false);
expectKnown('office', 'domestic_input_21', '5b', 21, true);
expectKnown('hardware', 'domestic_input_21', '5b', 21, true);
expectKnown('fuel', 'domestic_input_21', '5b', 21, true);
expectKnown('software', 'domestic_input_21', '5b', 21, true);
expectKnown('hotel', 'domestic_input_21', '5b', 21, true);
expectKnown('food', 'domestic_input_9', '5b', 9, true);
expectKnown('books', 'domestic_input_9', '5b', 9, true);
expectKnown('water', 'domestic_input_9', '5b', 9, true);
expectKnown('flowers', 'domestic_input_9', '5b', 9, true);
expectKnown('medicine', 'domestic_input_9', '5b', 9, true);
expectKnown('taxi', 'domestic_input_9', '5b', 9, true);
expectKnown('barber', 'domestic_input_9', '5b', 9, true);
expectKnown('bike', 'domestic_input_9', '5b', 9, true);
expectKnown('cinema', 'domestic_input_9', '5b', 9, true);
expectKnown('sport', 'domestic_input_9', '5b', 9, true);
expectKnown('salary', 'private_no_vat', 'geen', 0, false);
expectKnown('loan', 'private_no_vat', 'geen', 0, false);
expectKnown('tax', 'private_no_vat', 'geen', 0, false);
expectKnown('bank', 'exempt_input', '5b', 0, false);
expectKnown('non-eu', 'non_eu_reverse_charge', '4a', 21, true);
expectKnown('eu', 'eu_reverse_charge', '4b', 21, true);
expectKnown('explicit', 'domestic_input_21', '5b', 21, true);

assert.equal(byId('ambiguous').vat.status, 'unknown', 'De veilige engine mag een werkelijk ambigue omschrijving niet verzinnen.');
assert.equal(byId('ambiguous').includedInTotals, false, 'Een werkelijk ambigue regel mag geen btw-totalen vervuilen.');
assert.equal(report.aangifte['1a'], 21, '1a moet alleen verschuldigde 21%-omzet bevatten.');
assert.equal(report.aangifte['1b'], 11, '1b moet alleen verschuldigde 9%-omzet bevatten.');
assert.equal(report.aangifte['3a'].btw, 0, '0%-uitvoer heeft geen verschuldigde btw.');
assert.equal(report.aangifte['5a'], report.overzicht.output.total, '5a moet exact aansluiten op verschuldigde btw.');
assert.equal(report.aangifte['5b'], report.overzicht.input.total, '5b moet exact aansluiten op aftrekbare voorbelasting.');

const csvSemicolon = [
  'Datum;Naam / Omschrijving;Tegenrekening;Af Bij;Bedrag;Mededelingen',
  '2026-01-01;Laptop computer zakelijke aankoop;NL00TEST;Af;121,00;zakelijk',
  '2026-01-02;Verkoop zakelijke dienstverlening 21%;NL00TEST;Bij;121,00;21%',
  '2026-01-03;OpenAI LLC;US00TEST;Af;24,20;software',
].join('\n');
const parsedSemi = parseCsvToRawTransactions(csvSemicolon);
assert.equal(parsedSemi.length, 3, 'Semikolon-bankbestand moet volledig worden gelezen.');
assert.equal(parsedSemi[0].type, 'expense');
assert.equal(parsedSemi[1].type, 'income');
assert.equal(parsedSemi[2].amount_incl, 24.2);

const csvComma = [
  'Date,Description,IBAN,Direction,Amount,Memo',
  '2026-01-01,Kantoorbenodigdheden,NL00TEST,expense,"1.234,56",zakelijk',
  '2026-01-02,Verkoop boek 9%,NL00TEST,income,109,00,9%',
].join('\n');
const parsedComma = parseCsvToRawTransactions(csvComma);
assert.equal(parsedComma.length, 2, 'Komma-bankbestand moet volledig worden gelezen.');
assert.equal(parsedComma[0].amount_incl, 1234.56);
assert.equal(parsedComma[1].type, 'income');

console.log('OK: broad bank-file coverage, fiscal direction, 0/9/21%, reverse charge, no-VAT payments, evidence separation and Dutch CSV variants.');
