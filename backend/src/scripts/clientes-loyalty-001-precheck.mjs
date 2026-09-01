import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-LOYALTY-001 PRECHECK
 *
 * MODE: READ ONLY
 *
 * OBJETIVO:
 *   Preparar certificación de Fidelidad antes de cualquier smoke.
 *
 * REVISA:
 *   - gmx.fidelidad_cuentas
 *   - gmx.fidelidad_movimientos
 *   - columnas reales
 *   - constraints
 *   - índices
 *   - triggers
 *   - tipos de movimientos existentes
 *   - saldos actuales
 *   - cadena saldo_anterior -> saldo_nuevo
 *   - coincidencia cuenta vs último movimiento
 *   - movimientos duplicados
 *   - movimientos asociados a pedidos
 *   - señales de idempotencia
 *   - código benefitsRepository.js
 *   - integración ordersRepository.js
 *
 * GARANTÍAS:
 *   - BEGIN TRANSACTION READ ONLY
 *   - ROLLBACK
 *   - DATABASE_MUTATION=0
 *   - NO HTTP
 *   - NO ventas
 *   - NO caja
 *   - NO pagos
 */

import fs from "node:fs";
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
const SUB = "-".repeat(110);

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

function subsection(title) {
  console.log("\n" + SUB);
  console.log(title);
  console.log(SUB);
}

function printRows(rows, max = 250) {
  if (!rows?.length) {
    console.log("(0 rows)");
    return;
  }

  console.table(rows.slice(0, max));

  if (rows.length > max) {
    console.log(`Mostrando ${max}/${rows.length} filas`);
  }
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");

  for (const raw of content.split(/\r?\n/)) {
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

for (const name of [
".env",
".env.local",
".env.development",
".env.dev"])
{
  loadEnv(path.join(ROOT, name));
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

async function q(client, sql, params = []) {
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
      `READ_ONLY_GUARD:${normalized.slice(0, 120)}`
    );
  }

  return client.query(sql, params);
}

function readSource(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) return null;

  return fs.readFileSync(full, "utf8");
}

