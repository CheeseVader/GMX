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

function read(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) {
    console.log(`FILE_MISSING=${rel}`);
    return null;
  }

  console.log(`FILE_FOUND=${rel}`);

  return fs.readFileSync(full, "utf8");
}

function showFunction(text, functionName, radius = 4) {
  if (!text) return false;

  const lines = text.split(/\r?\n/);

  const patterns = [
  new RegExp(
    `export\\s+async\\s+function\\s+${functionName}\\s*\\(`
  ),
  new RegExp(
    `async\\s+function\\s+${functionName}\\s*\\(`
  ),
  new RegExp(
    `export\\s+function\\s+${functionName}\\s*\\(`
  ),
  new RegExp(
    `function\\s+${functionName}\\s*\\(`
  )];


  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      start = i;
      break;
    }
  }

  if (start < 0) {
    console.log(`FUNCTION_NOT_FOUND=${functionName}`);
    return false;
  }

  /*
   * Encontramos el cierre mediante balance de llaves.
   * Esto no interpreta JS; solamente delimita el bloque
   * para diagnóstico de código fuente.
   */

  let braces = 0;
  let opened = false;
  let end = start;

  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        braces++;
        opened = true;
      } else if (ch === "}") {
        braces--;
      }
    }

    if (opened && braces === 0) {
      end = i;
      break;
    }

    end = i;
  }

  const from = Math.max(0, start - radius);
  const to = Math.min(lines.length - 1, end + radius);

  console.log(
    `FUNCTION=${functionName}`
  );

  console.log(
    `LINES=${start + 1}-${end + 1}`
  );

  for (let i = from; i <= to; i++) {
    console.log(
      `${String(i + 1).padStart(5, " ")} | ${lines[i]}`
    );
  }

  return true;
}

