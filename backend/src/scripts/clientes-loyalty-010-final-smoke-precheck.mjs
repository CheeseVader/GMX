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
      "READ_ONLY_GUARD:" +
      normalized.slice(0, 100)
    );
  }

  return db.query(sql, params);
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-010 FINAL SMOKE PRECHECK")

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
   * 1. GIT
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
    console.log("");
    console.log("GIT_STATUS:");
    console.log(status);
  }

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
      "SET LOCAL statement_timeout='30000ms'"
    );

    await db.query(
      "SET LOCAL lock_timeout='3000ms'"
    );

    /*
     * =======================================================
     * 2. DB SAFETY
     * =======================================================
     */

    section("2. DATABASE SAFETY");

    const safety = await q(db, `
      SELECT
        current_database() AS database,
        current_user AS db_user,
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,
        current_setting(
          'transaction_isolation'
        ) AS transaction_isolation
    `);

    console.table(safety.rows);

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
     * 3. GLOBAL TEST RESIDUE
     * =======================================================
     */

    section("3. GLOBAL CLIENTES / LOYALTY TEST RESIDUE");

    const residue = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE
            nombre ILIKE '%CLIENTES001%'
            OR nombre ILIKE '%LOYALTY00%'
            OR email LIKE 'clientes001.%@example.invalid'
            OR email LIKE 'clientes.loyalty%@example.invalid'
        )::bigint
          AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE
            pos_idempotency_key LIKE 'LOYALTY007-%'
            OR id_pedido LIKE 'PED-LOYALTY%'
        )::bigint
          AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE
            id_admin LIKE 'TEST-LOYALTY%'
            OR motivo LIKE 'LOYALTY00%'
            OR referencia LIKE 'LOYALTY00%'
        )::bigint
          AS movimientos,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_cuentas fc
          WHERE EXISTS (
            SELECT 1
            FROM gmx.clientes c
            WHERE
              c.id_cliente=fc.id_cliente
              AND (
                c.nombre ILIKE '%LOYALTY00%'
                OR c.email LIKE 'clientes.loyalty%@example.invalid'
              )
          )
        )::bigint
          AS cuentas
    `);

    console.table(residue.rows);

    const totalResidue =
    Object.values(residue.rows[0]).
    reduce(
      (sum, value) =>
      sum + Number(value || 0),
      0
    );

    console.log(
      `TEST_RESIDUE_TOTAL=${totalResidue}`
    );

    /*
     * =======================================================
     * 4. CLIENT RELATION
     * =======================================================
     */

    section("4. CLIENT RELATION INTEGRITY");

    const clientIntegrity = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.pedidos p
          LEFT JOIN gmx.clientes c
            ON c.id_cliente=p.id_cliente
          WHERE
            p.id_cliente IS NOT NULL
            AND btrim(p.id_cliente)<>''
            AND c.id_cliente IS NULL
        )::bigint
          AS orders_missing_client,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_cuentas fc
          LEFT JOIN gmx.clientes c
            ON c.id_cliente=fc.id_cliente
          WHERE c.id_cliente IS NULL
        )::bigint
          AS accounts_missing_client,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos f
          LEFT JOIN gmx.clientes c
            ON c.id_cliente=f.id_cliente
          WHERE c.id_cliente IS NULL
        )::bigint
          AS movements_missing_client
    `);

    console.table(clientIntegrity.rows);

    /*
     * =======================================================
     * 5. SALES RELATION
     * =======================================================
     */

    section("5. SALES / LOYALTY RELATION");

    const salesRelation = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos f
          LEFT JOIN gmx.pedidos p
            ON p.id_pedido=f.id_pedido
          WHERE
            f.id_pedido IS NOT NULL
            AND btrim(f.id_pedido)<>''
            AND p.id_pedido IS NULL
        )::bigint
          AS movements_missing_order,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos f
          JOIN gmx.pedidos p
            ON p.id_pedido=f.id_pedido
          WHERE
            f.id_cliente
              IS DISTINCT FROM
              p.id_cliente
        )::bigint
          AS order_client_mismatch
    `);

    console.table(salesRelation.rows);

    /*
     * =======================================================
     * 6. ORDER LEDGER
     * =======================================================
     */

    section("6. ORDER LEDGER CONSISTENCY");

    const ledgerMismatch = await q(db, `
      WITH ledger AS (
        SELECT
          id_pedido,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='GENERACION'
                THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint AS generated,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='REDENCION'
                THEN ABS(puntos)
                ELSE 0
              END
            ),
            0
          )::bigint AS redeemed

        FROM gmx.fidelidad_movimientos

        WHERE
          id_pedido IS NOT NULL
          AND btrim(id_pedido)<>''

        GROUP BY id_pedido
      )

      SELECT COUNT(*)::bigint AS mismatches

      FROM gmx.pedidos p

      LEFT JOIN ledger l
        ON l.id_pedido=p.id_pedido

      WHERE
        COALESCE(
          p.puntos_generados,
          0
        ) <> COALESCE(
          l.generated,
          0
        )

        OR

        COALESCE(
          p.puntos_redimidos,
          0
        ) <> COALESCE(
          l.redeemed,
          0
        )
    `);

    console.table(
      ledgerMismatch.rows
    );

    /*
     * =======================================================
     * 7. BALANCE CHAIN
     * =======================================================
     */

    section("7. BALANCE CHAIN");

    const chain = await q(db, `
      WITH ordered AS (
        SELECT
          row_id,
          id_cliente,
          saldo_anterior,
          saldo_nuevo,

          LAG(saldo_nuevo)
            OVER (
              PARTITION BY id_cliente
              ORDER BY row_id
            )
            AS previous_balance

        FROM gmx.fidelidad_movimientos
      )

      SELECT COUNT(*)::bigint AS broken

      FROM ordered

      WHERE
        previous_balance IS NOT NULL
        AND
        saldo_anterior
          IS DISTINCT FROM
          previous_balance
    `);

    console.table(chain.rows);

    /*
     * =======================================================
     * 8. MOVEMENT ARITHMETIC
     * =======================================================
     */

    section("8. MOVEMENT ARITHMETIC");

    const arithmetic = await q(db, `
      SELECT COUNT(*)::bigint AS errors

      FROM gmx.fidelidad_movimientos

      WHERE
        saldo_anterior IS NULL
        OR saldo_nuevo IS NULL
        OR
        saldo_nuevo <>
        GREATEST(
          0,
          saldo_anterior + puntos
        )
    `);

    console.table(arithmetic.rows);

    /*
     * =======================================================
     * 9. DUPLICATES / IDEMPOTENCY
     * =======================================================
     */

    section("9. IDEMPOTENCY / DUPLICATES");

    const idem = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM (
            SELECT
              pos_idempotency_key
            FROM gmx.pedidos
            WHERE
              pos_idempotency_key IS NOT NULL
              AND btrim(pos_idempotency_key)<>''
            GROUP BY pos_idempotency_key
            HAVING COUNT(*) > 1
          ) x
        )::bigint AS duplicate_pos_keys,

        (
          SELECT COUNT(*)
          FROM (
            SELECT
              id_movimiento
            FROM gmx.fidelidad_movimientos
            GROUP BY id_movimiento
            HAVING COUNT(*) > 1
          ) x
        )::bigint AS duplicate_movement_ids,

        (
          SELECT COUNT(*)
          FROM (
            SELECT
              reversa_de
            FROM gmx.fidelidad_movimientos
            WHERE
              reversa_de IS NOT NULL
              AND btrim(reversa_de)<>''
            GROUP BY reversa_de
            HAVING COUNT(*) > 1
          ) x
        )::bigint AS duplicate_reversal_targets
    `);

    console.table(idem.rows);

    /*
     * =======================================================
     * 10. ACCOUNT BALANCE
     * =======================================================
     */

    section("10. ACCOUNT BALANCE VS LEDGER");

    const accountMismatch = await q(db, `
      WITH latest AS (
        SELECT DISTINCT ON (
          id_cliente
        )
          id_cliente,
          saldo_nuevo

        FROM gmx.fidelidad_movimientos

        ORDER BY
          id_cliente,
          row_id DESC
      )

      SELECT COUNT(*)::bigint AS mismatches

      FROM gmx.fidelidad_cuentas fc

      JOIN latest l
        ON l.id_cliente=fc.id_cliente

      WHERE
        fc.puntos_disponibles
          IS DISTINCT FROM
          l.saldo_nuevo
    `);

    console.table(
      accountMismatch.rows
    );

    /*
     * =======================================================
     * 11. AUDIT COVERAGE
     * =======================================================
     */

    section("11. AUDIT COVERAGE");

    const audit = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE
            id_movimiento IS NULL
            OR btrim(id_movimiento)=''
        )::bigint
          AS missing_movement_id,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE fecha IS NULL
        )::bigint
          AS missing_date,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE
            id_admin IS NULL
            OR btrim(id_admin)=''
            OR administrador IS NULL
            OR btrim(administrador)=''
        )::bigint
          AS incomplete_actor,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE
            tipo='AJUSTE'
            AND (
              motivo IS NULL
              OR btrim(motivo)=''
              OR referencia IS NULL
              OR btrim(referencia)=''
            )
        )::bigint
          AS incomplete_adjustment_audit
    `);

    console.table(audit.rows);

    /*
     * =======================================================
     * 12. REVERSAL AUDIT
     * =======================================================
     */

    section("12. REVERSAL AUDIT");

    const reversal = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE
            tipo='REVERSA'
            AND (
              reversa_de IS NULL
              OR btrim(reversa_de)=''
            )
        )::bigint
          AS reversal_without_target,

        (
          SELECT COUNT(*)

          FROM gmx.fidelidad_movimientos r

          LEFT JOIN gmx.fidelidad_movimientos o
            ON o.id_movimiento=r.reversa_de

          WHERE
            r.tipo='REVERSA'

            AND (
              o.id_movimiento IS NULL

              OR
              o.id_cliente
                IS DISTINCT FROM
                r.id_cliente

              OR
              o.id_pedido
                IS DISTINCT FROM
                r.id_pedido
            )
        )::bigint
          AS invalid_reversal_target
    `);

    console.table(reversal.rows);

    /*
     * =======================================================
     * 13. CANCELLED SALES
     * =======================================================
     */

    section("13. CANCELLED SALES LOYALTY");

    const cancelled = await q(db, `
      WITH state AS (
        SELECT
          id_pedido,

          COUNT(*) FILTER (
            WHERE tipo='GENERACION'
          )::bigint AS generation_rows,

          COUNT(*) FILTER (
            WHERE tipo='REDENCION'
          )::bigint AS redemption_rows,

          COUNT(*) FILTER (
            WHERE tipo='REVERSA'
          )::bigint AS reversal_rows

        FROM gmx.fidelidad_movimientos

        GROUP BY id_pedido
      )

      SELECT COUNT(*)::bigint AS suspicious

      FROM gmx.pedidos p

      LEFT JOIN state s
        ON s.id_pedido=p.id_pedido

      WHERE
        UPPER(
          COALESCE(
            p.estado_pedido,
            ''
          )
        )='CANCELADO'

        AND (
          COALESCE(
            s.generation_rows,
            0
          ) > 0

          OR

          COALESCE(
            s.redemption_rows,
            0
          ) > 0
        )

        AND COALESCE(
          s.reversal_rows,
          0
        )=0
    `);

    console.table(cancelled.rows);

    /*
     * =======================================================
     * 14. FINAL SAFETY
     * =======================================================
     */

    section("14. FINAL READ ONLY SAFETY");

    const finalSafety = await q(db, `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,
        NOW() AS checked_at
    `);

    console.table(finalSafety.rows);

    if (
    finalSafety.rows[0]?.
    transaction_read_only !== "on")
    {
      throw new Error(
        "FINAL_READ_ONLY_CHECK_FAILED"
      );
    }

    /*
     * =======================================================
     * BUILD SCORE
     * =======================================================
     */

    const checks = {
      test_residue:
      totalResidue,

      orders_missing_client:
      Number(
        clientIntegrity.
        rows[0].
        orders_missing_client
      ),

      accounts_missing_client:
      Number(
        clientIntegrity.
        rows[0].
        accounts_missing_client
      ),

      movements_missing_client:
      Number(
        clientIntegrity.
        rows[0].
        movements_missing_client
      ),

      movements_missing_order:
      Number(
        salesRelation.
        rows[0].
        movements_missing_order
      ),

      order_client_mismatch:
      Number(
        salesRelation.
        rows[0].
        order_client_mismatch
      ),

      order_ledger_mismatch:
      Number(
        ledgerMismatch.
        rows[0].
        mismatches
      ),

      broken_balance_chain:
      Number(
        chain.rows[0].broken
      ),

      arithmetic_errors:
      Number(
        arithmetic.rows[0].errors
      ),

      duplicate_pos_keys:
      Number(
        idem.rows[0].
        duplicate_pos_keys
      ),

      duplicate_movement_ids:
      Number(
        idem.rows[0].
        duplicate_movement_ids
      ),

      duplicate_reversal_targets:
      Number(
        idem.rows[0].
        duplicate_reversal_targets
      ),

      account_balance_mismatch:
      Number(
        accountMismatch.
        rows[0].
        mismatches
      ),

      missing_movement_id:
      Number(
        audit.rows[0].
        missing_movement_id
      ),

      missing_date:
      Number(
        audit.rows[0].
        missing_date
      ),

      incomplete_actor:
      Number(
        audit.rows[0].
        incomplete_actor
      ),

      incomplete_adjustment_audit:
      Number(
        audit.rows[0].
        incomplete_adjustment_audit
      ),

      reversal_without_target:
      Number(
        reversal.rows[0].
        reversal_without_target
      ),

      invalid_reversal_target:
      Number(
        reversal.rows[0].
        invalid_reversal_target
      ),

      cancelled_suspicious:
      Number(
        cancelled.rows[0].
        suspicious
      )
    };

    const totalFailures =
    Object.values(checks).
    reduce(
      (sum, value) =>
      sum + Number(value || 0),
      0
    );

    await db.query("ROLLBACK");
    tx = false;

    /*
     * =======================================================
     * 15. SUMMARY
     * =======================================================
     */

    section("15. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_010_FINAL_SMOKE_PRECHECK=PASS"
    );

    console.log(
      `PRECHECK_FAILURE_COUNT=${totalFailures}`
    );

    console.log(
      `TEST_RESIDUE_TOTAL=${totalResidue}`
    );

    console.log(
      `HEAD_EQ_ORIGIN_MAIN=${
      head === origin ? "YES" : "NO"}`

    );

    console.log(
      `GIT_CLEAN=${
      status ? "NO" : "YES"}`

    );

    console.log(
      `ORDERS_MISSING_CLIENT=${
      checks.orders_missing_client}`

    );

    console.log(
      `ACCOUNTS_MISSING_CLIENT=${
      checks.accounts_missing_client}`

    );

    console.log(
      `MOVEMENTS_MISSING_CLIENT=${
      checks.movements_missing_client}`

    );

    console.log(
      `MOVEMENTS_MISSING_ORDER=${
      checks.movements_missing_order}`

    );

    console.log(
      `ORDER_CLIENT_MISMATCH=${
      checks.order_client_mismatch}`

    );

    console.log(
      `ORDER_LEDGER_MISMATCH=${
      checks.order_ledger_mismatch}`

    );

    console.log(
      `BROKEN_BALANCE_CHAIN=${
      checks.broken_balance_chain}`

    );

    console.log(
      `MOVEMENT_ARITHMETIC_ERRORS=${
      checks.arithmetic_errors}`

    );

    console.log(
      `DUPLICATE_POS_KEYS=${
      checks.duplicate_pos_keys}`

    );

    console.log(
      `DUPLICATE_MOVEMENT_IDS=${
      checks.duplicate_movement_ids}`

    );

    console.log(
      `DUPLICATE_REVERSAL_TARGETS=${
      checks.duplicate_reversal_targets}`

    );

    console.log(
      `ACCOUNT_BALANCE_MISMATCH=${
      checks.account_balance_mismatch}`

    );

    console.log(
      `AUDIT_INCOMPLETE_ACTOR=${
      checks.incomplete_actor}`

    );

    console.log(
      `AUDIT_INCOMPLETE_ADJUSTMENT=${
      checks.incomplete_adjustment_audit}`

    );

    console.log(
      `INVALID_REVERSAL_TARGET=${
      checks.invalid_reversal_target}`

    );

    console.log(
      `CANCELLED_SUSPICIOUS=${
      checks.cancelled_suspicious}`

    );

    console.log("MODE=READ_ONLY");
    console.log("DATABASE_MUTATION=0");
    console.log("FINANCIAL_MUTATION=0");
    console.log("SALES_MUTATION=0");
    console.log("LOYALTY_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      totalFailures === 0 ?
      "FINAL_SMOKE_READY=YES" :
      "FINAL_SMOKE_READY=NO"
    );

    console.log(
      totalFailures === 0 ?
      "NEXT_STEP=CLIENTES_LOYALTY_011_FINAL_SMOKE" :
      "NEXT_STEP=ANALYZE_FINAL_PRECHECK_FINDINGS"
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
    "CLIENTES-LOYALTY-010 FINAL SMOKE PRECHECK FAILED"
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
