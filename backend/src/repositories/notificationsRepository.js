import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';

const n = (v) => Number(v || 0);
const txt = (v) => String(v ?? '').trim();
const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

function scopeSql(scope, column = 'id_sucursal', start = 1) {
  if (!scope || scope.all || !scope.allowed?.length) return { sql: '', params: [] };
  return { sql: ` AND ${column}=ANY($${start}::text[])`, params: [scope.allowed] };
}

export async function notificationSummary(scope) {
  const vals = [],where = [];
  if (scope && !scope.all && scope.allowed?.length) {
    vals.push(scope.allowed);
    where.push(`(id_sucursal IS NULL OR id_sucursal=ANY($${vals.length}::text[]))`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await query(`SELECT
    COUNT(*) FILTER(WHERE COALESCE(resuelta,false)=false)::bigint abiertas,
    COUNT(*) FILTER(WHERE COALESCE(resuelta,false)=false AND COALESCE(leida,false)=false)::bigint no_leidas,
    COUNT(*) FILTER(WHERE COALESCE(resuelta,false)=false AND UPPER(COALESCE(prioridad,''))='CRITICA')::bigint criticas,
    COUNT(*) FILTER(WHERE COALESCE(resuelta,false)=false AND UPPER(COALESCE(prioridad,''))='ALTA')::bigint altas,
    COUNT(*) FILTER(WHERE COALESCE(resuelta,false)=false AND UPPER(COALESCE(prioridad,''))='MEDIA')::bigint medias,
    COUNT(*) FILTER(WHERE COALESCE(resuelta,false)=true)::bigint resueltas
    FROM gmx.notificaciones_admin ${w}`, vals);
  return r.rows[0];
}

export async function listNotifications({
  status = 'OPEN', priority = '', type = '', module = '', branchId = '', search = '', limit = 500
} = {}, scope) {
  const vals = [],f = [];
  const add = (value, sql) => {vals.push(value);f.push(sql.replace('?', `$${vals.length}`));};

  if (status === 'OPEN') f.push(`COALESCE(resuelta,false)=false`);else
  if (status === 'RESOLVED') f.push(`COALESCE(resuelta,false)=true`);else
  if (status === 'UNREAD') f.push(`COALESCE(resuelta,false)=false AND COALESCE(leida,false)=false`);

  if (priority) add(priority.toUpperCase(), `UPPER(COALESCE(prioridad,''))=?`);
  if (type) add(type.toUpperCase(), `UPPER(COALESCE(tipo,''))=?`);
  if (module) add(module.toUpperCase(), `UPPER(COALESCE(modulo,''))=?`);
  if (branchId) add(branchId, `id_sucursal=?`);
  if (search) {
    vals.push(`%${search}%`);
    f.push(`(COALESCE(titulo,'') ILIKE $${vals.length} OR COALESCE(mensaje,'') ILIKE $${vals.length}
      OR COALESCE(referencia,'') ILIKE $${vals.length} OR COALESCE(tipo,'') ILIKE $${vals.length})`);
  }
  if (scope && !scope.all && scope.allowed?.length) {
    vals.push(scope.allowed);
    f.push(`(id_sucursal IS NULL OR id_sucursal=ANY($${vals.length}::text[]))`);
  }
  vals.push(Math.min(Math.max(Number(limit) || 500, 1), 1500));

  return query(`SELECT * FROM gmx.notificaciones_admin
    ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY COALESCE(resuelta,false),
      CASE UPPER(COALESCE(prioridad,'')) WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
      fecha DESC NULLS LAST,row_id DESC
    LIMIT $${vals.length}`, vals);
}

export async function markNotification(rowId, read = true, user, scope) {
  const allowed =
  scope && !scope.all ?
  Array.isArray(scope.allowed) ? scope.allowed.map(String) : [] :
  null;

  const restricted = Array.isArray(allowed);

  const r = await query(`UPDATE gmx.notificaciones_admin
    SET leida=$2,
        leida_por=CASE WHEN $2 THEN $3 ELSE NULL END,
        fecha_lectura=CASE WHEN $2 THEN NOW() ELSE NULL END,
        actualizacion=NOW()
    WHERE row_id=$1
      AND (
        $4::boolean=false
        OR id_sucursal IS NULL
        OR id_sucursal=ANY($5::text[])
      )
    RETURNING *`, [
  rowId,
  !!read,
  user?.email || null,
  restricted,
  allowed || []]
  );

  if (!r.rowCount) {
    const existing = await query(`SELECT row_id,id_sucursal
      FROM gmx.notificaciones_admin
      WHERE row_id=$1
      LIMIT 1`, [rowId]);

    if (!existing.rowCount) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    const branchId = existing.rows[0].id_sucursal;

    if (
    restricted &&
    branchId &&
    !allowed.includes(String(branchId)))
    {
      const e = new Error('BRANCH_FORBIDDEN');
      e.statusCode = 403;
      e.branchId = String(branchId);
      e.allowedBranches = allowed;
      throw e;
    }

    throw new Error('NOTIFICATION_NOT_FOUND');
  }

  return r.rows[0];
}
export async function resolveNotification(
rowId,
{ resolved = true, note = '' } = {},
user,
scope)
{
  const allowed =
  scope && !scope.all ?
  Array.isArray(scope.allowed) ? scope.allowed.map(String) : [] :
  null;

  const restricted = Array.isArray(allowed);

  const r = await query(`UPDATE gmx.notificaciones_admin SET
    resuelta=$2,
    estado=CASE WHEN $2 THEN 'RESUELTA' ELSE 'ABIERTA' END,
    fecha_resolucion=CASE WHEN $2 THEN NOW() ELSE NULL END,
    resuelta_por=CASE WHEN $2 THEN $3 ELSE NULL END,
    nota_resolucion=CASE WHEN $2 THEN NULLIF($4,'') ELSE NULL END,
    leida=CASE WHEN $2 THEN true ELSE leida END,
    actualizacion=NOW()
    WHERE row_id=$1
      AND (
        $5::boolean=false
        OR id_sucursal IS NULL
        OR id_sucursal=ANY($6::text[])
      )
    RETURNING *`, [
  rowId,
  !!resolved,
  user?.email || brandText("GMX Local"),
  txt(note),
  restricted,
  allowed || []]
  );

  if (!r.rowCount) {
    const existing = await query(`SELECT row_id,id_sucursal
      FROM gmx.notificaciones_admin
      WHERE row_id=$1
      LIMIT 1`, [rowId]);

    if (!existing.rowCount) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    const branchId = existing.rows[0].id_sucursal;

    if (
    restricted &&
    branchId &&
    !allowed.includes(String(branchId)))
    {
      const e = new Error('BRANCH_FORBIDDEN');
      e.statusCode = 403;
      e.branchId = String(branchId);
      e.allowedBranches = allowed;
      throw e;
    }

    throw new Error('NOTIFICATION_NOT_FOUND');
  }

  await query(`INSERT INTO gmx.auditoria(
      fecha,
      modulo,
      accion,
      referencia,
      detalle,
      usuario
    )
    VALUES(
      NOW(),
      'NOTIFICACIONES',
      $1,
      $2,
      $3,
      $4
    )`, [
  resolved ? 'RESOLVER' : 'REABRIR',
  r.rows[0].id,
  r.rows[0].titulo,
  user?.email || brandText("GMX Local")]
  );

  return r.rows[0];
}
async function config(client) {
  const r = await client.query(`SELECT parametro,valor FROM gmx.configuracion WHERE parametro LIKE 'alerts.%'`);
  return Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
}
const enabled = (m, key, def = true) => String(m[key] ?? String(def)).toLowerCase() === 'true';
const number = (m, key, def) => Number.isFinite(Number(m[key])) ? Number(m[key]) : def;

async function upsertAlert(client, {
  key, type, title, message, module, priority = 'MEDIA', branchId = null, branchName = null, reference = null, route = null, metadata = {}
}) {
  const existing = await client.query(`SELECT * FROM gmx.notificaciones_admin
    WHERE clave=$1 AND COALESCE(resuelta,false)=false
    ORDER BY row_id DESC LIMIT 1 FOR UPDATE`, [key]);

  if (existing.rowCount) {
    await client.query(`UPDATE gmx.notificaciones_admin SET
      titulo=$2,mensaje=$3,prioridad=$4,id_sucursal=$5,sucursal=$6,referencia=$7,ruta=$8,
      metadata=$9::jsonb,ultima_deteccion=NOW(),actualizacion=NOW()
      WHERE row_id=$1`, [
    existing.rows[0].row_id, title, message, priority, branchId, branchName, reference, route, JSON.stringify(metadata)]
    );
    return { created: false, rowId: existing.rows[0].row_id };
  }

  const r = await client.query(`INSERT INTO gmx.notificaciones_admin(
    id,fecha,tipo,titulo,mensaje,modulo,prioridad,leida,actualizacion,clave,
    id_sucursal,sucursal,referencia,ruta,estado,resuelta,primera_deteccion,ultima_deteccion,metadata)
    VALUES($1,NOW(),$2,$3,$4,$5,$6,false,NOW(),$7,$8,$9,$10,$11,'ABIERTA',false,NOW(),NOW(),$12::jsonb)
    RETURNING row_id`, [
  uid('ALERTA'), type, title, message, module, priority, key, branchId, branchName, reference, route, JSON.stringify(metadata)]
  );
  return { created: true, rowId: r.rows[0].row_id };
}

async function closeMissing(client, type, activeKeys) {
  if (activeKeys.length) {
    await client.query(`UPDATE gmx.notificaciones_admin SET
      resuelta=true,estado='RESUELTA_AUTO',fecha_resolucion=NOW(),resuelta_por='SISTEMA',
      nota_resolucion='La condición dejó de estar activa.',actualizacion=NOW()
      WHERE tipo=$1 AND COALESCE(resuelta,false)=false AND NOT (clave=ANY($2::text[]))`, [type, activeKeys]);
  } else {
    await client.query(`UPDATE gmx.notificaciones_admin SET
      resuelta=true,estado='RESUELTA_AUTO',fecha_resolucion=NOW(),resuelta_por='SISTEMA',
      nota_resolucion='La condición dejó de estar activa.',actualizacion=NOW()
      WHERE tipo=$1 AND COALESCE(resuelta,false)=false`, [type]);
  }
}

export async function generateAlerts(user, { scope = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await config(client);
    const stats = { created: 0, updated: 0, byType: {} };
    const touch = async (alert) => {
      const x = await upsertAlert(client, alert);
      stats[x.created ? 'created' : 'updated']++;
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
    };

    // 1) Producto general: stock bajo.
    if (enabled(m, 'alerts.low_stock_enabled', true)) {
      const threshold = Math.max(0, Math.trunc(number(m, 'alerts.low_stock_threshold', 5)));
      const params = [threshold],branch = scopeSql(scope, 'i.id_sucursal', 2);params.push(...branch.params);
      const r = await client.query(`SELECT i.id_sucursal,i.sucursal,i.id_producto,i.sku,i.producto,
          COALESCE(i.stock,0)::numeric stock,COALESCE(i.stock_minimo,0)::numeric stock_minimo
        FROM gmx.inventario_sucursales i
        WHERE COALESCE(i.stock,0)<=GREATEST(COALESCE(i.stock_minimo,0),$1) ${branch.sql}
        ORDER BY i.sucursal,i.producto`, params);
      const keys = [];
      for (const x of r.rows) {
        const key = `STOCK:${x.id_sucursal}:${x.id_producto}`;keys.push(key);
        await touch({ key, type: 'STOCK_BAJO', title: `Stock bajo · ${x.producto}`,
          message: `${x.sucursal} · ${x.sku || x.id_producto} · existencia ${x.stock}.`,
          module: 'INVENTARIO', priority: Number(x.stock) <= 0 ? 'ALTA' : 'MEDIA',
          branchId: x.id_sucursal, branchName: x.sucursal, reference: x.id_producto,
          route: '/admin/inventario', metadata: { stock: x.stock, stock_minimo: x.stock_minimo, sku: x.sku } });
      }
      await closeMissing(client, 'STOCK_BAJO', keys);
    }

    // 2) TCG: stock bajo usando umbral global.
    if (enabled(m, 'alerts.tcg_low_stock_enabled', true)) {
      const threshold = Math.max(0, Math.trunc(number(m, 'alerts.tcg_low_stock_threshold', 2)));
      const params = [threshold],branch = scopeSql(scope, 's.id_sucursal', 2);params.push(...branch.params);
      const r = await client.query(`SELECT s.id_sucursal,s.sucursal,s.id_inventario,s.sku,
          COALESCE(s.stock,0)-COALESCE(s.stock_reservado,0) disponible,c.nombre carta,
          COALESCE(i.rareza,c.rareza) rareza
        FROM gmx.tcg_inventario_sucursales s
        JOIN gmx.tcg_inventario i ON i.id_inventario=s.id_inventario
        LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
        WHERE (COALESCE(s.stock,0)-COALESCE(s.stock_reservado,0))<=$1 ${branch.sql}
          AND UPPER(COALESCE(i.estado_venta,'DISPONIBLE'))='DISPONIBLE'
        ORDER BY s.sucursal,c.nombre`, params);
      const keys = [];
      for (const x of r.rows) {
        const key = `TCGSTOCK:${x.id_sucursal}:${x.id_inventario}`;keys.push(key);
        await touch({ key, type: 'TCG_STOCK_BAJO', title: `TCG bajo · ${x.carta}${x.rareza ? ` (${x.rareza})` : ''}`,
          message: `${x.sucursal} · ${x.sku || x.id_inventario} · disponibles ${x.disponible}.`,
          module: 'TCG', priority: Number(x.disponible) <= 0 ? 'ALTA' : 'MEDIA', branchId: x.id_sucursal,
          branchName: x.sucursal, reference: x.id_inventario, route: '/admin/tcg-operacion',
          metadata: { disponible: x.disponible, sku: x.sku, rareza: x.rareza } });
      }
      await closeMissing(client, 'TCG_STOCK_BAJO', keys);
    }

    // 3) CxP vencidas y próximas a vencer.
    if (enabled(m, 'alerts.payables_enabled', true)) {
      const days = Math.max(0, Math.trunc(number(m, 'alerts.payables_due_days', 5)));
      const params = [days],branch = scopeSql(scope, 'c.id_sucursal', 2);params.push(...branch.params);
      const r = await client.query(`SELECT c.id,c.id_sucursal,c.sucursal,c.proveedor,c.documento,c.vencimiento,c.saldo,c.estado
        FROM gmx.cuentas_por_pagar c
        WHERE COALESCE(c.saldo,0)>0 AND UPPER(COALESCE(c.estado,'')) NOT IN ('PAGADA','CANCELADA')
          AND c.vencimiento IS NOT NULL
          AND c.vencimiento::date<=CURRENT_DATE+$1::int ${branch.sql}
        ORDER BY c.vencimiento,c.proveedor`, params);
      const overdueKeys = [],dueKeys = [];
      for (const x of r.rows) {
        const overdue = new Date(`${x.vencimiento}T00:00:00`) < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
        const type = overdue ? 'CXP_VENCIDA' : 'CXP_POR_VENCER';
        const key = `${type}:${x.id}`;(overdue ? overdueKeys : dueKeys).push(key);
        await touch({ key, type, title: `${overdue ? 'CxP vencida' : 'CxP por vencer'} · ${x.proveedor}`,
          message: `${x.documento || x.id} · vence ${String(x.vencimiento).slice(0, 10)} · saldo $${Number(x.saldo || 0).toFixed(2)}.`,
          module: 'COMERCIAL', priority: overdue ? 'CRITICA' : 'ALTA', branchId: x.id_sucursal,
          branchName: x.sucursal, reference: x.id, route: '/admin/comercial?tab=payables',
          metadata: { saldo: x.saldo, vencimiento: x.vencimiento, proveedor: x.proveedor } });
      }
      await closeMissing(client, 'CXP_VENCIDA', overdueKeys);
      await closeMissing(client, 'CXP_POR_VENCER', dueKeys);
    }

    // 4) Compras sin factura / referencia fiscal.
    if (enabled(m, 'alerts.purchase_invoice_enabled', true)) {
      const age = Math.max(0, Math.trunc(number(m, 'alerts.purchase_invoice_days', 2)));
      const params = [age],branch = scopeSql(scope, 'c.id_sucursal_recepcion', 2);params.push(...branch.params);
      const r = await client.query(`SELECT c.id_compra,c.fecha,c.id_sucursal_recepcion,c.sucursal_recepcion,c.proveedor,
          c.tipo_documento,c.referencia_documento,c.estado,c.total
        FROM gmx.compras c
        WHERE UPPER(COALESCE(c.estado,''))<>'CANCELADA'
          AND c.fecha::date<=CURRENT_DATE-$1::int
          AND (
            NULLIF(TRIM(COALESCE(c.referencia_documento,'')),'') IS NULL
            OR UPPER(COALESCE(c.tipo_documento,'')) IN ('','PENDIENTE','SIN_FACTURA')
          ) ${branch.sql}
        ORDER BY c.fecha`, params);
      const keys = [];
      for (const x of r.rows) {
        const key = `FACTURA:${x.id_compra}`;keys.push(key);
        await touch({ key, type: 'COMPRA_SIN_FACTURA', title: `Compra pendiente de factura · ${x.proveedor}`,
          message: `${x.id_compra} · ${String(x.fecha).slice(0, 10)} · total $${Number(x.total || 0).toFixed(2)}.`,
          module: 'COMPRAS', priority: 'MEDIA', branchId: x.id_sucursal_recepcion,
          branchName: x.sucursal_recepcion, reference: x.id_compra, route: '/admin/compras',
          metadata: { total: x.total, tipo_documento: x.tipo_documento } });
      }
      await closeMissing(client, 'COMPRA_SIN_FACTURA', keys);
    }

    // 5) Diferencias de caja cerradas.
    if (enabled(m, 'alerts.cash_difference_enabled', true)) {
      const amount = Math.max(0, number(m, 'alerts.cash_difference_threshold', 1));
      const params = [amount],branch = scopeSql(scope, 'c.id_sucursal', 2);params.push(...branch.params);
      const r = await client.query(`SELECT c.id_caja,c.id_sucursal,c.sucursal,c.fecha_cierre,c.saldo_esperado,
          c.efectivo_contado,c.diferencia
        FROM gmx.caja_sesiones c
        WHERE UPPER(COALESCE(c.estado,''))='CERRADA'
          AND ABS(COALESCE(c.diferencia,0))>$1
          AND c.fecha_cierre>=NOW()-INTERVAL '30 days' ${branch.sql}
        ORDER BY c.fecha_cierre DESC`, params);
      const keys = [];
      for (const x of r.rows) {
        const key = `CAJADIF:${x.id_caja}`;keys.push(key);
        const diff = Number(x.diferencia || 0);
        await touch({ key, type: 'DIFERENCIA_CAJA', title: `Diferencia de caja · ${x.sucursal}`,
          message: `Caja ${x.id_caja} · diferencia ${diff.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}.`,
          module: 'CAJA', priority: Math.abs(diff) >= 100 ? 'ALTA' : 'MEDIA', branchId: x.id_sucursal,
          branchName: x.sucursal, reference: x.id_caja, route: '/admin/caja',
          metadata: { diferencia: diff, saldo_esperado: x.saldo_esperado, efectivo_contado: x.efectivo_contado } });
      }
      await closeMissing(client, 'DIFERENCIA_CAJA', keys);
    }

    // 6) Errores de sincronización TCG.
    if (enabled(m, 'alerts.tcg_sync_enabled', true)) {
      const r = await client.query(`SELECT game_code,provider_name,status,last_error,
          GREATEST(last_sets_sync_at,last_cards_sync_at,last_prices_sync_at) last_sync
        FROM gmx.tcg_sync_providers
        WHERE NULLIF(TRIM(COALESCE(last_error,'')),'') IS NOT NULL
           OR UPPER(COALESCE(status,'')) IN ('ERROR','FAILED','DEGRADED')
        ORDER BY game_code`);
      const keys = [];
      for (const x of r.rows) {
        const key = `TCGSYNC:${x.game_code}`;keys.push(key);
        await touch({ key, type: 'TCG_SYNC_ERROR', title: `Sincronización TCG · ${x.game_code}`,
          message: `${x.provider_name || x.game_code} · ${x.last_error || x.status}.`,
          module: 'TCG', priority: 'ALTA', reference: x.game_code, route: '/admin/tcg',
          metadata: { provider: x.provider_name, status: x.status, last_error: x.last_error, last_sync: x.last_sync } });
      }
      await closeMissing(client, 'TCG_SYNC_ERROR', keys);
    }

    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'NOTIFICACIONES','GENERAR','AUTOMATICO',$1,$2)`, [
    `${stats.created} nuevas; ${stats.updated} actualizadas`, user?.email || 'SISTEMA']
    );

    await client.query('COMMIT');
    return stats;
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {client.release();}
}

export async function getAlertSettings() {
  const r = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'alerts.%' ORDER BY parametro`);
  return Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
}

export async function saveAlertSettings(input, user) {
  const client = await pool.connect();

  const booleanKeys = new Set([
  'alerts.low_stock_enabled',
  'alerts.tcg_low_stock_enabled',
  'alerts.payables_enabled',
  'alerts.purchase_invoice_enabled',
  'alerts.cash_difference_enabled',
  'alerts.tcg_sync_enabled',
  'alerts.auto_generate_enabled']
  );

  const integerRules = new Map([
  ['alerts.low_stock_threshold', { min: 0, max: 100000 }],
  ['alerts.tcg_low_stock_threshold', { min: 0, max: 100000 }],
  ['alerts.payables_due_days', { min: 0, max: 100000 }],
  ['alerts.purchase_invoice_days', { min: 0, max: 100000 }],
  ['alerts.auto_generate_minutes', { min: 5, max: 1440 }]]
  );

  const decimalRules = new Map([
  ['alerts.cash_difference_threshold', { min: 0, max: 100000000 }]]
  );

  const allowed = new Set([
  ...booleanKeys,
  ...integerRules.keys(),
  ...decimalRules.keys()]
  );

  const payload = input && typeof input === 'object' && !Array.isArray(input) ?
  input :
  {};

  function validationError(key, message) {
    const error = new Error(`INVALID_ALERT_SETTING:${key}:${message}`);
    error.code = 'INVALID_ALERT_SETTING';
    error.setting = key;
    return error;
  }

  function normalizeBoolean(key, value) {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    const normalized = String(value ?? '').trim().toLowerCase();

    if (normalized === 'true' || normalized === 'false') {
      return normalized;
    }

    throw validationError(key, 'EXPECTED_BOOLEAN');
  }

  function normalizeInteger(key, value, rule) {
    const raw = String(value ?? '').trim();

    if (!/^-?\d+$/.test(raw)) {
      throw validationError(key, 'EXPECTED_INTEGER');
    }

    const number = Number(raw);

    if (!Number.isSafeInteger(number)) {
      throw validationError(key, 'INTEGER_OUT_OF_RANGE');
    }

    if (number < rule.min || number > rule.max) {
      throw validationError(
        key,
        `EXPECTED_RANGE_${rule.min}_${rule.max}`
      );
    }

    return String(number);
  }

  function normalizeDecimal(key, value, rule) {
    const raw = String(value ?? '').trim();

    if (raw === '') {
      throw validationError(key, 'EXPECTED_NUMBER');
    }

    const number = Number(raw);

    if (!Number.isFinite(number)) {
      throw validationError(key, 'EXPECTED_NUMBER');
    }

    if (number < rule.min || number > rule.max) {
      throw validationError(
        key,
        `EXPECTED_RANGE_${rule.min}_${rule.max}`
      );
    }

    return String(number);
  }

  const normalized = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!allowed.has(key)) {
      continue;
    }

    if (booleanKeys.has(key)) {
      normalized[key] = normalizeBoolean(key, value);
      continue;
    }

    if (integerRules.has(key)) {
      normalized[key] = normalizeInteger(
        key,
        value,
        integerRules.get(key)
      );
      continue;
    }

    if (decimalRules.has(key)) {
      normalized[key] = normalizeDecimal(
        key,
        value,
        decimalRules.get(key)
      );
    }
  }

  try {
    await client.query('BEGIN');

    for (const [key, value] of Object.entries(normalized)) {
      await client.query(`
        INSERT INTO gmx.configuracion(
          parametro,
          valor,
          actualizacion
        )
        VALUES($1,$2,NOW())
        ON CONFLICT(parametro)
        DO UPDATE SET
          valor=EXCLUDED.valor,
          actualizacion=NOW()
      `, [key, value]);
    }

    await client.query(`
      INSERT INTO gmx.auditoria(
        fecha,
        modulo,
        accion,
        referencia,
        detalle,
        usuario
      )
      VALUES(
        NOW(),
        'NOTIFICACIONES',
        'CONFIGURAR',
        'ALERTAS',
        $1,
        $2
      )
    `, [
    'Configuracion de alertas actualizada',
    user?.email || brandText("GMX Local")]
    );

    await client.query('COMMIT');

    return getAlertSettings();
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}
