import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { calculateFiscalVatReport, tweeKolommenWeergave } from '../btwFiscalSafeNormalized';
import { parseCsvToRawTransactions } from '../../utils/vatCsvParser';
import type { RawTransaction } from '../btwSafeTypes';

const expense = (id: string, description: string, amount_incl: number, memo = ''): RawTransaction => ({
  id,
  type: 'expense',
  amount_incl,
  description,
  memo,
});

const income = (id: string, description: string, amount_incl: number, memo = ''): RawTransaction => ({
  id,
  type: 'income',
  amount_incl,
  description,
  memo,
});

// Adversarial bank rows: descriptions intentionally contain misleading words,
// mixed signals, summary-looking text, punctuation/diacritics, and explicit rates.
const adversarialRows: RawTransaction[] = [
  income('a01', 'Verkoop zakelijke dienstverlening', 121),
  income('a02', 'Verkoop boek', 109),
  income('a03', 'Export goederen buiten EU', 1000),
  expense('a04', 'Laptop computer zakelijke aankoop', 121),
  expense('a05', 'Supermarkt voedingsmiddelen', 109),
  expense('a06', 'Hotel overnachting zakelijke reis 2026', 121),
  expense('a07', 'OpenAI LLC', 121),
  expense('a08', 'Adobe Systems Software', 121),
  expense('a09', 'Salaris medewerker', 2500),
  expense('a10', 'Aflossing lening bank', 500),
  expense('a11', 'Belastingdienst btw-aangifte', 300),
  expense('a12', 'Bankkosten rekening', 12.10),
  expense('a13', 'Café De Hoek'),
  expense('a14', 'Jumbo Zakelijk boodschappen'),
  expense('a15', 'Hotel De Zon all-in ontbijt'),
  expense('a16', 'Kliniek Tandheelkunde cosmetisch bleken'),
  expense('a17', 'Betaling leverancier 21%', 121),
  expense('a18', 'Betaling leverancier 9%', 109),
  expense('a19', 'Café De Hoek 21%', 121),
  expense('a20', 'Café De Hoek 9%', 109),
  expense('a21', 'Café De Hoek alcohol wijn', 121),
  expense('a22', 'Café De Hoek lunch', 109),
  expense('a23', 'Café De Hoek factuur 21%', 121),
  expense('a24', 'Café De Hoek factuur 9%', 109),
  expense('a25', 'Café De Hoek omschrijving met Café en éé́n', 121),
  expense('a26', 'Pathé bioscoopkaartje', 109),
  expense('a27', 'PostNL Pakketten', 121),
  expense('a28', 'Albert Heijn Zakelijk 9%', 109),
  expense('a29', 'Didi Talks NL marketing', 121),
  expense('a30', 'Advocatenkantoor Meijer', 121),
];

const report = calculateFiscalVatReport(adversarialRows);
const view = tweeKolommenWeergave(report);

// Every row must remain represented; summaries/ambiguities must not silently
// become fiscal totals, and no known case may be excluded unexpectedly.
assert.equal(report.transactions.length, adversarialRows.length, 'Elke banktransactie moet zichtbaar blijven in het rapport.');
assert.ok(report.audit.unresolved >= 4, 'De bewust ambigue combinaties moeten fail-closed blijven.');
assert.equal(view.twijfelgevallen.length, report.audit.unresolved, 'Twijfelgevallenweergave moet aansluiten op unresolved.');

const byId = (id: string) => report.transactions.find(tx => tx.id === id)!;
const expectKnown = (id: string, classification: string, section: string, rate: number) => {
  const tx = byId(id);
  assert.equal(tx.vat.status, 'known', `${id}: btw moet bekend zijn`);
  if (tx.vat.status === 'known') assert.equal(tx.vat.rate, rate, `${id}: tarief`);
  assert.equal(tx.classification, classification, `${id}: classificatie`);
  assert.equal(tx.section, section, `${id}: aangifterubriek`);
  assert.equal(tx.includedInTotals, true, `${id}: moet in totalen`);
};

