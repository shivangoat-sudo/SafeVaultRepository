import { calculateFiscalVatReport } from '../btwFiscalSafePolicy';
import type { RawTransaction } from '../btwSafeTypes';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const reportFor = (row: RawTransaction) => calculateFiscalVatReport([row]);

// Merchant context must work without the product word being present.
const gall = reportFor({ id: 'gall', description: 'GALL & GALL', amount_incl: 121, type: 'expense' });
const gallTx = gall.transactions.find(tx => tx.id === 'gall');
assert(gallTx?.btw === 21, 'GALL & GALL zonder productwoord moet via merchant-context op 21% uitkomen.');
assert(gallTx?.classification === 'domestic_input_21', 'GALL & GALL moet als binnenlandse 21%-inkoop worden geclassificeerd.');

// Known 9% merchant context must not be overridden by the 21% residual.
const ns = reportFor({ id: 'ns', description: 'NS', amount_incl: 109, type: 'expense' });
const nsTx = ns.transactions.find(tx => tx.id === 'ns');
assert(nsTx?.btw === 9, 'NS moet als 9% personenvervoer worden herkend.');
assert(nsTx?.classification === 'domestic_input_9', 'NS moet als binnenlandse 9%-inkoop worden geclassificeerd.');

// The requested bank-line policy resolves simultaneous 9% + 21% signals to 21%.
const mixed = reportFor({ id: 'mixed', description: 'koffie laptop', amount_incl: 121, type: 'expense' });
const mixedTx = mixed.transactions.find(tx => tx.id === 'mixed');
assert(mixedTx?.btw === 21, 'Bij gelijktijdige 9%- en 21%-signalen moet de bankregel volgens projectbeleid op 21% uitkomen.');

// Safety invariant: a generic bank line must fail closed rather than invent VAT.
const unknown = reportFor({ id: 'unknown', description: 'Onbekende klantbetaling', amount_incl: 121, type: 'income' });
const unknownTx = unknown.transactions.find(tx => tx.id === 'unknown');
assert(unknownTx?.classification === 'unresolved', 'Onvoldoende specifieke bankomschrijving mag niet stilzwijgend als 21% worden berekend.');
assert(unknownTx?.btw == null, 'Een unresolved transactie mag geen verzonnen btw-percentage bevatten.');
assert(unknown.aangifte['5a'] === 0, 'Een unresolved transactie mag niet in verschuldigde btw worden opgenomen.');

console.log('OK: merchant context, mixed-signal policy and fail-closed VAT invariants verified.');
