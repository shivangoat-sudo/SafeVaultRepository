// Test suite for quarter missing status logic (Q3 bug verification)

async function runQuarterStatusTests() {
  console.log("=== STARTING QUARTER STATUS & Q3 BUG VERIFICATION TESTS ===");
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

  // Simulate helper logic in getQuarterStatusData
  function computeQuarterStatus(
    allCustomers: { id: string; name: string }[],
    adminRows: { customer_id: string; quarter: string; year: number; status: string }[],
    fileRows: { customer_id: string; quarter: string; year: number }[],
    targetYear: number
  ) {
    const submittedSets: Record<string, Set<string>> = {
      Q1: new Set<string>(),
      Q2: new Set<string>(),
      Q3: new Set<string>(),
      Q4: new Set<string>(),
    };

    // 1. From admin_status (done, in_progress, submitted)
    for (const row of adminRows) {
      if (row.year === targetYear && ["done", "in_progress", "submitted"].includes(row.status)) {
        if (submittedSets[row.quarter]) {
          submittedSets[row.quarter].add(row.customer_id);
        }
      }
    }

    // 2. From file_metadata / files table
    for (const f of fileRows) {
      const qStr = String(f.quarter || "").toUpperCase().trim();
      const yrNum = f.year ? parseInt(String(f.year), 10) : null;
      let normQ: string | null = null;
      if (qStr === "1" || qStr === "Q1") normQ = "Q1";
      else if (qStr === "2" || qStr === "Q2") normQ = "Q2";
      else if (qStr === "3" || qStr === "Q3") normQ = "Q3";
      else if (qStr === "4" || qStr === "Q4") normQ = "Q4";

      if (yrNum === targetYear && normQ && submittedSets[normQ]) {
        submittedSets[normQ].add(f.customer_id);
      }
    }

    const missingByQuarter = {
      Q1: allCustomers.filter((c) => !submittedSets.Q1.has(c.id)),
      Q2: allCustomers.filter((c) => !submittedSets.Q2.has(c.id)),
      Q3: allCustomers.filter((c) => !submittedSets.Q3.has(c.id)),
      Q4: allCustomers.filter((c) => !submittedSets.Q4.has(c.id)),
    };

    return {
      notSubmittedQ1: missingByQuarter.Q1.length,
      notSubmittedQ2: missingByQuarter.Q2.length,
      notSubmittedQ3: missingByQuarter.Q3.length,
      notSubmittedQ4: missingByQuarter.Q4.length,
    };
  }

  // Test Case 1: 1 customer, 0 Q3 uploads
  const cust1 = [{ id: "cust-101", name: "Klant 1" }];
  const status1 = computeQuarterStatus(cust1, [], [], 2026);
  assert(status1.notSubmittedQ3 === 1, "1 customer without Q3 document has Q3 missing count = 1");

  // Test Case 2: Same customer uploads Q3 document
  const files1 = [{ customer_id: "cust-101", quarter: "Q3", year: 2026 }];
  const status2 = computeQuarterStatus(cust1, [], files1, 2026);
  assert(status2.notSubmittedQ3 === 0, "Same customer after uploading Q3 document has Q3 missing count = 0");
  assert(status2.notSubmittedQ1 === 1, "Uploading Q3 does not change Q1 missing count");
  assert(status2.notSubmittedQ2 === 1, "Uploading Q3 does not change Q2 missing count");
  assert(status2.notSubmittedQ4 === 1, "Uploading Q3 does not change Q4 missing count");

  // Test Case 3: Multiple customers (Klant A uploaded Q3, Klant B not uploaded Q3)
  const custs2 = [
    { id: "cust-101", name: "Klant A" },
    { id: "cust-102", name: "Klant B" },
  ];
  const files2 = [{ customer_id: "cust-101", quarter: "Q3", year: 2026 }];
  const status3 = computeQuarterStatus(custs2, [], files2, 2026);
  assert(status3.notSubmittedQ3 === 1, "2 customers (1 uploaded, 1 missing) gives Q3 missing count = 1");

  // Test Case 4: Klant B also uploads Q3
  const files3 = [
    { customer_id: "cust-101", quarter: "Q3", year: 2026 },
    { customer_id: "cust-102", quarter: "Q3", year: 2026 },
  ];
  const status4 = computeQuarterStatus(custs2, [], files3, 2026);
  assert(status4.notSubmittedQ3 === 0, "Both customers uploaded Q3 gives Q3 missing count = 0");

  console.log(`\n=== QUARTER STATUS TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runQuarterStatusTests();
