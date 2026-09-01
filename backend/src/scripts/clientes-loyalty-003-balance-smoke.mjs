import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-LOYALTY-003
 * MOVEMENTS / BALANCES CONTROLLED SMOKE
 *
 * TEST:
 *   Cliente TEST aislado
 *   0 -> +100 -> +60 -> -40 -> -1000 clamp
 *
 * Valida:
 *   - creación automática fidelidad_cuentas
 *   - AJUSTE positivo
 *   - AJUSTE positivo acumulativo
 *   - AJUSTE negativo
 *   - clamp de saldo >= 0
 *   - puntos efectivos
 *   - cadena saldo_anterior/saldo_nuevo
 *   - saldo cuenta == último movimiento
 *   - movimiento único
 *   - cleanup completo
 *
 * NO TOCA:
 *   - pedidos
 *   - ventas
 *   - inventario
 *   - caja
 *   - pagos
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  adjustClientPoints,
  getClientLoyalty } from
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

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-003 MOVEMENTS / BALANCES SMOKE")

  );

  console.log("TEST_SCOPE=LOYALTY_ONLY");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("INVENTORY_MUTATION_ALLOWED=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const stamp = Date.now().toString();

  const name =
  `CLIENTES LOYALTY003 TEST ${stamp}`;

  const email =
  `clientes.loyalty003.${stamp}@example.invalid`;

  const phone =
  `558${stamp.slice(-7)}`;

  const reasonPrefix =
  `LOYALTY003-${stamp}`;

  const db = new Client(dbConfig());

  await db.connect();

  let rowId = null;
  let clientId = null;

  try {
    section("1. DATABASE PRECHECK");

    const identity = await db.query(`
      SELECT
        current_database() AS database,
        current_user AS db_user
    `);

    console.table(identity.rows);

    const baseline = await db.query(
      `
      SELECT
        COUNT(*)::bigint AS total
      FROM gmx.clientes
      WHERE
        email=$1
        OR telefono=$2
        OR nombre=$3
      `,
      [email, phone, name]
    );

    console.log(
      `TEST_CLIENT_RESIDUE_BEFORE=${baseline.rows[0].total}`
    );

    if (Number(baseline.rows[0].total) !== 0) {
      throw new Error(
        "TEST_CLIENT_RESIDUE_BEFORE_NOT_ZERO"
      );
    }

    /*
     * Snapshot de tablas que NO deben cambiar.
     */
    const forbiddenBefore = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM gmx.pedidos)::bigint
          AS pedidos,
        (SELECT COUNT(*) FROM gmx.pedido_pagos)::bigint
          AS pedido_pagos,
        (SELECT COUNT(*) FROM gmx.caja_movimientos)::bigint
          AS caja_movimientos
    `);

    console.table(forbiddenBefore.rows);

    section("2. CREATE ISOLATED TEST CLIENT");

    const created = await db.query(
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
        'CLIENTES-LOYALTY-003 TEST',
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
        id_cliente,
        nombre,
        telefono,
        email
      `,
      [
      name,
      phone,
      email]

    );

    if (created.rowCount !== 1) {
      throw new Error(
        "TEST_CLIENT_CREATE_FAILED"
      );
    }

    rowId = created.rows[0].row_id;
    clientId = created.rows[0].id_cliente;

    console.table(created.rows);

    console.log(
      `TEST_ROW_ID=${rowId}`
    );

    console.log(
      `TEST_CLIENT_ID=${clientId}`
    );

    /*
     * Aún no debe existir fidelidad_cuentas.
     */
    const loyaltyInitial =
    await db.query(
      `
        SELECT *
        FROM gmx.fidelidad_cuentas
        WHERE id_cliente=$1
        `,
      [clientId]
    );

    console.log(
      `LOYALTY_ACCOUNT_BEFORE_ADJUST=${loyaltyInitial.rowCount}`
    );

    if (loyaltyInitial.rowCount !== 0) {
      throw new Error(
        "UNEXPECTED_LOYALTY_ACCOUNT_BEFORE_ADJUST"
      );
    }

    const actor = {
      id_admin:
      "TEST-LOYALTY003",

      nombre:
      "CLIENTES-LOYALTY-003 TEST"
    };

    /*
     * -------------------------------------------
     * +100
     * -------------------------------------------
     */

    section("3. ADJUST +100");

    const a1 =
    await adjustClientPoints({
      clientId,
      points: 100,
      reason:
      `${reasonPrefix}-PLUS100`,
      user: actor
    });

    console.log(
      `BALANCE_AFTER_PLUS100=${a1.account?.puntos_disponibles}`
    );

    if (
    Number(
      a1.account?.puntos_disponibles
    ) !== 100)
    {
      throw new Error(
        "PLUS100_BALANCE_FAILED"
      );
    }

    console.log(
      "ADJUST_PLUS100=PASS"
    );

    /*
     * -------------------------------------------
     * +60
     * -------------------------------------------
     */

    section("4. ADJUST +60");

    const a2 =
    await adjustClientPoints({
      clientId,
      points: 60,
      reason:
      `${reasonPrefix}-PLUS60`,
      user: actor
    });

    console.log(
      `BALANCE_AFTER_PLUS60=${a2.account?.puntos_disponibles}`
    );

    if (
    Number(
      a2.account?.puntos_disponibles
    ) !== 160)
    {
      throw new Error(
        "PLUS60_BALANCE_FAILED"
      );
    }

    console.log(
      "ADJUST_PLUS60=PASS"
    );

    /*
     * -------------------------------------------
     * -40
     * -------------------------------------------
     */

    section("5. ADJUST -40");

    const a3 =
    await adjustClientPoints({
      clientId,
      points: -40,
      reason:
      `${reasonPrefix}-MINUS40`,
      user: actor
    });

    console.log(
      `BALANCE_AFTER_MINUS40=${a3.account?.puntos_disponibles}`
    );

    if (
    Number(
      a3.account?.puntos_disponibles
    ) !== 120)
    {
      throw new Error(
        "MINUS40_BALANCE_FAILED"
      );
    }

    console.log(
      "ADJUST_MINUS40=PASS"
    );

    /*
     * -------------------------------------------
     * -1000 => clamp 0.
     *
     * La función calcula:
     * after = Math.max(0,before+delta)
     *
     * Con before=120:
     * effective = 0-120 = -120
     * NO debe registrar -1000.
     * -------------------------------------------
     */

    section("6. ADJUST -1000 / ZERO FLOOR");

    const a4 =
    await adjustClientPoints({
      clientId,
      points: -1000,
      reason:
      `${reasonPrefix}-FLOOR`,
      user: actor
    });

    console.log(
      `BALANCE_AFTER_FLOOR=${a4.account?.puntos_disponibles}`
    );

    if (
    Number(
      a4.account?.puntos_disponibles
    ) !== 0)
    {
      throw new Error(
        "ZERO_FLOOR_FAILED"
      );
    }

    console.log(
      "ZERO_FLOOR=PASS"
    );

    /*
     * -------------------------------------------
     * MOVEMENT AUDIT
     * -------------------------------------------
     */

    section("7. MOVEMENT AUDIT");

    const movements =
    await db.query(
      `
        SELECT
          row_id,
          id_movimiento,
          id_cliente,
          tipo,
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
          id_cliente=$1
          AND motivo LIKE $2
        ORDER BY
          fecha,
          row_id
        `,
      [
      clientId,
      `${reasonPrefix}%`]

    );

    console.log(
      `TEST_MOVEMENTS=${movements.rowCount}`
    );

    console.table(movements.rows);

    if (movements.rowCount !== 4) {
      throw new Error(
        "EXPECTED_4_ADJUSTMENT_MOVEMENTS"
      );
    }

    const expected = [
    {
      puntos: 100,
      before: 0,
      after: 100
    },
    {
      puntos: 60,
      before: 100,
      after: 160
    },
    {
      puntos: -40,
      before: 160,
      after: 120
    },
    {
      puntos: -120,
      before: 120,
      after: 0
    }];


    for (
    let index = 0;
    index < expected.length;
    index++)
    {
      const row =
      movements.rows[index];

      const exp =
      expected[index];

      if (
      row.tipo !== "AJUSTE" ||
      Number(row.puntos) !== exp.puntos ||
      Number(row.saldo_anterior) !== exp.before ||
      Number(row.saldo_nuevo) !== exp.after)
      {
        console.log(
          "EXPECTED=",
          exp
        );

        console.log(
          "ACTUAL=",
          row
        );

        throw new Error(
          `MOVEMENT_CONTRACT_FAILED_INDEX_${index}`
        );
      }
    }

    console.log(
      "MOVEMENT_ARITHMETIC=PASS"
    );

    /*
     * -------------------------------------------
     * MOVEMENT IDs
     * -------------------------------------------
     */

    const duplicateIds =
    await db.query(
      `
        SELECT
          id_movimiento,
          COUNT(*)::bigint AS occurrences
        FROM gmx.fidelidad_movimientos
        WHERE id_cliente=$1
          AND motivo LIKE $2
        GROUP BY id_movimiento
        HAVING COUNT(*) > 1
        `,
      [
      clientId,
      `${reasonPrefix}%`]

    );

    console.log(
      `DUPLICATE_TEST_MOVEMENT_IDS=${duplicateIds.rowCount}`
    );

    if (duplicateIds.rowCount !== 0) {
      throw new Error(
        "DUPLICATE_MOVEMENT_ID_CREATED"
      );
    }

    /*
     * -------------------------------------------
     * CHAIN CHECK
     * -------------------------------------------
     */

    section("8. BALANCE CHAIN");

    const broken =
    await db.query(
      `
        WITH x AS (
          SELECT
            row_id,
            id_movimiento,
            puntos,
            saldo_anterior,
            saldo_nuevo,
            LAG(saldo_nuevo) OVER (
              ORDER BY fecha,row_id
            ) AS previous_saldo_nuevo
          FROM gmx.fidelidad_movimientos
          WHERE id_cliente=$1
            AND motivo LIKE $2
        )
        SELECT *
        FROM x
        WHERE
          previous_saldo_nuevo IS NOT NULL
          AND saldo_anterior
              <> previous_saldo_nuevo
        `,
      [
      clientId,
      `${reasonPrefix}%`]

    );

    console.log(
      `BROKEN_TEST_CHAIN=${broken.rowCount}`
    );

    console.table(broken.rows);

    if (broken.rowCount !== 0) {
      throw new Error(
        "BALANCE_CHAIN_FAILED"
      );
    }

    console.log(
      "BALANCE_CHAIN=PASS"
    );

    /*
     * -------------------------------------------
     * ACCOUNT FINAL
     * -------------------------------------------
     */

    section("9. ACCOUNT FINAL");

    const account =
    await db.query(
      `
        SELECT *
        FROM gmx.fidelidad_cuentas
        WHERE id_cliente=$1
        `,
      [clientId]
    );

    console.table(account.rows);

    if (account.rowCount !== 1) {
      throw new Error(
        "LOYALTY_ACCOUNT_COUNT_INVALID"
      );
    }

    if (
    Number(
      account.rows[0].puntos_disponibles
    ) !== 0)
    {
      throw new Error(
        "FINAL_ACCOUNT_BALANCE_NOT_ZERO"
      );
    }

    const loyalty =
    await getClientLoyalty(
      clientId
    );

    console.log(
      `GET_LOYALTY_BALANCE=${loyalty.account?.puntos_disponibles}`
    );

    console.log(
      `GET_LOYALTY_MOVEMENTS=${loyalty.movements?.length}`
    );

    if (
    Number(
      loyalty.account?.puntos_disponibles
    ) !== 0)
    {
      throw new Error(
        "GET_CLIENT_LOYALTY_BALANCE_FAILED"
      );
    }

    console.log(
      "GET_CLIENT_LOYALTY=PASS"
    );

    /*
     * -------------------------------------------
     * FORBIDDEN TABLE VERIFICATION
     * -------------------------------------------
     */

    section("10. FORBIDDEN MUTATION CHECK");

    const forbiddenAfter =
    await db.query(`
        SELECT
          (SELECT COUNT(*) FROM gmx.pedidos)::bigint
            AS pedidos,
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

    const forbiddenChanged =
    String(before.pedidos) !==
    String(after.pedidos) ||
    String(before.pedido_pagos) !==
    String(after.pedido_pagos) ||
    String(before.caja_movimientos) !==
    String(after.caja_movimientos);

    console.log(
      `FORBIDDEN_TABLE_COUNTS_CHANGED=${
      forbiddenChanged ? "YES" : "NO"}`

    );

    if (forbiddenChanged) {
      throw new Error(
        "FORBIDDEN_TABLE_MUTATION_DETECTED"
      );
    }

    /*
     * -------------------------------------------
     * CLEANUP
     * -------------------------------------------
     */

    section("11. CONTROLLED CLEANUP");

    await db.query("BEGIN");

    try {
      const target =
      await db.query(
        `
          SELECT
            row_id,
            id_cliente,
            nombre,
            telefono,
            email
          FROM gmx.clientes
          WHERE
            row_id=$1
            AND id_cliente=$2
            AND nombre=$3
            AND email=$4
            AND telefono=$5
          FOR UPDATE
          `,
        [
        rowId,
        clientId,
        name,
        email,
        phone]

      );

      console.log(
        `CLEANUP_TARGET_ROWS=${target.rowCount}`
      );

      if (target.rowCount !== 1) {
        throw new Error(
          "CLEANUP_TARGET_NOT_EXACT"
        );
      }

      const deleteMoves =
      await db.query(
        `
          DELETE FROM gmx.fidelidad_movimientos
          WHERE
            id_cliente=$1
            AND motivo LIKE $2
          RETURNING
            row_id,
            id_movimiento
          `,
        [
        clientId,
        `${reasonPrefix}%`]

      );

      console.log(
        `CLEANUP_MOVEMENTS=${deleteMoves.rowCount}`
      );

      if (deleteMoves.rowCount !== 4) {
        throw new Error(
          "CLEANUP_MOVEMENT_COUNT_INVALID"
        );
      }

      const deleteAccount =
      await db.query(
        `
          DELETE FROM gmx.fidelidad_cuentas
          WHERE id_cliente=$1
          RETURNING row_id
          `,
        [clientId]
      );

      console.log(
        `CLEANUP_ACCOUNT=${deleteAccount.rowCount}`
      );

      if (deleteAccount.rowCount !== 1) {
        throw new Error(
          "CLEANUP_ACCOUNT_COUNT_INVALID"
        );
      }

      /*
       * El DELETE del cliente dispara
       * release_cliente_identity().
       */
      const deleteClient =
      await db.query(
        `
          DELETE FROM gmx.clientes
          WHERE
            row_id=$1
            AND id_cliente=$2
            AND nombre=$3
            AND email=$4
            AND telefono=$5
          RETURNING row_id,id_cliente
          `,
        [
        rowId,
        clientId,
        name,
        email,
        phone]

      );

      console.log(
        `CLEANUP_CLIENT=${deleteClient.rowCount}`
      );

      if (deleteClient.rowCount !== 1) {
        throw new Error(
          "CLEANUP_CLIENT_COUNT_INVALID"
        );
      }

      const verifyClient =
      await db.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.clientes
          WHERE
            id_cliente=$1
            OR email=$2
            OR telefono=$3
          `,
        [
        clientId,
        email,
        phone]

      );

      const verifyAccount =
      await db.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.fidelidad_cuentas
          WHERE id_cliente=$1
          `,
        [clientId]
      );

      const verifyMoves =
      await db.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.fidelidad_movimientos
          WHERE id_cliente=$1
             OR motivo LIKE $2
          `,
        [
        clientId,
        `${reasonPrefix}%`]

      );

      const verifyIdentity =
      await db.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.cliente_identidad_unica
          WHERE id_cliente=$1
          `,
        [clientId]
      );

      console.log(
        `RESIDUE_CLIENT_BEFORE_COMMIT=${verifyClient.rows[0].total}`
      );

      console.log(
        `RESIDUE_ACCOUNT_BEFORE_COMMIT=${verifyAccount.rows[0].total}`
      );

      console.log(
        `RESIDUE_MOVEMENTS_BEFORE_COMMIT=${verifyMoves.rows[0].total}`
      );

      console.log(
        `RESIDUE_IDENTITY_BEFORE_COMMIT=${verifyIdentity.rows[0].total}`
      );

      if (
      Number(verifyClient.rows[0].total) !== 0 ||
      Number(verifyAccount.rows[0].total) !== 0 ||
      Number(verifyMoves.rows[0].total) !== 0 ||
      Number(verifyIdentity.rows[0].total) !== 0)
      {
        throw new Error(
          "CLEANUP_VERIFICATION_FAILED"
        );
      }

      await db.query("COMMIT");

      console.log(
        "CLEANUP_COMMIT=PASS"
      );

      rowId = null;
      clientId = null;

    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }

    /*
     * -------------------------------------------
     * FINAL GLOBAL RESIDUE
     * -------------------------------------------
     */

    section("12. FINAL RESIDUE");

    const residue = await db.query(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE
            nombre LIKE 'CLIENTES LOYALTY003 TEST%'
            OR email LIKE 'clientes.loyalty003.%@example.invalid'
        )::bigint
          AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE motivo LIKE $1
        )::bigint
          AS movimientos
      `,
      [`${reasonPrefix}%`]
    );

    console.table(residue.rows);

    const clientResidue =
    Number(residue.rows[0].clientes);

    const movementResidue =
    Number(residue.rows[0].movimientos);

    console.log(
      `TEST_RESIDUE_CLIENTES=${clientResidue}`
    );

    console.log(
      `TEST_RESIDUE_MOVIMIENTOS=${movementResidue}`
    );

    if (
    clientResidue !== 0 ||
    movementResidue !== 0)
    {
      throw new Error(
        "FINAL_TEST_RESIDUE_NOT_ZERO"
      );
    }

    section("13. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_003_BALANCE_SMOKE=PASS"
    );

    console.log(
      "LOYALTY_ACCOUNT_AUTO_CREATE=PASS"
    );

    console.log(
      "ADJUST_PLUS100=PASS"
    );

    console.log(
      "ADJUST_PLUS60=PASS"
    );

    console.log(
      "ADJUST_MINUS40=PASS"
    );

    console.log(
      "ZERO_FLOOR=PASS"
    );

    console.log(
      "MOVEMENT_ARITHMETIC=PASS"
    );

    console.log(
      "BALANCE_CHAIN=PASS"
    );

    console.log(
      "DUPLICATE_TEST_MOVEMENT_IDS=0"
    );

    console.log(
      "GET_CLIENT_LOYALTY=PASS"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "TEST_RESIDUE_MOVIMIENTOS=0"
    );

    console.log(
      "TEST_RESIDUE_LOYALTY_ACCOUNT=0"
    );

    console.log(
      "TEST_RESIDUE_IDENTIDAD=0"
    );

    console.log(
      "SALES_MUTATION=0"
    );

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "NEXT_STEP=LOYALTY_IDEMPOTENCY_PRECHECK"
    );

  } finally {
    /*
     * No hacemos cleanup genérico peligroso.
     * Si falla antes del cleanup controlado,
     * informamos el ID exacto para ejecutar
     * cleanup específico.
     */
    if (clientId) {
      console.log("");
      console.log(
        "WARNING_TEST_CLIENT_MAY_REQUIRE_CLEANUP=YES"
      );

      console.log(
        `PENDING_TEST_CLIENT_ID=${clientId}`
      );

      console.log(
        `PENDING_TEST_ROW_ID=${rowId}`
      );
    }

    await db.end();
  }
}

main().catch((e) => {
  section(
    "CLIENTES-LOYALTY-003 BALANCE SMOKE FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
