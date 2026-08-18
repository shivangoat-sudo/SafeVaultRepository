import { supabase } from "./src/server/lib/supabase.ts";
import { comparePassword } from "./src/server/auth.ts";

async function main() {
  console.log("Diagnosing Owner Account...");
  const { data: owner, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("role", "owner")
    .single();

  if (error || !owner) {
    console.error("Owner not found in accounts table:", error);
    return;
  }

  console.log("Owner Account details:", {
    id: owner.id,
    name: owner.name,
    number: owner.number,
    role: owner.role,
    status: owner.status,
    failed_attempts: owner.failed_attempts
  });

  const { data: credential, error: credError } = await supabase
    .from("credentials")
    .select("*")
    .eq("account_id", owner.id)
    .single();

  if (credError || !credential) {
    console.error("No credential found in credentials table for this owner:", credError);
    return;
  }

  console.log("Owner Credential found:", {
    id: credential.id,
    account_id: credential.account_id,
    has_password_hash: !!credential.password_hash,
    password_hash: credential.password_hash
  });
}

main().catch(console.error);
