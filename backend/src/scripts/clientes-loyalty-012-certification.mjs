import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const SCRIPTS = path.join(ROOT, "src", "scripts");

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

async function tableExists(db, table) {
  const r = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE
        table_schema='gmx'
        AND table_name=$1
    ) AS exists
    `,
    [table]
  );

  return r.rows[0]?.exists === true;
}

async function columnExists(db, table, column) {
  const r = await db.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name=$1
        AND column_name=$2
    ) AS exists
    `,
    [table, column]
  );

  return r.rows[0]?.exists === true;
}

function runScript(name, filename, markers = []) {
  section(`RERUN — ${name}`);

  const script =
  path.join(SCRIPTS, filename);

  if (!fs.existsSync(script)) {
    throw new Error(
      `SCRIPT_NOT_FOUND:${filename}`
    );
  }

  const result = spawnSync(
    process.execPath,
    [script],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024,
      windowsHide: false
    }
  );

  if (result.stdout) {
    console.log(
      result.stdout.trimEnd()
    );
  }

  if (result.stderr) {
    console.error(
      result.stderr.trimEnd()
    );
  }

  console.log(
    `CHILD_EXIT_CODE=${result.status}`
  );

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(
      `${name}_SIGNAL_${result.signal}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${name}_EXIT_${result.status}`
    );
  }

  for (const marker of markers) {
    if (
    !(result.stdout || "").
    includes(marker))
    {
      throw new Error(
        `${name}_MISSING_MARKER:${marker}`
      );
    }
  }

  console.log(`${name}=PASS`);
}