expectKnown('a01', 'domestic_output_21', '1a', 21);
expectKnown('a02', 'domestic_output_9', '1b', 9);
expectKnown('a03', 'non_eu_output_0', '3a', 0);
expectKnown('a04', 'domestic_input_21', '5b', 21);
expectKnown('a05', 'domestic_input_9', '5b', 9);
expectKnown('a06', 'domestic_input_21', '5b', 21);
expectKnown('a07', 'non_eu_reverse_charge', '4a', 21);
expectKnown('a08', 'eu_reverse_charge', '4b', 21);
expectKnown('a09', 'private_no_vat', 'geen', 0);
expectKnown('a10', 'private_no_vat', 'geen', 0);
expectKnown('a11', 'private_no_vat', 'geen', 0);
expectKnown('a12', 'private_no_vat', 'geen', 0);
expectKnown('a17', 'domestic_input_21', '5b', 21);
expectKnown('a18', 'domestic_input_9', '5b', 9);
expectKnown('a19', 'domestic_input_21', '5b', 21);
expectKnown('a20', 'domestic_input_9', '5b', 9);
expectKnown('a21', 'domestic_input_21', '5b', 21);
expectKnown('a22', 'domestic_input_9', '5b', 9);
expectKnown('a23', 'domestic_input_21', '5b', 21);
expectKnown('a24', 'domestic_input_9', '5b', 9);
expectKnown('a26', 'domestic_input_9', '5b', 9);
expectKnown('a27', 'domestic_input_21', '5b', 21);
expectKnown('a28', 'domestic_input_9', '5b', 9);
expectKnown('a29', 'domestic_input_21', '5b', 21);
expectKnown('a30', 'domestic_input_21', '5b', 21);

for (const id of ['a13', 'a14', 'a15', 'a16']) {
  const tx = byId(id);
  assert.equal(tx.vat.status, 'unknown', `${id}: ambigue bankdata mag niet gokken`);
  assert.equal(tx.includedInTotals, false, `${id}: ambigue transactie mag totalen niet vervuilen`);
}

// Explicit rate in a description may be used only when the production rule set
// accepts the description as sufficiently deterministic. A bare merchant name
// must never override that fail-closed boundary.
assert.equal(byId('a19').vat.status, 'known');
assert.equal(byId('a19').section, '5b');
assert.equal(byId('a20').section, '5b');

// Reconciliation: report-level totals must remain internally consistent.
assert.equal(report.aangifte['5a'], report.overzicht.output.total, '5a moet gelijk zijn aan verschuldigde btw.');
assert.equal(report.aangifte['5b'], report.overzicht.input.total, '5b moet gelijk zijn aan aftrekbare voorbelasting.');
assert.equal(
  Number(report.aangifte['5a']) - Number(report.aangifte['5b']),
  report.overzicht.netto,
  'Netto btw moet exact aansluiten op 5a - 5b.',
);
assert.equal(report.aangifte['1a'].btw, 21, '1a onverwacht gewijzigd.');
assert.equal(report.aangifte['1b'].btw, 9, '1b onverwacht gewijzigd.');
assert.equal(report.aangifte['3a'].btw, 0, '3a moet 0 btw tonen.');

// Customer/import summary rows: they must not be trusted as fiscal facts.
const csvWithSummary = [
  'Datum;Naam / Omschrijving;Tegenrekening;Af Bij;Bedrag;Mededelingen',
  '2026-01-01;Verkoop zakelijke dienstverlening;NL00TEST;Bij;121,00;factuur 21%',
  '2026-01-02;TOTAAL BTW 21%;; ;999999,99;door klant berekend',
  '2026-01-03;Totaal incl. BTW;NL00TEST;Af;888888,88;samenvatting',
  '2026-01-04;OpenAI LLC;US00TEST;Af;121,00;software',
].join('\n');
const parsedSummary = parseCsvToRawTransactions(csvWithSummary);
assert.equal(parsedSummary.length, 4, 'Alle fysieke bankregels moeten worden geparseerd.');
const summaryReport = calculateFiscalVatReport(parsedSummary);
assert.ok(summaryReport.ignored.length >= 2, 'Samenvattingsregels moeten worden genegeerd voor fiscale totalen.');
assert.equal(summaryReport.aangifte['1a'].btw, 21, 'Klantberekend totaal mag 1a niet beïnvloeden.');
assert.equal(summaryReport.aangifte['4a'].btw, 21, 'Werkelijke OpenAI-transactie moet wel worden meegenomen.');

