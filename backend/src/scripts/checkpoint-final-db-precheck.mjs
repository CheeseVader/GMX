import { brandText } from "../config/brand.js";import "dotenv/config";
import { query, pool } from "../db.js";

try {

  console.log("============================================================");
  console.log(brandText("GMX CHECKPOINT FINAL - DATABASE PRECHECK"));
  console.log("============================================================");

  const info = await query(`
    SELECT
      current_database() AS database,
      current_user AS usuario,
      NOW() AS fecha,
      (SELECT COUNT(*) FROM gmx.pedidos)::int AS pedidos,
      (SELECT COUNT(*) FROM gmx.payment_transactions)::int AS payment_transactions,
      (SELECT COUNT(*) FROM gmx.devoluciones)::int AS devoluciones,
      (SELECT COUNT(*) FROM gmx.devoluciones_reembolsos)::int AS reembolsos,
      (SELECT COUNT(*) FROM gmx.productos)::int AS productos,
      (SELECT COUNT(*) FROM gmx.tcg_buylist)::int AS buylist
  `);

  console.table(info.rows);

  console.log("");
  console.log("============================================================");
  console.log("TEST RESIDUE CHECK");
  console.log("============================================================");

  const residue = await query(`
    SELECT

      (
        SELECT COUNT(*)
        FROM gmx.payment_transactions
        WHERE COALESCE(provider_payment_id,'') LIKE 'POS003-%'
           OR COALESCE(provider_payment_id,'') LIKE 'MP006-%'
           OR COALESCE(provider_payment_id,'') LIKE 'MP007-%'
           OR COALESCE(provider_payment_id,'') LIKE 'DEV007-%'
           OR COALESCE(idempotency_key,'') LIKE '%POS003%'
      )::int AS payment_test_rows,

      (
        SELECT COUNT(*)
        FROM gmx.devoluciones
        WHERE UPPER(COALESCE(motivo,'')) = 'TEST'
           OR UPPER(COALESCE(notas,'')) LIKE '%TEST%'
      )::int AS return_test_rows,

      (
        SELECT COUNT(*)
        FROM gmx.productos
        WHERE UPPER(COALESCE(sku,'')) LIKE 'TEST-%'
           OR UPPER(COALESCE(nombre,'')) LIKE '%PRODUCT TEST%'
           OR UPPER(COALESCE(nombre,'')) LIKE '%TEST PRODUCTOS%'
      )::int AS product_test_rows,

      (
        SELECT COUNT(*)
        FROM gmx.devoluciones_reembolsos
        WHERE COALESCE(id_reembolso,'') LIKE 'REEMB-MP006-%'
           OR COALESCE(id_reembolso,'') LIKE 'REEMB-MP007-%'
           OR COALESCE(payment_id,'') LIKE 'DEV007-%'
      )::int AS refund_test_rows
  `);

  console.table(residue.rows);

  const r = residue.rows[0];

  if (
  r.payment_test_rows !== 0 ||
  r.return_test_rows !== 0 ||
  r.product_test_rows !== 0 ||
  r.refund_test_rows !== 0)
  {
    throw new Error("TEST_RESIDUE_FOUND");
  }

  console.log("");
  console.log("DATABASE_CONNECTION=PASS");
  console.log("GLOBAL_TEST_RESIDUE=0 PASS");
  console.log("");
  console.log("CHECKPOINT_DATABASE_PRECHECK=PASS");

} catch (e) {

  console.error("");
  console.error("CHECKPOINT_DATABASE_PRECHECK=FAIL");
  console.error(e.message);

  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}

}
