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
  section(brandText("GMX — CLIENTES-LOYALTY-008 SALES RELATIONS PRECHECK")

  );

  console.log("MODE=READ_ONLY");
  console.log("HTTP_REQUESTS=0");
  console.log("DATABASE_MUTATION_ALLOWED=NO");
  console.log("FINANCIAL_MUTATION_ALLOWED=NO");
  console.log("SALES_MUTATION_ALLOWED=NO");
  console.log("LOYALTY_MUTATION_ALLOWED=NO");
  console.log(
    `TIMESTAMP=${new Date().toISOString()}`
  );

  const db = new Client(dbConfig());

  let tx = false;

  try {
    await db.connect();

    await db.query(
      "BEGIN TRANSACTION READ ONLY"
    );

    tx = true;

    await db.query(
      "SET LOCAL statement_timeout='30000ms'"
    );

    await db.query(
      "SET LOCAL lock_timeout='3000ms'"
    );

    /*
     * ======================================================
     * 1. SAFETY
     * ======================================================
     */

    section("1. DATABASE SAFETY");

    const safety = await q(db, `
      SELECT
        current_database() AS database,
        current_user AS db_user,
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only,
        current_setting(
          'transaction_isolation'
        ) AS transaction_isolation
    `);

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
     * ======================================================
     * 2. BASE COUNTS
     * ======================================================
     */

    section("2. RELATION BASE COUNTS");

    const counts = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.clientes
        )::bigint
          AS clientes,

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
        )::bigint
          AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE id_cliente IS NOT NULL
            AND btrim(id_cliente)<>''
        )::bigint
          AS pedidos_con_cliente,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_cuentas
        )::bigint
          AS cuentas_fidelidad,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
        )::bigint
          AS movimientos_fidelidad,

        (
          SELECT COUNT(*)
          FROM gmx.fidelidad_movimientos
          WHERE id_pedido IS NOT NULL
            AND btrim(id_pedido)<>''
        )::bigint
          AS movimientos_con_pedido
    `);

    console.table(counts.rows);

    /*
     * ======================================================
     * 3. ORDERS WITH INVALID CLIENT
     * ======================================================
     */

    section(
      "3. ORDERS REFERENCING MISSING CLIENT"
    );

    const invalidOrderClient = await q(db, `
      SELECT
        p.row_id,
        p.id_pedido,
        p.id_cliente,
        p.estado_pedido,
        p.canal_venta,
        p.fecha

      FROM gmx.pedidos p

      LEFT JOIN gmx.clientes c
        ON c.id_cliente=p.id_cliente

      WHERE
        p.id_cliente IS NOT NULL
        AND btrim(p.id_cliente)<>''
        AND c.id_cliente IS NULL

      ORDER BY p.row_id
    `);

    console.log(
      `ORDERS_WITH_MISSING_CLIENT=${
      invalidOrderClient.rowCount}`

    );

    if (invalidOrderClient.rowCount) {
      console.table(
        invalidOrderClient.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 4. MOVEMENTS WITH MISSING CLIENT
     * ======================================================
     */

    section(
      "4. LOYALTY MOVEMENTS REFERENCING MISSING CLIENT"
    );

    const missingClientMoves = await q(db, `
      SELECT
        f.row_id,
        f.id_movimiento,
        f.id_cliente,
        f.id_pedido,
        f.tipo,
        f.puntos,
        f.fecha

      FROM gmx.fidelidad_movimientos f

      LEFT JOIN gmx.clientes c
        ON c.id_cliente=f.id_cliente

      WHERE
        c.id_cliente IS NULL

      ORDER BY f.row_id
    `);

    console.log(
      `MOVEMENTS_WITH_MISSING_CLIENT=${
      missingClientMoves.rowCount}`

    );

    if (missingClientMoves.rowCount) {
      console.table(
        missingClientMoves.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 5. MOVEMENTS WITH MISSING ORDER
     * ======================================================
     */

    section(
      "5. LOYALTY MOVEMENTS REFERENCING MISSING ORDER"
    );

    const missingOrderMoves = await q(db, `
      SELECT
        f.row_id,
        f.id_movimiento,
        f.id_cliente,
        f.id_pedido,
        f.tipo,
        f.puntos,
        f.referencia,
        f.fecha

      FROM gmx.fidelidad_movimientos f

      LEFT JOIN gmx.pedidos p
        ON p.id_pedido=f.id_pedido

      WHERE
        f.id_pedido IS NOT NULL
        AND btrim(f.id_pedido)<>''
        AND p.id_pedido IS NULL

      ORDER BY f.row_id
    `);

    console.log(
      `MOVEMENTS_WITH_MISSING_ORDER=${
      missingOrderMoves.rowCount}`

    );

    if (missingOrderMoves.rowCount) {
      console.table(
        missingOrderMoves.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 6. CLIENT MISMATCH BETWEEN ORDER / MOVEMENT
     * ======================================================
     */

    section(
      "6. ORDER VS MOVEMENT CLIENT MISMATCH"
    );

    const clientMismatch = await q(db, `
      SELECT
        f.row_id AS movement_row_id,
        f.id_movimiento,
        f.id_pedido,

        f.id_cliente
          AS movement_client,

        p.id_cliente
          AS order_client,

        f.tipo,
        f.puntos,
        f.fecha

      FROM gmx.fidelidad_movimientos f

      JOIN gmx.pedidos p
        ON p.id_pedido=f.id_pedido

      WHERE
        f.id_cliente IS DISTINCT
        FROM p.id_cliente

      ORDER BY f.row_id
    `);

    console.log(
      `ORDER_MOVEMENT_CLIENT_MISMATCH=${
      clientMismatch.rowCount}`

    );

    if (clientMismatch.rowCount) {
      console.table(
        clientMismatch.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 7. ORDER LOYALTY SNAPSHOT VS MOVEMENTS
     * ======================================================
     */

    section(
      "7. ORDER LOYALTY FIELDS VS MOVEMENT LEDGER"
    );

    const relationLedger = await q(db, `
      WITH ledger AS (
        SELECT
          id_pedido,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='GENERACION'
                THEN puntos
                ELSE 0
              END
            ),
            0
          )::bigint AS generated,

          COALESCE(
            SUM(
              CASE
                WHEN tipo='REDENCION'
                THEN ABS(puntos)
                ELSE 0
              END
            ),
            0
          )::bigint AS redeemed,

          COUNT(*) FILTER (
            WHERE tipo='GENERACION'
          )::bigint AS generation_rows,

          COUNT(*) FILTER (
            WHERE tipo='REDENCION'
          )::bigint AS redemption_rows,

          COUNT(*) FILTER (
            WHERE tipo='REVERSA'
          )::bigint AS reversal_rows,

          COUNT(*) FILTER (
            WHERE tipo='DEVOLUCION_RETIRO'
          )::bigint AS return_rows

        FROM gmx.fidelidad_movimientos

        WHERE
          id_pedido IS NOT NULL
          AND btrim(id_pedido)<>''

        GROUP BY id_pedido
      )

      SELECT
        p.row_id,
        p.id_pedido,
        p.id_cliente,
        p.estado_pedido,

        COALESCE(
          p.puntos_generados,
          0
        )::bigint
          AS order_generated,

        COALESCE(
          p.puntos_redimidos,
          0
        )::bigint
          AS order_redeemed,

        COALESCE(
          l.generated,
          0
        )::bigint
          AS ledger_generated,

        COALESCE(
          l.redeemed,
          0
        )::bigint
          AS ledger_redeemed,

        COALESCE(
          l.generation_rows,
          0
        )::bigint
          AS generation_rows,

        COALESCE(
          l.redemption_rows,
          0
        )::bigint
          AS redemption_rows,

        COALESCE(
          l.reversal_rows,
          0
        )::bigint
          AS reversal_rows,

        COALESCE(
          l.return_rows,
          0
        )::bigint
          AS return_rows

      FROM gmx.pedidos p

      LEFT JOIN ledger l
        ON l.id_pedido=p.id_pedido

      WHERE
        COALESCE(
          p.puntos_generados,
          0
        ) <> COALESCE(
          l.generated,
          0
        )

        OR

        COALESCE(
          p.puntos_redimidos,
          0
        ) <> COALESCE(
          l.redeemed,
          0
        )

      ORDER BY p.row_id
    `);

    console.log(
      `ORDER_LEDGER_MISMATCH=${
      relationLedger.rowCount}`

    );

    if (relationLedger.rowCount) {
      console.table(
        relationLedger.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 8. LOYALTY SALES BY TYPE
     * ======================================================
     */

    section(
      "8. SALES-RELATED LOYALTY MOVEMENT DISTRIBUTION"
    );

    const distribution = await q(db, `
      SELECT
        tipo,
        COUNT(*)::bigint AS movements,
        COUNT(DISTINCT id_pedido)::bigint
          AS orders,
        COUNT(DISTINCT id_cliente)::bigint
          AS clients,
        COALESCE(
          SUM(puntos),
          0
        )::bigint AS points_sum

      FROM gmx.fidelidad_movimientos

      WHERE
        id_pedido IS NOT NULL
        AND btrim(id_pedido)<>''

      GROUP BY tipo

      ORDER BY tipo
    `);

    console.table(
      distribution.rows
    );

    /*
     * ======================================================
     * 9. GENERATION ON NON-PAID / INVALID SALES
     * ======================================================
     */

    section(
      "9. GENERATION ON NON-PAID SALES"
    );

    const generatedInvalid = await q(db, `
      SELECT
        p.row_id,
        p.id_pedido,
        p.estado_pedido,
        p.estado_pago,
        p.venta_confirmada,

        COUNT(f.*)::bigint
          AS generation_rows,

        COALESCE(
          SUM(f.puntos),
          0
        )::bigint
          AS generated_points

      FROM gmx.pedidos p

      JOIN gmx.fidelidad_movimientos f
        ON f.id_pedido=p.id_pedido
        AND f.tipo='GENERACION'

      WHERE
        (
          COALESCE(
            p.venta_confirmada,
            false
          ) IS FALSE

          OR

          UPPER(
            COALESCE(
              p.estado_pago,
              ''
            )
          ) NOT IN (
            'PAGADO',
            'APROBADO'
          )
        )

        AND UPPER(
          COALESCE(
            p.estado_pedido,
            ''
          )
        ) <> 'CANCELADO'

      GROUP BY
        p.row_id,
        p.id_pedido,
        p.estado_pedido,
        p.estado_pago,
        p.venta_confirmada

      ORDER BY p.row_id
    `);

    console.log(
      `GENERATION_ON_NON_PAID_SALES=${
      generatedInvalid.rowCount}`

    );

    if (generatedInvalid.rowCount) {
      console.table(
        generatedInvalid.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 10. CANCELLED SALES WITH ACTIVE BENEFITS
     * ======================================================
     */

    section(
      "10. CANCELLED SALES BENEFIT STATE"
    );

    const cancelledBenefits = await q(db, `
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
            AS reversal_rows

        FROM gmx.fidelidad_movimientos

        GROUP BY id_pedido
      )

      SELECT
        p.row_id,
        p.id_pedido,
        p.id_cliente,
        p.estado_pedido,
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
          AS reversal_rows

      FROM gmx.pedidos p

      LEFT JOIN movement_state m
        ON m.id_pedido=p.id_pedido

      WHERE
        UPPER(
          COALESCE(
            p.estado_pedido,
            ''
          )
        )='CANCELADO'

        AND (
          (
            COALESCE(
              m.generation_rows,
              0
            ) > 0

            OR

            COALESCE(
              m.redemption_rows,
              0
            ) > 0
          )

          AND

          COALESCE(
            m.reversal_rows,
            0
          ) = 0
        )

      ORDER BY p.row_id
    `);

    console.log(
      `CANCELLED_WITH_UNREVERSED_LOYALTY=${
      cancelledBenefits.rowCount}`

    );

    if (cancelledBenefits.rowCount) {
      console.table(
        cancelledBenefits.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 11. ACCOUNT CLIENT RELATION
     * ======================================================
     */

    section(
      "11. LOYALTY ACCOUNT CLIENT RELATION"
    );

    const accountOrphans = await q(db, `
      SELECT
        fc.row_id,
        fc.id_cliente,
        fc.puntos_disponibles,
        fc.puntos_generados,
        fc.puntos_redimidos,
        fc.nivel

      FROM gmx.fidelidad_cuentas fc

      LEFT JOIN gmx.clientes c
        ON c.id_cliente=fc.id_cliente

      WHERE c.id_cliente IS NULL

      ORDER BY fc.row_id
    `);

    console.log(
      `LOYALTY_ACCOUNT_ORPHANS=${
      accountOrphans.rowCount}`

    );

    if (accountOrphans.rowCount) {
      console.table(
        accountOrphans.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 12. ACCOUNT VS LEDGER BALANCE
     * ======================================================
     */

    section(
      "12. ACCOUNT BALANCE VS MOVEMENT CHAIN"
    );

    const accountMismatch = await q(db, `
      WITH latest AS (
        SELECT DISTINCT ON (
          id_cliente
        )
          id_cliente,
          saldo_nuevo,
          row_id

        FROM gmx.fidelidad_movimientos

        ORDER BY
          id_cliente,
          row_id DESC
      )

      SELECT
        fc.row_id,
        fc.id_cliente,

        fc.puntos_disponibles
          AS account_balance,

        l.saldo_nuevo
          AS latest_movement_balance,

        l.row_id
          AS latest_movement_row

      FROM gmx.fidelidad_cuentas fc

      JOIN latest l
        ON l.id_cliente=fc.id_cliente

      WHERE
        fc.puntos_disponibles
          IS DISTINCT FROM
        l.saldo_nuevo

      ORDER BY fc.row_id
    `);

    console.log(
      `ACCOUNT_LEDGER_BALANCE_MISMATCH=${
      accountMismatch.rowCount}`

    );

    if (accountMismatch.rowCount) {
      console.table(
        accountMismatch.rows
      );
    } else {
      console.log("(0 rows)");
    }

    /*
     * ======================================================
     * 13. TEST RESIDUE
     * ======================================================
     */

    section(
      "13. LOYALTY007 TEST RESIDUE"
    );

    const residue = await q(db, `
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE
            pos_idempotency_key
              LIKE 'LOYALTY007-%'
        )::bigint AS pedidos,

        (
          SELECT COUNT(*)
          FROM gmx.clientes
          WHERE
            nombre LIKE
              'CLIENTES LOYALTY007 TEST %'
            OR
            email LIKE
              'clientes.loyalty007.%@example.invalid'
        )::bigint AS clientes
    `);

    console.table(residue.rows);

    const testResidue =
    Number(residue.rows[0].pedidos) +
    Number(residue.rows[0].clientes);

    console.log(
      `TEST_RESIDUE=${testResidue}`
    );

    /*
     * ======================================================
     * FINAL SAFETY
     * ======================================================
     */

    section(
      "14. FINAL READ ONLY SAFETY"
    );

    const finalSafety = await q(db, `
      SELECT
        current_setting(
          'transaction_read_only'
        ) AS transaction_read_only
    `);

    console.table(finalSafety.rows);

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
     * ======================================================
     * SUMMARY
     * ======================================================
     */

    section("15. FINAL SUMMARY");

    console.log(
      "CLIENTES_LOYALTY_008_SALES_RELATIONS_PRECHECK=PASS"
    );

    console.log(
      `ORDERS_WITH_MISSING_CLIENT=${
      invalidOrderClient.rowCount}`

    );

    console.log(
      `MOVEMENTS_WITH_MISSING_CLIENT=${
      missingClientMoves.rowCount}`

    );

    console.log(
      `MOVEMENTS_WITH_MISSING_ORDER=${
      missingOrderMoves.rowCount}`

    );

    console.log(
      `ORDER_MOVEMENT_CLIENT_MISMATCH=${
      clientMismatch.rowCount}`

    );

    console.log(
      `ORDER_LEDGER_MISMATCH=${
      relationLedger.rowCount}`

    );

    console.log(
      `GENERATION_ON_NON_PAID_SALES=${
      generatedInvalid.rowCount}`

    );

    console.log(
      `CANCELLED_WITH_UNREVERSED_LOYALTY=${
      cancelledBenefits.rowCount}`

    );

    console.log(
      `LOYALTY_ACCOUNT_ORPHANS=${
      accountOrphans.rowCount}`

    );

    console.log(
      `ACCOUNT_LEDGER_BALANCE_MISMATCH=${
      accountMismatch.rowCount}`

    );

    console.log(
      `TEST_RESIDUE=${testResidue}`
    );

    console.log("MODE=READ_ONLY");
    console.log("DATABASE_MUTATION=0");
    console.log("FINANCIAL_MUTATION=0");
    console.log("SALES_MUTATION=0");
    console.log("LOYALTY_MUTATION=0");
    console.log("ROLLBACK=PASS");

    console.log(
      "NEXT_STEP=ANALYZE_SALES_RELATION_FINDINGS"
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
    "CLIENTES-LOYALTY-008 SALES RELATIONS PRECHECK FAILED"
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
