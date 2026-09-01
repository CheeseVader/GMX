import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const SCRIPTS = path.join(ROOT, "src", "scripts");

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

for (const file of [
".env",
".env.local",
".env.development",
".env.dev"])
{
  loadEnv(path.join(ROOT, file));
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

function findScriptByMarker(marker, filenamePrefix = "") {
  const currentFile =
  path.resolve(__filename);

  const files = fs.readdirSync(SCRIPTS).
  filter((name) => /\.mjs$/i.test(name)).
  filter((name) => {
    if (!filenamePrefix) return true;

    return name.
    toLowerCase().
    startsWith(
      filenamePrefix.toLowerCase()
    );
  });

  const hits = [];

  for (const name of files) {
    const full =
    path.resolve(
      path.join(SCRIPTS, name)
    );

    /*
     * Nunca permitir que el orquestador se seleccione
     * a sí mismo.
     */
    if (full === currentFile) {
      continue;
    }

    let text;

    try {
      text =
      fs.readFileSync(
        full,
        "utf8"
      );
    } catch {
      continue;
    }

    if (text.includes(marker)) {
      hits.push(full);
    }
  }

  if (hits.length === 0) {
    throw new Error(
      `SCRIPT_NOT_FOUND_FOR_MARKER:${marker}:PREFIX:${filenamePrefix}`
    );
  }

  hits.sort(
    (a, b) =>
    path.basename(a).length -
    path.basename(b).length
  );

  if (hits.length > 1) {
    console.log(
      `DISCOVERY_MULTIPLE_MATCHES_${filenamePrefix}=${hits.length}`
    );

    console.log(
      hits.
      map((x) => path.basename(x)).
      join(",")
    );
  }

  return hits[0];
}

function runNodeScript({
  name,
  script,
  requiredMarkers
}) {
  section(`RUN — ${name}`);

  console.log(
    `SCRIPT=${path.relative(ROOT, script).replaceAll("\\", "/")}`
  );

  const result = spawnSync(
    process.execPath,
    [script],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: false
    }
  );

  const stdout =
  result.stdout || "";

  const stderr =
  result.stderr || "";

  if (stdout) {
    console.log(stdout.trimEnd());
  }

  if (stderr) {
    console.error(stderr.trimEnd());
  }

  console.log(
    `CHILD_EXIT_CODE=${result.status}`
  );

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(
      `${name}_SIGNAL_${result.signal}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${name}_EXIT_${result.status}`
    );
  }

  for (const marker of requiredMarkers) {
    if (!stdout.includes(marker)) {
      throw new Error(
        `${name}_MISSING_MARKER:${marker}`
      );
    }
  }

  console.log(
    `${name}=PASS`
  );

  return stdout;
}

