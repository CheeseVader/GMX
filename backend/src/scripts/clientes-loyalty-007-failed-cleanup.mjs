import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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
  ".env.dev",
]) {
  loadEnv(path.join(ROOT, f));
}

function dbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.PGHOST || process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    database:
      process.env.PGDATABASE ||
      process.env.DB_NAME ||
      process.env.DB_DATABASE,
    user:
      process.env.PGUSER ||
      process.env.DB_USER,
    password:
      process.env.PGPASSWORD ||
      process.env.DB_PASSWORD,
  };
}

const TARGET = "CLI-000014";

const db = new Client(dbConfig());

try {
  await db.connect();

  console.log("TARGET_TEST_CLIENT=" + TARGET);

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
    FOR UPDATE
    `,
    [TARGET]
  );

  console.log(`TARGET_ROWS=${target.rowCount}`);
  console.table(target.rows);

  if (target.rowCount === 0) {
    console.log("TARGET_ALREADY_ABSENT=YES");
  } else {
    if (target.rowCount !== 1) {
      throw new Error("SAFETY_ABORT_MULTIPLE_CLIENTS");
    }

    const row = target.rows[0];

    const safe =
      String(row.nombre || "").startsWith(
        "CLIENTES LOYALTY007 TEST "
      ) &&
      String(row.email || "").startsWith(
        "clientes.loyalty007."
      ) &&
      String(row.email || "").endsWith(
        "@example.invalid"
      );

    console.log(
      `EXACT_TEST_SIGNATURE=${safe ? "YES" : "NO"}`
    );

    if (!safe) {
      throw new Error(
        "SAFETY_ABORT_NOT_LOYALTY007_TEST"
      );
    }

    await db.query("BEGIN");

    try {
      const loyaltyMoves = await db.query(
        `
        SELECT COUNT(*)::bigint AS total
        FROM gmx.fidelidad_movimientos
        WHERE id_cliente=$1
        `,
        [TARGET]
      );

      const loyaltyAccount = await db.query(
        `
        SELECT COUNT(*)::bigint AS total
        FROM gmx.fidelidad_cuentas
        WHERE id_cliente=$1
        `,
        [TARGET]
      );

      const orders = await db.query(
        `
        SELECT COUNT(*)::bigint AS total
        FROM gmx.pedidos
        WHERE id_cliente=$1
        `,
        [TARGET]
      );

      console.log(
        `LOYALTY_MOVES_BEFORE=${loyaltyMoves.rows[0].total}`
      );

      console.log(
        `LOYALTY_ACCOUNT_BEFORE=${loyaltyAccount.rows[0].total}`
      );

      console.log(
        `ORDERS_BEFORE=${orders.rows[0].total}`
      );

      /*
       * createSale falló antes del INSERT del pedido,
       * así que esperamos cero en estos tres.
       */
      if (
        Number(loyaltyMoves.rows[0].total) !== 0 ||
        Number(loyaltyAccount.rows[0].total) !== 0 ||
        Number(orders.rows[0].total) !== 0
      ) {
        throw new Error(
          "SAFETY_ABORT_UNEXPECTED_DEPENDENCIES"
        );
      }

      const deleted = await db.query(
        `
        DELETE FROM gmx.clientes
        WHERE id_cliente=$1
          AND nombre LIKE 'CLIENTES LOYALTY007 TEST %'
          AND email LIKE 'clientes.loyalty007.%@example.invalid'
        RETURNING row_id,id_cliente
        `,
        [TARGET]
      );

      if (deleted.rowCount !== 1) {
        throw new Error(
          "TEST_CLIENT_DELETE_FAILED"
        );
      }

      const identities = await db.query(
        `
        SELECT COUNT(*)::bigint AS total
        FROM gmx.cliente_identidad_unica
        WHERE id_cliente=$1
        `,
        [TARGET]
      );

      if (Number(identities.rows[0].total) !== 0) {
        throw new Error(
          "IDENTITY_CLEANUP_FAILED"
        );
      }

      await db.query("COMMIT");

      console.log("CLEANUP_COMMIT=PASS");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }

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
    Number(final.rows[0].identidades) !== 0
  ) {
    throw new Error(
      "FINAL_TEST_RESIDUE_NOT_ZERO"
    );
  }

  console.log("");
  console.log(
    "LOYALTY007_FAILED_RUN_CLEANUP=PASS"
  );
  console.log("TEST_RESIDUE_CLIENTES=0");
  console.log("TEST_RESIDUE_IDENTIDAD=0");

} finally {
  await db.end();
}
