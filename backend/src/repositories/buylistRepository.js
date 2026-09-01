import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';
import { getTcgExchangeRate } from '../tcgCatalogSyncService.js';

const CFG = {
  basePct: 60,
  minPct: 25,
  maxPct: 80,
  minMarginPct: 25,
  factors: { M: 1, NM: 1, LP: .85, MP: .70, HP: .50, DMG: .30 }
};

function clamp(v, min, max) {return Math.max(min, Math.min(max, v));}
function roundMoney(v) {return Math.round((Number(v) || 0) * 100) / 100;}

export async function listRules() {
  return query(`SELECT * FROM gmx.tcg_buylist_reglas
    ORDER BY COALESCE(NULLIF(prioridad,'')::numeric,999999),row_id`);
}

export async function saveRule(input) {
  const id = String(input.id_regla || '').trim() || `REG-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const r = await query(`
    INSERT INTO gmx.tcg_buylist_reglas(
      id_regla,activa,prioridad,codigo_juego,rareza,condicion,precio_min,precio_max,
      stock_min,stock_max,ajuste_puntos,porcentaje_fijo,margen_minimo_pct,descripcion)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `, [id, input.activa !== false, String(input.prioridad || 100), String(input.codigo_juego || '').toUpperCase() || null,
  input.rareza || null, String(input.condicion || '').toUpperCase() || null,
  input.precio_min === '' ? null : Number(input.precio_min), input.precio_max === '' ? null : Number(input.precio_max),
  input.stock_min === '' ? null : Number(input.stock_min), input.stock_max === '' ? null : Number(input.stock_max),
  input.ajuste_puntos === '' ? null : String(input.ajuste_puntos), input.porcentaje_fijo === '' ? null : Number(input.porcentaje_fijo),
  input.margen_minimo_pct === '' ? null : Number(input.margen_minimo_pct), input.descripcion || null]);
  return r.rows[0];
}

export async function toggleRule(rowId, active) {
  const r = await query(`UPDATE gmx.tcg_buylist_reglas SET activa=$2 WHERE row_id=$1 RETURNING *`, [rowId, active]);
  if (!r.rowCount) throw new Error('RULE_NOT_FOUND');
  return r.rows[0];
}

async function cardContext(client, cardId, branchId = '') {
  const c = await client.query(`
    SELECT c.*,j.codigo AS codigo_juego,j.nombre AS juego,s.nombre AS set_nombre
    FROM gmx.tcg_cartas c
    LEFT JOIN gmx.tcg_juegos j ON j.id_juego=c.id_juego
    LEFT JOIN gmx.tcg_sets s ON s.id_set=c.id_set
    WHERE c.id_carta=$1 ORDER BY c.row_id LIMIT 1
  `, [cardId]);
  if (!c.rowCount) throw new Error(`CARD_NOT_FOUND:${cardId}`);
  const card = c.rows[0];

  const stock = await client.query(`
    SELECT COALESCE(SUM(COALESCE(stock,0)),0)::bigint AS stock
    FROM gmx.tcg_inventario_sucursales
    WHERE id_carta=$1 ${branchId ? 'AND id_sucursal=$2' : ''}
  `, branchId ? [cardId, branchId] : [cardId]);

  const store = await client.query(`
    SELECT MIN(NULLIF(i.precio,0)) AS precio_tienda
    FROM gmx.tcg_inventario i
    ${branchId ? `JOIN gmx.tcg_inventario_sucursales bs
      ON bs.id_inventario=i.id_inventario AND bs.id_sucursal=$2` : ''}
    WHERE i.id_carta=$1
      AND COALESCE(i.precio,0)>0
      ${branchId ? 'AND COALESCE(bs.stock,0)>0' : ''}
  `, branchId ? [cardId, branchId] : [cardId]);

  let market = null;
  if (card.master_card_id) {
    const m = await client.query(`
      SELECT
        price_provider,variant,currency,
        COALESCE(NULLIF(market,0),NULLIF(trend,0),NULLIF(mid,0),NULLIF(low,0)) AS market_price,
        fetched_at,provider_updated_at
      FROM gmx.tcg_card_price_current
      WHERE master_card_id=$1
        AND COALESCE(NULLIF(market,0),NULLIF(trend,0),NULLIF(mid,0),NULLIF(low,0)) IS NOT NULL
      ORDER BY
        CASE UPPER(currency) WHEN 'MXN' THEN 0 WHEN 'USD' THEN 1 WHEN 'EUR' THEN 2 ELSE 3 END,
        CASE price_provider WHEN 'TCGplayer' THEN 0 WHEN 'Scryfall' THEN 1 WHEN 'Cardmarket' THEN 2 ELSE 3 END,
        fetched_at DESC
      LIMIT 1
    `, [card.master_card_id]);
    market = m.rows[0] || null;
  }

  return {
    ...card,
    stock_actual: Number(stock.rows[0].stock || 0),
    precio_tienda: Number(store.rows[0]?.precio_tienda || 0),
    precio_mercado: Number(market?.market_price || 0),
    moneda_mercado: String(market?.currency || '').toUpperCase(),
    proveedor_mercado: market?.price_provider || '',
    variante_mercado: market?.variant || '',
    mercado_actualizado: market?.provider_updated_at || market?.fetched_at || null
  };
}

async function rulesFor(client) {
  const r = await client.query(`SELECT * FROM gmx.tcg_buylist_reglas WHERE COALESCE(activa,true)=true ORDER BY COALESCE(NULLIF(prioridad,'')::numeric,999999),row_id`);
  return r.rows;
}

function matchesRule(rule, ctx, line) {
  const price = Number(line.precio_base_buylist || line.precio_referencia || 0);
  const stock = Number(ctx.stock_actual || 0);
  if (rule.codigo_juego && String(rule.codigo_juego).toUpperCase() !== String(ctx.codigo_juego || '').toUpperCase()) return false;
  if (rule.rareza && String(rule.rareza).toUpperCase() !== String(line.rareza || ctx.rareza || '').toUpperCase()) return false;
  if (rule.condicion && String(rule.condicion).toUpperCase() !== String(line.condicion || 'NM').toUpperCase()) return false;
  if (rule.precio_min != null && price < Number(rule.precio_min)) return false;
  if (rule.precio_max != null && price > Number(rule.precio_max)) return false;
  if (rule.stock_min != null && stock < Number(rule.stock_min)) return false;
  if (rule.stock_max != null && stock > Number(rule.stock_max)) return false;
  return true;
}

function valueLine(ctx, line, rules, fx = null) {
  const manualStore = Number(line.precio_tienda_override || line.precio_tienda || 0);
  const storePrice = manualStore > 0 ? manualStore : Number(ctx.precio_tienda || 0);
  const marketPrice = Number(ctx.precio_mercado || 0);
  const marketCurrency = String(ctx.moneda_mercado || '').toUpperCase();

  let marketMxn = 0;
  let fxRate = null,fxSource = '',fxDate = null;
  if (marketPrice > 0 && marketCurrency === 'MXN') {
    marketMxn = marketPrice;
    fxRate = 1;fxSource = 'MXN';fxDate = isoDate();
  } else if (marketPrice > 0 && marketCurrency === 'USD' && fx?.available && fx?.rate) {
    fxRate = Number(fx.rate);
    marketMxn = roundMoney(marketPrice * fxRate);
    fxSource = fx.source || 'USD_MXN';
    fxDate = fx.rate_date || null;
  }

  let base = 0,baseSource = '';
  if (storePrice > 0 && marketMxn > 0) {
    base = Math.min(storePrice, marketMxn);
    baseSource = storePrice <= marketMxn ? 'TIENDA_MIN' : 'MERCADO_MIN';
  } else if (storePrice > 0) {
    base = storePrice;
    baseSource = manualStore > 0 ? 'TIENDA_MANUAL' : 'TIENDA';
  } else if (marketMxn > 0) {
    base = marketMxn;
    baseSource = 'MERCADO';
  } else if (marketPrice > 0 && marketCurrency === 'USD') {
    throw new Error(fx?.message || 'BUYLIST_USD_MXN_RATE_REQUIRED');
  } else if (marketPrice > 0) {
    throw new Error(`BUYLIST_UNSUPPORTED_MARKET_CURRENCY:${marketCurrency || 'N/A'}`);
  } else {
    throw new Error('BUYLIST_PRICE_REQUIRED');
  }

  const condition = String(line.condicion || 'NM').toUpperCase();
  const factor = CFG.factors[condition] ?? 1;
  const lineForRules = { ...line, precio_base_buylist: base, precio_referencia: base };
  const rule = rules.find((r) => matchesRule(r, ctx, lineForRules)) || null;
  let pct = rule?.porcentaje_fijo != null ? Number(rule.porcentaje_fijo) : CFG.basePct;
  pct += Number(rule?.ajuste_puntos || 0);
  pct = clamp(pct, CFG.minPct, CFG.maxPct);
  const marginMin = rule?.margen_minimo_pct != null ? Number(rule.margen_minimo_pct) : CFG.minMarginPct;
  pct = Math.min(pct, 100 - marginMin);
  const effectivePct = clamp(pct * factor, 0, 100);
  const unit = roundMoney(base * effectivePct / 100);
  const qty = Math.max(1, Math.trunc(Number(line.cantidad) || 1));

  return {
    ...line,
    rareza: line.rareza || ctx.rareza || '',
    id_juego: ctx.id_juego, id_set: ctx.id_set, carta: ctx.nombre,
    codigo_juego: ctx.codigo_juego, juego: ctx.juego, set_nombre: ctx.set_nombre,
    stock_actual: ctx.stock_actual,
    precio_mercado: marketPrice,
    moneda_mercado: marketCurrency,
    precio_mercado_mxn: marketMxn,
    proveedor_mercado: ctx.proveedor_mercado || '',
    variante_mercado: ctx.variante_mercado || '',
    mercado_actualizado: ctx.mercado_actualizado || null,
    tipo_cambio_mercado: fxRate,
    fuente_tipo_cambio: fxSource,
    fecha_tipo_cambio: fxDate,
    precio_tienda: roundMoney(storePrice),
    precio_base_buylist: roundMoney(base),
    fuente_base_buylist: baseSource,
    precio_referencia: roundMoney(base),
    factor_condicion: factor,
    porcentaje_compra: roundMoney(effectivePct),
    oferta_unitario: unit,
    oferta_linea: roundMoney(unit * qty),
    precio_venta_estimado: roundMoney(storePrice || base),
    regla: rule
  };
}

export async function previewValuation({ branchId = '', items = [] }) {
  const client = await pool.connect();
  try {
    const rules = await rulesFor(client);
    const out = [];
    for (const line of items) {
      const ctx = await cardContext(client, String(line.id_carta || ''), branchId);
      const fx = await getTcgExchangeRate(ctx.codigo_juego);
      out.push(valueLine(ctx, line, rules, fx));
    }
    return { config: CFG, items: out, total: roundMoney(out.reduce((s, x) => s + x.oferta_linea, 0)) };
  } finally {client.release();}
}

export async function listBuylists({ search = '', status = '', limit = 200 } = {}) {
  const vals = [];const f = [];
  if (search) {vals.push(`%${search}%`);f.push(`(COALESCE(b.id_buylist,'') ILIKE $${vals.length} OR COALESCE(b.cliente,'') ILIKE $${vals.length} OR COALESCE(b.telefono,'') ILIKE $${vals.length} OR COALESCE(b.email,'') ILIKE $${vals.length})`);}
  if (status) {vals.push(status);f.push(`b.estado=$${vals.length}`);}
  vals.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  return query(`SELECT b.* FROM gmx.tcg_buylist b ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY b.fecha DESC NULLS LAST,b.row_id DESC LIMIT $${vals.length}`, vals);
}

export async function getBuylist(rowId) {
  const h = await query(`SELECT * FROM gmx.tcg_buylist WHERE row_id=$1`, [rowId]);
  if (!h.rowCount) return null;
  const id = h.rows[0].id_buylist;
  const [d, p, a] = await Promise.all([
  query(`SELECT * FROM gmx.tcg_buylist_detalle WHERE id_buylist=$1 ORDER BY linea,row_id`, [id]),
  query(`SELECT * FROM gmx.tcg_buylist_pagos WHERE id_buylist=$1 ORDER BY fecha,row_id`, [id]),
  query(`SELECT * FROM gmx.tcg_buylist_auditoria WHERE id_buylist=$1 ORDER BY fecha,row_id`, [id])]
  );
  return { ...h.rows[0], detalles: d.rows, pagos: p.rows, auditoria: a.rows };
}

async function audit(client, id, action, from, to, detail = '') {
  await client.query(`INSERT INTO gmx.tcg_buylist_auditoria(
    id_auditoria,fecha,id_buylist,accion,estado_anterior,estado_nuevo,detalle,id_admin,administrador)
    VALUES('BLAUD-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
    NOW(),$1,$2,$3,$4,$5,'LOCAL','APP Local')`, [id, action, from || null, to || null, detail || null]);
}

export async function createDraft({ clientId = '', branchId, items = [], notes = '' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const br = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales WHERE id_sucursal=$1 AND COALESCE(activa,true)=true ORDER BY row_id LIMIT 1`, [branchId]);
    if (!br.rowCount) throw new Error('BRANCH_NOT_FOUND');
    let customer = null;
    if (clientId) {
      const c = await client.query(`SELECT id_cliente,nombre,telefono,email FROM gmx.clientes WHERE id_cliente=$1 ORDER BY row_id LIMIT 1`, [clientId]);
      if (!c.rowCount) throw new Error('CLIENT_NOT_FOUND');
      customer = c.rows[0];
    }
    const rules = await rulesFor(client);
    const valued = [];
    for (const line of items) {
      const ctx = await cardContext(client, String(line.id_carta || ''), branchId);
      const fx = await getTcgExchangeRate(ctx.codigo_juego);
      valued.push(valueLine(ctx, line, rules, fx));
    }
    if (!valued.length) throw new Error('EMPTY_BUYLIST');
    const id = `BUY-LOCAL-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const total = roundMoney(valued.reduce((s, x) => s + x.oferta_linea, 0));
    const refs = roundMoney(valued.reduce((s, x) => s + Number(x.precio_referencia || 0) * Number(x.cantidad || 1), 0));
    const units = valued.reduce((s, x) => s + Number(x.cantidad || 1), 0);
    const h = await client.query(`INSERT INTO gmx.tcg_buylist(
      id_buylist,fecha,id_cliente,cliente,telefono,email,metodo_pago,referencia_pago,
      id_sucursal,sucursal,lineas,unidades,valor_referencia,oferta_total,estado,id_admin,
      administrador,notas,fecha_actualizacion,estado_pago,version_registro,cancelacion_inventario,cancelacion_pago)
      VALUES($1,NOW(),$2,$3,$4,$5,NULL,NULL,$6,$7,$8,$9,$10::text,$11,'BORRADOR','LOCAL','APP Local',$12,NOW(),'NO_APLICA','LOCAL-V1',false,false)
      RETURNING row_id`, [
    id, customer?.id_cliente || null, customer?.nombre || 'Público general', customer?.telefono || null, customer?.email || null,
    branchId, br.rows[0].nombre_sucursal, valued.length, units, refs, total, notes || null]
    );
    for (let i = 0; i < valued.length; i++) {
      const x = valued[i];
      await client.query(`INSERT INTO gmx.tcg_buylist_detalle(
        id_buylist,linea,id_inventario_origen,id_carta,id_juego,id_set,carta,sku,rareza,idioma,
        condicion,edicion,graded,empresa_grading,grado,certificado,cantidad,precio_referencia,
        precio_mercado,moneda_mercado,proveedor_mercado,precio_mercado_mxn,tipo_cambio_mercado,fuente_tipo_cambio,fecha_tipo_cambio,
        precio_tienda,precio_base_buylist,fuente_base_buylist,factor_condicion,porcentaje_compra,oferta_unitario,oferta_linea,precio_venta_estimado,
        id_sucursal,sucursal,estado_linea,mensaje)
        VALUES($1,$2,NULL,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,'VALUADA',$34)`, [
      id, i + 1, x.id_carta, x.id_juego, x.id_set, x.carta, x.rareza || null, String(x.idioma || 'ES').toUpperCase(),
      String(x.condicion || 'NM').toUpperCase(), x.edicion || null, x.graded === true, x.empresa_grading || null,
      x.grado === '' || x.grado == null ? null : Number(x.grado), x.certificado || null, Number(x.cantidad || 1),
      Number(x.precio_referencia), Number(x.precio_mercado || 0), x.moneda_mercado || null, x.proveedor_mercado || null,
      Number(x.precio_mercado_mxn || 0), x.tipo_cambio_mercado || null, x.fuente_tipo_cambio || null, x.fecha_tipo_cambio || null,
      Number(x.precio_tienda || 0), Number(x.precio_base_buylist || 0), x.fuente_base_buylist || null,
      x.factor_condicion, x.porcentaje_compra, x.oferta_unitario, x.oferta_linea,
      x.precio_venta_estimado, branchId, br.rows[0].nombre_sucursal,
      x.regla ? `Regla ${x.regla.id_regla}` : `Base ${x.fuente_base_buylist || 'automática'}`]
      );
    }
    await audit(client, id, 'CREAR', null, 'BORRADOR', `Oferta ${total}`);
    await client.query('COMMIT');
    return getBuylist(h.rows[0].row_id);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function decide(rowId, { decision, paymentMethod = 'EFECTIVO', reference = '', reason = '' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.tcg_buylist WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!r.rowCount) throw new Error('BUYLIST_NOT_FOUND');
    const b = r.rows[0],state = String(b.estado || '').toUpperCase();
    if (decision === 'REJECT') {
      if (state === 'CONVERTIDA') throw new Error('BUYLIST_ALREADY_CONVERTED');
      if (state === 'RECHAZADA') {await client.query('COMMIT');return getBuylist(rowId);}
      await client.query(`UPDATE gmx.tcg_buylist SET estado='RECHAZADA',estado_pago='NO_APLICA',
        notas=CONCAT_WS(' | ',NULLIF(notas,''),NULLIF($2,'')),fecha_actualizacion=NOW(),fecha_cierre=NOW()
        WHERE row_id=$1`, [rowId, reason ? `RECHAZADA: ${reason}` : 'Cliente rechazó oferta']);
      await audit(client, b.id_buylist, 'RECHAZAR', state, 'RECHAZADA', reason);
      await client.query('COMMIT');return getBuylist(rowId);
    }
    if (!['BORRADOR', 'ACEPTADA'].includes(state)) throw new Error('BUYLIST_NOT_ACCEPTABLE');
    const method = String(paymentMethod || 'EFECTIVO').toUpperCase();
    if (['TRANSFERENCIA', 'TARJETA'].includes(method) && !reference) throw new Error('PAYMENT_REFERENCE_REQUIRED');
    await client.query(`UPDATE gmx.tcg_buylist SET estado='ACEPTADA',estado_pago='PENDIENTE',
      metodo_pago=$2,referencia_pago=NULLIF($3,''),fecha_aceptacion=COALESCE(fecha_aceptacion,NOW()),
      fecha_actualizacion=NOW() WHERE row_id=$1`, [rowId, method, reference]);
    if (state !== 'ACEPTADA') await audit(client, b.id_buylist, 'ACEPTAR', state, 'ACEPTADA', 'Oferta aceptada. Pago pendiente.');
    await client.query('COMMIT');return getBuylist(rowId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

async function openCashForUpdate(client, branchId) {
  const r = await client.query(`SELECT * FROM gmx.caja_sesiones WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
    ORDER BY fecha_apertura DESC,row_id DESC LIMIT 1 FOR UPDATE`, [branchId]);
  return r.rows[0] || null;
}

export async function pay(rowId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.tcg_buylist WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!r.rowCount) throw new Error('BUYLIST_NOT_FOUND');
    const b = r.rows[0];
    if (String(b.estado || '').toUpperCase() !== 'ACEPTADA') throw new Error('BUYLIST_NOT_ACCEPTED');
    if (String(b.estado_pago || '').toUpperCase() === 'PAGADO') {await client.query('COMMIT');return getBuylist(rowId);}
    const method = String(b.metodo_pago || 'EFECTIVO').toUpperCase();
    const amount = Number(b.oferta_total || 0);
    if (amount <= 0) throw new Error('INVALID_BUYLIST_AMOUNT');
    if (['TRANSFERENCIA', 'TARJETA'].includes(method) && !b.referencia_pago) throw new Error('PAYMENT_REFERENCE_REQUIRED');

    const paymentId = `BLPAY-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await client.query(`INSERT INTO gmx.tcg_buylist_pagos(
      id_pago,fecha,id_buylist,id_cliente,cliente,metodo_pago,monto,referencia,estado,id_operacion_pos,id_admin,administrador)
      VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,'PAGADO',$8,'LOCAL','APP Local')`, [
    paymentId, b.id_buylist, b.id_cliente, b.cliente, method, amount, b.referencia_pago || null, paymentId]
    );

    if (method === 'EFECTIVO') {
      const cash = await openCashForUpdate(client, b.id_sucursal);
      if (!cash) throw new Error('NO_OPEN_CASH_FOR_CASH_PAYMENT');
      await client.query(`INSERT INTO gmx.caja_movimientos(
        id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,
        importe,impacto_efectivo,referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
        VALUES($1,$2,NOW(),$3,$4,'EGRESO','BUYLIST','EFECTIVO',$5,$6,$7,'Pago Buylist','TCG_BUYLIST',$8,'LOCAL','APP Local',false)`, [
      `CAJBL-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, cash.id_caja, b.id_sucursal, b.sucursal, amount, -amount, paymentId, b.id_buylist]
      );
      await client.query(`UPDATE gmx.caja_sesiones SET egresos_efectivo=COALESCE(egresos_efectivo,0)+$2,
        saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))-$2,fecha_actualizacion=NOW()
        WHERE id_caja=$1`, [cash.id_caja, amount]);
    }

    await client.query(`UPDATE gmx.tcg_buylist SET estado_pago='PAGADO',id_operacion_pos=$2,
      fecha_actualizacion=NOW() WHERE row_id=$1`, [rowId, paymentId]);
    await audit(client, b.id_buylist, 'PAGAR', 'ACEPTADA', 'ACEPTADA', `${method} ${amount}`);
    await client.query('COMMIT');return getBuylist(rowId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

async function ensureVariant(client, d, b) {
  const idioma = String(d.idioma || 'ES').toUpperCase(),cond = String(d.condicion || 'NM').toUpperCase();
  const ed = String(d.edicion || ''),graded = d.graded === true,company = String(d.empresa_grading || ''),cert = String(d.certificado || '');
  let inv = await client.query(`SELECT * FROM gmx.tcg_inventario WHERE id_carta=$1 AND COALESCE(idioma,'')=$2
    AND COALESCE(condicion,'')=$3 AND COALESCE(edicion,'')=$4 AND COALESCE(graded,false)=$5
    AND COALESCE(empresa_grading,'')=$6 AND COALESCE(grado,-1)=COALESCE($7::numeric,-1)
    AND COALESCE(certificado,'')=$8 ORDER BY row_id LIMIT 1 FOR UPDATE`, [
  d.id_carta, idioma, cond, ed, graded, company, d.grado, cert]
  );
  if (!inv.rowCount) {
    const id = `TCGI-BL-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const sku = `BL-${String(d.id_carta).replace(/[^A-Za-z0-9]/g, '').slice(-8)}-${cond}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    inv = await client.query(`INSERT INTO gmx.tcg_inventario(
      id_inventario,id_carta,sku,idioma,condicion,acabado,edicion,graded,empresa_grading,grado,
      certificado,costo,precio,precio_oferta,stock,stock_reservado,ubicacion,sucursal,estado_venta,
      fecha_entrada,ultima_actualizacion,rareza)
      VALUES($1,$2,$3,$4,$5,'NORMAL',$6,$7,$8,$9,$10,$11,$12,NULL,0,0,$13,$14,'DISPONIBLE',NOW(),NOW(),$15) RETURNING *`, [
    id, d.id_carta, sku, idioma, cond, ed, graded, company || null, d.grado, cert || null,
    Number(d.oferta_unitario || 0), Number(d.precio_venta_estimado || d.precio_referencia || 0),
    b.id_sucursal, b.sucursal, d.rareza || null]
    );
  }
  return inv.rows[0];
}

export async function convert(rowId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query(`SELECT * FROM gmx.tcg_buylist WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!h.rowCount) throw new Error('BUYLIST_NOT_FOUND');
    const b = h.rows[0],state = String(b.estado || '').toUpperCase(),paid = String(b.estado_pago || '').toUpperCase();
    if (state === 'CONVERTIDA') {await client.query('COMMIT');return getBuylist(rowId);}
    if (state !== 'ACEPTADA' || paid !== 'PAGADO') throw new Error('PAYMENT_REQUIRED_BEFORE_INVENTORY');

    const details = await client.query(`SELECT * FROM gmx.tcg_buylist_detalle WHERE id_buylist=$1 ORDER BY linea,row_id FOR UPDATE`, [b.id_buylist]);
    const lot = `BLLOT-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    for (const d of details.rows) {
      const qty = Number(d.cantidad || 0);if (qty <= 0) continue;
      const inv = await ensureVariant(client, d, b);
      const gb = Number(inv.stock || 0),ga = gb + qty;
      await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [inv.row_id, ga]);
      let loc = await client.query(`SELECT * FROM gmx.tcg_inventario_sucursales WHERE id_sucursal=$1 AND id_inventario=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`, [b.id_sucursal, inv.id_inventario]);
      if (!loc.rowCount) {
        loc = await client.query(`INSERT INTO gmx.tcg_inventario_sucursales(
          id_registro,id_inventario,id_carta,sku,id_sucursal,sucursal,stock,stock_reservado,ultima_actualizacion)
          VALUES('TCGIS-BL-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
          $1,$2,$3,$4,$5,0,0,NOW()) RETURNING *`, [inv.id_inventario, d.id_carta, inv.sku, b.id_sucursal, b.sucursal]);
      }
      const lb = Number(loc.rows[0].stock || 0),la = lb + qty;
      await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [loc.rows[0].row_id, la]);
      const acq = `TCGA-BL-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      await client.query(`INSERT INTO gmx.tcg_adquisiciones(
        id_adquisicion,fecha,tipo_entrada,origen_nombre,origen_referencia,id_juego,id_set,id_carta,
        id_inventario,sku,carta,rareza,idioma,condicion,edicion,graded,empresa_grading,grado,certificado,
        id_sucursal,sucursal,cantidad,costo_unitario,costo_total,precio_venta,precio_oferta,
        margen_unitario,margen_porcentaje,id_admin,administrador,notas,estado,mensaje)
        VALUES($1,NOW(),'BUYLIST',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,$24,$25,$26,'LOCAL','APP Local',$27,'COMPLETADA','Conversión Buylist')`, [
      acq, b.cliente, b.id_buylist, d.id_juego, d.id_set, d.id_carta, inv.id_inventario, inv.sku, d.carta, d.rareza,
      d.idioma, d.condicion, d.edicion, d.graded, d.empresa_grading, d.grado, d.certificado, b.id_sucursal, b.sucursal,
      qty, Number(d.oferta_unitario || 0), roundMoney(Number(d.oferta_unitario || 0) * qty), Number(d.precio_venta_estimado || 0),
      null, roundMoney(Number(d.precio_venta_estimado || 0) - Number(d.oferta_unitario || 0)),
      Number(d.oferta_unitario || 0) > 0 ? roundMoney((Number(d.precio_venta_estimado || 0) - Number(d.oferta_unitario || 0)) / Number(d.oferta_unitario || 0) * 100) : 0,
      `Buylist ${b.id_buylist}`]
      );
      await client.query(`INSERT INTO gmx.tcg_movimientos_sucursales(
        id_movimiento,fecha,tipo,id_inventario,id_carta,sku,id_sucursal_destino,sucursal_destino,
        cantidad,stock_destino_anterior,stock_destino_nuevo,stock_global_anterior,stock_global_nuevo,
        referencia,motivo,id_admin,administrador)
        VALUES('TCGMOV-BL-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
        NOW(),'BUYLIST_ENTRADA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Conversión Buylist','LOCAL','APP Local')`, [
      inv.id_inventario, d.id_carta, inv.sku, b.id_sucursal, b.sucursal, qty, lb, la, gb, ga, b.id_buylist]
      );
      await client.query(`UPDATE gmx.tcg_buylist_detalle SET id_inventario_ingreso=$2,id_adquisicion=$3,
        fecha_conversion=NOW(),estado_linea='CONVERTIDA',sku=$4 WHERE row_id=$1`, [d.row_id, inv.id_inventario, acq, inv.sku]);
    }
    await client.query(`UPDATE gmx.tcg_buylist SET estado='CONVERTIDA',id_lote_entrada=$2,
      fecha_conversion=NOW(),fecha_cierre=NOW(),fecha_actualizacion=NOW() WHERE row_id=$1`, [rowId, lot]);
    await audit(client, b.id_buylist, 'CONVERTIR_INVENTARIO', 'ACEPTADA', 'CONVERTIDA', `Lote ${lot}`);
    await client.query('COMMIT');return getBuylist(rowId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


export async function cancelBuylist(rowId, reason = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query(`SELECT * FROM gmx.tcg_buylist WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!h.rowCount) throw new Error('BUYLIST_NOT_FOUND');
    const b = h.rows[0],state = String(b.estado || '').toUpperCase();
    if (['CANCELADA', 'RECHAZADA'].includes(state)) {await client.query('COMMIT');return getBuylist(rowId);}
    if (state === 'CONVERTIDA') {
      const d = await client.query(`SELECT * FROM gmx.tcg_buylist_detalle WHERE id_buylist=$1 ORDER BY row_id FOR UPDATE`, [b.id_buylist]);
      for (const x of d.rows) {
        if (!x.id_inventario_ingreso) continue;
        const inv = await client.query(`SELECT * FROM gmx.tcg_inventario WHERE id_inventario=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [x.id_inventario_ingreso]);
        const loc = await client.query(`SELECT * FROM gmx.tcg_inventario_sucursales WHERE id_sucursal=$1 AND id_inventario=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`, [b.id_sucursal, x.id_inventario_ingreso]);
        const qty = Number(x.cantidad || 0);
        if (!inv.rowCount || !loc.rowCount) throw new Error('INVENTORY_REVERSAL_NOT_FOUND');
        const gb = Number(inv.rows[0].stock || 0),lb = Number(loc.rows[0].stock || 0);
        if (gb < qty || lb < qty) throw new Error('INSUFFICIENT_STOCK_FOR_REVERSAL');
        await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [inv.rows[0].row_id, gb - qty]);
        await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`, [loc.rows[0].row_id, lb - qty]);
        await client.query(`INSERT INTO gmx.tcg_movimientos_sucursales(
          id_movimiento,fecha,tipo,id_inventario,id_carta,sku,id_sucursal_origen,sucursal_origen,cantidad,
          stock_origen_anterior,stock_origen_nuevo,stock_global_anterior,stock_global_nuevo,referencia,motivo,id_admin,administrador)
          VALUES('TCGMOV-BLC-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
          NOW(),'BUYLIST_CANCELACION',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'LOCAL','APP Local')`, [
        x.id_inventario_ingreso, x.id_carta, x.sku, b.id_sucursal, b.sucursal, qty, lb, lb - qty, gb, gb - qty, b.id_buylist, reason || 'Cancelación Buylist']
        );
      }
      await client.query(`UPDATE gmx.tcg_buylist SET cancelacion_inventario=true WHERE row_id=$1`, [rowId]);
    }

    if (String(b.estado_pago || '').toUpperCase() === 'PAGADO') {
      const payments = await client.query(`SELECT * FROM gmx.tcg_buylist_pagos WHERE id_buylist=$1 AND estado='PAGADO' ORDER BY fecha DESC`, [b.id_buylist]);
      for (const pay of payments.rows) {
        const rev = `BLREV-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        await client.query(`INSERT INTO gmx.tcg_buylist_pagos(
          id_pago,fecha,id_buylist,id_cliente,cliente,metodo_pago,monto,referencia,estado,id_operacion_pos,id_admin,administrador)
          VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,'REVERSION',$8,'LOCAL','APP Local')`, [
        rev, b.id_buylist, b.id_cliente, b.cliente, pay.metodo_pago, -Number(pay.monto || 0), pay.id_pago, rev]
        );
        if (String(pay.metodo_pago).toUpperCase() === 'EFECTIVO') {
          const cash = await openCashForUpdate(client, b.id_sucursal);
          if (!cash) throw new Error('NO_OPEN_CASH_FOR_CASH_REVERSAL');
          const amount = Number(pay.monto || 0);
          await client.query(`INSERT INTO gmx.caja_movimientos(
            id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,metodo_pago,importe,impacto_efectivo,
            referencia,descripcion,origen_modulo,id_origen,id_admin,administrador,anulado)
            VALUES($1,$2,NOW(),$3,$4,'INGRESO','BUYLIST_REVERSION','EFECTIVO',$5,$5,$6,'Reversión pago Buylist',
            'TCG_BUYLIST',$7,'LOCAL','APP Local',false)`, [
          `CAJBLREV-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, cash.id_caja, b.id_sucursal, b.sucursal, amount, rev, b.id_buylist]
          );
          await client.query(`UPDATE gmx.caja_sesiones SET ingresos_efectivo=COALESCE(ingresos_efectivo,0)+$2,
            saldo_esperado=COALESCE(saldo_esperado,COALESCE(fondo_inicial,0))+$2,fecha_actualizacion=NOW()
            WHERE id_caja=$1`, [cash.id_caja, amount]);
        }
      }
      await client.query(`UPDATE gmx.tcg_buylist SET cancelacion_pago=true WHERE row_id=$1`, [rowId]);
    }

    await client.query(`UPDATE gmx.tcg_buylist SET estado='CANCELADA',fecha_cancelacion=NOW(),
      motivo_cancelacion=$2,fecha_cierre=NOW(),fecha_actualizacion=NOW() WHERE row_id=$1`, [rowId, reason || null]);
    await audit(client, b.id_buylist, 'CANCELAR', state, 'CANCELADA', reason);
    await client.query('COMMIT');return getBuylist(rowId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
