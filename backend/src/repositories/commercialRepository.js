import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';
import { applyPartialReturnBenefitsTx } from './benefitsRepository.js';
import { queueAndSendEmail, quoteEmailHtml } from '../emailService.js';

const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const n = (v) => Number(v || 0);
const i = (v) => Math.trunc(Number(v || 0));
const txt = (v) => String(v ?? '').trim();

async function getBranch(client, id) {
  const r = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales
    WHERE id_sucursal=$1 ORDER BY row_id LIMIT 1`, [id]);
  if (!r.rowCount) throw new Error('BRANCH_NOT_FOUND');
  return r.rows[0];
}
async function openCash(client, branchId) {
  const r = await client.query(`SELECT * FROM gmx.caja_sesiones
    WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
    ORDER BY fecha_apertura DESC,row_id DESC LIMIT 1 FOR UPDATE`, [branchId]);
  return r.rows[0] || null;
}
async function audit(client, user, module, action, reference, detail = '') {
  await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),$1,$2,$3,$4,$5)`, [
  module, action, reference || null, detail || null, user?.email || brandText("GMX Local")]
  );
}

/* =========================
   PROVEEDORES
========================= */

export async function listProviders({ search = '', active = '' } = {}) {
  const vals = [],f = [];
  if (search) {
    vals.push(`%${search}%`);
    f.push(`(COALESCE(id_proveedor,'') ILIKE $${vals.length}
      OR COALESCE(razon_social,'') ILIKE $${vals.length}
      OR COALESCE(nombre_comercial,'') ILIKE $${vals.length}
      OR COALESCE(rfc,'') ILIKE $${vals.length}
      OR COALESCE(email,'') ILIKE $${vals.length})`);
  }
  if (active !== '') {
    vals.push(String(active).toLowerCase() === 'true');
    f.push(`COALESCE(activo,true)=$${vals.length}`);
  }
  return query(`SELECT * FROM gmx.proveedores ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY COALESCE(NULLIF(nombre_comercial,''),razon_social,id_proveedor),row_id LIMIT 1000`, vals);
}

export async function saveProvider(rowId, input, user) {
  const b = input || {};
  const phone = txt(b.telefono);
  if (phone && !/^\d+$/.test(phone)) throw new Error('PHONE_NUMBERS_ONLY');
  const email = txt(b.email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_EMAIL');
  const terms = String(b.terminos_pago || 'CONTADO').toUpperCase();
  if (!['CONTADO', 'CREDITO'].includes(terms)) throw new Error('INVALID_PAYMENT_TERMS');
  const creditDays = terms === 'CREDITO' ? Math.max(0, i(b.dias_credito || 0)) : 0;

  if (rowId) {
    const r = await query(`UPDATE gmx.proveedores SET
      razon_social=$2,nombre_comercial=$3,rfc=$4,contacto=$5,telefono=$6,email=$7,
      direccion=$8,ciudad=$9,estado=$10,cp=$11,pais=$12,terminos_pago=$13,dias_credito=$14,
      moneda=$15,banco=$16,cuenta_referencia=$17,notas=$18,activo=$19,fecha_actualizacion=NOW()
      WHERE row_id=$1 RETURNING *`, [
    rowId, b.razon_social || null, b.nombre_comercial || null, b.rfc || null, b.contacto || null, phone || null, email || null,
    b.direccion || null, b.ciudad || null, b.estado || null, b.cp || null, b.pais || 'México', terms,
    creditDays, b.moneda || 'MXN', b.banco || null, b.cuenta_referencia || null, b.notas || null, b.activo !== false]
    );
    if (!r.rowCount) throw new Error('PROVIDER_NOT_FOUND');
    await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'PROVEEDORES','EDITAR',$1,$2,$3)`, [
    r.rows[0].id_proveedor, 'Datos maestros actualizados', user?.email || brandText("GMX Local")]
    );
    return r.rows[0];
  }

  if (!txt(b.razon_social) && !txt(b.nombre_comercial)) throw new Error('PROVIDER_NAME_REQUIRED');
  const id = txt(b.id_proveedor) || uid('PROV');
  const r = await query(`INSERT INTO gmx.proveedores(
    id_proveedor,razon_social,nombre_comercial,rfc,contacto,telefono,email,direccion,ciudad,estado,cp,pais,
    terminos_pago,dias_credito,moneda,banco,cuenta_referencia,notas,activo,fecha_registro,fecha_actualizacion)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
    RETURNING *`, [
  id, b.razon_social || null, b.nombre_comercial || null, b.rfc || null, b.contacto || null, phone || null, email || null,
  b.direccion || null, b.ciudad || null, b.estado || null, b.cp || null, b.pais || 'México', terms,
  creditDays, b.moneda || 'MXN', b.banco || null, b.cuenta_referencia || null, b.notas || null, b.activo !== false]
  );
  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'PROVEEDORES','CREAR',$1,$2,$3)`, [
  id, 'Proveedor maestro creado', user?.email || brandText("GMX Local")]
  );
  return r.rows[0];
}

/* =========================
   COTIZACIONES
========================= */

export async function listQuotes({ search = '', status = '', limit = 300 } = {}) {
  const vals = [],f = [];
  if (search) {vals.push(`%${search}%`);f.push(`(COALESCE(id,'') ILIKE $${vals.length} OR COALESCE(cliente,'') ILIKE $${vals.length} OR COALESCE(email,'') ILIKE $${vals.length})`);}
  if (status) {vals.push(status);f.push(`estado=$${vals.length}`);}
  vals.push(Math.min(Math.max(i(limit) || 300, 1), 1000));
  return query(`SELECT * FROM gmx.cotizaciones_admin ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY fecha DESC NULLS LAST,row_id DESC LIMIT $${vals.length}`, vals);
}

export async function getQuote(rowId) {
  const r = await query(`SELECT * FROM gmx.cotizaciones_admin WHERE row_id=$1`, [rowId]);
  return r.rows[0] || null;
}

