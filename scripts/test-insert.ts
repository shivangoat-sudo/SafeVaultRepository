import { supabase } from "../src/server/lib/supabase";

async function main() {
  console.log("Testing insert into accounts with role='organization'...");
  const testNumber = "29999999";
  
  // Clean up if exists
  await supabase.from("accounts").delete().eq("number", testNumber);

  const { data, error } = await supabase.from("accounts").insert({
    number: testNumber,
    name: "Test Organisatie",
    role: "organization",
    status: "active"
  }).select();

  if (error) {
    console.error("Insert failed:", error.message);
  } else {
    console.log("Insert succeeded!", data);
    // Clean up
    await supabase.from("accounts").delete().eq("number", testNumber);
  }
}

main().catch(console.error);
