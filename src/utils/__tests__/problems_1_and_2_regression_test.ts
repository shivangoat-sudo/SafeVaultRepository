import { processCSVForVAT, classifyVatTransaction } from "../vatCalculator.js";
import { processFile } from "../../bridge.js";

async function runProblemsAandBTests() {
  console.log("============================================================");
  console.log(" RUNNING PERMANENT REGRESSION TESTS FOR PROBLEMS A & B ");
  console.log("============================================================");

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

  // =========================================================================
  // SUB-SUITE 1: PROBLEM A — REVERSE CHARGE FORMULA (MULTIPLICATION NOT EXTRACTION)
  // =========================================================================
  console.log("\n--- Sub-Suite 1: Problem A — Reverse Charge Formula (bedrag * 0.21) ---");

  // Hand calculations for reverse charged VAT (Category C/D):
  // Reverse charge applies Dutch VAT to the NET invoice amount (ground amount/grondslag).
  // - Supplier 1: € 100,00 @ 21% -> 100.00 * 0.21 = € 21,00 (NOT extraction 100 - 100/1.21 = € 17.36)
  // - Supplier 2: € 50,00 @ 21%  ->  50.00 * 0.21 = € 10,50 (NOT extraction 50 - 50/1.21 = € 8.68)
  // - Supplier 3: € 24,20 @ 21%  ->  24.20 * 0.21 = € 5,082 -> € 5,08 (NOT extraction 24.20 - 24.20/1.21 = € 4.20)

  const headers = "Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen\n";

  const problemACSV = headers +
    "20260601;OpenAI LLC;NL12RABO0123;US99INGB0987;123;af;24,20;Pin;ChatGPT Plus subscription\n" +
    "20260602;Vercel Inc;NL12RABO0123;US88INGB1234;123;af;50,00;Pin;Hosting plan\n" +
    "20260603;GitHub Inc;NL12RABO0123;US77INGB5678;123;af;100,00;Pin;Copilot Enterprise\n";

  const resA = await processCSVForVAT(problemACSV);
  const { results: resultsA, details: detailsA } = resA;

  // Supplier 3 (€ 24,20): OpenAI LLC
  const openAiDetail = detailsA.find(d => d.description.includes("OpenAI"));
  assert(openAiDetail?.isReverseCharged === true, "OpenAI LLC is reverse charged (isReverseCharged = true)");
  assert(openAiDetail?.vatCategory === 'C', "OpenAI LLC category is 'C'");

  // Supplier 2 (€ 50,00): Vercel Inc
  const vercelDetail = detailsA.find(d => d.description.includes("Vercel"));
  assert(vercelDetail?.isReverseCharged === true, "Vercel Inc is reverse charged");

  // Supplier 1 (€ 100,00): GitHub Inc
  const githubDetail = detailsA.find(d => d.description.includes("GitHub"));
  assert(githubDetail?.isReverseCharged === true, "GitHub Inc is reverse charged");

  // Verify exact hand-calculated VAT amounts (multiplication formula)
  // Total ground = 24.20 + 50.00 + 100.00 = 174.20
  // Total 4b VAT = (24.20 * 0.21) + (50.00 * 0.21) + (100.00 * 0.21) = 5.082 + 10.50 + 21.00 = 36.582 -> € 36,58
  assert(resultsA.rubriek4b_vat === 36.58, `Total 4b VAT for verlegde transacties is € 36,58 (Actual: € ${resultsA.rubriek4b_vat})`);
  assert(resultsA.rubriek5b_vat === 36.58, `Total 5b VAT (deductible) equals 4b VAT € 36,58 (Actual: € ${resultsA.rubriek5b_vat})`);

  // =========================================================================
  // SUB-SUITE 2: PROBLEM B — ANTHROPIC PBC CLASSIFICATION, SYMMETRY & STABILITY
  // =========================================================================
  console.log("\n--- Sub-Suite 2: Problem B — Anthropic PBC Credit Card & Symmetry/Stability ---");

  // 1. Anthropic PBC with Credit Card payment notes MUST NOT be classified as Creditnota (Category G)
  const anthropicCcClass = classifyVatTransaction(
    "Anthropic PBC",
    "US00INGB4567",
    "Claude Pro Subscription paid via Credit Card",
    false,
    24.20
  );

  assert(anthropicCcClass.category === 'C', "Anthropic PBC with credit card notes is Category C (Grensoverschrijdend — Dienst)");
  assert(anthropicCcClass.category !== 'G', "Anthropic PBC is NOT Creditnota (Category !== 'G')");
  assert(anthropicCcClass.rate === 21, "Anthropic PBC rate is 21%");
  assert(anthropicCcClass.isReverseCharged === true, "Anthropic PBC isReverseCharged is true");
  assert(anthropicCcClass.rubriek === '4b', "Anthropic PBC rubriek is '4b'");

  // =========================================================================
  // SUB-SUITE 3: 40-ROW DATASET EINDVERIFICATIE (HAND CALCULATION & SYMMETRY)
  // =========================================================================
  console.log("\n--- Sub-Suite 3: 40-Row Dataset Eindverificatie & 3x Stability Test ---");

  const foreignSoftwareProviders = [
    { name: "OpenAI LLC", iban: "US99INGB0987", notes: "ChatGPT Plus abonnement via creditcard" },
    { name: "ElevenLabs Inc", iban: "US88INGB1234", notes: "AI Voice API Subscription" },
    { name: "Netlify Inc", iban: "US77INGB5678", notes: "Cloud Hosting & Build minutes" },
    { name: "GitHub Inc", iban: "US66INGB9012", notes: "GitHub Copilot & Enterprise Plan" },
    { name: "Adobe Systems Software Ireland", iban: "IE55INGB3456", notes: "Creative Cloud All Apps" },
    { name: "Apple Distribution International", iban: "IE44INGB7890", notes: "iCloud Plus Storage 200GB" },
    { name: "Google Cloud EMEA", iban: "IE33INGB2345", notes: "Google Cloud Platform Infrastructure" },
    { name: "Resend Inc", iban: "US22INGB6789", notes: "Transactional Email API" },
    { name: "Midjourney Inc", iban: "US11INGB0123", notes: "AI Image Generation Plan" },
    { name: "Anthropic PBC", iban: "US00INGB4567", notes: "Claude Pro Subscription - credit card" },
    { name: "Vercel Inc", iban: "US99INGB8901", notes: "Pro Team Cloud Plan" },
    { name: "JetBrains s.r.o.", iban: "CZ88INGB2345", notes: "All Products Pack License" }
  ];

  const rows: string[] = [];
  // Row 1: Domestic sales - Smit & Partners B.V. (€ 18.422,48 incl 21% -> VAT 21% = € 3.197,29)
  rows.push("20260601;Smit & Partners B.V.;NL12RABO0123;NL99INGB0987;123;bij;18.422,48;Pin;Factuur 2026-001 Webdevelopment diensten");

  // Rows 2-13: 12 Foreign software services (€ 50,00 each)
  for (let i = 0; i < foreignSoftwareProviders.length; i++) {
    const p = foreignSoftwareProviders[i];
    const day = (i + 2).toString().padStart(2, '0');
    rows.push(`202606${day};${p.name};NL12RABO0123;${p.iban};123;af;50,00;Pin;${p.notes}`);
  }

  // Rows 14-16: 9% Domestic deductible expenses (NS Zakelijk + Jumbo + AH = € 145,15 incl -> € 11,98 VAT)
  rows.push("20260614;NS Zakelijk;NL12RABO0123;NL99INGB0987;123;af;85,15;Pin;Treinkaartjes woon-werkverkeer");
  rows.push("20260615;Jumbo Supermarkt;NL12RABO0123;NL99INGB0987;123;af;35,00;Pin;Boodschappen pantry");
  rows.push("20260616;Albert Heijn;NL12RABO0123;NL99INGB0987;123;af;25,00;Pin;Koffie en thee pantry");

  // Rows 17-18: BUA Horeca items (9% non-deductible)
  rows.push("20260617;Grand Café De Brasserie;NL12RABO0123;NL99INGB0987;123;af;120,00;Pin;Zakelijke lunch met klant");
  rows.push("20260618;Restaurant De Posthoorn;NL12RABO0123;NL99INGB0987;123;af;80,00;Pin;Klantdiner ter plaatse");

  // Rows 19-21: Non-VAT transactions
  rows.push("20260619;Belastingdienst;NL12RABO0123;NL99INGB0987;123;af;1.500,00;Pin;BTW afdracht Q1");
  rows.push("20260620;KVK;NL12RABO0123;NL99INGB0987;123;af;50,00;Pin;Jaarlijkse bijdrage KVK");
  rows.push("20260621;Eigen Rekening;NL12RABO0123;NL12RABO0999;123;af;3.000,00;Pin;Interne overboeking spaarrekening");

  // Rows 22-40: 19 Domestic IT purchase/office expense rows (€ 121,00 incl -> € 21,00 VAT each)
  for (let i = 22; i <= 40; i++) {
    const day = (i <= 30 ? i : i - 30).toString().padStart(2, '0');
    const month = i <= 30 ? "06" : "07";
    rows.push(`2026${month}${day};Leverancier Kantoor B.V. ${i};NL12RABO0123;NL99INGB0987;123;af;121,00;Pin;Kantoorartikelen en papier ${i}`);
  }

  const dataset40 = headers + rows.join("\n");

  // STABILITY TEST: Run 3 times consecutively and compare exact results
  let firstRunResults: unknown = null;

  for (let run = 1; run <= 3; run++) {
    const res = await processCSVForVAT(dataset40);
    const { results, details } = res;

    assert(details.length === 40, `Run ${run}: 40 rows processed`);

    // Verify Anthropic PBC in details
    const anthropicRow = details.find(d => d.description.includes("Anthropic"));
    assert(anthropicRow !== undefined, `Run ${run}: Anthropic PBC found in details`);
    assert(anthropicRow?.vatCategory === 'C', `Run ${run}: Anthropic PBC is Category 'C'`);
    assert(anthropicRow?.appliedRate === 21, `Run ${run}: Anthropic PBC is 21%`);
    assert(anthropicRow?.isReverseCharged === true, `Run ${run}: Anthropic PBC isReverseCharged is true`);

    // HAND CALCULATION VERIFICATION:
    // Rubriek 1a: € 3.197,29
    assert(results.vat21 === 3197.29, `Run ${run}: Rubriek 1a sales VAT is strictly € 3.197,29 (Actual: € ${results.vat21})`);

    // Rubriek 4b (verlegd verschuldigd): 12 providers * (€ 50,00 * 0.21) = 12 * € 10,50 = € 126,00
    assert(results.rubriek4b_vat === 126.00, `Run ${run}: Rubriek 4b (verlegd verschuldigd) is strictly € 126,00 (Actual: € ${results.rubriek4b_vat})`);

    // Total Output VAT = 1a (€ 3.197,29) + 4b (€ 126,00) = € 3.323,29
    assert(results.totalVatToPay === 3323.29, `Run ${run}: Total Output VAT is strictly € 3.323,29 (Actual: € ${results.totalVatToPay})`);

    // Rubriek 5b (deductible input VAT) = € 11,98 (domestic 9%) + € 399,00 (domestic 21%) + € 126,00 (verlegd 21%) = € 536,98
    assert(results.rubriek5b_vat === 536.98, `Run ${run}: Rubriek 5b (total deductible input VAT) is strictly € 536,98 (Actual: € ${results.rubriek5b_vat})`);

    // SYMMETRY CHECK: For every reverse charged transaction, 4b due MUST EQUAL 5b deductible
    const reverseChargedDetails = details.filter(d => d.isReverseCharged);
    assert(reverseChargedDetails.length === 12, `Run ${run}: Exactly 12 foreign reverse charged transactions found`);

    let totalReverse4b = 0;
    reverseChargedDetails.forEach(d => {
      const vatAmount = d.amount * 0.21; // bedrag * 0.21
      totalReverse4b += vatAmount;
    });
    const roundedReverse4b = Math.round((totalReverse4b + Number.EPSILON) * 100) / 100;
    assert(roundedReverse4b === 126.00, `Run ${run}: Sum of reverse charged VAT across all 12 foreign rows is € 126,00`);

    // Final Net Balance = Output VAT (€ 3.323,29) - Deductible VAT (€ 536,98) = € 2.786,31
    assert(results.netVatToPayOrClaim === 2786.31, `Run ${run}: Net VAT (Eindsaldo) is strictly € 2.786,31 (Actual: € ${results.netVatToPayOrClaim})`);

    // Invariant Check: Net VAT == Output VAT - Deductible VAT
    const mathInvariant = Math.round((results.totalVatToPay - results.rubriek5b_vat + Number.EPSILON) * 100) / 100;
    assert(results.netVatToPayOrClaim === mathInvariant, `Run ${run}: Invariant check (€ ${results.netVatToPayOrClaim} == € ${results.totalVatToPay} - € ${results.rubriek5b_vat})`);

    // Verify Bridge Layer consistency via processFile
    const engineRes = await processFile(new File([dataset40], "dataset.csv", { type: "text/csv" }));
    assert(engineRes.metrics.netVatResult === 2786.31, `Run ${run}: Bridge netVatResult is € 2.786,31`);

    if (run === 1) {
      firstRunResults = results;
    } else {
      assert(JSON.stringify(results) === JSON.stringify(firstRunResults), `Run ${run}: Results are 100% STABLE and identical to Run 1`);
    }
  }

  console.log("============================================================");
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED `);
  console.log("============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runProblemsAandBTests();
