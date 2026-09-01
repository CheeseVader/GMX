import { brandText } from "../config/brand.js";import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { fileURLToPath } from "node:url";

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

for (const f of [
".env",
".env.local",
".env.development",
".env.dev"])
{
  loadEnv(path.join(ROOT, f));
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

async function q(db, sql, params = []) {
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
      "READ_ONLY_GUARD:" +
      normalized.slice(0, 100)
    );
  }

  return db.query(sql, params);
}

async function main() {
  section(brandText("GMX — CLIENTES-LOYALTY-004B REVERSAL MISMATCH DIAGNOSTIC R2")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log("LOYALTY_MUTATION_ALLOWED=NO");
  console.log(`TIMESTAMP=${new Date().toISOString()}`);

  const db = new Client(dbConfig());

  let tx = false;

  try {
    await db.connect();

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    tx = true;

    await db.query(
      "SET LOCAL statement_timeout='20000ms'"
    );

    await db.query(
      "SET LOCAL lock_timeout='3000ms'"
    );

    /*
     * -----------------------------------------------------
     * SAFETY
     * -----------------------------------------------------
     */

    section("1. DATABASE SAFETY");

    const safety = await q(
      db,
      `
      SELECT
        current_database()
          AS database,

        current_user
          AS db_user,

        current_setting(
          'transaction_read_only'
        )
          AS transaction_read_only
      `
    );

    console.table(safety.rows);

    if (
    safety.rows[0]?.
    transaction_read_only !== "on")
    {
      throw new Error(
        "TRANSACTION_NOT_READ_ONLY"
      );
    }

    /*
     * -----------------------------------------------------
     * REAL PEDIDOS CONTRACT
     *
     * Primero descubrimos columnas de pedidos.
     * No asumimos nombres.
     * -----------------------------------------------------
     */

    section(
      "2. PEDIDOS REAL COLUMN CONTRACT"
    );

    const pedidoColumns = await q(
      db,
      `
      SELECT
        ordinal_position,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE
        table_schema='gmx'
        AND table_name='pedidos'
      ORDER BY ordinal_position
      `
    );

    console.table(pedidoColumns.rows);

    /*
     * -----------------------------------------------------
     * TARGET MISMATCH ORDERS
     * -----------------------------------------------------
     */

    section("3. MISMATCH ORDERS");

    const mismatch = await q(
      db,
      `
      WITH movement_state AS (
        SELECT
          id_pedido,

          COUNT(*) FILTER (
            WHERE tipo='GENERACION'
          )::bigint
            AS generation_rows,

          COUNT(*) FILTER (
            WHERE tipo='REDENCION'
          )::bigint
            AS redemption_rows,

          COUNT(*) FILTER (
            WHERE tipo='REVERSA'
          )::bigint
            AS reversal_rows,

          COUNT(*) FILTER (
            WHERE tipo='DEVOLUCION_RETIRO'
          )::bigint
            AS partial_return_rows,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='GENERACION'
                THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint
            AS generated_points_movements,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='REDENCION'
                THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint
            AS redeemed_points_movements

        FROM gmx.fidelidad_movimientos

        WHERE id_pedido IS NOT NULL

        GROUP BY id_pedido
      )

      SELECT
        p.row_id,
        p.id_pedido,

        to_jsonb(p)->>'id_cliente'
          AS id_cliente,

        COALESCE(
          to_jsonb(p)->>'estado_pedido',
          to_jsonb(p)->>'estado'
        )
          AS estado_pedido,

        to_jsonb(p)->>'estado_pago'
          AS estado_pago,

        to_jsonb(p)->>'canal_venta'
          AS canal_venta,

        to_jsonb(p)->>'total'
          AS total,

        to_jsonb(p)->>'total_antes_beneficios'
          AS total_antes_beneficios,

        to_jsonb(p)->>'puntos_redimidos'
          AS puntos_redimidos_pedido,

        to_jsonb(p)->>'descuento_puntos'
          AS descuento_puntos,

        to_jsonb(p)->>'puntos_generados'
          AS puntos_generados_pedido,

        to_jsonb(p)->>'id_cuenta_cliente'
          AS id_cuenta_cliente,

        to_jsonb(p)->>'pos_idempotency_key'
          AS pos_idempotency_key,

        p.beneficios_revertidos,

        COALESCE(
          m.generation_rows,
          0
        )::bigint
          AS generation_rows,

        COALESCE(
          m.redemption_rows,
          0
        )::bigint
          AS redemption_rows,

        COALESCE(
          m.reversal_rows,
          0
        )::bigint
          AS reversal_rows,

        COALESCE(
          m.partial_return_rows,
          0
        )::bigint
          AS partial_return_rows,

        COALESCE(
          m.generated_points_movements,
          0
        )::bigint
          AS generated_points_movements,

        COALESCE(
          m.redeemed_points_movements,
          0
        )::bigint
          AS redeemed_points_movements

      FROM gmx.pedidos p

      LEFT JOIN movement_state m
        ON m.id_pedido=p.id_pedido

      WHERE
        p.beneficios_revertidos IS TRUE

        AND COALESCE(
          m.reversal_rows,
          0
        )=0

      ORDER BY p.row_id
      `
    );

    console.log(
      `MISMATCH_ORDERS=${mismatch.rowCount}`
    );

    console.table(mismatch.rows);

    /*
     * -----------------------------------------------------
     * ALL LOYALTY MOVEMENTS
     * -----------------------------------------------------
     */

    section(
      "4. ALL LOYALTY MOVEMENTS FOR MISMATCH ORDERS"
    );

    const movements = await q(
      db,
      `
      WITH target AS (
        SELECT
          p.id_pedido

        FROM gmx.pedidos p

        LEFT JOIN (
          SELECT
            id_pedido,

            COUNT(*) FILTER (
              WHERE tipo='REVERSA'
            )::bigint
              AS reversal_rows

          FROM gmx.fidelidad_movimientos

          GROUP BY id_pedido
        ) m
          ON m.id_pedido=p.id_pedido

        WHERE
          p.beneficios_revertidos IS TRUE

          AND COALESCE(
            m.reversal_rows,
            0
          )=0
      )

      SELECT
        f.row_id,
        f.id_movimiento,
        f.id_cliente,
        f.id_pedido,
        f.tipo,
        f.puntos,
        f.saldo_anterior,
        f.saldo_nuevo,
        f.referencia,
        f.motivo,
        f.reversa_de,
        f.fecha

      FROM gmx.fidelidad_movimientos f

      JOIN target t
        ON t.id_pedido=f.id_pedido

      ORDER BY
        f.id_pedido,
        f.row_id
      `
    );

    console.log(
      `MOVEMENTS_FOR_MISMATCH=${movements.rowCount}`
    );

    if (movements.rowCount) {
      console.table(movements.rows);
    } else {
      console.log("(0 rows)");
    }

    /*
     * -----------------------------------------------------
     * PROMOTION REDEMPTIONS
     * -----------------------------------------------------
     */

    section(
      "5. PROMOTION REDEMPTIONS FOR MISMATCH ORDERS"
    );

    const promoTable = await q(
      db,
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE
          table_schema='gmx'
          AND table_name='promociones_redenciones'
      ) AS exists
      `
    );

    const promoExists =
    Boolean(
      promoTable.rows[0]?.exists
    );

    console.log(
      `PROMOCIONES_REDENCIONES_EXISTS=${
      promoExists ? "YES" : "NO"}`

    );

    let promoRows = [];

    if (promoExists) {
      const promo = await q(
        db,
        `
        WITH target AS (
          SELECT
            p.id_pedido

          FROM gmx.pedidos p

          LEFT JOIN (
            SELECT
              id_pedido,

              COUNT(*) FILTER (
                WHERE tipo='REVERSA'
              )::bigint
                AS reversal_rows

            FROM gmx.fidelidad_movimientos

            GROUP BY id_pedido
          ) m
            ON m.id_pedido=p.id_pedido

          WHERE
            p.beneficios_revertidos IS TRUE

            AND COALESCE(
              m.reversal_rows,
              0
            )=0
        )

        SELECT r.*

        FROM gmx.promociones_redenciones r

        JOIN target t
          ON t.id_pedido=r.id_pedido

        ORDER BY
          r.id_pedido,
          r.row_id
        `
      );

      promoRows = promo.rows;

      console.log(
        `PROMO_REDEMPTIONS_FOR_MISMATCH=${promo.rowCount}`
      );

      if (promo.rowCount) {
        console.table(promo.rows);
      } else {
        console.log("(0 rows)");
      }

    } else {
      console.log(
        "PROMO_REDEMPTIONS_FOR_MISMATCH=0"
      );
    }

    /*
     * -----------------------------------------------------
     * CLASSIFICATION
     *
     * MUY IMPORTANTE:
     * movimientos y promociones se agregan primero
     * por separado para evitar producto cartesiano.
     * -----------------------------------------------------
     */

    section("6. CLASSIFICATION");

    const classification = await q(
      db,
      `
      WITH movement_state AS (
        SELECT
          id_pedido,

          COUNT(*) FILTER (
            WHERE tipo='GENERACION'
          )::bigint
            AS generation_rows,

          COUNT(*) FILTER (
            WHERE tipo='REDENCION'
          )::bigint
            AS redemption_rows,

          COUNT(*) FILTER (
            WHERE tipo='REVERSA'
          )::bigint
            AS reversal_rows,

          COUNT(*) FILTER (
            WHERE tipo='DEVOLUCION_RETIRO'
          )::bigint
            AS partial_return_rows

        FROM gmx.fidelidad_movimientos

        GROUP BY id_pedido
      ),

      promo_state AS (
        SELECT
          id_pedido,

          COUNT(*)::bigint
            AS promo_redemption_rows,

          COUNT(*) FILTER (
            WHERE estado='APLICADA'
          )::bigint
            AS promo_applied_rows,

          COUNT(*) FILTER (
            WHERE estado='REVERTIDA'
          )::bigint
            AS promo_reverted_rows

        FROM gmx.promociones_redenciones

        GROUP BY id_pedido
      )

      SELECT
        p.row_id,
        p.id_pedido,

        to_jsonb(p)->>'id_cliente'
          AS id_cliente,

        COALESCE(
          to_jsonb(p)->>'estado_pedido',
          to_jsonb(p)->>'estado'
        )
          AS estado_pedido,

        p.beneficios_revertidos,

        COALESCE(
          m.generation_rows,
          0
        )::bigint
          AS generation_rows,

        COALESCE(
          m.redemption_rows,
          0
        )::bigint
          AS redemption_rows,

        COALESCE(
          m.reversal_rows,
          0
        )::bigint
          AS reversal_rows,

        COALESCE(
          m.partial_return_rows,
          0
        )::bigint
          AS partial_return_rows,

        COALESCE(
          pr.promo_redemption_rows,
          0
        )::bigint
          AS promo_redemption_rows,

        COALESCE(
          pr.promo_applied_rows,
          0
        )::bigint
          AS promo_applied_rows,

        COALESCE(
          pr.promo_reverted_rows,
          0
        )::bigint
          AS promo_reverted_rows,

        CASE

          WHEN
            COALESCE(
              m.reversal_rows,
              0
            )=0

            AND COALESCE(
              m.generation_rows,
              0
            )=0

            AND COALESCE(
              m.redemption_rows,
              0
            )=0

            AND COALESCE(
              pr.promo_redemption_rows,
              0
            )=0

          THEN
            'NO_LOYALTY_ACTIVITY_FLAG_ONLY'

          WHEN
            COALESCE(
              m.reversal_rows,
              0
            )=0

            AND (
              COALESCE(
                m.generation_rows,
                0
              )>0

              OR COALESCE(
                m.redemption_rows,
                0
              )>0
            )

          THEN
            'POSSIBLE_MISSING_REVERSAL'

          WHEN
            COALESCE(
              m.reversal_rows,
              0
            )=0

            AND COALESCE(
              pr.promo_applied_rows,
              0
            )>0

          THEN
            'POSSIBLE_PROMO_NOT_REVERTED'

          WHEN
            COALESCE(
              m.reversal_rows,
              0
            )>0

          THEN
            'REVERSAL_PRESENT'

          ELSE
            'REVIEW'

        END
          AS classification

      FROM gmx.pedidos p

      LEFT JOIN movement_state m
        ON m.id_pedido=p.id_pedido

      LEFT JOIN promo_state pr
        ON pr.id_pedido=p.id_pedido

      WHERE
        p.beneficios_revertidos IS TRUE

        AND COALESCE(
          m.reversal_rows,
          0
        )=0

      ORDER BY p.row_id
      `
    );

    console.table(
      classification.rows
    );

    /*
     * -----------------------------------------------------
     * SUMMARIZE CLASSIFICATION
     * -----------------------------------------------------
     */

    const harmless =
    classification.rows.filter(
      (r) =>
      r.classification ===
      "NO_LOYALTY_ACTIVITY_FLAG_ONLY"
    ).length;

    const suspiciousLoyalty =
    classification.rows.filter(
      (r) =>
      r.classification ===
      "POSSIBLE_MISSING_REVERSAL"
    ).length;

    const suspiciousPromo =
    classification.rows.filter(
      (r) =>
      r.classification ===
      "POSSIBLE_PROMO_NOT_REVERTED"
    ).length;

    const review =
    classification.rows.filter(
      (r) =>
      r.classification ===
      "REVIEW"
    ).length;

    section("7. DIAGNOSTIC SUMMARY");

    console.log(
      `MISMATCH_ORDERS=${mismatch.rowCount}`
    );

    console.log(
      `NO_LOYALTY_ACTIVITY_FLAG_ONLY=${harmless}`
    );

    console.log(
      `POSSIBLE_MISSING_REVERSAL=${suspiciousLoyalty}`
    );

    console.log(
      `POSSIBLE_PROMO_NOT_REVERTED=${suspiciousPromo}`
    );

    console.log(
      `REVIEW_COUNT=${review}`
    );

    const suspiciousTotal =
    suspiciousLoyalty +
    suspiciousPromo +
    review;

    console.log(
      `SUSPICIOUS_TOTAL=${suspiciousTotal}`
    );

    if (
    mismatch.rowCount > 0 &&
    suspiciousTotal === 0 &&
    harmless === mismatch.rowCount)
    {
      console.log(
        "REVERSAL_FLAG_MISMATCH_CLASSIFICATION=BENIGN"
      );

      console.log(
        "INTERPRETATION=FLAG_MARKED_WITH_NO_LOYALTY_ACTIVITY_TO_REVERSE"
      );

    } else if (
    suspiciousTotal > 0)
    {
      console.log(
        "REVERSAL_FLAG_MISMATCH_CLASSIFICATION=REQUIRES_REVIEW"
      );

      console.log(
        "INTERPRETATION=ACTIVITY_REQUIRES_DEEPER_REVERSAL_ANALYSIS"
      );

    } else if (
    mismatch.rowCount === 0)
    {
      console.log(
        "REVERSAL_FLAG_MISMATCH_CLASSIFICATION=NO_MISMATCH"
      );

    } else {
      console.log(
        "REVERSAL_FLAG_MISMATCH_CLASSIFICATION=REVIEW"
      );
    }

    /*
     * -----------------------------------------------------
     * FINAL SAFETY
     * -----------------------------------------------------
     */

    section(
      "8. FINAL READ-ONLY SAFETY"
    );

    const finalSafety = await q(
      db,
      `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,

        current_database()
          AS database,

        current_user
          AS db_user,

        NOW()
          AS checked_at
      `
    );

    console.table(
      finalSafety.rows
    );

    if (
    finalSafety.rows[0]?.
    transaction_read_only !== "on")
    {
      throw new Error(
        "FINAL_READ_ONLY_CHECK_FAILED"
      );
    }

    await db.query("ROLLBACK");
    tx = false;

    /*
     * -----------------------------------------------------
     * FINAL
     * -----------------------------------------------------
     */

    section("9. FINAL");

    console.log(
      "CLIENTES_LOYALTY_004B_REVERSAL_DIAGNOSTIC=PASS"
    );

    console.log(
      `SUSPICIOUS_TOTAL=${suspiciousTotal}`
    );

    console.log("MODE=READ_ONLY");
    console.log("HTTP_REQUESTS=0");
    console.log("DATABASE_MUTATION=0");
    console.log("FINANCIAL_MUTATION=0");
    console.log("SALES_MUTATION=0");
    console.log("LOYALTY_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      suspiciousTotal === 0 ?
      "NEXT_STEP=LOYALTY_IDEMPOTENCY_CONTROLLED_SMOKE" :
      "NEXT_STEP=ANALYZE_SUSPICIOUS_REVERSALS"
    );

  } catch (e) {
    if (tx) {
      try {
        await db.query("ROLLBACK");

        console.log(
          "ROLLBACK_AFTER_ERROR=PASS"
        );
      } catch {}
    }

    throw e;

  } finally {
    await db.end();
  }
}

main().catch((e) => {
  section(
    "CLIENTES-LOYALTY-004B REVERSAL DIAGNOSTIC FAILED"
  );

  console.error(
    e?.stack || e
  );

  console.log(
    "DATABASE_MUTATION=0_EXPECTED"
  );

  console.log(
    "CERTIFICATION=BLOCKED"
  );

  process.exitCode = 1;
});
