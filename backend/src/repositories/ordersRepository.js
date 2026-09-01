import { consumeManualDiscountPinTx } from '../returnPinAuthorizationService.js';
import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';
import { applyBenefitsTx, reverseBenefitsTx } from './benefitsRepository.js';
import { queueAndSendEmail, posReceiptEmailHtml } from '../emailService.js';
import { createOrderReceiptPdf } from '../services/receiptPdfService.js';

export async function listOrders({ search = '', branchId = '', status = '', limit = 100, offset = 0 }) {
  const values = [];
  const filters = [];

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      COALESCE(p.id_pedido,'') ILIKE $${values.length}
      OR COALESCE(p.nombre_cliente,'') ILIKE $${values.length}
      OR COALESCE(p.telefono,'') ILIKE $${values.length}
      OR COALESCE(p.email,'') ILIKE $${values.length}
      OR COALESCE(p.referencia_pago,'') ILIKE $${values.length}
    )`);
  }

  if (branchId) {
    values.push(branchId);
    filters.push(`p.id_sucursal = $${values.length}`);
  }

  if (status) {
    values.push(status);
    filters.push(`p.estado_pedido = $${values.length}`);
  }

  values.push(limit, offset);
  const li = values.length - 1;
  const oi = values.length;

  return query(`
    SELECT
      p.row_id, p.id_pedido, p.fecha, p.id_cliente, p.nombre_cliente,
      p.telefono, p.email, p.metodo_pago, p.subtotal, p.envio, p.total,
      p.estado_pedido, p.referencia_pago, p.fecha_pago, p.notas,
      p.inventario_liberado, p.id_sucursal, p.sucursal,
      p.canal_venta, p.venta_confirmada,
      COUNT(d.row_id)::bigint AS lineas,
      COALESCE(SUM(d.cantidad),0)::bigint AS unidades
    FROM gmx.pedidos p
    LEFT JOIN gmx.detalle_pedidos d ON d.id_pedido = p.id_pedido
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    GROUP BY p.row_id
    ORDER BY p.fecha DESC NULLS LAST, p.row_id DESC
    LIMIT $${li}
    OFFSET $${oi}
  `, values);
}

export async function getOrder(rowId) {
  const header = await query(`
    SELECT *
    FROM gmx.pedidos
    WHERE row_id = $1
  `, [rowId]);

  if (!header.rowCount) return null;

  const order = header.rows[0];

  const detail = await query(`
    SELECT
      row_id, id_pedido, id_producto, producto, cantidad,
      precio, subtotal, id_detalle, sku, precio_unitario,
      tipo, id_inventario, detalle
    FROM gmx.detalle_pedidos
    WHERE id_pedido = $1
    ORDER BY row_id
  `, [order.id_pedido]);

  const payments = await query(`
    SELECT
      row_id,id_pago,id_pedido,linea,metodo,importe_aplicado,
      efectivo_recibido,cambio_entregado,referencia,proveedor,
      provider_payment_id,estado,id_admin,administrador,fecha
    FROM gmx.pedido_pagos
    WHERE id_pedido=$1
    ORDER BY linea,row_id
  `, [order.id_pedido]);

  return {
    ...order,
    detalles: detail.rows,
    pagos: payments.rows
  };
}

async function fetchBranch(client, branchId, { requireActive = true } = {}) {
  const result = await client.query(`
    SELECT id_sucursal, nombre_sucursal, activa
    FROM gmx.sucursales
    WHERE id_sucursal = $1
      ${requireActive ? 'AND COALESCE(activa, true) = true' : ''}
    ORDER BY row_id
    LIMIT 1
  `, [branchId]);

  return result.rows[0] || null;
}

async function fetchClient(client, clientId) {
  if (!clientId) return null;

  const result = await client.query(`
    SELECT
      id_cliente, nombre, telefono, email, direccion,
      ciudad, estado, cp
    FROM gmx.clientes
    WHERE id_cliente = $1
    ORDER BY row_id
    LIMIT 1
  `, [clientId]);

  return result.rows[0] || null;
}

async function fetchProduct(client, productId) {
  const result = await client.query(`
    SELECT id, sku, nombre, precio, estado
    FROM gmx.productos
    WHERE id = $1
    ORDER BY row_id
    LIMIT 1
  `, [productId]);

  return result.rows[0] || null;
}

async function lockInventory(client, branchId, productId) {
  // Serializa ventas del mismo producto/sucursal incluso antes del row lock.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
  [`PRODUCT:${branchId}:${productId}`]);
  const result = await client.query(`
    SELECT *
    FROM gmx.inventario_sucursales
    WHERE id_sucursal = $1
      AND id_producto = $2
    ORDER BY row_id
    LIMIT 1
    FOR UPDATE
  `, [branchId, productId]);

  return result.rows[0] || null;
}

async function logMovement(client, {
  branch, product, type, quantity, before, after, reason, reference, user = null
}) {
  const actorId = String(user?.id_admin || '').trim();
  const actorName = String(user?.nombre || user?.email || brandText("GMX Local POS")).trim();
  const actorUser = String(user?.email || user?.nombre || 'gmx_app').trim();

  await client.query(`
    INSERT INTO gmx.movimientos_inventario_sucursales (
      id_movimiento, fecha, id_sucursal, sucursal,
      id_producto, sku, producto, tipo, cantidad,
      stock_anterior, stock_nuevo, motivo,
      id_admin, nombre_usuario, usuario, referencia
    )
    VALUES (
      'MOV-POS-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text),1,6),
      NOW(), $1, $2, $3, $4, $5, $6, $7,
      $8, $9, NULLIF($10,''),
      NULLIF($11,''), $12, $13, $14
    )
  `, [
  branch.id_sucursal,
  branch.nombre_sucursal,
  product.id,
  product.sku,
  product.nombre,
  type,
  quantity,
  before,
  after,
  reason,
  actorId,
  actorName,
  actorUser,
  reference]
  );
}

function normalizePaymentMethod(value) {
  return String(value || 'EFECTIVO').trim().toUpperCase();
}

async function lockOpenCashSession(client, branchId) {
  const result = await client.query(`
    SELECT *
    FROM gmx.caja_sesiones
    WHERE id_sucursal=$1
      AND UPPER(COALESCE(estado,''))='ABIERTA'
      AND fecha_cierre IS NULL
    ORDER BY fecha_apertura DESC,row_id DESC
    LIMIT 1
    FOR UPDATE
  `, [branchId]);
  return result.rows[0] || null;
}

async function registerCashSale(client, { cash, branch, orderId, total, user = null }) {
  if (!cash) throw new Error('CASH_SESSION_REQUIRED');

  const existing = await client.query(`
    SELECT row_id,id_movimiento
    FROM gmx.caja_movimientos
    WHERE origen_modulo='POS_LOCAL'
      AND id_origen=$1
      AND categoria='VENTA'
      AND COALESCE(anulado,false)=false
    ORDER BY row_id
    LIMIT 1
  `, [orderId]);

  if (existing.rowCount) return existing.rows[0];

  const amount = Number(total || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('INVALID_SALE_TOTAL');

  const actorId = String(user?.id_admin || '').trim();
  const actorName = String(user?.nombre || user?.email || brandText("GMX Local POS")).trim();

  const inserted = await client.query(`
    INSERT INTO gmx.caja_movimientos(
      id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,
      metodo_pago,importe,impacto_efectivo,referencia,descripcion,
      origen_modulo,id_origen,id_admin,administrador,anulado,id_movimiento_reversion
    )
    VALUES(
      'CAJMOV-POS-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,6),
      $1,NOW(),$2,$3,'INGRESO','VENTA','EFECTIVO',$4,$4,$5,
      'Venta POS en efectivo','POS_LOCAL',$5,NULLIF($6,''),$7,false,NULL
    )
    RETURNING row_id,id_movimiento
  `, [cash.id_caja, branch.id_sucursal, branch.nombre_sucursal, amount, orderId, actorId, actorName]);

  await client.query(`
    UPDATE gmx.caja_sesiones
    SET
      ingresos_efectivo=COALESCE(ingresos_efectivo,0)+$2,
      saldo_esperado=COALESCE(fondo_inicial,0)
        +(COALESCE(ingresos_efectivo,0)+$2)
        -COALESCE(egresos_efectivo,0),
      fecha_actualizacion=NOW()
    WHERE row_id=$1
  `, [cash.row_id, amount]);

  return inserted.rows[0];
}



// SHINY_POS_FIX_001
// SHINY_POS_FIX_001_V2 - casts NUMERIC explicitos para evitar "operator is not unique - unknown"
async function reverseCashSaleOnCancellation(client, { order, branch, user = null }) {
  const payments = await client.query(`
    SELECT COALESCE(SUM(importe_aplicado),0)::numeric AS cash_total
    FROM gmx.pedido_pagos
    WHERE id_pedido=$1
      AND UPPER(COALESCE(metodo,''))='EFECTIVO'
      AND UPPER(COALESCE(estado,''))='PAGADO'
  `, [order.id_pedido]);

  const cashTotal = Number(payments.rows[0]?.cash_total || 0);
  if (!(cashTotal > 0)) return { reversed: false, amount: 0 };

  const existing = await client.query(`
    SELECT row_id,id_movimiento
    FROM gmx.caja_movimientos
    WHERE origen_modulo='POS_CANCELACION'
      AND id_origen=$1
      AND categoria='CANCELACION_VENTA'
      AND COALESCE(anulado,false)=false
    ORDER BY row_id
    LIMIT 1
    FOR UPDATE
  `, [order.id_pedido]);

  if (existing.rowCount) {
    return { reversed: true, amount: cashTotal, id_movimiento: existing.rows[0].id_movimiento, reused: true };
  }

  const original = await client.query(`
    SELECT *
    FROM gmx.caja_movimientos
    WHERE origen_modulo='POS_LOCAL'
      AND id_origen=$1
      AND categoria='VENTA'
      AND UPPER(COALESCE(metodo_pago,''))='EFECTIVO'
      AND COALESCE(anulado,false)=false
    ORDER BY row_id
    LIMIT 1
    FOR UPDATE
  `, [order.id_pedido]);

  if (!original.rowCount) throw new Error('POS_CASH_MOVEMENT_NOT_FOUND');

  const cash = await lockOpenCashSession(client, branch.id_sucursal);
  if (!cash) throw new Error('CASH_SESSION_REQUIRED_FOR_CANCELLATION');

  const actorId = String(user?.id_admin || '').trim();
  const actorName = String(user?.nombre || user?.email || brandText("GMX Local POS")).trim();

  const reversal = await client.query(`
    INSERT INTO gmx.caja_movimientos(
      id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,
      metodo_pago,importe,impacto_efectivo,referencia,descripcion,
      origen_modulo,id_origen,id_admin,administrador,anulado,id_movimiento_reversion
    )
    VALUES(
      'CAJCAN-POS-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,6),
      $1,NOW(),$2,$3,'EGRESO','CANCELACION_VENTA','EFECTIVO',$4::numeric,-($4::numeric),$5,
      'Reversion cancelacion venta POS','POS_CANCELACION',$5,NULLIF($6,''),$7,false,$8
    )
    RETURNING row_id,id_movimiento
  `, [
  cash.id_caja, branch.id_sucursal, branch.nombre_sucursal, cashTotal,
  order.id_pedido, actorId, actorName, original.rows[0].id_movimiento]
  );

  await client.query(`
    UPDATE gmx.caja_movimientos
    SET id_movimiento_reversion=$2
    WHERE row_id=$1
  `, [original.rows[0].row_id, reversal.rows[0].id_movimiento]);

  await client.query(`
    UPDATE gmx.caja_sesiones
    SET egresos_efectivo=COALESCE(egresos_efectivo,0)+($2::numeric),
        saldo_esperado=COALESCE(fondo_inicial,0)
          +COALESCE(ingresos_efectivo,0)
          -(COALESCE(egresos_efectivo,0)+($2::numeric)),
        fecha_actualizacion=NOW()
    WHERE row_id=$1
  `, [cash.row_id, cashTotal]);

  await client.query(`
    UPDATE gmx.pedido_pagos
    SET estado='REEMBOLSADO'
    WHERE id_pedido=$1
      AND UPPER(COALESCE(metodo,''))='EFECTIVO'
      AND UPPER(COALESCE(estado,''))='PAGADO'
  `, [order.id_pedido]);

  return {
    reversed: true,
    amount: cashTotal,
    id_movimiento: reversal.rows[0].id_movimiento,
    reused: false
  };
}

export async function searchPosCatalog({
  branchId,
  type = 'ALL',
  search = '',
  gameId = '',
  setId = '',
  limit = 120
} = {}) {
  if (!branchId) return { rows: [], rowCount: 0 };
  const kind = String(type || 'ALL').toUpperCase();
  const term = String(search || '').trim();
  const max = Math.min(Math.max(Number(limit) || 120, 1), 300);
  const rows = [];

  if (kind === 'ALL' || kind === 'PRODUCT') {
    const vals = [branchId];
    let searchSql = '';
    if (term) {
      vals.push(`%${term}%`);
      searchSql = `AND (
        p.nombre ILIKE $2 OR COALESCE(p.sku,'') ILIKE $2 OR COALESCE(p.id,'') ILIKE $2
      )`;
    }
    vals.push(max);
    const lim = `$${vals.length}`;
    const products = await query(`
      SELECT
        'PRODUCT' AS item_type,
        p.id AS item_id,
        p.id AS product_id,
        NULL::text AS inventory_id,
        p.nombre AS name,
        p.sku,
        NULL::text AS game_id,
        NULL::text AS game_name,
        NULL::text AS set_id,
        NULL::text AS set_name,
        NULL::text AS card_number,
        NULL::text AS rarity,
        NULL::text AS condition,
        NULL::text AS language,
        NULL::text AS finish,
        NULL::text AS image_url,
        inv.stock,
        p.precio AS price
      FROM gmx.productos p
      JOIN gmx.inventario_sucursales inv
        ON inv.id_producto=p.id AND inv.id_sucursal=$1
      WHERE COALESCE(p.estado,'ACTIVO')<>'INACTIVO'
        AND COALESCE(inv.stock,0)>0
        ${searchSql}
      ORDER BY p.nombre
      LIMIT ${lim}
    `, vals);
    rows.push(...products.rows);
  }

  if (kind === 'ALL' || kind === 'TCG') {
    const vals = [branchId];
    const filters = [
    `s.id_sucursal=$1`,
    `COALESCE(s.stock,0)>0`,
    `COALESCE(i.estado_venta,'ACTIVO') NOT IN ('INACTIVO','BLOQUEADO')`];

    if (gameId) {vals.push(gameId);filters.push(`c.id_juego=$${vals.length}`);}
    if (setId) {vals.push(setId);filters.push(`c.id_set=$${vals.length}`);}
    if (term) {
      vals.push(`%${term}%`);
      filters.push(`(
        c.nombre ILIKE $${vals.length}
        OR COALESCE(c.numero_completo,'') ILIKE $${vals.length}
        OR COALESCE(i.sku,'') ILIKE $${vals.length}
        OR COALESCE(i.id_inventario,'') ILIKE $${vals.length}
      )`);
    }
    vals.push(max);
    const cards = await query(`
      SELECT
        'TCG' AS item_type,
        i.id_inventario AS item_id,
        NULL::text AS product_id,
        i.id_inventario AS inventory_id,
        c.nombre AS name,
        i.sku,
        c.id_juego AS game_id,
        j.nombre AS game_name,
        c.id_set AS set_id,
        st.nombre AS set_name,
        c.numero_completo AS card_number,
        COALESCE(i.rareza,c.rareza) AS rarity,
        i.condicion AS condition,
        i.idioma AS language,
        i.acabado AS finish,
        COALESCE(c.imagen_principal,c.image_source_url) AS image_url,
        s.stock,
        CASE
          WHEN COALESCE(i.precio_oferta,0)>0 THEN i.precio_oferta
          ELSE i.precio
        END AS price
      FROM gmx.tcg_inventario i
      JOIN gmx.tcg_inventario_sucursales s
        ON s.id_inventario=i.id_inventario
      JOIN gmx.tcg_cartas c
        ON c.id_carta=i.id_carta
      LEFT JOIN gmx.tcg_juegos j
        ON j.id_juego=c.id_juego
      LEFT JOIN gmx.tcg_sets st
        ON st.id_set=c.id_set
      WHERE ${filters.join(' AND ')}
      ORDER BY c.nombre,c.numero_completo,i.condicion,i.idioma
      LIMIT $${vals.length}
    `, vals);
    rows.push(...cards.rows);
  }

  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  return { rows: rows.slice(0, max), rowCount: Math.min(rows.length, max) };
}

export async function createSale({
  branchId,
  clientId = '',
  saleRequestId = '',
  paymentMethod = 'EFECTIVO',
  paymentReference = '',
  paymentProviderInput = {},
  cashReceived = null,
  payments = [],
  notes = '',
  promoCode = '',
  pointsToRedeem = 0,
  manualDiscountType = '',
  manualDiscountValue = 0,
  manualDiscountReason = '',
  manualDiscountPin = '',
  user = null,
  items = []
}) {
  if (!branchId) throw new Error('BRANCH_REQUIRED');


  if (!Array.isArray(items) || !items.length) throw new Error('EMPTY_CART');

  const normalizedItems = new Map();

  for (const raw of items) {
    const itemType = String(raw.itemType || raw.type || 'PRODUCT').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCT';
    const itemId = String(itemType === 'TCG' ? raw.inventoryId || raw.itemId || '' : raw.productId || raw.itemId || '').trim();
    const quantity = Math.trunc(Number(raw.quantity));
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_CART_ITEM');
    const key = `${itemType}:${itemId}`;
    const prev = normalizedItems.get(key);
    normalizedItems.set(key, { itemType, itemId, quantity: (prev?.quantity || 0) + quantity });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // SHINY_POS_FIX_002
    // Idempotencia fuerte de la venta POS.
    const idemKey = String(saleRequestId || '').trim();
    if (!idemKey) throw new Error('SALE_REQUEST_ID_REQUIRED');
    if (idemKey.length > 160) throw new Error('INVALID_SALE_REQUEST_ID');

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`POS:SALE:${idemKey}`]
    );

    const existingSale = await client.query(`
      SELECT row_id,id_pedido
      FROM gmx.pedidos
      WHERE pos_idempotency_key=$1
      ORDER BY row_id
      LIMIT 1
      FOR UPDATE
    `, [idemKey]);

    if (existingSale.rowCount) {
      await client.query('COMMIT');
      const existingOrder = await getOrder(existingSale.rows[0].row_id);
      return { ...existingOrder, idempotent_reuse: true, inventory_updates: [] };
    }

    const branch = await fetchBranch(client, branchId);
    if (!branch) throw new Error('BRANCH_NOT_FOUND');

    const allowedMethods = new Set(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO']);
    const rawPayments = Array.isArray(payments) && payments.length ?
    payments :
    [{
      method: paymentMethod || 'EFECTIVO',
      amount: null,
      cashReceived,
      reference: paymentReference || ''
    }];

    const normalizedPayments = rawPayments.map((p, index) => {
      const method = normalizePaymentMethod(p?.method || p?.metodo || '');
      if (!allowedMethods.has(method)) throw new Error('INVALID_PAYMENT_METHOD');
      return {
        line: index + 1,
        method,
        amount: p?.amount == null ? null : Number(p.amount),
        cashReceived: p?.cashReceived == null ? null : Number(p.cashReceived),
        reference: String(p?.reference || p?.referencia || '').trim(),
        provider: String(p?.provider || p?.proveedor || '').trim()
      };
    });    // GMX_POS_CARD_VALIDATE_BACKEND_R1
    for (const p of normalizedPayments) {
      if (p.method !== 'TARJETA') continue;
      const reference = String(p.reference || '').trim();
      const provider = String(p.provider || '').trim();
      if (!reference) throw new Error('CARD_REFERENCE_REQUIRED');
      if (!provider) throw new Error('CARD_PROVIDER_REQUIRED');
      if (!provider.includes('BANK=')) throw new Error('CARD_BANK_REQUIRED');
      if (!provider.includes('BRAND=')) throw new Error('CARD_BRAND_REQUIRED');
      if (!provider.includes('TYPE=')) throw new Error('CARD_TYPE_REQUIRED');
    }


    // SHINY_POS_003_MERCADOPAGO
    const cardPayments =
    normalizedPayments.filter(
      (p) => p.method === 'TARJETA'
    );

    /*
     * POS-003 certification covers one Mercado Pago card
     * payment for the full POS sale.
     */
    /* GMX_POS_CARD_MP_MIXED_REMOVED_R1 */

    // GMX_POS_CARD_MANUAL_R1
    const isMercadoPagoCardSale = false;

    const hasCashRequested = normalizedPayments.some((p) => p.method === 'EFECTIVO');
    const cashSession = hasCashRequested ?
    await lockOpenCashSession(client, branch.id_sucursal) :
    null;
    if (hasCashRequested && !cashSession) throw new Error('CASH_SESSION_REQUIRED');

    const customer = await fetchClient(client, clientId);
    if (clientId && !customer) throw new Error('CLIENT_NOT_FOUND');

    const orderId = 'PED-LOCAL-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    const prepared = [];
    let subtotal = 0;

    const keys = [...normalizedItems.keys()].sort();

    for (const key of keys) {
      const raw = normalizedItems.get(key);

      if (raw.itemType === 'PRODUCT') {
        const product = await fetchProduct(client, raw.itemId);
        if (!product) throw new Error(`PRODUCT_NOT_FOUND:${raw.itemId}`);
        const unitPrice = Number(product.precio);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`PRODUCT_WITHOUT_VALID_PRICE:${raw.itemId}`);

        const inventory = await lockInventory(client, branchId, raw.itemId);
        if (!inventory) throw new Error(`INVENTORY_NOT_FOUND:${raw.itemId}`);
        const before = Number(inventory.stock || 0);
        if (before < raw.quantity) throw new Error(`INSUFFICIENT_STOCK:${raw.itemId}`);
        const after = before - raw.quantity;
        const lineSubtotal = Number((unitPrice * raw.quantity).toFixed(4));
        subtotal += lineSubtotal;
        prepared.push({
          itemType: 'PRODUCT', quantity: raw.quantity, unitPrice, lineSubtotal, before, after,
          product, inventory, name: product.nombre, sku: product.sku,
          detail: null, imageUrl: null
        });
      } else {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`TCG:${branchId}:${raw.itemId}`]);
        const inv = await client.query(`
          SELECT
            i.*,c.nombre AS carta,c.id_carta,c.id_juego,c.id_set,c.numero_completo,c.rareza AS carta_rareza,
            j.nombre AS juego,st.nombre AS set_nombre,
            s.row_id AS branch_row_id,s.stock AS branch_stock,s.stock_reservado AS branch_reserved
          FROM gmx.tcg_inventario i
          JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
          LEFT JOIN gmx.tcg_juegos j ON j.id_juego=c.id_juego
          LEFT JOIN gmx.tcg_sets st ON st.id_set=c.id_set
          JOIN gmx.tcg_inventario_sucursales s
            ON s.id_inventario=i.id_inventario AND s.id_sucursal=$1
          WHERE i.id_inventario=$2
          ORDER BY i.row_id
          LIMIT 1
          FOR UPDATE OF i,s
        `, [branchId, raw.itemId]);
        if (!inv.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${raw.itemId}`);
        const item = inv.rows[0];
        const before = Number(item.branch_stock || 0);
        if (before < raw.quantity) throw new Error(`INSUFFICIENT_TCG_STOCK:${raw.itemId}`);
        const globalBefore = Number(item.stock || 0);
        if (globalBefore < raw.quantity) throw new Error(`INSUFFICIENT_TCG_GLOBAL_STOCK:${raw.itemId}`);
        const after = before - raw.quantity;
        const globalAfter = globalBefore - raw.quantity;
        const unitPrice = Number(Number(item.precio_oferta || 0) > 0 ? item.precio_oferta : item.precio);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`TCG_WITHOUT_VALID_PRICE:${raw.itemId}`);
        const lineSubtotal = Number((unitPrice * raw.quantity).toFixed(4));
        subtotal += lineSubtotal;

        prepared.push({
          itemType: 'TCG', quantity: raw.quantity, unitPrice, lineSubtotal, before, after,
          globalBefore, globalAfter, item,
          name: item.carta, sku: item.sku,
          detail: [
          item.juego, item.set_nombre, item.numero_completo,
          item.condicion, item.idioma, item.acabado].
          filter(Boolean).join(' · ')
        });
      }
    }

    // GMX_MEMBERSHIP_BACKEND_GUARD_R5
    const membershipLines = prepared.filter((line) => line.itemType === 'PRODUCT' && String(line.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (membershipLines.length) {
      if (!customer) throw new Error('MEMBERSHIP_CLIENT_REQUIRED');
      if (membershipLines.some((line) => Number(line.quantity || 0) !== 1)) throw new Error('MEMBERSHIP_QUANTITY_ONE_REQUIRED');
    }
    // GMX_MEMBERSHIP_DUPLICATE_TCG_GUARD_R5D
    const membershipSkuLines = prepared.filter((line) => line.itemType === 'PRODUCT' && String(line.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (membershipSkuLines.length) {
      for (const line of membershipSkuLines) {
        const typeResult = await client.query(`SELECT id,id_juego,nombre,sku FROM gmx.membresia_tipos WHERE UPPER(sku)=UPPER($1) AND activo=true LIMIT 1`,[String(line.sku || '').trim()]);
        const membershipType = typeResult.rows[0];
        if (!membershipType) continue;
        const duplicate = await client.query(`SELECT cm.id,cm.estado,cm.fin FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo WHERE cm.id_cliente=$1 AND mt.id_juego=$2 AND cm.estado IN ('ACTIVA','PROGRAMADA') AND cm.fin>NOW() ORDER BY cm.fin DESC LIMIT 1`,[customer.id_cliente,membershipType.id_juego]);
        if (duplicate.rowCount) throw new Error('MEMBERSHIP_TCG_ALREADY_ACTIVE');
      }
    }
    subtotal = Number(subtotal.toFixed(4));
    const shipping = 0;
    const benefit = await applyBenefitsTx(client, {
      orderId, clientId: customer?.id_cliente || '', subtotal, promoCode,
      points: pointsToRedeem, channel: 'POS_LOCAL', branchId: branch.id_sucursal, user
    });
    // POS-007 � descuento manual autorizado. Backend es la autoridad del c�lculo.
    const totalBeforeManualDiscount = Number((Number(benefit.total || 0) + shipping).toFixed(4));
    const manualType = String(manualDiscountType || '').trim().toUpperCase();
    const manualValue = Number(manualDiscountValue || 0);
    const manualReason = String(manualDiscountReason || '').trim();
    let manualDiscount = 0;

    if (manualType || manualValue > 0 || manualReason) {
      await consumeManualDiscountPinTx(client,{
        pin:manualDiscountPin,
        branchId:branch.id_sucursal,
        requester:user,
        reference:'DESCUENTO_POS:' + orderId
      });
      if (!['PORCENTAJE', 'MONTO'].includes(manualType)) throw new Error('INVALID_MANUAL_DISCOUNT_TYPE');
      if (!Number.isFinite(manualValue) || manualValue <= 0) throw new Error('INVALID_MANUAL_DISCOUNT_VALUE');
      if (!manualReason) throw new Error('MANUAL_DISCOUNT_REASON_REQUIRED');
      if (manualType === 'PORCENTAJE') {
        if (manualValue > 100) throw new Error('INVALID_MANUAL_DISCOUNT_PERCENT');
        manualDiscount = Number((totalBeforeManualDiscount * manualValue / 100).toFixed(4));
      } else {
        manualDiscount = Number(manualValue.toFixed(4));
      }
      if (manualDiscount > totalBeforeManualDiscount) throw new Error('MANUAL_DISCOUNT_EXCEEDS_TOTAL');
    }

    const total = Number(Math.max(0, totalBeforeManualDiscount - manualDiscount).toFixed(4));
    // En modo legacy, la única línea toma el total automáticamente.
    if (normalizedPayments.length === 1 && normalizedPayments[0].amount == null) {
      normalizedPayments[0].amount = total;
    }

    let assigned = 0;
    let efectivoRecibido = 0;
    let cambioEntregado = 0;
    let cashApplied = 0;

    for (const p of normalizedPayments) {
      if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('INVALID_PAYMENT_AMOUNT');
      p.amount = Number(p.amount.toFixed(4));
      assigned = Number((assigned + p.amount).toFixed(4));

      if (p.method === 'EFECTIVO') {
        if (!Number.isFinite(p.cashReceived) || p.cashReceived < p.amount) {
          throw new Error('INSUFFICIENT_CASH_RECEIVED');
        }
        p.cashReceived = Number(p.cashReceived.toFixed(4));
        p.change = Number((p.cashReceived - p.amount).toFixed(4));
        efectivoRecibido = Number((efectivoRecibido + p.cashReceived).toFixed(4));
        cambioEntregado = Number((cambioEntregado + p.change).toFixed(4));
        cashApplied = Number((cashApplied + p.amount).toFixed(4));
      } else {
        p.cashReceived = null;
        p.change = null;
      }
    }

    if (Math.abs(assigned - total) > 0.009) {
      throw new Error(assigned < total ? 'PAYMENT_TOTAL_INCOMPLETE' : 'PAYMENT_TOTAL_EXCEEDED');
    }

    const distinctMethods = [...new Set(normalizedPayments.map((p) => p.method))];
    const method = distinctMethods.length === 1 ? distinctMethods[0] : 'MIXTO';
    const effectiveReference = normalizedPayments.length === 1 ?
    normalizedPayments[0].reference :
    String(paymentReference || '').trim();

    const insertedOrder = await client.query(`
      INSERT INTO gmx.pedidos (
        id_pedido,fecha,id_cliente,nombre_cliente,telefono,email,direccion,ciudad,estado,cp,
        metodo_pago,subtotal,envio,total,estado_pedido,referencia_pago,fecha_pago,notas,
        fecha_actualizacion,inventario_liberado,id_admin_venta,vendedor,id_sucursal,sucursal,
        canal_venta,venta_confirmada,id_promocion,codigo_promocional,descuento_promocion,
        puntos_redimidos,descuento_puntos,puntos_generados,total_antes_beneficios,estado_pago,efectivo_recibido,cambio_entregado,
        pos_idempotency_key,descuento_manual,tipo_descuento_manual,valor_descuento_manual,
        motivo_descuento_manual,id_admin_descuento,admin_descuento
      )
      VALUES (
        $1,NOW(),NULLIF($2,''),$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,'PAGADO',NULLIF($14,''),NOW(),NULLIF($15,''),
        NOW(),false,$18,$19,$16,$17,'POS_LOCAL',true,$20,$21,$22,$23,$24,$25,$11,'PAGADO',$26,$27,$28,
        $29,NULLIF($30,''),$31,NULLIF($32,''),NULLIF($33,''),NULLIF($34,'')
      )
      RETURNING row_id,id_pedido
    `, [
    orderId, customer?.id_cliente || '', customer?.nombre || 'Público general',
    customer?.telefono || '', customer?.email || '', customer?.direccion || '',
    customer?.ciudad || '', customer?.estado || '', customer?.cp || '',
    method, subtotal, shipping, total, effectiveReference, notes,
    branch.id_sucursal, branch.nombre_sucursal,
    user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local POS"),
    benefit.promotion?.id || null, benefit.promotion?.codigo || null, benefit.discountPromo,
    benefit.pointsUsed, benefit.loyaltyDiscount, benefit.pointsEarned, efectivoRecibido, cambioEntregado,
    idemKey, manualDiscount, manualType, manualType ? manualValue : null, manualReason,
    manualDiscount > 0 ? String(user?.id_admin || '').trim() : '',
    manualDiscount > 0 ? String(user?.nombre || user?.email || '').trim() : '']
    );

    for (const p of normalizedPayments) {
      await client.query(`
        INSERT INTO gmx.pedido_pagos(
          id_pago,id_pedido,linea,metodo,importe_aplicado,
          efectivo_recibido,cambio_entregado,referencia,proveedor,
          provider_payment_id,estado,id_admin,administrador,fecha
        )
        VALUES(
          'PAG-POS-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,6),
          $1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),NULL,'PAGADO',
          NULLIF($9,''),$10,NOW()
        )
      `, [
      orderId, p.line, p.method, p.amount, p.cashReceived, p.change,
      p.reference, p.provider,
      String(user?.id_admin || '').trim(),
      String(user?.nombre || user?.email || brandText("GMX Local POS")).trim()]
      );
    }

    /*
     * Card order must exist durably as PENDIENTE before
     * calling Mercado Pago.
     */
    if (isMercadoPagoCardSale) {

      await client.query(
        `UPDATE gmx.pedidos
         SET
           estado_pedido='PENDIENTE',
           estado_pago='PENDIENTE',
           venta_confirmada=false,
           payment_provider='MERCADOPAGO',
           payment_provider_session=NULL,
           payment_confirmed_at=NULL,
           referencia_pago=NULL,
           fecha_pago=NULL,
           fecha_actualizacion=NOW()
         WHERE id_pedido=$1`,
        [
        orderId]

      );

      await client.query(
        `UPDATE gmx.pedido_pagos
         SET
           proveedor='MERCADOPAGO',
           provider_payment_id=NULL,
           estado='PENDIENTE',
           referencia=NULL
         WHERE id_pedido=$1
           AND metodo='TARJETA'`,
        [
        orderId]

      );
    }

    for (const line of prepared) {
      const detailId = 'DET-LOCAL-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);

      if (line.itemType === 'PRODUCT') {
        await client.query(`UPDATE gmx.inventario_sucursales SET stock=$1,fecha_actualizacion=NOW() WHERE row_id=$2`,
        [line.after, line.inventory.row_id]);

        await client.query(`
          INSERT INTO gmx.detalle_pedidos(
            id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,
            precio_unitario,tipo,id_inventario,detalle
          )
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PRODUCTO',$10,NULL)
        `, [orderId, line.product.id, line.name, line.quantity, line.unitPrice, line.lineSubtotal,
        detailId, line.sku, line.unitPrice, line.inventory.id_registro]);

        await logMovement(client, {
          branch, product: line.product, type: 'VENTA_POS', quantity: line.quantity,
          before: line.before, after: line.after, reason: 'Venta POS local', reference: orderId, user
        });
      } else {
        await client.query(`UPDATE gmx.tcg_inventario_sucursales
          SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
        [line.item.branch_row_id, line.after]);
        await client.query(`UPDATE gmx.tcg_inventario
          SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
        [line.item.row_id, line.globalAfter]);

        await client.query(`
          INSERT INTO gmx.detalle_pedidos(
            id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,
            precio_unitario,tipo,id_inventario,detalle
          )
          VALUES($1,NULL,$2,$3,$4,$5,$6,$7,$8,'TCG',$9,$10)
        `, [orderId, line.name, line.quantity, line.unitPrice, line.lineSubtotal,
        detailId, line.sku, line.unitPrice, line.item.id_inventario, line.detail]);

        await client.query(`
          INSERT INTO gmx.tcg_movimientos_sucursales(
            id_movimiento,fecha,tipo,id_inventario,id_carta,sku,
            id_sucursal_origen,sucursal_origen,cantidad,
            stock_origen_anterior,stock_origen_nuevo,
            stock_global_anterior,stock_global_nuevo,
            referencia,motivo,id_admin,administrador
          )
          VALUES(
            'TCGMOV-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
            NOW(),'VENTA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
            'Venta POS local',$12,$13
          )
        `, [
        line.item.id_inventario, line.item.id_carta, line.item.sku,
        branch.id_sucursal, branch.nombre_sucursal, line.quantity,
        line.before, line.after, line.globalBefore, line.globalAfter, orderId,
        user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local POS")]
        );
      }
    }

    if (cashApplied > 0) {
      await registerCashSale(client, {
        cash: cashSession,
        branch,
        orderId,
        total: cashApplied,
        user
      });
    }

    if (manualDiscount > 0) {
      await client.query(`
        INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
        VALUES(NOW(),'PEDIDOS','DESCUENTO_MANUAL',$1,$2,$3)
      `, [
      orderId,
      `tipo=${manualType}; valor=${manualValue}; descuento=${manualDiscount}; motivo=${manualReason}; total_antes=${totalBeforeManualDiscount}; total_final=${total}`,
      user?.email || user?.nombre || brandText("GMX Local")]
      );
    }

    await client.query('COMMIT');

    /*
     * Never call the provider before the local POS sale,
     * detail and inventory mutation are durable.
     */
    let mercadoPagoResult = null;

    if (isMercadoPagoCardSale) {

      const paymentService =
      await import(
      '../paymentService.js'
      );

      const pendingOrder =
      await getOrder(
        insertedOrder.rows[0].row_id
      );

      if (!pendingOrder) {
        throw new Error(
          'POS_CARD_ORDER_NOT_FOUND_AFTER_COMMIT'
        );
      }

      mercadoPagoResult =
      await paymentService.
      createMercadoPagoPaymentForOrder(
        pendingOrder,
        pendingOrder.public_token || null,
        {
          ...(
          paymentProviderInput &&
          typeof paymentProviderInput === 'object' ?
          paymentProviderInput :
          {}),


          idempotencyKey:
          String(
            paymentProviderInput?.idempotencyKey ||
            `MERCADOPAGO:POS:${idemKey}`
          ).trim()
        }
      );

      const providerPayment =
      mercadoPagoResult?.payment;

      if (!providerPayment?.id) {
        throw new Error(
          'MERCADOPAGO_PAYMENT_RESULT_MISSING'
        );
      }

      const providerStatus =
      String(
        providerPayment.status ||
        ''
      ).
      trim().
      toLowerCase();

      if (providerStatus === 'approved') {

        await paymentService.
        markMercadoPagoPaid(
          providerPayment
        );

      } else {

        await paymentService.
        applyMercadoPagoPaymentState(
          providerPayment
        );
      }

      const pedidoPagoState =
      providerStatus === 'approved' ?
      'PAGADO' :

      ['rejected', 'cancelled'].
      includes(providerStatus) ?
      'FALLIDO' :
      'PENDIENTE';


      await query(
        `UPDATE gmx.pedido_pagos
         SET
           proveedor='MERCADOPAGO',
           provider_payment_id=$2,
           estado=$3,
           referencia=$2
         WHERE id_pedido=$1
           AND metodo='TARJETA'`,
        [
        pendingOrder.id_pedido,
        String(
          mercadoPagoResult.paymentId
        ),
        pedidoPagoState]

      );
    }

    const result = await getOrder(insertedOrder.rows[0].row_id);
    return {
      ...result,
      idempotent_reuse: false,
      inventory_updates: prepared.map((line) => line.itemType === 'PRODUCT' ?
      { type: 'PRODUCT', id: line.product.id, branchId: branch.id_sucursal, stock: line.after } :
      { type: 'TCG', id: line.item.id_inventario, branchId: branch.id_sucursal, stock: line.after })
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelSale(rowId, reason = '', user = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const header = await client.query(`SELECT * FROM gmx.pedidos WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!header.rowCount) throw new Error('ORDER_NOT_FOUND');
    const order = header.rows[0];
    if (String(order.estado_pedido || '').toUpperCase() === 'CANCELADO') throw new Error('ORDER_ALREADY_CANCELLED');
    if (!order.id_sucursal) throw new Error('ORDER_WITHOUT_BRANCH');

    const branch = await fetchBranch(client, order.id_sucursal, { requireActive: false });
    if (!branch) throw new Error('BRANCH_NOT_FOUND');

    const details = await client.query(`SELECT * FROM gmx.detalle_pedidos WHERE id_pedido=$1 ORDER BY row_id`, [order.id_pedido]);

    for (const detail of details.rows) {
      if (String(detail.tipo || 'PRODUCTO').toUpperCase() === 'TCG') {
        const inv = await client.query(`
          SELECT i.*,s.row_id AS branch_row_id,s.stock AS branch_stock,s.stock_reservado AS branch_reserved
          FROM gmx.tcg_inventario i
          JOIN gmx.tcg_inventario_sucursales s
            ON s.id_inventario=i.id_inventario AND s.id_sucursal=$1
          WHERE i.id_inventario=$2
          LIMIT 1 FOR UPDATE OF i,s
        `, [order.id_sucursal, detail.id_inventario]);
        if (!inv.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${detail.id_inventario}`);
        const item = inv.rows[0];
        const qty = Number(detail.cantidad || 0);

        const isWebReserved =
        String(order.canal_venta || '').toUpperCase() === 'WEB_PUBLIC' &&
        String(order.estado_pedido || '').toUpperCase() === 'PENDIENTE' &&
        order.venta_confirmada !== true &&
        order.inventario_liberado !== true;

        const before = Number(item.branch_stock || 0);
        const globalBefore = Number(item.stock || 0);

        if (isWebReserved) {
          const branchReservedBefore = Number(item.branch_reserved || 0);
          const globalReservedBefore = Number(item.stock_reservado || 0);

          if (branchReservedBefore < qty) {
            throw new Error(`INSUFFICIENT_TCG_BRANCH_RESERVATION:${detail.id_inventario}`);
          }

          if (globalReservedBefore < qty) {
            throw new Error(`INSUFFICIENT_TCG_GLOBAL_RESERVATION:${detail.id_inventario}`);
          }

          const branchReservedAfter = branchReservedBefore - qty;
          const globalReservedAfter = globalReservedBefore - qty;

          await client.query(`
            UPDATE gmx.tcg_inventario_sucursales
            SET stock_reservado=$2,ultima_actualizacion=NOW()
            WHERE row_id=$1
          `, [item.branch_row_id, branchReservedAfter]);

          await client.query(`
            UPDATE gmx.tcg_inventario
            SET stock_reservado=$2,ultima_actualizacion=NOW()
            WHERE row_id=$1
          `, [item.row_id, globalReservedAfter]);

          await client.query(`
            INSERT INTO gmx.auditoria(
              fecha,modulo,accion,referencia,detalle,usuario
            )
            VALUES(
              NOW(),
              'TCG',
              'LIBERAR_RESERVA',
              $1,
              $2,
              $3
            )
          `, [
          order.id_pedido,
          `Cancelaci�n pedido WEB: ${item.sku} x${qty}; reserva sucursal ${branchReservedBefore}->${branchReservedAfter}; reserva global ${globalReservedBefore}->${globalReservedAfter}`,
          user?.nombre || user?.email || brandText("GMX Local")]
          );

        } else {
          const after = before + qty;
          const globalAfter = globalBefore + qty;

          await client.query(`
            UPDATE gmx.tcg_inventario_sucursales
            SET stock=$2,ultima_actualizacion=NOW()
            WHERE row_id=$1
          `, [item.branch_row_id, after]);

          await client.query(`
            UPDATE gmx.tcg_inventario
            SET stock=$2,ultima_actualizacion=NOW()
            WHERE row_id=$1
          `, [item.row_id, globalAfter]);

          await client.query(`
            INSERT INTO gmx.tcg_movimientos_sucursales(
              id_movimiento,fecha,tipo,id_inventario,id_carta,sku,
              id_sucursal_destino,sucursal_destino,cantidad,
              stock_destino_anterior,stock_destino_nuevo,
              stock_global_anterior,stock_global_nuevo,
              referencia,motivo,id_admin,administrador
            )
            VALUES(
              'TCGMOV-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
              NOW(),'CANCELACION_VENTA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
              'Cancelaci�n POS',$12,$13
            )
          `, [
          item.id_inventario, item.id_carta, item.sku,
          branch.id_sucursal, branch.nombre_sucursal,
          qty, before, after, globalBefore, globalAfter,
          order.id_pedido,
          user?.id_admin || 'LOCAL',
          user?.nombre || user?.email || brandText("GMX Local POS")]
          );
        }
      } else {
        const product = await fetchProduct(client, detail.id_producto);
        if (!product) throw new Error(`PRODUCT_NOT_FOUND:${detail.id_producto}`);
        const inventory = await lockInventory(client, order.id_sucursal, detail.id_producto);
        if (!inventory) throw new Error(`INVENTORY_NOT_FOUND:${detail.id_producto}`);
        const qty = Number(detail.cantidad || 0);
        const before = Number(inventory.stock || 0),after = before + qty;
        await client.query(`UPDATE gmx.inventario_sucursales SET stock=$1,fecha_actualizacion=NOW() WHERE row_id=$2`,
        [after, inventory.row_id]);
        await logMovement(client, {
          branch, product, type: 'CANCELACION_VENTA', quantity: qty, before, after,
          reason: reason || 'Cancelación de venta POS', reference: order.id_pedido, user
        });
      }
    }

    await reverseBenefitsTx(client, { order, user, reason: reason || 'Cancelación POS' });

    // SHINY_POS_FIX_001
    const cashReversal = await reverseCashSaleOnCancellation(client, { order, branch, user });

    await client.query(`
      UPDATE gmx.pedidos
      SET estado_pedido='CANCELADO',
          venta_confirmada=false,
          inventario_liberado=true,
          estado_pago=CASE WHEN $3::boolean THEN 'REEMBOLSADO' ELSE estado_pago END,
          notas=CASE WHEN NULLIF($1,'') IS NULL THEN notas
            WHEN NULLIF(notas,'') IS NULL THEN $1
            ELSE notas||E'\nCancelación: '||$1 END,
          fecha_actualizacion=NOW()
      WHERE row_id=$2
    `, [reason, rowId, cashReversal.reversed === true]);

    await client.query('COMMIT');
    return getOrder(rowId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


export async function sendOrderReceiptEmail(rowId, user = null, recipientOverride = '') {
  const order = await getOrder(rowId);
  if (!order) throw new Error('ORDER_NOT_FOUND');
  const recipient = String(recipientOverride || order.email || '').trim().toLowerCase();
  if (!recipient) throw new Error('ORDER_EMAIL_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('ORDER_EMAIL_INVALID');

  if (recipientOverride && recipient !== String(order.email || '').trim().toLowerCase()) {
    await query(`UPDATE gmx.pedidos SET email=$2,fecha_actualizacion=NOW() WHERE row_id=$1`, [rowId, recipient]);
    order.email = recipient;
  }

  const pdf = await createOrderReceiptPdf(order);
  const fileName = `Comprobante-${String(order.id_pedido || rowId).replace(/[^a-z0-9_-]/gi, '-')}.pdf`;
  const mail = await queueAndSendEmail({
    to: recipient,
    subject: brandText(`Shiny · Comprobante ${order.id_pedido}`),
    html: posReceiptEmailHtml({ order }),
    attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
    reference: order.id_pedido
  });
  if (!mail.sent) {
    const err = new Error(mail.reason === 'SMTP_NOT_CONFIGURED' ? 'ORDER_SMTP_NOT_CONFIGURED' : 'ORDER_RECEIPT_EMAIL_FAILED');
    err.smtpDiagnostic = mail.diagnostic || null;
    throw err;
  }
  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'PEDIDOS','ENVIAR_COMPROBANTE',$1,$2,$3)`, [
  order.id_pedido, `${recipient}; email=${mail.id}`, user?.email || user?.nombre || brandText("GMX Local")]
  );
  return { sent: true, to: recipient, id: mail.id, orderId: order.id_pedido, attachment: fileName };
}

export async function prepareGuestOrderWhatsApp(rowId, phone, user = null) {
  const digits = String(phone || '').replace(/\D/g, '');
  const whatsappNumber = digits.length === 10 ? `52${digits}` : digits;
  if (whatsappNumber.length < 11 || whatsappNumber.length > 15) {
    throw new Error('ORDER_WHATSAPP_PHONE_INVALID');
  }

  const current = await getOrder(rowId);
  if (!current) throw new Error('ORDER_NOT_FOUND');
  await query(`
    UPDATE gmx.pedidos
    SET telefono=$2,fecha_actualizacion=NOW()
    WHERE row_id=$1
  `, [rowId, whatsappNumber]);

  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'PEDIDOS','PREPARAR_WHATSAPP',$1,$2,$3)`, [
  current.id_pedido,
  `telefono=***${whatsappNumber.slice(-4)}; cliente=${current.id_cliente ? 'REGISTRADO' : 'PUBLICO_GENERAL'}; estado=ABIERTO_PARA_ENVIO`,
  user?.email || user?.nombre || brandText("GMX Local POS")
  ]);

  return { order: await getOrder(rowId), whatsappNumber };
}

export async function createPendingAdminOrder({ branchId, clientId = '', notes = '', items = [], user = null } = {}) {
  if (!branchId) throw new Error('BRANCH_REQUIRED');


  if (!Array.isArray(items) || !items.length) throw new Error('EMPTY_CART');
  const normalized = new Map();
  for (const raw of items) {
    const itemType = String(raw.itemType || 'PRODUCT').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCT';
    const itemId = String(itemType === 'TCG' ? raw.inventoryId || raw.itemId || '' : raw.productId || raw.itemId || '').trim();
    const quantity = Math.trunc(Number(raw.quantity));
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_CART_ITEM');
    const key = `${itemType}:${itemId}`, previous = normalized.get(key);
    normalized.set(key, { itemType, itemId, quantity: (previous?.quantity || 0) + quantity });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const branch = await fetchBranch(client, branchId);
    if (!branch) throw new Error('BRANCH_NOT_FOUND');
    const customer = await fetchClient(client, clientId);
    if (clientId && !customer) throw new Error('CLIENT_NOT_FOUND');
    const orderId = `PED-ADMIN-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lines = [];
    let subtotal = 0;

    for (const raw of normalized.values()) {
      if (raw.itemType === 'PRODUCT') {
        const product = await fetchProduct(client, raw.itemId);
        if (!product) throw new Error(`PRODUCT_NOT_FOUND:${raw.itemId}`);
        const inventory = await lockInventory(client, branchId, raw.itemId);
        if (!inventory) throw new Error(`INVENTORY_NOT_FOUND:${raw.itemId}`);
        if (Number(inventory.stock || 0) < raw.quantity) throw new Error(`INSUFFICIENT_STOCK:${raw.itemId}`);
        const price = Number(product.precio || 0), lineTotal = Number((price * raw.quantity).toFixed(4));
        subtotal += lineTotal;
        lines.push({ ...raw, name: product.nombre, sku: product.sku, price, lineTotal, productId: product.id, inventoryId: null, detail: null });
      } else {
        const inv = await client.query(`SELECT i.*,c.nombre AS carta,s.stock AS branch_stock
          FROM gmx.tcg_inventario i JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
          JOIN gmx.tcg_inventario_sucursales s ON s.id_inventario=i.id_inventario AND s.id_sucursal=$1
          WHERE i.id_inventario=$2 ORDER BY i.row_id LIMIT 1 FOR UPDATE OF i,s`, [branchId, raw.itemId]);
        if (!inv.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${raw.itemId}`);
        const item = inv.rows[0];
        if (Number(item.branch_stock || 0) < raw.quantity || Number(item.stock || 0) < raw.quantity) throw new Error(`INSUFFICIENT_TCG_STOCK:${raw.itemId}`);
        const price = Number(Number(item.precio_oferta || 0) > 0 ? item.precio_oferta : item.precio || 0);
        const lineTotal = Number((price * raw.quantity).toFixed(4));
        subtotal += lineTotal;
        lines.push({ ...raw, name: item.carta, sku: item.sku, price, lineTotal, productId: null, inventoryId: item.id_inventario, detail: null });
      }
    }
    // GMX_MEMBERSHIP_BACKEND_GUARD_R5
    const membershipLines = prepared.filter((line) => line.itemType === 'PRODUCT' && String(line.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (membershipLines.length) {
      if (!customer) throw new Error('MEMBERSHIP_CLIENT_REQUIRED');
      if (membershipLines.some((line) => Number(line.quantity || 0) !== 1)) throw new Error('MEMBERSHIP_QUANTITY_ONE_REQUIRED');
    }
    // GMX_MEMBERSHIP_DUPLICATE_TCG_GUARD_R5D
    const membershipSkuLines = prepared.filter((line) => line.itemType === 'PRODUCT' && String(line.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (membershipSkuLines.length) {
      for (const line of membershipSkuLines) {
        const typeResult = await client.query(`SELECT id,id_juego,nombre,sku FROM gmx.membresia_tipos WHERE UPPER(sku)=UPPER($1) AND activo=true LIMIT 1`,[String(line.sku || '').trim()]);
        const membershipType = typeResult.rows[0];
        if (!membershipType) continue;
        const duplicate = await client.query(`SELECT cm.id,cm.estado,cm.fin FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo WHERE cm.id_cliente=$1 AND mt.id_juego=$2 AND cm.estado IN ('ACTIVA','PROGRAMADA') AND cm.fin>NOW() ORDER BY cm.fin DESC LIMIT 1`,[customer.id_cliente,membershipType.id_juego]);
        if (duplicate.rowCount) throw new Error('MEMBERSHIP_TCG_ALREADY_ACTIVE');
      }
    }
    subtotal = Number(subtotal.toFixed(4));
    const inserted = await client.query(`INSERT INTO gmx.pedidos(
      id_pedido,fecha,id_cliente,nombre_cliente,telefono,email,metodo_pago,subtotal,envio,total,
      estado_pedido,estado_pago,fecha_actualizacion,inventario_liberado,id_admin_venta,vendedor,
      id_sucursal,sucursal,canal_venta,venta_confirmada,notas,total_antes_beneficios)
      VALUES($1,NOW(),NULLIF($2,''),$3,$4,$5,NULL,$6,0,$6,'PENDIENTE','PENDIENTE',NOW(),false,$7,$8,$9,$10,'ADMIN_MANUAL',false,NULLIF($11,''),$6)
      RETURNING row_id`, [orderId, customer?.id_cliente || '', customer?.nombre || 'Público general', customer?.telefono || '', customer?.email || '', subtotal,
      user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText('GMX Admin'), branch.id_sucursal, branch.nombre_sucursal, String(notes || '').trim()]);

    for (const line of lines) {
      await client.query(`INSERT INTO gmx.detalle_pedidos(id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,precio_unitario,tipo,id_inventario,detalle)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$5,$9,$10,$11)`, [orderId, line.productId, line.name, line.quantity, line.price, line.lineTotal,
      `DET-ADMIN-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, line.sku, line.itemType === 'TCG' ? 'TCG' : 'PRODUCTO', line.inventoryId, line.detail]);
    }
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'PEDIDOS','CREAR_PEDIDO_ADMIN',$1,$2,$3)`, [orderId, `estado=PENDIENTE; total=${subtotal}; partidas=${lines.length}`, user?.email || user?.nombre || brandText('GMX Admin')]);
    await client.query('COMMIT');
    return getOrder(inserted.rows[0].row_id);
  } catch (error) {
    try {await client.query('ROLLBACK');} catch {}
    throw error;
  } finally {client.release();}
}


export async function payPendingOrder(rowId, {
  paymentMethod = 'EFECTIVO',
  paymentReference = '',
  notes = '',
  user = null
} = {}) {
  const method = String(paymentMethod || 'EFECTIVO').trim().toUpperCase();
  if (!['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'].includes(method)) {
    throw new Error('INVALID_PAYMENT_METHOD');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const header = await client.query(`
      SELECT *
      FROM gmx.pedidos
      WHERE row_id=$1
      FOR UPDATE
    `, [Number(rowId)]);

    if (!header.rowCount) throw new Error('ORDER_NOT_FOUND');
    const order = header.rows[0];
    const state = String(order.estado_pedido || '').toUpperCase();

    if (state === 'PAGADO') {
      await client.query('COMMIT');
      return getOrder(Number(rowId));
    }
    if (state === 'CANCELADO') throw new Error('ORDER_CANCELLED');
    if (state !== 'PENDIENTE') throw new Error('ORDER_NOT_PENDING');
    if (!order.id_sucursal) throw new Error('ORDER_WITHOUT_BRANCH');

    const branch = await fetchBranch(client, order.id_sucursal, { requireActive: false });
    if (!branch) throw new Error('BRANCH_NOT_FOUND');

    const cashSession = method === 'EFECTIVO' ?
    await lockOpenCashSession(client, branch.id_sucursal) :
    null;
    if (method === 'EFECTIVO' && !cashSession) throw new Error('CASH_SESSION_REQUIRED');

    const details = await client.query(`
      SELECT *
      FROM gmx.detalle_pedidos
      WHERE id_pedido=$1
      ORDER BY row_id
      FOR UPDATE
    `, [order.id_pedido]);

    if (!details.rowCount) throw new Error('ORDER_WITHOUT_DETAILS');

    // Validate and decrement inventory only when payment is confirmed.
    const inventoryUpdates = [];
    for (const detail of details.rows) {
      const qty = Math.max(1, Math.trunc(Number(detail.cantidad || 0)));
      const type = String(detail.tipo || 'PRODUCTO').toUpperCase();

      if (type === 'TCG') {
        if (!detail.id_inventario) throw new Error(`TCG_DETAIL_WITHOUT_INVENTORY:${detail.id_detalle}`);

        const inv = await client.query(`
          SELECT
            i.*,
            s.row_id AS branch_row_id,
            s.stock AS branch_stock,
            s.stock_reservado AS branch_reserved
          FROM gmx.tcg_inventario i
          JOIN gmx.tcg_inventario_sucursales s
            ON s.id_inventario=i.id_inventario
           AND s.id_sucursal=$1
          WHERE i.id_inventario=$2
          ORDER BY i.row_id
          LIMIT 1
          FOR UPDATE OF i,s
        `, [String(order.id_sucursal), String(detail.id_inventario)]);

        if (!inv.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${detail.id_inventario}`);

        const item = inv.rows[0];
        const before = Number(item.branch_stock || 0);
        const globalBefore = Number(item.stock || 0);

        const isWebReserved =
        String(order.canal_venta || '').toUpperCase() === 'WEB_PUBLIC' &&
        order.venta_confirmada !== true &&
        order.inventario_liberado !== true;

        const branchReservedBefore = Number(item.branch_reserved || 0);
        const globalReservedBefore = Number(item.stock_reservado || 0);

        if (before < qty) throw new Error(`INSUFFICIENT_TCG_STOCK:${detail.id_inventario}`);
        if (globalBefore < qty) throw new Error(`INSUFFICIENT_TCG_GLOBAL_STOCK:${detail.id_inventario}`);

        if (isWebReserved && branchReservedBefore < qty) {
          throw new Error(`INSUFFICIENT_TCG_BRANCH_RESERVATION:${detail.id_inventario}`);
        }

        if (isWebReserved && globalReservedBefore < qty) {
          throw new Error(`INSUFFICIENT_TCG_GLOBAL_RESERVATION:${detail.id_inventario}`);
        }

        const after = before - qty;
        const globalAfter = globalBefore - qty;

        const branchReservedAfter = isWebReserved ?
        branchReservedBefore - qty :
        branchReservedBefore;

        const globalReservedAfter = isWebReserved ?
        globalReservedBefore - qty :
        globalReservedBefore;

        await client.query(`
          UPDATE gmx.tcg_inventario_sucursales
          SET
            stock=$2,
            stock_reservado=$3,
            ultima_actualizacion=NOW()
          WHERE row_id=$1
        `, [item.branch_row_id, after, branchReservedAfter]);

        await client.query(`
          UPDATE gmx.tcg_inventario
          SET
            stock=$2,
            stock_reservado=$3,
            ultima_actualizacion=NOW()
          WHERE row_id=$1
        `, [item.row_id, globalAfter, globalReservedAfter]);

        await client.query(`
          INSERT INTO gmx.tcg_movimientos_sucursales(
            id_movimiento,fecha,tipo,id_inventario,id_carta,sku,
            id_sucursal_origen,sucursal_origen,cantidad,
            stock_origen_anterior,stock_origen_nuevo,
            stock_global_anterior,stock_global_nuevo,
            referencia,motivo,id_admin,administrador
          )
          VALUES(
            'TCGMOV-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
            NOW(),'VENTA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
            'Pago de pedido proveniente de cotización',$12,$13
          )
        `, [
        item.id_inventario, item.id_carta, item.sku,
        branch.id_sucursal, branch.nombre_sucursal, qty,
        before, after, globalBefore, globalAfter, order.id_pedido,
        user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
        );
        inventoryUpdates.push({ type: 'TCG', id: item.id_inventario, branchId: branch.id_sucursal, stock: after });
      } else {
        if (!detail.id_producto) throw new Error(`PRODUCT_DETAIL_WITHOUT_PRODUCT:${detail.id_detalle}`);

        const product = await fetchProduct(client, detail.id_producto);
        if (!product) throw new Error(`PRODUCT_NOT_FOUND:${detail.id_producto}`);

        const inventory = await lockInventory(client, order.id_sucursal, detail.id_producto);
        if (!inventory) throw new Error(`INVENTORY_NOT_FOUND:${detail.id_producto}`);

        const before = Number(inventory.stock || 0);
        if (before < qty) throw new Error(`INSUFFICIENT_STOCK:${detail.id_producto}`);
        const after = before - qty;

        await client.query(`
          UPDATE gmx.inventario_sucursales
          SET stock=$1,fecha_actualizacion=NOW()
          WHERE row_id=$2
        `, [after, inventory.row_id]);

        await logMovement(client, {
          branch,
          product,
          type: 'VENTA_PEDIDO',
          quantity: qty,
          before,
          after,
          reason: 'Pago de pedido proveniente de cotización',
          reference: order.id_pedido,
          user
        });
        inventoryUpdates.push({ type: 'PRODUCT', id: product.id, branchId: branch.id_sucursal, stock: after });
      }
    }

    await client.query(`
      UPDATE gmx.pedidos
      SET
        metodo_pago=$2,
        referencia_pago=NULLIF($3,''),
        fecha_pago=NOW(),
        estado_pedido='PAGADO',
        estado_pago='PAGADO',
        venta_confirmada=true,
        inventario_liberado=false,
        notas=CASE
          WHEN NULLIF($4,'') IS NULL THEN notas
          WHEN NULLIF(notas,'') IS NULL THEN $4
          ELSE notas||E'\n'||$4
        END,
        fecha_actualizacion=NOW()
      WHERE row_id=$1
    `, [
    Number(rowId),
    method,
    String(paymentReference || '').trim(),
    String(notes || '').trim()]
    );

    await client.query(`INSERT INTO gmx.pedido_pagos(
      id_pago,id_pedido,linea,metodo,importe_aplicado,efectivo_recibido,cambio_entregado,
      referencia,proveedor,provider_payment_id,estado,id_admin,administrador,fecha)
      VALUES('PAG-PED-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,6),
      $1,1,$2,$3,NULL,NULL,NULLIF($4,''),NULL,NULL,'PAGADO',NULLIF($5,''),$6,NOW())`, [
    order.id_pedido, method, Number(order.total || 0), String(paymentReference || '').trim(),
    String(user?.id_admin || '').trim(), String(user?.nombre || user?.email || brandText('GMX Local POS')).trim()]);

    if (method === 'EFECTIVO') {
      await registerCashSale(client, {
        cash: cashSession,
        branch,
        orderId: order.id_pedido,
        total: Number(order.total || 0),
        user
      });
    }

    await client.query(`
      INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'PEDIDOS','REGISTRAR_PAGO',$1,$2,$3)
    `, [
    order.id_pedido,
    `${method}${paymentReference ? `; referencia=${String(paymentReference).trim()}` : ''}; total=${Number(order.total || 0)}`,
    user?.email || user?.nombre || brandText("GMX Local")]
    );

    await client.query('COMMIT');
    const result = await getOrder(Number(rowId));
    return { ...result, inventory_updates: inventoryUpdates };
  } catch (error) {
    try {await client.query('ROLLBACK');} catch {}
    throw error;
  } finally {
    client.release();
  }
}
