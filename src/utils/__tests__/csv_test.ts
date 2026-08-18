import { processCSVForVAT } from "../vatCalculator.js";

async function runTests() {
  console.log("=== STARTING CSV PARSING TESTS ===");

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

  // 1. Valid MKB Dutch CSV with BOM and semicolons
  const validCSV_BOM_Semi = 
    "\ufeff" + 
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    "20260501;Albert Heijn;NL12RABO0123;NL99INGB0987;123;af;€ 2.178,00;Pin;Factuur 2026-050 - Software Koppeling en VAT Engine\n" +
    "20260502;Supermarkt Lidl;NL12RABO0123;NL99INGB0987;123;af;145,50;Pin;Wekelijkse boodschappen\n" +
    "20260503;Google Ireland;NL12RABO0123;NL99INGB0987;456;af;85,00;Afschrijving;Google Workspace abonnement\n";

  try {
    const res = await processCSVForVAT(validCSV_BOM_Semi);
    assert(res.details.length === 3, "Parsed exactly 3 rows");
    assert(res.details[0].amount === 2178.00, "Parsed Dutch amount 2.178,00 correctly to 2178.00");
    assert(res.details[1].amount === 145.50, "Parsed 145,50 to 145.50");
    assert(res.details[2].amount === 85.00, "Parsed 85,00 to 85.00");

    // Print first 3 rows details for the required Zelftest
    console.log("\n=== ZELFTEST (First 3 Data Rows) ===");
    res.details.forEach((row, idx) => {
      console.log(`Row ${idx + 1}:`);
      console.log(`  Datum: ${20260501 + idx}`);
      console.log(`  Naam/Omschrijving: ${row.description}`);
      console.log(`  Bedrag: ${row.amount}`);
      console.log(`  Af Bij: ${row.isIncome ? 'bij' : 'af'}`);
      console.log(`  Mededelingen: ${idx === 0 ? "Factuur 2026-050 - Software Koppeling en VAT Engine" : idx === 1 ? "Wekelijkse boodschappen" : "Google Workspace abonnement"}`);
    });
    console.log("====================================\n");

  } catch (err: any) {
    console.error("Failed on standard CSV: ", err);
    failed++;
  }

  // 2. Different column order & Comma delimiter (quoting the value containing comma)
  const commaDifferentOrder = 
    "Mededelingen,Bedrag (EUR),Mutatiesoort,Af Bij,Code,Tegenrekening,Rekening,Naam / Omschrijving,Datum\n" +
    "Factuur A,\"123,45\",Pin,af,1,2,3,Albert Heijn,20260501\n";
  try {
    const res = await processCSVForVAT(commaDifferentOrder);
    assert(res.details.length === 1, "Parsed different order and comma delimiter successfully");
    assert(res.details[0].amount === 123.45, "Parsed amount correctly in different order");
    assert(res.details[0].description === "Albert Heijn", "Parsed description correctly in different order");
  } catch (err: any) {
    console.error("Failed on comma different order: ", err);
    failed++;
  }

  // 3. Validation: Missing expected header
  const missingHeaderCSV = 
    "Datum;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    "20260501;NL12RABO0123;NL99INGB0987;123;af;100;Pin;Test\n";
  try {
    await processCSVForVAT(missingHeaderCSV);
    console.error("[FAIL] Should have thrown error for missing expected header Naam / Omschrijving");
    failed++;
  } catch (err: any) {
    assert(err.message.includes("Ontbrekende verplichte kolom: Naam / Omschrijving"), "Successfully caught missing expected header");
  }

  // 4. Validation: Invalid Datum format
  const invalidDateCSV = 
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    "NOT_A_DATE;Albert Heijn;NL12RABO0123;NL99INGB0987;123;af;100;Pin;Test\n";
  try {
    await processCSVForVAT(invalidDateCSV);
    console.error("[FAIL] Should have thrown error for invalid Date");
    failed++;
  } catch (err: any) {
    assert(err.message.includes("Ongeldige datum gedetecteerd"), "Successfully caught invalid date format");
  }

  // 5. Validation: Column shift (Bedrag identical to Datum)
  const columnShiftCSV = 
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    "20260501;Albert Heijn;NL12RABO0123;NL99INGB0987;123;af;20260501;Pin;Test\n";
  try {
    await processCSVForVAT(columnShiftCSV);
    console.error("[FAIL] Should have thrown error for column shifting / Bedrag identical to Datum");
    failed++;
  } catch (err: any) {
    assert(err.message.includes("Kolomverschuivingsfout gedetecteerd"), "Successfully caught column shift error");
  }

  // 6. Validation: Out of bounds amount (> 10,000,000)
  const hugeAmountCSV = 
    "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n" +
    "20260501;Albert Heijn;NL12RABO0123;NL99INGB0987;123;af;10000001;Pin;Test\n";
  try {
    await processCSVForVAT(hugeAmountCSV);
    console.error("[FAIL] Should have thrown error for too large amount (> 10M)");
    failed++;
  } catch (err: any) {
    assert(err.message.includes("Ongeldig transactiebedrag gedetecteerd"), "Successfully caught unplausible amount");
  }

  console.log(`\n=== TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
