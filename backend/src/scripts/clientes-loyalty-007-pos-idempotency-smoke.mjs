import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  createSale,
  cancelSale } from
"../repositories/ordersRepository.js";

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
  section(brandText("GMX — CLIENTES-LOYALTY-007 POS IDEMPOTENCY CONTROLLED SMOKE")

  );

  console.log("TEST_SCOPE=POS_LOYALTY_IDEMPOTENCY");
  console.log("REAL_FINANCIAL_PROVIDER_CALLS=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const stamp = Date.now().toString();

  const saleRequestId =
  `LOYALTY007-${stamp}`;

  const clientName =
  `CLIENTES LOYALTY007 TEST ${stamp}`;

  const clientEmail =
  `clientes.loyalty007.${stamp}@example.invalid`;

  const clientPhone =
  `557${stamp.slice(-7)}`;

  const db = new Client(dbConfig());

  await db.connect();

  let clientId = null;
  let clientRowId = null;
  let orderRowId = null;
  let orderId = null;

  try {
    section("1. PRECHECK");

    const baseline = await db.query(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE pos_idempotency_key=$1
        )::bigint AS orders,

        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE email=$2
             OR telefono=$3
        )::bigint AS clients
      `,
      [
      saleRequestId,
      clientEmail,
      clientPhone]

    );

    console.table(baseline.rows);

    if (
    Number(baseline.rows[0].orders) !== 0 ||
    Number(baseline.rows[0].clients) !== 0)
    {
      throw new Error(
        "TEST_BASELINE_NOT_ZERO"
      );
    }

    section("2. CREATE TEST CLIENT");

    const client = await db.query(
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
        'LOYALTY-007 TEST',
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

    clientRowId =
    client.rows[0].row_id;

    clientId =
    client.rows[0].id_cliente;

    console.log(
      `TEST_CLIENT_ID=${clientId}`
    );

    section("3. DISCOVER TEST BRANCH + PRODUCT");

    /*
     * Reutilizamos inventario real disponible,
     * pero solo una unidad.
     */
    const candidate = await db.query(`
      SELECT
        s.row_id AS branch_row_id,
        s.id_sucursal,
        s.id_inventario,

        s.stock::numeric AS stock,

        i.row_id AS global_row_id,

        i.stock::numeric AS global_stock,

        i.precio::numeric AS precio,

        i.precio_oferta::numeric AS precio_oferta,

        CASE
          WHEN COALESCE(i.precio_oferta,0) > 0
          THEN i.precio_oferta
          ELSE i.precio
        END::numeric AS effective_price

      FROM gmx.tcg_inventario_sucursales s

      JOIN gmx.tcg_inventario i
        ON i.id_inventario=s.id_inventario

      WHERE
        COALESCE(s.stock,0) >= 1

        AND COALESCE(i.stock,0) >= 1

        AND (
          COALESCE(i.precio,0) > 0
          OR COALESCE(i.precio_oferta,0) > 0
        )

      ORDER BY
        CASE
          WHEN s.id_sucursal='SUC-000010'
          THEN 0
          ELSE 1
        END,

        s.stock DESC,

        CASE
          WHEN COALESCE(i.precio_oferta,0) > 0
          THEN i.precio_oferta
          ELSE i.precio
        END DESC,

        s.row_id

      LIMIT 1
    `);

    if (candidate.rowCount !== 1) {
      throw new Error(
        "NO_SAFE_TEST_INVENTORY_CANDIDATE"
      );
    }

    const inventory =
    candidate.rows[0];

    console.table(candidate.rows);

    const branchId =
    inventory.id_sucursal;

    const itemId =
    inventory.id_inventario;

    const branchStockBefore =
    Number(inventory.stock);

    const globalStockBefore =
    Number(inventory.global_stock);

    section("4. FIRST SALE");

    const payload = {
      saleRequestId,

      branchId,

      clientId,

      items: [
      {
        itemType: "TCG",
        inventoryId: itemId,
        quantity: 1
      }],


      /*
       * TRANSFERENCIA TEST:
       *
       * No enviamos payments[] explícito.
       * createSale construye su payment fallback
       * y resuelve el importe contra el total calculado.
       *
       * Esto evita movimientos de caja/efectivo.
       */
      paymentMethod: "TRANSFERENCIA",
      payments: [{
        method: "TRANSFERENCIA",
        amount: null
      }],

      paymentReference:
      `LOYALTY007-TRANSFER-${stamp}`,

      pointsToRedeem: 0,

      points: 0,

      promoCode: "",

      user: {
        id_admin:
        "TEST-LOYALTY007",

        nombre:
        "CLIENTES-LOYALTY-007 TEST"
      }
    };

    const first =
    await createSale(payload);

    console.log(
      "FIRST_SALE_RESULT="
    );

    console.log(
      JSON.stringify(first, null, 2)
    );

    if (!first?.id_pedido) {
      throw new Error(
        "FIRST_SALE_ID_MISSING"
      );
    }

    orderId =
    first.id_pedido;

    orderRowId =
    first.row_id;

    console.log(
      `FIRST_ORDER_ID=${orderId}`
    );

    console.log(
      `FIRST_IDEMPOTENT_REUSE=${
      first.idempotent_reuse === true ?
      "YES" :
      "NO"}`

    );

    if (
    first.idempotent_reuse === true)
    {
      throw new Error(
        "FIRST_CALL_UNEXPECTEDLY_REUSED"
      );
    }

    section("5. FIRST SALE DB SNAPSHOT");

    const firstSnapshot =
    await db.query(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM gmx.pedidos
            WHERE pos_idempotency_key=$1
          )::bigint AS order_count,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_pedido=$2
              AND tipo='GENERACION'
          )::bigint AS generation_count,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_pedido=$2
              AND tipo='REDENCION'
          )::bigint AS redemption_count,

          (
            SELECT COUNT(*)
            FROM gmx.pedido_pagos
            WHERE id_pedido=$2
          )::bigint AS payment_count,

          (
            SELECT COUNT(*)
            FROM gmx.caja_movimientos
            WHERE referencia=$2
               OR id_origen=$2
          )::bigint AS cash_count
        `,
      [
      saleRequestId,
      orderId]

    );

    console.table(
      firstSnapshot.rows
    );

    const stockAfterFirst =
    await db.query(
      `
        SELECT
          s.stock AS branch_stock,
          i.stock AS global_stock

        FROM gmx.tcg_inventario_sucursales s

        JOIN gmx.tcg_inventario i
          ON i.id_inventario=s.id_inventario

        WHERE
          s.id_sucursal=$1
          AND s.id_inventario=$2
        `,
      [
      branchId,
      itemId]

    );

    console.table(
      stockAfterFirst.rows
    );

    section("6. IDEMPOTENT REPLAY");

    const replay =
    await createSale(payload);

    console.log(
      "REPLAY_RESULT="
    );

    console.log(
      JSON.stringify(replay, null, 2)
    );

    if (
    replay?.id_pedido !== orderId)
    {
      throw new Error(
        "REPLAY_RETURNED_DIFFERENT_ORDER"
      );
    }

    if (
    replay?.idempotent_reuse !== true)
    {
      throw new Error(
        "REPLAY_NOT_MARKED_IDEMPOTENT"
      );
    }

    console.log(
      "IDEMPOTENT_REUSE=PASS"
    );

    section("7. POST-REPLAY DB VALIDATION");

    const secondSnapshot =
    await db.query(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM gmx.pedidos
            WHERE pos_idempotency_key=$1
          )::bigint AS order_count,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_pedido=$2
              AND tipo='GENERACION'
          )::bigint AS generation_count,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_pedido=$2
              AND tipo='REDENCION'
          )::bigint AS redemption_count,

          (
            SELECT COUNT(*)
            FROM gmx.pedido_pagos
            WHERE id_pedido=$2
          )::bigint AS payment_count,

          (
            SELECT COUNT(*)
            FROM gmx.caja_movimientos
            WHERE referencia=$2
               OR id_origen=$2
          )::bigint AS cash_count
        `,
      [
      saleRequestId,
      orderId]

    );

    console.table(
      secondSnapshot.rows
    );

    const a =
    firstSnapshot.rows[0];

    const b =
    secondSnapshot.rows[0];

    if (
    String(a.order_count) !==
    String(b.order_count) ||
    String(a.generation_count) !==
    String(b.generation_count) ||
    String(a.redemption_count) !==
    String(b.redemption_count) ||
    String(a.payment_count) !==
    String(b.payment_count) ||
    String(a.cash_count) !==
    String(b.cash_count))
    {
      throw new Error(
        "IDEMPOTENT_REPLAY_CREATED_SIDE_EFFECT"
      );
    }

    if (
    Number(b.order_count) !== 1)
    {
      throw new Error(
        "ORDER_IDEMPOTENCY_FAILED"
      );
    }

    console.log(
      "ORDER_COUNT_IDEMPOTENCY=PASS"
    );

    console.log(
      "LOYALTY_MOVEMENT_IDEMPOTENCY=PASS"
    );

    console.log(
      "PAYMENT_IDEMPOTENCY=PASS"
    );

    console.log(
      "CASH_IDEMPOTENCY=PASS"
    );

    section("8. INVENTORY IDEMPOTENCY");

    const stockAfterReplay =
    await db.query(
      `
        SELECT
          s.stock AS branch_stock,
          i.stock AS global_stock

        FROM gmx.tcg_inventario_sucursales s

        JOIN gmx.tcg_inventario i
          ON i.id_inventario=s.id_inventario

        WHERE
          s.id_sucursal=$1
          AND s.id_inventario=$2
        `,
      [
      branchId,
      itemId]

    );

    console.table(
      stockAfterReplay.rows
    );

    const firstBranch =
    Number(
      stockAfterFirst.rows[0].
      branch_stock
    );

    const replayBranch =
    Number(
      stockAfterReplay.rows[0].
      branch_stock
    );

    const firstGlobal =
    Number(
      stockAfterFirst.rows[0].
      global_stock
    );

    const replayGlobal =
    Number(
      stockAfterReplay.rows[0].
      global_stock
    );

    if (
    firstBranch !== replayBranch ||
    firstGlobal !== replayGlobal)
    {
      throw new Error(
        "INVENTORY_REPLAY_MUTATED_STOCK"
      );
    }

    if (
    branchStockBefore -
    firstBranch !== 1)
    {
      throw new Error(
        "FIRST_SALE_BRANCH_STOCK_DELTA_INVALID"
      );
    }

    if (
    globalStockBefore -
    firstGlobal !== 1)
    {
      throw new Error(
        "FIRST_SALE_GLOBAL_STOCK_DELTA_INVALID"
      );
    }

    console.log(
      "INVENTORY_IDEMPOTENCY=PASS"
    );

    section("9. CONTROLLED CANCEL / CLEANUP");

    const cancel =
    await cancelSale(
      orderRowId,
      "LOYALTY-007 CONTROLLED TEST CLEANUP",
      {
        id_admin:
        "TEST-LOYALTY007",

        nombre:
        "CLIENTES-LOYALTY-007 TEST"
      }
    );

    console.log(
      JSON.stringify(
        cancel,
        null,
        2
      )
    );

    console.log(
      "SALE_CANCEL_CLEANUP=PASS"
    );

    /*
     * Eliminamos únicamente el pedido TEST ya cancelado
     * y sus dependencias TEST, para devolver DB a baseline.
     */
    section("10. HARD TEST RESIDUE CLEANUP");

    await db.query("BEGIN");

    try {
      await db.query(
        `
        DELETE FROM gmx.fidelidad_movimientos
        WHERE id_pedido=$1
        `,
        [orderId]
      );

      await db.query(
        `
        DELETE FROM gmx.fidelidad_cuentas
        WHERE id_cliente=$1
        `,
        [clientId]
      );

      await db.query(
        `
        DELETE FROM gmx.caja_movimientos
        WHERE referencia=$1
           OR id_origen=$1
        `,
        [orderId]
      );

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

      await db.query(
        `
        DELETE FROM gmx.pedidos
        WHERE id_pedido=$1
          AND pos_idempotency_key=$2
        `,
        [
        orderId,
        saleRequestId]

      );

      await db.query(
        `
        DELETE FROM gmx.clientes
        WHERE row_id=$1
          AND id_cliente=$2
          AND email=$3
          AND telefono=$4
        `,
        [
        clientRowId,
        clientId,
        clientEmail,
        clientPhone]

      );

      await db.query("COMMIT");

    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }

    section("11. FINAL RESIDUE");

    const residue =
    await db.query(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM gmx.clientes
            WHERE email=$1
               OR telefono=$2
          )::bigint AS clients,

          (
            SELECT COUNT(*)
            FROM gmx.pedidos
            WHERE id_pedido=$3
               OR pos_idempotency_key=$4
          )::bigint AS orders,

          (
            SELECT COUNT(*)
            FROM gmx.detalle_pedidos
            WHERE id_pedido=$3
          )::bigint AS details,

          (
            SELECT COUNT(*)
            FROM gmx.pedido_pagos
            WHERE id_pedido=$3
          )::bigint AS payments,

          (
            SELECT COUNT(*)
            FROM gmx.caja_movimientos
            WHERE referencia=$3
               OR id_origen=$3
          )::bigint AS cash,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_pedido=$3
          )::bigint AS loyalty_movements,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_cuentas
            WHERE id_cliente=$5
          )::bigint AS loyalty_accounts,

          (
            SELECT COUNT(*)
            FROM gmx.cliente_identidad_unica
            WHERE id_cliente=$5
          )::bigint AS identities
        `,
      [
      clientEmail,
      clientPhone,
      orderId,
      saleRequestId,
      clientId]

    );

    console.table(
      residue.rows
    );

    const r =
    residue.rows[0];

    const totalResidue =
    Object.values(r).
    reduce(
      (sum, value) =>
      sum + Number(value || 0),
      0
    );

    console.log(
      `TEST_RESIDUE_TOTAL=${totalResidue}`
    );

    if (totalResidue !== 0) {
      throw new Error(
        "FINAL_TEST_RESIDUE_NOT_ZERO"
      );
    }

    section("12. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_007_POS_IDEMPOTENCY_SMOKE=PASS"
    );

    console.log(
      "FIRST_SALE=PASS"
    );

    console.log(
      "IDEMPOTENT_REUSE=PASS"
    );

    console.log(
      "SAME_ORDER_REUSED=PASS"
    );

    console.log(
      "ORDER_COUNT_IDEMPOTENCY=PASS"
    );

    console.log(
      "LOYALTY_MOVEMENT_IDEMPOTENCY=PASS"
    );

    console.log(
      "INVENTORY_IDEMPOTENCY=PASS"
    );

    console.log(
      "PAYMENT_IDEMPOTENCY=PASS"
    );

    console.log(
      "CASH_IDEMPOTENCY=PASS"
    );

    console.log(
      "SALE_CANCEL_CLEANUP=PASS"
    );

    console.log(
      "TEST_RESIDUE_TOTAL=0"
    );

    console.log(
      "NEXT_STEP=LOYALTY_RELATIONS_WITH_SALES_AUDIT"
    );

  } finally {
    await db.end();
  }
}

main().
then(() => {
  process.exit(0);
}).
catch((e) => {
  section(
    "CLIENTES-LOYALTY-007 FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
