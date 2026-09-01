import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-LOYALTY-004
 * IDEMPOTENCY PRECHECK
 *
 * MODE: 100% READ ONLY
 *
 * OBJETIVO:
 * Descubrir el contrato REAL de idempotencia relacionado con:
 *
 *  1. Venta / POS
 *     - saleRequestId
 *     - pos_idempotency_key
 *
 *  2. Fidelidad
 *     - GENERACION
 *     - REDENCION
 *
 *  3. Reversa
 *     - beneficios_revertidos
 *     - reversa_de
 *
 *  4. Devolución parcial
 *     - DEVOLUCION_RETIRO
 *     - referencia DEV-*
 *
 * NO:
 *   INSERT
 *   UPDATE
 *   DELETE
 *   HTTP
 *   movimientos TEST
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

for (const file of [
".env",
".env.local",
".env.development",
".env.dev"])
{
  loadEnv(path.join(ROOT, file));
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
    return execFileSync(
      "git",
      args,
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: [
        "ignore",
        "pipe",
        "pipe"]

      }
    ).trim();
  } catch (e) {
    return `ERROR:${e.message}`;
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
      `READ_ONLY_GUARD:${normalized.slice(0, 100)}`
    );
  }

  return db.query(sql, params);
}

function findFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;

  for (const item of fs.readdirSync(dir, {
    withFileTypes: true
  })) {
    if (
    item.name === "node_modules" ||
    item.name === ".git" ||
    item.name === "dist" ||
    item.name === "build")
    {
      continue;
    }

    const full = path.join(dir, item.name);

    if (item.isDirectory()) {
      findFiles(full, results);
      continue;
    }

    if (
    /\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(item.name))
    {
      results.push(full);
    }
  }

  return results;
}

function searchSource(files, patterns) {
  const rows = [];

  for (const full of files) {
    let text;

    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        if (p.regex.test(lines[i])) {
          rows.push({
            file: path.
            relative(ROOT, full).
            replaceAll("\\", "/"),

            line: i + 1,

            signal: p.name,

            text: lines[i].
            trim().
            slice(0, 240)
          });

          p.regex.lastIndex = 0;
        }
      }
    }
  }

  return rows;
}

