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

const TARGET = "CLI-000015";

async function main() {
  section(brandText("GMX — LOYALTY-007 R2 FAILED RUN CLEANUP")

  );

  const db = new Client(dbConfig());

  await db.connect();

  let tx = false;

  try {
    const target = await db.query(
      `
      SELECT
        row_id,
        id_cliente,
        nombre,
        telefono,
        email
      FROM gmx.clientes
      WHERE id_cliente=$1
      `,
      [TARGET]
    );

    console.log(
      `TARGET_ROWS=${target.rowCount}`
    );

    console.table(target.rows);

    if (target.rowCount === 0) {
      console.log(
        "TARGET_ALREADY_ABSENT=YES"
      );

    } else {
      if (target.rowCount !== 1) {
        throw new Error(
          "SAFETY_ABORT_TARGET_COUNT"
        );
      }

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

      section(
        "DEPENDENCY PRECHECK"
      );

      const dependencies =
      await db.query(
        `
          SELECT

            (
              SELECT COUNT(*)
              FROM gmx.pedidos
              WHERE id_cliente=$1
            )::bigint
              AS pedidos,

            (
              SELECT COUNT(*)
              FROM gmx.fidelidad_cuentas
              WHERE id_cliente=$1
            )::bigint
              AS cuentas,

            (
              SELECT COUNT(*)
              FROM gmx.fidelidad_movimientos
              WHERE id_cliente=$1
            )::bigint
              AS movimientos
          `,
        [TARGET]
      );

      console.table(
        dependencies.rows
      );

      const d =
      dependencies.rows[0];

      if (
      Number(d.pedidos) !== 0 ||
      Number(d.cuentas) !== 0 ||
      Number(d.movimientos) !== 0)
      {
        throw new Error(
          "SAFETY_ABORT_UNEXPECTED_DEPENDENCIES"
        );
      }

      await db.query("BEGIN");
      tx = true;

      const deleted =
      await db.query(
        `
          DELETE FROM gmx.clientes
          WHERE
            id_cliente=$1
            AND nombre LIKE
              'CLIENTES LOYALTY007 TEST %'
            AND email LIKE
              'clientes.loyalty007.%@example.invalid'
          RETURNING
            row_id,
            id_cliente
          `,
        [TARGET]
      );

      console.log(
        `CLIENT_DELETED=${deleted.rowCount}`
      );

      if (deleted.rowCount !== 1) {
        throw new Error(
          "CLIENT_DELETE_FAILED"
        );
      }

      const identities =
      await db.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.cliente_identidad_unica
          WHERE id_cliente=$1
          `,
        [TARGET]
      );

      console.log(
        `IDENTITY_RESIDUE_BEFORE_COMMIT=${
        identities.rows[0].total}`

      );

      if (
      Number(
        identities.rows[0].total
      ) !== 0)
      {
        throw new Error(
          "IDENTITY_CLEANUP_FAILED"
        );
      }

      await db.query("COMMIT");
      tx = false;

      console.log(
        "CLEANUP_COMMIT=PASS"
      );
    }

    section("FINAL CLEANUP VERIFICATION");

    const final = await db.query(
      `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE id_cliente=$1
        )::bigint AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.cliente_identidad_unica
          WHERE id_cliente=$1
        )::bigint AS identidades
      `,
      [TARGET]
    );

    console.table(final.rows);

    if (
    Number(final.rows[0].clientes) !== 0 ||
    Number(final.rows[0].identidades) !== 0)
    {
      throw new Error(
        "FINAL_CLEANUP_RESIDUE_NOT_ZERO"
      );
    }

    section("CLEANUP SUMMARY");

    console.log(
      "LOYALTY007_R2_CLEANUP=PASS"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "TEST_RESIDUE_IDENTIDAD=0"
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
    "LOYALTY007 R2 CLEANUP FAILED"
  );

  console.error(
    e?.stack || e
  );

  process.exitCode = 1;
});
