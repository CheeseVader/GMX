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
  section(brandText("GMX — LOYALTY-007 R4 CLEANUP + PRICE PRECHECK")

  );

  console.log(
    `TIMESTAMP=${new Date().toISOString()}`
  );

  const db = new Client(dbConfig());

  await db.connect();

  try {
    /*
     * =======================================================
     * 1. CLEANUP EXACTO CLI-000017
     * =======================================================
     */

    section(
      "1. CLEANUP R4 FAILED TEST CLIENT"
    );

    const target = await db.query(
      `
      SELECT
        row_id,
        id_cliente,
        nombre,
        telefono,
        email
      FROM gmx.clientes
      WHERE id_cliente='CLI-000017'
      `
    );

    console.log(
      `TARGET_ROWS=${target.rowCount}`
    );

    console.table(target.rows);

    if (target.rowCount > 1) {
      throw new Error(
        "SAFETY_ABORT_MULTIPLE_TARGETS"
      );
    }

    if (target.rowCount === 1) {
      const row = target.rows[0];

      const exact =
      String(row.nombre || "").
      startsWith(
        "CLIENTES LOYALTY007 TEST "
      ) &&
      String(row.email || "").
      startsWith(
        "clientes.loyalty007."
      ) &&
      String(row.email || "").
      endsWith(
        "@example.invalid"
      );

      console.log(
        `EXACT_TEST_SIGNATURE=${
        exact ? "YES" : "NO"}`

      );

      if (!exact) {
        throw new Error(
          "SAFETY_ABORT_NOT_TEST_CLIENT"
        );
      }

      const deps = await db.query(
        `
        SELECT
          (
            SELECT COUNT(*)
            FROM gmx.pedidos
            WHERE id_cliente='CLI-000017'
          )::bigint AS pedidos,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_cuentas
            WHERE id_cliente='CLI-000017'
          )::bigint AS cuentas,

          (
            SELECT COUNT(*)
            FROM gmx.fidelidad_movimientos
            WHERE id_cliente='CLI-000017'
          )::bigint AS movimientos
        `
      );

      console.table(deps.rows);

      if (
      Number(deps.rows[0].pedidos) !== 0 ||
      Number(deps.rows[0].cuentas) !== 0 ||
      Number(deps.rows[0].movimientos) !== 0)
      {
        throw new Error(
          "SAFETY_ABORT_UNEXPECTED_DEPENDENCIES"
        );
      }

      await db.query("BEGIN");

      try {
        const deleted =
        await db.query(
          `
            DELETE FROM gmx.clientes
            WHERE
              id_cliente='CLI-000017'
              AND nombre LIKE
                'CLIENTES LOYALTY007 TEST %'
              AND email LIKE
                'clientes.loyalty007.%@example.invalid'
            RETURNING
              row_id,
              id_cliente
            `
        );

        if (deleted.rowCount !== 1) {
          throw new Error(
            "R4_CLIENT_DELETE_FAILED"
          );
        }

        await db.query("COMMIT");

        console.log(
          "R4_TEST_CLIENT_CLEANUP=PASS"
        );

      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }

    } else {
      console.log(
        "R4_TEST_CLIENT_ALREADY_ABSENT=YES"
      );
    }

    /*
     * =======================================================
     * 2. VERIFICAR RESIDUO
     * =======================================================
     */

    section(
      "2. CLEANUP VERIFICATION"
    );

    const residue = await db.query(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE id_cliente='CLI-000017'
        )::bigint AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.cliente_identidad_unica
          WHERE id_cliente='CLI-000017'
        )::bigint AS identidades
      `
    );

    console.table(residue.rows);

    if (
    Number(residue.rows[0].clientes) !== 0 ||
    Number(residue.rows[0].identidades) !== 0)
    {
      throw new Error(
        "R4_TEST_RESIDUE_NOT_ZERO"
      );
    }

    /*
     * =======================================================
     * 3. AHORA SOLO READ ONLY
     * =======================================================
     */

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    section(
      "3. TCG GLOBAL REAL COLUMN CONTRACT"
    );

    const globalCols =
    await db.query(
      `
        SELECT
          ordinal_position,
          column_name,
          data_type
        FROM information_schema.columns
        WHERE
          table_schema='gmx'
          AND table_name='tcg_inventario'
        ORDER BY ordinal_position
        `
    );

    console.table(globalCols.rows);

    section(
      "4. TCG BRANCH REAL COLUMN CONTRACT"
    );

    const branchCols =
    await db.query(
      `
        SELECT
          ordinal_position,
          column_name,
          data_type
        FROM information_schema.columns
        WHERE
          table_schema='gmx'
          AND table_name='tcg_inventario_sucursales'
        ORDER BY ordinal_position
        `
    );

    console.table(branchCols.rows);

    /*
     * Descubrimos dinámicamente columnas que parezcan precio.
     */
    const priceCols =
    globalCols.rows.
    map((x) => x.column_name).
    filter((name) =>
    /precio|price|venta|monto|valor/i.test(
      name
    )
    );

    console.log(
      `TCG_PRICE_COLUMN_CANDIDATES=${
      priceCols.join(",") || "(none)"}`

    );

    /*
     * =======================================================
     * 5. EXACTO INVENTARIO USADO EN R4
     * =======================================================
     */

    section(
      "5. R4 EXACT TCG CANDIDATE"
    );

    const exact = await db.query(
      `
      SELECT
        s.*,
        to_jsonb(i) AS global_inventory
      FROM gmx.tcg_inventario_sucursales s
      JOIN gmx.tcg_inventario i
        ON i.id_inventario=s.id_inventario
      WHERE
        s.id_sucursal='SUC-000010'
        AND
        s.id_inventario=
          'TCGI-1786768609065-5a24c'
      `
    );

    console.log(
      `R4_CANDIDATE_ROWS=${exact.rowCount}`
    );

    console.dir(
      exact.rows,
      {
        depth: null,
        colors: false
      }
    );

    /*
     * =======================================================
     * 6. INVENTARIO TCG CON STOCK POSITIVO
     * =======================================================
     */

    section(
      "6. STOCKED TCG RAW SAMPLE"
    );

    const sample = await db.query(
      `
      SELECT
        s.id_sucursal,
        s.id_inventario,
        s.stock AS branch_stock,

        i.stock AS global_stock,

        to_jsonb(i) AS global_inventory

      FROM gmx.tcg_inventario_sucursales s

      JOIN gmx.tcg_inventario i
        ON i.id_inventario=s.id_inventario

      WHERE
        COALESCE(s.stock,0) >= 1
        AND COALESCE(i.stock,0) >= 1

      ORDER BY
        s.stock DESC,
        s.row_id

      LIMIT 10
      `
    );

    console.dir(
      sample.rows,
      {
        depth: null,
        colors: false
      }
    );

    /*
     * =======================================================
     * 7. DETECT PRICE VALUES DYNAMICALLY
     * =======================================================
     */

    section(
      "7. DYNAMIC PRICE ANALYSIS"
    );

    const analyzed =
    sample.rows.map((row) => {
      const global =
      row.global_inventory || {};

      const prices = {};

      for (
      const key of
      Object.keys(global))
      {
        if (
        /precio|price|venta|monto|valor/i.
        test(key))
        {
          prices[key] =
          global[key];
        }
      }

      return {
        id_sucursal:
        row.id_sucursal,

        id_inventario:
        row.id_inventario,

        branch_stock:
        row.branch_stock,

        global_stock:
        row.global_stock,

        detected_prices:
        JSON.stringify(prices)
      };
    });

    console.table(analyzed);

    /*
     * Candidate con al menos un precio numérico > 0.
     */
    const safeCandidate =
    sample.rows.find((row) => {
      const global =
      row.global_inventory || {};

      return Object.entries(global).
      some(([key, value]) => {
        if (
        !/precio|price|venta|monto|valor/i.
        test(key))
        {
          return false;
        }

        const n =
        Number(value);

        return (
          Number.isFinite(n) &&
          n > 0);

      });
    });

    if (safeCandidate) {
      console.log(
        "SAFE_POSITIVE_PRICE_TCG=YES"
      );

      console.log(
        `SAFE_ID_SUCURSAL=${
        safeCandidate.id_sucursal}`

      );

      console.log(
        `SAFE_ID_INVENTARIO=${
        safeCandidate.id_inventario}`

      );

      console.log(
        `SAFE_BRANCH_STOCK=${
        safeCandidate.branch_stock}`

      );

      console.log(
        `SAFE_GLOBAL_STOCK=${
        safeCandidate.global_stock}`

      );

      const priceEntries =
      Object.entries(
        safeCandidate.
        global_inventory || {}
      ).
      filter(
        ([key, value]) => {
          const n =
          Number(value);

          return (
            /precio|price|venta|monto|valor/i.
            test(key) &&
            Number.isFinite(n) &&
            n > 0);

        }
      );

      console.log(
        "SAFE_PRICE_FIELDS=" +
        JSON.stringify(
          Object.fromEntries(
            priceEntries
          )
        )
      );

    } else {
      console.log(
        "SAFE_POSITIVE_PRICE_TCG=NO"
      );
    }

    await db.query("ROLLBACK");

    section(
      "8. FINAL SUMMARY"
    );

    console.log(
      "LOYALTY007_R4_PRICE_PRECHECK=PASS"
    );

    console.log(
      "R4_TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "R4_TEST_RESIDUE_IDENTIDAD=0"
    );

    console.log(
      `TCG_PRICE_COLUMN_CANDIDATES=${
      priceCols.join(",") || "(none)"}`

    );

    console.log(
      `SAFE_POSITIVE_PRICE_TCG=${
      safeCandidate ? "YES" : "NO"}`

    );

    if (safeCandidate) {
      console.log(
        `SAFE_ID_SUCURSAL=${
        safeCandidate.id_sucursal}`

      );

      console.log(
        `SAFE_ID_INVENTARIO=${
        safeCandidate.id_inventario}`

      );
    }

    console.log(
      "PRICE_ANALYSIS_MODE=READ_ONLY"
    );

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "SALES_MUTATION=0"
    );

    console.log(
      "NEXT_STEP=LOYALTY007_R5_USE_POSITIVE_PRICE_ITEM"
    );

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "LOYALTY007 R4 PRICE PRECHECK FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
