import { brandText } from "./config/brand.js";import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'gmx_db',
  user: process.env.PGUSER || 'gmx_app',
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (error) => {
  console.error(brandText("[GMX][PostgreSQL] Pool error:"), error);
});

export async function query(text, params = []) {
  const started = Date.now();
  const result = await pool.query(text, params);
  return { ...result, ms: Date.now() - started };
}
