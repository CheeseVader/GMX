import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

/*
 * Registro exacto generado por el smoke fallido.
 */
const ROW_ID = 3;
const ID_CLIENTE = "CLI-000003";
const EMAIL = "clientes001.1787233193475@example.invalid";
const PHONE = "5553193475";

async function main() {
  section(brandText("GMX — CLIENTES-001 EMERGENCY CLEANUP"));

  console.log(`TARGET_ROW_ID=${ROW_ID}`);
  console.log(`TARGET_ID_CLIENTE=${ID_CLIENTE}`);
  console.log(`TARGET_EMAIL=${EMAIL}`);
  console.log(`TARGET_PHONE=${PHONE}`);

  const client = new Client(dbConfig());

  await client.connect();

  let tx = false;

  try {
    section("1. PRECHECK");

    const db = await client.query(`
      SELECT
        current_database() AS database,
        current_user AS db_user
    `);

    console.table(db.rows);

    const target = await client.query(
      `
      SELECT
        row_id,
        id_cliente,
        nombre,
        telefono,
        email
      FROM gmx.clientes
      WHERE row_id=$1
      `,
      [ROW_ID]
    );

    console.log(`TARGET_ROWS=${target.rowCount}`);
    console.table(target.rows);

    /*
     * Si ya no existe, solo verificamos residuos.
     */
    if (target.rowCount === 0) {
      console.log("TARGET_ALREADY_ABSENT=YES");
    } else {
      if (target.rowCount !== 1) {
        throw new Error(
          "SAFETY_ABORT_UNEXPECTED_TARGET_COUNT"
        );
      }

      const row = target.rows[0];

      const exactMatch =
      String(row.id_cliente) === ID_CLIENTE &&
      String(row.email) === EMAIL &&
      String(row.telefono) === PHONE &&
      String(row.nombre || "").startsWith(
        "CLIENTES001 TEST "
      );

      console.log(
        `EXACT_TEST_IDENTITY_MATCH=${
        exactMatch ? "YES" : "NO"}`

      );

      if (!exactMatch) {
        throw new Error(
          "SAFETY_ABORT_TARGET_DOES_NOT_MATCH_TEST"
        );
      }

      section("2. PRE-CLEANUP IDENTITY");

      const beforeIdentity =
      await client.query(
        `
          SELECT
            row_id,
            tipo,
            valor_normalizado,
            id_cliente
          FROM gmx.cliente_identidad_unica
          WHERE id_cliente=$1
          ORDER BY row_id
          `,
        [ID_CLIENTE]
      );

      console.log(
        `IDENTITY_BEFORE=${beforeIdentity.rowCount}`
      );

      console.table(beforeIdentity.rows);

      section("3. CONTROLLED CLEANUP");

      await client.query("BEGIN");
      tx = true;

      /*
       * Lock exact test row.
       */
      const locked =
      await client.query(
        `
          SELECT
            row_id,
            id_cliente,
            nombre,
            telefono,
            email
          FROM gmx.clientes
          WHERE row_id=$1
          FOR UPDATE
          `,
        [ROW_ID]
      );

      if (locked.rowCount !== 1) {
        throw new Error(
          "TARGET_DISAPPEARED_BEFORE_DELETE"
        );
      }

      const l = locked.rows[0];

      if (
      String(l.id_cliente) !== ID_CLIENTE ||
      String(l.email) !== EMAIL ||
      String(l.telefono) !== PHONE ||
      !String(l.nombre || "").startsWith(
        "CLIENTES001 TEST "
      ))
      {
        throw new Error(
          "SAFETY_ABORT_LOCKED_ROW_CHANGED"
        );
      }

      const deleted =
      await client.query(
        `
          DELETE FROM gmx.clientes
          WHERE row_id=$1
            AND id_cliente=$2
            AND email=$3
            AND telefono=$4
            AND nombre LIKE 'CLIENTES001 TEST %'
          RETURNING
            row_id,
            id_cliente,
            nombre,
            telefono,
            email
          `,
        [
        ROW_ID,
        ID_CLIENTE,
        EMAIL,
        PHONE]

      );

      console.log(
        `DELETED_ROWS=${deleted.rowCount}`
      );

      console.table(deleted.rows);

      if (deleted.rowCount !== 1) {
        throw new Error(
          "CONTROLLED_DELETE_FAILED"
        );
      }

      /*
       * Trigger release_cliente_identity()
       * debe retirar EMAIL/PHONE.
       */
      const remainingClient =
      await client.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.clientes
          WHERE row_id=$1
             OR id_cliente=$2
             OR email=$3
          `,
        [ROW_ID, ID_CLIENTE, EMAIL]
      );

      const remainingIdentity =
      await client.query(
        `
          SELECT COUNT(*)::bigint AS total
          FROM gmx.cliente_identidad_unica
          WHERE id_cliente=$1
          `,
        [ID_CLIENTE]
      );

      const clientCount =
      Number(
        remainingClient.rows[0].total
      );

      const identityCount =
      Number(
        remainingIdentity.rows[0].total
      );

      console.log(
        `CLIENT_RESIDUE_BEFORE_COMMIT=${clientCount}`
      );

      console.log(
        `IDENTITY_RESIDUE_BEFORE_COMMIT=${identityCount}`
      );

      if (
      clientCount !== 0 ||
      identityCount !== 0)
      {
        throw new Error(
          "CLEANUP_VERIFICATION_FAILED_ROLLBACK"
        );
      }

      await client.query("COMMIT");
      tx = false;

      console.log("COMMIT=PASS");
    }

    section("4. FINAL VERIFICATION");

    const finalClients =
    await client.query(
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
          OR id_cliente=$2
          OR email=$3
          OR nombre LIKE 'CLIENTES001 TEST %'
          OR email LIKE 'clientes001.%@example.invalid'
        ORDER BY row_id
        `,
      [ROW_ID, ID_CLIENTE, EMAIL]
    );

    const finalIdentity =
    await client.query(
      `
        SELECT
          row_id,
          tipo,
          valor_normalizado,
          id_cliente
        FROM gmx.cliente_identidad_unica
        WHERE id_cliente=$1
        ORDER BY row_id
        `,
      [ID_CLIENTE]
    );

    console.log(
      `TEST_RESIDUE_CLIENTES=${finalClients.rowCount}`
    );

    console.table(finalClients.rows);

    console.log(
      `TEST_RESIDUE_IDENTIDAD=${finalIdentity.rowCount}`
    );

    console.table(finalIdentity.rows);

    if (
    finalClients.rowCount !== 0 ||
    finalIdentity.rowCount !== 0)
    {
      throw new Error(
        "FINAL_TEST_RESIDUE_NOT_ZERO"
      );
    }

    section("5. SUMMARY");

    console.log(
      "CLIENTES_001_EMERGENCY_CLEANUP=PASS"
    );

    console.log(
      "TEST_RESIDUE_CLIENTES=0"
    );

    console.log(
      "TEST_RESIDUE_IDENTIDAD=0"
    );

    console.log(
      "FINANCIAL_MUTATION=0"
    );

    console.log(
      "LOYALTY_MUTATION=0"
    );

    console.log(
      "NEXT_STEP=DIAGNOSE_DUPLICATE_PHONE_CRASH"
    );

  } catch (e) {
    if (tx) {
      try {
        await client.query("ROLLBACK");
        console.log(
          "ROLLBACK_AFTER_ERROR=PASS"
        );
      } catch {}
    }

    throw e;

  } finally {
    await client.end();
  }
}

main().catch((e) => {
  section(
    "CLIENTES-001 EMERGENCY CLEANUP FAILED"
  );

  console.error(e?.stack || e);

  console.log(
    "DO_NOT_RERUN_CRUD_SMOKE"
  );

  process.exitCode = 1;
});
