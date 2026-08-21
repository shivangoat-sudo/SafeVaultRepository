import { supabase } from "./src/server/lib/supabase.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const { data: creds } = await supabase.from("credentials").select("password_hash").limit(10);
  console.log(creds?.map(c => c.password_hash.length));
}
main();
