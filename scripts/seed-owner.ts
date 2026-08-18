import { supabase } from "../src/server/lib/supabase";
import bcrypt from "bcryptjs";

async function seedOwner() {
  const name = "Admin";
  const number = "8900000";
  const password = "ChangeMeNow123!";

  console.log(`Creating owner user: ${name} (${number})...`);

  const hash = await bcrypt.hash(password, 10);

  const { data: account, error: accErr } = await supabase.from("accounts").insert({
    number,
    name,
    role: "owner",
    status: "active"
  }).select().single();

  if (accErr || !account) {
    console.error("Error creating owner account:", accErr);
    process.exit(1);
  }

  const { error: credErr } = await supabase.from("credentials").insert({
    account_id: account.id,
    password_hash: hash
  });

  if (credErr) {
    console.error("Error creating owner credentials:", credErr);
    process.exit(1);
  }

  console.log("Owner user created successfully!");
  console.log("------------------------------------");
  console.log("Credentials:");
  console.log(`Number: ${number}`);
  console.log(`Password: ${password}`);
  console.log("------------------------------------");
  console.log("PLEASE CHANGE THIS PASSWORD IMMEDIATELY AFTER LOGGING IN!");
}

seedOwner().catch(console.error);
