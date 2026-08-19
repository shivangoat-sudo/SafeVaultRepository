import { supabase } from "../src/server/lib/supabase";

async function purge() {
  if (process.env.ALLOW_DESTRUCTIVE_SCRIPT !== "true") {
    console.error("DANGER: Destructive script blocked. Set ALLOW_DESTRUCTIVE_SCRIPT=true to execute.");
    process.exit(1);
  }

  console.log("Purging database...");
  
  const { error: accountsError } = await supabase.from("accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (accountsError) console.error("Error purging accounts:", accountsError);
  else console.log("Accounts purged.");
}

purge().catch(console.error);
