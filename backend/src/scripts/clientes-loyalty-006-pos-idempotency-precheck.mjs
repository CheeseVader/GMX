import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const LINE = "=".repeat(110);

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

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
    value.startsWith('"') && value.endsWith('"') ||
    value.startsWith("'") && value.endsWith("'"))
    {
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
".env.dev"])
{
  loadEnv(path.join(ROOT, f));
}

function dbConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  return {
    host:
    process.env.PGHOST ||
    process.env.DB_HOST ||
    "127.0.0.1",

    port: Number(
      process.env.PGPORT ||
      process.env.DB_PORT ||
      5432
    ),

    database:
    process.env.PGDATABASE ||
    process.env.DB_NAME ||
    process.env.DB_DATABASE,

    user:
    process.env.PGUSER ||
    process.env.DB_USER,

    password:
    process.env.PGPASSWORD ||
    process.env.DB_PASSWORD
  };
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (e) {
    return `ERROR:${e.message}`;
  }
}

function read(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) {
    console.log(`FILE_MISSING=${rel}`);
    return null;
  }

  console.log(`FILE_FOUND=${rel}`);
  return fs.readFileSync(full, "utf8");
}

function showContexts(text, patterns, radius = 12) {
  if (!text) {
    console.log("(no source)");
    return;
  }

  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      hits.push(i);
    }
  }

  const ranges = [];

  for (const hit of hits) {
    const start = Math.max(0, hit - radius);
    const end = Math.min(lines.length - 1, hit + radius);

    const prev = ranges.at(-1);

    if (prev && start <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  if (!ranges.length) {
    console.log("(0 matches)");
    return;
  }

  for (const [start, end] of ranges) {
    console.log(
      `\n--- lines ${start + 1}-${end + 1} ---`
    );

    for (let i = start; i <= end; i++) {
      console.log(
        `${String(i + 1).padStart(5, " ")} | ${lines[i]}`
      );
    }
  }
}

async function q(db, sql, params = []) {
  const normalized = sql.
  replace(/\/\*[\s\S]*?\*\//g, "").
  replace(/--.*$/gm, "").
  trim().
  toUpperCase();

  if (
  !normalized.startsWith("SELECT") &&
  !normalized.startsWith("WITH"))
  {
    throw new Error(
      "READ_ONLY_GUARD:" + normalized.slice(0, 100)
    );
  }

  return db.query(sql, params);
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-006 POS IDEMPOTENCY INTEGRATION PRECHECK")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log("LOYALTY_MUTATION_ALLOWED=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  section("1. GIT BASELINE");

  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const origin = git(["rev-parse", "origin/main"]);
  const status = git(["status", "--short"]);

  console.log(`BRANCH=${branch}`);
  console.log(`HEAD=${head}`);
  console.log(`ORIGIN_MAIN=${origin}`);
  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${head === origin ? "YES" : "NO"}`
  );
  console.log(
    `GIT_CLEAN=${status ? "NO" : "YES"}`
  );

  section("2. SOURCE FILES");

  const ordersRepo = read(
    "src/repositories/ordersRepository.js"
  );

  const ordersRoute = read(
    "src/routes/orders.js"
  );

  const server = read(
    "src/server.js"
  );

  section("3. CREATE SALE / IDEMPOTENCY SOURCE CONTRACT");

  showContexts(
    ordersRepo,
    [
    /createSale/i,
    /saleRequestId/i,
    /pos_idempotency_key/i,
    /idempotent_reuse/i,
    /applyBenefitsTx/i,
    /INSERT INTO shiny\.pedidos/i,
    /INSERT INTO shiny\.detalle_pedidos/i,
    /inventory/i,
    /inventario/i,
    /BEGIN/i,
    /COMMIT/i,
    /ROLLBACK/i],

    16
  );

  section("4. ROUTE PAYLOAD CONTRACT");

  showContexts(
    ordersRoute,
    [
    /router\.post/i,
    /saleRequestId/i,
    /createSale/i,
    /items/i,
    /products/i,
    /id_cliente/i,
    /client/i,
    /payment/i,
    /metodo_pago/i,
    /subtotal/i,
    /total/i],

    16
  );

  section("5. SERVER MOUNT");

  showContexts(
    server,
    [
    /orders/i,
    /api\/v1/i,
    /requireAuth/i,
    /app\.use/i],

    8
  );

  const db = new Client(dbConfig());
  let tx = false;

  try {
    await db.connect();

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    tx = true;

    section("6. DATABASE SAFETY");

    const safety = await q(db, `
      SELECT
        current_database() AS database,
        current_user AS db_user,
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only
    `);

    console.table(safety.rows);

    if (
    safety.rows[0]?.transaction_read_only !== "on")
    {
      throw new Error(
        "TRANSACTION_NOT_READ_ONLY"
      );
    }

    section("7. PEDIDOS IDEMPOTENCY CONTRACT");

    const idem = await q(db, `
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE
        schemaname='gmx'
        AND tablename='pedidos'
        AND (
          indexname ILIKE '%idempot%'
          OR indexdef ILIKE '%pos_idempotency_key%'
        )
      ORDER BY indexname
    `);

    console.table(idem.rows);

    section("8. REQUIRED ORDER COLUMNS");

    const orderCols = await q(db, `
      SELECT
        ordinal_position,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='pedidos'
      ORDER BY ordinal_position
    `);

    console.table(orderCols.rows);

    section("9. DETAIL PEDIDOS CONTRACT");

    const detailCols = await q(db, `
      SELECT
        ordinal_position,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='detalle_pedidos'
      ORDER BY ordinal_position
    `);

    console.table(detailCols.rows);

    section("10. INVENTORY MUTATION TABLES DISCOVERY");

    const invTables = await q(db, `
      SELECT DISTINCT
        table_schema,
        table_name
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND (
          lower(table_name) LIKE '%inventario%'
          OR lower(table_name) LIKE '%stock%'
        )
      ORDER BY table_name
    `);

    console.table(invTables.rows);

    section("11. EXISTING POS TEST PATTERNS");

    const existing = await q(db, `
      SELECT
        row_id,
        id_pedido,
        id_cliente,
        estado_pedido,
        estado_pago,
        canal_venta,
        puntos_generados,
        puntos_redimidos,
        pos_idempotency_key
      FROM gmx.pedidos
      WHERE
        pos_idempotency_key IS NOT NULL
        AND btrim(pos_idempotency_key)<>''
      ORDER BY row_id DESC
      LIMIT 30
    `);

    console.table(existing.rows);

    section("12. LOYALTY LINKED POS ORDERS");

    const linked = await q(db, `
      SELECT
        p.row_id,
        p.id_pedido,
        p.id_cliente,
        p.pos_idempotency_key,
        p.puntos_generados,
        p.puntos_redimidos,

        COUNT(f.*) FILTER (
          WHERE f.tipo='GENERACION'
        )::bigint AS generation_rows,

        COUNT(f.*) FILTER (
          WHERE f.tipo='REDENCION'
        )::bigint AS redemption_rows

      FROM gmx.pedidos p

      LEFT JOIN gmx.fidelidad_movimientos f
        ON f.id_pedido=p.id_pedido

      WHERE
        p.pos_idempotency_key IS NOT NULL
        AND btrim(p.pos_idempotency_key)<>''

      GROUP BY
        p.row_id,
        p.id_pedido,
        p.id_cliente,
        p.pos_idempotency_key,
        p.puntos_generados,
        p.puntos_redimidos

      ORDER BY p.row_id DESC
      LIMIT 30
    `);

    console.table(linked.rows);

    section("13. TESTABLE INVENTORY CANDIDATES");

    /*
     * Solo lectura.
     * Buscamos candidatos con stock positivo para diseñar
     * después el smoke sin asumir producto/código.
     */
    const stockColumns = await q(db, `
      SELECT
        table_name,
        column_name
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND (
          lower(table_name) LIKE '%inventario%'
          OR lower(table_name) LIKE '%stock%'
        )
      ORDER BY table_name,ordinal_position
    `);

    console.table(stockColumns.rows);

    section("14. FINAL READ ONLY");

    const finalSafety = await q(db, `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,
        NOW() AS checked_at
    `);

    console.table(finalSafety.rows);

    if (
    finalSafety.rows[0]?.transaction_read_only !== "on")
    {
      throw new Error(
        "FINAL_READ_ONLY_CHECK_FAILED"
      );
    }

    await db.query("ROLLBACK");
    tx = false;

    section("15. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_006_POS_IDEMPOTENCY_PRECHECK=PASS"
    );

    console.log(
      `HEAD_EQ_ORIGIN_MAIN=${head === origin ? "YES" : "NO"}`
    );

    console.log("MODE=READ_ONLY");
    console.log("HTTP_REQUESTS=0");
    console.log("DATABASE_MUTATION=0");
    console.log("FINANCIAL_MUTATION=0");
    console.log("SALES_MUTATION=0");
    console.log("LOYALTY_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      "NEXT_STEP=BUILD_POS_IDEMPOTENCY_LOYALTY_SMOKE"
    );

    console.log(
      "NO_CODE_CHANGE_APPLIED"
    );

  } catch (e) {
    if (tx) {
      try {
        await db.query("ROLLBACK");
        console.log(
          "ROLLBACK_AFTER_ERROR=PASS"
        );
      } catch {}
    }

    throw e;

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "CLIENTES-LOYALTY-006 POS IDEMPOTENCY PRECHECK FAILED"
  );

  console.error(e?.stack || e);

  console.log(
    "DATABASE_MUTATION=0_EXPECTED"
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