// Parser dialects and number formats.
const parserCases = [
  ['comma/decimal', 'Date,Description,IBAN,Direction,Amount,Memo\n2026-01-01,Kantoorbenodigdheden,NL00TEST,expense,"1.234,56",zakelijk\n2026-01-02,Verkoop boek 9%,NL00TEST,income,"109,00",9%'],
  ['semicolon signed', 'Datum;Omschrijving;IBAN;Bedrag;Memo\n2026-01-01;Kantoorbenodigdheden;NL00TEST;-1.234,56;zakelijk\n2026-01-02;Verkoop boek 9%;NL00TEST;+109,00;9%'],
  ['debit-credit', 'Datum;Omschrijving;IBAN;Debet;Credit;Memo\n2026-01-01;Laptop computer zakelijke aankoop;NL00TEST;121,00;;zakelijk\n2026-01-02;Verkoop zakelijke dienstverlening 21%;NL00TEST;;121,00;21%'],
  ['euro-parentheses', 'Date;Description;IBAN;Amount;Memo\n2026-01-01;Kantoorbenodigdheden;NL00TEST;(€ 1.234,56);zakelijk\n2026-01-02;Verkoop boek 9%;NL00TEST;€ 109,00;9%'],
] as const;
for (const [label, csv] of parserCases) {
  const parsed = parseCsvToRawTransactions(csv);
  assert.equal(parsed.length, 2, `${label}: alle regels moeten worden gelezen.`);
  assert.ok(parsed.every(row => Number.isFinite(row.amount_incl) && row.amount_incl > 0), `${label}: bedragen moeten numeriek valide zijn.`);
}

// 25k rows: throughput + deterministic result count. The target is deliberately
// generous to avoid machine-dependent flakiness while still catching accidental
// quadratic behavior.
const performanceRows: RawTransaction[] = Array.from({ length: 25_000 }, (_, i) => {
  const n = i % 5;
  if (n === 0) return income(`p-${i}`, 'Verkoop zakelijke dienstverlening', 121);
  if (n === 1) return income(`p-${i}`, 'Verkoop boek', 109);
  if (n === 2) return expense(`p-${i}`, 'Laptop computer zakelijke aankoop', 121);
  if (n === 3) return expense(`p-${i}`, 'OpenAI LLC', 121);
  return expense(`p-${i}`, 'Salaris medewerker', 2500);
});

const started = performance.now();
const performanceReport = calculateFiscalVatReport(performanceRows);
const elapsedMs = performance.now() - started;
assert.equal(performanceReport.transactions.length, 25_000, 'Alle stressregels moeten worden verwerkt.');
assert.equal(performanceReport.audit.unresolved, 0, 'Stressdataset bevat geen bedoelde ambiguïteit.');
assert.equal(performanceReport.audit.included, 25_000, 'Alle stressregels moeten fiscaal deterministisch zijn.');
assert.ok(elapsedMs < 15_000, `25.000 transacties moeten binnen redelijke tijd worden verwerkt (${Math.round(elapsedMs)} ms).`);

// Duplicate and invalid-value guards must reject unsafe input rather than guess.
assert.throws(
  () => calculateFiscalVatReport([
    expense('dup', 'Laptop computer zakelijke aankoop', 121),
    expense('dup', 'Kantoorbenodigdheden', 121),
  ]),
  /duplicate/i,
  'Dubbele transacties mogen niet stilzwijgend worden verwerkt.',
);
assert.throws(
  () => calculateFiscalVatReport([expense('nan', 'Laptop computer zakelijke aankoop', Number.NaN)]),
  /finite|bedrag|amount/i,
  'Niet-finite bedragen moeten hard worden afgewezen.',
);

console.log(`OK: adversarial VAT stress suite; ${adversarialRows.length} edge rows + 25,000 performance rows processed in ${Math.round(elapsedMs)} ms.`);
