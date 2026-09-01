import { brandText } from "../config/brand.js"; /**
 * Shiny — CLIENTES-001 SOURCE AUDIT
 *
 * MODE: READ ONLY
 *
 * Objetivo:
 *   Auditar código fuente relacionado con Clientes / Fidelidad
 *   antes de ejecutar cualquier CRUD.
 *
 * NO modifica:
 *   - DB
 *   - código funcional
 *   - configuración
 *
 * Analiza:
 *   clientsRepository
 *   clientAccountRepository
 *   benefitsRepository
 *   ordersRepository
 *   clients routes
 *   clientAccount routes
 *   benefits routes
 *   server mounts
 *   auth / permissions
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const LINE = "=".repeat(110);

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
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

const targets = [
"src/repositories/clientsRepository.js",
"src/repositories/clientAccountRepository.js",
"src/repositories/benefitsRepository.js",
"src/repositories/ordersRepository.js",

"src/routes/clients.js",
"src/routes/clientAccount.js",
"src/routes/benefits.js",

"src/middleware/auth.js",
"src/middleware/clientAuth.js",

"src/server.js"];


const patterns = [
["CLIENT INSERT", /INSERT\s+INTO\s+shiny\.clientes/gi],
["CLIENT UPDATE", /UPDATE\s+shiny\.clientes/gi],
["CLIENT DELETE", /DELETE\s+FROM\s+shiny\.clientes/gi],

["FIDELIDAD INSERT", /INSERT\s+INTO\s+shiny\.fidelidad_movimientos/gi],
["FIDELIDAD UPDATE", /UPDATE\s+shiny\.fidelidad_cuentas/gi],

["BEGIN", /\bBEGIN\b/gi],
["COMMIT", /\bCOMMIT\b/gi],
["ROLLBACK", /\bROLLBACK\b/gi],

["FOR UPDATE", /FOR\s+UPDATE/gi],

["ID CLIENTE", /\bid_cliente\b/gi],
["ID MOVIMIENTO", /\bid_movimiento\b/gi],
["ID PEDIDO", /\bid_pedido\b/gi],

["IDEMPOTENCY", /idempot/gi],

["LOYALTY", /loyalty/gi],
["PUNTOS", /puntos/gi],

["APPLY BENEFITS", /applyBenefitsTx/gi],
["CALCULATE BENEFITS", /calculateBenefitsTx/gi],
["ADJUST POINTS", /adjustClientPoints/gi],

["REVERSA", /reversa|reverse/gi],

["CLIENT_NOT_FOUND", /CLIENT_NOT_FOUND/gi],
["CLIENT_CREATE", /CLIENT_CREATE/gi],
["CLIENT_UPDATE", /CLIENT_UPDATE/gi],

["EMAIL DUPLICATE", /EMAIL.*ALREADY|EMAIL.*LINKED|duplicate.*email/gi],
["PHONE DUPLICATE", /PHONE.*ALREADY|PHONE.*LINKED|duplicate.*phone/gi],

["AUTH", /requireAuth|requireClientAuth|requireModule|requirePermission/gi]];


function extractFunctions(text) {
  const rows = [];

  const regexes = [
  /export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
  /export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
  /async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
  /function\s+([A-Za-z0-9_$]+)\s*\(/g];


  const seen = new Set();

  for (const regex of regexes) {
    let m;

    while (m = regex.exec(text)) {
      if (seen.has(m[1])) continue;

      seen.add(m[1]);

      const line =
      text.slice(0, m.index).split(/\r?\n/).length;

      rows.push({
        function: m[1],
        line
      });
    }
  }

  return rows.sort((a, b) => a.line - b.line);
}

function extractRoutes(text) {
  const rows = [];

  const regex =
  /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  let m;

  while (m = regex.exec(text)) {
    const line =
    text.slice(0, m.index).split(/\r?\n/).length;

    rows.push({
      method: m[1].toUpperCase(),
      path: m[2],
      line
    });
  }

  return rows;
}

function extractSql(text) {
  const rows = [];

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (
    /SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|FOR UPDATE/i.test(
      line
    ))
    {
      rows.push({
        line: i + 1,
        code: line.trim().slice(0, 300)
      });
    }
  }

  return rows;
}

function extractTransactions(text) {
  return {
    begin:
    (text.match(/\bBEGIN\b/gi) || []).length,

    commit:
    (text.match(/\bCOMMIT\b/gi) || []).length,

    rollback:
    (text.match(/\bROLLBACK\b/gi) || []).length,

    forUpdate:
    (text.match(/FOR\s+UPDATE/gi) || []).length
  };
}

function inspectFile(relative) {
  const file = path.join(ROOT, relative);

  if (!fs.existsSync(file)) {
    return {
      file: relative,
      exists: false
    };
  }

  const text = fs.readFileSync(file, "utf8");

  const signals = [];

  for (const [name, regex] of patterns) {
    const matches = text.match(regex);

    if (matches?.length) {
      signals.push({
        signal: name,
        count: matches.length
      });
    }
  }

  return {
    file: relative,
    exists: true,
    size: Buffer.byteLength(text),

    functions: extractFunctions(text),
    routes: extractRoutes(text),
    sql: extractSql(text),

    transactions: extractTransactions(text),

    signals
  };
}

function main() {
  section(brandText("GMX — CLIENTES-001 SOURCE AUDIT"));

  console.log("MODE=READ_ONLY");
  console.log(`ROOT=${ROOT}`);
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  section("1. GIT BASELINE");

  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const origin = git(["rev-parse", "origin/main"]);
  const status = git(["status", "--short"]);

  console.log(`BRANCH=${branch}`);
  console.log(`HEAD=${head}`);
  console.log(`ORIGIN_MAIN=${origin}`);
  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${head === origin ? "YES" : "NO"}`
  );
  console.log(
    `GIT_CLEAN=${status ? "NO" : "YES"}`
  );

  const inspected = targets.map(inspectFile);

  section("2. TARGET FILE INVENTORY");

  console.table(
    inspected.map((x) => ({
      file: x.file,
      exists: x.exists,
      size: x.size || 0
    }))
  );

  for (const item of inspected) {
    if (!item.exists) continue;

    section(`SOURCE — ${item.file}`);

    console.log("\nFUNCTIONS:");

    if (item.functions.length) {
      console.table(item.functions);
    } else {
      console.log("(none)");
    }

    console.log("\nROUTES:");

    if (item.routes.length) {
      console.table(item.routes);
    } else {
      console.log("(none)");
    }

    console.log("\nTRANSACTION SIGNALS:");

    console.table([
    item.transactions]
    );

    console.log("\nSOURCE SIGNALS:");

    if (item.signals.length) {
      console.table(item.signals);
    } else {
      console.log("(none)");
    }

    console.log("\nSQL / TRANSACTION LINES:");

    if (item.sql.length) {
      console.table(item.sql.slice(0, 300));
    } else {
      console.log("(none)");
    }
  }

  section("3. CRUD CONTRACT SIGNALS");

  const clientsRepo =
  inspected.find(
    (x) =>
    x.file ===
    "src/repositories/clientsRepository.js"
  );

  const crudFunctions =
  clientsRepo?.functions || [];

  console.table(crudFunctions);

  section("4. LOYALTY CONTRACT SIGNALS");

  const benefits =
  inspected.find(
    (x) =>
    x.file ===
    "src/repositories/benefitsRepository.js"
  );

  console.table(
    benefits?.functions || []
  );

  section("5. ORDER / LOYALTY INTEGRATION SIGNALS");

  const orders =
  inspected.find(
    (x) =>
    x.file ===
    "src/repositories/ordersRepository.js"
  );

  console.table(
    orders?.signals || []
  );

  section("6. ROUTE CONTRACT");

  for (const x of inspected.filter(
    (x) => x.file.includes("src/routes/")
  )) {
    console.log(`\n${x.file}`);

    console.table(
      x.routes || []
    );
  }

  section("7. SECURITY / AUTH SIGNALS");

  for (const x of inspected.filter(
    (x) =>
    x.file.includes("middleware") ||
    x.file.endsWith("server.js")
  )) {
    console.log(`\n${x.file}`);

    console.table(
      x.signals || []
    );
  }

  section("8. RISK FLAGS");

  const missing = inspected.filter(
    (x) => !x.exists
  );

  const transactionFiles =
  inspected.filter(
    (x) =>
    x.exists && (

    x.transactions.begin > 0 ||
    x.transactions.commit > 0 ||
    x.transactions.rollback > 0)

  );

  const mutationFiles =
  inspected.filter(
    (x) =>
    x.exists &&
    x.signals?.some(
      (s) =>
      [
      "CLIENT INSERT",
      "CLIENT UPDATE",
      "CLIENT DELETE",
      "FIDELIDAD INSERT",
      "FIDELIDAD UPDATE"].
      includes(s.signal)
    )
  );

  console.log(
    `MISSING_TARGET_FILES=${missing.length}`
  );

  console.log(
    `TRANSACTION_FILES=${transactionFiles.length}`
  );

  console.log(
    `MUTATION_FILES=${mutationFiles.length}`
  );

  console.log("\nFILES WITH MUTATION LOGIC:");

  console.table(
    mutationFiles.map((x) => ({
      file: x.file
    }))
  );

  section("9. FINAL SUMMARY");

  console.log("CLIENTES_001_SOURCE_AUDIT=PASS");
  console.log("MODE=READ_ONLY");
  console.log("DATABASE_CONNECTION=NOT_USED");
  console.log("DATABASE_MUTATION=0");

  console.log(
    `TARGET_FILES=${targets.length}`
  );

  console.log(
    `FILES_FOUND=${
    inspected.filter((x) => x.exists).length}`

  );

  console.log(
    `FILES_MISSING=${missing.length}`
  );

  console.log(
    `MUTATION_FILES=${mutationFiles.length}`
  );

  console.log(
    `TRANSACTION_FILES=${transactionFiles.length}`
  );

  console.log(
    `HEAD_EQ_ORIGIN_MAIN=${
    head === origin ? "YES" : "NO"}`

  );

  console.log(
    "NEXT_STEP=ANALYZE_SOURCE_BEFORE_CRUD"
  );

  console.log(
    "CRUD_NOT_EXECUTED"
  );

  console.log(
    "NO_CODE_CHANGE_APPLIED"
  );

  section("CLIENTES-001 SOURCE AUDIT COMPLETE");
}

main();
