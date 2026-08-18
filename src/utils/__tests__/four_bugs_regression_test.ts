import { processCSVForVAT, classifyVatTransaction } from "../vatCalculator.js";

async function runFourBugsRegressionTests() {
  console.log("=== STARTING FOUR BUGS PERMANENT REGRESSIETEST SUITE ===");

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, desc: string) {
    if (cond) {
      passed++;
      console.log(`[PASS] ${desc}`);
    } else {
      failed++;
      console.error(`[FAIL] ${desc}`);
    }
  }

  // ============================================================
  // BUG 1 — RUBRIEK-VERMENGING REGRESSIETEST
  // ============================================================
  console.log("\n--- BUG 1: Rubriek-vermenging (1a vs 4b vs 4a vs 5b) ---");

  const bug1CSV = 
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    // 1. Binnenlandse Omzet 21%: € 1.210,00 incl -> 210,00 BTW (Rubriek 1a)
    "20260601;Klant A B.V.;NL12RABO0123;NL99INGB0987;123;bij;1.210,00;Pin;Verkoop softwarelicentie binnenland\n" +
    // 2. Foreign Reverse-Charged Service 21%: US IBAN € 1.000,00 incl -> 173,55 BTW (Rubriek 4b)
    "20260602;AWS Cloud US;NL12RABO0123;US99INGB0987;123;af;1.000,00;Pin;Hosting and Cloud Services\n" +
    // 3. Binnenlandse Uitgave 21%: € 121,00 incl -> 21,00 BTW (Rubriek 5b voorbelasting)
    "20260603;Leverancier B B.V.;NL12RABO0123;NL99INGB0987;123;af;121,00;Pin;Aankoop kantoorbenodigdheden\n";

  try {
    const res = await processCSVForVAT(bug1CSV);
    const vat21_rubriek1a = res.results.vat21;
    const rubriek4b = res.results.rubriek4b_vat;
    const rubriek5b = res.results.rubriek5b_vat;
    const totalVatToPay = res.results.totalVatToPay;

    // Expected: 1a = 210.00 EXACT (only domestic sales)
    assert(vat21_rubriek1a === 210.00, `Rubriek 1a EXACT = € 210.00 (Daadwerkelijk: € ${vat21_rubriek1a})`);

    // Expected: 4b = 210.00 EXACT (foreign reverse charged service: 1,000.00 * 0.21 = 210.00)
    assert(rubriek4b === 210.00, `Rubriek 4b EXACT = € 210.00 (Daadwerkelijk: € ${rubriek4b})`);

    // Expected: 1a does NOT contain any VAT from 4b (210.00, not 210 + 210)
    assert(vat21_rubriek1a !== 210.00 + 210.00, "Rubriek 1a bevat GEEN verlegde BTW uit rubriek 4b");

    // Expected: 4b does NOT contain domestic sales VAT
    assert(rubriek4b === 210.00, "Rubriek 4b bevat GEEN binnenlandse omzet BTW");

    // Total verschuldigd = 1a + 4b = 210.00 + 210.00 = 420.00
    assert(totalVatToPay === 420.00, `Totaal verschuldigde BTW = € 420.00 (Daadwerkelijk: € ${totalVatToPay})`);

    // Input VAT 5b = 210.00 (verlegd) + 21.00 (binnenlands) = 231.00
    assert(rubriek5b === 231.00, `Rubriek 5b (voorbelasting) = € 231.00 (Daadwerkelijk: € ${rubriek5b})`);

    // Netto te betalen = 383.55 - 194.55 = 189.00
    assert(res.results.netVatToPayOrClaim === 189.00, `Netto BTW te betalen = € 189.00 (Daadwerkelijk: € ${res.results.netVatToPayOrClaim})`);

  } catch (err: unknown) {
    console.error("Bug 1 test crashed: ", err);
    failed++;
  }

  // ============================================================
  // BUG 2 — BUA REGRESSIETEST (TEST A & TEST B)
  // ============================================================
  console.log("\n--- BUG 2: BUA-regressie (Supermarkt vs Horeca) ---");

  // TEST A: Supermarkt met lunch & pantry artikelen -> 9%, aftrekbaar, GEEN BUA
  const testA = classifyVatTransaction("Albert Heijn Zakelijk", "NL99INGB0987", "Lunch & Pantry artikelen", false, 45.50);
  assert(testA.rate === 9, "Test A (Albert Heijn): BTW tarief is 9%");
  assert(testA.isBuaHoreca === false, "Test A (Albert Heijn): isBuaHoreca is FALSE (aftrekbaar)");
  assert(testA.category === 'E', "Test A (Albert Heijn): Categorie is E");

  // TEST B: Grand Café met horeca-consumptie -> 9%, BUA, niet-aftrekbaar
  const testB = classifyVatTransaction("Grand Café De Brasserie", "NL99INGB0987", "horeca-exploitant / consumptie ter plaatse", false, 85.00);
  assert(testB.rate === 9, "Test B (Grand Café): BTW tarief is 9%");
  assert(testB.isBuaHoreca === true, "Test B (Grand Café): isBuaHoreca is TRUE (BUA, niet-aftrekbaar)");
  assert(testB.category === 'E', "Test B (Grand Café): Categorie is E");

  // Multi-variante BUA checks
  const testA2 = classifyVatTransaction("Supermarkt Lidl", "NL99INGB0987", "Wekelijkse boodschappen en lunch voor kantoor", false, 32.10);
  assert(testA2.isBuaHoreca === false, "Supermarkt Lidl met kantoorlunch is GEEN BUA");

  const testB2 = classifyVatTransaction("Restaurant De Gouden Leeuw", "NL99INGB0987", "Zakelijk diner met klant in restaurant", false, 150.00);
  assert(testB2.isBuaHoreca === true, "Restaurant diner ter plaatse IS BUA");


  // ============================================================
  // BUG 3 — TELECOM REGRESSIETEST
  // ============================================================
  console.log("\n--- BUG 3: Telecom-classificatie (Ziggo vs KPN) ---");

  const ziggoRes = classifyVatTransaction("Ziggo Zakelijk", "NL99INGB0987", "Internet en Telefonie Q2", false, 89.00);
  const kpnRes = classifyVatTransaction("KPN Zakelijk", "NL99INGB0987", "Mobiel abonnement en glasvezel internet", false, 65.00);

  assert(ziggoRes.category === 'E' && ziggoRes.rate === 21 && ziggoRes.confidence === 'HOOG', "Ziggo Zakelijk geclassificeerd als Telecom 21% (HOOG)");
  assert(kpnRes.category === 'E' && kpnRes.rate === 21 && kpnRes.confidence === 'HOOG', "KPN Zakelijk geclassificeerd als Telecom 21% (HOOG)");
  assert(ziggoRes.category === kpnRes.category, "Ziggo en KPN bereiken EXACT dezelfde telecomcategorie (Categorie E)");
  assert(ziggoRes.confidence === kpnRes.confidence, "Ziggo en KPN hebben EXACT dezelfde HOOG confidence");

  const odidoRes = classifyVatTransaction("Odido Business", "NL99INGB0987", "Telecommunicatie en mobiele data", false, 45.00);
  assert(odidoRes.category === 'E' && odidoRes.rate === 21 && odidoRes.confidence === 'HOOG', "Odido Business ook geclassificeerd als Telecom 21% (HOOG)");


  // ============================================================
  // BUG 4 — CREDITNOTA FALSE POSITIVE UNIT TESTS
  // ============================================================
  console.log("\n--- BUG 4: Creditnota false positive prevention & detection ---");

  // Company names containing PBC, Inc, LLC, etc. with positive amounts -> NOT Category G
  const anthropicPbc = classifyVatTransaction("Anthropic PBC", "NL99INGB0987", "AI Subscription", false, 20.00);
  assert(anthropicPbc.category !== 'G', "Anthropic PBC is GEEN creditnota (Categorie !== G)");

  const anthropicInc = classifyVatTransaction("Anthropic Inc", "NL99INGB0987", "Software subscription", false, 50.00);
  assert(anthropicInc.category !== 'G', "Anthropic Inc is GEEN creditnota (Categorie !== G)");

  const openAiLlc = classifyVatTransaction("OpenAI LLC", "NL99INGB0987", "API Usage billing", false, 30.00);
  assert(openAiLlc.category !== 'G', "OpenAI LLC is GEEN creditnota (Categorie !== G)");

  const creditSuisse = classifyVatTransaction("Credit Suisse B.V.", "NL99INGB0987", "Advieskosten kantoor", false, 500.00);
  assert(creditSuisse.category !== 'G', "Credit Suisse (zonder credit in mededelingen) is GEEN creditnota");

  // Genuine Credit Notes -> MUST be Category G
  const realCreditNotes = classifyVatTransaction("Leverancier X B.V.", "NL99INGB0987", "Creditnota factuur 2026-123", true, 200.00);
  assert(realCreditNotes.category === 'G', "Mededelingen 'Creditnota factuur 2026-123' MOET Categorie G zijn");

  const realStorno = classifyVatTransaction("Leverancier Y B.V.", "NL99INGB0987", "Storno dubbele betaling", true, 150.00);
  assert(realStorno.category === 'G', "Mededelingen 'Storno dubbele betaling' MOET Categorie G zijn");

  const negativeAmountCredit = classifyVatTransaction("Software Vendor", "NL99INGB0987", "Maandelijkse verrekening", false, -100.00);
  assert(negativeAmountCredit.category === 'G', "Negatief bedrag (-100.00) MOET Categorie G zijn");


  console.log(`\n=== FOUR BUGS REGRESSION TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runFourBugsRegressionTests();
