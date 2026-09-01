import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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

const rel =
"src/repositories/ordersRepository.js";

const file =
path.join(ROOT, rel);

if (!fs.existsSync(file)) {
  throw new Error(
    `FILE_NOT_FOUND:${rel}`
  );
}

const text =
fs.readFileSync(file, "utf8");

const lines =
text.split(/\r?\n/);

function printRange(start, end) {
  const from =
  Math.max(1, start);

  const to =
  Math.min(
    lines.length,
    end
  );

  for (
  let line = from;
  line <= to;
  line++)
  {
    console.log(
      `${String(line).padStart(5, " ")} | ${
      lines[line - 1]}`

    );
  }
}

function printAround(
pattern,
before = 25,
after = 35)
{
  const index =
  lines.findIndex((line) =>
  pattern.test(line)
  );

  if (index < 0) {
    console.log(
      `PATTERN_NOT_FOUND=${pattern}`
    );

    return null;
  }

  const line =
  index + 1;

  console.log(
    `MATCH_LINE=${line}`
  );

  printRange(
    line - before,
    line + after
  );

  return line;
}

section(brandText("GMX — LOYALTY-007 PAYMENT CONTRACT PRECHECK")

);

console.log("MODE=READ_ONLY");
console.log("DATABASE_CONNECTION=0");
console.log("HTTP_REQUESTS=0");
console.log("DATABASE_MUTATION=0");

section(
  "1. CREATE SALE FUNCTION SIGNATURE"
);

printAround(
  /export\s+async\s+function\s+createSale/,
  3,
  35
);

section(
  "2. RAW PAYMENT NORMALIZATION"
);

printAround(
  /const\s+rawPayments\s*=/,
  10,
  55
);

section(
  "3. EXACT INVALID_PAYMENT_AMOUNT"
);

const errorLine =
printAround(
  /INVALID_PAYMENT_AMOUNT/,
  45,
  45
);

section(
  "4. NORMALIZED PAYMENTS"
);

printAround(
  /normalizedPayments/,
  45,
  45
);

section(
  "5. PAYMENT TOTAL / SALE TOTAL VALIDATION"
);

const paymentPatterns = [
/paymentTotal/i,
/paymentsTotal/i,
/paidTotal/i,
/totalPaid/i,
/paymentSum/i,
/importe_aplicado/i,
/PAYMENT.*TOTAL/i,
/TOTAL.*PAYMENT/i];


let paymentMatches = 0;

for (
let i = 0;
i < lines.length;
i++)
{
  if (
  paymentPatterns.some(
    (p) => p.test(lines[i])
  ))
  {
    paymentMatches++;

    console.log(
      `\nMATCH=${i + 1}`
    );

    printRange(
      i + 1 - 8,
      i + 1 + 15
    );
  }
}

console.log(
  `PAYMENT_TOTAL_SIGNAL_MATCHES=${paymentMatches}`
);

section(
  "6. EXISTING POS TEST PAYLOADS"
);

const scriptDir =
path.join(ROOT, "src/scripts");

const candidates =
fs.existsSync(scriptDir) ?
fs.readdirSync(scriptDir).
filter((name) =>
/^pos-.*\.(mjs|js)$/i.test(name)
) :
[];

let payloadHits = 0;

for (const name of candidates) {
  const full =
  path.join(
    scriptDir,
    name
  );

  const src =
  fs.readFileSync(
    full,
    "utf8"
  );

  if (
  !/createSale\s*\(/.test(src))
  {
    continue;
  }

  const srcLines =
  src.split(/\r?\n/);

  for (
  let i = 0;
  i < srcLines.length;
  i++)
  {
    if (
    /createSale\s*\(/.test(
      srcLines[i]
    ))
    {
      payloadHits++;

      console.log(
        `\nFILE=${name}`
      );

      console.log(
        `CALL_LINE=${i + 1}`
      );

      const start =
      Math.max(
        0,
        i - 30
      );

      const end =
      Math.min(
        srcLines.length - 1,
        i + 15
      );

      for (
      let j = start;
      j <= end;
      j++)
      {
        console.log(
          `${String(j + 1).padStart(5, " ")} | ${
          srcLines[j]}`

        );
      }
    }
  }
}

console.log(
  `CREATE_SALE_REFERENCE_CALLS=${payloadHits}`
);

section(
  "7. PRECHECK SUMMARY"
);

console.log(
  "LOYALTY007_PAYMENT_PRECHECK=PASS"
);

console.log(
  `INVALID_PAYMENT_AMOUNT_LINE=${
  errorLine || "(not found)"}`

);

console.log(
  `CREATE_SALE_REFERENCE_CALLS=${payloadHits}`
);

console.log("MODE=READ_ONLY");
console.log("DATABASE_CONNECTION=0");
console.log("HTTP_REQUESTS=0");
console.log("DATABASE_MUTATION=0");

console.log(
  "NEXT_STEP=PATCH_LOYALTY007_WITH_EXACT_PAYMENT_CONTRACT"
);
