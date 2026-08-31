import { calculateFiscalVatReport } from '../src/lib/btwFiscalSafe';
import type { RawTransaction } from '../src/lib/btwEngineSafe';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`BTW fiscal conformance FAILED: ${message}`);
}
function eq(actual: number, expected: number, label: string) {
  assert(Math.abs(actual - expected) < 0.001, `${label}: expected ${expected}, got ${actual}`);
}

const base = (id: string, description: string, amount_incl: number, type: 'income'|'expense', extra: Partial<RawTransaction> = {}): RawTransaction => ({ id, description, amount_incl, type, ...extra });

// Reference cases: amounts are explicit gross amounts for ordinary domestic VAT,
// and explicit tax bases for reverse-charge transactions.
const rows: RawTransaction[] = [
  base('sale21', 'Verkoop 21%', 121, 'income'),
  base('sale9', 'Verkoop 9%', 109, 'income'),
  base('zero', 'Export goederen 0%', 1000, 'income'),
  base('exempt', 'Vrijgestelde prestatie', 1000, 'income'),
  base('domestic-rc', 'Btw verlegd onderaanneming', 100, 'expense', { tegenrekening_iban: 'NL00TEST0000000001' }),
  base('eu-rc', 'Btw verlegd EU dienst', 100, 'expense', { tegenrekening_iban: 'DE00TEST0000000001' }),
  base('non-eu-rc', 'Btw verlegd buitenlandse dienst', 100, 'expense', { tegenrekening_iban: 'US00TEST0000000001' }),
  base('horeca', 'Restaurant diner', 109, 'expense'),
  base('unknown', 'Onbekende bankbetaling', 121, 'expense'),
  base('summary', 'TOTAAL', 99999, 'income'),
];

const report = calculateFiscalVatReport(rows);
const tx = (id: string) => report.transactions.find(x => x.id === id);

assert(!tx('summary'), 'summary row must not become a fiscal transaction');
assert(tx('unknown')?.classification === 'unresolved', 'unknown transaction must remain unresolved');
assert(tx('zero')?.classification === 'zero_rated_output', 'explicit 0% output must be distinct from exempt output');
assert(tx('exempt')?.classification === 'exempt_output', 'explicit exempt output must be distinct from 0%');

const sale21 = tx('sale21');
assert(sale21?.vat.status === 'known', '21% sale VAT must be known');
eq(sale21!.vat.status === 'known' ? sale21!.vat.amount : -1, 21, '21% sale VAT');
eq(sale21!.amount_excl ?? -1, 100, '21% sale base');
assert(sale21?.section === '1a', '21% domestic output must map to 1a');

const sale9 = tx('sale9');
assert(sale9?.vat.status === 'known', '9% sale VAT must be known');
eq(sale9!.vat.status === 'known' ? sale9!.vat.amount : -1, 9, '9% sale VAT');
eq(sale9!.amount_excl ?? -1, 100, '9% sale base');
assert(sale9?.section === '1b', '9% domestic output must map to 1b');

const domesticRc = tx('domestic-rc');
assert(domesticRc?.classification === 'domestic_reverse_charge', 'domestic reverse charge must be distinct');
eq(domesticRc?.vat.status === 'known' ? domesticRc.vat.amount : -1, 21, 'domestic reverse-charge VAT');
assert(domesticRc?.section === '2a', 'domestic reverse charge must map to 2a');

const euRc = tx('eu-rc');
assert(euRc?.classification === 'eu_reverse_charge', 'EU reverse charge must be distinct');
eq(euRc?.vat.status === 'known' ? euRc.vat.amount : -1, 21, 'EU reverse-charge VAT');
assert(euRc?.section === '4b', 'EU reverse charge must map to 4b');

const nonEuRc = tx('non-eu-rc');
assert(nonEuRc?.classification === 'non_eu_reverse_charge', 'non-EU reverse charge must be distinct');
eq(nonEuRc?.vat.status === 'known' ? nonEuRc.vat.amount : -1, 21, 'non-EU reverse-charge VAT');
assert(nonEuRc?.section === '4a', 'non-EU reverse charge must map to 4a');

const horeca = tx('horeca');
assert(horeca?.classification === 'non_deductible_input', 'restaurant input must not be automatically deductible');
assert(horeca?.deductible === false, 'restaurant input must not be deductible automatically');

assert(report.audit.ok, `report audit must be OK: ${report.audit.problems.join('; ')}`);
eq(report.aangifte['1a'].grondslag, 100, '1a base');
eq(report.aangifte['1a'].btw, 21, '1a VAT');
eq(report.aangifte['1b'].grondslag, 100, '1b base');
eq(report.aangifte['1b'].btw, 9, '1b VAT');
eq(report.aangifte['2a'].grondslag, 100, '2a base');
eq(report.aangifte['2a'].btw, 21, '2a VAT');
eq(report.aangifte['4b'].grondslag, 100, '4b base');
eq(report.aangifte['4b'].btw, 21, '4b VAT');
eq(report.aangifte['4a'].grondslag, 100, '4a base');
eq(report.aangifte['4a'].btw, 21, '4a VAT');

console.log('PASS: Dutch VAT fiscal conformance suite');
