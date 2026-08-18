import { supabase } from "./src/server/lib/supabase.ts";

async function main() {
  const { data, error } = await supabase
    .from("access_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("Error fetching access logs:", error);
  } else {
    console.log("Access Logs:", data);
  }
}

main().catch(console.error);
