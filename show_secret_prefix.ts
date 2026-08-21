import dotenv from "dotenv";
dotenv.config();

const key = process.env.SUPABASE_SECRET_KEY;
if (key) {
  console.log("Length:", key.length);
  console.log("Prefix:", key.substring(0, 5));
  console.log("Suffix:", key.substring(key.length - 5));
  console.log("Contains spaces:", key.includes(" "));
  console.log("Contains slash:", key.includes("/"));
} else {
  console.log("SUPABASE_SECRET_KEY not set");
}
