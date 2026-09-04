import { parseCsvToRawTransactions } from '../../utils/vatCsvParser';
import { calculateFiscalVatReport } from '../btwFiscalSafeNormalized';

const fail = (message: string): never => {
  throw new Error(message);
};

const expect = (condition: unknown, message: string) => {
  if (!condition) fail(message);
};

const baseRows = [
  { id: 'insurance-1', date: '2026-01-05', description: 'Aansprakelijkheidsverzekering premie', memo: '', type: 'expense' as const, amount_incl_input: 121, rawAmount: 121 },
  { id: 'insurance-2', date: '2026-02-05', description: 'Zorgverzekering premie', memo: '', type: 'expense' as const, amount_incl_input: 160, rawAmount: 160 },
  { id: 'insurance-3', date: '2026-03-05', description: 'Beroepsaansprakelijkheidsverzekering', memo: 'premie maart', type: 'expense' as const, amount_incl_input: 242, rawAmount: 242 },
  { id: 'taxable-insurer-service', date: '2026-04-05', description: 'Verzekeraar onderhoudscontract administratie', memo: '', type: 'expense' as const, amount_incl_input: 121, rawAmount: 121 },
  { id: 'openai-1', date: '2026-05-05', description: 'OpenAI LLC', memo: 'zakelijke software', type: 'expense' as const, amount_incl_input: 121, rawAmount: 121 },
  { id: 'food-1', date: '2026-06-05', description: 'Albert Heijn Zakelijk voedingsmiddelen', memo: '', type: 'expense' as const, amount_incl_input: 109, rawAmount: 109 },
  { id: 'ambiguous-1', date: '2026-07-05', description: 'Algemene betaling', memo: '', type: 'expense' as const, amount_incl_input: 121, rawAmount: 121 },
];

const report = calculateFiscalVatReport(baseRows);
const byId = new Map(report.transactions.map((tx) => [tx.id, tx]));

for (const id of ['insurance-1', 'insurance-2', 'insurance-3']) {
  const tx = byId.get(id) ?? fail(`insurance transaction missing: ${id}`);
  expect(tx.classification === 'exempt_input', `${id} must be exempt_input, got ${tx.classification}`);
  expect(tx.rate === 0, `${id} must have 0% rate`);
  expect(tx.includedInTotals === true, `${id} must remain represented in totals/audit`);
  expect(tx.deductible === false, `${id} must not be deductible input VAT`);
}

const taxableInsurer = byId.get('taxable-insurer-service') ?? fail('taxable insurer service missing');
expect(taxableInsurer.classification === 'domestic_input_21', `maintenance service must stay taxable, got ${taxableInsurer.classification}`);
expect(taxableInsurer.rate === 21, 'maintenance service must be 21%');

const ambiguous = byId.get('ambiguous-1') ?? fail('ambiguous row missing');
expect(ambiguous.classification === 'unresolved', `ambiguous row must stay unresolved, got ${ambiguous.classification}`);
expect(ambiguous.includedInTotals === false, 'ambiguous row must be excluded from VAT totals');

expect(report.audit.unresolved === 1, `expected exactly 1 unresolved transaction, got ${report.audit.unresolved}`);

// Large physical bank-file regression: summary rows are mixed into 8,000 real transactions.
const lines = [
  'Datum;Naam / Omschrijving;Tegenrekening;Af Bij;Bedrag;Mededelingen',
];
for (let i = 0; i < 8000; i += 1) {
  const day = String((i % 28) + 1).padStart(2, '0');
  const month = String((i % 12) + 1).padStart(2, '0');
  const description = [
    'Aansprakelijkheidsverzekering premie',
    'OpenAI LLC',
    'PostNL Pakketten',
    'Albert Heijn Zakelijk voedingsmiddelen',
    'Kantoorbenodigdheden',
    'Beroepsaansprakelijkheidsverzekering',
  ][i % 6];
  lines.push(`2026-${month}-${day};${description};NL00TEST;Af;121,00;zakelijke betaling`);
  if (i === 1999 || i === 4999) {
    lines.push(`2026-${month}-${day};TOTAAL UITGAVEN;;Af;999999,99;samenvatting`);
  }
}

const started = Date.now();
const parsed = parseCsvToRawTransactions(lines.join('\n'));
const largeReport = calculateFiscalVatReport(parsed);
const elapsed = Date.now() - started;

expect(parsed.length === 8002, `expected 8,002 parsed rows including summary rows, got ${parsed.length}`);
expect(largeReport.transactions.length === 8002, `expected 8,002 report rows, got ${largeReport.transactions.length}`);
expect(largeReport.audit.unresolved === 0, `large known-context file must have 0 unresolved rows, got ${largeReport.audit.unresolved}`);
expect(largeReport.audit.problems.length === 0, `large known-context file has audit problems: ${largeReport.audit.problems.join('; ')}`);
expect(elapsed < 15000, `8,000-row parse/classification regression took ${elapsed} ms`);

const exemptCount = largeReport.transactions.filter((tx) => tx.classification === 'exempt_input').length;
const reverseChargeCount = largeReport.transactions.filter((tx) => tx.classification === 'non_eu_reverse_charge').length;
const ninePercentCount = largeReport.transactions.filter((tx) => tx.classification === 'domestic_input_9').length;
const twentyOneCount = largeReport.transactions.filter((tx) => tx.classification === 'domestic_input_21').length;
expect(exemptCount === 2668, `expected 2,668 exempt insurance rows, got ${exemptCount}`);
expect(reverseChargeCount === 1334, `expected 1,334 reverse-charge software rows, got ${reverseChargeCount}`);
expect(ninePercentCount === 1334, `expected 1,334 9% rows, got ${ninePercentCount}`);
expect(twentyOneCount === 2666, `expected 2,666 domestic 21% rows, got ${twentyOneCount}`);

console.log(`OK: deep VAT regression; insurance exemption boundary + taxable insurer service + 8,000-row physical CSV (${elapsed} ms).`);
