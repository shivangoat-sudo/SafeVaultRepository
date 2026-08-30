/**
 * ============================================================================
 * VALIDATIESUITE — BTW-ENGINE (btwEngine.ts)
 * ============================================================================
 * Voert testdataset 1 t/m 8 uit zoals gespecificeerd, plus dubbele-
 * transactiedetectie en samenvattingsregel-filtering. Draai met:
 *   npx tsx btwEngine.validatie.ts
 * ============================================================================
 */
import {
  calculateVatReport,
  RawTransaction,
  berekenBetrouwbaarheidsscore,
  autoClassify,
  genereerStabielTransactieId,
} from './btwEngine';

let totaalTests = 0;
let geslaagd = 0;

function assertBijna(omschrijving: string, actueel: number, verwacht: number, tolerantieCent = 0) {
  totaalTests++;
  const verschilCent = Math.round(Math.abs(actueel - verwacht) * 100);
  const ok = verschilCent <= tolerantieCent;
  if (ok) {
    geslaagd++;
    console.log(`  OK  ${omschrijving}: EUR ${actueel.toFixed(2)} (verwacht EUR ${verwacht.toFixed(2)})`);
  } else {
    console.log(`  FOUT ${omschrijving}: EUR ${actueel.toFixed(2)} -- VERWACHT EUR ${verwacht.toFixed(2)} -- verschil ${verschilCent} cent`);
  }
}

function assertWaar(omschrijving: string, waarde: boolean) {
  totaalTests++;
  if (waarde) {
    geslaagd++;
    console.log(`  OK  ${omschrijving}`);
  } else {
    console.log(`  FOUT ${omschrijving}`);
  }
}

function round2Test(n: number): number {
  return Math.round(n * 100) / 100;
}

// ----------------------------------------------------------------------------
// TESTDATASET 1 -- BASIS 21%
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 1 -- BASIS 21% ===');
{
  const tx: RawTransaction[] = [
    { id: '1', date: '2026-04-01', type: 'income', amount_incl: 1210.0, description: 'Verkoop website' },
    { id: '2', date: '2026-04-02', type: 'income', amount_incl: 2420.0, description: 'Verkoop software' },
  ];
  const r = calculateVatReport(tx);
  assertBijna('Incl 21%', r.totaal_incl_21, 3630.0);
  assertBijna('Excl 21%', r.totaal_excl_21, 3000.0);
  assertBijna('BTW 21%', r.totale_btw_21, 630.0);
  assertBijna('Controle: incl - excl - btw = 0', r.totaal_incl_21 - r.totaal_excl_21 - r.totale_btw_21, 0);
  assertWaar('Audit ok', r.audit.ok);
}

// ----------------------------------------------------------------------------
// TESTDATASET 2 -- BASIS 9%
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 2 -- BASIS 9% ===');
{
  const tx: RawTransaction[] = [
    { id: '1', date: '2026-04-03', type: 'income', amount_incl: 109.0, description: 'Boeken' },
    { id: '2', date: '2026-04-04', type: 'income', amount_incl: 218.0, description: 'Tijdschrift' },
  ];
  const r = calculateVatReport(tx);
  assertBijna('Incl 9%', r.totaal_incl_9, 327.0);
  assertBijna('Excl 9%', r.totaal_excl_9, 300.0);
  assertBijna('BTW 9%', r.totale_btw_9, 27.0);
  assertBijna('Controle: incl - excl - btw = 0', r.totaal_incl_9 - r.totaal_excl_9 - r.totale_btw_9, 0);
  assertWaar('Audit ok', r.audit.ok);
}

// ----------------------------------------------------------------------------
// TESTDATASET 3 -- GEMENGD
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 3 -- GEMENGD ===');
{
  const tx: RawTransaction[] = [
    { id: '1', date: '2026-04-05', type: 'income', amount_incl: 1210.0, description: 'Verkoop 21%' },
    { id: '2', date: '2026-04-05', type: 'income', amount_incl: 109.0, description: 'Verkoop 9%' },
    { id: '3', date: '2026-04-05', type: 'expense', amount_incl: 121.0, description: 'Softwarekosten' },
    { id: '4', date: '2026-04-05', type: 'expense', amount_incl: 60.5, description: 'Zakelijke lunch overleg klant' },
  ];
  const r = calculateVatReport(tx);
  assertBijna('BTW 21 verkoop', r.breakdown.verschuldigde_btw_omzet_21, 210.0);
  assertBijna('BTW 9 verkoop', r.breakdown.verschuldigde_btw_omzet_9, 9.0);
  assertBijna('Voorbelasting software', r.breakdown.aftrekbare_btw_kosten_21, 21.0);
  const lunch = r.transactions.find((t) => t.description?.includes('lunch'));
  assertBijna('Lunch: BTW-bedrag (60,50 x 9/109, horecatarief)', lunch?.btw_bedrag ?? -1, 5.0);
  assertBijna('Lunch: niet-aftrekbaar (BUA, 100%)', r.niet_aftrekbare_btw, 5.0);
  const verwacht_correct = 210.0 + 9.0 - 21.0;
  assertBijna('Eindsaldo (fiscaal correct, 100% BUA)', r.btw_eindsaldo, verwacht_correct);
  assertWaar('Audit ok', r.audit.ok);
}

