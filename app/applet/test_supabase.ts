import { supabase } from "./src/server/lib/supabase.ts";

async function main() {
  console.log("Querying files table with category...");
  const { data, error } = await supabase
    .from("files")
    .select("id, original_name, category")
    .limit(1);

  if (error) {
    console.error("Supabase query failed:", error);
  } else {
    console.log("Supabase query succeeded! Data:", data);
  }
}

main().catch(console.error);
