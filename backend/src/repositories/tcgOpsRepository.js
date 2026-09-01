import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';
import { applyBenefitsTx, reverseBenefitsTx } from './benefitsRepository.js';

const n = (v) => Number(v || 0);
const int = (v) => Math.trunc(Number(v || 0));
const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

async function branch(client, id) {
  const r = await client.query(`SELECT id_sucursal,nombre_sucursal
    FROM gmx.sucursales WHERE id_sucursal=$1 AND COALESCE(activa,true)=true
    ORDER BY row_id LIMIT 1`, [id]);
  if (!r.rowCount) throw new Error('BRANCH_NOT_FOUND');
  return r.rows[0];
}

async function resolveVariant(client, code, lock = false) {
  let raw = String(code || '').trim();
  if (raw.toUpperCase().startsWith("TCG-STORE-TEMPLATE-TCG:")) {
    raw = raw.slice(8).trim();
  }
  if (!raw) throw new Error('CODE_REQUIRED');
  const r = await client.query(`
    SELECT i.*,c.nombre AS carta,c.numero_completo,c.id_juego,c.id_set
    FROM gmx.tcg_inventario i
    LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
    WHERE UPPER(COALESCE(i.id_inventario,''))=UPPER($1)
       OR UPPER(COALESCE(i.sku,''))=UPPER($1)
    ORDER BY CASE WHEN UPPER(COALESCE(i.id_inventario,''))=UPPER($1) THEN 0 ELSE 1 END,i.row_id
    LIMIT 1 ${lock ? 'FOR UPDATE OF i' : ''}
  `, [raw]);
  if (!r.rowCount) throw new Error('TCG_VARIANT_NOT_FOUND');
  return r.rows[0];
}

async function localStock(client, variant, branchRow, lock = false) {
  let r = await client.query(`SELECT * FROM gmx.tcg_inventario_sucursales
    WHERE id_sucursal=$1 AND id_inventario=$2 ORDER BY row_id LIMIT 1
    ${lock ? 'FOR UPDATE' : ''}`, [branchRow.id_sucursal, variant.id_inventario]);
  if (!r.rowCount) {
    r = await client.query(`INSERT INTO gmx.tcg_inventario_sucursales(
      id_registro,id_inventario,id_carta,sku,id_sucursal,sucursal,stock,stock_reservado,ultima_actualizacion)
      VALUES($1,$2,$3,$4,$5,$6,0,0,NOW()) RETURNING *`,
    [uid('TCGIS'), variant.id_inventario, variant.id_carta, variant.sku,
    branchRow.id_sucursal, branchRow.nombre_sucursal]);
  }
  return r.rows[0];
}

async function movement(client, { type, variant, origin = null, dest = null, qty,
  originBefore = null, originAfter = null, destBefore = null, destAfter = null,
  globalBefore = null, globalAfter = null, reference = '', reason = '', user }) {
  const id = uid('TCGMOV');
  await client.query(`INSERT INTO gmx.tcg_movimientos_sucursales(
    id_movimiento,fecha,tipo,id_inventario,id_carta,sku,
    id_sucursal_origen,sucursal_origen,id_sucursal_destino,sucursal_destino,cantidad,
    stock_origen_anterior,stock_origen_nuevo,stock_destino_anterior,stock_destino_nuevo,
    stock_global_anterior,stock_global_nuevo,referencia,motivo,id_admin,administrador)
    VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [
  id, type, variant.id_inventario, variant.id_carta, variant.sku,
  origin?.id_sucursal || null, origin?.nombre_sucursal || null,
  dest?.id_sucursal || null, dest?.nombre_sucursal || null, qty,
  originBefore, originAfter, destBefore, destAfter, globalBefore, globalAfter,
  reference || null, reason || null, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
  );
  return id;
}

async function scanLog(client, { code, action, variant, branchRow, qty, result, user }) {
  await client.query(`INSERT INTO gmx.tcg_escaneos(
    id_escaneo,fecha,codigo,tipo_codigo,accion,id_inventario,id_carta,sku,carta,
    id_sucursal,sucursal,cantidad,resultado,id_admin,administrador)
    VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
  uid('TCGSCAN'), String(code || ''), String(code || '').toUpperCase().startsWith("TCG-STORE-TEMPLATE-TCG:") ? 'QR' : 'SKU_ID',
  action, variant?.id_inventario || null, variant?.id_carta || null, variant?.sku || null,
  variant?.carta || null, branchRow?.id_sucursal || null, branchRow?.nombre_sucursal || null,
  qty || 0, result, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
  );
}

