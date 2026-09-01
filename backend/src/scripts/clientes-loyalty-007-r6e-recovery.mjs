import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
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

const TARGET_ROW_ID = 53;

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-007 R6E RECOVERY")

  );

  console.log(`TARGET_ROW_ID=${TARGET_ROW_ID}`);

  const db = new Client(dbConfig());

  await db.connect();

  try {

    /*
     * -------------------------------------------------------
     * PRECHECK
     * -------------------------------------------------------
     */

    section("1. TARGET PRECHECK");

    const target = await db.query(
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

      WHERE row_id=$1
      `,
      [TARGET_ROW_ID]
    );

    console.log(
      `TARGET_ROWS=${target.rowCount}`
    );

    console.table(target.rows);

    if (target.rowCount !== 1) {
      throw new Error(
        "TARGET_ROW_NOT_FOUND_OR_NOT_EXACT"
      );
    }

    const order = target.rows[0];

    if (
    !String(
      order.pos_idempotency_key || ""
    ).startsWith("LOYALTY007-"))
    {
      throw new Error(
        "SAFETY_ABORT_NOT_LOYALTY007_TEST_ORDER"
      );
    }

    const orderId =
    order.id_pedido;

    const clientId =
    order.id_cliente;

    console.log(
      `TARGET_ORDER=${orderId}`
    );

    console.log(
      `TARGET_CLIENT=${clientId}`
    );

    /*
     * -------------------------------------------------------
     * INVENTORY BEFORE
     * -------------------------------------------------------
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
      [orderId]
    );

    console.table(details.rows);

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
          i.id_inventario,
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
        detail.id_inventario,
        order.id_sucursal]

      );

      if (inv.rowCount !== 1) {
        throw new Error(
          "INVENTORY_PRECHECK_FAILED"
        );
      }

      console.table(inv.rows);

      inventoryBefore.push({
        id_inventario:
        detail.id_inventario,

        qty:
        Number(detail.cantidad),

        branch:
        Number(
          inv.rows[0].branch_stock
        ),

        global:
        Number(
          inv.rows[0].global_stock
        )
      });
    }

    /*
     * -------------------------------------------------------
     * EXACT cancelSale CONTRACT
     * -------------------------------------------------------
     */

    section("3. CANCEL SALE");

    if (
    String(
      order.estado_pedido || ""
    ).toUpperCase() === "CANCELADO" &&
    order.inventario_liberado === true)
    {

      console.log(
        "CANCELSALE=NOT_REQUIRED_ALREADY_CANCELLED"
      );

    } else {

      const result = await cancelSale(
        TARGET_ROW_ID,

        "LOYALTY-007 R6E CONTROLLED RECOVERY",

        {
          id_admin:
          "TEST-LOYALTY007",

          nombre:
          "CLIENTES-LOYALTY-007 TEST"
        }
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
     * -------------------------------------------------------
     * ORDER STATE AFTER
     * -------------------------------------------------------
     */

    section("4. ORDER STATE AFTER");

    const after = await db.query(
      `
      SELECT
        row_id,
        id_pedido,
        estado_pedido,
        inventario_liberado,
        beneficios_revertidos

      FROM gmx.pedidos

      WHERE row_id=$1
      `,
      [TARGET_ROW_ID]
    );

    console.table(after.rows);

    if (
    after.rowCount !== 1)
    {
      throw new Error(
        "ORDER_MISSING_AFTER_CANCEL"
      );
    }

    if (
    String(
      after.rows[0].estado_pedido || ""
    ).toUpperCase() !== "CANCELADO")
    {
      throw new Error(
        "ORDER_NOT_CANCELLED"
      );
    }

    if (
    after.rows[0].
    inventario_liberado !== true)
    {
      throw new Error(
        "INVENTORY_NOT_RELEASED"
      );
    }

    console.log(
      "ORDER_CANCEL_STATE=PASS"
    );

    console.log(
      "INVENTORY_RELEASE_FLAG=PASS"
    );

    /*
     * -------------------------------------------------------
     * INVENTORY RESTORE
     * -------------------------------------------------------
     */

    section("5. INVENTORY RESTORE");

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
        `BRANCH=${before.branch}->${branchAfter}`
      );

      console.log(
        `GLOBAL=${before.global}->${globalAfter}`
      );

      if (
      branchAfter !==
      before.branch + before.qty)
      {
        throw new Error(
          "BRANCH_RESTORE_INVALID"
        );
      }

      if (
      globalAfter !==
      before.global + before.qty)
      {
        throw new Error(
          "GLOBAL_RESTORE_INVALID"
        );
      }
    }

    console.log(
      "INVENTORY_RESTORE=PASS"
    );

    /*
     * -------------------------------------------------------
     * HARD TEST CLEANUP
     * -------------------------------------------------------
     */

    section("6. HARD TEST CLEANUP");

    await db.query("BEGIN");

    try {

      await db.query(
        `
        DELETE FROM gmx.fidelidad_movimientos
        WHERE id_pedido=$1
        `,
        [orderId]
      );

      /*
       * Caja usa id_origen/referencia.
       */
      await db.query(
        `
        DELETE FROM gmx.caja_movimientos
        WHERE
          id_origen=$1
          OR referencia=$1
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

      /*
       * payment_transactions si existe.
       */
      const pt = await db.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE
            table_schema='gmx'
            AND table_name='payment_transactions'
        ) AS exists
        `
      );

      if (
      pt.rows[0]?.exists)
      {
        const ptColumn =
        await db.query(
          `
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE
                table_schema='gmx'
                AND table_name='payment_transactions'
                AND column_name='id_pedido'
            ) AS exists
            `
        );

        if (
        ptColumn.rows[0]?.exists)
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

      const deletedOrder =
      await db.query(
        `
          DELETE FROM gmx.pedidos
          WHERE
            row_id=$1
            AND id_pedido=$2
            AND estado_pedido='CANCELADO'
            AND inventario_liberado=true
            AND pos_idempotency_key
                LIKE 'LOYALTY007-%'

          RETURNING
            row_id,
            id_pedido
          `,
        [
        TARGET_ROW_ID,
        orderId]

      );

      if (
      deletedOrder.rowCount !== 1)
      {
        throw new Error(
          "ORDER_DELETE_FAILED"
        );
      }

      /*
       * Test client.
       */
      if (clientId) {

        const client =
        await db.query(
          `
            SELECT
              row_id,
              id_cliente,
              nombre,
              email

            FROM gmx.clientes

            WHERE id_cliente=$1
            `,
          [clientId]
        );

        if (
        client.rowCount === 1)
        {
          const c =
          client.rows[0];

          const exact =
          String(c.nombre || "").
          startsWith(
            "CLIENTES LOYALTY007 TEST "
          ) &&
          String(c.email || "").
          startsWith(
            "clientes.loyalty007."
          ) &&
          String(c.email || "").
          endsWith(
            "@example.invalid"
          );

          if (!exact) {
            throw new Error(
              "CLIENT_SAFETY_SIGNATURE_FAILED"
            );
          }

          await db.query(
            `
            DELETE FROM gmx.fidelidad_cuentas
            WHERE id_cliente=$1
            `,
            [clientId]
          );

          const deletedClient =
          await db.query(
            `
              DELETE FROM gmx.clientes

              WHERE
                row_id=$1
                AND id_cliente=$2
                AND nombre LIKE
                    'CLIENTES LOYALTY007 TEST %'
                AND email LIKE
                    'clientes.loyalty007.%@example.invalid'

              RETURNING id_cliente
              `,
            [
            c.row_id,
            clientId]

          );

          if (
          deletedClient.rowCount !== 1)
          {
            throw new Error(
              "CLIENT_DELETE_FAILED"
            );
          }
        }
      }

      /*
       * Verify zero before commit.
       */
      const verify =
      await db.query(
        `
          SELECT

            (
              SELECT COUNT(*)
              FROM gmx.pedidos
              WHERE
                row_id=$1
                OR id_pedido=$2
            )::bigint
              AS pedidos,

            (
              SELECT COUNT(*)
              FROM gmx.detalle_pedidos
              WHERE id_pedido=$2
            )::bigint
              AS detalles,

            (
              SELECT COUNT(*)
              FROM gmx.pedido_pagos
              WHERE id_pedido=$2
            )::bigint
              AS pagos,

            (
              SELECT COUNT(*)
              FROM gmx.fidelidad_movimientos
              WHERE id_pedido=$2
            )::bigint
              AS loyalty,

            (
              SELECT COUNT(*)
              FROM gmx.clientes
              WHERE
                nombre LIKE
                  'CLIENTES LOYALTY007 TEST %'
                OR
                email LIKE
                  'clientes.loyalty007.%@example.invalid'
            )::bigint
              AS clientes
          `,
        [
        TARGET_ROW_ID,
        orderId]

      );

      console.table(
        verify.rows
      );

      const v =
      verify.rows[0];

      if (
      Number(v.pedidos) !== 0 ||
      Number(v.detalles) !== 0 ||
      Number(v.pagos) !== 0 ||
      Number(v.loyalty) !== 0 ||
      Number(v.clientes) !== 0)
      {
        throw new Error(
          "TEST_RESIDUE_NOT_ZERO"
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

    /*
     * -------------------------------------------------------
     * SUMMARY
     * -------------------------------------------------------
     */

    section("7. RECOVERY SUMMARY");

    console.log(
      "LOYALTY007_R6E_RECOVERY=PASS"
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
      "TEST_RESIDUE_PEDIDOS=0"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "NEXT_STEP=PATCH_SMOKE_CANCELSALE"
    );

  } finally {

    await db.end();
  }
}

main().catch((e) => {

  section(
    "LOYALTY007 R6E RECOVERY FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