function printRows(rows, max = 300) {
  if (!rows?.length) {
    console.log("(0 rows)");
    return;
  }

  console.table(rows.slice(0, max));

  if (rows.length > max) {
    console.log(
      `SHOWING=${max}/${rows.length}`
    );
  }
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-004 IDEMPOTENCY PRECHECK")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log("LOYALTY_MUTATION_ALLOWED=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  /*
   * =========================================================
   * GIT
   * =========================================================
   */

  section("1. GIT BASELINE");

  const branch =
  git(["branch", "--show-current"]);

  const head =
  git(["rev-parse", "HEAD"]);

  const origin =
  git(["rev-parse", "origin/main"]);

  const status =
  git(["status", "--short"]);

  console.log(`BRANCH=${branch}`);
  console.log(`HEAD=${head}`);
  console.log(`ORIGIN_MAIN=${origin}`);

  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${
    head === origin ? "YES" : "NO"}`

  );

  console.log(
    `GIT_CLEAN=${
    status ? "NO" : "YES"}`

  );

  if (status) {
    console.log("\nGIT_STATUS:");
    console.log(status);
  }

  /*
   * =========================================================
   * SOURCE DISCOVERY
   * =========================================================
   */

  section("2. SOURCE DISCOVERY");

  const sourceRoot =
  path.join(ROOT, "src");

  const files =
  findFiles(sourceRoot);

  console.log(
    `SOURCE_FILES_SCANNED=${files.length}`
  );

  const patterns = [
  {
    name: "SALE_REQUEST_ID",
    regex: /saleRequestId/i
  },
  {
    name: "POS_IDEMPOTENCY_KEY",
    regex: /pos_idempotency_key/i
  },
  {
    name: "IDEMPOTENCY",
    regex: /idempoten/i
  },
  {
    name: "APPLY_BENEFITS",
    regex: /applyBenefitsTx/i
  },
  {
    name: "REVERSE_BENEFITS",
    regex: /reverseBenefitsTx/i
  },
  {
    name: "PARTIAL_RETURN",
    regex: /applyPartialReturnBenefitsTx/i
  },
  {
    name: "BENEFITS_REVERTED",
    regex: /beneficios_revertidos/i
  },
  {
    name: "REVERSA_DE",
    regex: /reversa_de/i
  },
  {
    name: "DEVOLUCION_RETIRO",
    regex: /DEVOLUCION_RETIRO/i
  },
  {
    name: "GENERACION",
    regex: /GENERACION/i
  },
  {
    name: "REDENCION",
    regex: /REDENCION/i
  },
  {
    name: "ON_CONFLICT",
    regex: /ON\s+CONFLICT/i
  }];


  const sourceHits =
  searchSource(files, patterns);

  console.log(
    `SOURCE_SIGNAL_HITS=${sourceHits.length}`
  );

  printRows(sourceHits);

  /*
   * =========================================================
   * DATABASE READ ONLY
   * =========================================================
   */

  const db =
  new Client(dbConfig());

  let tx = false;

  try {
    await db.connect();

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    tx = true;

    await db.query(
      "SET LOCAL statement_timeout='20000ms'"
    );

    await db.query(
      "SET LOCAL lock_timeout='3000ms'"
    );

    /*
     * =======================================================
     */

    section("3. DATABASE SAFETY");

    const safety =
    await q(
      db,
      `
        SELECT
          current_database()
            AS database,

          current_user
            AS db_user,

          current_setting(
            'transaction_read_only'
          )
            AS transaction_read_only,

          current_setting(
            'transaction_isolation'
          )
            AS transaction_isolation
        `
    );

    printRows(safety.rows);

    if (
    safety.rows[0]?.
    transaction_read_only !== "on")
    {
      throw new Error(
        "TRANSACTION_NOT_READ_ONLY"
      );
    }

    /*
     * =======================================================
     * PEDIDOS IDEMPOTENCY COLUMNS
     * =======================================================
     */

    section(
      "4. PEDIDOS IDEMPOTENCY COLUMN CONTRACT"
    );

    const pedidoColumns =
    await q(
      db,
      `
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
          AND (
            lower(column_name)
              LIKE '%idempot%'
            OR lower(column_name)
              LIKE '%request%'
            OR lower(column_name)
              LIKE '%revert%'
            OR lower(column_name)
              LIKE '%benef%'
          )
        ORDER BY ordinal_position
        `
    );

    printRows(pedidoColumns.rows);

    /*
     * =======================================================
     * IDEMPOTENCY INDEXES
     * =======================================================
     */

    section(
      "5. PEDIDOS IDEMPOTENCY INDEXES"
    );

    const pedidoIndexes =
    await q(
      db,
      `
        SELECT
          indexname,
          indexdef
        FROM pg_indexes
        WHERE
          schemaname='gmx'
          AND tablename='pedidos'
          AND (
            lower(indexname)
              LIKE '%idempot%'
            OR lower(indexdef)
              LIKE '%idempot%'
            OR lower(indexdef)
              LIKE '%request%'
          )
        ORDER BY indexname
        `
    );

    printRows(pedidoIndexes.rows);

    /*
     * =======================================================
     * MOVEMENT IDEMPOTENCY
     * =======================================================
     */

    section(
      "6. FIDELIDAD MOVEMENT UNIQUE CONTRACT"
    );

    const loyaltyIndexes =
    await q(
      db,
      `
        SELECT
          indexname,
          indexdef
        FROM pg_indexes
        WHERE
          schemaname='gmx'
          AND tablename='fidelidad_movimientos'
        ORDER BY indexname
        `
    );

    printRows(loyaltyIndexes.rows);

    /*
     * =======================================================
     * CONSTRAINTS
     * =======================================================
     */

    section(
      "7. IDEMPOTENCY RELATED CONSTRAINTS"
    );

    const constraints =
    await q(
      db,
      `
        SELECT
          c.relname
            AS table_name,

          con.conname
            AS constraint_name,

          CASE con.contype
            WHEN 'p' THEN 'PRIMARY KEY'
            WHEN 'u' THEN 'UNIQUE'
            WHEN 'f' THEN 'FOREIGN KEY'
            WHEN 'c' THEN 'CHECK'
            ELSE con.contype::text
          END
            AS constraint_type,

          pg_get_constraintdef(
            con.oid,
            true
          )
            AS definition

        FROM pg_constraint con

        JOIN pg_class c
          ON c.oid=con.conrelid

        JOIN pg_namespace n
          ON n.oid=c.relnamespace

        WHERE
          n.nspname='gmx'

          AND c.relname IN (
            'pedidos',
            'fidelidad_movimientos',
            'fidelidad_cuentas'
          )

          AND (
            lower(con.conname)
              LIKE '%idempot%'

            OR lower(
              pg_get_constraintdef(
                con.oid,
                true
              )
            )
              LIKE '%idempot%'

            OR lower(
              pg_get_constraintdef(
                con.oid,
                true
              )
            )
              LIKE '%id_movimiento%'

            OR lower(
              pg_get_constraintdef(
                con.oid,
                true
              )
            )
              LIKE '%id_cliente%'
          )

        ORDER BY
          c.relname,
          con.conname
        `
    );

    printRows(constraints.rows);

    /*
     * =======================================================
     * EXISTING POS IDEMPOTENCY DATA
     * =======================================================
     */

    section(
      "8. EXISTING POS IDEMPOTENCY DATA"
    );

    const idemData =
    await q(
      db,
      `
        SELECT
          pos_idempotency_key,
          COUNT(*)::bigint
            AS occurrences
        FROM gmx.pedidos
        WHERE
          pos_idempotency_key IS NOT NULL
          AND btrim(
            pos_idempotency_key
          ) <> ''
        GROUP BY pos_idempotency_key
        ORDER BY
          occurrences DESC,
          pos_idempotency_key
        LIMIT 100
        `
    );

    printRows(idemData.rows);

    const duplicateIdem =
    idemData.rows.filter(
      (x) =>
      Number(x.occurrences) > 1
    );

    console.log(
      `DUPLICATE_POS_IDEMPOTENCY_KEYS=${
      duplicateIdem.length}`

    );

    /*
     * =======================================================
     * BENEFIT MOVEMENT RELATION
     * =======================================================
     */

    section(
      "9. BENEFIT MOVEMENTS BY ORDER"
    );

    const movementByOrder =
    await q(
      db,
      `
        SELECT
          id_pedido,

          COUNT(*) FILTER (
            WHERE tipo='GENERACION'
          )::bigint
            AS generation_rows,

          COUNT(*) FILTER (
            WHERE tipo='REDENCION'
          )::bigint
            AS redemption_rows,

          COUNT(*) FILTER (
            WHERE tipo='REVERSA'
          )::bigint
            AS reversal_rows,

          COUNT(*) FILTER (
            WHERE tipo='DEVOLUCION_RETIRO'
          )::bigint
            AS partial_return_rows,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='GENERACION'
                  THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint
            AS generated_points,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='REDENCION'
                  THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint
            AS redeemed_points,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='REVERSA'
                  THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint
            AS reversed_points,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='DEVOLUCION_RETIRO'
                  THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint
            AS partial_return_points

        FROM gmx.fidelidad_movimientos

        WHERE
          id_pedido IS NOT NULL
          AND btrim(id_pedido) <> ''

        GROUP BY id_pedido

        ORDER BY id_pedido
        `
    );

    printRows(
      movementByOrder.rows,
      200
    );

    /*
     * =======================================================
     * POSSIBLE DUPLICATE GENERATION
     * =======================================================
     */

    section(
      "10. REPEATED GENERATION PER ORDER"
    );

    const repeatedGeneration =
    await q(
      db,
      `
        SELECT
          id_pedido,
          id_cliente,
          COUNT(*)::bigint
            AS generation_rows,
          SUM(puntos)::bigint
            AS generated_points
        FROM gmx.fidelidad_movimientos
        WHERE tipo='GENERACION'
          AND id_pedido IS NOT NULL
        GROUP BY
          id_pedido,
          id_cliente
        HAVING COUNT(*) > 1
        ORDER BY
          generation_rows DESC,
          id_pedido
        `
    );

    console.log(
      `REPEATED_GENERATION_PER_ORDER=${
      repeatedGeneration.rowCount}`

    );

    printRows(
      repeatedGeneration.rows
    );

    /*
     * =======================================================
     * POSSIBLE DUPLICATE REDEMPTION
     * =======================================================
     */

    section(
      "11. REPEATED REDEMPTION PER ORDER"
    );

    const repeatedRedemption =
    await q(
      db,
      `
        SELECT
          id_pedido,
          id_cliente,
          COUNT(*)::bigint
            AS redemption_rows,
          SUM(puntos)::bigint
            AS redeemed_points
        FROM gmx.fidelidad_movimientos
        WHERE tipo='REDENCION'
          AND id_pedido IS NOT NULL
        GROUP BY
          id_pedido,
          id_cliente
        HAVING COUNT(*) > 1
        ORDER BY
          redemption_rows DESC,
          id_pedido
        `
    );

    console.log(
      `REPEATED_REDEMPTION_PER_ORDER=${
      repeatedRedemption.rowCount}`

    );

    printRows(
      repeatedRedemption.rows
    );

    /*
     * =======================================================
     * REVERSAL CONTRACT
     * =======================================================
     */

    section(
      "12. REVERSAL IDEMPOTENCY CONTRACT"
    );

    const reversals =
    await q(
      db,
      `
        SELECT
          r.row_id,
          r.id_movimiento,
          r.id_cliente,
          r.id_pedido,
          r.tipo,
          r.puntos,
          r.reversa_de,

          original.tipo
            AS original_tipo,

          original.puntos
            AS original_points,

          CASE
            WHEN original.id_movimiento
              IS NOT NULL
            THEN 'YES'
            ELSE 'NO'
          END
            AS original_found

        FROM gmx.fidelidad_movimientos r

        LEFT JOIN
          gmx.fidelidad_movimientos original
            ON original.id_movimiento
               = r.reversa_de

        WHERE
          r.tipo='REVERSA'
          OR r.reversa_de IS NOT NULL

        ORDER BY
          r.id_pedido,
          r.row_id
        `
    );

    printRows(reversals.rows);

    /*
     * Duplicate reversal of same original.
     */

    const duplicateReverse =
    await q(
      db,
      `
        SELECT
          reversa_de,
          COUNT(*)::bigint
            AS reversal_count
        FROM gmx.fidelidad_movimientos
        WHERE
          reversa_de IS NOT NULL
        GROUP BY reversa_de
        HAVING COUNT(*) > 1
        ORDER BY
          reversal_count DESC,
          reversa_de
        `
    );

    console.log(
      `DUPLICATE_REVERSAL_OF_SAME_MOVEMENT=${
      duplicateReverse.rowCount}`

    );

    printRows(
      duplicateReverse.rows
    );

    /*
     * =======================================================
     * PEDIDO FLAG
     * =======================================================
     */

    section(
      "13. BENEFICIOS_REVERTIDOS DISTRIBUTION"
    );

    const revertedFlags =
    await q(
      db,
      `
        SELECT
          beneficios_revertidos,
          COUNT(*)::bigint
            AS pedidos
        FROM gmx.pedidos
        GROUP BY beneficios_revertidos
        ORDER BY beneficios_revertidos
        `
    );

    printRows(revertedFlags.rows);

    /*
     * =======================================================
     * PARTIAL RETURN REFERENCES
     * =======================================================
     */

    section(
      "14. PARTIAL RETURN REFERENCE CONTRACT"
    );

    const partialRefs =
    await q(
      db,
      `
        SELECT
          id_pedido,
          id_cliente,
          referencia,
          COUNT(*)::bigint
            AS occurrences,
          SUM(puntos)::bigint
            AS points_sum
        FROM gmx.fidelidad_movimientos
        WHERE tipo='DEVOLUCION_RETIRO'
        GROUP BY
          id_pedido,
          id_cliente,
          referencia
        ORDER BY
          id_pedido,
          referencia
        `
    );

    printRows(partialRefs.rows);

    const duplicatePartialRef =
    partialRefs.rows.filter(
      (x) =>
      Number(x.occurrences) > 1
    );

    console.log(
      `DUPLICATE_PARTIAL_RETURN_REFERENCE=${
      duplicatePartialRef.length}`

    );

    /*
     * =======================================================
     * CROSS CHECK ORDER FLAG VS REVERSALS
     * =======================================================
     */

    section(
      "15. ORDER REVERSAL FLAG CROSS-CHECK"
    );

    const flagMismatch =
    await q(
      db,
      `
        WITH movement_state AS (
          SELECT
            id_pedido,
            COUNT(*) FILTER (
              WHERE tipo='REVERSA'
            )::bigint
              AS reversal_rows
          FROM gmx.fidelidad_movimientos
          WHERE id_pedido IS NOT NULL
          GROUP BY id_pedido
        )

        SELECT
          p.row_id,
          p.id_pedido,
          p.beneficios_revertidos,
          COALESCE(
            m.reversal_rows,
            0
          )::bigint
            AS reversal_rows

        FROM gmx.pedidos p

        LEFT JOIN movement_state m
          ON m.id_pedido=p.id_pedido

        WHERE
          (
            p.beneficios_revertidos IS TRUE
            AND
            COALESCE(
              m.reversal_rows,
              0
            )=0
          )
          OR
          (
            COALESCE(
              p.beneficios_revertidos,
              FALSE
            ) IS FALSE
            AND
            COALESCE(
              m.reversal_rows,
              0
            )>0
          )

        ORDER BY p.row_id
        `
    );

    console.log(
      `REVERSAL_FLAG_MISMATCH=${
      flagMismatch.rowCount}`

    );

    printRows(
      flagMismatch.rows
    );

    /*
     * =======================================================
     * FINAL READ ONLY
     * =======================================================
     */

    section(
      "16. FINAL READ-ONLY VERIFICATION"
    );

    const finalSafety =
    await q(
      db,
      `
        SELECT
          current_setting(
            'transaction_read_only'
          )
            AS transaction_read_only,

          current_database()
            AS database,

          current_user
            AS db_user,

          NOW()
            AS checked_at
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

    /*
     * =======================================================
     * SUMMARY
     * =======================================================
     */

    section("17. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_004_IDEMPOTENCY_PRECHECK=PASS"
    );

    console.log(
      `DUPLICATE_POS_IDEMPOTENCY_KEYS=${
      duplicateIdem.length}`

    );

    console.log(
      `REPEATED_GENERATION_PER_ORDER=${
      repeatedGeneration.rowCount}`

    );

    console.log(
      `REPEATED_REDEMPTION_PER_ORDER=${
      repeatedRedemption.rowCount}`

    );

    console.log(
      `DUPLICATE_REVERSAL_OF_SAME_MOVEMENT=${
      duplicateReverse.rowCount}`

    );

    console.log(
      `DUPLICATE_PARTIAL_RETURN_REFERENCE=${
      duplicatePartialRef.length}`

    );

    console.log(
      `REVERSAL_FLAG_MISMATCH=${
      flagMismatch.rowCount}`

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
    console.log("LOYALTY_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      "NEXT_STEP=ANALYZE_IDEMPOTENCY_CONTRACT"
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
    "CLIENTES-LOYALTY-004 IDEMPOTENCY PRECHECK FAILED"
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
