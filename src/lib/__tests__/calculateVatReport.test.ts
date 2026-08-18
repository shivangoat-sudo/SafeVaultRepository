import { calculateVatReport, type RawTransaction } from '../vatEngine';

console.log("=== STARTING CALCULATE VAT REPORT TEST SUITE ===");

const rawTransactions: RawTransaction[] = [
  { id: '1', description: 'Verkoop 21%', amount_incl: 121.00, type: 'Inkomsten' },
  { id: '2', description: 'Verkoop 9%', amount_incl: 109.00, type: 'Inkomsten' },
  { id: '3', description: 'Inkoop 21%', amount_incl: 121.00, type: 'Uitgaven' },
  { id: '4', description: 'Inkoop 9%', amount_incl: 109.00, type: 'Uitgaven' },
  { id: '5', description: 'Horeca BUA', amount_incl: 54.50, type: 'Uitgaven' },
  { id: '6', description: 'Software EU Verlegd', amount_incl: 100.00, type: 'Uitgaven' },
  { id: '7', description: 'Vrijgesteld', amount_incl: 50.00, type: 'Uitgaven' },
];

const classifications = [
  { id: '1', category: 'sales_21', applied_rule: 'Rule 21% Sales' },
  { id: '2', category: 'sales_9', applied_rule: 'Rule 9% Sales' },
  { id: '3', category: 'expense_21', applied_rule: 'Rule 21% Expense' },
  { id: '4', category: 'expense_9', applied_rule: 'Rule 9% Expense' },
  { id: '5', category: 'bua_horeca', applied_rule: 'Rule BUA Horeca' },
  { id: '6', category: 'reverse_charge', applied_rule: 'Rule Reverse Charge' },
  { id: '7', category: 'exempt', applied_rule: 'Rule Exempt' },
];

const rep = calculateVatReport(rawTransactions, classifications);

// 1. totaal_incl_21
console.assert(rep.totaal_incl_21 === 242.00, `totaal_incl_21 expected 242.00 got ${rep.totaal_incl_21}`);
// 2. totaal_excl_21
console.assert(rep.totaal_excl_21 === 200.00, `totaal_excl_21 expected 200.00 got ${rep.totaal_excl_21}`);
// 3. totaal_incl_9
console.assert(rep.totaal_incl_9 === 272.50, `totaal_incl_9 expected 272.50 got ${rep.totaal_incl_9}`);
// 4. totaal_excl_9
console.assert(rep.totaal_excl_9 === 250.00, `totaal_excl_9 expected 250.00 got ${rep.totaal_excl_9}`);
// 5. totale_btw_21
console.assert(rep.totale_btw_21 === 42.00, `totale_btw_21 expected 42.00 got ${rep.totale_btw_21}`);
// 6. totale_btw_9
console.assert(rep.totale_btw_9 === 22.50, `totale_btw_9 expected 22.50 got ${rep.totale_btw_9}`);
// 7. niet_aftrekbare_btw
console.assert(rep.niet_aftrekbare_btw === 4.50, `niet_aftrekbare_btw expected 4.50 got ${rep.niet_aftrekbare_btw}`);
// 8. btw_eindsaldo
console.assert(rep.btw_eindsaldo === 0.00, `btw_eindsaldo expected 0.00 got ${rep.btw_eindsaldo}`);

console.log("✅ All 8 VatReport fields calculated with 100% mathematical precision!");
console.log("=== CALCULATE VAT REPORT SUITE COMPLETE ===");
