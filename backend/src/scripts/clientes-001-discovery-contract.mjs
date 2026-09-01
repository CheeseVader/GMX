import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-001
 * DISCOVERY + DB CONTRACT
 *
 * MODE: READ ONLY
 *
 * OBJETIVOS:
 *  - Levantar contrato DB real del bloque Clientes / Fidelidad
 *  - No asumir columnas
 *  - No modificar datos
 *  - Revisar:
 *      * tablas
 *      * columnas
 *      * constraints
 *      * indexes
 *      * triggers
 *      * trigger functions
 *      * relaciones físicas
 *      * relaciones lógicas
 *      * duplicados
 *      * orfandades
 *      * saldos de fidelidad
 *      * movimientos
 *      * pedidos relacionados
 *      * idempotencia estructural
 *      * código fuente relacionado
 *
 * GARANTÍAS:
 *  - BEGIN TRANSACTION READ ONLY
 *  - statement_timeout
 *  - lock_timeout
 *  - SQL guard SELECT/WITH
 *  - ROLLBACK obligatorio
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const LINE = "=".repeat(110);
const SUB = "-".repeat(110);

const result = {
  discoveredTables: [],
  tableContracts: [],
  constraints: [],
  indexes: [],
  triggers: [],
  functions: [],
  physicalFKs: [],
  logicalRelations: [],
  anomalies: [],
  sourceFiles: [],
  errors: []
};

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

function subsection(title) {
  console.log("\n" + SUB);
  console.log(title);
  console.log(SUB);
}

function printRows(rows, max = 200) {
  if (!rows?.length) {
    console.log("(0 rows)");
    return;
  }

  console.table(rows.slice(0, max));

  if (rows.length > max) {
    console.log(`Mostrando ${max}/${rows.length} filas`);
  }
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, "utf8");
  const out = {};

  for (const raw of content.split(/\r?\n/)) {
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

    out[key] = value;
  }

  return out;
}

function loadEnvironment() {
  const candidates = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.dev"];


  const loaded = [];

  for (const name of candidates) {
    const file = path.join(ROOT, name);

    if (!fs.existsSync(file)) continue;

    const values = loadDotEnv(file);

    for (const [k, v] of Object.entries(values)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
      }
    }

    loaded.push(name);
  }

  return loaded;
}

function connectionConfig() {
  const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PG_CONNECTION_STRING ||
  process.env.DB_URL;

  if (connectionString) {
    return {
      connectionString,
      ssl:
      process.env.DB_SSL === "true" ||
      process.env.PGSSLMODE === "require" ?
      { rejectUnauthorized: false } :
      undefined
    };
  }

  const database =
  process.env.PGDATABASE ||
  process.env.DB_NAME ||
  process.env.DB_DATABASE ||
  process.env.POSTGRES_DB;

  const user =
  process.env.PGUSER ||
  process.env.DB_USER ||
  process.env.POSTGRES_USER;

  if (!database || !user) {
    throw new Error(
      "No se pudo resolver configuración PostgreSQL desde .env"
    );
  }

  return {
    host:
    process.env.PGHOST ||
    process.env.DB_HOST ||
    process.env.POSTGRES_HOST ||
    "localhost",

    port: Number(
      process.env.PGPORT ||
      process.env.DB_PORT ||
      process.env.POSTGRES_PORT ||
      5432
    ),

    database,
    user,

    password:
    process.env.PGPASSWORD ||
    process.env.DB_PASSWORD ||
    process.env.POSTGRES_PASSWORD,

    ssl:
    process.env.DB_SSL === "true" ||
    process.env.PGSSLMODE === "require" ?
    { rejectUnauthorized: false } :
    undefined
  };
}

async function q(client, sql, params = []) {
  const normalized = sql.
  replace(/\/\*[\s\S]*?\*\//g, "").
  replace(/--.*$/gm, "").
  trim().
  toUpperCase();

  if (
  !normalized.startsWith("SELECT") &&
  !normalized.startsWith("WITH"))
  {
    throw new Error(
      "READ_ONLY_GUARD: SQL bloqueado: " +
      normalized.slice(0, 100)
    );
  }

  return client.query(sql, params);
}

async function tableExists(client, schema, table) {
  const r = await q(
    client,
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema=$1
        AND table_name=$2
    ) AS exists
    `,
    [schema, table]
  );

  return Boolean(r.rows[0]?.exists);
}

async function columnExists(client, schema, table, column) {
  const r = await q(
    client,
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema=$1
        AND table_name=$2
        AND column_name=$3
    ) AS exists
    `,
    [schema, table, column]
  );

  return Boolean(r.rows[0]?.exists);
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

function walk(dir) {
  const found = [];

  if (!fs.existsSync(dir)) return found;

  const ignore = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
  "tmp",
  "temp"]
  );

  const ext = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".sql"]
  );

  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();

    let entries;

    try {
      entries = fs.readdirSync(current, {
        withFileTypes: true
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!ignore.has(entry.name)) {
          stack.push(full);
        }
        continue;
      }

      if (
      entry.isFile() &&
      ext.has(path.extname(entry.name).toLowerCase()))
      {
        found.push(full);
      }
    }
  }

  return found;
}

