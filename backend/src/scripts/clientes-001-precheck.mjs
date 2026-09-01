import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-001 PRECHECK
 *
 * OBJETIVO:
 *   Levantar evidencia READ-ONLY del estado actual del bloque
 *   Clientes / Fidelidad antes de cualquier modificación.
 *
 * REGLAS:
 *   - NO INSERT
 *   - NO UPDATE
 *   - NO DELETE
 *   - NO DDL
 *   - NO movimientos financieros
 *   - NO cambios persistentes
 *   - SQL ejecutado dentro de READ ONLY transaction
 *   - ROLLBACK obligatorio al terminar
 *
 * SALIDA:
 *   - Configuración de entorno segura
 *   - Conectividad DB
 *   - Tablas candidatas
 *   - Columnas candidatas
 *   - PK / FK / UNIQUE / CHECK
 *   - Índices
 *   - Relaciones FK
 *   - Secuencias vinculadas
 *   - Triggers
 *   - Código fuente relacionado
 *   - Routes / services / repositories / controllers / frontend
 *   - Git status / branch / HEAD
 *   - Resumen CLIENTES-001
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

const LINE = "=".repeat(100);
const SUBLINE = "-".repeat(100);

const findings = {
  dbConnected: false,
  dbName: null,
  dbHost: null,
  dbPort: null,
  dbUser: null,

  candidateTables: [],
  candidateColumns: [],
  constraints: [],
  indexes: [],
  foreignKeys: [],
  triggers: [],
  sequences: [],

  sourceMatches: [],
  git: {},

  errors: []
};

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

function subsection(title) {
  console.log("\n" + SUBLINE);
  console.log(title);
  console.log(SUBLINE);
}

function safe(value) {
  if (value === undefined || value === null || value === "") {
    return "(not set)";
  }
  return value;
}

function mask(value) {
  if (!value) return "(not set)";
  return "***SET***";
}

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    return `ERROR: ${error?.message ?? error}`;
  }
}

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, "utf8");
  const out = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;

    let [, key, value] = match;

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
  path.join(ROOT, ".env"),
  path.join(ROOT, ".env.local"),
  path.join(ROOT, ".env.development"),
  path.join(ROOT, ".env.dev")];


  const loaded = [];

  for (const envFile of candidates) {
    if (!fs.existsSync(envFile)) continue;

    const values = loadDotEnvFile(envFile);

    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    loaded.push(path.relative(ROOT, envFile));
  }

  return loaded;
}

function getConnectionConfig() {
  /*
   * NO asumimos un único esquema de variables.
   * Revisamos patrones comunes SIN imprimir passwords.
   */

  const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PG_CONNECTION_STRING ||
  process.env.DB_URL ||
  null;

  if (connectionString) {
    return {
      connectionString,
      ssl:
      process.env.DB_SSL === "true" ||
      process.env.PGSSLMODE === "require" ?
      { rejectUnauthorized: false } :
      undefined,
      source: "connection-string"
    };
  }

  const host =
  process.env.PGHOST ||
  process.env.DB_HOST ||
  process.env.POSTGRES_HOST ||
  "localhost";

  const port = Number(
    process.env.PGPORT ||
    process.env.DB_PORT ||
    process.env.POSTGRES_PORT ||
    5432
  );

  const database =
  process.env.PGDATABASE ||
  process.env.DB_NAME ||
  process.env.DB_DATABASE ||
  process.env.POSTGRES_DB;

  const user =
  process.env.PGUSER ||
  process.env.DB_USER ||
  process.env.POSTGRES_USER;

  const password =
  process.env.PGPASSWORD ||
  process.env.DB_PASSWORD ||
  process.env.POSTGRES_PASSWORD;

  if (!database || !user) {
    return null;
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl:
    process.env.DB_SSL === "true" ||
    process.env.PGSSLMODE === "require" ?
    { rejectUnauthorized: false } :
    undefined,
    source: "individual-vars"
  };
}

function walkFiles(startDir) {
  const results = [];

  if (!fs.existsSync(startDir)) return results;

  const ignoredDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "tmp",
  "temp",
  "logs"]
  );

  const allowedExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".sql",
  ".vue",
  ".html"]
  );

  const stack = [startDir];

  while (stack.length) {
    const current = stack.pop();

    let entries;

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          stack.push(full);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();

      if (allowedExtensions.has(ext)) {
        results.push(full);
      }
    }
  }

  return results;
}

