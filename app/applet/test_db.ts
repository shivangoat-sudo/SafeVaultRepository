import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const host = "db.izwosuzoebfsvnkprtii.supabase.co";
  const password = process.env.SUPABASE_SECRET_KEY || "sb_secret_zQqYXZEN5EkpNDniO4DxEw_-gtZ9YgM";
  
  console.log("Attempting database connection to host:", host);
  
  // Try port 5432 (or 6543)
  const client = new Client({
    host,
    port: 5432,
    user: "postgres",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Successfully connected to PostgreSQL database on port 5432!");
    
    // Check files columns
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'files';
    `);
    
    console.log("Columns of table 'files':", res.rows);
    
    await client.end();
  } catch (err: any) {
    console.error("Connection failed with port 5432. Error:", err.message);
    console.log("Trying port 6543 (connection pooler)...");
    
    const clientPooler = new Client({
      host,
      port: 6543,
      user: "postgres",
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await clientPooler.connect();
      console.log("Successfully connected via port 6543!");
      const res = await clientPooler.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'files';
      `);
      console.log("Columns of table 'files':", res.rows);
      await clientPooler.end();
    } catch (err2: any) {
      console.error("Connection failed with port 6543 too. Error:", err2.message);
    }
  }
}

main().catch(console.error);
