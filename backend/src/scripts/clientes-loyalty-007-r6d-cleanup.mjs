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

const TARGET_ORDER =
"PED-LOCAL-1787235298184-1f88ce";

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

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-007 R6D CONTROLLED CLEANUP")

  );

  console.log(`TARGET_ORDER=${TARGET_ORDER}`);
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const db = new Client(dbConfig());

  await db.connect();

  let tx = false;

  try {

    /*
     * =======================================================
     * 1. EXACT TARGET
     * =======================================================
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
        beneficios_revertidos,
        pos_idempotency_key
      FROM gmx.pedidos
      WHERE id_pedido=$1
      `,
      [TARGET_ORDER]
    );

    console.log(
      `TARGET_ROWS=${target.rowCount}`
    );

    console.table(target.rows);

    if (target.rowCount !== 1) {
      throw new Error(
        "TARGET_ORDER_NOT_EXACT"
      );
    }

    const order = target.rows[0];

    if (
    !String(
      order.pos_idempotency_key || ""
    ).startsWith("LOYALTY007-"))
    {
      throw new Error(
        "SAFETY_ABORT_NOT_LOYALTY007"
      );
    }

    if (
    String(
      order.estado_pedido || ""
    ).toUpperCase() !== "CANCELADO")
    {
      throw new Error(
        "SAFETY_ABORT_ORDER_NOT_CANCELLED"
      );
    }

    if (
    order.inventario_liberado !== true)
    {
      throw new Error(
        "SAFETY_ABORT_INVENTORY_NOT_RELEASED"
      );
    }

    const clientId =
    order.id_cliente;

    console.log(
      `TARGET_CLIENT_ID=${clientId}`
    );

    /*
     * =======================================================
     * 2. DEPENDENCY SNAPSHOT
     * =======================================================
     */

    section("2. TEST DEPENDENCY SNAPSHOT");

    const counts = {};

    for (const table of [
    "detalle_pedidos",
    "pedido_pagos",
    "fidelidad_movimientos",
    "promociones_redenciones",
    "payment_transactions",
    "caja_movimientos"])
    {
      if (!(await tableExists(db, table))) {
        counts[table] = "TABLE_NOT_PRESENT";
        continue;
      }

      if (
      table === "caja_movimientos")
      {
        const hasOrigen =
        await columnExists(
          db,
          table,
          "id_origen"
        );

        const hasReferencia =
        await columnExists(
          db,
          table,
          "referencia"
        );

        const clauses = [];
        const params = [];

        if (hasOrigen) {
          params.push(TARGET_ORDER);
          clauses.push(
            `id_origen=$${params.length}`
          );
        }

        if (hasReferencia) {
          params.push(TARGET_ORDER);
          clauses.push(
            `referencia=$${params.length}`
          );
        }

        if (!clauses.length) {
          counts[table] =
          "NO_SUPPORTED_LINK_COLUMN";
        } else {
          const r = await db.query(
            `
            SELECT COUNT(*)::bigint AS total
            FROM gmx.caja_movimientos
            WHERE ${clauses.join(" OR ")}
            `,
            params
          );

          counts[table] =
          r.rows[0].total;
        }

        continue;
      }

      if (
      await columnExists(
        db,
        table,
        "id_pedido"
      ))
      {
        const r = await db.query(
          `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.${table}
          WHERE id_pedido=$1
          `,
          [TARGET_ORDER]
        );

        counts[table] =
        r.rows[0].total;
      }
    }

    console.table([
    counts]
    );

    /*
     * =======================================================
     * 3. CONTROLLED HARD CLEANUP
     * =======================================================
     */

    section("3. CONTROLLED HARD CLEANUP");

    await db.query("BEGIN");
    tx = true;

    /*
     * Promotions first if present.
     */
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
        const r = await db.query(
          `
          DELETE FROM gmx.promociones_redenciones
          WHERE id_pedido=$1
          `,
          [TARGET_ORDER]
        );

        console.log(
          `DELETE_PROMO_REDEMPTIONS=${r.rowCount}`
        );
      }
    }

    /*
     * Loyalty movements.
     */
    const loyalty = await db.query(
      `
      DELETE FROM gmx.fidelidad_movimientos
      WHERE id_pedido=$1
      `,
      [TARGET_ORDER]
    );

    console.log(
      `DELETE_LOYALTY_MOVEMENTS=${loyalty.rowCount}`
    );

    /*
     * Payment transactions if table/column exists.
     */
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
        const r = await db.query(
          `
          DELETE FROM gmx.payment_transactions
          WHERE id_pedido=$1
          `,
          [TARGET_ORDER]
        );

        console.log(
          `DELETE_PAYMENT_TRANSACTIONS=${r.rowCount}`
        );
      }
    }

    /*
     * Caja using REAL contract only.
     */
    const cajaClauses = [];
    const cajaParams = [];

    if (
    await columnExists(
      db,
      "caja_movimientos",
      "id_origen"
    ))
    {
      cajaParams.push(
        TARGET_ORDER
      );

      cajaClauses.push(
        `id_origen=$${cajaParams.length}`
      );
    }

    if (
    await columnExists(
      db,
      "caja_movimientos",
      "referencia"
    ))
    {
      cajaParams.push(
        TARGET_ORDER
      );

      cajaClauses.push(
        `referencia=$${cajaParams.length}`
      );
    }

    if (cajaClauses.length) {
      const r = await db.query(
        `
        DELETE FROM gmx.caja_movimientos
        WHERE ${cajaClauses.join(" OR ")}
        `,
        cajaParams
      );

      console.log(
        `DELETE_CAJA_MOVIMIENTOS=${r.rowCount}`
      );
    }

    /*
     * Payments.
     */
    const payments = await db.query(
      `
      DELETE FROM gmx.pedido_pagos
      WHERE id_pedido=$1
      `,
      [TARGET_ORDER]
    );

    console.log(
      `DELETE_PEDIDO_PAGOS=${payments.rowCount}`
    );

    /*
     * Details.
     */
    const details = await db.query(
      `
      DELETE FROM gmx.detalle_pedidos
      WHERE id_pedido=$1
      `,
      [TARGET_ORDER]
    );

    console.log(
      `DELETE_DETALLE_PEDIDOS=${details.rowCount}`
    );

    /*
     * Order itself.
     */
    const deletedOrder =
    await db.query(
      `
        DELETE FROM gmx.pedidos
        WHERE
          id_pedido=$1
          AND estado_pedido='CANCELADO'
          AND inventario_liberado=true
          AND pos_idempotency_key
              LIKE 'LOYALTY007-%'
        RETURNING
          row_id,
          id_pedido,
          id_cliente
        `,
      [TARGET_ORDER]
    );

    console.log(
      `DELETE_ORDER=${deletedOrder.rowCount}`
    );

    if (
    deletedOrder.rowCount !== 1)
    {
      throw new Error(
        "DELETE_ORDER_FAILED"
      );
    }

    /*
     * Loyalty account only belongs to TEST client.
     */
    if (clientId) {
      const client = await db.query(
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

      if (client.rowCount === 1) {
        const c = client.rows[0];

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
            "SAFETY_ABORT_CLIENT_NOT_TEST"
          );
        }

        const remainingOrders =
        await db.query(
          `
            SELECT COUNT(*)::bigint AS total
            FROM gmx.pedidos
            WHERE id_cliente=$1
            `,
          [clientId]
        );

        if (
        Number(
          remainingOrders.rows[0].total
        ) !== 0)
        {
          throw new Error(
            "TEST_CLIENT_OTHER_ORDERS_REMAIN"
          );
        }

        const account =
        await db.query(
          `
            DELETE FROM gmx.fidelidad_cuentas
            WHERE id_cliente=$1
            `,
          [clientId]
        );

        console.log(
          `DELETE_LOYALTY_ACCOUNT=${account.rowCount}`
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

        console.log(
          `DELETE_CLIENT=${deletedClient.rowCount}`
        );

        if (
        deletedClient.rowCount !== 1)
        {
          throw new Error(
            "DELETE_TEST_CLIENT_FAILED"
          );
        }
      }
    }

    /*
     * =======================================================
     * 4. VERIFY BEFORE COMMIT
     * =======================================================
     */

    section("4. VERIFY BEFORE COMMIT");

    const verify = await db.query(
      `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE id_pedido=$1
             OR pos_idempotency_key
                LIKE 'LOYALTY007-%'
        )::bigint
          AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.detalle_pedidos
          WHERE id_pedido=$1
        )::bigint
          AS detalles,

        (
          SELECT COUNT(*)
          FROM gmx.pedido_pagos
          WHERE id_pedido=$1
        )::bigint
          AS pagos,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE id_pedido=$1
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
      [TARGET_ORDER]
    );

    console.table(
      verify.rows
    );

    const v = verify.rows[0];

    if (
    Number(v.pedidos) !== 0 ||
    Number(v.detalles) !== 0 ||
    Number(v.pagos) !== 0 ||
    Number(v.loyalty) !== 0 ||
    Number(v.clientes) !== 0)
    {
      throw new Error(
        "TEST_RESIDUE_BEFORE_COMMIT_NOT_ZERO"
      );
    }

    await db.query("COMMIT");
    tx = false;

    console.log(
      "CLEANUP_COMMIT=PASS"
    );

    /*
     * =======================================================
     * FINAL
     * =======================================================
     */

    section("5. FINAL SUMMARY");

    console.log(
      "LOYALTY007_R6D_CLEANUP=PASS"
    );

    console.log(
      "INVENTORY_ALREADY_RECOVERED=YES"
    );

    console.log(
      "TEST_RESIDUE_PEDIDOS=0"
    );

    console.log(
      "TEST_RESIDUE_DETALLES=0"
    );

    console.log(
      "TEST_RESIDUE_PAGOS=0"
    );

    console.log(
      "TEST_RESIDUE_LOYALTY=0"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "NEXT_STEP=PATCH_CAJA_AND_RERUN"
    );

  } catch (e) {
    if (tx) {
      try {
        await db.query("ROLLBACK");
      } catch {}
    }

    throw e;

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "LOYALTY007 R6D CLEANUP FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
