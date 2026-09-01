import { brandText } from "../config/brand.js";import fs from "node:fs";
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

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

function linesContaining(text, patterns) {
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      out.push({
        line: i + 1,
        code: lines[i].trim().slice(0, 500)
      });
    }
  }

  return out;
}

const files = {
  clientsRoute: "src/routes/clients.js",
  clientsRepo: "src/repositories/clientsRepository.js",
  server: "src/server.js",
  auth: "src/middleware/auth.js"
};

section(brandText("GMX — CLIENTES-001 CRUD PRECHECK"));

console.log("MODE=READ_ONLY");
console.log("DATABASE_CONNECTION=NOT_USED");
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
console.log(`HEAD_EQ_ORIGIN_MAIN=${head === origin ? "YES" : "NO"}`);
console.log(`GIT_CLEAN=${status ? "NO" : "YES"}`);

section("2. CLIENT ROUTE — FULL CONTRACT");

const routeText = read(files.clientsRoute);

if (!routeText) {
  throw new Error("CLIENTS_ROUTE_NOT_FOUND");
}

console.log(routeText);

section("3. CLIENT REPOSITORY — FULL CONTRACT");

const repoText = read(files.clientsRepo);

if (!repoText) {
  throw new Error("CLIENTS_REPOSITORY_NOT_FOUND");
}

console.log(repoText);

section("4. SERVER — CLIENT MOUNT / AUTH");

const serverText = read(files.server);

console.table(
  linesContaining(serverText, [
  /clients/i,
  /requireAuth/i,
  /requireModule/i,
  /requirePermission/i,
  /app\.use/i]
  )
);

section("5. AUTH — MODULE / PERMISSION CONTRACT");

const authText = read(files.auth);

console.table(
  linesContaining(authText, [
  /clientes/i,
  /requireAuth/i,
  /requireModule/i,
  /requirePermission/i,
  /roleDefaults/i,
  /ACTIONS/i]
  )
);

section("6. ROUTE VALIDATION SIGNALS");

console.table(
  linesContaining(routeText, [
  /normalize/i,
  /required/i,
  /email/i,
  /telefono/i,
  /nombre/i,
  /status\(/i,
  /CLIENT_/i,
  /createClient/i,
  /updateClient/i,
  /deleteClient/i]
  )
);

section("7. REPOSITORY MUTATION SIGNALS");

console.table(
  linesContaining(repoText, [
  /INSERT INTO shiny\.clientes/i,
  /UPDATE shiny\.clientes/i,
  /DELETE FROM shiny\.clientes/i,
  /RETURNING/i,
  /email/i,
  /telefono/i,
  /id_cliente/i]
  )
);

section("8. ENV / SERVER START SIGNALS");

const packageText = read("package.json");

if (packageText) {
  try {
    const pkg = JSON.parse(packageText);

    console.log("PACKAGE_SCRIPTS=");
    console.log(
      JSON.stringify(pkg.scripts || {}, null, 2)
    );
  } catch {
    console.log("PACKAGE_JSON_PARSE=FAILED");
  }
}

console.log(`PORT_ENV=${process.env.PORT || "(not set in current shell)"}`);

section("9. PROPOSED TEST IDENTITY");

const stamp = Date.now();

const proposed = {
  nombre: `CLIENTES001 TEST ${stamp}`,
  telefono: `TEST-${String(stamp).slice(-8)}`,
  email: `clientes001.${stamp}@example.invalid`,
  direccion: "CLIENTES-001 AUTOMATED TEST",
  ciudad: "TEST",
  estado: "TEST",
  cp: "00000",
  pais: "MX"
};

console.log(JSON.stringify(proposed, null, 2));

console.log("");
console.log("IMPORTANT=IDENTITY_NOT_INSERTED");

section("10. SAFETY DECISION");

const required = [
files.clientsRoute,
files.clientsRepo,
files.server,
files.auth];


const missing = required.filter(
  (f) => !fs.existsSync(path.join(ROOT, f))
);

console.log(`REQUIRED_FILES=${required.length}`);
console.log(`MISSING_FILES=${missing.length}`);

if (missing.length) {
  console.log(`MISSING=${missing.join(",")}`);
}

console.log(`HEAD_EQ_ORIGIN_MAIN=${head === origin ? "YES" : "NO"}`);
console.log("DATABASE_MUTATION=0");
console.log("HTTP_MUTATION=0");
console.log("CRUD_NOT_EXECUTED");

section("11. FINAL SUMMARY");

if (missing.length === 0 && head === origin) {
  console.log("CLIENTES_001_CRUD_PRECHECK=PASS");
  console.log("READY_FOR_CONTROLLED_CRUD_DESIGN=YES");
} else {
  console.log("CLIENTES_001_CRUD_PRECHECK=REVIEW");
  console.log("READY_FOR_CONTROLLED_CRUD_DESIGN=NO");
}

console.log("NEXT_STEP=BUILD_CONTROLLED_CRUD_SMOKE");
console.log("NO_TEST_CLIENT_CREATED");
console.log("NO_CODE_CHANGE_APPLIED");

section("CLIENTES-001 CRUD PRECHECK COMPLETE");