// ----------------------------------------------------------------------------
// TESTDATASET 4 -- TOTAALREGELS WORDEN GENEGEERD
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 4 -- TOTAALREGELS ===');
{
  const tx: RawTransaction[] = [
    { id: '1', date: '2026-04-06', type: 'income', amount_incl: 1210.0, description: 'Verkoop' },
    { id: '2', date: '2026-04-07', type: 'income', amount_incl: 2420.0, description: 'Verkoop' },
    { id: '3', date: '2026-04-08', type: 'income', amount_incl: 3630.0, description: 'TOTAAL' },
  ];
  const r = calculateVatReport(tx);
  assertWaar('Totaalregel herkend en genegeerd', r.genegeerde_samenvattingsregels.length === 1);
  assertWaar('Precies 2 transacties meegeteld', r.transactions.length === 2);
  assertBijna('BTW = 630 (niet 1260, dus totaalregel niet dubbel meegeteld)', r.totale_btw_21, 630.0);
}

// ----------------------------------------------------------------------------
// TESTDATASET 5 -- EXCEL-SUM-FORMULES
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 5 -- SUM-FORMULES ===');
{
  const tx: RawTransaction[] = [
    { id: '1', date: '2026-04-09', type: 'expense', amount_incl: 40.0, description: 'Kosten A' },
    { id: '2', date: '2026-04-09', type: 'expense', amount_incl: 30.0, description: 'Kosten B' },
    { id: '3', date: '2026-04-09', type: 'expense', amount_incl: 20.0, description: 'Kosten C' },
    { id: '4', date: '2026-04-09', type: 'expense', amount_incl: 90.0, description: 'Som van A1+A2+A3' },
  ];
  const r = calculateVatReport(tx);
  assertWaar('SUM-uitkomstregel structureel herkend als samenvatting', r.genegeerde_samenvattingsregels.length === 1);
}

// ----------------------------------------------------------------------------
// TESTDATASET 6 -- DUBBELE TRANSACTIES: SIGNALEREN, NIET AUTOMATISCH SAMENVOEGEN
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 6 -- DUBBELE TRANSACTIES ===');
{
  const tx: RawTransaction[] = [
    { id: '1', date: '2026-04-10', type: 'expense', amount_incl: 121.0, description: 'Leverancier Z' },
    { id: '2', date: '2026-04-10', type: 'expense', amount_incl: 121.0, description: 'Leverancier Z' },
  ];
  const r = calculateVatReport(tx);
  assertWaar('Mogelijke dubbele transactie gesignaleerd', r.mogelijke_dubbele_transacties.length === 1);
  assertWaar('Beide transacties blijven meegeteld (niet automatisch samengevoegd)', r.transactions.length === 2);
}

// ----------------------------------------------------------------------------
// TESTDATASET 7 -- 5.000 TRANSACTIES
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 7 -- 5.000 TRANSACTIES ===');
{
  const tx: RawTransaction[] = [];
  let exacteBtw21 = 0;
  let exacteBtw9 = 0;
  let exacteNietAftrekbaar = 0;
  let id = 0;

  for (let i = 0; i < 3000; i++) {
    const bedrag = round2Test(15 + (i % 970));
    tx.push({ id: `${id++}`, type: i % 2 === 0 ? 'income' : 'expense', amount_incl: bedrag, description: `Algemene post 21% #${i}` });
    const excl = bedrag / 1.21;
    exacteBtw21 += bedrag - excl;
  }
  const classifications: Record<string, any> = {};
  for (let i = 0; i < 1000; i++) {
    const bedrag = round2Test(10 + (i % 490));
    const txId = `${id++}`;
    tx.push({ id: txId, type: 'expense', amount_incl: bedrag, description: `Verlaagd-tarief post #${i}` });
    classifications[txId] = 'kosten_verlaagd_9';
    const excl = bedrag / 1.09;
    exacteBtw9 += bedrag - excl;
  }
  for (let i = 0; i < 500; i++) {
    const bedrag = round2Test(20 + (i % 200));
    const txId = `${id++}`;
    tx.push({ id: txId, type: 'income', amount_incl: bedrag, description: `Vrijgestelde omzet #${i}` });
    classifications[txId] = 'omzet_vrijgesteld_0';
  }
  for (let i = 0; i < 500; i++) {
    const bedrag = round2Test(25 + (i % 150));
    const txId = `${id++}`;
    tx.push({ id: txId, type: 'expense', amount_incl: bedrag, description: `Horeca consumptie #${i}` });
    classifications[txId] = 'horeca_bua_9';
    const excl = bedrag / 1.09;
    exacteNietAftrekbaar += bedrag - excl;
    exacteBtw9 += bedrag - excl;
  }

  console.time('  tijd 5.000 transacties');
  const r = calculateVatReport(tx, { classifications });
  console.timeEnd('  tijd 5.000 transacties');

  assertWaar('Alle 5.000 transacties verwerkt', r.transactions.length === 5000);
  assertBijna('BTW 21% t.o.v. exacte (ongeronde) som', r.totale_btw_21, exacteBtw21, 1);
  assertBijna('BTW 9% t.o.v. exacte (ongeronde) som', r.totale_btw_9, exacteBtw9, 1);
  assertBijna('Niet-aftrekbare BTW t.o.v. exacte (ongeronde) som', r.niet_aftrekbare_btw, exacteNietAftrekbaar, 1);
  assertWaar('Audit ok bij 5.000 transacties', r.audit.ok);
}

