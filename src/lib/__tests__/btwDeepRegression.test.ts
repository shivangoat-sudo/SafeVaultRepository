import assert from 'node:assert/strict';
import { parseCsvToRawTransactions } from '../../utils/vatCsvParser';
import { calculateFiscalVatReport, tweeKolommenWeergave } from '../btwFiscalSafeNormalized';
import type { RawTransaction } from '../btwSafeTypes';

const expense = (id: string, description: string, amount = 121, iban?: string): RawTransaction => ({ id, type: 'expense', amount_incl: amount, description, tegenrekening_iban: iban });
const income = (id: string, description: string, amount = 121, iban?: string): RawTransaction => ({ id, type: 'income', amount_incl: amount, description, tegenrekening_iban: iban });

const rows: RawTransaction[] = [
  expense('insurance-1', 'Aansprakelijkheidsverzekering premie', 121),
  expense('insurance-2', 'Zorgverzekering premie', 160),
  expense('insurance-3', 'Beroepsaansprakelijkheidsverzekering', 242),
  expense('taxable-insurer-service', 'Verzekeraar onderhoudscontract administratie', 121),
  expense('openai-1', 'OpenAI LLC software abonnement', 121),
  expense('food-1', 'Albert Heijn Zakelijk voedingsmiddelen', 109),
  expense('ambiguous-1', 'Algemene betaling', 121),
  income('sales-21', 'Verkoop zakelijke dienstverlening 21%', 121),
  income('sales-9', 'Verkoop boek 9%', 109),
  income('sales-0', 'Export goederen buiten EU 0%', 100),
];

const report = calculateFiscalVatReport(rows);
const byId = new Map(report.transactions.map((tx) => [tx.id, tx]));

for (const id of ['insurance-1', 'insurance-2', 'insurance-3']) {
  const tx = byId.get(id) ?? assert.fail(`insurance transaction missing: ${id}`);
  assert.equal(tx.classification, 'exempt_input');
  assert.equal(tx.vat.status, 'known');
  assert.equal(tx.vat.rate, 0);
  assert.equal(tx.includedInTotals, true);
  assert.equal(tx.deductible, false);
}

const taxableInsurer = byId.get('taxable-insurer-service') ?? assert.fail('taxable insurer service missing');
assert.equal(taxableInsurer.classification, 'domestic_input_21');
assert.equal(taxableInsurer.vat.status, 'known');
assert.equal(taxableInsurer.vat.rate, 21);
assert.equal(taxableInsurer.deductible, true);

const ambiguous = byId.get('ambiguous-1') ?? assert.fail('ambiguous row missing');
assert.equal(ambiguous.classification, 'unresolved');
assert.equal(ambiguous.includedInTotals, false);
assert.equal(ambiguous.vat.status, 'unknown');

for (const id of ['sales-21', 'sales-9', 'sales-0']) {
  const tx = byId.get(id) ?? assert.fail(`income row missing: ${id}`);
  assert.equal(tx.vat.status, 'known');
  assert.equal(tx.includedInTotals, true);
}

// Contradictory explicit fiscal signals must always fail closed.
const conflictRows = [
  expense('conflict-rates', 'Kantoorbenodigdheden voeding 9% 21%'),
  expense('conflict-reverse-rate', 'OpenAI LLC software abonnement btw verlegd 21% 9%'),
  expense('conflict-exempt-taxable', 'Tandarts behandeling vrijgesteld 21%'),
  expense('conflict-zero-exempt', 'Btw-vrij 0% medische behandeling'),
];
const conflictReport = calculateFiscalVatReport(conflictRows);
for (const row of conflictRows) {
  const tx = conflictReport.transactions.find((candidate) => candidate.id === row.id) ?? assert.fail(`${row.id}: missing`);
  assert.equal(tx.classification, 'unresolved', `${row.id} must fail closed`);
  assert.equal(tx.includedInTotals, false, `${row.id} must be excluded from VAT totals`);
  assert.equal(tx.vat.status, 'unknown', `${row.id} must not fabricate VAT`);
}

// Context collisions must not be resolved by whichever regex happens to run first.
const contextCollisionReport = calculateFiscalVatReport([
  expense('collision-path-office', 'Pathé kantoorbenodigdheden'),
  expense('collision-cafe-office', 'Café De Hoek kantoorbenodigdheden'),
  expense('collision-foreign-office', 'OpenAI LLC software abonnement kantoorbenodigdheden'),
  expense('collision-food-office', 'Albert Heijn Zakelijk voedingsmiddelen laptop'),
]);
for (const id of ['collision-path-office', 'collision-cafe-office', 'collision-foreign-office', 'collision-food-office']) {
  const tx = contextCollisionReport.transactions.find((candidate) => candidate.id === id) ?? assert.fail(`${id}: missing`);
  assert.equal(tx.classification, 'unresolved', `${id} must stay unresolved when context conflicts`);
}

// Merchant-only foreign recognition is intentionally blocked: supplier identity alone
// is not enough to prove a taxable cross-border software service.
const supplierBoundaryReport = calculateFiscalVatReport([
  expense('foreign-name-only', 'OpenAI LLC'),
  expense('foreign-name-goods', 'OpenAI LLC hardware aankoop'),
  expense('eu-name-only', 'Adobe Systems Software'),
  expense('eu-software', 'Adobe Systems Software software licentie'),
]);
assert.equal(supplierBoundaryReport.transactions.find((tx) => tx.id === 'foreign-name-only')?.classification, 'unresolved');
assert.equal(supplierBoundaryReport.transactions.find((tx) => tx.id === 'foreign-name-goods')?.classification, 'domestic_input_21');
assert.equal(supplierBoundaryReport.transactions.find((tx) => tx.id === 'eu-name-only')?.classification, 'unresolved');
assert.equal(supplierBoundaryReport.transactions.find((tx) => tx.id === 'eu-software')?.classification, 'eu_reverse_charge');

