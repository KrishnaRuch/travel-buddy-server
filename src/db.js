import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

if (!process.env.PGHOST) {
  throw new Error("Missing PGHOST. Check server/.env");
}

if (!globalThis.__pgPool) {
  globalThis.__pgPool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });
}

export const pool = globalThis.__pgPool;

// Keep q because your routes import it
export const q = (text, params) => pool.query(text, params);