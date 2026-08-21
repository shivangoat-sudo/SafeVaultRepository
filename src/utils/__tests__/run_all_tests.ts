import { execSync } from 'child_process';

console.log("============================================================");
console.log("     RUNNING CUMULATIVE SUITE FOR ALL TESTS                 ");
console.log("============================================================");

const testFiles = [
  "src/utils/__tests__/problems_1_and_2_regression_test.ts",
  "src/utils/__tests__/four_bugs_regression_test.ts",
  "src/utils/__tests__/vat_classification_test.ts",
  "src/utils/__tests__/csv_test.ts",
  "src/utils/__tests__/q3_quarter_status_test.ts",
  "src/utils/__tests__/upload_validation_test.ts",
  "src/lib/__tests__/vatEngine.test.ts",
  "src/lib/__tests__/calculateVatReport.test.ts"
];

let totalPassedSuites = 0;

for (const testFile of testFiles) {
  console.log(`\n>>> Executing ${testFile}...`);
  try {
    const output = execSync(`npx tsx ${testFile}`, { encoding: 'utf-8' });
    console.log(output);
    totalPassedSuites++;
  } catch (err: unknown) {
    console.error(`❌ Suite ${testFile} FAILED:`);
    const e = err as { stdout?: string; message?: string };
    console.error(e.stdout || e.message);
    process.exit(1);
  }
}

console.log("============================================================");
console.log(` SUCCESS: ALL ${totalPassedSuites}/${testFiles.length} TEST SUITES PASSED CLEANLY! `);
console.log("============================================================");