function searchContexts(text, patterns, radius = 8) {
  if (!text) return;

  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      hits.push(i);
    }
  }

  if (!hits.length) {
    console.log("(no matches)");
    return;
  }

  const ranges = [];

  for (const hit of hits) {
    const start = Math.max(0, hit - radius);
    const end = Math.min(lines.length - 1, hit + radius);

    const previous = ranges.at(-1);

    if (previous && start <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  for (const [start, end] of ranges) {
    console.log(
      `\n--- lines ${start + 1}-${end + 1} ---`
    );

    for (let i = start; i <= end; i++) {
      console.log(
        `${String(i + 1).padStart(5, " ")} | ${lines[i]}`
      );
    }
  }
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-002 CONTRACT DEEP-DIVE")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");

  const benefits = read(
    "src/repositories/benefitsRepository.js"
  );

  const orders = read(
    "src/repositories/ordersRepository.js"
  );

  section(
    "1. calculateBenefitsTx"
  );

  showFunction(
    benefits,
    "calculateBenefitsTx"
  );

  section(
    "2. applyBenefitsTx"
  );

  showFunction(
    benefits,
    "applyBenefitsTx"
  );

  section(
    "3. reverseBenefitsTx"
  );

  showFunction(
    benefits,
    "reverseBenefitsTx"
  );

  section(
    "4. getClientLoyalty"
  );

  showFunction(
    benefits,
    "getClientLoyalty"
  );

  section(
    "5. adjustClientPoints"
  );

  showFunction(
    benefits,
    "adjustClientPoints"
  );

  section(
    "6. applyPartialReturnBenefitsTx"
  );

  showFunction(
    benefits,
    "applyPartialReturnBenefitsTx"
  );

  section(
    "7. BENEFITS — IDEMPOTENCY / MOVEMENT CONTRACT"
  );

  searchContexts(
    benefits,
    [
    /id_movimiento/i,
    /id_pedido/i,
    /GENERACION/i,
    /REDENCION/i,
    /REVERSA/i,
    /DEVOLUCION_RETIRO/i,
    /AJUSTE/i,
    /reversa_de/i,
    /ON\s+CONFLICT/i,
    /FOR\s+UPDATE/i],

    10
  );

  section(
    "8. ORDERS — IDEMPOTENCY CONTRACT"
  );

  searchContexts(
    orders,
    [
    /idempot/i,
    /idempotency/i,
    /id_movimiento/i,
    /applyBenefitsTx/i,
    /reverseBenefitsTx/i,
    /applyPartialReturnBenefitsTx/i,
    /DEVOLUCION_RETIRO/i,
    /REVERSA/i,
    /FOR\s+UPDATE/i],

    12
  );

  const db = new Client(dbConfig());

  let tx = false;

  try {
    await db.connect();

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    tx = true;

    section(
      "9. DATABASE READ-ONLY CONFIRMATION"
    );

    const safety = await db.query(`
      SELECT
        current_database() AS database,
        current_user AS db_user,
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only
    `);

    console.table(safety.rows);

    if (
    safety.rows[0]?.transaction_read_only !== "on")
    {
      throw new Error(
        "TRANSACTION_NOT_READ_ONLY"
      );
    }

    section(
      "10. EXACT MOVEMENT CONTRACT"
    );

    const movementContract =
    await db.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE
          table_schema='gmx'
          AND table_name='fidelidad_movimientos'
        ORDER BY ordinal_position
      `);

    console.table(
      movementContract.rows
    );

    section(
      "11. EXACT ACCOUNT CONTRACT"
    );

    const accountContract =
    await db.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE
          table_schema='gmx'
          AND table_name='fidelidad_cuentas'
        ORDER BY ordinal_position
      `);

    console.table(
      accountContract.rows
    );

    section(
      "12. RETURN MOVEMENT FORENSICS"
    );

    const returns =
    await db.query(`
        SELECT
          row_id,
          id_movimiento,
          fecha,
          id_cliente,
          tipo,
          puntos,
          saldo_anterior,
          saldo_nuevo,
          id_pedido,
          referencia,
          motivo,
          reversa_de
        FROM gmx.fidelidad_movimientos
        WHERE tipo IN (
          'DEVOLUCION_RETIRO',
          'REVERSA'
        )
        ORDER BY
          id_pedido,
          fecha,
          row_id
      `);

    console.table(returns.rows);

    section(
      "13. GENERATION / RETURN RELATION"
    );

    const relation =
    await db.query(`
        SELECT
          g.id_pedido,
          g.id_cliente,

          COUNT(*) FILTER (
            WHERE g.tipo='GENERACION'
          ) AS generation_rows,

          COALESCE(
            SUM(g.puntos) FILTER (
              WHERE g.tipo='GENERACION'
            ),
            0
          ) AS generated_points,

          COUNT(*) FILTER (
            WHERE g.tipo='DEVOLUCION_RETIRO'
          ) AS return_rows,

          COALESCE(
            SUM(g.puntos) FILTER (
              WHERE g.tipo='DEVOLUCION_RETIRO'
            ),
            0
          ) AS returned_points,

          COUNT(*) FILTER (
            WHERE g.tipo='REVERSA'
          ) AS reversal_rows,

          COALESCE(
            SUM(g.puntos) FILTER (
              WHERE g.tipo='REVERSA'
            ),
            0
          ) AS reversed_points

        FROM gmx.fidelidad_movimientos g

        WHERE
          g.id_pedido IS NOT NULL

        GROUP BY
          g.id_pedido,
          g.id_cliente

        ORDER BY
          g.id_pedido,
          g.id_cliente
      `);

    console.table(relation.rows);

    section(
      "14. POSSIBLE OVER-REVERSAL CHECK"
    );

    const over =
    await db.query(`
        WITH x AS (
          SELECT
            id_pedido,
            id_cliente,

            COALESCE(
              SUM(
                CASE
                  WHEN tipo='GENERACION'
                    THEN puntos
                  ELSE 0
                END
              ),
              0
            ) AS generated,

            COALESCE(
              SUM(
                CASE
                  WHEN tipo IN (
                    'DEVOLUCION_RETIRO',
                    'REVERSA'
                  )
                    THEN ABS(puntos)
                  ELSE 0
                END
              ),
              0
            ) AS removed

          FROM gmx.fidelidad_movimientos

          WHERE id_pedido IS NOT NULL

          GROUP BY
            id_pedido,
            id_cliente
        )

        SELECT
          *,
          generated - removed
            AS remaining_generated_points
        FROM x
        WHERE removed > generated
        ORDER BY id_pedido,id_cliente
      `);

    console.log(
      `OVER_REVERSED_ORDERS=${over.rowCount}`
    );

    console.table(over.rows);

    section(
      "15. MOVEMENT ID / REVERSA REFERENCES"
    );

    const reverseRefs =
    await db.query(`
        SELECT
          r.row_id,
          r.id_movimiento,
          r.tipo,
          r.reversa_de,
          r.id_pedido,
          original.id_movimiento
            AS original_found,
          original.tipo
            AS original_tipo,
          original.puntos
            AS original_puntos
        FROM gmx.fidelidad_movimientos r

        LEFT JOIN gmx.fidelidad_movimientos original
          ON original.id_movimiento=r.reversa_de

        WHERE r.reversa_de IS NOT NULL

        ORDER BY r.row_id
      `);

    console.table(reverseRefs.rows);

    await db.query("ROLLBACK");
    tx = false;

  } catch (e) {
    if (tx) {
      try {
        await db.query("ROLLBACK");
      } catch {}
    }

    throw e;

  } finally {
    await db.end();
  }

  section(
    "16. FINAL SUMMARY"
  );

  console.log(
    "CLIENTES_LOYALTY_002_CONTRACT=PASS"
  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION=0");
  console.log("FINANCIAL_MUTATION=0");
  console.log("SALES_MUTATION=0");
  console.log("ROLLBACK=PASS");

  console.log(
    "NEXT_STEP=DEFINE_CONTROLLED_LOYALTY_SMOKE"
  );

  console.log(
    "NO_CODE_CHANGE_APPLIED"
  );
}

main().catch((e) => {
  section(
    "CLIENTES-LOYALTY-002 CONTRACT FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
