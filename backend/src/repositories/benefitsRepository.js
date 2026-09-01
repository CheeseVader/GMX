import { brandText } from "../config/brand.js";import crypto from 'node:crypto';
import { query } from '../db.js';

const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const n = (v) => Number(v || 0);
const i = (v) => Math.trunc(Number(v || 0));
const round = (v) => Number(Number(v || 0).toFixed(4));

async function settingsTx(client) {
  const r = await client.query(`SELECT parametro,valor FROM gmx.configuracion WHERE parametro LIKE 'loyalty.%'`);
  return Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
}

async function loyaltyAccountTx(client, clientId, lock = false) {
  if (!clientId) return null;
  let r = await client.query(`SELECT * FROM gmx.fidelidad_cuentas WHERE id_cliente=$1 ${lock ? 'FOR UPDATE' : ''}`, [clientId]);
  if (!r.rowCount) {
    r = await client.query(`INSERT INTO gmx.fidelidad_cuentas(id_cliente) VALUES($1) RETURNING *`, [clientId]);
  }
  return r.rows[0];
}

export async function promotionQuoteTx(client, { code = '', subtotal = 0, channel = 'POS_LOCAL', branchId = '', clientId = '', scopeSubtotals = null }) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { promotion: null, discount: 0 };
  const r = await client.query(`SELECT * FROM gmx.promociones
    WHERE UPPER(COALESCE(codigo,''))=$1
      AND UPPER(COALESCE(estado,'ACTIVA'))='ACTIVA'
      AND (NULLIF(inicio::text,'') IS NULL OR NULLIF(inicio::text,'')::timestamptz<=NOW())
      AND (NULLIF(fin::text,'') IS NULL OR NULLIF(fin::text,'')::timestamptz>=NOW())
    ORDER BY row_id DESC LIMIT 1 FOR UPDATE`, [code]);
  if (!r.rowCount) throw new Error('PROMO_INVALID_OR_EXPIRED');
  const p = r.rows[0];
  const channels = String(p.canales || 'TODOS').toUpperCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (!channels.includes('TODOS') && !channels.includes(String(channel).toUpperCase())) throw new Error('PROMO_NOT_VALID_FOR_CHANNEL');
  if (p.id_sucursal && String(p.id_sucursal) !== String(branchId || '')) throw new Error('PROMO_NOT_VALID_FOR_BRANCH');
  const scope = String(p.ambito || 'GENERAL').toUpperCase();
  let eligibleSubtotal = n(subtotal);

  if (String(channel).toUpperCase() === 'PUBLIC' && scopeSubtotals) {
    if (scope === 'TCG') eligibleSubtotal = n(scopeSubtotals.TCG);else
    if (scope === 'PRODUCTOS') eligibleSubtotal = n(scopeSubtotals.PRODUCTOS);
    if (scope === 'TCG' && eligibleSubtotal <= 0) throw new Error('PROMO_NOT_VALID_FOR_TCG');
    if (scope === 'PRODUCTOS' && eligibleSubtotal <= 0) throw new Error('PROMO_NOT_VALID_FOR_PRODUCTS');
  } else {
    if (channel === 'TCG_POS' && !['GENERAL', 'TCG'].includes(scope)) throw new Error('PROMO_NOT_VALID_FOR_TCG');
    if (channel !== 'TCG_POS' && !['GENERAL', 'PRODUCTOS'].includes(scope)) throw new Error('PROMO_NOT_VALID_FOR_PRODUCTS');
  }

  const minimum = n(p.minimo_compra);
  if (n(subtotal) < minimum) throw new Error(`PROMO_MINIMUM:${minimum}`);
  if (p.limite_usos !== null && p.limite_usos !== '') {
    const used = await client.query(`SELECT COUNT(*)::bigint total FROM gmx.promociones_redenciones
      WHERE id_promocion=$1 AND estado='APLICADA'`, [p.id]);
    if (n(used.rows[0].total) >= n(p.limite_usos)) throw new Error('PROMO_USAGE_LIMIT_REACHED');
  }
  if (p.limite_por_cliente !== null && p.limite_por_cliente !== '') {
    if (!clientId) throw new Error('PROMO_REQUIRES_IDENTIFIED_CLIENT');
    const usedClient = await client.query(`SELECT COUNT(*)::bigint total FROM gmx.promociones_redenciones
      WHERE id_promocion=$1 AND id_cliente=$2 AND estado='APLICADA'`, [p.id, clientId]);
    if (n(usedClient.rows[0].total) >= n(p.limite_por_cliente)) throw new Error('PROMO_CLIENT_USAGE_LIMIT_REACHED');
  }
  let discount = 0;
  const type = String(p.tipo || 'PORCENTAJE').toUpperCase();
  const value = n(p.valor);
  if (type === 'PORCENTAJE') discount = eligibleSubtotal * (Math.max(0, value) / 100);else
  if (type === 'MONTO') discount = Math.min(eligibleSubtotal, Math.max(0, value));else
  if (type === 'ENVIO') discount = 0;
  if (p.max_discount !== null && p.max_discount !== '') discount = Math.min(discount, Math.max(0, n(p.max_discount)));
  discount = round(Math.min(n(subtotal), discount));
  return { promotion: p, discount };
}

