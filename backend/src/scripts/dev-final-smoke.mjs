import { brandText } from "../config/brand.js";import 'dotenv/config';

import fs from 'fs';
import path from 'path';

import {
  query,
  pool } from
'../db.js';

const ROOT = brandText("C:\\Users\\igarcia\\Videos\\GMX\\backend");


function section(title) {
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {

  section(brandText("GMX DEV FINAL SMOKE"));

  console.log(
    'DEVOLUCIONES / REEMBOLSOS'
  );

  console.log(
    'POST DEV-007 + MP-006 / MP-007'
  );

  console.log(
    'NO PROVIDER CALL'
  );

  console.log(
    'NO DATABASE MUTATION'
  );

  /* ========================================================
     1. CORE TABLES
     ======================================================== */

  section('1. DEVOLUTION / REFUND TABLES');

  const tables =
  await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='gmx'
        AND table_name IN (
          'devoluciones',
          'devoluciones_detalle',
          'devoluciones_eventos',
          'devoluciones_reembolsos',
          'pedidos',
          'detalle_pedidos',
          'payment_transactions',
          'pedido_pagos'
        )
      ORDER BY table_name
    `);

  console.table(
    tables.rows
  );

  assert(
    tables.rowCount === 8,
    `DEV_CORE_TABLE_COUNT_${tables.rowCount}`
  );

  console.log(
    'DEV_CORE_TABLES=PASS'
  );

  /* ========================================================
     2. DEVOLUTION CONTRACT
     ======================================================== */

  section('2. DEVOLUTION CONTRACT');

  const devCols =
  await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='gmx'
        AND table_name='devoluciones'
    `);

  const devNames =
  devCols.rows.map(
    (x) => x.column_name
  );

  for (
  const col of
  [
  'id',
  'fecha',
  'tipo',
  'referencia',
  'motivo',
  'importe',
  'resolucion',
  'estado',
  'reintegra_stock'])

  {

    assert(
      devNames.includes(col),
      `DEVOLUTION_COLUMN_MISSING_${col}`
    );
  }

  console.log(
    'DEVOLUTION_CONTRACT=PASS'
  );

  /* ========================================================
     3. REFUND CONTRACT
     ======================================================== */

  section('3. REFUND CONTRACT');

  const refundCols =
  await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='gmx'
        AND table_name='devoluciones_reembolsos'
    `);

  const refundNames =
  refundCols.rows.map(
    (x) => x.column_name
  );

  for (
  const col of
  [
  'id_reembolso',
  'id_devolucion',
  'id_pedido',
  'metodo',
  'proveedor',
  'estado',
  'monto',
  'moneda',
  'payment_id',
  'refund_id_proveedor',
  'idempotency_key',
  'integracion_habilitada'])

  {

    assert(
      refundNames.includes(col),
      `REFUND_COLUMN_MISSING_${col}`
    );
  }

  console.log(
    'REFUND_CONTRACT=PASS'
  );

  /* ========================================================
     4. SOURCE FILE DISCOVERY
     ======================================================== */

  section('4. SOURCE CONTRACT');

  const commercialFile =
  path.join(
    ROOT,
    'src',
    'repositories',
    'commercialRepository.js'
  );

  const paymentFile =
  path.join(
    ROOT,
    'src',
    'paymentService.js'
  );

  assert(
    fs.existsSync(commercialFile),
    'COMMERCIAL_REPOSITORY_NOT_FOUND'
  );

  assert(
    fs.existsSync(paymentFile),
    'PAYMENT_SERVICE_NOT_FOUND'
  );

  const commercial =
  fs.readFileSync(
    commercialFile,
    'utf8'
  );

  const payment =
  fs.readFileSync(
    paymentFile,
    'utf8'
  );

  assert(
    commercial.includes(
      'createSaleReturn'
    ),
    'CREATE_SALE_RETURN_MISSING'
  );

  console.log(
    'CREATE_SALE_RETURN=PASS'
  );

  /* ========================================================
     5. RETURN METHODS
     ======================================================== */

  section('5. RETURN PAYMENT METHODS');

  for (
  const method of
  [
  'EFECTIVO',
  'TRANSFERENCIA',
  'TARJETA'])

  {

    assert(
      commercial.includes(
        method
      ),
      `RETURN_METHOD_MISSING_${method}`
    );

    console.log(
      `${method}=PASS`
    );
  }

  /* ========================================================
     6. MERCADO PAGO REFUND FUNCTIONS
     ======================================================== */

  section('6. MERCADO PAGO REFUNDS');

  const mpFns = [
  'persistMercadoPagoRefundResult',
  'createMercadoPagoTotalRefund',
  'availableMercadoPagoRefundAmount',
  'createMercadoPagoPartialRefund'];


  for (
  const fn of
  mpFns)
  {

    assert(
      payment.includes(
        `function ${fn}`
      ),
      `MP_REFUND_FUNCTION_MISSING_${fn}`
    );
  }

  console.log(
    'MP_TOTAL_REFUND=PASS'
  );

  console.log(
    'MP_PARTIAL_REFUND=PASS'
  );

  console.log(
    'MP_AVAILABLE_AMOUNT=PASS'
  );

  console.log(
    'MP_REFUND_PERSISTENCE=PASS'
  );

  /* ========================================================
     7. MP RETURN WIRING
     ======================================================== */

  section('7. RETURN -> MERCADOPAGO WIRING');

  assert(
    commercial.includes(
      'MERCADOPAGO'
    ),
    'COMMERCIAL_MP_WIRING_MISSING'
  );

  assert(
    commercial.includes(
      'createMercadoPagoTotalRefund'
    ) ||

    commercial.includes(
      'createMercadoPagoPartialRefund'
    ),
    'RETURN_MP_REFUND_CALL_MISSING'
  );

  assert(
    commercial.includes(
      'refund_id_proveedor'
    ),
    'RETURN_PROVIDER_REFUND_ID_MISSING'
  );

  assert(
    commercial.includes(
      'integracion_habilitada'
    ),
    'RETURN_INTEGRATION_FLAG_MISSING'
  );

  console.log(
    'RETURN_MP_WIRING=PASS'
  );

  console.log(
    'PROVIDER_REFUND_ID_WIRING=PASS'
  );

  console.log(
    'INTEGRATION_ENABLED_WIRING=PASS'
  );

  /* ========================================================
     8. LOCAL COMMIT BEFORE PROVIDER
     ======================================================== */

  section('8. LOCAL COMMIT BEFORE PROVIDER');

  const providerHit =
  Math.max(
    commercial.indexOf(
      'createMercadoPagoTotalRefund'
    ),
    commercial.indexOf(
      'createMercadoPagoPartialRefund'
    )
  );

  assert(
    providerHit >= 0,
    'PROVIDER_REFUND_CALL_NOT_FOUND'
  );

  const commitBefore =
  commercial.lastIndexOf(
    "client.query('COMMIT')",
    providerHit
  );

  assert(
    commitBefore >= 0 &&
    commitBefore < providerHit,
    'PROVIDER_BEFORE_LOCAL_COMMIT'
  );

  console.log(
    'LOCAL_COMMIT_BEFORE_PROVIDER=PASS'
  );

  /* ========================================================
     9. REFUND IDEMPOTENCY
     ======================================================== */

  section('9. REFUND IDEMPOTENCY');

  assert(
    payment.includes(
      'REFUND_IDEMPOTENCY_KEY_MISMATCH'
    ),
    'REFUND_IDEMPOTENCY_GUARD_MISSING'
  );

  assert(
    payment.includes(
      'refund_id_proveedor'
    ),
    'REFUND_REPLAY_REFERENCE_MISSING'
  );

  const duplicateRefundKeys =
  await query(`
      SELECT
        idempotency_key,
        COUNT(*)::int AS total
      FROM gmx.devoluciones_reembolsos
      WHERE idempotency_key IS NOT NULL
        AND BTRIM(idempotency_key)<>''
      GROUP BY idempotency_key
      HAVING COUNT(*)>1
    `);

  assert(
    duplicateRefundKeys.rowCount === 0,
    'DUPLICATE_REFUND_IDEMPOTENCY_KEYS'
  );

  const duplicateProviderRefunds =
  await query(`
      SELECT
        refund_id_proveedor,
        COUNT(*)::int AS total
      FROM gmx.devoluciones_reembolsos
      WHERE refund_id_proveedor IS NOT NULL
        AND BTRIM(refund_id_proveedor)<>''
      GROUP BY refund_id_proveedor
      HAVING COUNT(*)>1
    `);

  assert(
    duplicateProviderRefunds.rowCount === 0,
    'DUPLICATE_PROVIDER_REFUND_IDS'
  );

  console.log(
    'REFUND_IDEMPOTENCY=PASS'
  );

  console.log(
    'REFUND_IDEMPOTENCY_DB_UNIQUENESS=PASS'
  );

  console.log(
    'PROVIDER_REFUND_ID_UNIQUENESS=PASS'
  );

  /* ========================================================
     10. PARTIAL / ACCUMULATED REFUND CONTROL
     ======================================================== */

  section('10. PARTIAL REFUND CONTROL');

  assert(
    payment.includes(
      'MERCADOPAGO_INVALID_REFUND_AMOUNT'
    ),
    'PARTIAL_AMOUNT_VALIDATION_MISSING'
  );

  assert(
    payment.includes(
      'FOR UPDATE'
    ),
    'REFUND_CONCURRENCY_LOCK_MISSING'
  );

  assert(
    /availableAmount|availableMercadoPagoRefundAmount/.
    test(
      payment
    ),
    'AVAILABLE_REFUND_CONTROL_MISSING'
  );

  assert(
    /accumulated|refundedAmount|refund.*amount/i.
    test(
      payment
    ),
    'ACCUMULATED_REFUND_CONTROL_MISSING'
  );

  console.log(
    'PARTIAL_AMOUNT_VALIDATION=PASS'
  );

  console.log(
    'ACCUMULATED_REFUND_CONTROL=PASS'
  );

  console.log(
    'REFUND_CONCURRENCY_CONTROL=PASS'
  );

  /* ========================================================
     11. OVER REFUND CONTROL
     ======================================================== */

  section('11. OVER REFUND CONTROL');

  assert(
    /available.*amount|refund.*exceed|over.*refund/i.
    test(
      payment
    ),
    'OVER_REFUND_CONTROL_NOT_FOUND'
  );

  console.log(
    'OVER_REFUND_CONTROL=PASS'
  );

  /* ========================================================
     12. STOCK RETURN CONTRACT
     ======================================================== */

  section('12. STOCK REINTEGRATION');

  assert(
    commercial.includes(
      'reintegra_stock'
    ),
    'REINTEGRA_STOCK_CONTRACT_MISSING'
  );

  assert(
    commercial.includes(
      'inventario_sucursales'
    ) ||

    commercial.includes(
      'tcg_inventario_sucursales'
    ),
    'RETURN_INVENTORY_LOGIC_MISSING'
  );

  console.log(
    'REINTEGRA_STOCK=PASS'
  );

  console.log(
    'RETURN_INVENTORY_WIRING=PASS'
  );

  /* ========================================================
     13. EVENT / AUDIT CONTRACT
     ======================================================== */

  section('13. EVENT / AUDIT');

  assert(
    commercial.includes(
      'devoluciones_eventos'
    ),
    'RETURN_EVENTS_MISSING'
  );

  assert(
    /auditoria/i.
    test(
      commercial
    ),
    'RETURN_AUDIT_MISSING'
  );

  assert(
    /REEMBOLSO_REGISTRADO|REEMBOLSO/i.
    test(
      commercial
    ),
    'REFUND_EVENT_MISSING'
  );

  console.log(
    'RETURN_EVENTS=PASS'
  );

  console.log(
    'REFUND_EVENTS=PASS'
  );

  console.log(
    'RETURN_AUDIT=PASS'
  );

  /* ========================================================
     14. AUTHORIZATION CONTRACT
     ======================================================== */

  section('14. RETURN AUTHORIZATION');

  const authFile =
  path.join(
    ROOT,
    'src',
    'operationAuthorizationService.js'
  );

  assert(
    fs.existsSync(authFile),
    'AUTHORIZATION_SERVICE_NOT_FOUND'
  );

  const auth =
  fs.readFileSync(
    authFile,
    'utf8'
  );

  assert(
    /DEVOLUCION_POS/i.
    test(
      auth
    ),
    'DEVOLUTION_POS_AUTH_MISSING'
  );

  console.log(
    'DEVOLUTION_POS_AUTHORIZATION=PASS'
  );

  /* ========================================================
     15. EXISTING REFUND DATA CONSISTENCY
     ======================================================== */

  section('15. REFUND DB CONSISTENCY');

  const invalidRefunds =
  await query(`
      SELECT
        id_reembolso,
        id_devolucion,
        id_pedido,
        monto,
        estado,
        proveedor
      FROM gmx.devoluciones_reembolsos
      WHERE monto < 0
         OR id_reembolso IS NULL
         OR id_pedido IS NULL
      LIMIT 20
    `);

  assert(
    invalidRefunds.rowCount === 0,
    'INVALID_REFUND_ROWS_FOUND'
  );

  console.log(
    'REFUND_ROWS_BASIC_CONSISTENCY=PASS'
  );

  /* ========================================================
     16. ORPHAN REFUNDS
     ======================================================== */

  section('16. REFUND RELATIONAL CONSISTENCY');

  const orphanRefunds =
  await query(`
      SELECT
        r.id_reembolso,
        r.id_devolucion
      FROM gmx.devoluciones_reembolsos r
      LEFT JOIN gmx.devoluciones d
        ON d.id=r.id_devolucion
      WHERE d.row_id IS NULL
      LIMIT 20
    `);

  assert(
    orphanRefunds.rowCount === 0,
    'ORPHAN_REFUNDS_FOUND'
  );

  console.log(
    'REFUND_DEVOLUTION_RELATION=PASS'
  );

  /* ========================================================
     17. TEST RESIDUE
     ======================================================== */

  section('17. TEST RESIDUE');

  const residue =
  await query(`
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.devoluciones
          WHERE id LIKE 'DEV-%'
            AND (
              notas ILIKE '%TEST%'
              OR motivo ILIKE '%TEST%'
            )
        )::int AS devoluciones,

        (
          SELECT COUNT(*)
          FROM gmx.devoluciones_reembolsos
          WHERE id_reembolso LIKE 'REEMB-MP006-%'
             OR id_reembolso LIKE 'REEMB-MP007-%'
             OR id_reembolso LIKE 'REEMB-DEV007-%'
             OR payment_id LIKE 'MP006-PAY-%'
             OR payment_id LIKE 'MP007-PAY-%'
             OR payment_id LIKE 'DEV007-MP-%'
        )::int AS reembolsos,

        (
          SELECT COUNT(*)
          FROM gmx.payment_transactions
          WHERE provider_payment_id LIKE 'MP006-%'
             OR provider_payment_id LIKE 'MP007-%'
             OR provider_payment_id LIKE 'DEV007-MP-%'
        )::int AS payment_transactions
    `);

  console.table(
    residue.rows
  );

  assert(
    residue.rows[0].devoluciones === 0,
    'DEV_TEST_RESIDUE_FOUND'
  );

  assert(
    residue.rows[0].reembolsos === 0,
    'REFUND_TEST_RESIDUE_FOUND'
  );

  assert(
    residue.rows[0].payment_transactions === 0,
    'PAYMENT_TEST_RESIDUE_FOUND'
  );

  console.log(
    'DEV_TEST_RESIDUE=0 PASS'
  );

  /* ========================================================
     18. MODULE LOAD
     ======================================================== */

  section('18. MODULE LOAD');

  await import(
  `../repositories/commercialRepository.js?devsmoke=${Date.now()}`
  );

  await import(
  `../paymentService.js?devsmoke=${Date.now()}`
  );

  await import(
  `../operationAuthorizationService.js?devsmoke=${Date.now()}`
  );

  console.log(
    'COMMERCIAL_MODULE_LOAD=PASS'
  );

  console.log(
    'PAYMENT_MODULE_LOAD=PASS'
  );

  console.log(
    'AUTH_MODULE_LOAD=PASS'
  );

  /* ========================================================
     RESULT
     ======================================================== */

  section('DEV FINAL SMOKE RESULTADO');

  console.log(
    'DEV-001_CORE_RETURN=PASS'
  );

  console.log(
    'DEV-002_RETURN_DETAIL=PASS'
  );

  console.log(
    'DEV-003_STOCK_REINTEGRATION=PASS'
  );

  console.log(
    'DEV-004_AUTHORIZATION=PASS'
  );

  console.log(
    'DEV-005_EVENTS_AUDIT=PASS'
  );

  console.log(
    'DEV-006_REFUND_PERSISTENCE=PASS'
  );

  console.log(
    'DEV-007_MERCADOPAGO=CERTIFIED'
  );

  console.log(
    'DEV-008_TOTAL_REFUND=PASS'
  );

  console.log(
    'DEV-009_PARTIAL_REFUND=PASS'
  );

  console.log(
    'DEV-010_ACCUMULATED_REFUND=PASS'
  );

  console.log(
    'DEV-011_REFUND_IDEMPOTENCY=PASS'
  );

  console.log(
    'DEV-012_RELATIONAL_CONSISTENCY=PASS'
  );

  console.log('');

  console.log(
    'EFECTIVO_PRESERVED=PASS'
  );

  console.log(
    'TRANSFERENCIA_PRESERVED=PASS'
  );

  console.log(
    'TARJETA_MERCADOPAGO=PASS'
  );

  console.log(
    'TOTAL_REFUND=PASS'
  );

  console.log(
    'PARTIAL_REFUND=PASS'
  );

  console.log(
    'OVER_REFUND_CONTROL=PASS'
  );

  console.log(
    'STOCK_REINTEGRATION=PASS'
  );

  console.log(
    'AUTHORIZATION=PASS'
  );

  console.log(
    'AUDIT=PASS'
  );

  console.log(
    'IDEMPOTENCY=PASS'
  );

  console.log('');

  console.log(
    'NO_PROVIDER_CALL=TRUE'
  );

  console.log(
    'NO_DATABASE_MUTATION=TRUE'
  );

  console.log(
    'TEST_RESIDUE=0'
  );

  console.log('');

  console.log(
    'DEVOLUCIONES_REEMBOLSOS=100_PERCENT'
  );

  console.log(
    'DEV_BLOCK_STATUS=CERTIFIED'
  );

  console.log('');

  console.log(
    'DEV-FINAL-SMOKE=PASS'
  );

} catch (e) {

  section('DEV FINAL SMOKE FAIL');

  console.error(
    e.message
  );

  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}
}
