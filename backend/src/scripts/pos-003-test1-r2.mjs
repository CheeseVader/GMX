import { brandText } from "../config/brand.js";import 'dotenv/config';

import { createSale } from './src/repositories/ordersRepository.js';
import { query, pool } from './src/db.js';

const RUN_ID = Date.now();
const SALE_REQUEST_ID = `POS003-MP-R2-${RUN_ID}`;
const PROVIDER_PAYMENT_ID = `POS003-MP-R2-PAY-${RUN_ID}`;

let orderId = null;
let providerCalls = 0;
let selected = null;

function section(title) {
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  section('POS-003-TEST1-R2 CLEANUP');

  if (!orderId) {
    console.log('CLEANUP=NO_ORDER_CREATED');
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (selected?.type === 'PRODUCT') {
      await client.query(
        `UPDATE gmx.inventario_sucursales
         SET stock=$2, fecha_actualizacion=NOW()
         WHERE row_id=$1`,
        [selected.row_id, selected.stock_before]
      );

      await client.query(
        `DELETE FROM gmx.movimientos_inventario_sucursales
         WHERE referencia=$1`,
        [orderId]
      ).catch(() => {});

      console.log('CLEANUP=PRODUCT_INVENTORY_RESTORED');
    }

    if (selected?.type === 'TCG') {
      await client.query(
        `UPDATE gmx.tcg_inventario_sucursales
         SET stock=$2
         WHERE row_id=$1`,
        [selected.branch_row_id, selected.branch_stock_before]
      );

      await client.query(
        `UPDATE gmx.tcg_inventario
         SET stock=$2
         WHERE row_id=$1`,
        [selected.global_row_id, selected.global_stock_before]
      );

      console.log('CLEANUP=TCG_INVENTORY_RESTORED');
    }

    await client.query(
      `DELETE FROM gmx.auditoria WHERE referencia=$1`,
      [orderId]
    ).catch(() => {});

    const tx = await client.query(
      `DELETE FROM gmx.payment_transactions
       WHERE id_pedido=$1 RETURNING id_transaccion`,
      [orderId]
    );
    console.log(`CLEANUP=PAYMENT_TRANSACTIONS ${tx.rowCount} ELIMINADAS`);

    const pp = await client.query(
      `DELETE FROM gmx.pedido_pagos
       WHERE id_pedido=$1 RETURNING *`,
      [orderId]
    ).catch(() => ({ rowCount: 0 }));
    console.log(`CLEANUP=PEDIDO_PAGOS ${pp.rowCount} ELIMINADOS`);

    const det = await client.query(
      `DELETE FROM gmx.detalle_pedidos
       WHERE id_pedido=$1 RETURNING id_detalle`,
      [orderId]
    );
    console.log(`CLEANUP=DETALLES ${det.rowCount} ELIMINADOS`);

    const ord = await client.query(
      `DELETE FROM gmx.pedidos
       WHERE id_pedido=$1 RETURNING id_pedido`,
      [orderId]
    );
    console.log(`CLEANUP=PEDIDO ${ord.rowCount} ELIMINADO`);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('CLEANUP_ERROR=', e.message);
  } finally {
    client.release();
  }

  const verify = await query(
    `SELECT
      (SELECT COUNT(*) FROM gmx.pedidos WHERE id_pedido=$1)::int AS pedidos,
      (SELECT COUNT(*) FROM gmx.payment_transactions WHERE id_pedido=$1)::int AS payments,
      (SELECT COUNT(*) FROM gmx.detalle_pedidos WHERE id_pedido=$1)::int AS detalles`,
    [orderId]
  );

  const v = verify.rows[0];
  assert(v.pedidos === 0 && v.payments === 0 && v.detalles === 0, 'CLEANUP_VERIFY_FAILED');
  console.log('CLEANUP_VERIFY=PASS');
}