export async function searchVariants({ branchId = '', search = '', limit = 100 } = {}) {
  const vals = [],f = [];
  if (branchId) {vals.push(branchId);f.push(`s.id_sucursal=$${vals.length}`);}
  if (search) {vals.push(`%${search}%`);f.push(`(
    COALESCE(i.sku,'') ILIKE $${vals.length} OR COALESCE(i.id_inventario,'') ILIKE $${vals.length}
    OR COALESCE(c.nombre,'') ILIKE $${vals.length})`);}
  vals.push(Math.min(Math.max(int(limit) || 100, 1), 500));
  return query(`SELECT i.row_id,i.id_inventario,i.id_carta,i.sku,c.nombre AS carta,
    c.numero_completo,i.rareza,i.idioma,i.condicion,i.acabado,i.edicion,i.graded,
    i.empresa_grading,i.grado,i.precio,i.precio_oferta,i.costo,i.stock AS stock_global,
    s.id_sucursal,s.sucursal,s.stock,s.stock_reservado
    FROM gmx.tcg_inventario i
    LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
    LEFT JOIN gmx.tcg_inventario_sucursales s ON s.id_inventario=i.id_inventario
    ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY c.nombre,i.sku,s.sucursal LIMIT $${vals.length}`, vals);
}

export async function quickScan(input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await branch(client, String(input.branchId || ''));
    const v = await resolveVariant(client, input.code, true);
    const loc = await localStock(client, v, b, true);
    const qty = Math.max(1, int(input.quantity || 1));
    const action = String(input.action || 'LOOKUP').toUpperCase();

    if (action === 'LOOKUP') {
      await scanLog(client, { code: input.code, action, variant: v, branchRow: b, qty: 0, result: 'OK', user });
      await client.query('COMMIT');
      return { ...v, branch_stock: n(loc.stock), branch_reserved: n(loc.stock_reservado), branch: b };
    }

    const lb = n(loc.stock),gb = n(v.stock);
    let la = lb,ga = gb,type = '';
    if (action === 'ENTRY') {la = lb + qty;ga = gb + qty;type = 'ESCANEO_ENTRADA';} else
    if (action === 'EXIT') {
      if (lb - n(loc.stock_reservado) < qty || gb - n(v.stock_reservado) < qty) throw new Error('INSUFFICIENT_AVAILABLE_STOCK');
      la = lb - qty;ga = gb - qty;type = 'ESCANEO_SALIDA';
    } else throw new Error('INVALID_SCAN_ACTION');

    await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [loc.row_id, la]);
    await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [v.row_id, ga]);
    const mid = await movement(client, { type, variant: v,
      origin: action === 'EXIT' ? b : null, dest: action === 'ENTRY' ? b : null, qty,
      originBefore: action === 'EXIT' ? lb : null, originAfter: action === 'EXIT' ? la : null,
      destBefore: action === 'ENTRY' ? lb : null, destAfter: action === 'ENTRY' ? la : null,
      globalBefore: gb, globalAfter: ga, reference: input.reference || '', reason: input.reason || 'Movimiento rápido', user });
    await scanLog(client, { code: input.code, action, variant: v, branchRow: b, qty, result: 'OK', user });
    await client.query('COMMIT');
    return { success: true, id_movimiento: mid, variant: { ...v, stock_global: ga }, branch_stock: la };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {client.release();}
}

