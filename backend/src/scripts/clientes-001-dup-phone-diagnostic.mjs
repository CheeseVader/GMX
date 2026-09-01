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

async function main() {
  section(brandText("GMX — CLIENTES-001 DUPLICATE PHONE DIAGNOSTIC"));

  console.log("MODE=CONTROLLED_TRANSACTION");
  console.log("PERSISTENT_MUTATION_ALLOWED=NO");

  const stamp = Date.now().toString();

  const phone = `555${stamp.slice(-7)}`;

  const email1 =
  `clientes001.phone.a.${stamp}@example.invalid`;

  const email2 =
  `clientes001.phone.b.${stamp}@example.invalid`;

  console.log(`TEST_PHONE=${phone}`);
  console.log(`TEST_EMAIL_1=${email1}`);
  console.log(`TEST_EMAIL_2=${email2}`);

  const db = new Client(dbConfig());

  await db.connect();

  let tx = false;

  try {
    section("1. DATABASE / TRIGGER CONTRACT");

    const identity = await db.query(`
      SELECT
        current_database() AS database,
        current_user AS db_user
    `);

    console.table(identity.rows);

    const triggers = await db.query(`
      SELECT
        t.tgname AS trigger_name,
        pg_get_triggerdef(t.oid,true) AS definition,
        p.proname AS function_name,
        p.oid AS function_oid
      FROM pg_trigger t
      JOIN pg_class c
        ON c.oid=t.tgrelid
      JOIN pg_proc p
        ON p.oid=t.tgfoid
      JOIN pg_namespace n
        ON n.oid=c.relnamespace
      WHERE
        n.nspname='gmx'
        AND c.relname='clientes'
        AND NOT t.tgisinternal
      ORDER BY t.tgname
    `);

    console.table(triggers.rows);

    section("2. TRIGGER FUNCTION DEFINITIONS");

    for (const row of triggers.rows) {
      const fn = await db.query(
        `
        SELECT
          n.nspname AS schema_name,
          p.proname AS function_name,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n
          ON n.oid=p.pronamespace
        WHERE p.oid=$1
        `,
        [row.function_oid]
      );

      console.log(
        `\nFUNCTION=${fn.rows[0]?.schema_name}.${fn.rows[0]?.function_name}`
      );

      console.log(
        fn.rows[0]?.definition || "(not found)"
      );
    }

    section("3. RELEVANT UNIQUE INDEXES");

    const indexes = await db.query(`
      SELECT
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname='gmx'
        AND tablename IN (
          'clientes',
          'cliente_identidad_unica'
        )
        AND (
          indexdef ILIKE '%telefono%'
          OR indexdef ILIKE '%valor_normalizado%'
          OR indexname ILIKE '%telefono%'
          OR indexname ILIKE '%identidad%'
        )
      ORDER BY tablename,indexname
    `);

    console.table(indexes.rows);

    section("4. BASELINE");

    const baseline = await db.query(
      `
      SELECT COUNT(*)::bigint AS total
      FROM gmx.clientes
      WHERE telefono=$1
         OR email IN ($2,$3)
      `,
      [phone, email1, email2]
    );

    console.log(
      `BASELINE_TEST_ROWS=${baseline.rows[0].total}`
    );

    if (Number(baseline.rows[0].total) !== 0) {
      throw new Error("SAFETY_ABORT_BASELINE_NOT_ZERO");
    }

    section("5. BEGIN CONTROLLED TRANSACTION");

    await db.query("BEGIN");
    tx = true;

    console.log("BEGIN=PASS");

    section("6. INSERT CLIENT A");

    const a = await db.query(
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
        'CLIENTES-001 DUP PHONE TEST',
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
        email,
        telefono_normalizado,
        email_normalizado
      `,
      [
      `CLIENTES001 DUPPHONE A ${stamp}`,
      phone,
      email1]

    );

    console.table(a.rows);

    if (a.rowCount !== 1) {
      throw new Error("FIRST_INSERT_FAILED");
    }

    const idA = a.rows[0].id_cliente;

    const identitiesA = await db.query(
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
      [idA]
    );

    console.log(
      `CLIENT_A_IDENTITY_ROWS=${identitiesA.rowCount}`
    );

    console.table(identitiesA.rows);

    section("7. INSERT CLIENT B WITH DUPLICATE PHONE");

    let duplicateRejected = false;
    let errorInfo = null;

    /*
     * Savepoint permite capturar el error sin abortar
     * toda la transacción principal.
     */
    await db.query("SAVEPOINT before_duplicate_phone");

    try {
      const b = await db.query(
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
          'CLIENTES-001 DUP PHONE TEST',
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
          email,
          telefono_normalizado,
          email_normalizado
        `,
        [
        `CLIENTES001 DUPPHONE B ${stamp}`,
        phone,
        email2]

      );

      console.log(
        "DUPLICATE_PHONE_INSERT_UNEXPECTEDLY_SUCCEEDED"
      );

      console.table(b.rows);

    } catch (e) {
      duplicateRejected = true;

      errorInfo = {
        name: e.name || null,
        message: e.message || null,
        code: e.code || null,
        detail: e.detail || null,
        hint: e.hint || null,
        constraint: e.constraint || null,
        schema: e.schema || null,
        table: e.table || null,
        routine: e.routine || null
      };

      console.log(
        "DUPLICATE_PHONE_REJECTED=YES"
      );

      console.table([errorInfo]);

      await db.query(
        "ROLLBACK TO SAVEPOINT before_duplicate_phone"
      );

      console.log(
        "ROLLBACK_TO_SAVEPOINT=PASS"
      );
    }

    section("8. IN-TRANSACTION VERIFICATION");

    const rowsAfter = await db.query(
      `
      SELECT
        row_id,
        id_cliente,
        nombre,
        telefono,
        email,
        telefono_normalizado
      FROM gmx.clientes
      WHERE telefono=$1
         OR email IN ($2,$3)
      ORDER BY row_id
      `,
      [phone, email1, email2]
    );

    console.log(
      `ROWS_AFTER_DUP_ATTEMPT=${rowsAfter.rowCount}`
    );

    console.table(rowsAfter.rows);

    const identityAfter = await db.query(
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
      [idA]
    );

    console.log(
      `IDENTITY_AFTER_DUP_ATTEMPT=${identityAfter.rowCount}`
    );

    console.table(identityAfter.rows);

    if (!duplicateRejected) {
      throw new Error(
        "DUPLICATE_PHONE_DB_GUARD_MISSING"
      );
    }

    if (rowsAfter.rowCount !== 1) {
      throw new Error(
        "DUPLICATE_PHONE_LEFT_EXTRA_ROW"
      );
    }

    section("9. MANDATORY ROLLBACK");

    await db.query("ROLLBACK");
    tx = false;

    console.log("ROLLBACK=PASS");

    section("10. POST-ROLLBACK VERIFICATION");

    const residue = await db.query(
      `
      SELECT
        row_id,
        id_cliente,
        nombre,
        telefono,
        email
      FROM gmx.clientes
      WHERE telefono=$1
         OR email IN ($2,$3)
         OR nombre LIKE $4
      ORDER BY row_id
      `,
      [
      phone,
      email1,
      email2,
      `CLIENTES001 DUPPHONE%${stamp}%`]

    );

    console.log(
      `TEST_RESIDUE_CLIENTES=${residue.rowCount}`
    );

    console.table(residue.rows);

    const identityResidue = await db.query(
      `
      SELECT
        row_id,
        tipo,
        valor_normalizado,
        id_cliente
      FROM gmx.cliente_identidad_unica
      WHERE valor_normalizado IN (
        gmx.normalize_phone_digits($1),
        lower($2),
        lower($3)
      )
      ORDER BY row_id
      `,
      [phone, email1, email2]
    );

    console.log(
      `TEST_RESIDUE_IDENTIDAD=${identityResidue.rowCount}`
    );

    console.table(identityResidue.rows);

    if (
    residue.rowCount !== 0 ||
    identityResidue.rowCount !== 0)
    {
      throw new Error(
        "ROLLBACK_RESIDUE_NOT_ZERO"
      );
    }

    section("11. FINAL SUMMARY");

    console.log(
      "CLIENTES_001_DUP_PHONE_DB_DIAGNOSTIC=PASS"
    );

    console.log(
      "DUPLICATE_PHONE_REJECTED=YES"
    );

    console.log(
      `DB_ERROR_CODE=${errorInfo?.code || "(none)"}`
    );

    console.log(
      `DB_ERROR_CONSTRAINT=${errorInfo?.constraint || "(none)"}`
    );

    console.log(
      `DB_ERROR_MESSAGE=${errorInfo?.message || "(none)"}`
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
      "NEXT_STEP=DIAGNOSE_HTTP_DUP_PHONE"
    );

  } catch (e) {
    if (tx) {
      try {
        await db.query("ROLLBACK");
        console.log(
          "ROLLBACK_AFTER_ERROR=PASS"
        );
      } catch {}
    }

    throw e;

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "CLIENTES-001 DUPLICATE PHONE DIAGNOSTIC FAILED"
  );

  console.error(e?.stack || e);

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