try {
  section(brandText("GMX POS-003-TEST1-R2"));
  console.log('VENTA TARJETA / MERCADO PAGO');
  console.log('FLUJO REAL createSale()');
  console.log('PROVIDER SIMULADO');
  console.log('FIX: TCG SIN JOIN A tcg_master_cards');

  section('1. INVENTORY CANDIDATE');

  const products = await query(
    `SELECT
       i.row_id,
       i.id_inventario,
       i.id_producto,
       i.id_sucursal,
       i.sucursal,
       i.stock,
       i.precio_venta,
       p.nombre
     FROM gmx.inventario_sucursales i
     JOIN gmx.productos p ON p.id_producto=i.id_producto
     WHERE COALESCE(i.stock,0)>=2
       AND COALESCE(i.precio_venta,0)>0
     ORDER BY i.stock DESC
     LIMIT 20`
  ).catch(() => ({ rowCount: 0, rows: [] }));

  if (products.rowCount) {
    const p = products.rows[0];
    selected = {
      type: 'PRODUCT',
      row_id: p.row_id,
      id_inventario: p.id_inventario,
      id_producto: p.id_producto,
      id_sucursal: p.id_sucursal,
      sucursal: p.sucursal,
      stock_before: Number(p.stock),
      price: Number(p.precio_venta),
      nombre: p.nombre
    };
  } else {
    const tcg = await query(
      `SELECT
        s.row_id AS branch_row_id,
        s.id_inventario,
        s.id_sucursal,
        s.sucursal,
        s.stock AS branch_stock,
        g.row_id AS global_row_id,
        g.id_carta,
        g.sku,
        g.stock AS global_stock,
        g.precio_venta
       FROM gmx.tcg_inventario_sucursales s
       JOIN gmx.tcg_inventario g
         ON g.id_inventario=s.id_inventario
       WHERE COALESCE(s.stock,0)>=2
         AND COALESCE(g.stock,0)>=2
         AND COALESCE(g.precio_venta,0)>0
       ORDER BY s.stock DESC
       LIMIT 20`
    );

    assert(tcg.rowCount >= 1, 'NO_SAFE_INVENTORY_CANDIDATE');

    const t = tcg.rows[0];
    selected = {
      type: 'TCG',
      branch_row_id: t.branch_row_id,
      global_row_id: t.global_row_id,
      id_inventario: t.id_inventario,
      id_carta: t.id_carta,
      id_sucursal: t.id_sucursal,
      sucursal: t.sucursal,
      sku: t.sku,
      branch_stock_before: Number(t.branch_stock),
      global_stock_before: Number(t.global_stock),
      price: Number(t.precio_venta),
      nombre: t.sku
    };
  }

  console.dir(selected, { depth: 4 });
  console.log('INVENTORY_CANDIDATE=PASS');

  section('2. CONTROLLED MERCADOPAGO PROVIDER');

  const providerCall = async ({ body, order, idempotencyKey }) => {
    providerCalls++;

    assert(order?.id_pedido, 'PROVIDER_ORDER_ID_MISSING');
    assert(Number(body?.transaction_amount) > 0, 'PROVIDER_AMOUNT_INVALID');
    assert(String(idempotencyKey || '').length > 0, 'PROVIDER_IDEMPOTENCY_MISSING');

    return {
      id: PROVIDER_PAYMENT_ID,
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: Number(body.transaction_amount),
      currency_id: 'MXN',
      payment_method_id: 'visa',
      payment_type_id: 'credit_card',
      external_reference: order.id_pedido,
      date_created: new Date().toISOString(),
      date_approved: new Date().toISOString()
    };
  };

  console.log('CONTROLLED_PROVIDER=READY');

  section('3. CREATE SALE');

  const item = selected.type === 'PRODUCT' ?
  {
    type: 'PRODUCT',
    itemType: 'PRODUCT',
    idProducto: selected.id_producto,
    id_producto: selected.id_producto,
    idInventario: selected.id_inventario,
    id_inventario: selected.id_inventario,
    quantity: 1,
    cantidad: 1
  } :
  {
    type: 'TCG',
    itemType: 'TCG',
    idInventario: selected.id_inventario,
    id_inventario: selected.id_inventario,
    idCarta: selected.id_carta,
    id_carta: selected.id_carta,
    sku: selected.sku,
    quantity: 1,
    cantidad: 1
  };

  const sale = await createSale({
    branchId: selected.id_sucursal,
    saleRequestId: SALE_REQUEST_ID,
    paymentMethod: 'TARJETA',
    payments: [{
      method: 'TARJETA',
      amount: null,
      provider: 'MERCADOPAGO'
    }],
    paymentProviderInput: {
      token: `TEST-TOKEN-${RUN_ID}`,
      paymentMethodId: 'visa',
      email: 'pos003-test@gmx.local',
      installments: 1,
      providerCall
    },
    notes: 'POS-003 TEST R2 CONTROLADO',
    user: {
      id_admin: 'LOCAL',
      nombre: 'POS-003 TEST',
      email: 'pos003-test@gmx.local'
    },
    items: [item]
  });

  console.dir(sale, { depth: 5 });
  assert(sale?.id_pedido, 'SALE_ORDER_ID_MISSING');

  orderId = sale.id_pedido;
  console.log(`ORDER=${orderId}`);
  console.log('CREATE_SALE=PASS');

  section('4. ORDER VERIFY');

  const orderResult = await query(
    `SELECT * FROM gmx.pedidos WHERE id_pedido=$1`,
    [orderId]
  );

  assert(orderResult.rowCount === 1, 'ORDER_NOT_PERSISTED');
  const order = orderResult.rows[0];
  console.table(orderResult.rows);

  assert(String(order.metodo_pago || '').toUpperCase() === 'TARJETA', 'ORDER_PAYMENT_METHOD_INVALID');
  assert(String(order.estado_pago || '').toUpperCase() === 'PAGADO', `PAYMENT_STATE_${order.estado_pago}`);
  assert(order.venta_confirmada === true, 'SALE_NOT_CONFIRMED');
  assert(order.payment_provider === 'MERCADOPAGO', 'ORDER_PROVIDER_INVALID');
  assert(order.payment_provider_session === PROVIDER_PAYMENT_ID, 'ORDER_PROVIDER_SESSION_INVALID');
  assert(order.referencia_pago === PROVIDER_PAYMENT_ID, 'ORDER_REFERENCE_INVALID');

  console.log('ORDER_PAGADO=PASS');
  console.log('VENTA_CONFIRMADA=PASS');
  console.log('ORDER_PROVIDER=MERCADOPAGO PASS');

  section('5. PAYMENT TRANSACTION');

  const tx = await query(
    `SELECT * FROM gmx.payment_transactions
     WHERE id_pedido=$1 ORDER BY row_id`,
    [orderId]
  );

  console.table(tx.rows);
  assert(tx.rowCount === 1, `PAYMENT_TRANSACTION_COUNT_${tx.rowCount}`);

  const paymentTx = tx.rows[0];
  assert(paymentTx.proveedor === 'MERCADOPAGO', 'TX_PROVIDER_INVALID');
  assert(paymentTx.metodo === 'CARD', 'TX_METHOD_INVALID');
  assert(paymentTx.estado === 'PAID', `TX_STATE_${paymentTx.estado}`);
  assert(paymentTx.provider_payment_id === PROVIDER_PAYMENT_ID, 'TX_PROVIDER_PAYMENT_ID_INVALID');

  console.log('ONE_PAYMENT_TRANSACTION=PASS');
  console.log('PAYMENT_TRANSACTION_PAID=PASS');
  console.log('PROVIDER_PAYMENT_ID_PERSISTENCE=PASS');

  section('6. PEDIDO PAGOS');

  const pedidoPagos = await query(
    `SELECT * FROM gmx.pedido_pagos
     WHERE id_pedido=$1 ORDER BY linea`,
    [orderId]
  );

  console.table(pedidoPagos.rows);
  assert(pedidoPagos.rowCount === 1, `PEDIDO_PAGOS_COUNT_${pedidoPagos.rowCount}`);

  const pp = pedidoPagos.rows[0];
  assert(String(pp.metodo || '').toUpperCase() === 'TARJETA', 'PEDIDO_PAGO_METHOD_INVALID');
  assert(pp.proveedor === 'MERCADOPAGO', 'PEDIDO_PAGO_PROVIDER_INVALID');
  assert(pp.provider_payment_id === PROVIDER_PAYMENT_ID, 'PEDIDO_PAGO_PROVIDER_ID_INVALID');
  assert(String(pp.estado || '').toUpperCase() === 'PAGADO', `PEDIDO_PAGO_STATE_${pp.estado}`);

  console.log('PEDIDO_PAGOS=PASS');

  section('7. INVENTORY VERIFY');

  if (selected.type === 'PRODUCT') {
    const stock = await query(
      `SELECT stock FROM gmx.inventario_sucursales WHERE row_id=$1`,
      [selected.row_id]
    );
    const after = Number(stock.rows[0].stock);
    console.log(`STOCK=${selected.stock_before}->${after}`);
    assert(after === selected.stock_before - 1, 'PRODUCT_STOCK_NOT_DECREMENTED_ONCE');
  } else {
    const branch = await query(
      `SELECT stock FROM gmx.tcg_inventario_sucursales WHERE row_id=$1`,
      [selected.branch_row_id]
    );
    const global = await query(
      `SELECT stock FROM gmx.tcg_inventario WHERE row_id=$1`,
      [selected.global_row_id]
    );

    const branchAfter = Number(branch.rows[0].stock);
    const globalAfter = Number(global.rows[0].stock);

    console.log(`BRANCH_STOCK=${selected.branch_stock_before}->${branchAfter}`);
    console.log(`GLOBAL_STOCK=${selected.global_stock_before}->${globalAfter}`);

    assert(branchAfter === selected.branch_stock_before - 1, 'TCG_BRANCH_STOCK_INVALID');
    assert(globalAfter === selected.global_stock_before - 1, 'TCG_GLOBAL_STOCK_INVALID');
  }

  console.log('INVENTORY_DECREMENT_ONCE=PASS');

  section('8. PROVIDER CALL COUNT');
  assert(providerCalls === 1, `PROVIDER_CALL_COUNT_${providerCalls}`);
  console.log('PROVIDER_CALLED_ONCE=PASS');

  section('9. IDEMPOTENT REPLAY');

  const providerBeforeReplay = providerCalls;

  const replay = await createSale({
    branchId: selected.id_sucursal,
    saleRequestId: SALE_REQUEST_ID,
    paymentMethod: 'TARJETA',
    paymentProviderInput: {
      token: `TEST-TOKEN-${RUN_ID}`,
      paymentMethodId: 'visa',
      email: 'pos003-test@gmx.local',
      providerCall: async () => {
        providerCalls++;
        throw new Error('REPLAY_PROVIDER_CALL_FORBIDDEN');
      }
    },
    user: {
      id_admin: 'LOCAL',
      nombre: 'POS-003 TEST',
      email: 'pos003-test@gmx.local'
    },
    items: [item]
  });

  console.dir(replay, { depth: 4 });

  assert(replay?.id_pedido === orderId, 'REPLAY_DIFFERENT_ORDER');
  assert(replay?.idempotent_reuse === true, 'REPLAY_NOT_IDEMPOTENT');
  assert(providerCalls === providerBeforeReplay, 'REPLAY_CALLED_PROVIDER');

  const orderCount = await query(
    `SELECT COUNT(*)::int AS total
     FROM gmx.pedidos WHERE pos_idempotency_key=$1`,
    [SALE_REQUEST_ID]
  );

  const txCount = await query(
    `SELECT COUNT(*)::int AS total
     FROM gmx.payment_transactions WHERE id_pedido=$1`,
    [orderId]
  );

  assert(orderCount.rows[0].total === 1, 'DUPLICATE_ORDER_CREATED');
  assert(txCount.rows[0].total === 1, 'DUPLICATE_PAYMENT_TRANSACTION');

  console.log('IDEMPOTENT_REPLAY=PASS');
  console.log('REPLAY_PROVIDER_CALLS=0 PASS');
  console.log('ONE_ORDER_ONLY=PASS');
  console.log('ONE_PAYMENT_ONLY=PASS');

  section('10. INVENTORY AFTER REPLAY');

  if (selected.type === 'PRODUCT') {
    const stock = await query(
      `SELECT stock FROM gmx.inventario_sucursales WHERE row_id=$1`,
      [selected.row_id]
    );
    assert(Number(stock.rows[0].stock) === selected.stock_before - 1, 'REPLAY_DOUBLE_STOCK_DECREMENT');
  } else {
    const branch = await query(
      `SELECT stock FROM gmx.tcg_inventario_sucursales WHERE row_id=$1`,
      [selected.branch_row_id]
    );
    const global = await query(
      `SELECT stock FROM gmx.tcg_inventario WHERE row_id=$1`,
      [selected.global_row_id]
    );

    assert(Number(branch.rows[0].stock) === selected.branch_stock_before - 1, 'REPLAY_DOUBLE_BRANCH_STOCK');
    assert(Number(global.rows[0].stock) === selected.global_stock_before - 1, 'REPLAY_DOUBLE_GLOBAL_STOCK');
  }

  console.log('REPLAY_NO_SECOND_STOCK_DECREMENT=PASS');

  section('11. AUDIT');

  const audits = await query(
    `SELECT row_id,modulo,accion,referencia,detalle,usuario
     FROM gmx.auditoria
     WHERE referencia=$1
     ORDER BY row_id`,
    [orderId]
  );

  console.table(audits.rows);
  assert(audits.rowCount >= 1, 'AUDIT_MISSING');
  console.log('AUDIT=PASS');

  section('POS-003-TEST1-R2 RESULTADO');

  console.log(`ORDER=${orderId}`);
  console.log(`SALE_REQUEST_ID=${SALE_REQUEST_ID}`);
  console.log(`PROVIDER_PAYMENT_ID=${PROVIDER_PAYMENT_ID}`);
  console.log(`INVENTORY_TYPE=${selected.type}`);
  console.log('');
  console.log('REAL_CREATE_SALE_FLOW=PASS');
  console.log('CARD_PAYMENT=PASS');
  console.log('PROVIDER=MERCADOPAGO PASS');
  console.log('ORDER_PAGADO=PASS');
  console.log('VENTA_CONFIRMADA=PASS');
  console.log('ONE_PAYMENT_TRANSACTION=PASS');
  console.log('PAYMENT_TRANSACTION_PAID=PASS');
  console.log('PROVIDER_PAYMENT_ID_PERSISTENCE=PASS');
  console.log('PEDIDO_PAGOS=PASS');
  console.log('INVENTORY_DECREMENT_ONCE=PASS');
  console.log('PROVIDER_CALLED_ONCE=PASS');
  console.log('IDEMPOTENT_REPLAY=PASS');
  console.log('REPLAY_PROVIDER_CALLS=0 PASS');
  console.log('ONE_ORDER_ONLY=PASS');
  console.log('ONE_PAYMENT_ONLY=PASS');
  console.log('REPLAY_NO_SECOND_STOCK_DECREMENT=PASS');
  console.log('AUDIT=PASS');
  console.log('');
  console.log('REAL_MERCADOPAGO_CALL=FALSE');
  console.log('REAL_CHARGE_CREATED=FALSE');
  console.log('');
  console.log('POS-003-TEST1-R2=PASS');

} catch (e) {
  section('POS-003-TEST1-R2 FAIL');
  console.error(e.message);
  console.log({ orderId, providerCalls, selected });
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (e) {
    console.error('FINAL_CLEANUP_ERROR=', e.message);
  }

  try {await pool.end();} catch {}

  console.log('');
  console.log('POS-003-TEST1-R2 FINALIZADO');
}
