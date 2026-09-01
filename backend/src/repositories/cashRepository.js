import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';

// SHINY_CAJA_AUTH_001
function cashActor(user = {}) {
  const id = String(user?.id_admin || 'LOCAL').trim() || 'LOCAL';
  const name = String(user?.nombre || user?.email || brandText("GMX Local")).trim() || brandText("GMX Local");
  return { id, name };
}

function cashImpact(type, method, amount) {
  if (String(method).toUpperCase() !== 'EFECTIVO') return 0;
  return String(type).toUpperCase() === 'INGRESO' ? amount : -amount;
}

async function recalcSession(client, cashId) {
  const totals = await client.query(`
    SELECT
      COALESCE(SUM(CASE WHEN impacto_efectivo > 0 AND COALESCE(anulado,false)=false
                        THEN impacto_efectivo ELSE 0 END),0)::numeric AS ingresos,
      COALESCE(SUM(CASE WHEN impacto_efectivo < 0 AND COALESCE(anulado,false)=false
                        THEN ABS(impacto_efectivo) ELSE 0 END),0)::numeric AS egresos
    FROM gmx.caja_movimientos
    WHERE id_caja = $1
  `, [cashId]);

  const ingresos = Number(totals.rows[0].ingresos || 0);
  const egresos = Number(totals.rows[0].egresos || 0);

  const updated = await client.query(`
    UPDATE gmx.caja_sesiones
    SET ingresos_efectivo=$2,
        egresos_efectivo=$3,
        saldo_esperado=COALESCE(fondo_inicial,0)+$2-$3,
        fecha_actualizacion=NOW()
    WHERE id_caja=$1
    RETURNING *
  `, [cashId, ingresos, egresos]);

  return updated.rows[0];
}

export async function listCashSessions({ branchId = '', status = '', limit = 100 } = {}) {
  const values = [];const filters = [];
  if (branchId) {values.push(branchId);filters.push(`id_sucursal=$${values.length}`);}
  if (status) {values.push(status);filters.push(`estado=$${values.length}`);}
  values.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  return query(`
    SELECT * FROM gmx.caja_sesiones
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY fecha_apertura DESC NULLS LAST,row_id DESC
    LIMIT $${values.length}
  `, values);
}

export async function getOpenCash(branchId) {
  const r = await query(`
    SELECT * FROM gmx.caja_sesiones
    WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
    ORDER BY fecha_apertura DESC,row_id DESC LIMIT 1
  `, [branchId]);
  return r.rows[0] || null;
}

export async function listCashMovements({ cashId = '', branchId = '', limit = 300 } = {}) {
  const values = [];const filters = [];
  if (cashId) {values.push(cashId);filters.push(`id_caja=$${values.length}`);}
  if (branchId) {values.push(branchId);filters.push(`id_sucursal=$${values.length}`);}
  values.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
  return query(`
    SELECT * FROM gmx.caja_movimientos
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY fecha DESC NULLS LAST,row_id DESC
    LIMIT $${values.length}
  `, values);
}

