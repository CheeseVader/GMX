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

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-007 R5B INVENTORY PRECHECK")

  );

  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const db = new Client(dbConfig());

  await db.connect();

  try {

    /*
     * =======================================================
     * 1. DETECTAR RESIDUOS LOYALTY007
     * =======================================================
     */

    section("1. FAILED RUN TEST CLIENT RESIDUE");

    const testClients = await db.query(`
      SELECT
        row_id,
        id_cliente,
        nombre,
        telefono,
        email,
        fecha_registro
      FROM gmx.clientes
      WHERE
        nombre LIKE 'CLIENTES LOYALTY007 TEST %'
        OR email LIKE 'clientes.loyalty007.%@example.invalid'
      ORDER BY row_id
    `);

    console.log(
      `LOYALTY007_TEST_CLIENTS_FOUND=${testClients.rowCount}`
    );

    console.table(testClients.rows);

    /*
     * Solo limpiamos clientes con firma exacta TEST
     * Y sin pedido/cuenta/movimiento dependiente.
     */

    for (const row of testClients.rows) {

      const exact =
      String(row.nombre || "").
      startsWith("CLIENTES LOYALTY007 TEST ") &&
      String(row.email || "").
      startsWith("clientes.loyalty007.") &&
      String(row.email || "").
      endsWith("@example.invalid");

      if (!exact) {
        throw new Error(
          `SAFETY_ABORT_NON_TEST_SIGNATURE_${row.id_cliente}`
        );
      }

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
            FROM gmx.fidelidad_cuentas
            WHERE id_cliente=$1
          )::bigint AS cuentas,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_cliente=$1
          )::bigint AS movimientos
        `,
        [row.id_cliente]
      );

      const d = deps.rows[0];

      console.log(
        `CLIENT=${row.id_cliente} ` +
        `PEDIDOS=${d.pedidos} ` +
        `CUENTAS=${d.cuentas} ` +
        `MOVIMIENTOS=${d.movimientos}`
      );

      if (
      Number(d.pedidos) !== 0 ||
      Number(d.cuentas) !== 0 ||
      Number(d.movimientos) !== 0)
      {
        throw new Error(
          `SAFETY_ABORT_TEST_CLIENT_HAS_DEPENDENCIES_${row.id_cliente}`
        );
      }
    }

    if (testClients.rowCount > 0) {

      section("2. CONTROLLED TEST CLIENT CLEANUP");

      await db.query("BEGIN");

      try {

        for (const row of testClients.rows) {

          const deleted = await db.query(
            `
            DELETE FROM gmx.clientes
            WHERE
              row_id=$1
              AND id_cliente=$2
              AND nombre LIKE 'CLIENTES LOYALTY007 TEST %'
              AND email LIKE 'clientes.loyalty007.%@example.invalid'
            RETURNING row_id,id_cliente
            `,
            [
            row.row_id,
            row.id_cliente]

          );

          if (deleted.rowCount !== 1) {
            throw new Error(
              `TEST_CLIENT_DELETE_FAILED_${row.id_cliente}`
            );
          }

          console.log(
            `DELETED_TEST_CLIENT=${row.id_cliente}`
          );
        }

        await db.query("COMMIT");

        console.log("CLEANUP_COMMIT=PASS");

      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }

    } else {

      section("2. CONTROLLED TEST CLIENT CLEANUP");

      console.log(
        "TEST_CLIENT_CLEANUP=NOT_REQUIRED"
      );
    }

    /*
     * =======================================================
     * 3. FINAL RESIDUE CHECK
     * =======================================================
     */

    section("3. TEST RESIDUE VERIFICATION");

    const residue = await db.query(`
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE
            nombre LIKE 'CLIENTES LOYALTY007 TEST %'
            OR email LIKE 'clientes.loyalty007.%@example.invalid'
        )::bigint AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.cliente_identidad_unica ciu
          WHERE EXISTS (
            SELECT 1
            FROM gmx.clientes c
            WHERE
              c.id_cliente=ciu.id_cliente
              AND (
                c.nombre LIKE 'CLIENTES LOYALTY007 TEST %'
                OR
                c.email LIKE 'clientes.loyalty007.%@example.invalid'
              )
          )
        )::bigint AS identidades
    `);

    console.table(residue.rows);

    if (
    Number(residue.rows[0].clientes) !== 0 ||
    Number(residue.rows[0].identidades) !== 0)
    {
      throw new Error(
        "LOYALTY007_TEST_RESIDUE_NOT_ZERO"
      );
    }

    /*
     * =======================================================
     * 4. A PARTIR DE AQUÍ 100% READ ONLY
     * =======================================================
     */

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    section("4. SAFE TCG INVENTORY CANDIDATES");

    /*
     * IMPORTANTE:
     *
     * Para probar idempotencia necesitamos únicamente:
     *
     * primera venta: stock -1
     * replay:        stock -0
     *
     * Por lo tanto stock >=1 es suficiente.
     */

    const candidates = await db.query(`
      SELECT
        s.row_id AS branch_row_id,
        s.id_sucursal,
        s.id_inventario,

        s.stock::numeric
          AS branch_stock,

        i.row_id AS global_row_id,

        i.stock::numeric
          AS global_stock,

        i.precio::numeric
          AS precio,

        i.precio_oferta::numeric
          AS precio_oferta,

        CASE
          WHEN
            COALESCE(i.precio_oferta,0) > 0
          THEN i.precio_oferta
          ELSE i.precio
        END::numeric
          AS effective_price,

        i.estado_venta

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
          WHEN
            COALESCE(i.precio_oferta,0) > 0
          THEN i.precio_oferta
          ELSE i.precio
        END DESC,

        s.row_id

      LIMIT 20
    `);

    console.log(
      `SAFE_TCG_CANDIDATES=${candidates.rowCount}`
    );

    console.table(candidates.rows);

    if (candidates.rowCount === 0) {
      throw new Error(
        "NO_POSITIVE_PRICE_STOCKED_TCG"
      );
    }

    /*
     * =======================================================
     * 5. SELECT R6 CANDIDATE
     * =======================================================
     */

    section("5. SELECTED R6 CANDIDATE");

    const selected =
    candidates.rows[0];

    console.table([selected]);

    const branchStock =
    Number(selected.branch_stock);

    const globalStock =
    Number(selected.global_stock);

    const effectivePrice =
    Number(selected.effective_price);

    if (
    !Number.isFinite(branchStock) ||
    branchStock < 1)
    {
      throw new Error(
        "INVALID_BRANCH_STOCK"
      );
    }

    if (
    !Number.isFinite(globalStock) ||
    globalStock < 1)
    {
      throw new Error(
        "INVALID_GLOBAL_STOCK"
      );
    }

    if (
    !Number.isFinite(effectivePrice) ||
    effectivePrice <= 0)
    {
      throw new Error(
        "INVALID_EFFECTIVE_PRICE"
      );
    }

    console.log(
      `SELECTED_ID_SUCURSAL=${selected.id_sucursal}`
    );

    console.log(
      `SELECTED_ID_INVENTARIO=${selected.id_inventario}`
    );

    console.log(
      `SELECTED_BRANCH_STOCK=${branchStock}`
    );

    console.log(
      `SELECTED_GLOBAL_STOCK=${globalStock}`
    );

    console.log(
      `SELECTED_EFFECTIVE_PRICE=${effectivePrice}`
    );

    console.log(
      "STOCK_REQUIREMENT_FOR_IDEMPOTENCY_TEST=1"
    );

    console.log(
      "EXPECTED_FIRST_SALE_STOCK_DELTA=-1"
    );

    console.log(
      "EXPECTED_REPLAY_STOCK_DELTA=0"
    );

    /*
     * =======================================================
     * 6. VERIFY PREVIOUS HARDCODED CANDIDATE
     * =======================================================
     */

    section(
      "6. PREVIOUS R5 CANDIDATE DIAGNOSTIC"
    );

    const previous = await db.query(`
      SELECT
        s.id_sucursal,
        s.id_inventario,
        s.stock AS branch_stock,

        i.stock AS global_stock,
        i.precio,
        i.precio_oferta,

        CASE
          WHEN
            COALESCE(i.precio_oferta,0) > 0
          THEN i.precio_oferta
          ELSE i.precio
        END AS effective_price

      FROM gmx.tcg_inventario_sucursales s

      JOIN gmx.tcg_inventario i
        ON i.id_inventario=s.id_inventario

      WHERE
        s.id_sucursal='SUC-000010'

        AND
        s.id_inventario=
          'TCGI-1787006470686-05f79'
    `);

    console.table(previous.rows);

    if (previous.rowCount === 1) {

      const p =
      previous.rows[0];

      console.log(
        `R5_PREVIOUS_BRANCH_STOCK=${p.branch_stock}`
      );

      console.log(
        `R5_PREVIOUS_GLOBAL_STOCK=${p.global_stock}`
      );

      console.log(
        `R5_PREVIOUS_PRICE=${p.precio}`
      );

      console.log(
        `R5_PREVIOUS_PRICE_OFFER=${p.precio_oferta}`
      );

      console.log(
        `R5_PREVIOUS_EFFECTIVE_PRICE=${p.effective_price}`
      );

      const reason = [];

      if (
      Number(p.branch_stock) < 2)
      {
        reason.push(
          "BRANCH_STOCK_LT_2"
        );
      }

      if (
      Number(p.global_stock) < 2)
      {
        reason.push(
          "GLOBAL_STOCK_LT_2"
        );
      }

      if (
      Number(p.precio) <= 0)
      {
        reason.push(
          "PRECIO_NOT_POSITIVE"
        );
      }

      console.log(
        `R5_REJECTION_REASON=${
        reason.join(",") || "NONE"}`

      );

    } else {

      console.log(
        "R5_PREVIOUS_CANDIDATE_NOT_FOUND"
      );
    }

    await db.query("ROLLBACK");

    /*
     * =======================================================
     * FINAL
     * =======================================================
     */

    section("7. FINAL SUMMARY");

    console.log(
      "LOYALTY007_R5B_INVENTORY_PRECHECK=PASS"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "TEST_RESIDUE_IDENTIDAD=0"
    );

    console.log(
      `SAFE_TCG_CANDIDATES=${candidates.rowCount}`
    );

    console.log(
      `SELECTED_ID_SUCURSAL=${selected.id_sucursal}`
    );

    console.log(
      `SELECTED_ID_INVENTARIO=${selected.id_inventario}`
    );

    console.log(
      `SELECTED_BRANCH_STOCK=${branchStock}`
    );

    console.log(
      `SELECTED_GLOBAL_STOCK=${globalStock}`
    );

    console.log(
      `SELECTED_EFFECTIVE_PRICE=${effectivePrice}`
    );

    console.log(
      "STOCK_REQUIREMENT=1"
    );

    console.log(
      "MODE_AFTER_CLEANUP=READ_ONLY"
    );

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "SALES_MUTATION=0"
    );

    console.log(
      "NEXT_STEP=LOYALTY007_R6_DYNAMIC_SAFE_CANDIDATE"
    );

  } finally {
    await db.end();
  }
}

main().catch((e) => {

  section(
    "LOYALTY007 R5B PRECHECK FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