export async function previewBenefits({ clientId = '', subtotal = 0, promoCode = '', points = 0, channel = 'POS_LOCAL', branchId = '' }) {
  const { pool } = await import('../db.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await calculateBenefitsTx(client, { clientId, subtotal, promoCode, points, channel, branchId, preview: true });
    await client.query('ROLLBACK');
    return result;
  } finally {client.release();}
}

export async function calculateBenefitsTx(client, { clientId = '', subtotal = 0, promoCode = '', points = 0, channel = 'POS_LOCAL', branchId = '', preview = false }) {
  subtotal = round(subtotal);
  const cfg = await settingsTx(client);
  const enabled = String(cfg['loyalty.enabled'] || 'true') === 'true';
  const promo = await promotionQuoteTx(client, { code: promoCode, subtotal, channel, branchId, clientId });
  const account = enabled && clientId ? await loyaltyAccountTx(client, clientId, !preview) : null;
  let requested = Math.max(0, i(points));
  if (!clientId && requested > 0) throw new Error('LOYALTY_REQUIRES_CLIENT');
  if (account) requested = Math.min(requested, Math.max(0, i(account.puntos_disponibles)));else
  requested = 0;
  if (promo.promotion && promo.promotion.acumulable_puntos === false && requested > 0) throw new Error('PROMO_NOT_COMBINABLE_WITH_POINTS');
  if (String(cfg['loyalty.allow_with_promo'] || 'true') !== 'true' && promo.promotion && requested > 0) throw new Error('PROMO_NOT_COMBINABLE_WITH_POINTS');
  const mxnPerPoint = Math.max(0.0001, n(cfg['loyalty.point_value_mxn'] || cfg['loyalty.mxn_per_point'] || 0.1));
  const maxPct = Math.max(0, Math.min(100, n(cfg['loyalty.max_redemption_percent'] || 30)));
  const afterPromo = Math.max(0, subtotal - promo.discount);
  const maxLoyaltyDiscount = round(afterPromo * maxPct / 100);
  let pointsUsed = mxnPerPoint > 0 ? Math.min(requested, Math.floor(maxLoyaltyDiscount / mxnPerPoint)) : 0;
  let loyaltyDiscount = round(pointsUsed * mxnPerPoint);
  loyaltyDiscount = Math.min(loyaltyDiscount, afterPromo);
  const total = round(Math.max(0, afterPromo - loyaltyDiscount));
  const earnPercent = Math.max(0, n(cfg['loyalty.earn_percent'] || 1));
  const minPurchase = Math.max(0, n(cfg['loyalty.min_purchase_to_earn'] || 0));
  const channelEnabled = channel === 'TCG_POS' ?
  String(cfg['loyalty.tcg_enabled'] || 'true') === 'true' :
  String(cfg['loyalty.product_enabled'] || 'true') === 'true';
  const earnBasis = String(cfg['loyalty.earn_basis'] || 'NET_AFTER_DISCOUNTS').toUpperCase();
  const baseForReward = earnBasis === 'SUBTOTAL_BEFORE_DISCOUNTS' ? subtotal : total;
  const earnBase = baseForReward >= minPurchase && channelEnabled && clientId ? baseForReward : 0;
  const rewardMxn = round(earnBase * (earnPercent / 100));
  const rawPoints = mxnPerPoint > 0 ? rewardMxn / mxnPerPoint : 0;
  const rounding = String(cfg['loyalty.earn_rounding'] || 'FLOOR').toUpperCase();
  const pointsEarned = Math.max(0, rounding === 'ROUND' ? Math.round(rawPoints) : rounding === 'CEIL' ? Math.ceil(rawPoints) : Math.floor(rawPoints));
  return {
    subtotal, promotion: promo.promotion, discountPromo: promo.discount,
    pointsAvailable: account ? Math.max(0, i(account.puntos_disponibles)) : 0,
    pointsUsed, loyaltyDiscount, pointsEarned, rewardMxn, earnPercent, pointValueMxn: mxnPerPoint, total
  };
}