export async function openCash({ branchId, openingFund = 0, notes = '' }, user = {}) {
  const actor = cashActor(user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const branch = await client.query(`
      SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales
      WHERE id_sucursal=$1 AND COALESCE(activa,true)=true
      ORDER BY row_id LIMIT 1 FOR UPDATE
    `, [branchId]);
    if (!branch.rowCount) throw new Error('BRANCH_NOT_FOUND');

    const existing = await client.query(`
      SELECT id_caja FROM gmx.caja_sesiones
      WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
      LIMIT 1 FOR UPDATE
    `, [branchId]);
    if (existing.rowCount) throw new Error('CASH_ALREADY_OPEN');

    const amount = Number(openingFund);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('INVALID_OPENING_FUND');

    const id = `CAJA-LOCAL-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const r = await client.query(`
      INSERT INTO gmx.caja_sesiones(
        id_caja,id_sucursal,sucursal,fecha_apertura,fondo_inicial,
        ingresos_efectivo,egresos_efectivo,saldo_esperado,
        estado,id_admin_apertura,admin_apertura,notas_apertura,fecha_actualizacion
      ) VALUES($1,$2,$3,NOW(),$4,0,0,$4,'ABIERTA',$5,$6,$7,NOW())
      RETURNING *
    `, [id, branchId, branch.rows[0].nombre_sucursal, amount, actor.id, actor.name, notes || null]);
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function addCashMovement({
  branchId, type, category = 'MANUAL', paymentMethod = 'EFECTIVO',
  amount, reference = '', description = '', originModule = 'CAJA_LOCAL', originId = ''
}, user = {}) {
  const actor = cashActor(user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query(`
      SELECT * FROM gmx.caja_sesiones
      WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
      ORDER BY fecha_apertura DESC,row_id DESC LIMIT 1 FOR UPDATE
    `, [branchId]);
    if (!session.rowCount) throw new Error('NO_OPEN_CASH');

    const normalizedType = String(type || '').toUpperCase();
    if (!['INGRESO', 'EGRESO'].includes(normalizedType)) throw new Error('INVALID_MOVEMENT_TYPE');

    // SHINY_CAJA_FIX_002
    // Reglas semánticas del catálogo de motivos de Caja.
    // Frontend y backend deben aceptar exactamente las mismas combinaciones.
    const normalizedCategory = String(category || 'MANUAL').toUpperCase();
    const allowedCategories = {
      INGRESO: new Set(['DEPOSITO', 'MANUAL', 'AJUSTE']),
      EGRESO: new Set(['RETIRO', 'MANUAL', 'AJUSTE'])
    };
    if (!allowedCategories[normalizedType].has(normalizedCategory)) {
      throw new Error('INVALID_MOVEMENT_CATEGORY');
    }

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('INVALID_AMOUNT');
    const impact = cashImpact(normalizedType, paymentMethod, value);

    // SHINY_CAJA_FIX_003
    // Un egreso manual en EFECTIVO no puede dejar la caja por debajo de cero.
    // Antes de validar, recalculamos la sesion dentro de la misma transaccion
    // para trabajar contra el saldo mas reciente.
    const freshSession = await recalcSession(client, session.rows[0].id_caja);
    const currentExpected = Number(freshSession?.saldo_esperado || 0);
    if (normalizedType === 'EGRESO' && impact < 0) {
      const resultingExpected = Number((currentExpected - Math.abs(impact)).toFixed(4));
      if (resultingExpected < 0) {
        const err = new Error('INSUFFICIENT_CASH_BALANCE');
        err.currentExpected = currentExpected;
        err.requested = value;
        err.resultingExpected = resultingExpected;
        throw err;
      }
    }

    const id = `CAJMOV-LOCAL-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

    const r = await client.query(`
      INSERT INTO gmx.caja_movimientos(
        id_movimiento,id_caja,fecha,id_sucursal,sucursal,tipo,categoria,
        metodo_pago,importe,impacto_efectivo,referencia,descripcion,
        origen_modulo,id_origen,id_admin,administrador,anulado
      ) VALUES($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)
      RETURNING *
    `, [
    id, session.rows[0].id_caja, branchId, session.rows[0].sucursal,
    normalizedType, normalizedCategory,
    String(paymentMethod || 'EFECTIVO').toUpperCase(), value, impact,
    reference || null, description || null, originModule || 'CAJA_LOCAL', originId || null,
    actor.id, actor.name]
    );
    await recalcSession(client, session.rows[0].id_caja);
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function closeCash({ branchId, countedCash, notes = '' }, user = {}) {
  const actor = cashActor(user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query(`
      SELECT * FROM gmx.caja_sesiones
      WHERE id_sucursal=$1 AND UPPER(COALESCE(estado,''))='ABIERTA'
      ORDER BY fecha_apertura DESC,row_id DESC LIMIT 1 FOR UPDATE
    `, [branchId]);
    if (!session.rowCount) throw new Error('NO_OPEN_CASH');

    const fresh = await recalcSession(client, session.rows[0].id_caja);
    const counted = Number(countedCash);
    if (!Number.isFinite(counted) || counted < 0) throw new Error('INVALID_COUNTED_CASH');
    const difference = Number((counted - Number(fresh.saldo_esperado || 0)).toFixed(4));

    const r = await client.query(`
      UPDATE gmx.caja_sesiones
      SET fecha_cierre=NOW(),efectivo_contado=$2::text,diferencia=$3,
          estado='CERRADA',id_admin_cierre=$4,admin_cierre=$5,
          notas_cierre=$6,fecha_actualizacion=NOW()
      WHERE id_caja=$1 RETURNING *
    `, [fresh.id_caja, counted, difference, actor.id, actor.name, notes || null]);
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