function classifyFile(file) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();

  if (/route|router|routes/.test(normalized)) return "ROUTE";
  if (/controller/.test(normalized)) return "CONTROLLER";
  if (/service/.test(normalized)) return "SERVICE";
  if (/repo|repository|repositories/.test(normalized)) return "REPOSITORY";
  if (/model|entity|schema/.test(normalized)) return "MODEL/SCHEMA";
  if (/frontend|client|components|pages|views|react|vite/.test(normalized))
  return "FRONTEND";
  if (/middleware/.test(normalized)) return "MIDDLEWARE";
  if (/script/.test(normalized)) return "SCRIPT";
  if (/sql|migration|migrations/.test(normalized)) return "SQL/MIGRATION";

  return "SOURCE";
}

function scanSource() {
  const searchRoots = [
  path.join(ROOT, "src"),
  path.join(ROOT, "app"),
  path.join(ROOT, "routes"),
  path.join(ROOT, "services"),
  path.join(ROOT, "repositories"),
  path.join(ROOT, "controllers")];


  /*
   * Incluye términos en español e inglés.
   * Solo descubrimiento; NO presume que estos sean los nombres reales.
   */
  const regex =
  /\b(cliente|clientes|customer|customers|fidelidad|loyalty|lealtad|puntos|points|recompensa|recompensas|reward|rewards|membresia|membership|saldo[_-]?puntos)\b/i;

  const seen = new Set();
  const matches = [];

  for (const searchRoot of searchRoots) {
    for (const file of walkFiles(searchRoot)) {
      if (seen.has(file)) continue;
      seen.add(file);

      let text;

      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }

      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue;

        matches.push({
          type: classifyFile(file),
          file: path.relative(ROOT, file),
          line: i + 1,
          text: lines[i].trim().slice(0, 240)
        });

        /*
         * Reiniciar lastIndex por seguridad aunque regex no sea global.
         */
        regex.lastIndex = 0;
      }
    }
  }

  return matches;
}

