import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isProd = process.env.NODE_ENV === "production";

if (!SUPABASE_URL || !(SUPABASE_URL.startsWith("http://") || SUPABASE_URL.startsWith("https://"))) {
  if (isProd) {
    console.error("FATAL: SUPABASE_URL is not set or is not a valid HTTP(S) URL in production.");
    process.exit(1);
  } else {
    console.warn("WARNING: SUPABASE_URL is not set or is not a valid HTTP(S) URL. Falling back to placeholder.");
    SUPABASE_URL = "https://placeholder.supabase.co";
  }
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not set.");
} else {
  console.log("Supabase service role key is set.");
}

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || "placeholder",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