export async function transfer(input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const origin = await branch(client, String(input.originBranchId || ''));
    const dest = await branch(client, String(input.destBranchId || ''));
    if (origin.id_sucursal === dest.id_sucursal) throw new Error('SAME_BRANCH_TRANSFER');
    const v = await resolveVariant(client, input.code, true);
    const a = await localStock(client, v, origin, true);
    const d = await localStock(client, v, dest, true);
    const qty = Math.max(1, int(input.quantity || 1));
    const ab = n(a.stock),db = n(d.stock);
    if (ab - n(a.stock_reservado) < qty) throw new Error('INSUFFICIENT_ORIGIN_STOCK');
    await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [a.row_id, ab - qty]);
    await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [d.row_id, db + qty]);
    const mid = await movement(client, { type: 'TRANSFERENCIA', variant: v, origin, dest, qty,
      originBefore: ab, originAfter: ab - qty, destBefore: db, destAfter: db + qty,
      globalBefore: n(v.stock), globalAfter: n(v.stock), reference: input.reference || '', reason: input.reason || 'Transferencia TCG', user });
    await client.query('COMMIT');
    return { id_movimiento: mid, id_inventario: v.id_inventario, origin_stock: ab - qty, dest_stock: db + qty, global_stock: n(v.stock) };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function adjust(input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await branch(client, String(input.branchId || ''));
    const v = await resolveVariant(client, input.code, true);
    const loc = await localStock(client, v, b, true);
    const lb = n(loc.stock),gb = n(v.stock);
    const target = input.targetStock !== undefined ? int(input.targetStock) : lb + int(input.delta || 0);
    if (target < 0) throw new Error('NEGATIVE_TARGET_STOCK');
    if (target < n(loc.stock_reservado)) throw new Error('TARGET_BELOW_RESERVED');
    const delta = target - lb,ga = gb + delta;
    if (ga < 0) throw new Error('NEGATIVE_GLOBAL_STOCK');
    await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [loc.row_id, target]);
    await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [v.row_id, ga]);
    const mid = await movement(client, { type: 'AJUSTE', variant: v,
      origin: delta < 0 ? b : null, dest: delta > 0 ? b : null, qty: Math.abs(delta),
      originBefore: delta < 0 ? lb : null, originAfter: delta < 0 ? target : null,
      destBefore: delta > 0 ? lb : null, destAfter: delta > 0 ? target : null,
      globalBefore: gb, globalAfter: ga, reference: input.reference || '', reason: input.reason || 'Ajuste TCG', user });
    await client.query('COMMIT');
    return { id_movimiento: mid, id_inventario: v.id_inventario, branch_stock: target, global_stock: ga, delta };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

async function openCash(client, branchId) {
  const r = await client.query(`SELECT * FROM gmx.caja_sesiones
    WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
    ORDER BY fecha_apertura DESC,row_id DESC LIMIT 1 FOR UPDATE`, [branchId]);
  return r.rows[0] || null;
}

