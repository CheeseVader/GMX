import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    const m = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;

    let [, key, value] = m;
    value = value.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

for (const f of [
  ".env",
  ".env.local",
  ".env.development",
  ".env.dev",
]) {
  loadEnv(path.join(ROOT, f));
}

function cfg() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.PGHOST || process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    database:
      process.env.PGDATABASE ||
      process.env.DB_NAME ||
      process.env.DB_DATABASE,
    user:
      process.env.PGUSER ||
      process.env.DB_USER,
    password:
      process.env.PGPASSWORD ||
      process.env.DB_PASSWORD,
  };
}

const db = new Client(cfg());

try {
  await db.connect();

  await db.query("BEGIN TRANSACTION READ ONLY");

  const r = await db.query(`
    SELECT
      (
        SELECT COUNT(*)
        FROM gmx.pedidos
        WHERE pos_idempotency_key LIKE 'LOYALTY007-%'
      )::bigint AS pedidos,

      (
        SELECT COUNT(*)
        FROM gmx.clientes
        WHERE
          nombre LIKE 'CLIENTES LOYALTY007 TEST %'
          OR email LIKE 'clientes.loyalty007.%@example.invalid'
      )::bigint AS clientes
  `);

  console.table(r.rows);

  const row = r.rows[0];

  console.log(`TEST_RESIDUE_PEDIDOS=${row.pedidos}`);
  console.log(`TEST_RESIDUE_CLIENTES=${row.clientes}`);

  if (
    Number(row.pedidos) !== 0 ||
    Number(row.clientes) !== 0
  ) {
    throw new Error("LOYALTY007_PRE_RERUN_RESIDUE_NOT_ZERO");
  }

  await db.query("ROLLBACK");

  console.log("R6F_RESIDUE_PRECHECK=PASS");
  console.log("DATABASE_MUTATION=0");

} finally {
  await db.end();
}
