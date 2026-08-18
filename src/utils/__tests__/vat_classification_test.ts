import { processCSVForVAT } from "../vatCalculator.js";

async function runClassificationTests() {
  console.log("=== STARTING ARCHITECTURAL VAT ENGINE TEST SUITE (CATEGORIES A-G & STRESS TESTS) ===");

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

  const testCSV = 
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    // 1. Cat E: Software Ontwikkeling -> 21% Dienst (HOOG)
    "20260501;De Bruin Consultancy;NL12RABO0123;NL99INGB0987;123;af;€ 1.000,00;Pin;Maatwerk Software Ontwikkeling\n" +
    // 2. Cat E: Bakkerij Jansen / Hosting -> 21% Dienst (HOOG based on notes)
    "20260502;Bakkerij Jansen B.V.;NL12RABO0123;NL99INGB0987;123;af;500,00;Pin;Onderhoud en Hosting Q2\n" +
    // 3. Cat E: TransIP B.V. -> 21% Dienst (HOOG)
    "20260503;TransIP B.V.;NL12RABO0123;NL99INGB0987;123;af;50,00;Pin;hosting\n" +
    // 4. Cat E: Grand Café (BUA) -> 9% underlying rate, non-deductible (HOOG)
    "20260504;Grand Café De Brasserie;NL12RABO0123;NL99INGB0987;123;af;100,00;Pin;Zakelijke Lunch\n" +
    // 5. Cat C: OpenAI LLC (US IBAN) -> 21% BTW verlegd (HOOG)
    "20260505;OpenAI LLC;NL12RABO0123;US99INGB0987;123;af;20,00;Pin;AI Subscription\n" +
    // 6. Cat E: Income Webdesign -> 21% Dienst (HOOG)
    "20260506;My Customer;NL12RABO0123;NL99INGB0987;123;bij;1.210,00;Pin;Webdesign van portaal en koppeling\n" +
    // 7. Cat A: Belastingdienst payment -> 0% GEEN_BTW (HOOG)
    "20260507;Belastingdienst;NL12RABO0123;NL99INGB0987;123;af;1.500,00;Pin;BTW afdracht Q1\n" +
    // 8. Cat B: Government / KVK -> 0% Buiten reikwijdte (HOOG)
    "20260508;KVK;NL12RABO0123;NL99INGB0987;123;af;50,00;Pin;Jaarlijkse bijdrage KVK\n" +
    // 9. ONZEKER (Stap D) -> null with detailed reasoning path
    "20260509;Unknown B.V.;NL12RABO0123;NL99INGB0987;123;af;250,00;Pin;Vage omschrijving\n" +
    // 10. Cat A: Interne overboeking -> 0% GEEN_BTW (HOOG)
    "20260510;Eigen Rekening;NL12RABO0123;NL12RABO0999;123;af;5.000,00;Pin;Interne overboeking spaarrekening\n" +
    // 11. Cat B: Art. 11 Exempt Education -> 0% Vrijgesteld (HOOG)
    "20260511;NCOI Opleidingen;NL12RABO0123;NL99INGB0987;123;af;800,00;Pin;Erkende beroepsopleiding software engineering\n" +
    // 12. Cat D: EU Intra-community Goods -> 21% Rubriek 4a (MIDDEL)
    "20260512;Hardware Supplier DE;NL12RABO0123;DE99INGB0987;123;af;1.200,00;Pin;Pakket verzending Duitsland met server hardware\n" +
    // 13. Cat F: Gemengde factuur -> null ONZEKER (LAAG)
    "20260513;Boekhandel & Cafe;NL12RABO0123;NL99INGB0987;123;af;150,00;Pin;Gemengde factuur: lunch en software licentie\n" +
    // 14. Cat G: Creditnota -> 21% Credit (HOOG)
    "20260514;Leverancier B.V.;NL12RABO0123;NL99INGB0987;123;bij;200,00;Pin;Creditnota retour zending kantoorartikelen\n";

  try {
    const res = await processCSVForVAT(testCSV);
    const details = res.details;
    const metrics = res.results.metrics;

    assert(details.length === 14, "Parsed exactly 14 test rows");

    // Cat E Software
    assert(details[0].vatCategory === 'E' && details[0].appliedRate === 21, "Test 1: Software matched to Cat E 21%");
    assert(details[0].confidence === 'HOOG', "Test 1: Confidence is HOOG");

    // Cat E Bakery hosting
    assert(details[1].vatCategory === 'E' && details[1].appliedRate === 21, "Test 2: Hosting matched to Cat E 21% despite company name");

    // Cat E Horeca BUA
    assert(details[3].vatCategory === 'E' && details[3].appliedRate === 9 && details[3].isBuaHoreca === true, "Test 4: Horeca matched to BUA 9% non-deductible");

    // Cat C Foreign US IBAN
    assert(details[4].vatCategory === 'C' && details[4].isReverseCharged === true, "Test 5: Foreign US IBAN matched to Cat C BTW verlegd");

    // Cat A Tax payment
    assert(details[6].vatCategory === 'A' && details[6].appliedRate === 0 && details[6].rubriek === 'GEEN_BTW', "Test 7: Tax payment matched to Cat A GEEN_BTW");

    // Cat B Government Leges
    assert(details[7].vatCategory === 'B' && details[7].appliedRate === 0 && details[7].rubriek === '0', "Test 8: KVK leges matched to Cat B Buiten reikwijdte");

    // ONZEKER
    assert(details[8].appliedRate === null && details[8].confidence === 'LAAG', "Test 9: Vague description escalated to ONZEKER (confidence LAAG)");
    assert(details[8].candidateRate === 21, "Test 9: Candidate rate provided as suggestion for ONZEKER");

    // Cat A Internal Transfer
    assert(details[9].vatCategory === 'A' && details[9].appliedRate === 0, "Test 10: Internal transfer matched to Cat A");

    // Cat B Art 11 Exempt Education
    assert(details[10].vatCategory === 'B' && details[10].isExemptArt11 === true, "Test 11: Education matched to Cat B Vrijgesteld art. 11");

    // Cat D EU Goods
    assert(details[11].vatCategory === 'D' && details[11].rubriek === '4a', "Test 12: EU goods matched to Cat D 4a");

    // Cat F Mixed Invoice
    assert(details[12].vatCategory === 'F' && details[12].appliedRate === null, "Test 13: Mixed invoice escalated to Cat F ONZEKER");

    // Cat G Credit note
    assert(details[13].vatCategory === 'G' && details[13].transactionType === 'INKOMST', "Test 14: Credit note matched to Cat G");

    // Metrics & Disclaimer checks
    assert(metrics.disclaimer.includes("fiscaal advies"), "Metrics includes mandatory disclaimer text");
    assert(metrics.totalRowsProcessed === 14, "Metrics totalRowsProcessed equals 14");
    assert(metrics.categoryCounts.A === 2, "Category A count is 2");
    assert(metrics.categoryCounts.B === 2, "Category B count is 2");
    assert(metrics.categoryCounts.C === 1, "Category C count is 1");
    assert(metrics.categoryCounts.D === 1, "Category D count is 1");
    assert(metrics.categoryCounts.E === 6, "Category E count is 6");
    assert(metrics.categoryCounts.F === 1, "Category F count is 1");
    assert(metrics.categoryCounts.G === 1, "Category G count is 1");

  } catch (err: any) {
    console.error("Failed on VAT classification tests: ", err);
    failed++;
  }

  // ==========================================
  // STRESS & VOLUME TEST (2000 SYNTHETIC ROWS)
  // ==========================================
  console.log("\n=== STARTING STRESS & VOLUME TEST (2500 SYNTHETIC ROWS) ===");
  const categoriesList = ["Software licentie", "Zakelijke lunch", "Boodschappen", "NS Treinkaartje", "Interne overboeking", "KVK bijdrage", "Opleiding NCOI", "Vage factuur 123"];
  const rows: string[] = [
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen"
  ];

  for (let i = 1; i <= 2500; i++) {
    const cat = categoriesList[i % categoriesList.length];
    const iban = i % 5 === 0 ? "DE99INGB012345" : "NL12RABO012345";
    const afBij = i % 3 === 0 ? "bij" : "af";
    const amt = (10 + (i % 500) * 2.5).toFixed(2).replace('.', ',');
    rows.push(`20260501;Test Company ${i};NL12RABO0123;${iban};123;${afBij};${amt};Pin;${cat}`);
  }

  const largeCSV = rows.join("\n");
  const startTime = Date.now();
  const largeRes = await processCSVForVAT(largeCSV);
  const elapsed = Date.now() - startTime;

  console.log(`Processed 2500 rows in ${elapsed} ms (${(elapsed / 2500).toFixed(2)} ms/row)`);
  assert(largeRes.details.length === 2500, "Stress test: All 2500 rows processed without silent loss");
  assert(elapsed < 2000, "Stress test performance: Completed under 2000 ms");

  const m = largeRes.results.metrics;
  const checksum = m.highConfidenceCount + m.mediumConfidenceCount + m.lowConfidenceCount;
  assert(checksum === 2500, "Stress test integrity: HOOG + MIDDEL + LAAG equals total input rows (2500)");

  console.log(`\n=== ALL TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runClassificationTests();
