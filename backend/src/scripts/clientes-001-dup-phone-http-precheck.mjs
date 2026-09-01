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
    return `ERROR:${e.message}`;
  }
}

function read(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) {
    throw new Error(`FILE_NOT_FOUND:${rel}`);
  }

  return fs.readFileSync(full, "utf8");
}

function numbered(text) {
  return text.
  split(/\r?\n/).
  map(
    (line, index) =>
    `${String(index + 1).padStart(5, " ")} | ${line}`
  ).
  join("\n");
}

function contexts(text, patterns, radius = 12) {
  const lines = text.split(/\r?\n/);
  const ranges = [];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      ranges.push([
      Math.max(0, i - radius),
      Math.min(lines.length - 1, i + radius)]
      );
    }
  }

  if (!ranges.length) return [];

  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [];

  for (const range of ranges) {
    const previous = merged.at(-1);

    if (
    previous &&
    range[0] <= previous[1] + 1)
    {
      previous[1] = Math.max(
        previous[1],
        range[1]
      );
    } else {
      merged.push([...range]);
    }
  }

  return merged.map(([start, end]) => ({
    start: start + 1,
    end: end + 1,
    text: lines.
    slice(start, end + 1).
    map(
      (line, offset) =>
      `${String(start + offset + 1).padStart(5, " ")} | ${line}`
    ).
    join("\n")
  }));
}

const files = [
"src/repositories/clientsRepository.js",
"src/routes/clients.js",
"src/server.js"];


section(brandText("GMX — CLIENTES-001 DUPLICATE PHONE HTTP PRECHECK")

);

console.log("MODE=READ_ONLY");
console.log("DATABASE_CONNECTION=NOT_USED");
console.log("HTTP_REQUESTS=0");
console.log("DATABASE_MUTATION=0");

section("1. GIT BASELINE");

const branch = git([
"branch",
"--show-current"]
);

const head = git([
"rev-parse",
"HEAD"]
);

const origin = git([
"rev-parse",
"origin/main"]
);

const status = git([
"status",
"--short"]
);

console.log(`BRANCH=${branch}`);
console.log(`HEAD=${head}`);
console.log(`ORIGIN_MAIN=${origin}`);

console.log(
  `HEAD_EQ_ORIGIN_MAIN=${
  head === origin ? "YES" : "NO"}`

);

console.log(
  `GIT_CLEAN=${
  status ? "NO" : "YES"}`

);

section("2. TARGET FILES");

for (const rel of files) {
  const full = path.join(ROOT, rel);

  console.log(
    `${rel}=${fs.existsSync(full) ? "FOUND" : "MISSING"}`
  );
}

section(
  "3. CLIENTS REPOSITORY — ERROR HANDLING"
);

const repo = read(
  "src/repositories/clientsRepository.js"
);

const repoContexts = contexts(
  repo,
  [
  /23505/i,
  /unique/i,
  /duplicate/i,
  /telefono/i,
  /telefono_normalizado/i,
  /CLIENT_PHONE_ALREADY_LINKED/i,
  /CLIENT_EMAIL_ALREADY_LINKED/i,
  /catch\s*\(/i,
  /throw/i,
  /createClient/i,
  /updateClient/i],

  16
);

if (!repoContexts.length) {
  console.log("(no matching contexts)");
} else {
  for (const c of repoContexts) {
    console.log(
      `\n--- lines ${c.start}-${c.end} ---`
    );
    console.log(c.text);
  }
}

section(
  "4. CLIENT ROUTE — ERROR MAPPING"
);

const route = read(
  "src/routes/clients.js"
);

const routeContexts = contexts(
  route,
  [
  /23505/i,
  /CLIENT_PHONE_ALREADY_LINKED/i,
  /CLIENT_EMAIL_ALREADY_LINKED/i,
  /PHONE/i,
  /EMAIL/i,
  /catch\s*\(/i,
  /next\s*\(/i,
  /res\.status/i,
  /createClient/i,
  /updateClient/i],

  16
);

if (!routeContexts.length) {
  console.log("(no matching contexts)");
} else {
  for (const c of routeContexts) {
    console.log(
      `\n--- lines ${c.start}-${c.end} ---`
    );
    console.log(c.text);
  }
}

section(
  "5. SERVER — GLOBAL ERROR HANDLING"
);

const server = read(
  "src/server.js"
);

const serverContexts = contexts(
  server,
  [
  /uncaughtException/i,
  /unhandledRejection/i,
  /process\.on/i,
  /error/i,
  /err/i,
  /app\.use/i,
  /res\.status\(500/i],

  12
);

if (!serverContexts.length) {
  console.log("(no matching contexts)");
} else {
  for (const c of serverContexts) {
    console.log(
      `\n--- lines ${c.start}-${c.end} ---`
    );
    console.log(c.text);
  }
}

section(
  "6. EXACT ERROR CONTRACT SEARCH"
);

const combined = [
["clientsRepository.js", repo],
["clients.js", route],
["server.js", server]];


const signals = [
"23505",
"CLIENT_PHONE_ALREADY_LINKED",
"CLIENT_EMAIL_ALREADY_LINKED",
"uq_clientes_telefono_normalizado",
"uq_clientes_email_normalizado"];


for (const signal of signals) {
  console.log(`\nSIGNAL=${signal}`);

  let total = 0;

  for (const [name, text] of combined) {
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (
      lines[i].
      toLowerCase().
      includes(signal.toLowerCase()))
      {
        total++;

        console.log(
          `${name}:${i + 1}: ${lines[i].trim()}`
        );
      }
    }
  }

  console.log(`MATCHES=${total}`);
}

section(
  "7. FULL CLIENT REPOSITORY"
);

console.log(numbered(repo));

section(
  "8. FULL CLIENT ROUTE"
);

console.log(numbered(route));

section(
  "9. FINAL SUMMARY"
);

console.log(
  "CLIENTES_001_DUP_PHONE_HTTP_PRECHECK=PASS"
);

console.log(
  "MODE=READ_ONLY"
);

console.log(
  "DATABASE_CONNECTION=NOT_USED"
);

console.log(
  "HTTP_REQUESTS=0"
);

console.log(
  "DATABASE_MUTATION=0"
);

console.log(
  "TEST_RESIDUE=0"
);

console.log(
  `HEAD_EQ_ORIGIN_MAIN=${
  head === origin ? "YES" : "NO"}`

);

console.log(
  "NEXT_STEP=ANALYZE_HTTP_ERROR_MAPPING"
);

section(
  "CLIENTES-001 DUPLICATE PHONE HTTP PRECHECK COMPLETE"
);