export async function createQuote(input, user) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new Error('EMPTY_QUOTE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const normalized = [];let subtotal = 0;
    for (const x of items) {
      const type = String(x.itemType || 'PRODUCT').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCT';
      const qty = Math.max(1, i(x.quantity || 1));
      if (type === 'TCG') {
        const inventoryId = String(x.inventoryId || '').trim();
        const v = await client.query(`SELECT i.id_inventario,i.id_carta,i.sku,i.idioma,i.condicion,i.acabado,i.edicion,i.precio,i.precio_oferta,COALESCE(i.rareza,c.rareza) AS rareza,c.nombre AS carta,c.numero_completo,s.id_sucursal,s.sucursal,s.stock FROM gmx.tcg_inventario i JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta JOIN gmx.tcg_inventario_sucursales s ON s.id_inventario=i.id_inventario WHERE i.id_inventario=$1 AND ($2::text='' OR s.id_sucursal=$2) ORDER BY s.row_id LIMIT 1`, [inventoryId, String(input.branchId || x.branchId || '')]);
        if (!v.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${inventoryId}`);
        const row = v.rows[0];if (Number(row.stock || 0) < qty) throw new Error(`INSUFFICIENT_TCG_STOCK:${inventoryId}`);
        const def = Number(Number(row.precio_oferta || 0) > 0 ? row.precio_oferta : row.precio || 0),price = Number(x.price ?? def);
        if (!Number.isFinite(price) || price < 0) throw new Error('INVALID_QUOTE_PRICE');
        normalized.push({ item_type: 'TCG', id_producto: null, id_inventario: row.id_inventario, id_carta: row.id_carta, sku: row.sku, producto: row.carta, numero_carta: row.numero_completo || '', rareza: row.rareza || '', condicion: row.condicion || '', idioma: row.idioma || '', acabado: row.acabado || '', edicion: row.edicion || '', id_sucursal: row.id_sucursal, sucursal: row.sucursal, cantidad: qty, precio_unitario: price, subtotal: qty * price });
        subtotal += qty * price;
      } else {
        const p = await client.query(`SELECT id,sku,nombre,precio,estado FROM gmx.productos WHERE id=$1 ORDER BY row_id LIMIT 1`, [x.productId]);
        if (!p.rowCount) throw new Error(`PRODUCT_NOT_FOUND:${x.productId}`);
        const price = Number(x.price ?? p.rows[0].precio);if (!Number.isFinite(price) || price < 0) throw new Error('INVALID_QUOTE_PRICE');
        normalized.push({ item_type: 'PRODUCT', id_producto: p.rows[0].id, id_inventario: null, sku: p.rows[0].sku, producto: p.rows[0].nombre, cantidad: qty, precio_unitario: price, subtotal: qty * price });subtotal += qty * price;
      }
    }
    // Un cliente registrado es la fuente maestra de sus datos.
    // Los módulos operativos solo referencian al cliente; no sobrescriben
    // nombre, email o teléfono enviados desde el frontend.
    let quoteClientName = input.clientName || 'Público general';
    let quoteEmail = input.email || null;
    let quotePhone = input.phone || null;

    if (input.clientId) {
      const master = await client.query(`
        SELECT id_cliente,nombre,email,telefono
        FROM gmx.clientes
        WHERE id_cliente=$1
        LIMIT 1
      `, [String(input.clientId)]);

      if (!master.rowCount) throw new Error('CLIENT_NOT_FOUND');

      quoteClientName = master.rows[0].nombre || master.rows[0].id_cliente || 'Público general';
      quoteEmail = master.rows[0].email || null;
      quotePhone = master.rows[0].telefono || null;
    }

    const discount = Math.max(0, n(input.discount));
    const total = Math.max(0, subtotal - discount);
    const id = uid('COT');

    const r = await client.query(`
      INSERT INTO gmx.cotizaciones_admin(
        id,fecha,cliente,email,telefono,validez_dias,
        subtotal,descuento,total,estado,items_json,notas,actualizacion
      )
      VALUES(
        $1,NOW(),$2,$3,$4,$5,$6,$7,$8,
        'BORRADOR',$9::jsonb,$10,NOW()
      )
      RETURNING row_id
    `, [
    id,
    quoteClientName,
    quoteEmail,
    quotePhone,
    Math.max(1, i(input.validityDays || 15)),
    subtotal,
    discount,
    total,
    JSON.stringify(normalized),
    input.notes || null]
    );

    await audit(client, user, 'COTIZACIONES', 'CREAR', id, `Total ${total}`);
    await client.query('COMMIT');
    return getQuote(r.rows[0].row_id);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function sendQuoteEmail(rowId, user) {
  const q = await getQuote(rowId);
  if (!q) throw new Error('QUOTE_NOT_FOUND');

  const current = String(q.estado || 'BORRADOR').toUpperCase();
  if (['CONVERTIDA', 'RECHAZADA', 'VENCIDA'].includes(current)) throw new Error('QUOTE_NOT_SENDABLE');

  const recipient = txt(q.email).toLowerCase();
  if (!recipient) throw new Error('QUOTE_EMAIL_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('QUOTE_EMAIL_INVALID');

  const mail = await queueAndSendEmail({
    to: recipient,
    subject: brandText(`Shiny · Cotización ${q.id}`),
    html: quoteEmailHtml({ quote: q }),
    reference: q.id
  });

  if (!mail.sent) {
    const reason = String(mail.reason || 'EMAIL_NOT_SENT');
    await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'COTIZACIONES','ENVIO_EMAIL_ERROR',$1,$2,$3)`, [
    q.id, `${recipient}; ${reason}`, user?.email || brandText("GMX Local")]
    );
    if (reason === 'SMTP_NOT_CONFIGURED') throw new Error('QUOTE_SMTP_NOT_CONFIGURED');
    if (reason === 'SMTP_ERROR') throw new Error('QUOTE_EMAIL_SEND_FAILED');
    throw new Error(reason);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(`
      UPDATE gmx.cotizaciones_admin
      SET estado=CASE WHEN estado='BORRADOR' THEN 'ENVIADA' ELSE estado END,
          actualizacion=NOW()
      WHERE row_id=$1
      RETURNING *
    `, [rowId]);
    await audit(client, user, 'COTIZACIONES', 'ENVIAR_EMAIL', q.id,
    `${recipient}; email=${mail.id}; estado=${updated.rows[0]?.estado || current}`);
    await client.query('COMMIT');
    return { ...updated.rows[0], mail: { id: mail.id, sent: true, to: recipient } };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {client.release();}
}

export async function updateQuoteStatus(rowId, status, user) {
  const allowed = ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'];
  status = String(status || '').toUpperCase();
  if (!allowed.includes(status)) throw new Error('INVALID_QUOTE_STATUS');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`UPDATE gmx.cotizaciones_admin SET estado=$2,actualizacion=NOW()
      WHERE row_id=$1 AND estado<>'CONVERTIDA' RETURNING *`, [rowId, status]);
    if (!q.rowCount) throw new Error('QUOTE_NOT_UPDATABLE');
    await audit(client, user, 'COTIZACIONES', 'ESTADO', q.rows[0].id, status);
    await client.query('COMMIT');
    return q.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function convertQuote(rowId, input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`SELECT * FROM gmx.cotizaciones_admin WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!q.rowCount) throw new Error('QUOTE_NOT_FOUND');
    const quote = q.rows[0];
    if (quote.estado === 'CONVERTIDA') throw new Error('QUOTE_ALREADY_CONVERTED');
    if (['RECHAZADA', 'VENCIDA'].includes(String(quote.estado || '').toUpperCase())) throw new Error('QUOTE_NOT_CONVERTIBLE');
    const items = Array.isArray(quote.items_json) ? quote.items_json : JSON.parse(quote.items_json || '[]');
    const branch = await getBranch(client, input.branchId);
    const id = uid('PED-COT');
    await client.query(`INSERT INTO gmx.pedidos(
      id_pedido,fecha,id_cliente,nombre_cliente,telefono,email,metodo_pago,subtotal,envio,total,
      estado_pedido,notas,fecha_actualizacion,inventario_liberado,id_admin_venta,vendedor,
      id_sucursal,sucursal,canal_venta,venta_confirmada)
      VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,0,$8,'PENDIENTE',$9,NOW(),false,$10,$11,$12,$13,'COTIZACION',false)`, [
    id, input.clientId || null, quote.cliente, quote.telefono, quote.email, input.paymentMethod || 'POR_DEFINIR',
    quote.subtotal, quote.total, `Origen cotización ${quote.id}`, user?.id_admin || 'LOCAL',
    user?.nombre || user?.email || brandText("GMX Local"), branch.id_sucursal, branch.nombre_sucursal]
    );
    let line = 0;
    for (const x of items) {
      line++;
      const type = String(x.item_type || 'PRODUCT').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCTO';
      if (type === 'TCG') {
        const check = await client.query(`SELECT s.stock FROM gmx.tcg_inventario i JOIN gmx.tcg_inventario_sucursales s ON s.id_inventario=i.id_inventario WHERE i.id_inventario=$1::text AND s.id_sucursal=$2::text LIMIT 1`, [
        String(x.id_inventario), String(branch.id_sucursal)]
        );
        if (!check.rowCount) throw new Error(`TCG_NOT_AVAILABLE_IN_BRANCH:${x.id_inventario}`);
        if (Number(check.rows[0].stock || 0) < Number(x.cantidad || 0)) throw new Error(`INSUFFICIENT_TCG_STOCK:${x.id_inventario}`);
        const detail = [x.numero_carta, x.rareza ? `(${x.rareza})` : null, x.condicion, x.idioma, x.acabado, x.edicion, `Cotización ${quote.id}`].filter(Boolean).join(' · ');
        await client.query(`INSERT INTO gmx.detalle_pedidos(id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,precio_unitario,tipo,id_inventario,detalle) VALUES($1,NULL,$2,$3,$4,$5,$6,$7,$4,'TCG',$8,$9)`, [id, x.producto, x.cantidad, x.precio_unitario, x.subtotal, `${id}-${line}`, x.sku, x.id_inventario, detail]);
      } else {
        await client.query(`INSERT INTO gmx.detalle_pedidos(id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,precio_unitario,tipo,detalle) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$5,'PRODUCTO',$9)`, [id, x.id_producto, x.producto, x.cantidad, x.precio_unitario, x.subtotal, `${id}-${line}`, x.sku, `Cotización ${quote.id}`]);
      }
    }
    await client.query(`UPDATE gmx.cotizaciones_admin SET estado='CONVERTIDA',
      notas=CONCAT_WS(' | ',NULLIF(notas,''),$2::text),actualizacion=NOW() WHERE row_id=$1`, [
    Number(rowId), String(`Pedido ${id}`)]
    );
    await audit(client, user, 'COTIZACIONES', 'CONVERTIR', quote.id, id);
    await client.query('COMMIT');
    return { id_cotizacion: quote.id, id_pedido: id, status: 'PENDIENTE', inventoryChanged: false };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

/* =========================
   CUENTAS POR PAGAR
========================= */

export async function listPayables({ status = '', limit = 300 } = {}) {
  const vals = [],f = [];
  if (status) {vals.push(status);f.push(`estado=$${vals.length}`);}
  vals.push(Math.min(Math.max(i(limit) || 300, 1), 1000));
  return query(`SELECT * FROM gmx.cuentas_por_pagar ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY CASE WHEN vencimiento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN vencimiento END,fecha DESC NULLS LAST,row_id DESC
    LIMIT $${vals.length}`, vals);
}
export async function listPayablePayments(id) {
  return query(`SELECT * FROM gmx.cuentas_por_pagar_pagos WHERE id_cxp=$1 ORDER BY fecha DESC,row_id DESC`, [id]);
}
export async function createPayable(input, user) {
  const total = n(input.total);
  if (total <= 0) throw new Error('INVALID_PAYABLE_TOTAL');
  const providerId = txt(input.providerId);
  const branchId = txt(input.branchId);
  if (!providerId) throw new Error('PROVIDER_REQUIRED');
  if (!branchId) throw new Error('BRANCH_REQUIRED');

  const provider = await query(`SELECT * FROM gmx.proveedores
    WHERE id_proveedor=$1 AND COALESCE(activo,true)=true ORDER BY row_id LIMIT 1`, [providerId]);
  if (!provider.rowCount) throw new Error('PROVIDER_NOT_FOUND');
  const branch = await query(`SELECT * FROM gmx.sucursales
    WHERE id_sucursal=$1 AND COALESCE(activa,true)=true ORDER BY row_id LIMIT 1`, [branchId]);
  if (!branch.rowCount) throw new Error('BRANCH_NOT_FOUND');

  const p = provider.rows[0],b = branch.rows[0];
  const id = uid('CXP');
  const r = await query(`INSERT INTO gmx.cuentas_por_pagar(
    id,fecha,id_proveedor,proveedor,documento,id_compra,origen,moneda,id_sucursal,
    vencimiento,total,pagado,saldo,estado,sucursal,notas,actualizacion)
    VALUES($1,NOW(),$2,$3,$4,NULL,'MANUAL',$5,$6,$7,$8,0,$8,'PENDIENTE',$9,$10,NOW())
    RETURNING *`, [
  id, p.id_proveedor, p.nombre_comercial || p.razon_social || p.id_proveedor, input.document || null,
  p.moneda || 'MXN', b.id_sucursal, input.dueDate || null, total, b.nombre_sucursal, input.notes || null]
  );
  await audit(null, user, 'CXP', 'CREAR', id, `Manual · ${p.id_proveedor} · ${total}`);
  return r.rows[0];
}

export async function createPayableFromPurchase(rowId, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(`SELECT c.*,pr.terminos_pago AS proveedor_terminos,pr.dias_credito AS proveedor_dias
      FROM gmx.compras c
      LEFT JOIN gmx.proveedores pr ON pr.id_proveedor=c.id_proveedor
      WHERE c.row_id=$1 FOR UPDATE OF c`, [rowId]);
    if (!p.rowCount) throw new Error('PURCHASE_NOT_FOUND');
    const x = p.rows[0];
    if (String(x.estado || '').toUpperCase() === 'CANCELADA') throw new Error('PURCHASE_CANCELLED');

    const existing = await client.query(`SELECT * FROM gmx.cuentas_por_pagar
      WHERE id_compra=$1 OR (documento=$1 AND origen='COMPRA') ORDER BY row_id LIMIT 1`, [x.id_compra]);
    if (existing.rowCount) {await client.query('COMMIT');return existing.rows[0];}

    const days = Math.max(0, i(x.dias_credito ?? x.proveedor_dias ?? 0));
    const due = new Date(x.fecha || Date.now());due.setDate(due.getDate() + days);
    const id = uid('CXP');
    const r = await client.query(`INSERT INTO gmx.cuentas_por_pagar(
      id,fecha,id_proveedor,proveedor,documento,id_compra,origen,moneda,id_sucursal,
      vencimiento,total,pagado,saldo,estado,sucursal,notas,actualizacion)
      VALUES($1,NOW(),$2,$3,$4,$4,'COMPRA',$5,$6,$7,$8,0,$8,'PENDIENTE',$9,$10,NOW()) RETURNING *`, [
    id, x.id_proveedor, x.proveedor, x.id_compra, x.moneda || 'MXN', x.id_sucursal_recepcion || null,
    due.toISOString().slice(0, 10), n(x.total), x.sucursal_recepcion || null, `Generada desde compra ${x.id_compra}`]
    );
    await audit(client, user, 'CXP', 'CREAR_DESDE_COMPRA', id, x.id_compra);
    await client.query('COMMIT');return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function syncCreditPurchasePayables(user) {
  const candidates = await query(`
    SELECT c.row_id
    FROM gmx.compras c
    LEFT JOIN gmx.proveedores p ON p.id_proveedor=c.id_proveedor
    LEFT JOIN gmx.cuentas_por_pagar cx ON cx.id_compra=c.id_compra
    WHERE UPPER(COALESCE(c.estado,''))<>'CANCELADA'
      AND cx.row_id IS NULL
      AND (
        UPPER(COALESCE(c.metodo_pago,''))='CREDITO'
        OR UPPER(COALESCE(c.terminos_pago,p.terminos_pago,''))='CREDITO'
      )
    ORDER BY c.row_id
    LIMIT 500
  `);
  let created = 0;
  for (const row of candidates.rows) {
    await createPayableFromPurchase(row.row_id, user);
    created++;
  }
  return { created, reviewed: candidates.rowCount };
}

export async function payPayable(id, input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.cuentas_por_pagar WHERE id=$1 FOR UPDATE`, [id]);
    if (!r.rowCount) throw new Error('PAYABLE_NOT_FOUND');
    const x = r.rows[0],amount = n(input.amount);
    if (String(x.estado || '').toUpperCase() === 'CANCELADA') throw new Error('PAYABLE_CANCELLED');
    if (amount <= 0 || amount > n(x.saldo)) throw new Error('INVALID_PAYMENT_AMOUNT');

    const method = String(input.paymentMethod || 'TRANSFERENCIA').toUpperCase();
    if (!['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO'].includes(method)) throw new Error('INVALID_PAYMENT_METHOD');
    const branchId = txt(input.branchId || x.id_sucursal);
    if (!branchId) throw new Error('BRANCH_REQUIRED');
    const b = await getBranch(client, branchId);

    let cashMove = null;
    if (method === 'EFECTIVO') {
      const cash = await openCash(client, b.id_sucursal);
      if (!cash) throw new Error('NO_OPEN_CASH_FOR_PAYMENT');
      cashMove = uid('CAJCXP');
      await client.query(`INSERT INTO gmx.caja_movimientos(
        id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
        importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
        VALUES($1,$2,NOW(),$3,$4,'EGRESO','CUENTA_POR_PAGAR','EFECTIVO',$5,$6,$7,
        'Pago cuenta por pagar','CXP',$8,$9,$10,false)`, [
      cashMove, cash.id_caja, b.id_sucursal, b.nombre_sucursal, amount, -amount, input.reference || id, id,
      user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
      await client.query(`UPDATE gmx.caja_sesiones SET egresos_efectivo=COALESCE(egresos_efectivo,0)+$2,
        saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))-$2,fecha_actualizacion=NOW()
        WHERE id_caja=$1`, [cash.id_caja, amount]);
    }

    const paid = n(x.pagado) + amount,balance = Math.max(0, n(x.total) - paid);
    const state = balance === 0 ? 'PAGADA' : 'PARCIAL';
    const payId = uid('CXPPAY');
    await client.query(`INSERT INTO gmx.cuentas_por_pagar_pagos(
      id_pago,id_cxp,fecha,monto,metodo_pago,referencia,id_sucursal,sucursal,id_movimiento_caja,id_admin,administrador,notas)
      VALUES($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
    payId, id, amount, method, input.reference || null, b.id_sucursal, b.nombre_sucursal, cashMove,
    user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"), input.notes || null]
    );

    // Every CxP payment becomes one linked Egreso. It is informational/financial,
    // not a second cash movement.
    const expenseId = uid('GASTOCXP');
    await client.query(`INSERT INTO gmx.gastos(
      id_gasto,fecha_creacion,fecha_gasto,id_sucursal,sucursal,categoria,subcategoria,concepto,
      id_proveedor,proveedor,moneda,subtotal,impuestos,total,metodo_pago,referencia,estado,
      fecha_confirmacion,fecha_pago,caja_registrada,id_movimiento_caja,caja_reversada,
      id_admin_creador,admin_creador,id_admin_actualiza,admin_actualiza,notas,fecha_actualizacion,
      origen_modulo,id_origen)
      VALUES($1,NOW(),NOW(),$2,$3,'CUENTA_POR_PAGAR','ABONO',$4,$5,$6,$7,$8,0,$8,$9,$10,
      'PAGADO',NOW(),NOW(),$11,$12,false,$13,$14,$13,$14,$15,NOW(),'CXP',$16)`, [
    expenseId, b.id_sucursal, b.nombre_sucursal, `Pago ${x.documento || x.id}`,
    x.id_proveedor || null, x.proveedor || null, x.moneda || 'MXN', amount, method, input.reference || null,
    method === 'EFECTIVO', cashMove, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"),
    `Generado automáticamente desde ${id}`, payId]
    );

    await client.query(`UPDATE gmx.cuentas_por_pagar SET pagado=$2,saldo=$3,estado=$4,actualizacion=NOW() WHERE id=$1`,
    [id, paid, balance, state]);
    await audit(client, user, 'CXP', 'PAGO', id, `${amount} ${method}; egreso=${expenseId}`);
    await client.query('COMMIT');
    return { id, id_pago: payId, id_gasto: expenseId, pagado: paid, saldo: balance, estado: state };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


/* =========================
   GASTOS
========================= */

export async function listExpenses({ branchId = '', status = '', limit = 300 } = {}) {
  const vals = [],f = [];
  if (branchId) {vals.push(branchId);f.push(`id_sucursal=$${vals.length}`);}
  if (status) {vals.push(status);f.push(`estado=$${vals.length}`);}
  vals.push(Math.min(Math.max(i(limit) || 300, 1), 1000));
  return query(`SELECT * FROM gmx.gastos ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY fecha_gasto DESC NULLS LAST,fecha_creacion DESC NULLS LAST,row_id DESC LIMIT $${vals.length}`, vals);
}
export async function createExpense(input, user) {
  const total = n(input.total);
  if (total <= 0) throw new Error('INVALID_EXPENSE_TOTAL');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await getBranch(client, input.branchId);
    let providerId = txt(input.providerId) || null,providerName = null;
    if (providerId) {
      const pr = await client.query(`SELECT * FROM gmx.proveedores WHERE id_proveedor=$1 ORDER BY row_id LIMIT 1`, [providerId]);
      if (!pr.rowCount) throw new Error('PROVIDER_NOT_FOUND');
      providerName = pr.rows[0].nombre_comercial || pr.rows[0].razon_social || pr.rows[0].id_proveedor;
    }
    const id = uid('GASTO');
    const r = await client.query(`INSERT INTO gmx.gastos(
      id_gasto,fecha_creacion,fecha_gasto,id_sucursal,sucursal,categoria,subcategoria,concepto,id_proveedor,proveedor,
      moneda,subtotal,impuestos,total,metodo_pago,referencia,comprobante_url,estado,caja_registrada,caja_reversada,
      id_admin_creador,admin_creador,id_admin_actualiza,admin_actualiza,notas,fecha_actualizacion,origen_modulo,id_origen)
      VALUES($1,NOW(),COALESCE($2::timestamptz,NOW()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
      'PENDIENTE',false,false,$17,$18,$17,$18,$19,NOW(),'MANUAL',$1) RETURNING *`, [
    id, input.expenseDate || null, b.id_sucursal, b.nombre_sucursal, input.category || 'GENERAL', input.subcategory || null,
    input.concept || null, providerId, providerName, input.currency || 'MXN',
    n(input.subtotal || total), n(input.taxes || 0), total, String(input.paymentMethod || 'TRANSFERENCIA').toUpperCase(),
    input.reference || null, input.receiptUrl || null, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"), input.notes || null]
    );
    await audit(client, user, 'GASTOS', 'CREAR', id, input.concept || '');
    await client.query('COMMIT');return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function payExpense(rowId, input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.gastos WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!r.rowCount) throw new Error('EXPENSE_NOT_FOUND');
    const x = r.rows[0];
    if (String(x.estado).toUpperCase() === 'PAGADO') {await client.query('COMMIT');return x;}
    if (String(x.estado).toUpperCase() === 'CANCELADO') throw new Error('EXPENSE_CANCELLED');
    if (String(x.origen_modulo || 'MANUAL').toUpperCase() === 'CXP') throw new Error('EXPENSE_ALREADY_PAID_BY_SOURCE');

    let move = null;
    const method = String(x.metodo_pago || 'TRANSFERENCIA').toUpperCase();
    if (method === 'EFECTIVO') {
      const cash = await openCash(client, x.id_sucursal);
      if (!cash) throw new Error('NO_OPEN_CASH_FOR_EXPENSE');
      move = uid('CAJGASTO');
      await client.query(`INSERT INTO gmx.caja_movimientos(
        id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
        importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
        VALUES($1,$2,NOW(),$3,$4,'EGRESO','GASTO','EFECTIVO',$5,$6,$7,$8,'GASTOS',$9,$10,$11,false)`, [
      move, cash.id_caja, x.id_sucursal, x.sucursal, n(x.total), -n(x.total), x.referencia || x.id_gasto,
      x.concepto || 'Gasto', x.id_gasto, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
      await client.query(`UPDATE gmx.caja_sesiones SET egresos_efectivo=COALESCE(egresos_efectivo,0)+$2,
        saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))-$2,fecha_actualizacion=NOW()
        WHERE id_caja=$1`, [cash.id_caja, n(x.total)]);
    }
    const u = await client.query(`UPDATE gmx.gastos SET estado='PAGADO',fecha_confirmacion=NOW(),fecha_pago=NOW(),
      caja_registrada=$2,id_movimiento_caja=$3,id_admin_actualiza=$4,admin_actualiza=$5,fecha_actualizacion=NOW()
      WHERE row_id=$1 RETURNING *`, [
    rowId, method === 'EFECTIVO', move, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
    );
    await audit(client, user, 'GASTOS', 'PAGAR', x.id_gasto, `${x.total} ${method}`);
    await client.query('COMMIT');return u.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function cancelExpense(rowId, reason, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.gastos WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!r.rowCount) throw new Error('EXPENSE_NOT_FOUND');
    const x = r.rows[0];
    if (String(x.estado).toUpperCase() === 'CANCELADO') {await client.query('COMMIT');return x;}
    if (['CXP', 'COMPRA'].includes(String(x.origen_modulo || '').toUpperCase())) throw new Error('SOURCE_MANAGED_EXPENSE');

    let reverse = null;
    if (x.caja_registrada && !x.caja_reversada && x.id_movimiento_caja) {
      const original = await client.query(`SELECT * FROM gmx.caja_movimientos WHERE id_movimiento=$1 FOR UPDATE`, [x.id_movimiento_caja]);
      if (original.rowCount) {
        const o = original.rows[0];
        const cash = await openCash(client, o.id_sucursal);
        if (!cash) throw new Error('NO_OPEN_CASH_FOR_EXPENSE_REVERSAL');
        reverse = uid('CAJREV');
        await client.query(`INSERT INTO gmx.caja_movimientos(
          id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
          importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado,id_movimiento_reversion)
          VALUES($1,$2,NOW(),$3,$4,'INGRESO','REVERSO_GASTO','EFECTIVO',$5,$5,$6,
          'Reverso cancelación gasto','GASTOS',$7,$8,$9,false,$10)`, [
        reverse, cash.id_caja, o.id_sucursal, o.sucursal, n(o.importe), x.id_gasto, x.id_gasto,
        user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"), o.id_movimiento]
        );
        await client.query(`UPDATE gmx.caja_sesiones SET ingresos_efectivo=COALESCE(ingresos_efectivo,0)+$2,
          saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))+$2,fecha_actualizacion=NOW() WHERE id_caja=$1`,
        [cash.id_caja, n(o.importe)]);
      }
    }
    const u = await client.query(`UPDATE gmx.gastos SET estado='CANCELADO',fecha_cancelacion=NOW(),motivo_cancelacion=$2,
      caja_reversada=$3,id_movimiento_caja_reverso=$4,id_admin_actualiza=$5,admin_actualiza=$6,fecha_actualizacion=NOW()
      WHERE row_id=$1 RETURNING *`, [
    rowId, reason || 'Cancelado', Boolean(reverse), reverse, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
    );
    await audit(client, user, 'GASTOS', 'CANCELAR', x.id_gasto, reason || '');
    await client.query('COMMIT');return u.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


/* =========================
   DEVOLUCIONES DE VENTA
========================= */

export async function listReturns({ limit = 300 } = {}) {
  // SHINY_POS_HIST_DEV_001
  // Incluye resumen por pedido para que Historial POS distinga devolución parcial/total.
  return query(`
    SELECT d.*,
      COALESCE((
        SELECT SUM(dp.cantidad)
        FROM gmx.detalle_pedidos dp
        WHERE dp.id_pedido=d.referencia
      ),0)::bigint AS unidades_vendidas_pedido,
      COALESCE((
        SELECT SUM(dd.cantidad)
        FROM gmx.devoluciones_detalle dd
        JOIN gmx.devoluciones dx ON dx.id=dd.id_devolucion
        WHERE dx.referencia=d.referencia
          AND UPPER(COALESCE(dx.estado,''))<>'CANCELADA'
      ),0)::bigint AS unidades_devueltas_pedido
    FROM gmx.devoluciones d
    ORDER BY d.fecha DESC NULLS LAST,d.row_id DESC
    LIMIT $1
  `, [Math.min(Math.max(i(limit) || 300, 1), 1000)]);
}

export async function getReturn(id) {
  const h = await query(`SELECT * FROM gmx.devoluciones WHERE id=$1`, [id]);
  if (!h.rowCount) return null;
  const d = await query(`SELECT * FROM gmx.devoluciones_detalle WHERE id_devolucion=$1 ORDER BY linea,row_id`, [id]);
  return { ...h.rows[0], detalles: d.rows };
}

export async function createSaleReturn(input, user, access) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(`SELECT * FROM gmx.pedidos WHERE id_pedido=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [input.orderId]);
    if (!p.rowCount) throw new Error('ORDER_NOT_FOUND');
    const order = p.rows[0];

    // SHINY_DEV_008_SECURITY — La sucursal se valida contra el pedido REAL
    // dentro de la misma transacción y antes de crear la devolución o tocar
    // inventario/caja. No se confía en branchId enviado por el cliente.
    const branchScope = access?.branchScope;
    if (branchScope && !branchScope.all) {
      const allowed = Array.isArray(branchScope.allowed) ? branchScope.allowed.map(String) : [];
      const orderBranch = String(order.id_sucursal || '').trim();
      if (!orderBranch || !allowed.includes(orderBranch)) {
        const err = new Error('BRANCH_FORBIDDEN');
        err.branchId = orderBranch || null;
        err.allowedBranches = allowed;
        throw err;
      }
    }

    if (String(order.estado_pedido || '').toUpperCase() !== 'PAGADO') throw new Error('ORDER_NOT_PAID');
    const branch = await getBranch(client, order.id_sucursal);
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error('EMPTY_RETURN');
    if (!txt(input.reason)) throw new Error('RETURN_REASON_REQUIRED');

    let total = 0,line = 0;
    const id = uid('DEV');

    for (const x of items) {
      const qty = Math.max(1, i(x.quantity || 1));
      const d = await client.query(`SELECT * FROM gmx.detalle_pedidos WHERE id_detalle=$1 AND id_pedido=$2`,
      [x.detailId, order.id_pedido]);
      if (!d.rowCount) throw new Error(`ORDER_DETAIL_NOT_FOUND:${x.detailId}`);
      const det = d.rows[0];
      const itemType = String(det.tipo || 'PRODUCTO').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCTO';
      // SHINY_DEV_001D_CONDICION_DESTINO
      const condition = String(x.condition || 'VENDIBLE').trim().toUpperCase();
      const allowedConditions = new Set(['VENDIBLE', 'DANADO', 'DEFECTUOSO', 'INCOMPLETO', 'NO_VENDIBLE']);
      if (!allowedConditions.has(condition)) throw new Error('RETURN_ITEM_CONDITION_INVALID');
      const destination = condition === 'VENDIBLE' ?
      'INVENTARIO_DISPONIBLE' :
      condition === 'DANADO' ?
      'MERMA' :
      condition === 'DEFECTUOSO' ?
      'GARANTIA' :
      condition === 'INCOMPLETO' ?
      'REVISION' :
      'NO_VENDIBLE';
      const reintegrateItem = condition === 'VENDIBLE';

      const already = await client.query(`SELECT COALESCE(SUM(dd.cantidad),0)::bigint qty
        FROM gmx.devoluciones_detalle dd
        JOIN gmx.devoluciones dv ON dv.id=dd.id_devolucion
        WHERE dv.referencia=$1 AND dd.id_detalle_pedido=$2
          AND UPPER(COALESCE(dv.estado,''))<>'CANCELADA'`, [order.id_pedido, det.id_detalle]);
      if (n(already.rows[0].qty) + qty > n(det.cantidad)) throw new Error(`RETURN_QTY_EXCEEDS_SOLD:${det.sku || det.id_detalle}`);

      const amount = qty * n(det.precio_unitario || det.precio);
      total += amount;line++;
      let before = null,after = null;

      // SHINY_DEV_001D_STOCK_TRACE_FIX
      // En devoluciones NO vendibles no movemos inventario, pero sí dejamos
      // evidencia explícita del stock disponible antes/después (mismo valor).
      if (!reintegrateItem) {
        if (itemType === 'TCG') {
          if (!det.id_inventario) throw new Error(`TCG_DETAIL_WITHOUT_INVENTORY:${det.id_detalle}`);
          const stockSnapshot = await client.query(`
            SELECT stock
            FROM gmx.tcg_inventario_sucursales
            WHERE id_sucursal=$1 AND id_inventario=$2
            ORDER BY row_id
            LIMIT 1
            FOR SHARE
          `, [branch.id_sucursal, det.id_inventario]);
          before = stockSnapshot.rowCount ? n(stockSnapshot.rows[0].stock) : 0;
          after = before;
        } else {
          const stockSnapshot = await client.query(`
            SELECT stock
            FROM gmx.inventario_sucursales
            WHERE id_sucursal=$1 AND id_producto=$2
            ORDER BY row_id
            LIMIT 1
            FOR SHARE
          `, [branch.id_sucursal, det.id_producto]);
          before = stockSnapshot.rowCount ? n(stockSnapshot.rows[0].stock) : 0;
          after = before;
        }
      }

      if (reintegrateItem) {
        if (itemType === 'TCG') {
          if (!det.id_inventario) throw new Error(`TCG_DETAIL_WITHOUT_INVENTORY:${det.id_detalle}`);
          const inv = await client.query(`SELECT * FROM gmx.tcg_inventario
            WHERE id_inventario=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [det.id_inventario]);
          if (!inv.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${det.id_inventario}`);
          const v = inv.rows[0];

          let binv = await client.query(`SELECT * FROM gmx.tcg_inventario_sucursales
            WHERE id_sucursal=$1 AND id_inventario=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`,
          [branch.id_sucursal, v.id_inventario]);
          if (!binv.rowCount) {
            binv = await client.query(`INSERT INTO gmx.tcg_inventario_sucursales(
              id_registro,id_inventario,id_carta,sku,id_sucursal,sucursal,stock,stock_reservado,ultima_actualizacion)
              VALUES($1,$2,$3,$4,$5,$6,0,0,NOW()) RETURNING *`, [
            uid('TCGDEVINV'), v.id_inventario, v.id_carta, v.sku, branch.id_sucursal, branch.nombre_sucursal]
            );
          }

          before = n(binv.rows[0].stock);after = before + qty;
          const globalBefore = n(v.stock),globalAfter = globalBefore + qty;
          await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
          [binv.rows[0].row_id, after]);
          await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
          [v.row_id, globalAfter]);
          await client.query(`INSERT INTO gmx.tcg_movimientos_sucursales(
            id_movimiento,fecha,tipo,id_inventario,id_carta,sku,id_sucursal_destino,sucursal_destino,cantidad,
            stock_destino_anterior,stock_destino_nuevo,stock_global_anterior,stock_global_nuevo,referencia,motivo,id_admin,administrador)
            VALUES($1,NOW(),'DEVOLUCION_CLIENTE',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [
          uid('TCGDEV'), v.id_inventario, v.id_carta, v.sku, branch.id_sucursal, branch.nombre_sucursal, qty,
          before, after, globalBefore, globalAfter, id, input.reason, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
          );
        } else {
          let inv = await client.query(`SELECT * FROM gmx.inventario_sucursales
            WHERE id_sucursal=$1 AND id_producto=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`,
          [branch.id_sucursal, det.id_producto]);
          if (!inv.rowCount) {
            inv = await client.query(`INSERT INTO gmx.inventario_sucursales(
              id_registro,id_sucursal,sucursal,id_producto,sku,producto,stock,stock_minimo,fecha_actualizacion)
              VALUES($1,$2,$3,$4,$5,$6,0,0,NOW()) RETURNING *`, [
            uid('INVDEV'), branch.id_sucursal, branch.nombre_sucursal, det.id_producto, det.sku, det.producto]
            );
          }
          before = n(inv.rows[0].stock);after = before + qty;
          await client.query(`UPDATE gmx.inventario_sucursales SET stock=$2,fecha_actualizacion=NOW() WHERE row_id=$1`,
          [inv.rows[0].row_id, after]);
          await client.query(`INSERT INTO gmx.movimientos_inventario_sucursales(
            id_movimiento,fecha,id_sucursal,sucursal,id_producto,sku,producto,tipo,cantidad,stock_anterior,stock_nuevo,
            motivo,id_admin,nombre_usuario,usuario,referencia)
            VALUES($1,NOW(),$2,$3,$4,$5,$6,'DEVOLUCION_CLIENTE',$7,$8,$9,$10,$11,$12,$13,$14)`, [
          uid('MOVDEV'), branch.id_sucursal, branch.nombre_sucursal, det.id_producto, det.sku, det.producto, qty, before, after,
          input.reason, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"), user?.email || 'LOCAL', id]
          );
        }
      }

      await client.query(`INSERT INTO gmx.devoluciones_detalle(
        id_devolucion,linea,id_detalle_pedido,tipo_item,id_producto,id_inventario,id_carta,sku,producto,
        cantidad,precio_unitario,importe,stock_anterior,stock_nuevo,id_sucursal,sucursal,
        condicion_articulo,destino_articulo,reintegra_stock)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, [
      id, line, det.id_detalle, itemType, det.id_producto || null, det.id_inventario || null,
      itemType === 'TCG' ? (await client.query(`SELECT id_carta FROM gmx.tcg_inventario WHERE id_inventario=$1 LIMIT 1`,
      [det.id_inventario])).rows[0]?.id_carta || null : null,
      det.sku, det.producto, qty, n(det.precio_unitario || det.precio), amount, before, after,
      branch.id_sucursal, branch.nombre_sucursal,
      condition, destination, reintegrateItem]
      );
    }

    const returnBenefits = await applyPartialReturnBenefitsTx(client, {
      order, returnGross: total, user, reference: id
    });
    const refundTotal = returnBenefits.refundTotal;

    // SHINY_DEV_006B_REFUND_CONTRACT
    // Compatibilidad:
    //   1) refund: true + refundMethod/refundReference/paymentId
    //   2) refund: { enabled:true, method, reference, paymentId }
    // TRANSFERENCIA se registra como PENDIENTE porque no existe una
    // integracion bancaria real que permita afirmar que el dinero fue enviado.
    const refundObject = input.refund && typeof input.refund === 'object' ?
    input.refund :
    null;
    const refundRequested =
    input.refund === true ||
    refundObject?.enabled === true;

    let refundRef = null;
    let refundMethod = null;
    let refundPaymentId = null;
    let refundStatus = null;

    // SHINY_DEV_007_MP_REFUND_WIRING
    let refundProvider = null;
    let refundIntegrationEnabled = false;
    let mercadoPagoRefundPlan = null;

    if (refundRequested) {
      refundMethod = String(
        input.refundMethod ||
        refundObject?.method ||
        order.metodo_pago ||
        'EFECTIVO'
      ).trim().toUpperCase();

      refundRef = txt(
        input.refundReference ||
        refundObject?.reference
      ) || null;

      refundPaymentId = txt(
        input.paymentId ||
        refundObject?.paymentId
      ) || null;

      const method = refundMethod;

      if (method === 'EFECTIVO') {

        refundProvider = 'CAJA';
        refundIntegrationEnabled = false;

        const cash = await openCash(client, branch.id_sucursal);
        if (!cash) throw new Error('NO_OPEN_CASH_FOR_RETURN_REFUND');

        refundRef = refundRef || uid('CAJDEV');

        await client.query(`INSERT INTO gmx.caja_movimientos(
          id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
          importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
          VALUES($1,$2,NOW(),$3,$4,'EGRESO','DEVOLUCION','EFECTIVO',$5,$6,$7,
          'Reembolso devolución','DEVOLUCIONES',$8,$9,$10,false)`, [
        refundRef, cash.id_caja, branch.id_sucursal, branch.nombre_sucursal, refundTotal, -refundTotal,
        order.id_pedido, id, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
        );

        await client.query(`UPDATE gmx.caja_sesiones
          SET egresos_efectivo=COALESCE(egresos_efectivo,0)+$2,
              saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))-$2,
              fecha_actualizacion=NOW()
          WHERE id_caja=$1`, [cash.id_caja, refundTotal]);

        refundStatus = 'COMPLETADO';
      } else if (method === 'TRANSFERENCIA') {

        // Solicitud auditable; no se simula una transferencia bancaria.
        refundProvider = 'TRANSFERENCIA';
        refundIntegrationEnabled = false;

        refundRef = refundRef || uid('TRFREF');
        refundStatus = 'PENDIENTE';

      } else if (
      method === 'TARJETA' ||
      method === 'CARD')
      {

        /*
         * DEV-007-MP
         *
         * Una devoluci?n de tarjeta s?lo puede usar una
         * transacci?n Mercado Pago PAID persistida en Shiny.
         */

        refundMethod = 'TARJETA';

        const paymentResult =
        await client.query(
          `SELECT *
             FROM gmx.payment_transactions
             WHERE id_pedido=$1
               AND proveedor='MERCADOPAGO'
               AND estado='PAID'
               AND provider_payment_id IS NOT NULL
               AND BTRIM(provider_payment_id)<>''
             ORDER BY row_id DESC
             LIMIT 1
             FOR UPDATE`,
          [
          order.id_pedido]

        );

        if (!paymentResult.rowCount) {
          throw new Error(
            'MERCADOPAGO_PAID_TRANSACTION_NOT_FOUND_FOR_RETURN'
          );
        }

        const paymentTransaction =
        paymentResult.rows[0];

        const providerPaymentId =
        String(
          paymentTransaction.provider_payment_id ||
          ''
        ).trim();

        if (
        refundPaymentId &&
        String(refundPaymentId) !==
        providerPaymentId)
        {
          throw new Error(
            'REFUND_PAYMENT_ID_MISMATCH'
          );
        }

        refundPaymentId =
        providerPaymentId;

        const paymentAmount =
        Number(
          paymentTransaction.monto ||
          0
        );

        const requestedAmount =
        Number(
          refundTotal ||
          0
        );

        if (
        !Number.isFinite(
          requestedAmount
        ) ||
        requestedAmount <= 0)
        {
          throw new Error(
            'INVALID_MERCADOPAGO_REFUND_AMOUNT'
          );
        }

        if (
        Math.round(
          requestedAmount * 100
        ) >
        Math.round(
          paymentAmount * 100
        ))
        {
          throw new Error(
            'REFUND_AMOUNT_EXCEEDS_MERCADOPAGO_PAYMENT'
          );
        }

        refundRef =
        refundRef ||
        uid('MPREF');

        refundStatus =
        'PENDIENTE';

        refundProvider =
        'MERCADOPAGO';

        refundIntegrationEnabled =
        true;

        mercadoPagoRefundPlan = {
          paymentId:
          providerPaymentId,

          paymentAmount,

          amount:
          requestedAmount,

          partial:
          Math.round(
            requestedAmount * 100
          ) <
          Math.round(
            paymentAmount * 100
          ),

          providerCall:
          input.refundProviderCall ||
          refundObject?.providerCall ||
          null
        };

      } else {

        refundProvider = 'LOCAL';
        refundIntegrationEnabled = false;

        refundRef = refundRef || uid('REFUND');
        refundStatus = 'PENDIENTE';
      }
    }

    await client.query(`INSERT INTO gmx.devoluciones(
      id,fecha,tipo,referencia,cliente_proveedor,motivo,importe,resolucion,estado,reintegra_stock,notas,actualizacion)
      VALUES($1,NOW(),'VENTA',$2,$3,$4,$5,$6,'COMPLETADA',$7,$8,NOW())`, [
    id, order.id_pedido, order.nombre_cliente, input.reason, refundTotal,
    refundRequested ? `REEMBOLSO:${refundRef}` : 'SIN_REEMBOLSO',
    items.some((x) => String(x.condition || 'VENDIBLE').toUpperCase() === 'VENDIBLE'), input.notes || null]
    );

    if (refundRequested && refundRef) {
      const refundId = uid('REEMB');
      const idem = 'DEVOLUCION:' + id + ':' + String(refundRef);
      const provider =
      refundProvider || (

      refundMethod === 'EFECTIVO' ?
      'CAJA' :
      refundMethod === 'TRANSFERENCIA' ?
      'TRANSFERENCIA' :
      'LOCAL');


      const integrationEnabled =
      refundIntegrationEnabled === true;

      await client.query(`INSERT INTO gmx.devoluciones_reembolsos(
        id_reembolso,id_devolucion,id_pedido,fecha,metodo,proveedor,estado,monto,moneda,
        payment_id,refund_id_proveedor,idempotency_key,referencia,integracion_habilitada,
        id_admin_crea,usuario_crea,id_admin_autoriza,usuario_autoriza,fecha_autorizacion,
        error_codigo,error_detalle,fecha_actualizacion)
        VALUES($1,$2,$3,NOW(),$4,$5,$6,$7,'MXN',$8,$9,$10,$11,$12,$13,$14,$13,$14,
          CASE WHEN $6='COMPLETADO' THEN NOW() ELSE NULL END,NULL,NULL,NOW())
        ON CONFLICT DO NOTHING`, [
      refundId, id, order.id_pedido, refundMethod, provider, refundStatus, refundTotal,
      refundPaymentId,
      ['TRANSFERENCIA', 'TARJETA'].includes(refundMethod) ?
      null :
      refundRef,
      idem,
      refundRef,
      integrationEnabled, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );

      if (
      mercadoPagoRefundPlan &&
      refundProvider === 'MERCADOPAGO')
      {
        mercadoPagoRefundPlan.idReembolso =
        refundId;

        mercadoPagoRefundPlan.idempotencyKey =
        idem;
      }

      await client.query(`INSERT INTO gmx.devoluciones_eventos(
        id_evento,id_devolucion,id_reembolso,fecha,tipo,estado,detalle,id_admin,usuario)
        VALUES($1,$2,$3,NOW(),'REEMBOLSO_REGISTRADO',$4,$5,$6,$7)`, [
      uid('DEVEVT'), id, refundId, refundStatus,
      `Reembolso ${refundMethod} por ${refundTotal}. Referencia ${refundRef}`,
      user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
    }

    await audit(client, user, 'DEVOLUCIONES', 'CREAR', id, `${order.id_pedido} total ${total}`);
    await client.query('COMMIT');

    /*
     * DEV-007-MP:
     * El provider se ejecuta ?nicamente despu?s de COMMIT.
     */
    if (
    mercadoPagoRefundPlan &&
    mercadoPagoRefundPlan.idReembolso)
    {

      const paymentService =
      await import(
      '../paymentService.js'
      );

      let mpResult;

      if (
      mercadoPagoRefundPlan.partial)
      {

        mpResult =
        await paymentService.
        createMercadoPagoPartialRefund({
          idReembolso:
          mercadoPagoRefundPlan.idReembolso,

          paymentId:
          mercadoPagoRefundPlan.paymentId,

          amount:
          mercadoPagoRefundPlan.amount,

          idempotencyKey:
          mercadoPagoRefundPlan.idempotencyKey,

          providerCall:
          mercadoPagoRefundPlan.providerCall
        });

      } else {

        mpResult =
        await paymentService.
        createMercadoPagoTotalRefund({
          idReembolso:
          mercadoPagoRefundPlan.idReembolso,

          paymentId:
          mercadoPagoRefundPlan.paymentId,

          idempotencyKey:
          mercadoPagoRefundPlan.idempotencyKey,

          providerCall:
          mercadoPagoRefundPlan.providerCall
        });
      }

      /*
       * Evento secundario.
       *
       * El resultado principal ya fue persistido por
       * paymentService.
       */

      try {

        await query(
          `INSERT INTO gmx.devoluciones_eventos(
             id_evento,
             id_devolucion,
             id_reembolso,
             fecha,
             tipo,
             estado,
             detalle,
             id_admin,
             usuario
           )
           VALUES(
             $1,$2,$3,NOW(),
             'REEMBOLSO_ESTADO',
             $4,$5,$6,$7
           )`,
          [
          uid('DEVEVT'),
          id,
          mercadoPagoRefundPlan.idReembolso,

          mpResult?.state ||
          'PENDIENTE',

          `Mercado Pago payment_id=${mercadoPagoRefundPlan.paymentId}; refund_id=${mpResult?.refundId || ''}; monto=${mercadoPagoRefundPlan.amount}`,

          user?.id_admin ||
          'LOCAL',

          user?.nombre ||
          user?.email || brandText("GMX Local")]


        );

      } catch {




        /*
         * No invalidar un refund exitoso s?lo por fallo
         * del evento secundario.
         */}}return getReturn(id);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}



/* ============================================================
   SHINY_DEV_008_REFUND_STATE_MACHINE

   Estados controlados:
     PENDIENTE
       -> PROCESANDO

     PROCESANDO
       -> COMPLETADO
       -> ERROR

     ERROR
       -> PROCESANDO

     COMPLETADO
       -> TERMINAL

   No se permiten saltos directos PENDIENTE -> COMPLETADO.
   ============================================================ */

export async function updateRefundStatus(
refundId,
input = {},
user = null)
{
  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    const result = await client.query(
      `SELECT *
       FROM gmx.devoluciones_reembolsos
       WHERE id_reembolso=$1
       FOR UPDATE`,
      [refundId]
    );

    if (!result.rowCount) {
      throw new Error('REFUND_NOT_FOUND');
    }

    const currentRow =
    result.rows[0];

    const current =
    String(
      currentRow.estado || ''
    ).
    trim().
    toUpperCase();

    const next =
    String(
      input.status ||
      input.estado ||
      ''
    ).
    trim().
    toUpperCase();

    const allowedStates =
    new Set([
    'PENDIENTE',
    'PROCESANDO',
    'COMPLETADO',
    'ERROR']
    );

    if (!allowedStates.has(next)) {
      throw new Error(
        'INVALID_REFUND_STATUS'
      );
    }

    if (current === next) {

      await client.query('COMMIT');

      return {
        ...currentRow,
        transition: {
          from: current,
          to: next,
          changed: false,
          idempotent: true
        }
      };
    }

    const transitions = {
      PENDIENTE:
      new Set([
      'PROCESANDO']
      ),

      PROCESANDO:
      new Set([
      'COMPLETADO',
      'ERROR']
      ),

      ERROR:
      new Set([
      'PROCESANDO']
      ),

      COMPLETADO:
      new Set()
    };

    const allowed =
    transitions[current];

    if (!allowed) {
      throw new Error(
        `INVALID_CURRENT_REFUND_STATUS_${current}`
      );
    }

    if (!allowed.has(next)) {
      throw new Error(
        `REFUND_STATUS_TRANSITION_FORBIDDEN_${current}_TO_${next}`
      );
    }

    const errorCode =
    next === 'ERROR' ?
    String(
      input.errorCode ||
      input.error_codigo ||
      'REFUND_PROCESSING_ERROR'
    ).trim() :
    null;

    const errorDetail =
    next === 'ERROR' ?
    String(
      input.errorDetail ||
      input.error_detalle ||
      input.reason ||
      input.motivo ||
      ''
    ).trim() || null :
    null;

    const providerRefundId =
    String(
      input.providerRefundId ||
      input.refundIdProveedor ||
      input.refund_id_proveedor ||
      ''
    ).trim() || null;

    const updated =
    await client.query(
      `UPDATE gmx.devoluciones_reembolsos
         SET
           estado=$2,
           refund_id_proveedor=
             CASE
               WHEN $2='COMPLETADO'
                 THEN COALESCE($3,refund_id_proveedor)
               ELSE refund_id_proveedor
             END,
           fecha_autorizacion=
             CASE
               WHEN $2='COMPLETADO'
                 THEN COALESCE(fecha_autorizacion,NOW())
               ELSE fecha_autorizacion
             END,
           error_codigo=
             CASE
               WHEN $2='ERROR'
                 THEN $4
               WHEN $2='PROCESANDO'
                 THEN NULL
               ELSE error_codigo
             END,
           error_detalle=
             CASE
               WHEN $2='ERROR'
                 THEN $5
               WHEN $2='PROCESANDO'
                 THEN NULL
               ELSE error_detalle
             END,
           fecha_actualizacion=NOW()
         WHERE id_reembolso=$1
         RETURNING *`,
      [
      refundId,
      next,
      providerRefundId,
      errorCode,
      errorDetail]

    );

    const row =
    updated.rows[0];

    const eventId =
    uid('DEVEVT');

    const detail = [
    `Estado reembolso ${current} -> ${next}`,
    input.reason ||
    input.motivo ||
    '',
    next === 'ERROR' ?
    `Error: ${errorCode}` :
    ''].

    filter(Boolean).
    join(' ? ');

    await client.query(
      `INSERT INTO gmx.devoluciones_eventos(
        id_evento,
        id_devolucion,
        id_reembolso,
        fecha,
        tipo,
        estado,
        detalle,
        id_admin,
        usuario
      )
      VALUES(
        $1,$2,$3,NOW(),
        'REEMBOLSO_ESTADO',
        $4,$5,$6,$7
      )`,
      [
      eventId,
      row.id_devolucion,
      row.id_reembolso,
      next,
      detail,
      user?.id_admin || 'LOCAL',
      user?.nombre ||
      user?.email || brandText("GMX Local")]


    );

    await client.query(
      `INSERT INTO gmx.auditoria(
        fecha,
        modulo,
        accion,
        referencia,
        detalle,
        usuario
      )
      VALUES(
        NOW(),
        'DEVOLUCIONES',
        'REEMBOLSO_ESTADO',
        $1,
        $2,
        $3
      )`,
      [
      row.id_reembolso,
      detail,
      user?.email ||
      user?.nombre || brandText("GMX Local")]


    );

    await client.query('COMMIT');

    return {
      ...row,
      transition: {
        from: current,
        to: next,
        changed: true,
        idempotent: false
      }
    };

  } catch (e) {

    try {
      await client.query('ROLLBACK');
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}


export async function orderForReturn(orderId) {
  const p = await query(`SELECT * FROM gmx.pedidos WHERE id_pedido=$1 ORDER BY row_id LIMIT 1`, [orderId]);
  if (!p.rowCount) return null;
  const order = p.rows[0];
  if (String(order.estado_pedido || '').toUpperCase() !== 'PAGADO') throw new Error('ORDER_NOT_PAID');
  const d = await query(`
    SELECT dp.*,
      COALESCE((
        SELECT SUM(dd.cantidad)
        FROM gmx.devoluciones_detalle dd
        JOIN gmx.devoluciones dv ON dv.id=dd.id_devolucion
        WHERE dd.id_detalle_pedido=dp.id_detalle
          AND dv.referencia=dp.id_pedido
          AND UPPER(COALESCE(dv.estado,''))<>'CANCELADA'
      ),0)::bigint AS cantidad_devuelta
    FROM gmx.detalle_pedidos dp
    WHERE dp.id_pedido=$1
    ORDER BY dp.row_id
  `, [orderId]);
  return { ...order, detalles: d.rows.map((x) => ({
      ...x,
      cantidad_disponible_devolver: Math.max(0, n(x.cantidad) - n(x.cantidad_devuelta))
    })) };
}


export async function commercialHealth() {
  const tables = ['cotizaciones_admin', 'devoluciones', 'proveedores', 'cuentas_por_pagar', 'gastos',
  'devoluciones_detalle', 'cuentas_por_pagar_pagos'];
  const data = {};
  for (const table of tables) {
    try {
      const r = await query(`SELECT COUNT(*)::bigint AS total FROM gmx.${table}`);
      data[table] = { ok: true, total: Number(r.rows[0].total || 0) };
    } catch (e) {
      data[table] = { ok: false, error: e.message };
    }
  }
  return data;
}