function extractFunctions(text) {
  if (!text) return [];

  const rows = [];
  const seen = new Set();

  const regexes = [
  /export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
  /export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
  /async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
  /function\s+([A-Za-z0-9_$]+)\s*\(/g];


  for (const regex of regexes) {
    let m;

    while (m = regex.exec(text)) {
      if (seen.has(m[1])) continue;

      seen.add(m[1]);

      const line =
      text.slice(0, m.index).split(/\r?\n/).length;

      rows.push({
        function: m[1],
        line
      });
    }
  }

  return rows.sort((a, b) => a.line - b.line);
}

function sourceSignals(text) {
  if (!text) return [];

  const patterns = [
  ["FIDELIDAD CUENTAS", /shiny\.fidelidad_cuentas/gi],
  ["FIDELIDAD MOVIMIENTOS", /shiny\.fidelidad_movimientos/gi],
  ["INSERT MOVIMIENTO", /INSERT\s+INTO\s+shiny\.fidelidad_movimientos/gi],
  ["UPDATE CUENTA", /UPDATE\s+shiny\.fidelidad_cuentas/gi],
  ["FOR UPDATE", /FOR\s+UPDATE/gi],
  ["BEGIN", /\bBEGIN\b/gi],
  ["COMMIT", /\bCOMMIT\b/gi],
  ["ROLLBACK", /\bROLLBACK\b/gi],
  ["ID MOVIMIENTO", /\bid_movimiento\b/gi],
  ["ID PEDIDO", /\bid_pedido\b/gi],
  ["ID CLIENTE", /\bid_cliente\b/gi],
  ["IDEMPOTENCY", /idempot/gi],
  ["GENERACION", /GENERACION/gi],
  ["REDENCION", /REDENCION/gi],
  ["REVERSA", /REVERSA|reverseBenefits/gi],
  ["DEVOLUCION", /DEVOLUCION/gi],
  ["AJUSTE", /AJUSTE|adjustClientPoints/gi],
  ["APPLY BENEFITS", /applyBenefitsTx/gi],
  ["CALCULATE BENEFITS", /calculateBenefitsTx/gi],
  ["PARTIAL RETURN", /applyPartialReturnBenefitsTx/gi]];


  const rows = [];

  for (const [name, regex] of patterns) {
    const matches = text.match(regex);

    if (matches?.length) {
      rows.push({
        signal: name,
        count: matches.length
      });
    }
  }

  return rows;
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-001 PRECHECK"));

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log(`ROOT=${ROOT}`);
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

  const db = new Client(dbConfig());

  let tx = false;

  try {
    await db.connect();

    await db.query("BEGIN TRANSACTION READ ONLY");
    tx = true;

    await db.query(
      "SET LOCAL statement_timeout='20000ms'"
    );

    await db.query(
      "SET LOCAL lock_timeout='3000ms'"
    );

    section("2. DATABASE SAFETY");

    const safety = await q(
      db,
      `
      SELECT
        current_database() AS database,
        current_user AS db_user,
        current_schema() AS current_schema,
        current_setting('transaction_read_only')
          AS transaction_read_only,
        current_setting('transaction_isolation')
          AS transaction_isolation
      `
    );

    printRows(safety.rows);

    if (
    safety.rows[0]?.transaction_read_only !== "on")
    {
      throw new Error(
        "SAFETY_ABORT_TRANSACTION_NOT_READ_ONLY"
      );
    }

    section("3. LOYALTY TABLE INVENTORY");

    const tables = await q(
      db,
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        CASE c.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          ELSE c.relkind::text
        END AS object_type,
        COALESCE(s.n_live_tup,0)::bigint
          AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid=c.relnamespace
      LEFT JOIN pg_stat_user_tables s
        ON s.relid=c.oid
      WHERE
        n.nspname='gmx'
        AND (
          lower(c.relname) LIKE '%fidel%'
          OR lower(c.relname) LIKE '%loyal%'
          OR lower(c.relname) LIKE '%punto%'
          OR lower(c.relname) LIKE '%benefit%'
        )
      ORDER BY c.relname
      `
    );

    printRows(tables.rows);

    section("4. FIDELIDAD CUENTAS — COLUMN CONTRACT");

    const accountColumns = await q(
      db,
      `
      SELECT
        ordinal_position,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        is_identity,
        identity_generation,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='fidelidad_cuentas'
      ORDER BY ordinal_position
      `
    );

    printRows(accountColumns.rows);

    section("5. FIDELIDAD MOVIMIENTOS — COLUMN CONTRACT");

    const movementColumns = await q(
      db,
      `
      SELECT
        ordinal_position,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        is_identity,
        identity_generation,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='fidelidad_movimientos'
      ORDER BY ordinal_position
      `
    );

    printRows(movementColumns.rows);

    section("6. LOYALTY CONSTRAINTS");

    const constraints = await q(
      db,
      `
      SELECT
        ns.nspname AS schema_name,
        cls.relname AS table_name,
        con.conname AS constraint_name,
        CASE con.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUSION'
          ELSE con.contype::text
        END AS constraint_type,
        pg_get_constraintdef(
          con.oid,
          true
        ) AS definition
      FROM pg_constraint con
      JOIN pg_class cls
        ON cls.oid=con.conrelid
      JOIN pg_namespace ns
        ON ns.oid=cls.relnamespace
      WHERE
        ns.nspname='gmx'
        AND cls.relname IN (
          'fidelidad_cuentas',
          'fidelidad_movimientos'
        )
      ORDER BY
        cls.relname,
        constraint_type,
        con.conname
      `
    );

    printRows(constraints.rows);

    section("7. LOYALTY INDEXES");

    const indexes = await q(
      db,
      `
      SELECT
        schemaname AS schema_name,
        tablename AS table_name,
        indexname AS index_name,
        indexdef AS index_definition
      FROM pg_indexes
      WHERE
        schemaname='gmx'
        AND tablename IN (
          'fidelidad_cuentas',
          'fidelidad_movimientos'
        )
      ORDER BY tablename,indexname
      `
    );

    printRows(indexes.rows);

    section("8. LOYALTY TRIGGERS");

    const triggers = await q(
      db,
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        t.tgname AS trigger_name,
        pg_get_triggerdef(
          t.oid,
          true
        ) AS trigger_definition,
        pn.nspname AS function_schema,
        p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_class c
        ON c.oid=t.tgrelid
      JOIN pg_namespace n
        ON n.oid=c.relnamespace
      JOIN pg_proc p
        ON p.oid=t.tgfoid
      JOIN pg_namespace pn
        ON pn.oid=p.pronamespace
      WHERE
        NOT t.tgisinternal
        AND n.nspname='gmx'
        AND c.relname IN (
          'fidelidad_cuentas',
          'fidelidad_movimientos'
        )
      ORDER BY c.relname,t.tgname
      `
    );

    printRows(triggers.rows);

    section("9. CURRENT LOYALTY ACCOUNTS");

    const accounts = await q(
      db,
      `
      SELECT *
      FROM gmx.fidelidad_cuentas
      ORDER BY id_cliente,row_id
      `
    );

    printRows(accounts.rows);

    section("10. CURRENT MOVEMENT TYPES");

    const types = await q(
      db,
      `
      SELECT
        tipo,
        COUNT(*)::bigint AS movements,
        COALESCE(SUM(puntos),0)::bigint
          AS points_sum,
        MIN(fecha) AS first_date,
        MAX(fecha) AS last_date
      FROM gmx.fidelidad_movimientos
      GROUP BY tipo
      ORDER BY tipo
      `
    );

    printRows(types.rows);

    section("11. MOVEMENT SAMPLE");

    const movementSample = await q(
      db,
      `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        tipo,
        puntos,
        saldo_anterior,
        saldo_nuevo,
        id_pedido,
        motivo,
        fecha
      FROM gmx.fidelidad_movimientos
      ORDER BY fecha DESC,row_id DESC
      LIMIT 100
      `
    );

    printRows(movementSample.rows);

    section("12. DUPLICATE LOYALTY ACCOUNTS");

    const duplicateAccounts = await q(
      db,
      `
      SELECT
        id_cliente,
        COUNT(*)::bigint AS account_count
      FROM gmx.fidelidad_cuentas
      GROUP BY id_cliente
      HAVING COUNT(*) > 1
      ORDER BY account_count DESC,id_cliente
      `
    );

    console.log(
      `DUPLICATE_LOYALTY_ACCOUNTS=${duplicateAccounts.rowCount}`
    );

    printRows(duplicateAccounts.rows);

    section("13. NEGATIVE ACCOUNT VALUES");

    const negative = await q(
      db,
      `
      SELECT *
      FROM gmx.fidelidad_cuentas
      WHERE
        puntos_disponibles < 0
        OR puntos_generados < 0
        OR puntos_redimidos < 0
        OR puntos_expirados < 0
      ORDER BY row_id
      `
    );

    console.log(
      `NEGATIVE_LOYALTY_BALANCES=${negative.rowCount}`
    );

    printRows(negative.rows);

    section("14. DUPLICATE MOVEMENT IDS");

    const duplicateMovements = await q(
      db,
      `
      SELECT
        id_movimiento,
        COUNT(*)::bigint AS occurrences
      FROM gmx.fidelidad_movimientos
      GROUP BY id_movimiento
      HAVING COUNT(*) > 1
      ORDER BY occurrences DESC,id_movimiento
      `
    );

    console.log(
      `DUPLICATE_MOVEMENT_IDS=${duplicateMovements.rowCount}`
    );

    printRows(duplicateMovements.rows);

    section("15. NULL BALANCE COMPONENTS");

    const nullBalances = await q(
      db,
      `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        tipo,
        puntos,
        saldo_anterior,
        saldo_nuevo,
        fecha
      FROM gmx.fidelidad_movimientos
      WHERE
        saldo_anterior IS NULL
        OR saldo_nuevo IS NULL
      ORDER BY row_id
      `
    );

    console.log(
      `MOVEMENT_NULL_BALANCES=${nullBalances.rowCount}`
    );

    printRows(nullBalances.rows);

    section("16. MOVEMENT BALANCE CHAIN");

    const brokenChain = await q(
      db,
      `
      WITH ordered AS (
        SELECT
          row_id,
          id_movimiento,
          id_cliente,
          tipo,
          puntos,
          saldo_anterior,
          saldo_nuevo,
          fecha,
          LAG(saldo_nuevo) OVER (
            PARTITION BY id_cliente
            ORDER BY fecha,row_id
          ) AS previous_saldo_nuevo
        FROM gmx.fidelidad_movimientos
      )
      SELECT *
      FROM ordered
      WHERE
        previous_saldo_nuevo IS NOT NULL
        AND saldo_anterior
          <> previous_saldo_nuevo
      ORDER BY id_cliente,fecha,row_id
      `
    );

    console.log(
      `BROKEN_MOVEMENT_CHAIN=${brokenChain.rowCount}`
    );

    printRows(brokenChain.rows);

    section("17. ACCOUNT VS LAST MOVEMENT");

    const mismatch = await q(
      db,
      `
      WITH latest AS (
        SELECT DISTINCT ON (id_cliente)
          id_cliente,
          id_movimiento,
          fecha,
          saldo_nuevo
        FROM gmx.fidelidad_movimientos
        ORDER BY
          id_cliente,
          fecha DESC,
          row_id DESC
      )
      SELECT
        f.id_cliente,
        f.puntos_disponibles
          AS account_balance,
        l.saldo_nuevo
          AS last_movement_balance,
        l.id_movimiento,
        l.fecha,
        (
          f.puntos_disponibles
          - l.saldo_nuevo
        ) AS difference
      FROM gmx.fidelidad_cuentas f
      JOIN latest l
        ON l.id_cliente=f.id_cliente
      WHERE
        f.puntos_disponibles
        <> l.saldo_nuevo
      ORDER BY f.id_cliente
      `
    );

    console.log(
      `ACCOUNT_LAST_MOVEMENT_MISMATCH=${mismatch.rowCount}`
    );

    printRows(mismatch.rows);

    section("18. ORPHAN MOVEMENTS -> CLIENTS");

    const orphanClients = await q(
      db,
      `
      SELECT
        m.row_id,
        m.id_movimiento,
        m.id_cliente,
        m.tipo,
        m.puntos,
        m.fecha
      FROM gmx.fidelidad_movimientos m
      LEFT JOIN gmx.clientes c
        ON c.id_cliente=m.id_cliente
      WHERE c.row_id IS NULL
      ORDER BY m.row_id
      `
    );

    console.log(
      `ORPHAN_MOVEMENT_CLIENTS=${orphanClients.rowCount}`
    );

    printRows(orphanClients.rows);

    section("19. ORPHAN MOVEMENTS -> PEDIDOS");

    const orphanOrders = await q(
      db,
      `
      SELECT
        m.row_id,
        m.id_movimiento,
        m.id_cliente,
        m.tipo,
        m.id_pedido,
        m.puntos,
        m.fecha
      FROM gmx.fidelidad_movimientos m
      LEFT JOIN gmx.pedidos p
        ON p.id_pedido=m.id_pedido
      WHERE
        m.id_pedido IS NOT NULL
        AND btrim(m.id_pedido)<>''
        AND p.row_id IS NULL
      ORDER BY m.row_id
      `
    );

    console.log(
      `ORPHAN_MOVEMENT_ORDERS=${orphanOrders.rowCount}`
    );

    printRows(orphanOrders.rows);

    section("20. MOVEMENTS BY ORDER / TYPE");

    const repeatedOrderType = await q(
      db,
      `
      SELECT
        id_pedido,
        tipo,
        COUNT(*)::bigint AS occurrences,
        COALESCE(SUM(puntos),0)::bigint
          AS points_sum
      FROM gmx.fidelidad_movimientos
      WHERE
        id_pedido IS NOT NULL
        AND btrim(id_pedido)<>''
      GROUP BY id_pedido,tipo
      HAVING COUNT(*) > 1
      ORDER BY occurrences DESC,id_pedido,tipo
      `
    );

    console.log(
      `REPEATED_ORDER_TYPE_MOVEMENTS=${repeatedOrderType.rowCount}`
    );

    printRows(repeatedOrderType.rows);

    section("21. IDEMPOTENCY STRUCTURAL SIGNALS");

    const idem = await q(
      db,
      `
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE
        schemaname='gmx'
        AND tablename='fidelidad_movimientos'
        AND (
          lower(indexname) LIKE '%movimiento%'
          OR lower(indexname) LIKE '%pedido%'
          OR lower(indexdef) LIKE '%id_movimiento%'
          OR lower(indexdef) LIKE '%id_pedido%'
          OR lower(indexdef) LIKE '%tipo%'
        )
      ORDER BY indexname
      `
    );

    printRows(idem.rows);

    section("22. BENEFITS REPOSITORY SOURCE CONTRACT");

    const benefitsText =
    readSource(
      "src/repositories/benefitsRepository.js"
    );

    if (!benefitsText) {
      console.log(
        "benefitsRepository.js=MISSING"
      );
    } else {
      console.log(
        `benefitsRepository.js=FOUND`
      );

      console.log("\nFUNCTIONS:");
      printRows(
        extractFunctions(benefitsText)
      );

      console.log("\nSIGNALS:");
      printRows(
        sourceSignals(benefitsText)
      );
    }

    section("23. ORDERS REPOSITORY LOYALTY SIGNALS");

    const ordersText =
    readSource(
      "src/repositories/ordersRepository.js"
    );

    if (!ordersText) {
      console.log(
        "ordersRepository.js=MISSING"
      );
    } else {
      console.log(
        `ordersRepository.js=FOUND`
      );

      printRows(
        sourceSignals(ordersText)
      );
    }

    section("24. LOYALTY CONFIGURATION");

    const config = await q(
      db,
      `
      SELECT
        parametro,
        valor
      FROM gmx.configuracion
      WHERE
        lower(parametro) LIKE 'loyalty.%'
        OR lower(parametro) LIKE '%fidel%'
        OR lower(parametro) LIKE '%punto%'
      ORDER BY parametro
      `
    );

    printRows(config.rows);

    section("25. FINAL SAFETY");

    const finalSafety = await q(
      db,
      `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,
        current_database()
          AS database,
        current_user
          AS db_user,
        now() AS checked_at
      `
    );

    printRows(finalSafety.rows);

    if (
    finalSafety.rows[0]?.
    transaction_read_only !== "on")
    {
      throw new Error(
        "FINAL_READ_ONLY_CHECK_FAILED"
      );
    }

    await db.query("ROLLBACK");
    tx = false;

    section("26. FINAL SUMMARY");

    const anomalyTotal =
    duplicateAccounts.rowCount +
    negative.rowCount +
    duplicateMovements.rowCount +
    nullBalances.rowCount +
    brokenChain.rowCount +
    mismatch.rowCount +
    orphanClients.rowCount +
    orphanOrders.rowCount;

    console.log(
      "CLIENTES_LOYALTY_001_PRECHECK=PASS"
    );

    console.log(
      `LOYALTY_ACCOUNTS=${accounts.rowCount}`
    );

    console.log(
      `LOYALTY_MOVEMENTS=${movementSample.rowCount}`
    );

    console.log(
      `MOVEMENT_TYPES=${types.rowCount}`
    );

    console.log(
      `DUPLICATE_LOYALTY_ACCOUNTS=${duplicateAccounts.rowCount}`
    );

    console.log(
      `NEGATIVE_LOYALTY_BALANCES=${negative.rowCount}`
    );

    console.log(
      `DUPLICATE_MOVEMENT_IDS=${duplicateMovements.rowCount}`
    );

    console.log(
      `MOVEMENT_NULL_BALANCES=${nullBalances.rowCount}`
    );

    console.log(
      `BROKEN_MOVEMENT_CHAIN=${brokenChain.rowCount}`
    );

    console.log(
      `ACCOUNT_LAST_MOVEMENT_MISMATCH=${mismatch.rowCount}`
    );

    console.log(
      `ORPHAN_MOVEMENT_CLIENTS=${orphanClients.rowCount}`
    );

    console.log(
      `ORPHAN_MOVEMENT_ORDERS=${orphanOrders.rowCount}`
    );

    console.log(
      `REPEATED_ORDER_TYPE_MOVEMENTS=${repeatedOrderType.rowCount}`
    );

    console.log(
      `ANOMALY_TOTAL=${anomalyTotal}`
    );

    console.log(
      `HEAD_EQ_ORIGIN_MAIN=${
      head === origin ? "YES" : "NO"}`

    );

    console.log("MODE=READ_ONLY");
    console.log("HTTP_REQUESTS=0");
    console.log("DATABASE_MUTATION=0");
    console.log("FINANCIAL_MUTATION=0");
    console.log("SALES_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      "NEXT_STEP=ANALYZE_LOYALTY_PRECHECK"
    );

    console.log(
      "NO_LOYALTY_TEST_EXECUTED"
    );

    console.log(
      "NO_CODE_CHANGE_APPLIED"
    );

    section(
      "CLIENTES-LOYALTY-001 PRECHECK COMPLETE"
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
    "CLIENTES-LOYALTY-001 PRECHECK FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "DATABASE_MUTATION=0_EXPECTED"
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
