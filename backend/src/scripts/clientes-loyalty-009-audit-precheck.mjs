import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { fileURLToPath } from "node:url";

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
  section(brandText("GMX — CLIENTES-LOYALTY-009 AUDIT PRECHECK")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log("LOYALTY_MUTATION_ALLOWED=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const db = new Client(dbConfig());
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

    section("1. DATABASE SAFETY");

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

    section("2. LOYALTY MOVEMENT TYPE DISTRIBUTION");

    const types = await q(db, `
      SELECT
        tipo,
        COUNT(*)::bigint AS rows,
        COALESCE(SUM(puntos),0)::bigint
          AS points_sum
      FROM gmx.fidelidad_movimientos
      GROUP BY tipo
      ORDER BY tipo
    `);

    console.table(types.rows);

    const allowedTypes = new Set([
    "AJUSTE",
    "GENERACION",
    "REDENCION",
    "REVERSA",
    "DEVOLUCION_RETIRO"]
    );

    const unexpectedTypes =
    types.rows.filter(
      (r) =>
      !allowedTypes.has(
        String(r.tipo || "").toUpperCase()
      )
    );

    console.log(
      `UNEXPECTED_MOVEMENT_TYPES=${unexpectedTypes.length}`
    );

    if (unexpectedTypes.length) {
      console.table(unexpectedTypes);
    }

    section("3. MOVEMENTS WITHOUT IDENTIFIER");

    const noId = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        tipo,
        puntos,
        fecha
      FROM gmx.fidelidad_movimientos
      WHERE
        id_movimiento IS NULL
        OR btrim(id_movimiento)=''
      ORDER BY row_id
    `);

    console.log(
      `MOVEMENTS_WITHOUT_ID=${noId.rowCount}`
    );

    if (noId.rowCount) {
      console.table(noId.rows);
    }

    section("4. DUPLICATE MOVEMENT IDS");

    const duplicateIds = await q(db, `
      SELECT
        id_movimiento,
        COUNT(*)::bigint AS occurrences
      FROM gmx.fidelidad_movimientos
      WHERE
        id_movimiento IS NOT NULL
        AND btrim(id_movimiento)<>''
      GROUP BY id_movimiento
      HAVING COUNT(*) > 1
      ORDER BY occurrences DESC,id_movimiento
    `);

    console.log(
      `DUPLICATE_MOVEMENT_IDS=${duplicateIds.rowCount}`
    );

    if (duplicateIds.rowCount) {
      console.table(duplicateIds.rows);
    }

    section("5. MOVEMENTS WITHOUT CLIENT");

    const noClient = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        id_pedido,
        tipo,
        puntos,
        fecha
      FROM gmx.fidelidad_movimientos
      WHERE
        id_cliente IS NULL
        OR btrim(id_cliente)=''
      ORDER BY row_id
    `);

    console.log(
      `MOVEMENTS_WITHOUT_CLIENT=${noClient.rowCount}`
    );

    if (noClient.rowCount) {
      console.table(noClient.rows);
    }

    section("6. MOVEMENTS WITHOUT DATE");

    const noDate = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        tipo,
        puntos
      FROM gmx.fidelidad_movimientos
      WHERE fecha IS NULL
      ORDER BY row_id
    `);

    console.log(
      `MOVEMENTS_WITHOUT_DATE=${noDate.rowCount}`
    );

    if (noDate.rowCount) {
      console.table(noDate.rows);
    }

    section("7. AUDIT ACTOR COVERAGE");

    const actorCoverage = await q(db, `
      SELECT
        tipo,

        COUNT(*)::bigint AS movements,

        COUNT(*) FILTER (
          WHERE
            id_admin IS NULL
            OR btrim(id_admin)=''
        )::bigint AS missing_admin_id,

        COUNT(*) FILTER (
          WHERE
            administrador IS NULL
            OR btrim(administrador)=''
        )::bigint AS missing_admin_name

      FROM gmx.fidelidad_movimientos

      GROUP BY tipo

      ORDER BY tipo
    `);

    console.table(actorCoverage.rows);

    const missingActor = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        id_pedido,
        tipo,
        puntos,
        id_admin,
        administrador,
        motivo,
        referencia,
        fecha

      FROM gmx.fidelidad_movimientos

      WHERE
        (
          id_admin IS NULL
          OR btrim(id_admin)=''
        )
        OR
        (
          administrador IS NULL
          OR btrim(administrador)=''
        )

      ORDER BY row_id
    `);

    console.log(
      `MOVEMENTS_WITH_INCOMPLETE_ACTOR=${
      missingActor.rowCount}`

    );

    if (missingActor.rowCount) {
      console.table(missingActor.rows);
    }

    section("8. ADJUSTMENTS WITHOUT REASON");

    const adjustmentReason = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        puntos,
        saldo_anterior,
        saldo_nuevo,
        referencia,
        motivo,
        id_admin,
        administrador,
        fecha

      FROM gmx.fidelidad_movimientos

      WHERE
        tipo='AJUSTE'
        AND (
          motivo IS NULL
          OR btrim(motivo)=''
        )

      ORDER BY row_id
    `);

    console.log(
      `ADJUSTMENTS_WITHOUT_REASON=${
      adjustmentReason.rowCount}`

    );

    if (adjustmentReason.rowCount) {
      console.table(adjustmentReason.rows);
    }

    section("9. ADJUSTMENTS WITHOUT REFERENCE");

    const adjustmentRef = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        puntos,
        motivo,
        referencia,
        fecha

      FROM gmx.fidelidad_movimientos

      WHERE
        tipo='AJUSTE'
        AND (
          referencia IS NULL
          OR btrim(referencia)=''
        )

      ORDER BY row_id
    `);

    console.log(
      `ADJUSTMENTS_WITHOUT_REFERENCE=${
      adjustmentRef.rowCount}`

    );

    if (adjustmentRef.rowCount) {
      console.table(adjustmentRef.rows);
    }

    section("10. SALES MOVEMENTS WITHOUT ORDER");

    const salesNoOrder = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        id_pedido,
        tipo,
        puntos,
        referencia,
        motivo,
        fecha

      FROM gmx.fidelidad_movimientos

      WHERE
        tipo IN (
          'GENERACION',
          'REDENCION',
          'REVERSA',
          'DEVOLUCION_RETIRO'
        )

        AND (
          id_pedido IS NULL
          OR btrim(id_pedido)=''
        )

      ORDER BY row_id
    `);

    console.log(
      `SALES_MOVEMENTS_WITHOUT_ORDER=${
      salesNoOrder.rowCount}`

    );

    if (salesNoOrder.rowCount) {
      console.table(salesNoOrder.rows);
    }

    section("11. REVERSALS WITHOUT REVERSA_DE");

    const reversalNoOriginal = await q(db, `
      SELECT
        row_id,
        id_movimiento,
        id_cliente,
        id_pedido,
        puntos,
        reversa_de,
        motivo,
        referencia,
        fecha

      FROM gmx.fidelidad_movimientos

      WHERE
        tipo='REVERSA'
        AND (
          reversa_de IS NULL
          OR btrim(reversa_de)=''
        )

      ORDER BY row_id
    `);

    console.log(
      `REVERSALS_WITHOUT_REVERSA_DE=${
      reversalNoOriginal.rowCount}`

    );

    if (reversalNoOriginal.rowCount) {
      console.table(
        reversalNoOriginal.rows
      );
    }

    section("12. REVERSA_DE TARGET VALIDITY");

    const invalidReverseTarget = await q(db, `
      SELECT
        r.row_id,
        r.id_movimiento,
        r.id_pedido,
        r.id_cliente,
        r.puntos,
        r.reversa_de,

        o.id_movimiento
          AS original_id,

        o.id_cliente
          AS original_client,

        o.id_pedido
          AS original_order,

        o.tipo
          AS original_type,

        o.puntos
          AS original_points

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

      ORDER BY r.row_id
    `);

    console.log(
      `INVALID_REVERSA_DE_TARGET=${
      invalidReverseTarget.rowCount}`

    );

    if (invalidReverseTarget.rowCount) {
      console.table(
        invalidReverseTarget.rows
      );
    }

    section("13. DUPLICATE REVERSAL TARGETS");

    const duplicateReverseTargets = await q(db, `
      SELECT
        reversa_de,
        COUNT(*)::bigint
          AS reversal_count

      FROM gmx.fidelidad_movimientos

      WHERE
        tipo='REVERSA'
        AND reversa_de IS NOT NULL
        AND btrim(reversa_de)<>''

      GROUP BY reversa_de

      HAVING COUNT(*) > 1

      ORDER BY
        reversal_count DESC,
        reversa_de
    `);

    console.log(
      `DUPLICATE_REVERSAL_TARGETS=${
      duplicateReverseTargets.rowCount}`

    );

    if (duplicateReverseTargets.rowCount) {
      console.table(
        duplicateReverseTargets.rows
      );
    }

    section("14. BALANCE ARITHMETIC AUDIT");

    const arithmetic = await q(db, `
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
        OR
        saldo_nuevo <>
        GREATEST(
          0,
          saldo_anterior + puntos
        )

      ORDER BY row_id
    `);

    console.log(
      `MOVEMENT_ARITHMETIC_ERRORS=${
      arithmetic.rowCount}`

    );

    if (arithmetic.rowCount) {
      console.table(arithmetic.rows);
    }

    section("15. BALANCE CHAIN AUDIT");

    const chain = await q(db, `
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

          LAG(saldo_nuevo)
            OVER (
              PARTITION BY id_cliente
              ORDER BY row_id
            )
            AS previous_balance

        FROM gmx.fidelidad_movimientos
      )

      SELECT
        *

      FROM ordered

      WHERE
        previous_balance IS NOT NULL

        AND
        saldo_anterior
          IS DISTINCT FROM
          previous_balance

      ORDER BY id_cliente,row_id
    `);

    console.log(
      `BROKEN_BALANCE_CHAIN=${chain.rowCount}`
    );

    if (chain.rowCount) {
      console.table(chain.rows);
    }

    section("16. CLIENT TIMESTAMP AUDIT");

    const clientDates = await q(db, `
      SELECT
        row_id,
        id_cliente,
        nombre,
        fecha_registro,
        fecha_actualizacion

      FROM gmx.clientes

      WHERE
        fecha_registro IS NULL

        OR

        (
          fecha_actualizacion IS NOT NULL
          AND
          fecha_actualizacion < fecha_registro
        )

      ORDER BY row_id
    `);

    console.log(
      `CLIENT_TIMESTAMP_ERRORS=${
      clientDates.rowCount}`

    );

    if (clientDates.rowCount) {
      console.table(clientDates.rows);
    }

    section("17. TEST RESIDUE");

    const residue = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE
            pos_idempotency_key
            LIKE 'LOYALTY007-%'
        )::bigint AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE
            nombre LIKE
              'CLIENTES LOYALTY007 TEST %'
            OR
            email LIKE
              'clientes.loyalty007.%@example.invalid'
        )::bigint AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE
            id_admin LIKE
              'TEST-LOYALTY%'
            OR
            motivo LIKE
              'LOYALTY00%'
        )::bigint AS movimientos
    `);

    console.table(residue.rows);

    const testResidue =
    Object.values(residue.rows[0]).
    reduce(
      (sum, value) =>
      sum + Number(value || 0),
      0
    );

    console.log(
      `TEST_RESIDUE=${testResidue}`
    );

    section("18. FINAL READ ONLY");

    const finalSafety = await q(db, `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only
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

    await db.query("ROLLBACK");
    tx = false;

    section("19. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_009_AUDIT_PRECHECK=PASS"
    );

    console.log(
      `UNEXPECTED_MOVEMENT_TYPES=${unexpectedTypes.length}`
    );

    console.log(
      `MOVEMENTS_WITHOUT_ID=${noId.rowCount}`
    );

    console.log(
      `DUPLICATE_MOVEMENT_IDS=${duplicateIds.rowCount}`
    );

    console.log(
      `MOVEMENTS_WITHOUT_CLIENT=${noClient.rowCount}`
    );

    console.log(
      `MOVEMENTS_WITHOUT_DATE=${noDate.rowCount}`
    );

    console.log(
      `MOVEMENTS_WITH_INCOMPLETE_ACTOR=${
      missingActor.rowCount}`

    );

    console.log(
      `ADJUSTMENTS_WITHOUT_REASON=${
      adjustmentReason.rowCount}`

    );

    console.log(
      `ADJUSTMENTS_WITHOUT_REFERENCE=${
      adjustmentRef.rowCount}`

    );

    console.log(
      `SALES_MOVEMENTS_WITHOUT_ORDER=${
      salesNoOrder.rowCount}`

    );

    console.log(
      `REVERSALS_WITHOUT_REVERSA_DE=${
      reversalNoOriginal.rowCount}`

    );

    console.log(
      `INVALID_REVERSA_DE_TARGET=${
      invalidReverseTarget.rowCount}`

    );

    console.log(
      `DUPLICATE_REVERSAL_TARGETS=${
      duplicateReverseTargets.rowCount}`

    );

    console.log(
      `MOVEMENT_ARITHMETIC_ERRORS=${
      arithmetic.rowCount}`

    );

    console.log(
      `BROKEN_BALANCE_CHAIN=${chain.rowCount}`
    );

    console.log(
      `CLIENT_TIMESTAMP_ERRORS=${
      clientDates.rowCount}`

    );

    console.log(
      `TEST_RESIDUE=${testResidue}`
    );

    console.log("MODE=READ_ONLY");
    console.log("DATABASE_MUTATION=0");
    console.log("FINANCIAL_MUTATION=0");
    console.log("SALES_MUTATION=0");
    console.log("LOYALTY_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      "NEXT_STEP=ANALYZE_AUDIT_FINDINGS"
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
    "CLIENTES-LOYALTY-009 AUDIT PRECHECK FAILED"
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