// Customer-supplied calculated VAT must not influence the fiscal result.
const fakeCustomerColumns = [
  'Datum;Naam / Omschrijving;Tegenrekening;Af Bij;Bedrag;BTW;BTW-percentage;Mededelingen',
  '2026-01-01;Kantoorbenodigdheden;NL00TEST;Af;121,00;999,99;99%;klantwaarde mag niet worden gebruikt',
  '2026-01-02;Algemene betaling;NL00TEST;Af;121,00;0,01;0%;geen fiscale context',
];
const parsedFakeColumns = parseCsvToRawTransactions(fakeCustomerColumns.join('\n'));
const fakeColumnsReport = calculateFiscalVatReport(parsedFakeColumns);
const firstFake = fakeColumnsReport.transactions.find((tx) => tx.description?.includes('Kantoorbenodigdheden')) ?? assert.fail('fake-column transaction missing');
assert.equal(firstFake.classification, 'domestic_input_21');
assert.notEqual(firstFake.vat.status === 'known' ? firstFake.vat.amount : null, 999.99);
const secondFake = fakeColumnsReport.transactions.find((tx) => tx.description?.includes('Algemene betaling')) ?? assert.fail('ambiguous fake-column row missing');
assert.equal(secondFake.classification, 'unresolved');

// 25,000 physical rows with summaries interspersed. This mixes known, ambiguous,
// domestic, EU and insurance contexts instead of repeating one identical row.
const lines = ['Datum;Naam / Omschrijving;Tegenrekening;Af Bij;Bedrag;Mededelingen'];
for (let i = 0; i < 25000; i += 1) {
  const day = String((i % 28) + 1).padStart(2, '0');
  const month = String((i % 12) + 1).padStart(2, '0');
  const variant = i % 8;
  const description = [
    'Aansprakelijkheidsverzekering premie',
    'OpenAI LLC software abonnement',
    'PostNL Pakketten',
    'Albert Heijn Zakelijk voedingsmiddelen',
    'Kantoorbenodigdheden',
    'Adobe Systems Software software licentie',
    'Algemene betaling',
    'Café De Hoek',
  ][variant];
  const amount = i % 2 === 0 ? '121,00' : '109,00';
  const iban = variant === 1 || variant === 5 ? 'IE00TEST' : 'NL00TEST';
  const memo = variant === 7 ? 'horeca zonder specifieke factuurinformatie' : 'zakelijke betaling';
  lines.push(`2026-${month}-${day};${description};${iban};Af;${amount};${memo}`);
  if (i === 4999 || i === 14999 || i === 22499) {
    lines.push(`2026-${month}-${day};TOTAAL UITGAVEN;;Af;999999,99;samenvatting`);
  }
}

const started = Date.now();
const parsed = parseCsvToRawTransactions(lines.join('\n'));
const largeReport = calculateFiscalVatReport(parsed);
const elapsed = Date.now() - started;

assert.equal(parsed.length, 25003, `expected 25,000 bank rows + 3 summaries to be parsed, got ${parsed.length}`);
assert.equal(largeReport.transactions.length, 25000, 'summary rows must not become fiscal transactions');
assert.ok(!largeReport.transactions.some((tx) => /totaal uitgaven/i.test(String(tx.description ?? ''))));
assert.equal(largeReport.audit.unresolved, 6250);
assert.equal(largeReport.transactions.filter((tx) => tx.includedInTotals).length, 18750);
assert.equal(largeReport.audit.problems.length, 1);
assert.match(largeReport.audit.problems[0], /vereisen boekhoudkundige beoordeling/);
assert.ok(elapsed < 15000, `25,000-row parse/classification regression took ${elapsed} ms`);

const counts = {
  insurance: largeReport.transactions.filter((tx) => tx.classification === 'exempt_input').length,
  reverse: largeReport.transactions.filter((tx) => tx.classification === 'eu_reverse_charge').length,
  nine: largeReport.transactions.filter((tx) => tx.classification === 'domestic_input_9').length,
  twentyOne: largeReport.transactions.filter((tx) => tx.classification === 'domestic_input_21').length,
  unresolved: largeReport.transactions.filter((tx) => tx.classification === 'unresolved').length,
};
assert.deepEqual(counts, { insurance: 3125, reverse: 3125, nine: 3125, twentyOne: 6250, unresolved: 6250 });
assert.equal(tweeKolommenWeergave(largeReport).twijfelgevallen.length, 6250);
assert.equal(largeReport.aangifte['5b'], largeReport.overzicht.input.total);
assert.equal(largeReport.aangifte['5a'], largeReport.overzicht.output.total);

// Duplicate IDs are rejected rather than silently merging fiscal facts.
const duplicateIdRows = [expense('dup', 'Kantoorbenodigdheden'), expense('dup', 'Kantoorbenodigdheden')];
assert.throws(() => calculateFiscalVatReport(duplicateIdRows), /duplicate|dubbel|id/i);

console.log(`OK: deep VAT regression, conflict gating, supplier-boundary checks, customer-column isolation and 25,000-row physical CSV (${elapsed} ms).`);
