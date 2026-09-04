import assert from 'node:assert/strict';
import { BTW_RULE_REGISTRY, getBtwRule } from '../btwRuleRegistry';

const requiredRules = [
  'NL_GENERAL_21',
  'NL_TABLE_I_9',
  'NL_ZERO_RATE',
  'NL_EXEMPT',
  'NL_DOMESTIC_REVERSE_CHARGE',
  'NL_EU_ACQUISITION',
  'NL_EU_SERVICE_REVERSE_CHARGE',
  'NL_NON_EU_SERVICE_REVERSE_CHARGE',
  'INPUT_VAT_BUSINESS_USE',
  'INPUT_VAT_EXEMPT_USE_BLOCKED',
  'INPUT_VAT_PRIVATE_USE_BLOCKED',
  'INPUT_VAT_HOSPITALITY_BLOCKED',
  'LOGIES_2026_21',
  'ALCOHOL_21',
  'FOOD_9',
  'PERSONAL_TRANSPORT_9',
  'CULTURE_SPORT_9',
  'DESIGNATED_REPAIR_9',
  'FLOWER_HORTICULTURE_9',
  'MEDICINES_AIDS_9',
  'BOOKS_PERIODICALS_9',
  'WATER_9',
  'HOUSING_WORK_9',
] as const;

assert.equal(new Set(BTW_RULE_REGISTRY.map(rule => rule.id)).size, BTW_RULE_REGISTRY.length, 'Regel-ID’s moeten uniek zijn.');
for (const id of requiredRules) {
  const rule = getBtwRule(id);
  assert.ok(rule.title.length > 0, `${id}: title ontbreekt`);
  assert.ok(rule.result.length > 0, `${id}: result ontbreekt`);
  assert.ok(rule.legalBasis.length > 0, `${id}: legalBasis ontbreekt`);
  assert.ok(rule.requires.length > 0, `${id}: kennisvoorwaarden ontbreken`);
  assert.ok(rule.notes.length > 0, `${id}: rule notes ontbreken`);
}

const logies = getBtwRule('LOGIES_2026_21');
assert.equal(logies.effectiveFrom, '2026-01-01');
assert.equal(logies.result, '21%');
assert.match(logies.legalBasis, /Btw-tarief logies/i);

const inputVat = getBtwRule('INPUT_VAT_BUSINESS_USE');
assert.ok(inputVat.requires.includes('business_use'));
assert.ok(inputVat.requires.includes('invoice_or_equivalent_evidence'));

const reverseCharge = getBtwRule('NL_NON_EU_SERVICE_REVERSE_CHARGE');
assert.ok(reverseCharge.requires.includes('place_of_supply'));
assert.ok(reverseCharge.requires.includes('supplier_or_customer_status'));

console.log('OK: declarative Dutch VAT rule registry contains the required fiscal rules, legal bases, conditions and 2026 logies change.');