// ----------------------------------------------------------------------------
// TESTDATASET 8 -- 10.000 TRANSACTIES
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 8 -- 10.000 TRANSACTIES ===');
{
  const tx: RawTransaction[] = [];
  let exacteTotaalBtw = 0;
  for (let i = 0; i < 10000; i++) {
    const bedrag = round2Test(5 + ((i * 37) % 4995));
    const is9 = i % 4 === 0;
    const rate = is9 ? 9 : 21;
    tx.push({
      id: `${i}`,
      type: i % 3 === 0 ? 'income' : 'expense',
      amount_incl: bedrag,
      description: is9 ? 'Boeken en publicaties' : `Zakelijke post #${i}`,
    });
    const excl = bedrag / (1 + rate / 100);
    exacteTotaalBtw += bedrag - excl;
  }
  console.time('  tijd 10.000 transacties');
  const r = calculateVatReport(tx);
  console.timeEnd('  tijd 10.000 transacties');

  const berekendeTotaalBtw = r.totale_btw_21 + r.totale_btw_9;
  assertWaar('Alle 10.000 transacties verwerkt', r.transactions.length === 10000);
  assertBijna('Totale BTW (21%+9%) t.o.v. exacte som -- doel: <= EUR 0,06', berekendeTotaalBtw, exacteTotaalBtw, 6);
  assertWaar('Audit ok bij 10.000 transacties', r.audit.ok);
}

// ----------------------------------------------------------------------------
// TESTDATASET 9 -- REGRESSIETESTS VOOR GEVONDEN BUGS
// ----------------------------------------------------------------------------
console.log('\n=== TESTDATASET 9 -- REGRESSIETESTS BUGJACHT ===');
{
  const expenseBoeken = autoClassify('Boekhandel De Lezer', 'expense', 'Factuur boeken 21%');
  const incomeBoeken = autoClassify('Boekhandel De Lezer', 'income', 'Verkoop boeken 21%');
  assertWaar(
    'Wettelijk vaststaand tarief (boeken) wint van tegenstrijdig percentage-signaal',
    expenseBoeken.classification === 'kosten_verlaagd_9' && incomeBoeken.classification === 'omzet_verlaagd_9'
  );

  const korting = autoClassify('Bol.com Zakelijk', 'expense', 'Factuur met 21% korting op bureaustoel');
  assertWaar('Percentage bij "korting" wordt NIET als BTW-tarief gelezen', korting.classification !== 'kosten_algemeen_21' || !korting.herkenningsbron.includes('Expliciet BTW-percentage'));

  const rente = autoClassify('Spaarrekening ING', 'income', 'Rentevergoeding 9% per jaar');
  assertWaar('"Rentevergoeding 9%" wordt NIET als 9%-omzet geclassificeerd', rente.classification !== 'omzet_verlaagd_9');

  const ids = new Set<string>();
  let botsingen = 0;
  for (let i = 0; i < 2000; i++) {
    const id = genereerStabielTransactieId({
      date: `2026-0${(i % 9) + 1}-${(i % 28) + 1}`,
      description: `Transactie ${i} leverancier ${i % 300}`,
      amount_incl: round2Test(10 + i * 0.37),
    });
    if (ids.has(id)) botsingen++;
    ids.add(id);
  }
  assertWaar('Geen ID-botsingen bij 2.000 verschillende transacties', botsingen === 0);
}

console.log('\n=== VALIDATIESCORE ===');
const percentage = totaalTests === 0 ? 0 : (geslaagd / totaalTests) * 100;
console.log(`${geslaagd} / ${totaalTests} testchecks geslaagd (${percentage.toFixed(2)}%)`);
if (percentage === 100) {
  console.log('BTW-betrouwbaarheid: 100,00%');
} else {
  console.log(`BTW-betrouwbaarheid: ${percentage.toFixed(2)}% -- controleer de FOUT-regels hierboven.`);
  process.exitCode = 1;
}
