import { config } from "dotenv";
config();
import { supabase } from "../src/server/lib/supabase.ts";
import bcrypt from "bcryptjs";
import fetch from "node-fetch";

const API_URL = "http://127.0.0.1:3000";

async function runTest() {
  console.log("=== STARTING ORGANIZATION E2E TEST ===");
  try {
    // 1. Get Owner Account
    const { data: owner } = await supabase.from("accounts").select("id").eq("role", "owner").limit(1).single();
    if (!owner) throw new Error("Owner niet gevonden");
    console.log("Found Owner:", owner.id);

    // 2. Create an Organization manually to avoid owner token auth complexity in script
    const orgNumber = "2000" + Math.floor(1000 + Math.random() * 9000);
    const orgPassword = "TestOrgPassword123!";
    const hash = await bcrypt.hash(orgPassword, 10);

    const { data: org, error: orgErr } = await supabase.from("accounts").insert({
      number: orgNumber,
      name: `Test Org ${orgNumber}`,
      role: "user", // The DB holds 'user', but runtime mapping treats 2* as 'organization'
      owner_id: owner.id,
      status: "active"
    }).select().single();
    
    if (orgErr || !org) throw new Error("Failed to create org: " + orgErr?.message);
    await supabase.from("credentials").insert({ account_id: org.id, password_hash: hash });
    console.log("Created Organization:", orgNumber);

    // 3. Login as Organization
    console.log("Attempting Login...");
    const loginRes = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: org.name, number: orgNumber, password: orgPassword })
    });
    
    const loginData = await loginRes.json();
    console.log("RAW LOGIN RESPONSE:", loginData);

    if (loginData.requires_2fa || loginData.requires_2fa_setup) {
      console.log("Test user hit 2FA. In real app, organization hits 2FA. We will bypass by inserting 2FA record.");
      throw new Error("No token received. Need to bypass 2FA.");
    }

    if (!loginData.token) {
      throw new Error("No token received. Need to bypass 2FA.");
    }

    console.log("Logged in successfully! Token:", loginData.token.slice(0, 15) + "...");
    console.log("Account Role mapped to:", loginData.account.role); // Should be "organization"
      
    const token = loginData.token;

    // 4. Update Organization Settings
    console.log("Updating Org Settings...");
    const setRes = await fetch(`${API_URL}/api/organization/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        max_customers_per_batch: 200,
        max_upload_bytes: 104857600, // 100MB
        session_lifetime_hours: 12,
        max_login_attempts: 5,
        retention_years: 3
      })
    });
    const setData = await setRes.json();
    console.log("Update Settings Response:", setData);

    // 5. Create Customers
    console.log("Creating customers as organization...");
    const custRes = await fetch(`${API_URL}/api/user/create-customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ count: 3 })
    });
    const custData = await custRes.json();
    console.log("Created customers:", custData.count);
    if (custData.created) {
      console.log("Sample customer:", custData.created[0]);
    }
  } catch (err: any) {
    console.error("Test failed:", err.message);
  }
}

runTest();
