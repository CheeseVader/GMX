import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { fileURLToPath } from "node:url";

import {
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

const TARGET_ORDER =
"PED-LOCAL-1787235298184-1f88ce";

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-007 R6C EXACT RECOVERY")

  );

  console.log(`TARGET_ORDER=${TARGET_ORDER}`);
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const db = new Client(dbConfig());

  await db.connect();

  try {

    /*
     * =====================================================
     * 1. EXACT ORDER PRECHECK
     * =====================================================
     */

    section("1. ORDER PRECHECK");

    const orderResult = await db.query(
      `
      SELECT
        row_id,
        id_pedido,
        id_cliente,
        estado_pedido,
        inventario_liberado,
        pos_idempotency_key,
        id_sucursal
      FROM gmx.pedidos
      WHERE id_pedido=$1
      `,
      [TARGET_ORDER]
    );

    console.log(
      `TARGET_ORDER_ROWS=${orderResult.rowCount}`
    );

    console.table(orderResult.rows);

    if (orderResult.rowCount !== 1) {
      throw new Error(
        "TARGET_TEST_ORDER_NOT_EXACT"
      );
    }

    const order = orderResult.rows[0];

    if (
    !String(
      order.pos_idempotency_key || ""
    ).startsWith("LOYALTY007-"))
    {
      throw new Error(
        "SAFETY_ABORT_NOT_LOYALTY007_ORDER"
      );
    }

    console.log(
      `TARGET_ROW_ID=${order.row_id}`
    );

    /*
     * =====================================================
     * 2. DETAILS + INVENTORY BEFORE
     * =====================================================
     */

    section("2. INVENTORY BEFORE RECOVERY");

    const details = await db.query(
      `
      SELECT
        row_id,
        id_pedido,
        tipo,
        id_inventario,
        cantidad
      FROM gmx.detalle_pedidos
      WHERE id_pedido=$1
      ORDER BY row_id
      `,
      [TARGET_ORDER]
    );

    console.table(details.rows);

    if (details.rowCount < 1) {
      throw new Error(
        "TEST_ORDER_WITHOUT_DETAILS"
      );
    }

    const inventoryBefore = [];

    for (const detail of details.rows) {

      if (
      String(detail.tipo || "").
      toUpperCase() !== "TCG")
      {
        continue;
      }

      const inv = await db.query(
        `
        SELECT
          i.row_id AS global_row_id,
          i.id_inventario,
          i.stock AS global_stock,

          s.row_id AS branch_row_id,
          s.id_sucursal,
          s.stock AS branch_stock

        FROM gmx.tcg_inventario i

        JOIN gmx.tcg_inventario_sucursales s
          ON s.id_inventario=i.id_inventario

        WHERE
          i.id_inventario=$1
          AND s.id_sucursal=$2
        `,
        [
        detail.id_inventario,
        order.id_sucursal]

      );

      console.table(inv.rows);

      if (inv.rowCount !== 1) {
        throw new Error(
          `INVENTORY_PRECHECK_FAILED_${detail.id_inventario}`
        );
      }

      inventoryBefore.push({
        id_inventario:
        detail.id_inventario,

        cantidad:
        Number(detail.cantidad),

        branch_before:
        Number(
          inv.rows[0].branch_stock
        ),

        global_before:
        Number(
          inv.rows[0].global_stock
        )
      });
    }

    /*
     * =====================================================
     * 3. CANCEL USING EXACT FUNCTION CONTRACT
     *
     * cancelSale(
     *   rowId,
     *   reason,
     *   user
     * )
     * =====================================================
     */

    section("3. EXACT cancelSale() RECOVERY");

    if (
    order.inventario_liberado === true ||
    String(
      order.estado_pedido || ""
    ).toUpperCase() === "CANCELADO")
    {

      console.log(
        "CANCELSALE=NOT_REQUIRED_ALREADY_RECOVERED"
      );

    } else {

      const result = await cancelSale(
        order.row_id,

        "LOYALTY-007 R6C CONTROLLED TEST RECOVERY",

        {
          id_admin: "TEST-LOYALTY007",
          nombre: "LOYALTY-007 RECOVERY"
        }
      );

      console.log(
        "CANCEL_RESULT="
      );

      console.log(
        JSON.stringify(
          result,
          null,
          2
        )
      );

      console.log(
        "CANCELSALE=PASS"
      );
    }

    /*
     * =====================================================
     * 4. VERIFY ORDER AFTER CANCEL
     * =====================================================
     */

    section("4. ORDER AFTER RECOVERY");

    const afterOrder = await db.query(
      `
      SELECT
        row_id,
        id_pedido,
        estado_pedido,
        inventario_liberado,
        beneficios_revertidos
      FROM gmx.pedidos
      WHERE id_pedido=$1
      `,
      [TARGET_ORDER]
    );

    console.table(afterOrder.rows);

    if (afterOrder.rowCount !== 1) {
      throw new Error(
        "ORDER_MISSING_AFTER_CANCEL"
      );
    }

    const recovered =
    afterOrder.rows[0];

    if (
    String(
      recovered.estado_pedido || ""
    ).toUpperCase() !== "CANCELADO")
    {
      throw new Error(
        "ORDER_NOT_CANCELLED"
      );
    }

    if (
    recovered.inventario_liberado !== true)
    {
      throw new Error(
        "INVENTORY_NOT_MARKED_RELEASED"
      );
    }

    console.log(
      "ORDER_CANCEL_STATE=PASS"
    );

    console.log(
      "INVENTORY_RELEASE_FLAG=PASS"
    );

    /*
     * =====================================================
     * 5. VERIFY INVENTORY WAS RESTORED EXACTLY ONCE
     * =====================================================
     */

    section("5. INVENTORY RESTORE VERIFICATION");

    for (const before of inventoryBefore) {

      const inv = await db.query(
        `
        SELECT
          i.stock AS global_stock,
          s.stock AS branch_stock

        FROM gmx.tcg_inventario i

        JOIN gmx.tcg_inventario_sucursales s
          ON s.id_inventario=i.id_inventario

        WHERE
          i.id_inventario=$1
          AND s.id_sucursal=$2
        `,
        [
        before.id_inventario,
        order.id_sucursal]

      );

      if (inv.rowCount !== 1) {
        throw new Error(
          `INVENTORY_POSTCHECK_FAILED_${before.id_inventario}`
        );
      }

      const branchAfter =
      Number(
        inv.rows[0].branch_stock
      );

      const globalAfter =
      Number(
        inv.rows[0].global_stock
      );

      console.log(
        `INVENTORY=${before.id_inventario}`
      );

      console.log(
        `BRANCH_STOCK=${before.branch_before}->${branchAfter}`
      );

      console.log(
        `GLOBAL_STOCK=${before.global_before}->${globalAfter}`
      );

      /*
       * Venta había descontado cantidad.
       * cancelSale debe devolver exactamente cantidad.
       */
      if (
      branchAfter !==
      before.branch_before +
      before.cantidad)
      {
        throw new Error(
          "BRANCH_INVENTORY_RESTORE_INVALID"
        );
      }

      if (
      globalAfter !==
      before.global_before +
      before.cantidad)
      {
        throw new Error(
          "GLOBAL_INVENTORY_RESTORE_INVALID"
        );
      }
    }

    console.log(
      "INVENTORY_RESTORE=PASS"
    );

    /*
     * =====================================================
     * 6. DISCOVER REAL CAJA CONTRACT
     * =====================================================
     */

    section("6. CAJA CONTRACT");

    const cajaCols = await db.query(
      `
      SELECT
        ordinal_position,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='caja_movimientos'
      ORDER BY ordinal_position
      `
    );

    console.table(cajaCols.rows);

    const cajaNames =
    new Set(
      cajaCols.rows.map(
        (x) => x.column_name
      )
    );

    console.log(
      `CAJA_HAS_ID_PEDIDO=${
      cajaNames.has("id_pedido") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_ID_ORIGEN=${
      cajaNames.has("id_origen") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_REFERENCIA=${
      cajaNames.has("referencia") ?
      "YES" :
      "NO"}`

    );

    /*
     * =====================================================
     * 7. STOP HERE
     *
     * Todavía NO hard delete.
     * Primero queremos evidencia de recovery exitoso.
     * =====================================================
     */

    section("7. FINAL SUMMARY");

    console.log(
      "LOYALTY007_R6C_EXACT_RECOVERY=PASS"
    );

    console.log(
      `TARGET_ORDER=${TARGET_ORDER}`
    );

    console.log(
      "ORDER_CANCEL_STATE=PASS"
    );

    console.log(
      "INVENTORY_RELEASE_FLAG=PASS"
    );

    console.log(
      "INVENTORY_RESTORE=PASS"
    );

    console.log(
      `CAJA_HAS_ID_PEDIDO=${
      cajaNames.has("id_pedido") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_ID_ORIGEN=${
      cajaNames.has("id_origen") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_REFERENCIA=${
      cajaNames.has("referencia") ?
      "YES" :
      "NO"}`

    );

    console.log(
      "HARD_DELETE_PERFORMED=NO"
    );

    console.log(
      "NEXT_STEP=LOYALTY007_R6D_TEST_CLEANUP_AND_RERUN"
    );

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "LOYALTY007 R6C RECOVERY FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