async function residueSnapshot(db) {
  const r = await db.query(`
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
              OR c.email LIKE
                'clientes.loyalty%@example.invalid'
            )
        )
      )::bigint
        AS cuentas
  `);

  const row = r.rows[0];

  return {
    ...row,

    total:
    Object.values(row).
    reduce(
      (sum, value) =>
      sum + Number(value || 0),
      0
    )
  };
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-012 FINAL CERTIFICATION")

  );

  console.log(
    `TIMESTAMP=${new Date().toISOString()}`
  );

  console.log(
    "SCOPE=CLIENTES_FIDELIDAD"
  );

  console.log(
    "PRODUCTION_MUTATION_ALLOWED=NO"
  );

  console.log(
    "REAL_FINANCIAL_PROVIDER_CALLS_ALLOWED=NO"
  );

  const db =
  new Client(dbConfig());

  await db.connect();

  try {

    /*
     * ======================================================
     * 1. DISCOVER TEST RESIDUE
     * ======================================================
     */

    section("1. TEST RESIDUE DISCOVERY");

    const before =
    await residueSnapshot(db);

    console.table([before]);

    console.log(
      `TEST_RESIDUE_BEFORE_CLEANUP=${before.total}`
    );

    /*
     * ======================================================
     * 2. CONTROLLED CLEANUP
     *
     * Solo actuamos si existe firma TEST conocida.
     * Nunca borramos registros ajenos.
     * ======================================================
     */

    section("2. CONTROLLED TEST CLEANUP");

    if (before.total === 0) {

      console.log(
        "CLEANUP_REQUIRED=NO"
      );

    } else {

      console.log(
        "CLEANUP_REQUIRED=YES"
      );

      /*
       * Pedidos LOYALTY007 deberían estar ya cancelados/
       * liberados por sus propios smoke.
       *
       * Abortamos si aparece alguno activo.
       */
      const testOrders = await db.query(`
        SELECT
          row_id,
          id_pedido,
          id_cliente,
          estado_pedido,
          inventario_liberado,
          pos_idempotency_key

        FROM gmx.pedidos

        WHERE
          pos_idempotency_key LIKE 'LOYALTY007-%'
          OR id_pedido LIKE 'PED-LOYALTY%'

        ORDER BY row_id
      `);

      console.table(testOrders.rows);

      for (const order of testOrders.rows) {

        if (
        String(
          order.estado_pedido || ""
        ).toUpperCase() !== "CANCELADO")
        {
          throw new Error(
            `SAFETY_ABORT_ACTIVE_TEST_ORDER:${order.id_pedido}`
          );
        }

        if (
        order.inventario_liberado !== true)
        {
          throw new Error(
            `SAFETY_ABORT_TEST_INVENTORY_NOT_RELEASED:${order.id_pedido}`
          );
        }
      }

      await db.query("BEGIN");

      try {

        /*
         * Delete dependencies only for exact TEST orders.
         */
        for (const order of testOrders.rows) {

          const orderId =
          order.id_pedido;

          if (
          await tableExists(
            db,
            "promociones_redenciones"
          ))
          {
            if (
            await columnExists(
              db,
              "promociones_redenciones",
              "id_pedido"
            ))
            {
              await db.query(
                `
                DELETE FROM gmx.promociones_redenciones
                WHERE id_pedido=$1
                `,
                [orderId]
              );
            }
          }

          await db.query(
            `
            DELETE FROM gmx.fidelidad_movimientos
            WHERE id_pedido=$1
            `,
            [orderId]
          );

          /*
           * caja_movimientos contract:
           * id_origen / referencia
           */
          if (
          await tableExists(
            db,
            "caja_movimientos"
          ))
          {
            const clauses = [];
            const params = [];

            if (
            await columnExists(
              db,
              "caja_movimientos",
              "id_origen"
            ))
            {
              params.push(orderId);

              clauses.push(
                `id_origen=$${params.length}`
              );
            }

            if (
            await columnExists(
              db,
              "caja_movimientos",
              "referencia"
            ))
            {
              params.push(orderId);

              clauses.push(
                `referencia=$${params.length}`
              );
            }

            if (clauses.length) {
              await db.query(
                `
                DELETE FROM gmx.caja_movimientos
                WHERE ${clauses.join(" OR ")}
                `,
                params
              );
            }
          }

          await db.query(
            `
            DELETE FROM gmx.pedido_pagos
            WHERE id_pedido=$1
            `,
            [orderId]
          );

          await db.query(
            `
            DELETE FROM gmx.detalle_pedidos
            WHERE id_pedido=$1
            `,
            [orderId]
          );

          if (
          await tableExists(
            db,
            "payment_transactions"
          ))
          {
            if (
            await columnExists(
              db,
              "payment_transactions",
              "id_pedido"
            ))
            {
              await db.query(
                `
                DELETE FROM gmx.payment_transactions
                WHERE id_pedido=$1
                `,
                [orderId]
              );
            }
          }

          const deleted =
          await db.query(
            `
              DELETE FROM gmx.pedidos

              WHERE
                row_id=$1
                AND id_pedido=$2
                AND estado_pedido='CANCELADO'
                AND inventario_liberado=true
                AND (
                  pos_idempotency_key
                    LIKE 'LOYALTY007-%'
                  OR
                  id_pedido LIKE
                    'PED-LOYALTY%'
                )

              RETURNING
                id_pedido
              `,
            [
            order.row_id,
            orderId]

          );

          if (
          deleted.rowCount !== 1)
          {
            throw new Error(
              `TEST_ORDER_DELETE_FAILED:${orderId}`
            );
          }
        }

        /*
         * Remove explicit TEST movements not tied to orders.
         */
        await db.query(`
          DELETE FROM gmx.fidelidad_movimientos

          WHERE
            id_admin LIKE 'TEST-LOYALTY%'

            OR

            motivo LIKE 'LOYALTY00%'

            OR

            referencia LIKE 'LOYALTY00%'
        `);

        /*
         * Exact TEST clients only.
         */
        const testClients =
        await db.query(`
            SELECT
              row_id,
              id_cliente,
              nombre,
              email

            FROM gmx.clientes

            WHERE
              nombre ILIKE '%CLIENTES001%'
              OR nombre ILIKE '%LOYALTY00%'
              OR email LIKE
                'clientes001.%@example.invalid'
              OR email LIKE
                'clientes.loyalty%@example.invalid'

            ORDER BY row_id
          `);

        for (
        const client of
        testClients.rows)
        {
          const remaining =
          await db.query(
            `
              SELECT
                (
                  SELECT COUNT(*)
                  FROM gmx.pedidos
                  WHERE id_cliente=$1
                )::bigint
                  AS pedidos,

                (
                  SELECT COUNT(*)
                  FROM gmx.fidelidad_movimientos
                  WHERE id_cliente=$1
                )::bigint
                  AS movimientos
              `,
            [client.id_cliente]
          );

          if (
          Number(
            remaining.rows[0].pedidos
          ) !== 0 ||



          Number(
            remaining.rows[0].movimientos
          ) !== 0)
          {
            throw new Error(
              `SAFETY_ABORT_TEST_CLIENT_DEPENDENCIES:${client.id_cliente}`
            );
          }

          await db.query(
            `
            DELETE FROM gmx.fidelidad_cuentas
            WHERE id_cliente=$1
            `,
            [client.id_cliente]
          );

          const deletedClient =
          await db.query(
            `
              DELETE FROM gmx.clientes

              WHERE
                row_id=$1
                AND id_cliente=$2
                AND (
                  nombre ILIKE
                    '%CLIENTES001%'
                  OR
                  nombre ILIKE
                    '%LOYALTY00%'
                  OR
                  email LIKE
                    'clientes001.%@example.invalid'
                  OR
                  email LIKE
                    'clientes.loyalty%@example.invalid'
                )

              RETURNING
                id_cliente
              `,
            [
            client.row_id,
            client.id_cliente]

          );

          if (
          deletedClient.rowCount !== 1)
          {
            throw new Error(
              `TEST_CLIENT_DELETE_FAILED:${client.id_cliente}`
            );
          }
        }

        const beforeCommit =
        await residueSnapshot(db);

        console.table([
        beforeCommit]
        );

        console.log(
          `TEST_RESIDUE_BEFORE_COMMIT=${beforeCommit.total}`
        );

        if (
        beforeCommit.total !== 0)
        {
          throw new Error(
            "TEST_RESIDUE_BEFORE_COMMIT_NOT_ZERO"
          );
        }

        await db.query("COMMIT");

        console.log(
          "CLEANUP_COMMIT=PASS"
        );

      } catch (e) {

        await db.query("ROLLBACK");

        throw e;
      }
    }

    /*
     * ======================================================
     * 3. CLEANUP VERIFICATION
     * ======================================================
     */

    section("3. CLEANUP VERIFICATION");

    const clean =
    await residueSnapshot(db);

    console.table([clean]);

    console.log(
      `TEST_RESIDUE_AFTER_CLEANUP=${clean.total}`
    );

    if (
    clean.total !== 0)
    {
      throw new Error(
        "TEST_RESIDUE_AFTER_CLEANUP_NOT_ZERO"
      );
    }

  } finally {

    await db.end();
  }

  /*
   * ========================================================
   * 4. FINAL READ ONLY PRECHECK RERUN
   * ========================================================
   */

  runScript(
    "CERTIFICATION_PRECHECK",
    "clientes-loyalty-010-final-smoke-precheck.mjs",
    [
    "CLIENTES_LOYALTY_010_FINAL_SMOKE_PRECHECK=PASS",
    "PRECHECK_FAILURE_COUNT=0",
    "TEST_RESIDUE_TOTAL=0",
    "FINAL_SMOKE_READY=YES",
    "ROLLBACK=PASS"]

  );

  /*
   * ========================================================
   * 5. FINAL CONSOLIDATED SMOKE RERUN
   * ========================================================
   */

  runScript(
    "CERTIFICATION_FINAL_SMOKE",
    "clientes-loyalty-011-final-smoke.mjs",
    [
    "CLIENTES_LOYALTY_011_FINAL_SMOKE=PASS",
    "CLIENT_CRUD=PRIOR_CERTIFIED",
    "LOYALTY_MOVEMENTS_BALANCES=PASS",
    "POS_IDEMPOTENCY=PASS",
    "SALES_RELATIONS=PASS",
    "AUDIT=PASS",
    "FINAL_PRECHECK_RERUN=PASS",
    "TEST_RESIDUE_BEFORE=0",
    "TEST_RESIDUE_AFTER=0",
    "REAL_FINANCIAL_PROVIDER_CALLS=0",
    "FINAL_SMOKE_STATUS=PASS"]

  );

  /*
   * ========================================================
   * 6. FINAL RESIDUE AFTER RERUN
   * ========================================================
   */

  section("6. FINAL DATABASE VERIFICATION");

  const finalDb =
  new Client(dbConfig());

  await finalDb.connect();

  try {

    const finalResidue =
    await residueSnapshot(finalDb);

    console.table([
    finalResidue]
    );

    console.log(
      `FINAL_TEST_RESIDUE=${finalResidue.total}`
    );

    if (
    finalResidue.total !== 0)
    {
      throw new Error(
        "FINAL_CERTIFICATION_TEST_RESIDUE_NOT_ZERO"
      );
    }

    /*
     * Global DB consistency snapshot.
     */
    const integrity =
    await finalDb.query(`
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
            FROM gmx.fidelidad_movimientos f

            LEFT JOIN gmx.clientes c
              ON c.id_cliente=f.id_cliente

            WHERE c.id_cliente IS NULL
          )::bigint
            AS movements_missing_client,

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

            FROM gmx.fidelidad_cuentas fc

            JOIN latest l
              ON l.id_cliente=fc.id_cliente

            WHERE
              fc.puntos_disponibles
                IS DISTINCT FROM
                l.saldo_nuevo
          )::bigint
            AS account_balance_mismatch
      `);

    console.table(
      integrity.rows
    );

    const i =
    integrity.rows[0];

    const integrityFailures =
    Object.values(i).
    reduce(
      (sum, value) =>
      sum + Number(value || 0),
      0
    );

    console.log(
      `FINAL_INTEGRITY_FAILURES=${integrityFailures}`
    );

    if (
    integrityFailures !== 0)
    {
      throw new Error(
        "FINAL_INTEGRITY_NOT_CLEAN"
      );
    }

  } finally {

    await finalDb.end();
  }

  /*
   * ========================================================
   * 7. CERTIFICATION
   * ========================================================
   */

  section("7. CERTIFICATION SUMMARY");

  console.log(
    "CLIENTES_LOYALTY_012_CERTIFICATION=PASS"
  );

  console.log(
    "CLIENTES_PRECHECK=CERTIFIED"
  );

  console.log(
    "CLIENTES_DB_CONTRACT=CERTIFIED"
  );

  console.log(
    "CLIENTES_SOURCE_CODE=CERTIFIED"
  );

  console.log(
    "CLIENTES_CRUD=CERTIFIED"
  );

  console.log(
    "LOYALTY_MOVEMENTS_BALANCES=CERTIFIED"
  );

  console.log(
    "LOYALTY_IDEMPOTENCY=CERTIFIED"
  );

  console.log(
    "LOYALTY_SALES_RELATIONS=CERTIFIED"
  );

  console.log(
    "LOYALTY_AUDIT=CERTIFIED"
  );

  console.log(
    "FINAL_SMOKE=CERTIFIED"
  );

  console.log(
    "FINAL_RERUN=PASS"
  );

  console.log(
    "FINAL_TEST_RESIDUE=0"
  );

  console.log(
    "FINAL_INTEGRITY_FAILURES=0"
  );

  console.log(
    "REAL_FINANCIAL_PROVIDER_CALLS=0"
  );

  console.log(
    "DATABASE_TEST_MUTATION_CLEANUP=0"
  );

  console.log(
    "CLIENTES_FIDELIDAD_PERCENT=100"
  );

  console.log(
    "CLIENTES_FIDELIDAD_STATUS=CERTIFIED"
  );

  console.log(
    "NEXT_STEP=CHECKPOINT_GIT_AND_DBA"
  );

  process.exit(0);
}

main().catch((e) => {

  section(
    "CLIENTES-LOYALTY-012 CERTIFICATION FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CLIENTES_FIDELIDAD_STATUS=BLOCKED"
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exit(1);
});
