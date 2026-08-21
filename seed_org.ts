import { supabase } from "./src/server/lib/supabase.js";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { createSession } from "./src/server/auth.js";
dotenv.config();
async function main() {
  const { data: owners } = await supabase.from("accounts").select("id").eq("role", "owner").limit(1);
  const orgPayload = {
    org: { number: "80000000", name: "Org Bulk Test", password: "Password123" },
    users: [],
    ownerPassword: "password"
  };
  const { token: ownerToken } = await createSession(owners[0].id);
  const res = await fetch("http://localhost:3000/api/owner/create-organization-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ownerToken}` },
    body: JSON.stringify(orgPayload)
  });
  console.log("Created Org:", await res.json());
}
main();