async function q(client, text, params = []) {
  /*
   * Guard rail adicional:
   * solamente aceptamos consultas que comiencen con SELECT o WITH.
   */
  const normalized = text.
  replace(/\/\*[\s\S]*?\*\//g, "").
  replace(/--.*$/gm, "").
  trim().
  toUpperCase();

  if (
  !normalized.startsWith("SELECT") &&
  !normalized.startsWith("WITH"))
  {
    throw new Error(
      `READ_ONLY_GUARD rechazó SQL que no inicia con SELECT/WITH: ${normalized.slice(
        0,
        80
      )}`
    );
  }

  return client.query(text, params);
}

async function main() {
  console.log("\n");
  console.log(brandText("GMX — CLIENTES-001 PRECHECK"));
  console.log("MODE=READ_ONLY");
  console.log(`ROOT=${ROOT}`);
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  section("1. PRECHECK — ENVIRONMENT");

  const envFiles = loadEnvironment();

  console.log(
    "ENV_FILES=",
    envFiles.length ? envFiles.join(", ") : "(none detected)"
  );

  console.log("NODE_ENV=", safe(process.env.NODE_ENV));
  console.log("DATABASE_URL=", mask(process.env.DATABASE_URL));
  console.log("POSTGRES_URL=", mask(process.env.POSTGRES_URL));
  console.log("PGHOST=", safe(process.env.PGHOST));
  console.log("PGDATABASE=", safe(process.env.PGDATABASE));
  console.log("PGUSER=", safe(process.env.PGUSER));
  console.log("PGPASSWORD=", mask(process.env.PGPASSWORD));
  console.log("DB_HOST=", safe(process.env.DB_HOST));
  console.log("DB_NAME=", safe(process.env.DB_NAME || process.env.DB_DATABASE));
  console.log("DB_USER=", safe(process.env.DB_USER));
  console.log("DB_PASSWORD=", mask(process.env.DB_PASSWORD));

  section("2. PRECHECK — GIT");

  findings.git.branch = runGit(["branch", "--show-current"]);
  findings.git.head = runGit(["rev-parse", "HEAD"]);
  findings.git.status = runGit(["status", "--short"]);
  findings.git.originMain = runGit(["rev-parse", "origin/main"]);

  console.log(`BRANCH=${findings.git.branch}`);
  console.log(`HEAD=${findings.git.head}`);
  console.log(`ORIGIN_MAIN=${findings.git.originMain}`);
  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${
    findings.git.head === findings.git.originMain ? "YES" : "NO"}`

  );

  console.log("\nGIT_STATUS:");
  console.log(findings.git.status || "(clean)");

  section("3. PRECHECK — SOURCE DISCOVERY");

  findings.sourceMatches = scanSource();

  console.log(
    `SOURCE_MATCHES=${findings.sourceMatches.length}`
  );

  if (!findings.sourceMatches.length) {
    console.log(
      "No se encontraron referencias obvias a clientes/fidelidad en los directorios inspeccionados."
    );
  } else {
    console.table(
      findings.sourceMatches.slice(0, 200).map((x) => ({
        TYPE: x.type,
        FILE: x.file,
        LINE: x.line,
        TEXT: x.text
      }))
    );

    if (findings.sourceMatches.length > 200) {
      console.log(
        `NOTA: mostrando 200/${findings.sourceMatches.length} coincidencias.`
      );
    }
  }

  section("4. PRECHECK — DATABASE CONNECTION");

  const config = getConnectionConfig();

  if (!config) {
    throw new Error(
      "No pude resolver la configuración PostgreSQL desde las variables disponibles."
    );
  }

  console.log(`DB_CONFIG_SOURCE=${config.source}`);

  const client = new Client(config);

  let transactionStarted = false;

  try {
    await client.connect();

    /*
     * CRÍTICO:
     * La transacción completa queda forzada como READ ONLY.
     */
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;

    /*
     * Protección adicional a nivel de sesión/transacción.
     */
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");

    const identity = await q(
      client,
      `
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port,
        current_schema() AS current_schema,
        pg_is_in_recovery() AS is_replica,
        version() AS postgres_version
      `
    );

    const db = identity.rows[0];

    findings.dbConnected = true;
    findings.dbName = db.database_name;
    findings.dbHost = db.server_address;
    findings.dbPort = db.server_port;
    findings.dbUser = db.database_user;

    console.table(identity.rows);

    const tx = await q(
      client,
      `
      SELECT
        current_setting('transaction_read_only') AS transaction_read_only,
        current_setting('transaction_isolation') AS transaction_isolation
      `
    );

    console.table(tx.rows);

    if (tx.rows[0]?.transaction_read_only !== "on") {
      throw new Error(
        "SAFETY_ABORT: transaction_read_only NO está habilitado."
      );
    }

    section("5. DATABASE DISCOVERY — CANDIDATE TABLES");

    /*
     * Importante:
     * No asumimos tablas.
     * Buscamos nombres candidatos en todos los schemas de aplicación.
     */
    const tables = await q(
      client,
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        CASE c.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          ELSE c.relkind::text
        END AS object_type,
        COALESCE(s.n_live_tup, 0)::bigint AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s
        ON s.relid = c.oid
      WHERE
        n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r', 'p', 'v', 'm')
        AND (
          lower(c.relname) LIKE '%client%'
          OR lower(c.relname) LIKE '%customer%'
          OR lower(c.relname) LIKE '%fidel%'
          OR lower(c.relname) LIKE '%loyal%'
          OR lower(c.relname) LIKE '%punto%'
          OR lower(c.relname) LIKE '%point%'
          OR lower(c.relname) LIKE '%reward%'
          OR lower(c.relname) LIKE '%recomp%'
          OR lower(c.relname) LIKE '%membres%'
        )
      ORDER BY n.nspname, c.relname
      `
    );

    findings.candidateTables = tables.rows;

    console.log(`CANDIDATE_TABLES=${tables.rowCount}`);
    console.table(tables.rows);

    section("6. DATABASE DISCOVERY — CANDIDATE COLUMNS");

    /*
     * Esto permite descubrir casos donde la tabla NO se llama cliente,
     * pero sí contiene id_cliente, customer_id, puntos, etc.
     */
    const columns = await q(
      client,
      `
      SELECT
        table_schema,
        table_name,
        ordinal_position,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE
        table_schema NOT IN ('pg_catalog', 'information_schema')
        AND (
          lower(column_name) LIKE '%client%'
          OR lower(column_name) LIKE '%customer%'
          OR lower(column_name) LIKE '%fidel%'
          OR lower(column_name) LIKE '%loyal%'
          OR lower(column_name) LIKE '%punto%'
          OR lower(column_name) LIKE '%point%'
          OR lower(column_name) LIKE '%reward%'
          OR lower(column_name) LIKE '%recomp%'
          OR lower(column_name) LIKE '%membres%'
        )
      ORDER BY table_schema, table_name, ordinal_position
      `
    );

    findings.candidateColumns = columns.rows;

    console.log(`CANDIDATE_COLUMNS=${columns.rowCount}`);
    console.table(columns.rows);

    /*
     * Construimos lista real de tablas descubiertas por nombre O por columna.
     */
    const discoveredMap = new Map();

    for (const row of tables.rows) {
      discoveredMap.set(
        `${row.schema_name}.${row.table_name}`,
        {
          schema_name: row.schema_name,
          table_name: row.table_name
        }
      );
    }

    for (const row of columns.rows) {
      discoveredMap.set(
        `${row.table_schema}.${row.table_name}`,
        {
          schema_name: row.table_schema,
          table_name: row.table_name
        }
      );
    }

    const discovered = [...discoveredMap.values()];

    section("7. CONTRACT PREVIEW — REAL COLUMNS OF DISCOVERED TABLES");

    if (!discovered.length) {
      console.log(
        "No existen todavía tablas candidatas suficientes para levantar contrato detallado."
      );
    }

    for (const table of discovered) {
      subsection(
        `${table.schema_name}.${table.table_name}`
      );

      const realColumns = await q(
        client,
        `
        SELECT
          ordinal_position,
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        ORDER BY ordinal_position
        `,
        [table.schema_name, table.table_name]
      );

      console.table(realColumns.rows);
    }

    section("8. CONTRACT PREVIEW — CONSTRAINTS");

    const constraints = await q(
      client,
      `
      WITH candidate_tables AS (
        SELECT DISTINCT
          table_schema,
          table_name
        FROM information_schema.columns
        WHERE
          table_schema NOT IN ('pg_catalog', 'information_schema')
          AND (
            lower(table_name) LIKE '%client%'
            OR lower(table_name) LIKE '%customer%'
            OR lower(table_name) LIKE '%fidel%'
            OR lower(table_name) LIKE '%loyal%'
            OR lower(table_name) LIKE '%punto%'
            OR lower(table_name) LIKE '%point%'
            OR lower(table_name) LIKE '%reward%'
            OR lower(table_name) LIKE '%recomp%'
            OR lower(table_name) LIKE '%membres%'
            OR lower(column_name) LIKE '%client%'
            OR lower(column_name) LIKE '%customer%'
            OR lower(column_name) LIKE '%fidel%'
            OR lower(column_name) LIKE '%loyal%'
            OR lower(column_name) LIKE '%punto%'
            OR lower(column_name) LIKE '%point%'
            OR lower(column_name) LIKE '%reward%'
            OR lower(column_name) LIKE '%recomp%'
            OR lower(column_name) LIKE '%membres%'
          )
      )
      SELECT
        n.nspname AS schema_name,
        cls.relname AS table_name,
        con.conname AS constraint_name,
        CASE con.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUSION'
          ELSE con.contype::text
        END AS constraint_type,
        pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class cls
        ON cls.oid = con.conrelid
      JOIN pg_namespace n
        ON n.oid = cls.relnamespace
      JOIN candidate_tables ct
        ON ct.table_schema = n.nspname
       AND ct.table_name = cls.relname
      ORDER BY n.nspname, cls.relname, constraint_type, con.conname
      `
    );

    findings.constraints = constraints.rows;

    console.log(`CONSTRAINTS=${constraints.rowCount}`);
    console.table(constraints.rows);

    section("9. CONTRACT PREVIEW — INDEXES");

    const indexes = await q(
      client,
      `
      WITH candidate_tables AS (
        SELECT DISTINCT
          table_schema,
          table_name
        FROM information_schema.columns
        WHERE
          table_schema NOT IN ('pg_catalog', 'information_schema')
          AND (
            lower(table_name) LIKE '%client%'
            OR lower(table_name) LIKE '%customer%'
            OR lower(table_name) LIKE '%fidel%'
            OR lower(table_name) LIKE '%loyal%'
            OR lower(table_name) LIKE '%punto%'
            OR lower(table_name) LIKE '%point%'
            OR lower(table_name) LIKE '%reward%'
            OR lower(table_name) LIKE '%recomp%'
            OR lower(table_name) LIKE '%membres%'
            OR lower(column_name) LIKE '%client%'
            OR lower(column_name) LIKE '%customer%'
            OR lower(column_name) LIKE '%fidel%'
            OR lower(column_name) LIKE '%loyal%'
            OR lower(column_name) LIKE '%punto%'
            OR lower(column_name) LIKE '%point%'
            OR lower(column_name) LIKE '%reward%'
            OR lower(column_name) LIKE '%recomp%'
            OR lower(column_name) LIKE '%membres%'
          )
      )
      SELECT
        i.schemaname AS schema_name,
        i.tablename AS table_name,
        i.indexname AS index_name,
        i.indexdef AS index_definition
      FROM pg_indexes i
      JOIN candidate_tables ct
        ON ct.table_schema = i.schemaname
       AND ct.table_name = i.tablename
      ORDER BY i.schemaname, i.tablename, i.indexname
      `
    );

    findings.indexes = indexes.rows;

    console.log(`INDEXES=${indexes.rowCount}`);
    console.table(indexes.rows);

    section("10. RELATIONSHIP DISCOVERY — FOREIGN KEYS");

    /*
     * Incluimos FKs ENTRANTES y SALIENTES.
     * Esto será clave después para ventas/pedidos.
     */
    const foreignKeys = await q(
      client,
      `
      WITH candidate_tables AS (
        SELECT DISTINCT
          c.table_schema,
          c.table_name
        FROM information_schema.columns c
        WHERE
          c.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND (
            lower(c.table_name) LIKE '%client%'
            OR lower(c.table_name) LIKE '%customer%'
            OR lower(c.table_name) LIKE '%fidel%'
            OR lower(c.table_name) LIKE '%loyal%'
            OR lower(c.table_name) LIKE '%punto%'
            OR lower(c.table_name) LIKE '%point%'
            OR lower(c.table_name) LIKE '%reward%'
            OR lower(c.table_name) LIKE '%recomp%'
            OR lower(c.table_name) LIKE '%membres%'
            OR lower(c.column_name) LIKE '%client%'
            OR lower(c.column_name) LIKE '%customer%'
            OR lower(c.column_name) LIKE '%fidel%'
            OR lower(c.column_name) LIKE '%loyal%'
            OR lower(c.column_name) LIKE '%punto%'
            OR lower(c.column_name) LIKE '%point%'
            OR lower(c.column_name) LIKE '%reward%'
            OR lower(c.column_name) LIKE '%recomp%'
            OR lower(c.column_name) LIKE '%membres%'
          )
      )
      SELECT
        src_ns.nspname AS source_schema,
        src.relname AS source_table,
        con.conname AS fk_name,
        pg_get_constraintdef(con.oid, true) AS definition,
        tgt_ns.nspname AS target_schema,
        tgt.relname AS target_table,
        CASE
          WHEN src_candidate.table_name IS NOT NULL
           AND tgt_candidate.table_name IS NOT NULL THEN 'CANDIDATE <-> CANDIDATE'
          WHEN src_candidate.table_name IS NOT NULL THEN 'OUTBOUND'
          WHEN tgt_candidate.table_name IS NOT NULL THEN 'INBOUND'
          ELSE 'OTHER'
        END AS direction
      FROM pg_constraint con
      JOIN pg_class src
        ON src.oid = con.conrelid
      JOIN pg_namespace src_ns
        ON src_ns.oid = src.relnamespace
      JOIN pg_class tgt
        ON tgt.oid = con.confrelid
      JOIN pg_namespace tgt_ns
        ON tgt_ns.oid = tgt.relnamespace
      LEFT JOIN candidate_tables src_candidate
        ON src_candidate.table_schema = src_ns.nspname
       AND src_candidate.table_name = src.relname
      LEFT JOIN candidate_tables tgt_candidate
        ON tgt_candidate.table_schema = tgt_ns.nspname
       AND tgt_candidate.table_name = tgt.relname
      WHERE
        con.contype = 'f'
        AND (
          src_candidate.table_name IS NOT NULL
          OR tgt_candidate.table_name IS NOT NULL
        )
      ORDER BY
        direction,
        src_ns.nspname,
        src.relname,
        con.conname
      `
    );

    findings.foreignKeys = foreignKeys.rows;

    console.log(`FOREIGN_KEYS=${foreignKeys.rowCount}`);
    console.table(foreignKeys.rows);

    section("11. DATABASE DISCOVERY — TRIGGERS");

    const triggers = await q(
      client,
      `
      WITH candidate_tables AS (
        SELECT DISTINCT
          table_schema,
          table_name
        FROM information_schema.columns
        WHERE
          table_schema NOT IN ('pg_catalog', 'information_schema')
          AND (
            lower(table_name) LIKE '%client%'
            OR lower(table_name) LIKE '%customer%'
            OR lower(table_name) LIKE '%fidel%'
            OR lower(table_name) LIKE '%loyal%'
            OR lower(table_name) LIKE '%punto%'
            OR lower(table_name) LIKE '%point%'
            OR lower(table_name) LIKE '%reward%'
            OR lower(table_name) LIKE '%recomp%'
            OR lower(table_name) LIKE '%membres%'
            OR lower(column_name) LIKE '%client%'
            OR lower(column_name) LIKE '%customer%'
            OR lower(column_name) LIKE '%fidel%'
            OR lower(column_name) LIKE '%loyal%'
            OR lower(column_name) LIKE '%punto%'
            OR lower(column_name) LIKE '%point%'
            OR lower(column_name) LIKE '%reward%'
            OR lower(column_name) LIKE '%recomp%'
            OR lower(column_name) LIKE '%membres%'
          )
      )
      SELECT
        event_object_schema AS schema_name,
        event_object_table AS table_name,
        trigger_name,
        action_timing,
        event_manipulation,
        action_statement
      FROM information_schema.triggers t
      JOIN candidate_tables ct
        ON ct.table_schema = t.event_object_schema
       AND ct.table_name = t.event_object_table
      ORDER BY
        event_object_schema,
        event_object_table,
        trigger_name,
        event_manipulation
      `
    );

    findings.triggers = triggers.rows;

    console.log(`TRIGGERS=${triggers.rowCount}`);
    console.table(triggers.rows);

    section("12. DATABASE DISCOVERY — SEQUENCES / IDENTITY");

    const sequences = await q(
      client,
      `
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.column_default,
        c.is_identity,
        c.identity_generation
      FROM information_schema.columns c
      WHERE
        c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND (
          lower(c.table_name) LIKE '%client%'
          OR lower(c.table_name) LIKE '%customer%'
          OR lower(c.table_name) LIKE '%fidel%'
          OR lower(c.table_name) LIKE '%loyal%'
          OR lower(c.table_name) LIKE '%punto%'
          OR lower(c.table_name) LIKE '%point%'
          OR lower(c.table_name) LIKE '%reward%'
          OR lower(c.table_name) LIKE '%recomp%'
          OR lower(c.table_name) LIKE '%membres%'
          OR lower(c.column_name) LIKE '%client%'
          OR lower(c.column_name) LIKE '%customer%'
          OR lower(c.column_name) LIKE '%fidel%'
          OR lower(c.column_name) LIKE '%loyal%'
          OR lower(c.column_name) LIKE '%punto%'
          OR lower(c.column_name) LIKE '%point%'
          OR lower(c.column_name) LIKE '%reward%'
          OR lower(c.column_name) LIKE '%recomp%'
          OR lower(c.column_name) LIKE '%membres%'
        )
        AND (
          c.column_default LIKE 'nextval(%'
          OR c.is_identity = 'YES'
        )
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `
    );

    findings.sequences = sequences.rows;

    console.log(`SEQUENCE_OR_IDENTITY_COLUMNS=${sequences.rowCount}`);
    console.table(sequences.rows);

    section("13. SALES / ORDER RELATIONSHIP HINTS");

    /*
     * Solo descubrimiento.
     * NO asumimos que pedidos/ventas tengan un nombre concreto.
     */
    const salesHints = await q(
      client,
      `
      SELECT
        table_schema,
        table_name,
        ordinal_position,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE
        table_schema NOT IN ('pg_catalog', 'information_schema')
        AND (
          lower(table_name) LIKE '%pedido%'
          OR lower(table_name) LIKE '%order%'
          OR lower(table_name) LIKE '%venta%'
          OR lower(table_name) LIKE '%sale%'
          OR lower(table_name) LIKE '%ticket%'
        )
        AND (
          lower(column_name) LIKE '%client%'
          OR lower(column_name) LIKE '%customer%'
          OR lower(column_name) LIKE '%fidel%'
          OR lower(column_name) LIKE '%loyal%'
          OR lower(column_name) LIKE '%punto%'
          OR lower(column_name) LIKE '%point%'
        )
      ORDER BY
        table_schema,
        table_name,
        ordinal_position
      `
    );

    console.log(`SALES_RELATION_HINTS=${salesHints.rowCount}`);
    console.table(salesHints.rows);

    section("14. READ-ONLY SAFETY VALIDATION");

    const safety = await q(
      client,
      `
      SELECT
        current_setting('transaction_read_only') AS transaction_read_only,
        current_setting('transaction_isolation') AS transaction_isolation,
        current_database() AS database_name,
        current_user AS database_user,
        now() AS checked_at
      `
    );

    console.table(safety.rows);

    /*
     * Siempre hacemos ROLLBACK incluso siendo READ ONLY.
     */
    await client.query("ROLLBACK");
    transactionStarted = false;

    console.log("\nROLLBACK=PASS");
    console.log("DATABASE_MUTATION=0");

  } catch (error) {
    findings.errors.push(error?.stack ?? String(error));

    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
        console.log("\nROLLBACK_AFTER_ERROR=PASS");
      } catch (rollbackError) {
        findings.errors.push(
          `ROLLBACK ERROR: ${rollbackError?.stack ?? rollbackError}`
        );
      }
    }

    throw error;
  } finally {
    try {
      await client.end();
    } catch {

      // no-op
    }}

  section("15. CLIENTES-001 PRECHECK SUMMARY");

  const sourceByType = {};

  for (const item of findings.sourceMatches) {
    sourceByType[item.type] =
    (sourceByType[item.type] ?? 0) + 1;
  }

  console.log(`CLIENTES_001_PRECHECK=PASS`);
  console.log(`MODE=READ_ONLY`);
  console.log(`DATABASE_CONNECTED=${findings.dbConnected ? "YES" : "NO"}`);
  console.log(`DATABASE=${safe(findings.dbName)}`);
  console.log(`DATABASE_USER=${safe(findings.dbUser)}`);

  console.log(
    `CANDIDATE_TABLES=${findings.candidateTables.length}`
  );
  console.log(
    `CANDIDATE_COLUMNS=${findings.candidateColumns.length}`
  );
  console.log(`CONSTRAINTS=${findings.constraints.length}`);
  console.log(`INDEXES=${findings.indexes.length}`);
  console.log(`FOREIGN_KEYS=${findings.foreignKeys.length}`);
  console.log(`TRIGGERS=${findings.triggers.length}`);
  console.log(
    `SEQUENCE_OR_IDENTITY_COLUMNS=${findings.sequences.length}`
  );

  console.log(
    `SOURCE_MATCHES=${findings.sourceMatches.length}`
  );
  console.log(
    `SOURCE_TYPES=${JSON.stringify(sourceByType)}`
  );

  console.log(
    `GIT_CLEAN=${findings.git.status ? "NO" : "YES"}`
  );
  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${
    findings.git.head === findings.git.originMain ? "YES" : "NO"}`

  );

  console.log(`DATABASE_MUTATION=0`);
  console.log(`ROLLBACK=PASS`);

  console.log("\nNEXT_STEP=ANALYZE_CLIENTES_001_OUTPUT");
  console.log(
    "DO_NOT_MODIFY_CODE_UNTIL_SCHEMA_AND_CONTRACT_ARE_CONFIRMED"
  );

  console.log("\n" + LINE);
  console.log("CLIENTES-001 PRECHECK COMPLETE");
  console.log(LINE);
}

main().catch((error) => {
  console.error("\n" + LINE);
  console.error("CLIENTES-001 PRECHECK FAILED");
  console.error(LINE);
  console.error(error?.stack ?? error);
  console.error("\nDATABASE_MUTATION=0_EXPECTED");
  process.exitCode = 1;
});
