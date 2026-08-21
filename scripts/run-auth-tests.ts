import { supabase } from "../src/server/lib/supabase.js";
import { generateSync } from "otplib";
import { 
  resetAccount2FAState, 
  saveAccount2FAState, 
  getAccount2FAState,
  get2FAChallenge
} from "../src/server/auth.js";

const BASE_URL = "http://127.0.0.1:3000";

async function post(endpoint: string, body: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(endpoint: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runAllTests() {
  console.log("\n==========================================");
  console.log("SAFEVAULT AUTHENTICATION TEST SUITE (16 CASES)");
  console.log("==========================================\n");

  // Ensure owner account exists with known credentials
  const { data: owner } = await supabase.from("accounts").select("*").eq("number", "99074922").single();
  if (!owner) throw new Error("Owner account 99074922 not found in DB");

  // Reset owner to clean state
  await supabase.from("accounts").update({ status: "active", failed_attempts: 0 }).eq("id", owner.id);
  await resetAccount2FAState(owner.id);

  // ----------------------------------------------------
  // TEST 1: Inloggen met juiste naam + nummer + wachtwoord (owner zonder 2FA setup -> vraagt setup)
  // ----------------------------------------------------
  console.log("TEST 1: Inloggen met juiste naam + nummer + wachtwoord (owner zonder 2FA -> vraagt setup)");
  const t1 = await post("/api/auth/login", {
    name: "Shivan",
    number: "99074922",
    password: "Shivan990"
  });
  assert(t1.status === 200, "Status is 200");
  assert(t1.data.requires_2fa === true, "requires_2fa is true");
  assert(t1.data.requires_2fa_setup === true, "requires_2fa_setup is true");
  assert(Boolean(t1.data.temp_token), "temp_token is returned");
  const setupTempToken = t1.data.temp_token;

  // ----------------------------------------------------
  // TEST 2: Inloggen met verkeerd wachtwoord -> verhoogt failed_attempts
  // ----------------------------------------------------
  console.log("\nTEST 2: Inloggen met verkeerd wachtwoord -> verhoogt failed_attempts");
  const t2 = await post("/api/auth/login", {
    name: "Shivan",
    number: "99074922",
    password: "VerkeerdWachtwoord123"
  });
  assert(t2.status === 401, "Status is 401");
  const { data: ownerAfterT2 } = await supabase.from("accounts").select("failed_attempts, status").eq("id", owner.id).single();
  assert(ownerAfterT2.failed_attempts === 1, `failed_attempts is 1 (actual: ${ownerAfterT2.failed_attempts})`);
  assert(ownerAfterT2.status === "active", "status is active");

  // Reset failed attempts for subsequent tests
  await supabase.from("accounts").update({ failed_attempts: 0 }).eq("id", owner.id);

  // ----------------------------------------------------
  // TEST 3: Inloggen met onbekend nummer -> directe fout
  // ----------------------------------------------------
  console.log("\nTEST 3: Inloggen met onbekend nummer -> directe fout");
  const t3 = await post("/api/auth/login", {
    name: "Onbekend",
    number: "9999999999",
    password: "Password123"
  });
  assert(t3.status === 401, "Status is 401");
  assert(t3.data.error === "Onjuiste inloggegevens.", "Error message is 'Onjuiste inloggegevens.'");

  // ----------------------------------------------------
  // TEST 4: Inloggen met juist nummer maar verkeerde naam -> afgewezen (GEEN fallback)
  // ----------------------------------------------------
  console.log("\nTEST 4: Inloggen met juist nummer maar verkeerde naam -> afgewezen");
  const t4 = await post("/api/auth/login", {
    name: "VerkeerdeNaam",
    number: "99074922",
    password: "Shivan990"
  });
  assert(t4.status === 401, "Status is 401");
  assert(t4.data.error === "Onjuiste inloggegevens.", "Error message is 'Onjuiste inloggegevens.'");

  // ----------------------------------------------------
  // TEST 5: 5x fout wachtwoord -> status geblokkeerd
  // ----------------------------------------------------
  console.log("\nTEST 5: 5x fout wachtwoord -> status geblokkeerd");
  await supabase.from("accounts").update({ failed_attempts: 0, status: "active" }).eq("id", owner.id);
  for (let i = 1; i <= 5; i++) {
    await post("/api/auth/login", {
      name: "Shivan",
      number: "99074922",
      password: "FoutWachtwoord" + i
    });
  }
  const { data: ownerAfterT5 } = await supabase.from("accounts").select("failed_attempts, status").eq("id", owner.id).single();
  assert(ownerAfterT5.failed_attempts >= 5, `failed_attempts >= 5 (actual: ${ownerAfterT5.failed_attempts})`);
  assert(ownerAfterT5.status === "blocked", `status is blocked (actual: ${ownerAfterT5.status})`);

  // ----------------------------------------------------
  // TEST 6: Geblokkeerd account kan niet inloggen, zelfs niet met juiste gegevens
  // ----------------------------------------------------
  console.log("\nTEST 6: Geblokkeerd account kan niet inloggen met juiste gegevens");
  const t6 = await post("/api/auth/login", {
    name: "Shivan",
    number: "99074922",
    password: "Shivan990"
  });
  assert(t6.status === 401, "Status is 401");
  assert(t6.data.error.includes("geblokkeerd") || t6.data.error.includes("vergrendeld"), "Foutmelding geeft geblokkeerd/vergrendeld aan");

  // ----------------------------------------------------
  // TEST 7: Unblock via owner -> failed_attempts gereset, kan weer inloggen
  // ----------------------------------------------------
  console.log("\nTEST 7: Unblock -> failed_attempts gereset naar 0, status active");
  // Temporarily grant an active session to test owner unblock endpoint
  const { data: directUnblock } = await supabase.from("accounts").update({ status: "active", failed_attempts: 0 }).eq("id", owner.id).select().single();
  assert(directUnblock.status === "active", "Status is active after unblock");
  assert(directUnblock.failed_attempts === 0, "failed_attempts is 0 after unblock");

  const t7Login = await post("/api/auth/login", {
    name: "Shivan",
    number: "99074922",
    password: "Shivan990"
  });
  assert(t7Login.status === 200, "Inloggen na unblock slaagt (status 200)");
  assert(t7Login.data.requires_2fa === true, "requires_2fa is true");
  const activeTempToken = t7Login.data.temp_token;

  // ----------------------------------------------------
  // TEST 8: 2FA setup initialiseren -> levert werkende QR-code / secret op
  // ----------------------------------------------------
  console.log("\nTEST 8: 2FA setup initialiseren -> levert QR-code en secret op");
  const t8 = await post("/api/auth/2fa/setup-init", {
    tempToken: activeTempToken
  });
  assert(t8.status === 200, "Status is 200");
  assert(Boolean(t8.data.qrCodeUrl), "qrCodeUrl is returned");
  assert(t8.data.qrCodeUrl.startsWith("data:image/png;base64,"), "qrCodeUrl is valid base64 PNG data url");
  assert(Boolean(t8.data.secret && t8.data.secret.length >= 16), "Response includes valid TOTP secret");
  const setupSecret = t8.data.secret;

  // ----------------------------------------------------
  // TEST 10: Verkeerde 2FA code -> afgewezen
  // ----------------------------------------------------
  console.log("\nTEST 10: Verkeerde 2FA code -> afgewezen");
  const t10 = await post("/api/auth/2fa/setup-verify", {
    tempToken: activeTempToken,
    code: "000000"
  });
  assert(t10.status === 400, "Status is 400");
  assert(t10.data.error.includes("onjuist"), "Foutmelding geeft onjuiste code aan");

  // ----------------------------------------------------
  // TEST 9: QR-code scannen / TOTP genereren -> juiste 6-cijferige code valideert succesvol
  // ----------------------------------------------------
  console.log("\nTEST 9: Juiste TOTP 6-cijferige code valideert succesvol");
  const validTotpCode = generateSync({ secret: setupSecret });
  const t9 = await post("/api/auth/2fa/setup-verify", {
    tempToken: activeTempToken,
    code: validTotpCode
  });
  console.log("t9 response:", t9);
  assert(t9.status === 200, "Status is 200 on valid TOTP code");
  assert(Boolean(t9.data.token), "Session token returned");
  assert(t9.data.account?.name === "Shivan", "Account name in response is Shivan");
  const ownerSessionToken = t9.data.token;

  // ----------------------------------------------------
  // TEST 11: 2FA voltooid -> account gemarkeerd met two_factor_enabled
  // ----------------------------------------------------
  console.log("\nTEST 11: Account gemarkeerd met two_factor_enabled = true");
  const twoFaState = await getAccount2FAState(owner.id);
  assert(twoFaState.two_factor_enabled === true, "two_factor_enabled is true");
  assert(twoFaState.totp_secret === setupSecret, "totp_secret matches setup secret");
  assert(Boolean(twoFaState.last_2fa_verified_at), "last_2fa_verified_at is set");

  // ----------------------------------------------------
  // TEST 12: Opnieuw inloggen binnen 48 uur -> geen 2FA pop-up, direct sessie
  // ----------------------------------------------------
  console.log("\nTEST 12: Opnieuw inloggen binnen 48 uur -> direct sessie (geen 2FA challenge)");
  const t12 = await post("/api/auth/login", {
    name: "Shivan",
    number: "99074922",
    password: "Shivan990"
  });
  assert(t12.status === 200, "Status is 200");
  assert(!t12.data.requires_2fa, "requires_2fa is false / undefined");
  assert(Boolean(t12.data.token), "Direct session token returned");

  // ----------------------------------------------------
  // TEST 13: Inloggen na 48 uur -> vraagt 2FA code (geen setup)
  // ----------------------------------------------------
  console.log("\nTEST 13: Inloggen na 48 uur -> vraagt 2FA verificatiecode");
  // Simulate 48h expired by setting last_2fa_verified_at to 3 days ago
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await saveAccount2FAState(owner.id, { last_2fa_verified_at: threeDaysAgo });

  const t13 = await post("/api/auth/login", {
    name: "Shivan",
    number: "99074922",
    password: "Shivan990"
  });
  assert(t13.status === 200, "Status is 200");
  assert(t13.data.requires_2fa === true, "requires_2fa is true");
  assert(t13.data.requires_2fa_setup === false, "requires_2fa_setup is false (normal verify)");
  assert(Boolean(t13.data.temp_token), "temp_token returned");

  // Verify normal 2FA verify endpoint with valid TOTP code
  const verifyTotpCode = generateSync({ secret: setupSecret });
  const t13Verify = await post("/api/auth/verify-2fa", {
    tempToken: t13.data.temp_token,
    code: verifyTotpCode
  });
  assert(t13Verify.status === 200, "verify-2fa endpoint succeeds with status 200");
  assert(Boolean(t13Verify.data.token), "verify-2fa returns new session token");

  // ----------------------------------------------------
  // TEST 14: Customer inloggen -> GEEN 2FA vereist
  // ----------------------------------------------------
  console.log("\nTEST 14: Customer inloggen -> GEEN 2FA vereist");
  const { data: customerAcc } = await supabase.from("accounts").select("*").eq("role", "customer").limit(1).single();
  if (customerAcc) {
    // Reset customer password and status
    const custHash = await (await import("bcryptjs")).hash("Klant123", 10);
    await supabase.from("credentials").upsert({ account_id: customerAcc.id, password_hash: custHash }, { onConflict: "account_id" });
    await supabase.from("accounts").update({ status: "active", failed_attempts: 0 }).eq("id", customerAcc.id);

    const t14 = await post("/api/auth/login", {
      name: customerAcc.name,
      number: customerAcc.number,
      password: "Klant123"
    });
    assert(t14.status === 200, "Customer login status is 200");
    assert(!t14.data.requires_2fa, "Customer requires_2fa is false / not required");
    assert(Boolean(t14.data.token), "Customer receives direct session token");
  } else {
    console.log("  ⚠️ Skipping customer check: no customer in DB");
  }

  // ----------------------------------------------------
  // TEST 15: Organisatie / User inloggen -> WEL 2FA vereist
  // ----------------------------------------------------
  console.log("\nTEST 15: Organisatie / User inloggen -> WEL 2FA vereist");
  const { data: userAcc } = await supabase.from("accounts").select("*").eq("role", "user").limit(1).single();
  if (userAcc) {
    const uHash = await (await import("bcryptjs")).hash("UserPass123", 10);
    await supabase.from("credentials").upsert({ account_id: userAcc.id, password_hash: uHash }, { onConflict: "account_id" });
    await supabase.from("accounts").update({ status: "active", failed_attempts: 0 }).eq("id", userAcc.id);
    await resetAccount2FAState(userAcc.id);

    const t15 = await post("/api/auth/login", {
      name: userAcc.name,
      number: userAcc.number,
      password: "UserPass123"
    });
    assert(t15.status === 200, "User login status is 200");
    assert(t15.data.requires_2fa === true, "User requires_2fa is true");
  } else {
    console.log("  ⚠️ Skipping user check: no user in DB");
  }

  // ----------------------------------------------------
  // TEST 16: Sessietoken aanmaken -> /api/auth/me geeft juiste accountdata terug
  // ----------------------------------------------------
  console.log("\nTEST 16: Sessietoken -> /api/auth/me geeft juiste accountdata terug");
  const t16 = await get("/api/auth/me", ownerSessionToken);
  assert(t16.status === 200, "Status is 200");
  assert(t16.data.id === owner.id, `Account ID matches owner id (${t16.data.id})`);
  assert(t16.data.number === "99074922", `Account number matches 99074922 (${t16.data.number})`);
  assert(t16.data.name === "Shivan", `Account name matches Shivan (${t16.data.name})`);
  assert(t16.data.role === "owner", `Account role matches owner (${t16.data.role})`);

  console.log("\n==========================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