export async function applyBenefitsTx(client, { orderId, clientId = '', subtotal, promoCode = '', points = 0, channel, branchId, user }) {
  const b = await calculateBenefitsTx(client, { clientId, subtotal, promoCode, points, channel, branchId, preview: false });
  if (b.promotion) {
    await client.query(`INSERT INTO gmx.promociones_redenciones(
      id_redencion,id_promocion,codigo,id_pedido,id_cliente,canal,subtotal,descuento,estado)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'APLICADA')`, [
    uid('RED'), b.promotion.id, b.promotion.codigo, orderId, clientId || null, channel, b.subtotal, b.discountPromo]
    );
    await client.query(`UPDATE gmx.promociones SET usos=COALESCE(usos,0)+1,actualizacion=NOW() WHERE row_id=$1`, [b.promotion.row_id]);
  }
  if (clientId) {
    const acct = await loyaltyAccountTx(client, clientId, true);
    let saldo = i(acct.puntos_disponibles);
    if (b.pointsUsed > 0) {
      const before = saldo;saldo -= b.pointsUsed;
      await client.query(`INSERT INTO gmx.fidelidad_movimientos(
        id_movimiento,id_cliente,tipo,puntos,saldo_anterior,saldo_nuevo,id_pedido,referencia,motivo,id_admin,administrador)
        VALUES($1,$2,'REDENCION',$3,$4,$5,$6,$6,'Redención en venta',$7,$8)`, [
      uid('FID'), clientId, -b.pointsUsed, before, saldo, orderId, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
    }
    if (b.pointsEarned > 0) {
      const before = saldo;saldo += b.pointsEarned;
      const cfg = await settingsTx(client);
      const months = Math.max(0, i(cfg['loyalty.expiration_months'] || 12));
      const exp = months ? new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000) : null;
      await client.query(`INSERT INTO gmx.fidelidad_movimientos(
        id_movimiento,id_cliente,tipo,puntos,saldo_anterior,saldo_nuevo,id_pedido,referencia,fecha_expiracion,motivo,id_admin,administrador)
        VALUES($1,$2,'GENERACION',$3,$4,$5,$6,$6,$7,'Puntos por compra',$8,$9)`, [
      uid('FID'), clientId, b.pointsEarned, before, saldo, orderId, exp, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
      );
    }
    await client.query(`UPDATE gmx.fidelidad_cuentas SET
      puntos_disponibles=$2,
      puntos_generados=COALESCE(puntos_generados,0)+$3,
      puntos_redimidos=COALESCE(puntos_redimidos,0)+$4,
      fecha_actualizacion=NOW()
      WHERE id_cliente=$1`, [clientId, saldo, b.pointsEarned, b.pointsUsed]);
  }
  return b;
}

export async function reverseBenefitsTx(client, { order, user, reason = 'Cancelación' }) {
  if (order.beneficios_revertidos === true) return;
  const red = await client.query(`SELECT * FROM gmx.promociones_redenciones WHERE id_pedido=$1 AND estado='APLICADA' FOR UPDATE`, [order.id_pedido]);
  for (const r of red.rows) {
    await client.query(`UPDATE gmx.promociones_redenciones SET estado='REVERTIDA',fecha_reversion=NOW(),motivo_reversion=$2 WHERE row_id=$1`, [r.row_id, reason]);
    await client.query(`UPDATE gmx.promociones SET usos=GREATEST(0,COALESCE(usos,0)-1),actualizacion=NOW() WHERE id=$1`, [r.id_promocion]);
  }
  if (order.id_cliente) {
    const acct = await loyaltyAccountTx(client, order.id_cliente, true);
    let saldo = i(acct.puntos_disponibles);
    const moves = await client.query(`SELECT * FROM gmx.fidelidad_movimientos WHERE id_pedido=$1 AND tipo IN ('GENERACION','REDENCION') ORDER BY row_id DESC FOR UPDATE`, [order.id_pedido]);
    for (const m of moves.rows) {
      const reversal = -i(m.puntos);
      const before = saldo;
      saldo = saldo + reversal;
      await client.query(`INSERT INTO gmx.fidelidad_movimientos(
        id_movimiento,id_cliente,tipo,puntos,saldo_anterior,saldo_nuevo,id_pedido,referencia,motivo,id_admin,administrador,reversa_de)
        VALUES($1,$2,'REVERSA',$3,$4,$5,$6,$6,$7,$8,$9,$10)`, [
      uid('FID'), order.id_cliente, reversal, before, saldo, order.id_pedido, reason,
      user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local"), m.id_movimiento]
      );
    }
    await client.query(`UPDATE gmx.fidelidad_cuentas SET puntos_disponibles=$2,fecha_actualizacion=NOW() WHERE id_cliente=$1`, [order.id_cliente, saldo]);
  }
  await client.query(`UPDATE gmx.pedidos SET beneficios_revertidos=true WHERE id_pedido=$1`, [order.id_pedido]);
}

export async function getClientLoyalty(clientId) {
  if (!clientId) return { account: null, movements: [] };
  const a = await query(`SELECT * FROM gmx.fidelidad_cuentas WHERE id_cliente=$1`, [clientId]);
  const m = await query(`SELECT * FROM gmx.fidelidad_movimientos WHERE id_cliente=$1 ORDER BY fecha DESC,row_id DESC`, [clientId]);
  return { account: a.rows[0] || { id_cliente: clientId, puntos_disponibles: 0, nivel: 'BASE' }, movements: m.rows };
}

export async function adjustClientPoints({ clientId, points, reason, user }) {
  const { pool } = await import('../db.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acct = await loyaltyAccountTx(client, clientId, true);
    const delta = i(points);const before = i(acct.puntos_disponibles);const after = Math.max(0, before + delta);
    const effective = after - before;
    await client.query(`INSERT INTO gmx.fidelidad_movimientos(
      id_movimiento,id_cliente,tipo,puntos,saldo_anterior,saldo_nuevo,referencia,motivo,id_admin,administrador)
      VALUES($1,$2,'AJUSTE',$3,$4,$5,$6,$7,$8,$9)`, [
    uid('FID'), clientId, effective, before, after, uid('ADJ'), reason || 'Ajuste manual',
    user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
    );
    await client.query(`UPDATE gmx.fidelidad_cuentas SET puntos_disponibles=$2,fecha_actualizacion=NOW() WHERE id_cliente=$1`, [clientId, after]);
    await client.query('COMMIT');
    return getClientLoyalty(clientId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


export async function applyPartialReturnBenefitsTx(client, { order, returnGross, user, reference }) {
  if (!order?.id_cliente) return { refundTotal: round(returnGross), pointsRemoved: 0, pointsRestored: 0 };
  const subtotal = Math.max(0, n(order.subtotal));
  if (subtotal <= 0) return { refundTotal: round(returnGross), pointsRemoved: 0, pointsRestored: 0 };
  const ratio = Math.max(0, Math.min(1, n(returnGross) / subtotal));
  const promoShare = round(n(order.descuento_promocion) * ratio);
  const loyaltyShare = round(n(order.descuento_puntos) * ratio);
  const refundTotal = round(Math.max(0, n(returnGross) - promoShare - loyaltyShare));
  const pointsRemoved = Math.max(0, Math.floor(i(order.puntos_generados) * ratio));
  const pointsRestored = Math.max(0, Math.floor(i(order.puntos_redimidos) * ratio));
  if (pointsRemoved === 0 && pointsRestored === 0) return { refundTotal, pointsRemoved, pointsRestored };

  const acct = await loyaltyAccountTx(client, order.id_cliente, true);
  let saldo = i(acct.puntos_disponibles);
  if (pointsRemoved > 0) {
    const before = saldo;
    const effective = pointsRemoved;
    saldo -= effective;
    await client.query(`INSERT INTO gmx.fidelidad_movimientos(
      id_movimiento,id_cliente,tipo,puntos,saldo_anterior,saldo_nuevo,id_pedido,referencia,motivo,id_admin,administrador)
      VALUES($1,$2,'DEVOLUCION_RETIRO',$3,$4,$5,$6,$7,'Retiro proporcional por devolución',$8,$9)`, [
    uid('FID'), order.id_cliente, -effective, before, saldo, order.id_pedido, reference,
    user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
    );
  }
  if (pointsRestored > 0) {
    const before = saldo;saldo += pointsRestored;
    await client.query(`INSERT INTO gmx.fidelidad_movimientos(
      id_movimiento,id_cliente,tipo,puntos,saldo_anterior,saldo_nuevo,id_pedido,referencia,motivo,id_admin,administrador)
      VALUES($1,$2,'DEVOLUCION_RESTAURA',$3,$4,$5,$6,$7,'Restitución proporcional de puntos redimidos',$8,$9)`, [
    uid('FID'), order.id_cliente, pointsRestored, before, saldo, order.id_pedido, reference,
    user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
    );
  }
  await client.query(`UPDATE gmx.fidelidad_cuentas SET puntos_disponibles=$2,fecha_actualizacion=NOW() WHERE id_cliente=$1`, [order.id_cliente, saldo]);
  return { refundTotal, pointsRemoved, pointsRestored, promoShare, loyaltyShare };
}