export async function createTcgSale(input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await branch(client, String(input.branchId || ''));
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error('EMPTY_SALE');
    const normalized = [];let subtotal = 0;

    for (const line of items) {
      const v = await resolveVariant(client, line.id_inventario || line.code, true);
      const loc = await localStock(client, v, b, true);
      const qty = Math.max(1, int(line.quantity || 1));
      const available = n(loc.stock) - n(loc.stock_reservado);
      if (available < qty || n(v.stock) - n(v.stock_reservado) < qty) throw new Error(`INSUFFICIENT_STOCK:${v.sku}`);
      const price = Number(line.price ?? (n(v.precio_oferta) > 0 ? v.precio_oferta : v.precio));
      if (!Number.isFinite(price) || price < 0) throw new Error('INVALID_SALE_PRICE');
      normalized.push({ v, loc, qty, price });
      subtotal += price * qty;
    }

    const id = uid('TCGSALE');
    const method = String(input.paymentMethod || 'EFECTIVO').toUpperCase();
    if (['TRANSFERENCIA', 'TARJETA'].includes(method) && !String(input.paymentReference || '').trim()) throw new Error('PAYMENT_REFERENCE_REQUIRED');
    const customerId = String(input.clientId || '').trim() || null;
    let customer = { nombre: 'Público general', telefono: null, email: null };
    if (customerId) {
      const c = await client.query(`SELECT nombre,telefono,email FROM gmx.clientes WHERE id_cliente=$1 ORDER BY row_id LIMIT 1`, [customerId]);
      if (!c.rowCount) throw new Error('CLIENT_NOT_FOUND');
      customer = c.rows[0];
    }
    const benefit = await applyBenefitsTx(client, {
      orderId: id, clientId: customerId || '', subtotal,
      promoCode: String(input.promoCode || ''), points: Number(input.pointsToRedeem || 0),
      channel: 'TCG_POS', branchId: b.id_sucursal, user
    });

    await client.query(`INSERT INTO gmx.pedidos(
      id_pedido,fecha,id_cliente,nombre_cliente,telefono,email,metodo_pago,subtotal,envio,total,
      estado_pedido,referencia_pago,fecha_pago,notas,fecha_actualizacion,inventario_liberado,
      id_admin_venta,vendedor,id_sucursal,sucursal,canal_venta,venta_confirmada,
      id_promocion,codigo_promocional,descuento_promocion,puntos_redimidos,descuento_puntos,puntos_generados,total_antes_beneficios)
      VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,0,$8,'PAGADO',$9,NOW(),$10,NOW(),false,$11,$12,$13,$14,'TCG_POS',true,
        $15,$16,$17,$18,$19,$20,$7)`, [
    id, customerId, customer.nombre, customer.telefono, customer.email, method, subtotal, benefit.total,
    input.paymentReference || null, input.notes || null, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"),
    b.id_sucursal, b.nombre_sucursal, benefit.promotion?.id || null, benefit.promotion?.codigo || null,
    benefit.discountPromo, benefit.pointsUsed, benefit.loyaltyDiscount, benefit.pointsEarned]
    );

    let lineNo = 0;
    for (const x of normalized) {
      lineNo++;
      const lb = n(x.loc.stock),gb = n(x.v.stock),la = lb - x.qty,ga = gb - x.qty;
      await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [x.loc.row_id, la]);
      await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [x.v.row_id, ga]);
      await client.query(`INSERT INTO gmx.detalle_pedidos(
        id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,precio_unitario,tipo,id_inventario,detalle)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$5,'TCG',$9,$10)`, [
      id, x.v.id_carta, x.v.carta, x.qty, x.price, x.price * x.qty, `${id}-${lineNo}`, x.v.sku, x.v.id_inventario,
      [x.v.rareza, x.v.idioma, x.v.condicion, x.v.edicion].filter(Boolean).join(' · ')]
      );
      await movement(client, { type: 'VENTA_TCG_POS', variant: x.v, origin: b, qty: x.qty,
        originBefore: lb, originAfter: la, globalBefore: gb, globalAfter: ga, reference: id, reason: 'Venta TCG POS', user });
    }

    if (method === 'EFECTIVO') {
      const cash = await openCash(client, b.id_sucursal);
      if (!cash) throw new Error('NO_OPEN_CASH_FOR_CASH_SALE');
      const cm = uid('CAJTCG');
      await client.query(`INSERT INTO gmx.caja_movimientos(
        id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
        importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
        VALUES($1,$2,NOW(),$3,$4,'INGRESO','VENTA_TCG','EFECTIVO',$5,$5,$6,'Venta TCG POS','TCG_POS',$6,$7,$8,false)`, [
      cm, cash.id_caja, b.id_sucursal, b.nombre_sucursal, benefit.total, id, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
      await client.query(`UPDATE gmx.caja_sesiones SET ingresos_efectivo=COALESCE(ingresos_efectivo,0)+$2,
        saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))+$2,fecha_actualizacion=NOW()
        WHERE id_caja=$1`, [cash.id_caja, benefit.total]);
    }

    await client.query('COMMIT');
    return { id_pedido: id, total: benefit.total, subtotal, discountPromo: benefit.discountPromo, discountPoints: benefit.loyaltyDiscount, pointsEarned: benefit.pointsEarned, pointsUsed: benefit.pointsUsed, items: normalized.length, units: normalized.reduce((s, x) => s + x.qty, 0), status: 'PAGADO' };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function cancelTcgSale(orderId, input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(`SELECT * FROM gmx.pedidos WHERE id_pedido=$1 AND canal_venta='TCG_POS' ORDER BY row_id LIMIT 1 FOR UPDATE`, [orderId]);
    if (!p.rowCount) throw new Error('TCG_SALE_NOT_FOUND');
    const sale = p.rows[0];
    if (['CANCELADO', 'CANCELADA'].includes(String(sale.estado_pedido || '').toUpperCase())) {
      await client.query('COMMIT');return { id_pedido: orderId, status: 'CANCELADO', idempotent: true };
    }
    const b = await branch(client, sale.id_sucursal);
    const details = await client.query(`SELECT * FROM gmx.detalle_pedidos WHERE id_pedido=$1 AND tipo='TCG' ORDER BY row_id FOR UPDATE`, [orderId]);
    for (const d of details.rows) {
      const v = await resolveVariant(client, d.id_inventario, true);
      const loc = await localStock(client, v, b, true);
      const qty = int(d.cantidad),lb = n(loc.stock),gb = n(v.stock);
      await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [loc.row_id, lb + qty]);
      await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [v.row_id, gb + qty]);
      await movement(client, { type: 'CANCELACION_VENTA_TCG_POS', variant: v, dest: b, qty,
        destBefore: lb, destAfter: lb + qty, globalBefore: gb, globalAfter: gb + qty, reference: orderId,
        reason: input.reason || 'Cancelación venta TCG', user });
    }
    if (String(sale.metodo_pago || '').toUpperCase() === 'EFECTIVO') {
      const cash = await openCash(client, b.id_sucursal);
      if (!cash) throw new Error('NO_OPEN_CASH_FOR_CASH_REFUND');
      const amount = n(sale.total);
      await client.query(`INSERT INTO gmx.caja_movimientos(
        id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
        importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
        VALUES($1,$2,NOW(),$3,$4,'EGRESO','REEMBOLSO_TCG','EFECTIVO',$5,$6,$7,
        'Cancelación / reembolso TCG','TCG_POS',$7,$8,$9,false)`, [
      uid('CAJREF'), cash.id_caja, b.id_sucursal, b.nombre_sucursal, amount, -amount, orderId,
      user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
      await client.query(`UPDATE gmx.caja_sesiones SET egresos_efectivo=COALESCE(egresos_efectivo,0)+$2,
        saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))-$2,fecha_actualizacion=NOW()
        WHERE id_caja=$1`, [cash.id_caja, amount]);
    }
    await reverseBenefitsTx(client, { order: sale, user, reason: input.reason || 'Cancelación TCG' });

    await client.query(`UPDATE gmx.pedidos SET estado_pedido='CANCELADO',venta_confirmada=false,
      inventario_liberado=true,notas=CONCAT_WS(' | ',NULLIF(notas,''),$2),fecha_actualizacion=NOW()
      WHERE row_id=$1`, [sale.row_id, `Cancelación TCG: ${input.reason || 'Sin motivo'}`]);
    await client.query('COMMIT');
    return { id_pedido: orderId, status: 'CANCELADO', units: details.rows.reduce((s, x) => s + int(x.cantidad), 0) };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function listTcgSales({ branchId = '', limit = 100 } = {}) {
  return query(`SELECT p.*,
    COUNT(d.row_id)::bigint AS lineas,COALESCE(SUM(d.cantidad),0)::bigint AS unidades
    FROM gmx.pedidos p LEFT JOIN gmx.detalle_pedidos d ON d.id_pedido=p.id_pedido AND d.tipo='TCG'
    WHERE p.canal_venta='TCG_POS' ${branchId ? 'AND p.id_sucursal=$1' : ''}
    GROUP BY p.row_id ORDER BY p.fecha DESC NULLS LAST LIMIT ${branchId ? '$2' : '$1'}`,
  branchId ? [branchId, Math.min(int(limit) || 100, 300)] : [Math.min(int(limit) || 100, 300)]);
}

export async function listMovements({ branchId = '', limit = 300 } = {}) {
  return query(`SELECT * FROM gmx.tcg_movimientos_sucursales
    ${branchId ? 'WHERE id_sucursal_origen=$1 OR id_sucursal_destino=$1' : ''}
    ORDER BY fecha DESC NULLS LAST,row_id DESC LIMIT ${branchId ? '$2' : '$1'}`,
  branchId ? [branchId, Math.min(int(limit) || 300, 1000)] : [Math.min(int(limit) || 300, 1000)]);
}

export async function createCount(input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await branch(client, String(input.branchId || ''));
    const open = await client.query(`SELECT id_conteo FROM gmx.tcg_conteos
      WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTO' LIMIT 1`, [b.id_sucursal]);
    if (open.rowCount) throw new Error('OPEN_COUNT_ALREADY_EXISTS');
    const id = uid('TCGCOUNT');
    await client.query(`INSERT INTO gmx.tcg_conteos(
      id_conteo,fecha_inicio,id_sucursal,sucursal,estado,id_admin,administrador,notas,
      variantes_contadas,unidades_sistema,unidades_fisicas,diferencia_unidades,ajustes_aplicados)
      VALUES($1,NOW(),$2,$3,'ABIERTO',$4,$5,$6,'0',0,0,0,'NO')`, [
    id, b.id_sucursal, b.nombre_sucursal, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"), input.notes || null]
    );
    const inv = await client.query(`SELECT s.*,i.rareza,i.idioma,i.condicion,i.edicion,c.nombre AS carta
      FROM gmx.tcg_inventario_sucursales s
      JOIN gmx.tcg_inventario i ON i.id_inventario=s.id_inventario
      LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
      WHERE s.id_sucursal=$1 ORDER BY c.nombre,i.sku`, [b.id_sucursal]);
    for (const x of inv.rows) {
      await client.query(`INSERT INTO gmx.tcg_conteo_detalle(
        id_detalle,id_conteo,fecha_captura,id_inventario,id_carta,sku,carta,rareza,idioma,condicion,edicion,
        stock_sistema,cantidad_fisica,diferencia,estado_ajuste,id_admin_captura,administrador_captura)
        VALUES($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,'PENDIENTE',$12,$13)`, [
      uid('TCGCD'), id, x.id_inventario, x.id_carta, x.sku, x.carta, x.rareza, x.idioma, x.condicion, x.edicion,
      int(x.stock), user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
    }
    await client.query(`UPDATE gmx.tcg_conteos SET unidades_sistema=$2 WHERE id_conteo=$1`, [
    id, inv.rows.reduce((s, x) => s + int(x.stock), 0)]
    );
    await client.query('COMMIT');
    return { id_conteo: id, branch: b, variants: inv.rows.length, mode: 'CONTEO_CIEGO' };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function listCounts({ branchId = '', limit = 100 } = {}) {
  return query(`SELECT * FROM gmx.tcg_conteos ${branchId ? 'WHERE id_sucursal=$1' : ''}
    ORDER BY fecha_inicio DESC NULLS LAST,row_id DESC LIMIT ${branchId ? '$2' : '$1'}`,
  branchId ? [branchId, Math.min(int(limit) || 100, 300)] : [Math.min(int(limit) || 100, 300)]);
}

export async function getCount(id) {
  const h = await query(`SELECT * FROM gmx.tcg_conteos WHERE id_conteo=$1 ORDER BY row_id LIMIT 1`, [id]);
  if (!h.rowCount) return null;
  const d = await query(`SELECT * FROM gmx.tcg_conteo_detalle WHERE id_conteo=$1 ORDER BY carta,sku,row_id`, [id]);
  return { ...h.rows[0], details: d.rows };
}

export async function captureCount(id, input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(`SELECT * FROM gmx.tcg_conteos WHERE id_conteo=$1 AND UPPER(COALESCE(estado,''))='ABIERTO' FOR UPDATE`, [id]);
    if (!c.rowCount) throw new Error('COUNT_NOT_OPEN');
    let raw = String(input.code || '').trim();
    if (raw.toUpperCase().startsWith("TCG-STORE-TEMPLATE-TCG:")) {
      raw = raw.slice(8).trim();
    }
    const d = await client.query(`SELECT * FROM gmx.tcg_conteo_detalle WHERE id_conteo=$1
      AND (UPPER(COALESCE(id_inventario,''))=UPPER($2) OR UPPER(COALESCE(sku,''))=UPPER($2))
      ORDER BY row_id LIMIT 1 FOR UPDATE`, [id, raw]);
    if (!d.rowCount) throw new Error('VARIANT_NOT_IN_COUNT');
    const current = d.rows[0].cantidad_fisica == null ? 0 : int(d.rows[0].cantidad_fisica);
    const physical = input.quantity !== undefined ? int(input.quantity) : current + 1;
    if (physical < 0) throw new Error('INVALID_PHYSICAL_COUNT');
    const diff = physical - int(d.rows[0].stock_sistema);
    await client.query(`UPDATE gmx.tcg_conteo_detalle SET cantidad_fisica=$2,diferencia=$3,
      fecha_captura=NOW(),id_admin_captura=$4,administrador_captura=$5 WHERE row_id=$1`, [
    d.rows[0].row_id, physical, diff, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
    );
    await client.query('COMMIT');
    return { ...d.rows[0], cantidad_fisica: physical, diferencia: diff };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function closeCount(id, input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(`SELECT * FROM gmx.tcg_conteos WHERE id_conteo=$1 AND UPPER(COALESCE(estado,''))='ABIERTO' FOR UPDATE`, [id]);
    if (!c.rowCount) throw new Error('COUNT_NOT_OPEN');
    const details = await client.query(`SELECT * FROM gmx.tcg_conteo_detalle WHERE id_conteo=$1 ORDER BY row_id FOR UPDATE`, [id]);
    const missing = details.rows.filter((x) => x.cantidad_fisica == null);
    if (missing.length && !input.zeroUncounted) throw new Error(`UNCOUNTED_VARIANTS:${missing.length}`);
    let physicalTotal = 0,diffTotal = 0,adjusted = 0;
    for (const d of details.rows) {
      const physical = d.cantidad_fisica == null ? 0 : int(d.cantidad_fisica);
      const diff = physical - int(d.stock_sistema);
      physicalTotal += physical;diffTotal += diff;
      await client.query(`UPDATE gmx.tcg_conteo_detalle SET cantidad_fisica=$2,diferencia=$3 WHERE row_id=$1`, [d.row_id, physical, diff]);
      if (input.applyAdjustments && diff !== 0) {
        const v = await resolveVariant(client, d.id_inventario, true);
        const b = { id_sucursal: c.rows[0].id_sucursal, nombre_sucursal: c.rows[0].sucursal };
        const loc = await localStock(client, v, b, true);
        const lb = n(loc.stock),gb = n(v.stock);
        const appliedDelta = physical - lb;
        const ga = gb + appliedDelta;
        if (ga < 0) throw new Error(`NEGATIVE_GLOBAL_AFTER_COUNT:${v.sku}`);
        await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [loc.row_id, physical]);
        await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [v.row_id, ga]);
        await movement(client, { type: 'CONTEO_AJUSTE', variant: v,
          origin: appliedDelta < 0 ? b : null, dest: appliedDelta > 0 ? b : null, qty: Math.abs(appliedDelta),
          originBefore: appliedDelta < 0 ? lb : null, originAfter: appliedDelta < 0 ? physical : null,
          destBefore: appliedDelta > 0 ? lb : null, destAfter: appliedDelta > 0 ? physical : null,
          globalBefore: gb, globalAfter: ga, reference: id, reason: 'Conciliación conteo físico TCG', user });
        await client.query(`UPDATE gmx.tcg_conteo_detalle SET estado_ajuste='APLICADO' WHERE row_id=$1`, [d.row_id]);
        adjusted++;
      } else {
        await client.query(`UPDATE gmx.tcg_conteo_detalle SET estado_ajuste=$2 WHERE row_id=$1`, [
        d.row_id, diff === 0 ? 'SIN_DIFERENCIA' : input.applyAdjustments ? 'APLICADO' : 'NO_APLICADO']
        );
      }
    }
    const counted = details.rows.filter((x) => x.cantidad_fisica != null).length;
    await client.query(`UPDATE gmx.tcg_conteos SET fecha_cierre=NOW(),estado=$2,variantes_contadas=$3,
      unidades_fisicas=$4,diferencia_unidades=$5,ajustes_aplicados=$6 WHERE row_id=$1`, [
    c.rows[0].row_id, input.applyAdjustments ? 'AJUSTADO' : 'CERRADO', String(counted),
    physicalTotal, diffTotal, input.applyAdjustments ? 'SI' : 'NO']
    );

    // TCG-006G: registrar el cierre dentro de la misma transaccion.
    // Si la auditoria falla, el cierre completo se revierte.
    const auditUser = user?.email || user?.nombre || user?.id_admin || 'system';
    const auditDetail = JSON.stringify({
      id_conteo: id,
      id_sucursal: c.rows[0].id_sucursal,
      sucursal: c.rows[0].sucursal,
      estado: input.applyAdjustments ? 'AJUSTADO' : 'CERRADO',
      variantes: counted,
      unidades_fisicas: physicalTotal,
      diferencia_unidades: diffTotal,
      ajustes_aplicados: input.applyAdjustments ? 'SI' : 'NO',
      ajustes_realizados: adjusted
    });

    await client.query(
      `INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
       VALUES(NOW(),$1,$2,$3,$4,$5)`,
      ['TCG', 'CERRAR_CONTEO', id, auditDetail, auditUser]
    );

    await client.query('COMMIT');
    return { id_conteo: id, status: input.applyAdjustments ? 'AJUSTADO' : 'CERRADO',
      variants: details.rows.length, physicalTotal, diffTotal, adjusted };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function applyCountAdjustment(id, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const c = await client.query(`SELECT * FROM gmx.tcg_conteos
      WHERE id_conteo=$1
      FOR UPDATE`, [id]);
    if (!c.rowCount) throw new Error('COUNT_NOT_FOUND');

    const count = c.rows[0];

    // TCG-007-FUNC07: idempotencia post-ajuste.
    // Si el ajuste ya fue aplicado, devolver PASS lógico sin modificar
    // inventario, movimientos ni auditoría, aunque el conteo ya está AJUSTADO.
    if (String(count.ajustes_aplicados || '').toUpperCase() === 'SI') {
      await client.query('COMMIT');
      return {
        id_conteo: id,
        status: 'AJUSTADO',
        adjusted: 0,
        idempotent: true
      };
    }

    // El primer ajuste solamente puede ejecutarse sobre un conteo CERRADO.
    if (String(count.estado || '').toUpperCase() !== 'CERRADO') {
      throw new Error('COUNT_NOT_CLOSED');
    }

    const details = await client.query(`SELECT * FROM gmx.tcg_conteo_detalle
      WHERE id_conteo=$1 ORDER BY row_id FOR UPDATE`, [id]);

    // TCG-007-FUNC08: proteger el ajuste contra cambios de stock posteriores
    // al snapshot tomado al crear el conteo. Toda la validacion ocurre antes
    // de modificar inventario; si una sucursal cambio, la transaccion completa
    // se revierte y no se generan movimientos ni auditoria de ajuste.
    for (const d of details.rows) {
      const v = await resolveVariant(client, d.id_inventario, true);
      const b = { id_sucursal: count.id_sucursal, nombre_sucursal: count.sucursal };
      const loc = await localStock(client, v, b, true);
      const expected = int(d.stock_sistema);
      const current = n(loc.stock);
      if (current !== expected) {
        throw new Error('COUNT_STOCK_CHANGED');
      }
    }

    let adjusted = 0;
    let physicalTotal = 0;
    let diffTotal = 0;

    for (const d of details.rows) {
      const physical = d.cantidad_fisica == null ? 0 : int(d.cantidad_fisica);
      const diff = physical - int(d.stock_sistema);
      physicalTotal += physical;
      diffTotal += diff;

      if (diff === 0) {
        await client.query(`UPDATE gmx.tcg_conteo_detalle
          SET cantidad_fisica=$2,diferencia=$3,estado_ajuste='SIN_DIFERENCIA'
          WHERE row_id=$1`, [d.row_id, physical, diff]);
        continue;
      }

      if (String(d.estado_ajuste || '').toUpperCase() === 'APLICADO') {
        continue;
      }

      const v = await resolveVariant(client, d.id_inventario, true);
      const b = { id_sucursal: count.id_sucursal, nombre_sucursal: count.sucursal };
      const loc = await localStock(client, v, b, true);
      const lb = n(loc.stock);
      const gb = n(v.stock);
      const appliedDelta = physical - lb;
      const ga = gb + appliedDelta;

      if (ga < 0) throw new Error(`NEGATIVE_GLOBAL_AFTER_COUNT:${v.sku}`);
      if (physical < n(loc.stock_reservado)) throw new Error(`COUNT_BELOW_RESERVED:${v.sku}`);

      await client.query(`UPDATE gmx.tcg_inventario_sucursales
        SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
      [loc.row_id, physical]);

      await client.query(`UPDATE gmx.tcg_inventario
        SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
      [v.row_id, ga]);

      await movement(client, { type: 'CONTEO_AJUSTE', variant: v,
        origin: appliedDelta < 0 ? b : null, dest: appliedDelta > 0 ? b : null, qty: Math.abs(appliedDelta),
        originBefore: appliedDelta < 0 ? lb : null, originAfter: appliedDelta < 0 ? physical : null,
        destBefore: appliedDelta > 0 ? lb : null, destAfter: appliedDelta > 0 ? physical : null,
        globalBefore: gb, globalAfter: ga, reference: id,
        reason: 'Conciliacion conteo fisico TCG', user });

      await client.query(`UPDATE gmx.tcg_conteo_detalle
        SET estado_ajuste='APLICADO' WHERE row_id=$1`, [d.row_id]);
      adjusted++;
    }

    await client.query(`UPDATE gmx.tcg_conteos SET estado='AJUSTADO',
      ajustes_aplicados='SI',unidades_fisicas=$2,diferencia_unidades=$3
      WHERE row_id=$1`, [count.row_id, physicalTotal, diffTotal]);

    const auditUser = user?.email || user?.nombre || user?.id_admin || 'system';
    const auditDetail = JSON.stringify({
      id_conteo: id,
      id_sucursal: count.id_sucursal,
      sucursal: count.sucursal,
      estado: 'AJUSTADO',
      variantes: details.rows.length,
      unidades_fisicas: physicalTotal,
      diferencia_unidades: diffTotal,
      ajustes_aplicados: 'SI',
      ajustes_realizados: adjusted
    });

    await client.query(
      `INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
       VALUES(NOW(),$1,$2,$3,$4,$5)`,
      ['TCG', 'APLICAR_AJUSTE_CONTEO', id, auditDetail, auditUser]
    );

    await client.query('COMMIT');
    return {
      id_conteo: id,
      status: 'AJUSTADO',
      variants: details.rows.length,
      physicalTotal,
      diffTotal,
      adjusted,
      idempotent: false
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {client.release();}
}

export async function bulkOperations(input, user) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new Error('BULK_ROWS_REQUIRED');
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const op = String(r.operation || '').toUpperCase();
      let data;
      if (op === 'ENTRY' || op === 'EXIT') data = await quickScan({ branchId: r.branchId, code: r.code, quantity: r.quantity, action: op, reference: r.reference, reason: r.reason }, user);else
      if (op === 'TRANSFER') data = await transfer({ originBranchId: r.originBranchId, destBranchId: r.destBranchId, code: r.code, quantity: r.quantity, reference: r.reference, reason: r.reason }, user);else
      if (op === 'ADJUST') data = await adjust({ branchId: r.branchId, code: r.code, targetStock: r.targetStock, delta: r.delta, reference: r.reference, reason: r.reason }, user);else
      throw new Error('INVALID_BULK_OPERATION');
      results.push({ row: i + 1, success: true, data });
    } catch (e) {results.push({ row: i + 1, success: false, error: e.message });}
  }
  return { total: rows.length, ok: results.filter((x) => x.success).length, failed: results.filter((x) => !x.success).length, results };
}
