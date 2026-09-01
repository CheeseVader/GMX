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

async function main() {
  section(brandText("GMX — LOYALTY-007 R6B CONTROLLED RECOVERY")

  );

  const db = new Client(dbConfig());

  await db.connect();

  try {
    /*
     * =======================================================
     * 1. DISCOVER EXACT TEST ORDERS
     * =======================================================
     */

    section("1. DISCOVER LOYALTY007 TEST RESIDUE");

    const orders = await db.query(`
      SELECT
        p.row_id,
        p.id_pedido,
        p.id_cliente,
        p.estado_pedido,
        p.inventario_liberado,
        p.pos_idempotency_key,
        c.nombre,
        c.email

      FROM gmx.pedidos p

      LEFT JOIN gmx.clientes c
        ON c.id_cliente=p.id_cliente

      WHERE
        p.pos_idempotency_key LIKE 'LOYALTY007-%'

        OR (
          c.nombre LIKE 'CLIENTES LOYALTY007 TEST %'
          AND
          c.email LIKE
            'clientes.loyalty007.%@example.invalid'
        )

      ORDER BY p.row_id
    `);

    console.log(
      `TEST_ORDERS_FOUND=${orders.rowCount}`
    );

    console.table(orders.rows);

    /*
     * =======================================================
     * 2. CANCEL ACTIVE TEST ORDERS FIRST
     *
     * Esto es crítico:
     * no hacemos DELETE directo antes de restaurar inventario.
     * =======================================================
     */

    section("2. CONTROLLED SALE CANCELLATION");

    for (const order of orders.rows) {
      const exact =
      String(
        order.pos_idempotency_key || ""
      ).startsWith("LOYALTY007-");

      if (!exact) {
        throw new Error(
          `SAFETY_ABORT_NON_TEST_ORDER_${order.id_pedido}`
        );
      }

      const alreadyReleased =
      order.inventario_liberado === true;

      console.log(
        `ORDER=${order.id_pedido}`
      );

      console.log(
        `INVENTORY_ALREADY_RELEASED=${
        alreadyReleased ? "YES" : "NO"}`

      );

      if (!alreadyReleased) {
        const result = await cancelSale({
          rowId: order.row_id,

          reason:
          "LOYALTY-007 R6B TEST RECOVERY",

          user: {
            id_admin: "TEST-LOYALTY007",
            nombre: "LOYALTY-007 RECOVERY"
          }
        });

        console.log(
          `CANCEL_RESULT_${order.id_pedido}=`
        );

        console.log(
          JSON.stringify(result, null, 2)
        );

        console.log(
          `CONTROLLED_CANCEL_${order.id_pedido}=PASS`
        );

      } else {
        console.log(
          `CONTROLLED_CANCEL_${order.id_pedido}=NOT_REQUIRED`
        );
      }
    }

    /*
     * =======================================================
     * 3. DISCOVER CAJA REAL CONTRACT
     * =======================================================
     */

    section("3. CAJA_MOVIMIENTOS REAL CONTRACT");

    const cajaCols = await db.query(`
      SELECT
        ordinal_position,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='caja_movimientos'
      ORDER BY ordinal_position
    `);

    console.table(cajaCols.rows);

    const cajaColumnNames =
    new Set(
      cajaCols.rows.map(
        (x) => x.column_name
      )
    );

    console.log(
      `CAJA_HAS_ID_PEDIDO=${
      cajaColumnNames.has("id_pedido") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_ID_ORIGEN=${
      cajaColumnNames.has("id_origen") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_REFERENCIA=${
      cajaColumnNames.has("referencia") ?
      "YES" :
      "NO"}`

    );

    /*
     * =======================================================
     * 4. HARD TEST CLEANUP
     *
     * Solo después de cancelSale.
     * =======================================================
     */

    section("4. CONTROLLED HARD TEST CLEANUP");

    for (const order of orders.rows) {
      await db.query("BEGIN");

      try {
        const orderCheck = await db.query(
          `
          SELECT
            row_id,
            id_pedido,
            id_cliente,
            inventario_liberado,
            pos_idempotency_key
          FROM gmx.pedidos
          WHERE
            row_id=$1
            AND id_pedido=$2
            AND pos_idempotency_key
                LIKE 'LOYALTY007-%'
          FOR UPDATE
          `,
          [
          order.row_id,
          order.id_pedido]

        );

        if (orderCheck.rowCount !== 1) {
          throw new Error(
            `CLEANUP_TARGET_INVALID_${order.id_pedido}`
          );
        }

        /*
         * Inventario debe estar liberado antes del hard delete.
         */
        if (
        orderCheck.rows[0].
        inventario_liberado !== true)
        {
          throw new Error(
            `SAFETY_ABORT_INVENTORY_NOT_RELEASED_${order.id_pedido}`
          );
        }

        await db.query(
          `
          DELETE FROM gmx.fidelidad_movimientos
          WHERE id_pedido=$1
          `,
          [order.id_pedido]
        );

        /*
         * Caja: construir WHERE únicamente con columnas reales.
         */
        const cajaWhere = [];
        const cajaParams = [];

        if (
        cajaColumnNames.has(
          "id_origen"
        ))
        {
          cajaParams.push(
            order.id_pedido
          );

          cajaWhere.push(
            `id_origen=$${cajaParams.length}`
          );
        }

        if (
        cajaColumnNames.has(
          "referencia"
        ))
        {
          cajaParams.push(
            order.id_pedido
          );

          cajaWhere.push(
            `referencia=$${cajaParams.length}`
          );
        }

        if (cajaWhere.length) {
          const result =
          await db.query(
            `
              DELETE FROM gmx.caja_movimientos
              WHERE ${
            cajaWhere.join(" OR ")}
              `,

            cajaParams
          );

          console.log(
            `CAJA_DELETED_${order.id_pedido}=${result.rowCount}`
          );
        }

        await db.query(
          `
          DELETE FROM gmx.pedido_pagos
          WHERE id_pedido=$1
          `,
          [order.id_pedido]
        );

        await db.query(
          `
          DELETE FROM gmx.detalle_pedidos
          WHERE id_pedido=$1
          `,
          [order.id_pedido]
        );

        /*
         * Si existe payment_transactions relacionada,
         * eliminar solo el pedido TEST.
         */
        const ptExists =
        await db.query(`
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE
                table_schema='gmx'
                AND table_name='payment_transactions'
            ) AS exists
          `);

        if (
        ptExists.rows[0]?.exists)
        {
          await db.query(
            `
            DELETE FROM gmx.payment_transactions
            WHERE id_pedido=$1
            `,
            [order.id_pedido]
          );
        }

        const deletedOrder =
        await db.query(
          `
            DELETE FROM gmx.pedidos
            WHERE
              row_id=$1
              AND id_pedido=$2
              AND pos_idempotency_key
                  LIKE 'LOYALTY007-%'
            RETURNING
              row_id,
              id_pedido
            `,
          [
          order.row_id,
          order.id_pedido]

        );

        if (
        deletedOrder.rowCount !== 1)
        {
          throw new Error(
            `ORDER_DELETE_FAILED_${order.id_pedido}`
          );
        }

        await db.query("COMMIT");

        console.log(
          `HARD_CLEANUP_${order.id_pedido}=PASS`
        );

      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }

    /*
     * =======================================================
     * 5. DELETE TEST CLIENTS AFTER ORDERS
     * =======================================================
     */

    section("5. TEST CLIENT CLEANUP");

    const clients = await db.query(`
      SELECT
        row_id,
        id_cliente,
        nombre,
        email
      FROM gmx.clientes
      WHERE
        nombre LIKE
          'CLIENTES LOYALTY007 TEST %'
        AND
        email LIKE
          'clientes.loyalty007.%@example.invalid'
      ORDER BY row_id
    `);

    for (const client of clients.rows) {
      const deps = await db.query(
        `
        SELECT
          (
            SELECT COUNT(*)
            FROM gmx.pedidos
            WHERE id_cliente=$1
          )::bigint AS pedidos,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_cliente=$1
          )::bigint AS movimientos
        `,
        [client.id_cliente]
      );

      if (
      Number(deps.rows[0].pedidos) !== 0 ||
      Number(deps.rows[0].movimientos) !== 0)
      {
        throw new Error(
          `CLIENT_DEPENDENCY_REMAINS_${client.id_cliente}`
        );
      }

      await db.query("BEGIN");

      try {
        await db.query(
          `
          DELETE FROM gmx.fidelidad_cuentas
          WHERE id_cliente=$1
          `,
          [client.id_cliente]
        );

        const deleted =
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
          client.row_id,
          client.id_cliente]

        );

        if (
        deleted.rowCount !== 1)
        {
          throw new Error(
            `CLIENT_DELETE_FAILED_${client.id_cliente}`
          );
        }

        await db.query("COMMIT");

        console.log(
          `CLIENT_CLEANUP_${client.id_cliente}=PASS`
        );

      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }

    /*
     * =======================================================
     * 6. FINAL TEST RESIDUE
     * =======================================================
     */

    section("6. FINAL RESIDUE");

    const final = await db.query(`
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE pos_idempotency_key
                LIKE 'LOYALTY007-%'
        )::bigint
          AS pedidos,

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
          AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE id_pedido LIKE
                'PED-%'
            AND id_cliente NOT IN (
              SELECT id_cliente
              FROM gmx.clientes
            )
        )::bigint
          AS loyalty_orphans
    `);

    console.table(final.rows);

    if (
    Number(final.rows[0].pedidos) !== 0 ||
    Number(final.rows[0].clientes) !== 0)
    {
      throw new Error(
        "FINAL_LOYALTY007_TEST_RESIDUE_NOT_ZERO"
      );
    }

    section("7. RECOVERY SUMMARY");

    console.log(
      "LOYALTY007_R6B_RECOVERY=PASS"
    );

    console.log(
      "TEST_RESIDUE_PEDIDOS=0"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      `CAJA_HAS_ID_PEDIDO=${
      cajaColumnNames.has("id_pedido") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_ID_ORIGEN=${
      cajaColumnNames.has("id_origen") ?
      "YES" :
      "NO"}`

    );

    console.log(
      `CAJA_HAS_REFERENCIA=${
      cajaColumnNames.has("referencia") ?
      "YES" :
      "NO"}`

    );

    console.log(
      "INVENTORY_RECOVERY=PASS"
    );

    console.log(
      "NEXT_STEP=PATCH_R6_CAJA_QUERY"
    );

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "LOYALTY007 R6B RECOVERY FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
