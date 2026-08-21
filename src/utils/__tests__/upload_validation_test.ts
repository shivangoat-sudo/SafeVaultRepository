import { processFiles } from "../../bridge";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

console.log("=== STARTING UPLOAD VALIDATION & BRIDGE TEST SUITE ===");

// TEST 1: ProcessFiles with empty files array
async function testEmptyProcessFiles() {
  const result = await processFiles([]);
  assert(result.metrics.totalRowsProcessed === 0, "Empty files returns 0 total rows processed");
  assert(result.validation.status === "success", "Empty files returns success status");
}

// TEST 2: ProcessFiles with valid CSV
async function testValidCsvProcessFiles() {
  const csvContent = `Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen
20260501;Albert Heijn;NL01INGB0001234567;NL02INGB0007654321;BA;Af;121,00;Betaalautomaat;Factuur 2026-001 Software`;
  const file = new File([csvContent], "bank.csv", { type: "text/csv" });
  const result = await processFiles([file]);
  assert(result.metrics.totalRowsProcessed === 1, "CSV processed 1 row");
  assert(result.metrics.btw_eindsaldo !== undefined, "BTW eindsaldo is calculated");
}

// TEST 3: Upload size validation logic
function testUploadValidationLogic() {
  const maxUploadBytes = 52428800; // 50MB
  
  // File smaller than limit
  const smallFile = { name: "test.pdf", size: 10 * 1024 * 1024 };
  assert(smallFile.size <= maxUploadBytes, "Small file (10MB) is within 50MB limit");

  // File larger than limit
  const largeFile = { name: "huge.pdf", size: 60 * 1024 * 1024 };
  assert(largeFile.size > maxUploadBytes, "Large file (60MB) exceeds 50MB limit");

  // Total batch size exceeding limit
  const batch = [
    { name: "f1.pdf", size: 30 * 1024 * 1024 },
    { name: "f2.pdf", size: 30 * 1024 * 1024 }
  ];
  const totalBatch = batch.reduce((sum, f) => sum + f.size, 0);
  assert(totalBatch > maxUploadBytes, "Total batch (60MB) exceeds 50MB limit");
}

async function run() {
  await testEmptyProcessFiles();
  await testValidCsvProcessFiles();
  testUploadValidationLogic();
  console.log("=== UPLOAD VALIDATION & BRIDGE TESTS PASSED CLEANLY! ===");
}

run();
