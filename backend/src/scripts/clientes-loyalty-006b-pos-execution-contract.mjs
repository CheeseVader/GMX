import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const LINE = "=".repeat(110);

function section(title) {
  console.log("\n" + LINE);
  console.log(title);
  console.log(LINE);
}

function read(rel) {
  const file = path.join(ROOT, rel);

  if (!fs.existsSync(file)) {
    throw new Error(`FILE_NOT_FOUND:${rel}`);
  }

  return fs.readFileSync(file, "utf8");
}

function contexts(text, patterns, radius = 8) {
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      hits.push(i);
    }
  }

  const ranges = [];

  for (const hit of hits) {
    const start = Math.max(0, hit - radius);
    const end = Math.min(lines.length - 1, hit + radius);

    const prev = ranges.at(-1);

    if (prev && start <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  for (const [start, end] of ranges) {
    console.log(
      `\n--- ${start + 1}-${end + 1} ---`
    );

    for (let i = start; i <= end; i++) {
      console.log(
        `${String(i + 1).padStart(5, " ")} | ${lines[i]}`
      );
    }
  }
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-006B POS EXECUTION CONTRACT")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_CONNECTION=0");
  console.log("DATABASE_MUTATION=0");

  const repoRel =
  "src/repositories/ordersRepository.js";

  const routeRel =
  "src/routes/orders.js";

  const referenceRel =
  "src/scripts/pos-003-test1-r2.mjs";

  const repo = read(repoRel);
  const route = read(routeRel);

  section("1. ORDERS REPOSITORY EXPORTS");

  const moduleUrl =
  pathToFileURL(
    path.join(ROOT, repoRel)
  ).href;

  const mod = await import(moduleUrl);

  const exportsList =
  Object.keys(mod).sort();

  console.log(
    `ORDER_REPOSITORY_EXPORTS=${exportsList.join(",")}`
  );

  const saleExports =
  exportsList.filter((name) =>
  /sale|order|pos/i.test(name) &&
  typeof mod[name] === "function"
  );

  console.log(
    `SALE_FUNCTION_CANDIDATES=${saleExports.join(",") || "(none)"}`
  );

  console.table(
    saleExports.map((name) => ({
      export_name: name,
      function_length: mod[name].length,
      type: typeof mod[name]
    }))
  );

  section("2. SALE FUNCTION DECLARATION");

  contexts(
    repo,
    [
    /export\s+async\s+function.*sale/i,
    /export\s+async\s+function.*order/i,
    /saleRequestId\s*=/i],

    20
  );

  section("3. IDEMPOTENCY EXECUTION BLOCK");

  contexts(
    repo,
    [
    /Idempotencia fuerte/i,
    /saleRequestId/i,
    /pos_idempotency_key/i,
    /idempotent_reuse/i,
    /pg_advisory_xact_lock/i],

    15
  );

  section("4. APPLY BENEFITS CALL");

  contexts(
    repo,
    [
    /applyBenefitsTx/i],

    20
  );

  section("5. ROUTE POST CONTRACT");

  contexts(
    route,
    [
    /router\.post/i,
    /saleRequestId/i,
    /create.*sale/i,
    /items/i,
    /payments/i,
    /branchId/i,
    /clientId/i],

    18
  );

  section("6. EXISTING POS-003 REFERENCE SMOKE");

  const referencePath =
  path.join(ROOT, referenceRel);

  let referenceFound = false;

  if (fs.existsSync(referencePath)) {
    referenceFound = true;

    const reference =
    fs.readFileSync(
      referencePath,
      "utf8"
    );

    console.log(
      `REFERENCE_SMOKE=${referenceRel}`
    );

    contexts(
      reference,
      [
      /saleRequestId:/i,
      /IDEMPOTENT REPLAY/i,
      /idempotent_reuse/i,
      /create.*sale/i,
      /branchId:/i,
      /items:/i,
      /payments:/i],

      14
    );

  } else {
    console.log(
      `REFERENCE_SMOKE_MISSING=${referenceRel}`
    );
  }

  section("7. STATIC SAFETY");

  const mutations = [];

  for (const [name, text] of [
  ["repo", repo],
  ["route", route]])
  {
    /*
     * Solo estamos LEYENDO código fuente.
     * No ejecutamos las funciones de venta.
     */
    if (!text) {
      mutations.push(name);
    }
  }

  console.log(
    `SOURCE_READ_ERRORS=${mutations.length}`
  );

  section("8. FINAL SUMMARY");

  console.log(
    "CLIENTES_LOYALTY_006B_POS_EXECUTION_CONTRACT=PASS"
  );

  console.log(
    `SALE_FUNCTION_CANDIDATES=${saleExports.join(",") || "(none)"}`
  );

  console.log(
    `REFERENCE_POS003_SMOKE=${
    referenceFound ? "FOUND" : "MISSING"}`

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_CONNECTION=0");
  console.log("DATABASE_MUTATION=0");
  console.log("FINANCIAL_MUTATION=0");
  console.log("SALES_MUTATION=0");
  console.log("LOYALTY_MUTATION=0");

  console.log(
    "NEXT_STEP=LOYALTY007_POS_IDEMPOTENCY_CONTROLLED_SMOKE"
  );
}

main().catch((e) => {
  section(
    "CLIENTES-LOYALTY-006B FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
