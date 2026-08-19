import { supabase } from "../src/server/lib/supabase";

async function deleteAllUsers() {
  if (process.env.ALLOW_DESTRUCTIVE_SCRIPT !== "true") {
    console.error("DANGER: Destructive script blocked. Set ALLOW_DESTRUCTIVE_SCRIPT=true to execute.");
    process.exit(1);
  }

  const { data, error } = await supabase.from("accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  
  if (error) {
    console.error("Error deleting accounts:", error);
    process.exit(1);
  }
  
  console.log("All accounts deleted.");
}

deleteAllUsers().catch(console.error);