async function residueSnapshot(db) {
  const r = await db.query(`
    SELECT

      (
        SELECT COUNT(*)
        FROM gmx.clientes
        WHERE
          nombre ILIKE '%CLIENTES001%'
          OR nombre ILIKE '%LOYALTY00%'
          OR email LIKE 'clientes001.%@example.invalid'
          OR email LIKE 'clientes.loyalty%@example.invalid'
      )::bigint AS clientes,

      (
        SELECT COUNT(*)
        FROM gmx.pedidos
        WHERE
          pos_idempotency_key LIKE 'LOYALTY007-%'
          OR id_pedido LIKE 'PED-LOYALTY%'
      )::bigint AS pedidos,

      (
        SELECT COUNT(*)
        FROM gmx.fidelidad_movimientos
        WHERE
          id_admin LIKE 'TEST-LOYALTY%'
          OR motivo LIKE 'LOYALTY00%'
          OR referencia LIKE 'LOYALTY00%'
      )::bigint AS movimientos,

      (
        SELECT COUNT(*)
        FROM gmx.fidelidad_cuentas fc
        WHERE EXISTS (
          SELECT 1
          FROM gmx.clientes c
          WHERE
            c.id_cliente=fc.id_cliente
            AND (
              c.nombre ILIKE '%LOYALTY00%'
              OR
              c.email LIKE
                'clientes.loyalty%@example.invalid'
            )
        )
      )::bigint AS cuentas
  `);

  const row = r.rows[0];

  const total =
  Object.values(row).
  reduce(
    (sum, value) =>
    sum + Number(value || 0),
    0
  );

  return {
    ...row,
    total
  };
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-011 FINAL CONSOLIDATED SMOKE")

  );

  console.log(
    `TIMESTAMP=${new Date().toISOString()}`
  );

  console.log(
    "TEST_SCOPE=CLIENTES_LOYALTY_FINAL"
  );

  console.log(
    "PRODUCTION_CODE_MUTATION_ALLOWED=NO"
  );

  console.log(
    "REAL_FINANCIAL_PROVIDER_CALLS=NO"
  );

  /*
   * =========================================================
   * 1. DISCOVER CERTIFIED SCRIPTS
   * =========================================================
   */

  section("1. CERTIFIED SMOKE DISCOVERY");

  const balanceScript =
  findScriptByMarker(
    "CLIENTES_LOYALTY_003_BALANCE_SMOKE=PASS",
    "clientes-loyalty-003"
  );

  const idemScript =
  path.join(
    SCRIPTS,
    "clientes-loyalty-007-pos-idempotency-smoke.mjs"
  );

  const relationsScript =
  path.join(
    SCRIPTS,
    "clientes-loyalty-008-sales-relations-precheck.mjs"
  );

  const auditScript =
  path.join(
    SCRIPTS,
    "clientes-loyalty-009-audit-precheck.mjs"
  );

  const precheckScript =
  path.join(
    SCRIPTS,
    "clientes-loyalty-010-final-smoke-precheck.mjs"
  );

  for (const script of [
  balanceScript,
  idemScript,
  relationsScript,
  auditScript,
  precheckScript])
  {
    if (!fs.existsSync(script)) {
      throw new Error(
        `REQUIRED_SCRIPT_MISSING:${script}`
      );
    }

    console.log(
      `FOUND=${path.relative(ROOT, script).replaceAll("\\", "/")}`
    );
  }

  /*
   * =========================================================
   * 2. BASELINE RESIDUE
   * =========================================================
   */

  section("2. BASELINE TEST RESIDUE");

  const db =
  new Client(dbConfig());

  await db.connect();

  try {
    const before =
    await residueSnapshot(db);

    console.table([before]);

    console.log(
      `TEST_RESIDUE_BEFORE=${before.total}`
    );

    if (before.total !== 0) {
      throw new Error(
        "FINAL_SMOKE_BASELINE_RESIDUE_NOT_ZERO"
      );
    }

  } finally {
    await db.end();
  }

  /*
   * =========================================================
   * 3. MOVEMENTS / BALANCES
   * =========================================================
   */

  runNodeScript({
    name:
    "FINAL_BALANCE_SMOKE",

    script:
    balanceScript,

    requiredMarkers: [
    "CLIENTES_LOYALTY_003_BALANCE_SMOKE=PASS",
    "MOVEMENT_ARITHMETIC=PASS",
    "BALANCE_CHAIN=PASS",
    "GET_CLIENT_LOYALTY=PASS",
    "TEST_RESIDUE_CLIENTES=0",
    "TEST_RESIDUE_MOVIMIENTOS=0",
    "FINANCIAL_MUTATION=0"]

  });

  /*
   * =========================================================
   * 4. POS IDEMPOTENCY
   * =========================================================
   */

  runNodeScript({
    name:
    "FINAL_POS_IDEMPOTENCY_SMOKE",

    script:
    idemScript,

    requiredMarkers: [
    "CLIENTES_LOYALTY_007_POS_IDEMPOTENCY_SMOKE=PASS",
    "FIRST_SALE=PASS",
    "IDEMPOTENT_REUSE=PASS",
    "SAME_ORDER_REUSED=PASS",
    "ORDER_COUNT_IDEMPOTENCY=PASS",
    "LOYALTY_MOVEMENT_IDEMPOTENCY=PASS",
    "INVENTORY_IDEMPOTENCY=PASS",
    "PAYMENT_IDEMPOTENCY=PASS",
    "CASH_IDEMPOTENCY=PASS",
    "SALE_CANCEL_CLEANUP=PASS",
    "TEST_RESIDUE_TOTAL=0"]

  });

  /*
   * =========================================================
   * 5. SALES RELATIONS
   * =========================================================
   */

  runNodeScript({
    name:
    "FINAL_SALES_RELATIONS_AUDIT",

    script:
    relationsScript,

    requiredMarkers: [
    "CLIENTES_LOYALTY_008_SALES_RELATIONS_PRECHECK=PASS",
    "ORDERS_WITH_MISSING_CLIENT=0",
    "MOVEMENTS_WITH_MISSING_CLIENT=0",
    "MOVEMENTS_WITH_MISSING_ORDER=0",
    "ORDER_MOVEMENT_CLIENT_MISMATCH=0",
    "ORDER_LEDGER_MISMATCH=0",
    "GENERATION_ON_NON_PAID_SALES=0",
    "CANCELLED_WITH_UNREVERSED_LOYALTY=0",
    "LOYALTY_ACCOUNT_ORPHANS=0",
    "ACCOUNT_LEDGER_BALANCE_MISMATCH=0",
    "TEST_RESIDUE=0",
    "ROLLBACK=PASS"]

  });

  /*
   * =========================================================
   * 6. AUDIT
   * =========================================================
   */

  runNodeScript({
    name:
    "FINAL_LOYALTY_AUDIT",

    script:
    auditScript,

    requiredMarkers: [
    "CLIENTES_LOYALTY_009_AUDIT_PRECHECK=PASS",
    "UNEXPECTED_MOVEMENT_TYPES=0",
    "MOVEMENTS_WITHOUT_ID=0",
    "DUPLICATE_MOVEMENT_IDS=0",
    "MOVEMENTS_WITHOUT_CLIENT=0",
    "MOVEMENTS_WITHOUT_DATE=0",
    "MOVEMENTS_WITH_INCOMPLETE_ACTOR=0",
    "ADJUSTMENTS_WITHOUT_REASON=0",
    "ADJUSTMENTS_WITHOUT_REFERENCE=0",
    "SALES_MOVEMENTS_WITHOUT_ORDER=0",
    "REVERSALS_WITHOUT_REVERSA_DE=0",
    "INVALID_REVERSA_DE_TARGET=0",
    "DUPLICATE_REVERSAL_TARGETS=0",
    "MOVEMENT_ARITHMETIC_ERRORS=0",
    "BROKEN_BALANCE_CHAIN=0",
    "CLIENT_TIMESTAMP_ERRORS=0",
    "TEST_RESIDUE=0",
    "ROLLBACK=PASS"]

  });

  /*
   * =========================================================
   * 7. FINAL PRECHECK RERUN
   * =========================================================
   */

  runNodeScript({
    name:
    "FINAL_READ_ONLY_PRECHECK",

    script:
    precheckScript,

    requiredMarkers: [
    "CLIENTES_LOYALTY_010_FINAL_SMOKE_PRECHECK=PASS",
    "PRECHECK_FAILURE_COUNT=0",
    "TEST_RESIDUE_TOTAL=0",
    "FINAL_SMOKE_READY=YES",
    "ROLLBACK=PASS"]

  });

  /*
   * =========================================================
   * 8. FINAL DATABASE RESIDUE
   * =========================================================
   */

  section("8. FINAL TEST RESIDUE");

  const dbFinal =
  new Client(dbConfig());

  await dbFinal.connect();

  try {
    const after =
    await residueSnapshot(
      dbFinal
    );

    console.table([after]);

    console.log(
      `TEST_RESIDUE_AFTER=${after.total}`
    );

    if (after.total !== 0) {
      throw new Error(
        "FINAL_SMOKE_TEST_RESIDUE_NOT_ZERO"
      );
    }

  } finally {
    await dbFinal.end();
  }

  /*
   * =========================================================
   * 9. FINAL SUMMARY
   * =========================================================
   */

  section("9. FINAL SUMMARY");

  console.log(
    "CLIENTES_LOYALTY_011_FINAL_SMOKE=PASS"
  );

  /*
   * CRUD fue certificado previamente en CLIENTES-001.
   * No repetimos aquí una mutación API adicional innecesaria.
   */
  console.log(
    "CLIENT_CRUD=PRIOR_CERTIFIED"
  );

  console.log(
    "LOYALTY_MOVEMENTS_BALANCES=PASS"
  );

  console.log(
    "POS_IDEMPOTENCY=PASS"
  );

  console.log(
    "SALES_RELATIONS=PASS"
  );

  console.log(
    "AUDIT=PASS"
  );

  console.log(
    "FINAL_PRECHECK_RERUN=PASS"
  );

  console.log(
    "TEST_RESIDUE_BEFORE=0"
  );

  console.log(
    "TEST_RESIDUE_AFTER=0"
  );

  console.log(
    "REAL_FINANCIAL_PROVIDER_CALLS=0"
  );

  console.log(
    "FINAL_SMOKE_STATUS=PASS"
  );

  console.log(
    "NEXT_STEP=CLIENTES_LOYALTY_012_CLEANUP_RERUN_CERTIFICATION"
  );

  /*
   * ordersRepository mantiene pool/handles.
   * Salimos explícitamente DESPUÉS del summary y cleanup.
   */
  process.exit(0);
}

main().catch((e) => {
  section(
    "CLIENTES-LOYALTY-011 FINAL SMOKE FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exit(1);
});
