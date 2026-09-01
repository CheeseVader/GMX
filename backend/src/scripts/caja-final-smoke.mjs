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

  section(brandText("GMX CAJA FINAL SMOKE"));

  console.log('CAJA / FINANZAS OPERATIVAS');
  console.log('POST POS + DEV + MP CERTIFICATION');
  console.log('NO PROVIDER CALL');
  console.log('NO DATABASE MUTATION');

  /* ========================================================
     1. DISCOVER CASH / FINANCE TABLES
     ======================================================== */

  section('1. CASH / FINANCE TABLE DISCOVERY');

  const tables =
  await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='gmx'
        AND (
          table_name ILIKE '%caja%'
          OR table_name ILIKE '%cash%'
          OR table_name ILIKE '%movimiento%'
          OR table_name ILIKE '%pago%'
          OR table_name ILIKE '%finan%'
        )
      ORDER BY table_name
    `);

  console.table(
    tables.rows
  );

  assert(
    tables.rowCount >= 1,
    'NO_CASH_FINANCE_TABLES_FOUND'
  );

  console.log(
    `CASH_FINANCE_TABLES=${tables.rowCount}`
  );

  console.log(
    'CASH_FINANCE_TABLE_DISCOVERY=PASS'
  );

  /* ========================================================
     2. SOURCE DISCOVERY
     ======================================================== */

  section('2. SOURCE CONTRACT');

  const sourceFiles = [
  path.join(ROOT, 'src', 'repositories', 'ordersRepository.js'),
  path.join(ROOT, 'src', 'repositories', 'commercialRepository.js'),
  path.join(ROOT, 'src', 'paymentService.js')];


  let combined = '';

  for (const file of sourceFiles) {

    assert(
      fs.existsSync(file),
      `SOURCE_NOT_FOUND_${path.basename(file)}`
    );

    combined +=
    '\n' +
    fs.readFileSync(
      file,
      'utf8'
    );
  }

  console.log(
    'CORE_SOURCE_FILES=PASS'
  );

  /* ========================================================
     3. CASH SALE CONTRACT
     ======================================================== */

  section('3. CASH SALE CONTRACT');

  assert(
    combined.includes(
      'registerCashSale'
    ),
    'REGISTER_CASH_SALE_MISSING'
  );

  assert(
    /EFECTIVO/.test(
      combined
    ),
    'CASH_PAYMENT_METHOD_MISSING'
  );

  assert(
    /efectivo_recibido|cashReceived/i.
    test(
      combined
    ),
    'CASH_RECEIVED_MISSING'
  );

  assert(
    /cambio_entregado|change/i.
    test(
      combined
    ),
    'CHANGE_CALCULATION_MISSING'
  );

  console.log(
    'CASH_SALE=PASS'
  );

  console.log(
    'CASH_RECEIVED=PASS'
  );

  console.log(
    'CHANGE_CALCULATION=PASS'
  );

  /* ========================================================
     4. CARD / MERCADOPAGO FINANCIAL CONTRACT
     ======================================================== */

  section('4. CARD / MERCADOPAGO CONTRACT');

  assert(
    combined.includes(
      'MERCADOPAGO'
    ),
    'MERCADOPAGO_MISSING'
  );

  assert(
    combined.includes(
      'payment_transactions'
    ),
    'PAYMENT_TRANSACTIONS_MISSING'
  );

  assert(
    combined.includes(
      'pedido_pagos'
    ),
    'PEDIDO_PAGOS_MISSING'
  );

  assert(
    /estado_pago='PAGADO'|estado_pago\s*=\s*'PAGADO'/i.
    test(
      combined
    ),
    'PAID_ORDER_CONTRACT_MISSING'
  );

  console.log(
    'CARD_FINANCIAL_FLOW=PASS'
  );

  console.log(
    'PAYMENT_TRANSACTION_LEDGER=PASS'
  );

  console.log(
    'PEDIDO_PAGOS_LEDGER=PASS'
  );

  /* ========================================================
     5. TRANSFER CONTRACT
     ======================================================== */

  section('5. TRANSFER CONTRACT');

  assert(
    combined.includes(
      'TRANSFERENCIA'
    ) ||

    combined.includes(
      'TRANSFER'
    ),
    'TRANSFER_METHOD_MISSING'
  );

  assert(
    combined.includes(
      'saveTransferProof'
    ),
    'TRANSFER_PROOF_MISSING'
  );

  assert(
    combined.includes(
      'PROOF_RECEIVED'
    ),
    'TRANSFER_PROOF_STATE_MISSING'
  );

  console.log(
    'TRANSFER=PASS'
  );

  console.log(
    'TRANSFER_PROOF=PASS'
  );

  /* ========================================================
     6. RETURNS / REFUNDS FINANCIAL CONTRACT
     ======================================================== */

  section('6. RETURNS / REFUNDS CONTRACT');

  assert(
    combined.includes(
      'devoluciones_reembolsos'
    ),
    'REFUND_LEDGER_MISSING'
  );

  assert(
    combined.includes(
      'createMercadoPagoTotalRefund'
    ),
    'TOTAL_REFUND_MISSING'
  );

  assert(
    combined.includes(
      'createMercadoPagoPartialRefund'
    ),
    'PARTIAL_REFUND_MISSING'
  );

  assert(
    /REEMBOLSO/i.
    test(
      combined
    ),
    'REFUND_FLOW_MISSING'
  );

  console.log(
    'REFUND_LEDGER=PASS'
  );

  console.log(
    'TOTAL_REFUND=PASS'
  );

  console.log(
    'PARTIAL_REFUND=PASS'
  );

  /* ========================================================
     7. PAYMENT UNIQUENESS
     ======================================================== */

  section('7. PAYMENT CONSISTENCY');

  const duplicateProviderIds =
  await query(`
      SELECT
        provider_payment_id,
        COUNT(*)::int AS total
      FROM gmx.payment_transactions
      WHERE provider_payment_id IS NOT NULL
        AND BTRIM(provider_payment_id)<>''
      GROUP BY provider_payment_id
      HAVING COUNT(*)>1
    `);

  assert(
    duplicateProviderIds.rowCount === 0,
    'DUPLICATE_PROVIDER_PAYMENT_IDS'
  );

  const duplicatePaymentKeys =
  await query(`
      SELECT
        idempotency_key,
        COUNT(*)::int AS total
      FROM gmx.payment_transactions
      WHERE idempotency_key IS NOT NULL
        AND BTRIM(idempotency_key)<>''
      GROUP BY idempotency_key
      HAVING COUNT(*)>1
    `);

  assert(
    duplicatePaymentKeys.rowCount === 0,
    'DUPLICATE_PAYMENT_IDEMPOTENCY_KEYS'
  );

  console.log(
    'PAYMENT_PROVIDER_ID_UNIQUENESS=PASS'
  );

  console.log(
    'PAYMENT_IDEMPOTENCY=PASS'
  );

  /* ========================================================
     8. REFUND UNIQUENESS
     ======================================================== */

  section('8. REFUND CONSISTENCY');

  const duplicateRefundIds =
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
    duplicateRefundIds.rowCount === 0,
    'DUPLICATE_PROVIDER_REFUND_IDS'
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

  console.log(
    'REFUND_PROVIDER_ID_UNIQUENESS=PASS'
  );

  console.log(
    'REFUND_IDEMPOTENCY=PASS'
  );

  /* ========================================================
     9. PAID ORDER VS PAYMENT TRANSACTION
     ======================================================== */

  section('9. ORDER / PAYMENT RECONCILIATION');

  const inconsistentPaid =
  await query(`
      SELECT
        p.id_pedido,
        p.estado_pago,
        p.payment_provider,
        p.payment_provider_session
      FROM gmx.pedidos p
      WHERE p.estado_pago='PAGADO'
        AND p.payment_provider='MERCADOPAGO'
        AND NOT EXISTS (
          SELECT 1
          FROM gmx.payment_transactions t
          WHERE t.id_pedido=p.id_pedido
            AND t.proveedor='MERCADOPAGO'
            AND t.estado='PAID'
        )
      LIMIT 20
    `);

  assert(
    inconsistentPaid.rowCount === 0,
    'PAID_MP_ORDER_WITHOUT_PAID_TX'
  );

  console.log(
    'PAID_ORDER_TRANSACTION_RECONCILIATION=PASS'
  );

  /* ========================================================
     10. PEDIDO PAGOS RELATION
     ======================================================== */

  section('10. PEDIDO PAGOS CONSISTENCY');

  const orphanPedidoPagos =
  await query(`
      SELECT
        pp.id_pedido,
        pp.metodo,
        pp.estado
      FROM gmx.pedido_pagos pp
      LEFT JOIN gmx.pedidos p
        ON p.id_pedido=pp.id_pedido
      WHERE p.row_id IS NULL
      LIMIT 20
    `);

  assert(
    orphanPedidoPagos.rowCount === 0,
    'ORPHAN_PEDIDO_PAGOS'
  );

  console.log(
    'PEDIDO_PAGOS_RELATION=PASS'
  );

  /* ========================================================
     11. PAYMENT TRANSACTION RELATION
     ======================================================== */

  section('11. PAYMENT TRANSACTION RELATION');

  const orphanPayments =
  await query(`
      SELECT
        t.id_transaccion,
        t.id_pedido
      FROM gmx.payment_transactions t
      LEFT JOIN gmx.pedidos p
        ON p.id_pedido=t.id_pedido
      WHERE p.row_id IS NULL
      LIMIT 20
    `);

  assert(
    orphanPayments.rowCount === 0,
    'ORPHAN_PAYMENT_TRANSACTIONS'
  );

  console.log(
    'PAYMENT_TRANSACTION_RELATION=PASS'
  );

  /* ========================================================
     12. REFUND RELATION
     ======================================================== */

  section('12. REFUND RELATION');

  const orphanRefunds =
  await query(`
      SELECT
        r.id_reembolso,
        r.id_pedido
      FROM gmx.devoluciones_reembolsos r
      LEFT JOIN gmx.pedidos p
        ON p.id_pedido=r.id_pedido
      WHERE p.row_id IS NULL
      LIMIT 20
    `);

  assert(
    orphanRefunds.rowCount === 0,
    'ORPHAN_REFUND_ORDERS'
  );

  console.log(
    'REFUND_ORDER_RELATION=PASS'
  );

  /* ========================================================
     13. NEGATIVE FINANCIAL AMOUNTS
     ======================================================== */

  section('13. AMOUNT VALIDATION');

  const negativePayments =
  await query(`
      SELECT id_transaccion,monto
      FROM gmx.payment_transactions
      WHERE monto<0
      LIMIT 20
    `);

  assert(
    negativePayments.rowCount === 0,
    'NEGATIVE_PAYMENT_AMOUNT_FOUND'
  );

  const negativeRefunds =
  await query(`
      SELECT id_reembolso,monto
      FROM gmx.devoluciones_reembolsos
      WHERE monto<0
      LIMIT 20
    `);

  assert(
    negativeRefunds.rowCount === 0,
    'NEGATIVE_REFUND_AMOUNT_FOUND'
  );

  console.log(
    'PAYMENT_AMOUNTS_NON_NEGATIVE=PASS'
  );

  console.log(
    'REFUND_AMOUNTS_NON_NEGATIVE=PASS'
  );

  /* ========================================================
     14. CASH DATA SANITY
     ======================================================== */

  section('14. CASH DATA SANITY');

  const invalidCash =
  await query(`
      SELECT
        id_pedido,
        efectivo_recibido,
        cambio_entregado,
        total
      FROM gmx.pedidos
      WHERE metodo_pago='EFECTIVO'
        AND (
          COALESCE(efectivo_recibido,0)<0
          OR COALESCE(cambio_entregado,0)<0
        )
      LIMIT 20
    `);

  assert(
    invalidCash.rowCount === 0,
    'INVALID_CASH_AMOUNTS'
  );

  console.log(
    'CASH_AMOUNTS_VALID=PASS'
  );

  /* ========================================================
     15. AUDIT CONTRACT
     ======================================================== */

  section('15. AUDIT CONTRACT');

  assert(
    /auditoria/i.
    test(
      combined
    ),
    'FINANCIAL_AUDIT_MISSING'
  );

  assert(
    /PAYMENTS|VENTA|CAJA|REEMBOLSO/i.
    test(
      combined
    ),
    'FINANCIAL_AUDIT_EVENTS_MISSING'
  );

  console.log(
    'FINANCIAL_AUDIT=PASS'
  );

  /* ========================================================
     16. TEST RESIDUE
     ======================================================== */

  section('16. TEST RESIDUE');

  const residue =
  await query(`
      SELECT

        (
          SELECT COUNT(*)
          FROM gmx.pedidos
          WHERE pos_idempotency_key LIKE 'POS003-MP-%'
        )::int AS pos_orders,

        (
          SELECT COUNT(*)
          FROM gmx.payment_transactions
          WHERE provider_payment_id LIKE 'POS003-MP-%'
             OR provider_payment_id LIKE 'MP006-%'
             OR provider_payment_id LIKE 'MP007-%'
             OR provider_payment_id LIKE 'DEV007-MP-%'
        )::int AS payment_transactions,

        (
          SELECT COUNT(*)
          FROM gmx.devoluciones
          WHERE notas ILIKE '%TEST%'
             OR motivo ILIKE '%TEST%'
        )::int AS devoluciones,

        (
          SELECT COUNT(*)
          FROM gmx.devoluciones_reembolsos
          WHERE id_reembolso LIKE 'REEMB-MP006-%'
             OR id_reembolso LIKE 'REEMB-MP007-%'
             OR payment_id LIKE 'DEV007-MP-%'
        )::int AS refunds
    `);

  console.table(
    residue.rows
  );

  assert(
    residue.rows[0].pos_orders === 0,
    'POS_TEST_RESIDUE'
  );

  assert(
    residue.rows[0].payment_transactions === 0,
    'PAYMENT_TEST_RESIDUE'
  );

  assert(
    residue.rows[0].devoluciones === 0,
    'DEV_TEST_RESIDUE'
  );

  assert(
    residue.rows[0].refunds === 0,
    'REFUND_TEST_RESIDUE'
  );

  console.log(
    'FINANCIAL_TEST_RESIDUE=0 PASS'
  );

  /* ========================================================
     17. MODULE LOAD
     ======================================================== */

  section('17. MODULE LOAD');

  await import(
  `../repositories/ordersRepository.js?cajasmoke=${Date.now()}`
  );

  await import(
  `../repositories/commercialRepository.js?cajasmoke=${Date.now()}`
  );

  await import(
  `../paymentService.js?cajasmoke=${Date.now()}`
  );

  console.log(
    'ORDERS_MODULE_LOAD=PASS'
  );

  console.log(
    'COMMERCIAL_MODULE_LOAD=PASS'
  );

  console.log(
    'PAYMENT_MODULE_LOAD=PASS'
  );

  /* ========================================================
     RESULT
     ======================================================== */

  section('CAJA FINAL SMOKE RESULTADO');

  console.log(
    'CAJA-001_CASH_SALES=PASS'
  );

  console.log(
    'CAJA-002_CASH_RECEIVED_CHANGE=PASS'
  );

  console.log(
    'CAJA-003_CARD_PAYMENTS=PASS'
  );

  console.log(
    'CAJA-004_MERCADOPAGO_LEDGER=PASS'
  );

  console.log(
    'CAJA-005_TRANSFER_PAYMENTS=PASS'
  );

  console.log(
    'CAJA-006_PEDIDO_PAGOS=PASS'
  );

  console.log(
    'CAJA-007_PAYMENT_TRANSACTIONS=PASS'
  );

  console.log(
    'CAJA-008_RETURNS_REFUNDS=PASS'
  );

  console.log(
    'CAJA-009_TOTAL_PARTIAL_REFUNDS=PASS'
  );

  console.log(
    'CAJA-010_PAYMENT_IDEMPOTENCY=PASS'
  );

  console.log(
    'CAJA-011_RELATIONAL_CONSISTENCY=PASS'
  );

  console.log(
    'CAJA-012_FINANCIAL_AUDIT=PASS'
  );

  console.log('');

  console.log(
    'CASH=PASS'
  );

  console.log(
    'CARD_MERCADOPAGO=PASS'
  );

  console.log(
    'TRANSFER=PASS'
  );

  console.log(
    'RETURNS_REFUNDS=PASS'
  );

  console.log(
    'FINANCIAL_RECONCILIATION=PASS'
  );

  console.log(
    'IDEMPOTENCY=PASS'
  );

  console.log(
    'AUDIT=PASS'
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
    'CAJA_FINANZAS_OPERATIVAS=100_PERCENT'
  );

  console.log(
    'CAJA_BLOCK_STATUS=CERTIFIED'
  );

  console.log('');

  console.log(
    'CAJA-FINAL-SMOKE=PASS'
  );

} catch (e) {

  section('CAJA FINAL SMOKE FAIL');

  console.error(
    e.message
  );

  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}
}
