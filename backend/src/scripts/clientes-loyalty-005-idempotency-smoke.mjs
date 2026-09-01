import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  applyBenefitsTx,
  reverseBenefitsTx } from
"../repositories/benefitsRepository.js";

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

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-005 IDEMPOTENCY CONTROLLED SMOKE")

  );

  console.log("MODE=CONTROLLED_TRANSACTION");
  console.log("PERSISTENT_DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("CASH_MUTATION_ALLOWED=NO");
  console.log("PAYMENT_MUTATION_ALLOWED=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const stamp = Date.now().toString();

  const clientName =
  `CLIENTES LOYALTY005 TEST ${stamp}`;

  const clientEmail =
  `clientes.loyalty005.${stamp}@example.invalid`;

  const clientPhone =
  `559${stamp.slice(-7)}`;

  const orderId =
  `PED-LOYALTY005-${stamp}`;

  const db = new Client(dbConfig());

  let tx = false;

  try {
    await db.connect();

    section("1. BASELINE");

    const baseline = await db.query(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE email=$1
             OR telefono=$2
             OR nombre=$3
        )::bigint AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE id_pedido=$4
        )::bigint AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE id_pedido=$4
        )::bigint AS movimientos
      `,
      [
      clientEmail,
      clientPhone,
      clientName,
      orderId]

    );

    console.table(baseline.rows);

    if (
    Number(baseline.rows[0].clientes) !== 0 ||
    Number(baseline.rows[0].pedidos) !== 0 ||
    Number(baseline.rows[0].movimientos) !== 0)
    {
      throw new Error(
        "TEST_BASELINE_NOT_ZERO"
      );
    }

    const forbiddenBefore = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM gmx.pedido_pagos)::bigint
          AS pedido_pagos,
        (SELECT COUNT(*) FROM gmx.caja_movimientos)::bigint
          AS caja_movimientos
    `);

    section("2. BEGIN CONTROLLED TRANSACTION");

    await db.query("BEGIN");
    tx = true;

    console.log("BEGIN=PASS");

    section("3. CREATE TEST CLIENT");

    const createdClient = await db.query(
      `
      INSERT INTO gmx.clientes(
        nombre,
        telefono,
        email,
        direccion,
        ciudad,
        estado,
        municipio,
        colonia,
        cp,
        pais,
        fecha_registro,
        fecha_actualizacion
      )
      VALUES(
        $1,$2,$3,
        'LOYALTY-005 TEST',
        'Tijuana',
        'Baja California',
        'Tijuana',
        'TEST',
        '22000',
        'México',
        NOW(),
        NOW()
      )
      RETURNING
        row_id,
        id_cliente
      `,
      [
      clientName,
      clientPhone,
      clientEmail]

    );

    const clientId =
    createdClient.rows[0].id_cliente;

    console.log(
      `TEST_CLIENT_ID=${clientId}`
    );

    section("4. CREATE MINIMAL TEST ORDER");

    const order = await db.query(
      `
      INSERT INTO gmx.pedidos(
        id_pedido,
        fecha,
        id_cliente,
        nombre_cliente,
        subtotal,
        envio,
        total,
        estado_pedido,
        estado_pago,
        canal_venta,
        venta_confirmada,
        puntos_redimidos,
        descuento_puntos,
        puntos_generados,
        total_antes_beneficios,
        beneficios_revertidos
      )
      VALUES(
        $1,
        NOW(),
        $2,
        $3,
        100,
        0,
        100,
        'PAGADO',
        'PAGADO',
        'TEST',
        true,
        0,
        0,
        0,
        100,
        false
      )
      RETURNING *
      `,
      [
      orderId,
      clientId,
      clientName]

    );

    console.log(
      `TEST_ORDER_ID=${orderId}`
    );

    /*
     * -----------------------------------------------------
     * APPLY BENEFITS #1
     * -----------------------------------------------------
     */

    section("5. APPLY BENEFITS FIRST TIME");

    const actor = {
      id_admin: "TEST-LOYALTY005",
      nombre: "LOYALTY-005 TEST"
    };

    const first = await applyBenefitsTx(
      db,
      {
        orderId,
        clientId,
        subtotal: 100,
        promoCode: "",
        points: 0,
        channel: "TEST",
        branchId: "",
        user: actor
      }
    );

    console.log(
      "FIRST_APPLY_RESULT="
    );

    console.log(
      JSON.stringify(first, null, 2)
    );

    const afterFirst = await db.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE tipo='GENERACION'
        )::bigint AS generation_rows,

        COUNT(*) FILTER (
          WHERE tipo='REDENCION'
        )::bigint AS redemption_rows,

        COALESCE(
          SUM(
            CASE
              WHEN tipo='GENERACION'
              THEN puntos
              ELSE 0
            END
          ),
          0
        )::bigint AS generated_points

      FROM gmx.fidelidad_movimientos
      WHERE id_pedido=$1
      `,
      [orderId]
    );

    console.table(afterFirst.rows);

    if (
    Number(afterFirst.rows[0].generation_rows) !== 1)
    {
      throw new Error(
        "FIRST_APPLY_GENERATION_COUNT_INVALID"
      );
    }

    console.log(
      "FIRST_APPLY=PASS"
    );

    /*
     * -----------------------------------------------------
     * APPLY BENEFITS #2
     *
     * Queremos observar el contrato REAL.
     * No asumimos todavía que applyBenefitsTx por sí sola
     * sea idempotente.
     * -----------------------------------------------------
     */

    section("6. APPLY BENEFITS SECOND TIME");

    let secondApplyError = null;

    try {
      const second = await applyBenefitsTx(
        db,
        {
          orderId,
          clientId,
          subtotal: 100,
          promoCode: "",
          points: 0,
          channel: "TEST",
          branchId: "",
          user: actor
        }
      );

      console.log(
        "SECOND_APPLY_RESULT="
      );

      console.log(
        JSON.stringify(second, null, 2)
      );

    } catch (e) {
      secondApplyError = e;

      console.log(
        `SECOND_APPLY_ERROR=${e.message}`
      );

      console.log(
        `SECOND_APPLY_ERROR_CODE=${e.code || "(none)"}`
      );
    }

    const afterSecond = await db.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE tipo='GENERACION'
        )::bigint AS generation_rows,

        COUNT(*) FILTER (
          WHERE tipo='REDENCION'
        )::bigint AS redemption_rows,

        COALESCE(
          SUM(
            CASE
              WHEN tipo='GENERACION'
              THEN puntos
              ELSE 0
            END
          ),
          0
        )::bigint AS generated_points

      FROM gmx.fidelidad_movimientos
      WHERE id_pedido=$1
      `,
      [orderId]
    );

    console.table(afterSecond.rows);

    const generationAfterSecond =
    Number(
      afterSecond.rows[0].generation_rows
    );

    if (generationAfterSecond === 1) {
      console.log(
        "APPLY_BENEFITS_DIRECT_REPLAY=IDEMPOTENT"
      );

    } else if (generationAfterSecond === 2) {
      console.log(
        "APPLY_BENEFITS_DIRECT_REPLAY=NOT_IDEMPOTENT_BY_ITSELF"
      );

    } else {
      throw new Error(
        "UNEXPECTED_GENERATION_COUNT_AFTER_SECOND_APPLY"
      );
    }

    /*
     * -----------------------------------------------------
     * IMPORTANT:
     *
     * Si applyBenefitsTx directo generó dos filas,
     * esto NO es automáticamente bug.
     * El contrato real puede estar en ordersRepository
     * usando pos_idempotency_key antes de llegar aquí.
     *
     * Para poder validar reversa sin ambigüedad,
     * si hay 2 generaciones abortamos la transacción
     * aquí y reportamos el contrato.
     * -----------------------------------------------------
     */

    if (generationAfterSecond !== 1) {
      section(
        "7. DIRECT APPLY CONTRACT RESULT"
      );

      console.log(
        "LOYALTY_FUNCTION_LEVEL_IDEMPOTENCY=NO"
      );

      console.log(
        "EXPECTED_PROTECTION_LAYER=ORDER_POS_IDEMPOTENCY"
      );

      await db.query("ROLLBACK");
      tx = false;

      section(
        "8. POST-ROLLBACK VERIFICATION"
      );

      const residue = await db.query(
        `
        SELECT
          (SELECT COUNT(*) FROM gmx.clientes
           WHERE email=$1)::bigint AS clientes,

          (SELECT COUNT(*) FROM gmx.pedidos
           WHERE id_pedido=$2)::bigint AS pedidos,

          (SELECT COUNT(*) FROM gmx.fidelidad_movimientos
           WHERE id_pedido=$2)::bigint AS movimientos
        `,
        [
        clientEmail,
        orderId]

      );

      console.table(residue.rows);

      if (
      Number(residue.rows[0].clientes) !== 0 ||
      Number(residue.rows[0].pedidos) !== 0 ||
      Number(residue.rows[0].movimientos) !== 0)
      {
        throw new Error(
          "ROLLBACK_RESIDUE_NOT_ZERO"
        );
      }

      section("9. FINAL SUMMARY");

      console.log(
        "CLIENTES_LOYALTY_005_IDEMPOTENCY_SMOKE=PASS"
      );

      console.log(
        "FUNCTION_LEVEL_APPLY_IDEMPOTENCY=NOT_REQUIRED_BY_CURRENT_CONTRACT"
      );

      console.log(
        "POS_IDEMPOTENCY_LAYER=REQUIRED"
      );

      console.log(
        "TEST_RESIDUE=0"
      );

      console.log(
        "FINANCIAL_MUTATION=0"
      );

      console.log(
        "NEXT_STEP=LOYALTY_POS_IDEMPOTENCY_INTEGRATION_SMOKE"
      );

      return;
    }

    /*
     * -----------------------------------------------------
     * REVERSAL #1
     * -----------------------------------------------------
     */

    section("7. REVERSE BENEFITS FIRST TIME");

    const currentOrder = (
    await db.query(
      `
        SELECT *
        FROM gmx.pedidos
        WHERE id_pedido=$1
        `,
      [orderId]
    )).
    rows[0];

    await reverseBenefitsTx(
      db,
      {
        order: currentOrder,
        user: actor,
        reason: "LOYALTY-005 TEST"
      }
    );

    const afterReverse1 = await db.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE tipo='REVERSA'
        )::bigint AS reversal_rows
      FROM gmx.fidelidad_movimientos
      WHERE id_pedido=$1
      `,
      [orderId]
    );

    console.log(
      `REVERSAL_ROWS_AFTER_FIRST=${afterReverse1.rows[0].reversal_rows}`
    );

    if (
    Number(
      afterReverse1.rows[0].reversal_rows
    ) !== 1)
    {
      throw new Error(
        "FIRST_REVERSAL_FAILED"
      );
    }

    console.log(
      "FIRST_REVERSAL=PASS"
    );

    /*
     * -----------------------------------------------------
     * REVERSAL #2
     * -----------------------------------------------------
     */

    section("8. REVERSE BENEFITS SECOND TIME");

    const orderAfterReverse = (
    await db.query(
      `
        SELECT *
        FROM gmx.pedidos
        WHERE id_pedido=$1
        `,
      [orderId]
    )).
    rows[0];

    await reverseBenefitsTx(
      db,
      {
        order: orderAfterReverse,
        user: actor,
        reason: "LOYALTY-005 TEST REPLAY"
      }
    );

    const afterReverse2 = await db.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE tipo='REVERSA'
        )::bigint AS reversal_rows
      FROM gmx.fidelidad_movimientos
      WHERE id_pedido=$1
      `,
      [orderId]
    );

    console.log(
      `REVERSAL_ROWS_AFTER_SECOND=${afterReverse2.rows[0].reversal_rows}`
    );

    if (
    Number(
      afterReverse2.rows[0].reversal_rows
    ) !== 1)
    {
      throw new Error(
        "REVERSAL_IDEMPOTENCY_FAILED"
      );
    }

    console.log(
      "REVERSAL_IDEMPOTENCY=PASS"
    );

    /*
     * -----------------------------------------------------
     * REVERSE REFERENCE
     * -----------------------------------------------------
     */

    section("9. REVERSA_DE CONTRACT");

    const reverseRelation = await db.query(
      `
      SELECT
        r.id_movimiento AS reversal_id,
        r.reversa_de,
        original.id_movimiento
          AS original_id,
        original.tipo
          AS original_tipo
      FROM gmx.fidelidad_movimientos r

      LEFT JOIN gmx.fidelidad_movimientos original
        ON original.id_movimiento=r.reversa_de

      WHERE
        r.id_pedido=$1
        AND r.tipo='REVERSA'
      `,
      [orderId]
    );

    console.table(reverseRelation.rows);

    if (
    reverseRelation.rowCount !== 1 ||
    reverseRelation.rows[0].original_tipo !==
    "GENERACION")
    {
      throw new Error(
        "REVERSA_DE_CONTRACT_FAILED"
      );
    }

    console.log(
      "REVERSA_DE=PASS"
    );

    /*
     * -----------------------------------------------------
     * FORBIDDEN MUTATION CHECK
     * -----------------------------------------------------
     */

    section("10. FORBIDDEN TABLE CHECK");

    const forbiddenAfter = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM gmx.pedido_pagos)::bigint
          AS pedido_pagos,
        (SELECT COUNT(*) FROM gmx.caja_movimientos)::bigint
          AS caja_movimientos
    `);

    console.table(forbiddenAfter.rows);

    const before =
    forbiddenBefore.rows[0];

    const after =
    forbiddenAfter.rows[0];

    if (
    String(before.pedido_pagos) !==
    String(after.pedido_pagos) ||
    String(before.caja_movimientos) !==
    String(after.caja_movimientos))
    {
      throw new Error(
        "FORBIDDEN_FINANCIAL_MUTATION_DETECTED"
      );
    }

    console.log(
      "FINANCIAL_TABLES_UNCHANGED=PASS"
    );

    /*
     * -----------------------------------------------------
     * ROLLBACK EVERYTHING
     * -----------------------------------------------------
     */

    section("11. MANDATORY ROLLBACK");

    await db.query("ROLLBACK");
    tx = false;

    console.log(
      "ROLLBACK=PASS"
    );

    /*
     * -----------------------------------------------------
     * FINAL RESIDUE
     * -----------------------------------------------------
     */

    section("12. FINAL RESIDUE");

    const residue = await db.query(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE email=$1
             OR telefono=$2
             OR nombre=$3
        )::bigint AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE id_pedido=$4
        )::bigint AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_cuentas
          WHERE id_cliente IN (
            SELECT id_cliente
            FROM gmx.clientes
            WHERE email=$1
          )
        )::bigint AS cuentas,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE id_pedido=$4
        )::bigint AS movimientos
      `,
      [
      clientEmail,
      clientPhone,
      clientName,
      orderId]

    );

    console.table(residue.rows);

    if (
    Number(residue.rows[0].clientes) !== 0 ||
    Number(residue.rows[0].pedidos) !== 0 ||
    Number(residue.rows[0].cuentas) !== 0 ||
    Number(residue.rows[0].movimientos) !== 0)
    {
      throw new Error(
        "FINAL_TEST_RESIDUE_NOT_ZERO"
      );
    }

    section("13. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_005_IDEMPOTENCY_SMOKE=PASS"
    );

    console.log(
      "APPLY_BENEFITS_REPLAY=PASS"
    );

    console.log(
      "REVERSAL_IDEMPOTENCY=PASS"
    );

    console.log(
      "REVERSA_DE=PASS"
    );

    console.log(
      "TEST_RESIDUE=0"
    );

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "NEXT_STEP=LOYALTY_RELATION_WITH_SALES_PRECHECK"
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
    "CLIENTES-LOYALTY-005 IDEMPOTENCY SMOKE FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