function discoverSource() {
  const regex =
  /\b(clientes?|cliente_|fidelidad|loyalty|puntos|id_cliente|id_cuenta_cliente|points|benefits?)\b/i;

  const rows = [];

  for (const file of walk(path.join(ROOT, "src"))) {
    let txt;

    try {
      txt = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (!regex.test(txt)) continue;

    const relative = path.relative(ROOT, file);

    let category = "SOURCE";

    const lower = relative.toLowerCase();

    if (lower.includes("repositories")) category = "REPOSITORY";else
    if (lower.includes("routes")) category = "ROUTE";else
    if (lower.includes("service")) category = "SERVICE";else
    if (lower.includes("middleware")) category = "MIDDLEWARE";else
    if (lower.includes("script")) category = "SCRIPT";

    rows.push({
      category,
      file: relative
    });
  }

  return rows.sort((a, b) =>
  a.file.localeCompare(b.file)
  );
}

async function main() {
  section(brandText("GMX — CLIENTES-001 DISCOVERY + DB CONTRACT"));

  console.log("MODE=READ_ONLY");
  console.log(`ROOT=${ROOT}`);
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const envFiles = loadEnvironment();

  console.log(
    `ENV_FILES=${envFiles.length ? envFiles.join(",") : "(none)"}`
  );

  section("1. GIT BASELINE");

  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const originMain = git(["rev-parse", "origin/main"]);
  const gitStatus = git(["status", "--short"]);

  console.log(`BRANCH=${branch}`);
  console.log(`HEAD=${head}`);
  console.log(`ORIGIN_MAIN=${originMain}`);
  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${head === originMain ? "YES" : "NO"}`
  );
  console.log(
    `GIT_CLEAN=${gitStatus ? "NO" : "YES"}`
  );

  const client = new Client(connectionConfig());

  let txStarted = false;

  try {
    await client.connect();

    await client.query("BEGIN TRANSACTION READ ONLY");
    txStarted = true;

    await client.query(
      "SET LOCAL statement_timeout='20000ms'"
    );

    await client.query(
      "SET LOCAL lock_timeout='3000ms'"
    );

    section("2. DATABASE SAFETY");

    const safety = await q(
      client,
      `
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_schema() AS current_schema,
        current_setting('transaction_read_only')
          AS transaction_read_only,
        current_setting('transaction_isolation')
          AS transaction_isolation,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port
      `
    );

    printRows(safety.rows);

    if (
    safety.rows[0]?.transaction_read_only !== "on")
    {
      throw new Error(
        "SAFETY_ABORT: transaction_read_only != on"
      );
    }

    section("3. DISCOVER ALL CLIENT / LOYALTY RELATED TABLES");

    const discovered = await q(
      client,
      `
      WITH names AS (
        SELECT DISTINCT
          table_schema,
          table_name
        FROM information_schema.columns
        WHERE table_schema NOT IN (
          'pg_catalog',
          'information_schema'
        )
        AND (
          lower(table_name) ~
            '(cliente|client|customer|fidel|loyal|point|punto|reward)'
          OR
          lower(column_name) ~
            '(id_cliente|cliente|client|customer|fidel|loyal|point|punto|reward)'
        )
      )
      SELECT
        table_schema,
        table_name,
        (
          SELECT COUNT(*)
          FROM information_schema.columns c
          WHERE c.table_schema=n.table_schema
            AND c.table_name=n.table_name
        ) AS column_count
      FROM names n
      ORDER BY table_schema,table_name
      `
    );

    result.discoveredTables = discovered.rows;

    printRows(discovered.rows);

    section("4. FULL TABLE CONTRACTS");

    for (const t of discovered.rows) {
      subsection(
        `${t.table_schema}.${t.table_name}`
      );

      const columns = await q(
        client,
        `
        SELECT
          ordinal_position,
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default,
          is_identity,
          identity_generation,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_schema=$1
          AND table_name=$2
        ORDER BY ordinal_position
        `,
        [t.table_schema, t.table_name]
      );

      result.tableContracts.push({
        table: `${t.table_schema}.${t.table_name}`,
        columns: columns.rows
      });

      printRows(columns.rows);
    }

    section("5. CONSTRAINTS — FULL CONTRACT");

    const constraints = await q(
      client,
      `
      SELECT
        ns.nspname AS schema_name,
        cls.relname AS table_name,
        con.conname AS constraint_name,
        con.contype AS raw_type,
        CASE con.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUSION'
          WHEN 'n' THEN 'NOT NULL'
          ELSE con.contype::text
        END AS constraint_type,
        pg_get_constraintdef(
          con.oid,
          true
        ) AS definition
      FROM pg_constraint con
      JOIN pg_class cls
        ON cls.oid=con.conrelid
      JOIN pg_namespace ns
        ON ns.oid=cls.relnamespace
      WHERE ns.nspname='gmx'
      AND (
        lower(cls.relname) ~
          '(cliente|client|customer|fidel|loyal|point|punto|reward)'
        OR EXISTS (
          SELECT 1
          FROM information_schema.columns ic
          WHERE ic.table_schema=ns.nspname
            AND ic.table_name=cls.relname
            AND lower(ic.column_name) ~
              '(id_cliente|cliente|client|customer|fidel|loyal|point|punto|reward)'
        )
      )
      ORDER BY
        ns.nspname,
        cls.relname,
        constraint_type,
        con.conname
      `
    );

    result.constraints = constraints.rows;
    printRows(constraints.rows, 500);

    section("6. INDEXES — FULL CONTRACT");

    const indexes = await q(
      client,
      `
      SELECT
        schemaname AS schema_name,
        tablename AS table_name,
        indexname AS index_name,
        indexdef AS index_definition
      FROM pg_indexes
      WHERE schemaname='gmx'
      AND (
        lower(tablename) ~
          '(cliente|client|customer|fidel|loyal|point|punto|reward)'
        OR EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema=schemaname
            AND c.table_name=tablename
            AND lower(c.column_name) ~
              '(id_cliente|cliente|client|customer|fidel|loyal|point|punto|reward)'
        )
      )
      ORDER BY tablename,indexname
      `
    );

    result.indexes = indexes.rows;
    printRows(indexes.rows, 500);

    section("7. PHYSICAL FOREIGN KEYS");

    const fks = await q(
      client,
      `
      SELECT
        src_ns.nspname AS source_schema,
        src.relname AS source_table,
        con.conname AS constraint_name,
        tgt_ns.nspname AS target_schema,
        tgt.relname AS target_table,
        pg_get_constraintdef(
          con.oid,
          true
        ) AS definition
      FROM pg_constraint con
      JOIN pg_class src
        ON src.oid=con.conrelid
      JOIN pg_namespace src_ns
        ON src_ns.oid=src.relnamespace
      JOIN pg_class tgt
        ON tgt.oid=con.confrelid
      JOIN pg_namespace tgt_ns
        ON tgt_ns.oid=tgt.relnamespace
      WHERE con.contype='f'
      AND (
        src_ns.nspname='gmx'
        OR tgt_ns.nspname='gmx'
      )
      AND (
        lower(src.relname) ~
          '(cliente|fidel|pedido)'
        OR
        lower(tgt.relname) ~
          '(cliente|fidel|pedido)'
      )
      ORDER BY
        source_schema,
        source_table,
        constraint_name
      `
    );

    result.physicalFKs = fks.rows;

    console.log(`PHYSICAL_FK_COUNT=${fks.rowCount}`);
    printRows(fks.rows);

    section("8. TRIGGERS");

    const triggers = await q(
      client,
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        t.tgname AS trigger_name,
        CASE
          WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
          WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END AS timing,
        pg_get_triggerdef(
          t.oid,
          true
        ) AS trigger_definition,
        pn.nspname AS function_schema,
        p.proname AS function_name,
        p.oid AS function_oid
      FROM pg_trigger t
      JOIN pg_class c
        ON c.oid=t.tgrelid
      JOIN pg_namespace n
        ON n.oid=c.relnamespace
      JOIN pg_proc p
        ON p.oid=t.tgfoid
      JOIN pg_namespace pn
        ON pn.oid=p.pronamespace
      WHERE NOT t.tgisinternal
      AND n.nspname='gmx'
      AND (
        lower(c.relname) ~
          '(cliente|fidel)'
      )
      ORDER BY
        c.relname,
        t.tgname
      `
    );

    result.triggers = triggers.rows;
    printRows(triggers.rows);

    section("9. TRIGGER FUNCTION DEFINITIONS");

    const functionOids = [
    ...new Set(
      triggers.rows.
      map((x) => x.function_oid).
      filter(Boolean)
    )];


    for (const oid of functionOids) {
      const fn = await q(
        client,
        `
        SELECT
          p.oid,
          n.nspname AS schema_name,
          p.proname AS function_name,
          pg_get_function_arguments(p.oid)
            AS arguments,
          pg_get_function_result(p.oid)
            AS result_type,
          pg_get_functiondef(p.oid)
            AS function_definition
        FROM pg_proc p
        JOIN pg_namespace n
          ON n.oid=p.pronamespace
        WHERE p.oid=$1
        `,
        [oid]
      );

      result.functions.push(...fn.rows);

      printRows(
        fn.rows.map((x) => ({
          oid: x.oid,
          function:
          `${x.schema_name}.${x.function_name}`,
          arguments: x.arguments,
          result_type: x.result_type,
          definition: x.function_definition
        }))
      );
    }

    section("10. CLIENTES — CURRENT DATA PROFILE");

    if (
    await tableExists(
      client,
      "gmx",
      "clientes"
    ))
    {
      const profile = await q(
        client,
        `
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(DISTINCT id_cliente)::bigint
            AS distinct_id_cliente,
          COUNT(*) FILTER (
            WHERE id_cliente IS NULL
               OR btrim(id_cliente)=''
          )::bigint AS missing_id_cliente,
          COUNT(*) FILTER (
            WHERE nombre IS NULL
               OR btrim(nombre)=''
          )::bigint AS missing_nombre,
          COUNT(*) FILTER (
            WHERE email IS NOT NULL
              AND btrim(email)<>''
          )::bigint AS with_email,
          COUNT(*) FILTER (
            WHERE telefono IS NOT NULL
              AND btrim(telefono)<>''
          )::bigint AS with_phone
        FROM gmx.clientes
        `
      );

      printRows(profile.rows);

      section("11. CLIENTES — DUPLICATE VISIBLE IDS");

      const dupIds = await q(
        client,
        `
        SELECT
          id_cliente,
          COUNT(*)::bigint AS occurrences
        FROM gmx.clientes
        WHERE id_cliente IS NOT NULL
          AND btrim(id_cliente)<>''
        GROUP BY id_cliente
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC,id_cliente
        `
      );

      printRows(dupIds.rows);

      result.anomalies.push({
        test: "duplicate_id_cliente",
        count: dupIds.rowCount
      });

      section("12. CLIENTES — DUPLICATE EMAILS");

      const dupEmail = await q(
        client,
        `
        SELECT
          lower(btrim(email)) AS normalized_email,
          COUNT(*)::bigint AS occurrences,
          array_agg(id_cliente ORDER BY row_id)
            AS client_ids
        FROM gmx.clientes
        WHERE email IS NOT NULL
          AND btrim(email)<>''
        GROUP BY lower(btrim(email))
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        `
      );

      printRows(dupEmail.rows);

      result.anomalies.push({
        test: "duplicate_email",
        count: dupEmail.rowCount
      });

      section("13. CLIENTES — DUPLICATE PHONE");

      const dupPhone = await q(
        client,
        `
        SELECT
          regexp_replace(
            COALESCE(telefono,''),
            '[^0-9]',
            '',
            'g'
          ) AS normalized_phone,
          COUNT(*)::bigint AS occurrences,
          array_agg(id_cliente ORDER BY row_id)
            AS client_ids
        FROM gmx.clientes
        WHERE telefono IS NOT NULL
          AND btrim(telefono)<>''
        GROUP BY
          regexp_replace(
            COALESCE(telefono,''),
            '[^0-9]',
            '',
            'g'
          )
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        `
      );

      printRows(dupPhone.rows);

      result.anomalies.push({
        test: "duplicate_phone",
        count: dupPhone.rowCount
      });
    }

    section("14. LOGICAL RELATION — FIDELIDAD CUENTAS -> CLIENTES");

    if (
    (await tableExists(
      client,
      "gmx",
      "fidelidad_cuentas"
    )) && (
    await tableExists(
      client,
      "gmx",
      "clientes"
    )))
    {
      const orphanAccounts = await q(
        client,
        `
        SELECT
          f.*
        FROM gmx.fidelidad_cuentas f
        LEFT JOIN gmx.clientes c
          ON c.id_cliente=f.id_cliente
        WHERE c.row_id IS NULL
        ORDER BY f.row_id
        `
      );

      console.log(
        `ORPHAN_FIDELIDAD_CUENTAS=${orphanAccounts.rowCount}`
      );

      printRows(orphanAccounts.rows);

      result.logicalRelations.push({
        relation:
        "fidelidad_cuentas.id_cliente -> clientes.id_cliente",
        orphan_count: orphanAccounts.rowCount
      });
    }

    section("15. LOGICAL RELATION — MOVIMIENTOS -> CLIENTES");

    if (
    (await tableExists(
      client,
      "gmx",
      "fidelidad_movimientos"
    )) && (
    await tableExists(
      client,
      "gmx",
      "clientes"
    )))
    {
      const orphanMovClients = await q(
        client,
        `
        SELECT
          m.*
        FROM gmx.fidelidad_movimientos m
        LEFT JOIN gmx.clientes c
          ON c.id_cliente=m.id_cliente
        WHERE c.row_id IS NULL
        ORDER BY m.row_id
        `
      );

      console.log(
        `ORPHAN_FIDELIDAD_MOV_CLIENT=${orphanMovClients.rowCount}`
      );

      printRows(orphanMovClients.rows);

      result.logicalRelations.push({
        relation:
        "fidelidad_movimientos.id_cliente -> clientes.id_cliente",
        orphan_count: orphanMovClients.rowCount
      });
    }

    section("16. LOGICAL RELATION — PEDIDOS -> CLIENTES");

    if (
    (await tableExists(
      client,
      "gmx",
      "pedidos"
    )) && (
    await tableExists(
      client,
      "gmx",
      "clientes"
    )) && (
    await columnExists(
      client,
      "gmx",
      "pedidos",
      "id_cliente"
    )))
    {
      const orphanOrders = await q(
        client,
        `
        SELECT
          p.row_id,
          p.id_pedido,
          p.id_cliente,
          p.nombre_cliente,
          p.fecha
        FROM gmx.pedidos p
        LEFT JOIN gmx.clientes c
          ON c.id_cliente=p.id_cliente
        WHERE p.id_cliente IS NOT NULL
          AND btrim(p.id_cliente)<>''
          AND c.row_id IS NULL
        ORDER BY p.row_id
        `
      );

      console.log(
        `ORPHAN_PEDIDOS_CLIENT=${orphanOrders.rowCount}`
      );

      printRows(orphanOrders.rows);

      result.logicalRelations.push({
        relation:
        "pedidos.id_cliente -> clientes.id_cliente",
        orphan_count: orphanOrders.rowCount
      });
    }

    section("17. FIDELIDAD — ACCOUNT CONSISTENCY");

    if (
    await tableExists(
      client,
      "gmx",
      "fidelidad_cuentas"
    ))
    {
      const accounts = await q(
        client,
        `
        SELECT
          row_id,
          id_cliente,
          puntos_disponibles,
          puntos_generados,
          puntos_redimidos,
          puntos_expirados,
          nivel,
          fecha_alta,
          fecha_actualizacion
        FROM gmx.fidelidad_cuentas
        ORDER BY id_cliente,row_id
        `
      );

      printRows(accounts.rows);

      const duplicateAccounts = await q(
        client,
        `
        SELECT
          id_cliente,
          COUNT(*)::bigint AS account_count
        FROM gmx.fidelidad_cuentas
        GROUP BY id_cliente
        HAVING COUNT(*) > 1
        ORDER BY account_count DESC,id_cliente
        `
      );

      console.log(
        `DUPLICATE_LOYALTY_ACCOUNTS=${duplicateAccounts.rowCount}`
      );

      printRows(duplicateAccounts.rows);

      result.anomalies.push({
        test: "duplicate_loyalty_account",
        count: duplicateAccounts.rowCount
      });

      const negativeAccounts = await q(
        client,
        `
        SELECT *
        FROM gmx.fidelidad_cuentas
        WHERE
          puntos_disponibles < 0
          OR puntos_generados < 0
          OR puntos_redimidos < 0
          OR puntos_expirados < 0
        ORDER BY row_id
        `
      );

      console.log(
        `NEGATIVE_LOYALTY_BALANCES=${negativeAccounts.rowCount}`
      );

      printRows(negativeAccounts.rows);

      result.anomalies.push({
        test: "negative_loyalty_balance",
        count: negativeAccounts.rowCount
      });
    }

    section("18. FIDELIDAD — MOVEMENT CONTRACT / TYPES");

    if (
    await tableExists(
      client,
      "gmx",
      "fidelidad_movimientos"
    ))
    {
      const types = await q(
        client,
        `
        SELECT
          tipo,
          COUNT(*)::bigint AS movements,
          COALESCE(SUM(puntos),0)::bigint
            AS points_sum,
          MIN(fecha) AS first_date,
          MAX(fecha) AS last_date
        FROM gmx.fidelidad_movimientos
        GROUP BY tipo
        ORDER BY tipo
        `
      );

      printRows(types.rows);

      section("19. FIDELIDAD — MOVEMENT BALANCE CHAIN");

      const brokenChain = await q(
        client,
        `
        WITH x AS (
          SELECT
            row_id,
            id_movimiento,
            id_cliente,
            fecha,
            tipo,
            puntos,
            saldo_anterior,
            saldo_nuevo,
            LAG(saldo_nuevo) OVER (
              PARTITION BY id_cliente
              ORDER BY fecha,row_id
            ) AS previous_saldo_nuevo
          FROM gmx.fidelidad_movimientos
        )
        SELECT *
        FROM x
        WHERE previous_saldo_nuevo IS NOT NULL
          AND saldo_anterior <> previous_saldo_nuevo
        ORDER BY id_cliente,fecha,row_id
        `
      );

      console.log(
        `BROKEN_MOVEMENT_CHAIN=${brokenChain.rowCount}`
      );

      printRows(brokenChain.rows);

      result.anomalies.push({
        test: "broken_movement_chain",
        count: brokenChain.rowCount
      });

      section("20. FIDELIDAD — MOVEMENT ARITHMETIC");

      const arithmetic = await q(
        client,
        `
        SELECT
          row_id,
          id_movimiento,
          id_cliente,
          tipo,
          puntos,
          saldo_anterior,
          saldo_nuevo,
          (saldo_nuevo - saldo_anterior)
            AS actual_delta
        FROM gmx.fidelidad_movimientos
        WHERE
          saldo_anterior IS NULL
          OR saldo_nuevo IS NULL
        ORDER BY row_id
        `
      );

      console.log(
        `MOVEMENT_NULL_BALANCES=${arithmetic.rowCount}`
      );

      printRows(arithmetic.rows);

      section("21. FIDELIDAD — DUPLICATE MOVEMENT IDS");

      const duplicateMovementIds = await q(
        client,
        `
        SELECT
          id_movimiento,
          COUNT(*)::bigint AS occurrences
        FROM gmx.fidelidad_movimientos
        GROUP BY id_movimiento
        HAVING COUNT(*) > 1
        ORDER BY occurrences DESC,id_movimiento
        `
      );

      console.log(
        `DUPLICATE_MOVEMENT_IDS=${duplicateMovementIds.rowCount}`
      );

      printRows(duplicateMovementIds.rows);

      result.anomalies.push({
        test: "duplicate_movement_id",
        count: duplicateMovementIds.rowCount
      });
    }

    section("22. FIDELIDAD — ACCOUNT VS LAST MOVEMENT");

    if (
    (await tableExists(
      client,
      "gmx",
      "fidelidad_cuentas"
    )) && (
    await tableExists(
      client,
      "gmx",
      "fidelidad_movimientos"
    )))
    {
      const mismatch = await q(
        client,
        `
        WITH latest AS (
          SELECT DISTINCT ON (id_cliente)
            id_cliente,
            id_movimiento,
            fecha,
            saldo_nuevo
          FROM gmx.fidelidad_movimientos
          ORDER BY
            id_cliente,
            fecha DESC,
            row_id DESC
        )
        SELECT
          f.id_cliente,
          f.puntos_disponibles
            AS account_balance,
          l.saldo_nuevo
            AS last_movement_balance,
          l.id_movimiento,
          l.fecha,
          (
            f.puntos_disponibles
              - l.saldo_nuevo
          ) AS difference
        FROM gmx.fidelidad_cuentas f
        JOIN latest l
          ON l.id_cliente=f.id_cliente
        WHERE
          f.puntos_disponibles
            <> l.saldo_nuevo
        ORDER BY f.id_cliente
        `
      );

      console.log(
        `ACCOUNT_LAST_MOVEMENT_MISMATCH=${mismatch.rowCount}`
      );

      printRows(mismatch.rows);

      result.anomalies.push({
        test: "account_last_movement_mismatch",
        count: mismatch.rowCount
      });
    }

    section("23. MOVEMENTS -> PEDIDOS LOGICAL RELATION");

    if (
    (await tableExists(
      client,
      "gmx",
      "fidelidad_movimientos"
    )) && (
    await tableExists(
      client,
      "gmx",
      "pedidos"
    )) && (
    await columnExists(
      client,
      "gmx",
      "fidelidad_movimientos",
      "id_pedido"
    )))
    {
      const orphanMovementOrders = await q(
        client,
        `
        SELECT
          m.row_id,
          m.id_movimiento,
          m.id_cliente,
          m.tipo,
          m.id_pedido,
          m.puntos,
          m.fecha
        FROM gmx.fidelidad_movimientos m
        LEFT JOIN gmx.pedidos p
          ON p.id_pedido=m.id_pedido
        WHERE m.id_pedido IS NOT NULL
          AND btrim(m.id_pedido)<>''
          AND p.row_id IS NULL
        ORDER BY m.row_id
        `
      );

      console.log(
        `ORPHAN_MOVEMENT_ORDERS=${orphanMovementOrders.rowCount}`
      );

      printRows(orphanMovementOrders.rows);

      result.logicalRelations.push({
        relation:
        "fidelidad_movimientos.id_pedido -> pedidos.id_pedido",
        orphan_count:
        orphanMovementOrders.rowCount
      });
    }

    section("24. PEDIDOS — LOYALTY PROFILE");

    if (
    await tableExists(
      client,
      "gmx",
      "pedidos"
    ))
    {
      const loyaltyCols = [
      "id_cliente",
      "puntos_redimidos",
      "descuento_puntos",
      "puntos_generados",
      "id_cuenta_cliente"];


      const existence = {};

      for (const col of loyaltyCols) {
        existence[col] =
        await columnExists(
          client,
          "gmx",
          "pedidos",
          col
        );
      }

      console.table([
      existence]
      );

      if (
      existence.id_cliente &&
      existence.puntos_redimidos &&
      existence.puntos_generados)
      {
        const orderSummary = await q(
          client,
          `
          SELECT
            COUNT(*) FILTER (
              WHERE id_cliente IS NOT NULL
                AND btrim(id_cliente)<>''
            )::bigint AS client_orders,

            COUNT(*) FILTER (
              WHERE COALESCE(
                puntos_redimidos,
                0
              ) <> 0
            )::bigint AS orders_with_redemption,

            COUNT(*) FILTER (
              WHERE COALESCE(
                puntos_generados,
                0
              ) <> 0
            )::bigint AS orders_with_earned_points,

            COALESCE(
              SUM(puntos_redimidos),
              0
            )::bigint AS redeemed_points_total,

            COALESCE(
              SUM(puntos_generados),
              0
            )::bigint AS earned_points_total
          FROM gmx.pedidos
          `
        );

        printRows(orderSummary.rows);
      }
    }

    section("25. IDEMPOTENCY STRUCTURAL SIGNALS");

    const idemIndexes = await q(
      client,
      `
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname='gmx'
      AND (
        lower(indexname) LIKE '%idempot%'
        OR lower(indexname) LIKE '%movimiento%'
        OR lower(indexdef) LIKE '%id_movimiento%'
        OR lower(indexdef) LIKE '%id_pedido%'
      )
      AND (
        lower(tablename) LIKE '%fidel%'
        OR lower(tablename) LIKE '%pedido%'
      )
      ORDER BY tablename,indexname
      `
    );

    printRows(idemIndexes.rows);

    section("26. SOURCE FILE MAP");

    result.sourceFiles = discoverSource();

    console.log(
      `SOURCE_FILES=${result.sourceFiles.length}`
    );

    printRows(result.sourceFiles, 300);

    section("27. KEY SOURCE FUNCTIONS — STATIC SIGNALS");

    const sourceSignals = [];

    const importantFiles = [
    "src/repositories/clientsRepository.js",
    "src/repositories/clientAccountRepository.js",
    "src/repositories/benefitsRepository.js",
    "src/repositories/ordersRepository.js",
    "src/routes/clients.js",
    "src/routes/clientAccount.js",
    "src/routes/benefits.js",
    "src/server.js"];


    const patterns = [
    /INSERT\s+INTO\s+shiny\.clientes/i,
    /UPDATE\s+shiny\.clientes/i,
    /DELETE\s+FROM\s+shiny\.clientes/i,

    /INSERT\s+INTO\s+shiny\.fidelidad_movimientos/i,
    /UPDATE\s+shiny\.fidelidad_cuentas/i,

    /applyBenefitsTx/i,
    /calculateBenefitsTx/i,
    /adjustClientPoints/i,
    /reverse/i,
    /reversa/i,

    /idempot/i,
    /id_movimiento/i,
    /id_pedido/i,
    /BEGIN/i,
    /COMMIT/i,
    /ROLLBACK/i];


    for (const relative of importantFiles) {
      const file = path.join(ROOT, relative);

      if (!fs.existsSync(file)) {
        sourceSignals.push({
          file: relative,
          exists: false,
          signals: ""
        });

        continue;
      }

      const text = fs.readFileSync(file, "utf8");

      const found = patterns.
      filter((p) => p.test(text)).
      map((p) => p.source);

      sourceSignals.push({
        file: relative,
        exists: true,
        signals: found.join(" | ")
      });
    }

    printRows(sourceSignals);

    section("28. FINAL SAFETY VALIDATION");

    const finalSafety = await q(
      client,
      `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,
        current_database()
          AS database_name,
        current_user
          AS database_user,
        now() AS checked_at
      `
    );

    printRows(finalSafety.rows);

    if (
    finalSafety.rows[0]?.
    transaction_read_only !== "on")
    {
      throw new Error(
        "FINAL SAFETY CHECK FAILED"
      );
    }

    await client.query("ROLLBACK");
    txStarted = false;

    section("29. CLIENTES-001 DISCOVERY CONTRACT SUMMARY");

    const anomalyTotal =
    result.anomalies.reduce(
      (sum, x) =>
      sum + Number(x.count || 0),
      0
    );

    const orphanTotal =
    result.logicalRelations.reduce(
      (sum, x) =>
      sum +
      Number(x.orphan_count || 0),
      0
    );

    console.log(
      "CLIENTES_001_DISCOVERY_CONTRACT=PASS"
    );

    console.log(
      `DISCOVERED_TABLES=${result.discoveredTables.length}`
    );

    console.log(
      `CONSTRAINTS=${result.constraints.length}`
    );

    console.log(
      `INDEXES=${result.indexes.length}`
    );

    console.log(
      `PHYSICAL_FOREIGN_KEYS=${result.physicalFKs.length}`
    );

    console.log(
      `TRIGGERS=${result.triggers.length}`
    );

    console.log(
      `TRIGGER_FUNCTIONS=${result.functions.length}`
    );

    console.log(
      `LOGICAL_RELATIONS_TESTED=${result.logicalRelations.length}`
    );

    console.log(
      `ORPHAN_TOTAL=${orphanTotal}`
    );

    console.log(
      `ANOMALY_TOTAL=${anomalyTotal}`
    );

    console.log(
      `SOURCE_FILES=${result.sourceFiles.length}`
    );

    console.log(
      `HEAD_EQ_ORIGIN_MAIN=${
      head === originMain ? "YES" : "NO"}`

    );

    console.log(
      `GIT_CLEAN=${gitStatus ? "NO" : "YES"}`
    );

    console.log("MODE=READ_ONLY");
    console.log("DATABASE_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      "NEXT_STEP=ANALYZE_DISCOVERY_CONTRACT"
    );

    console.log(
      "NO_CODE_CHANGE_AUTHORIZED_YET"
    );

    section(
      "CLIENTES-001 DISCOVERY + CONTRACT COMPLETE"
    );

  } catch (error) {
    result.errors.push(
      error?.stack || String(error)
    );

    if (txStarted) {
      try {
        await client.query("ROLLBACK");
        console.log(
          "\nROLLBACK_AFTER_ERROR=PASS"
        );
      } catch (rollbackError) {
        console.error(
          "ROLLBACK_AFTER_ERROR=FAILED",
          rollbackError
        );
      }
    }

    section(
      "CLIENTES-001 DISCOVERY + CONTRACT FAILED"
    );

    console.error(
      error?.stack || error
    );

    console.error(
      "DATABASE_MUTATION=0_EXPECTED"
    );

    process.exitCode = 1;

  } finally {
    try {
      await client.end();
    } catch {

      // no-op
    }}
}

main();
