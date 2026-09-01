import { brandText } from "./config/brand.js";import { pool, query } from './db.js';

const txt = (v) => String(v ?? '').trim();
const num = (v) => Number(v || 0);
const isoDate = (value) => {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const parseBanxicoDate = (value) => {
  const m = txt(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : isoDate(value);
};

async function configMap(client) {
  const r = await client.query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'finance.fx.%'`);
  return Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
}
const bool = (v, def = false) => {
  if (v == null || v === '') return def;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(String(v).toLowerCase());
};

async function latestRate(client, { source = '', operational = null } = {}) {
  const values = ['USD', 'MXN'];const filters = [
  `base_currency=$1`, `quote_currency=$2`];

  if (source) {values.push(source);filters.push(`source=$${values.length}`);}
  if (operational !== null) {values.push(!!operational);filters.push(`is_operational=$${values.length}`);}
  const r = await client.query(`SELECT * FROM gmx.fx_rates
    WHERE ${filters.join(' AND ')}
    ORDER BY rate_date DESC,fetched_at DESC LIMIT 1`, values);
  return r.rows[0] || null;
}

async function latestRateForDate(client, date, { operational = null } = {}) {
  const values = ['USD', 'MXN', date];const filters = [
  `base_currency=$1`, `quote_currency=$2`, `rate_date=$3`];

  if (operational !== null) {values.push(!!operational);filters.push(`is_operational=$${values.length}`);}
  const r = await client.query(`SELECT * FROM gmx.fx_rates
    WHERE ${filters.join(' AND ')}
    ORDER BY is_operational DESC,fetched_at DESC LIMIT 1`, values);
  return r.rows[0] || null;
}

function ageDays(rateDate) {
  if (!rateDate) return 9999;
  const a = new Date(`${rateDate}T00:00:00Z`).getTime();
  const b = new Date(`${isoDate()}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

export async function financeFxConfig() {
  const r = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'finance.fx.%' ORDER BY parametro`);
  const m = Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
  return {
    banxicoEnabled: bool(m['finance.fx.banxico_enabled'], true),
    banxicoTokenConfigured: !!txt(m['finance.fx.banxico_token']),
    tijuanaEnabled: bool(m['finance.fx.tijuana_enabled'], true),
    priority: txt(m['finance.fx.priority']) || 'TIJUANA_THEN_BANXICO',
    maxAgeDays: Math.max(0, Math.min(10, Math.trunc(num(m['finance.fx.max_age_days'] || 3)))),
    blockIfStale: bool(m['finance.fx.block_if_stale'], true)
  };
}

export async function saveFinanceFxConfig(input, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await configMap(client);
    const entries = [
    ['finance.fx.banxico_enabled', String(input.banxicoEnabled !== false)],
    ['finance.fx.tijuana_enabled', String(input.tijuanaEnabled !== false)],
    ['finance.fx.priority', txt(input.priority) || 'TIJUANA_THEN_BANXICO'],
    ['finance.fx.max_age_days', String(Math.max(0, Math.min(10, Math.trunc(num(input.maxAgeDays ?? 3)))))],
    ['finance.fx.block_if_stale', String(input.blockIfStale !== false)]];

    const token = txt(input.banxicoToken);
    if (token) {
      if (token.length < 20) throw new Error('BANXICO_TOKEN_INVALID');
      entries.push(['finance.fx.banxico_token', token]);
    } else if (input.clearBanxicoToken === true) {
      entries.push(['finance.fx.banxico_token', '']);
    }
    for (const [key, value] of entries) {
      await client.query(`INSERT INTO gmx.configuracion(parametro,valor)
        VALUES($1,$2) ON CONFLICT(parametro) DO UPDATE SET valor=EXCLUDED.valor`, [key, value]);
    }
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'FINANZAS','ACTUALIZAR','TIPO_CAMBIO',$1,$2)`, [
    `Fuente Banxico ${input.banxicoEnabled !== false ? 'activa' : 'inactiva'}; Tijuana ${input.tijuanaEnabled !== false ? 'activo' : 'inactivo'}; prioridad ${txt(input.priority) || 'TIJUANA_THEN_BANXICO'}`,
    user?.email || brandText("GMX Local")]
    );
    await client.query('COMMIT');
    return financeFxConfig();
  } catch (e) {
    await client.query('ROLLBACK');throw e;
  } finally {client.release();}
}


export async function saveBanxicoToken({ token = '', clear = false } = {}, user) {
  const value = txt(token);
  if (!clear) {
    if (!value) throw new Error('BANXICO_TOKEN_REQUIRED');
    if (!/^[A-Za-z0-9_-]{40,200}$/.test(value)) throw new Error('BANXICO_TOKEN_INVALID');
  }
  const stored = clear ? '' : value;
  await query(`INSERT INTO gmx.configuracion(parametro,valor)
    VALUES('finance.fx.banxico_token',$1)
    ON CONFLICT(parametro) DO UPDATE SET valor=EXCLUDED.valor`, [stored]);
  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'FINANZAS',$1,'BANXICO_TOKEN',$2,$3)`, [
  clear ? 'ELIMINAR_TOKEN' : 'GUARDAR_TOKEN',
  clear ? 'Token SIE eliminado' : 'Token SIE guardado/reemplazado',
  user?.email || brandText("GMX Local")]
  );
  return { configured: !clear };
}

export async function fetchBanxicoUsdMxn() {
  const client = await pool.connect();
  try {
    const cfg = await configMap(client);
    if (!bool(cfg['finance.fx.banxico_enabled'], true)) throw new Error('BANXICO_DISABLED');
    const token = txt(cfg['finance.fx.banxico_token']) || txt(process.env.BANXICO_SIE_TOKEN);
    if (!token) throw new Error('BANXICO_TOKEN_REQUIRED');

    const response = await fetch(
      'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno?mediaType=json',
      { headers: { 'Bmx-Token': token, 'Accept': 'application/json' } }
    );
    if (!response.ok) throw new Error(`BANXICO_HTTP_${response.status}`);
    const body = await response.json();
    const datum = body?.bmx?.series?.[0]?.datos?.[0];
    const rate = Number(String(datum?.dato || '').replace(',', ''));
    const rateDate = parseBanxicoDate(datum?.fecha);
    if (!Number.isFinite(rate) || rate <= 0 || !rateDate) throw new Error('BANXICO_INVALID_RATE');

    const saved = await client.query(`
      INSERT INTO gmx.fx_rates(
        base_currency,quote_currency,rate_date,rate,source,location,is_operational,fetched_at,notes
      ) VALUES('USD','MXN',$1,$2,'BANXICO_FIX','MEXICO',false,NOW(),'Serie SF43718')
      ON CONFLICT(base_currency,quote_currency,rate_date,source,(COALESCE(location,''))) DO UPDATE SET
        rate=EXCLUDED.rate,fetched_at=NOW(),notes=EXCLUDED.notes
      RETURNING *
    `, [rateDate, rate]);
    return saved.rows[0];
  } finally {client.release();}
}

export async function saveTijuanaUsdMxn({ rate, rateDate = '', notes = '' } = {}, user) {
  const value = num(rate);
  if (!Number.isFinite(value) || value <= 0) throw new Error('INVALID_FX_RATE');
  const date = rateDate || isoDate();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await client.query(`
      INSERT INTO gmx.fx_rates(
        base_currency,quote_currency,rate_date,rate,source,location,is_operational,fetched_at,notes
      ) VALUES('USD','MXN',$1,$2,'TIJUANA_OPERATIVO','TIJUANA',true,NOW(),NULLIF($3,''))
      ON CONFLICT(base_currency,quote_currency,rate_date,source,(COALESCE(location,''))) DO UPDATE SET
        rate=EXCLUDED.rate,is_operational=true,fetched_at=NOW(),notes=EXCLUDED.notes
      RETURNING *
    `, [date, value, txt(notes)]);
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'FINANZAS','TC_MANUAL','USD_MXN',$1,$2)`, [
    `${date} · ${value} MXN/USD · Tijuana`, user?.email || brandText("GMX Local")]
    );
    await client.query('COMMIT');
    return saved.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function listUsdMxnHistory(limit = 30) {
  const n = Math.min(Math.max(Math.trunc(num(limit) || 30), 1), 200);
  const r = await query(`SELECT row_id,rate_date,rate,source,location,is_operational,fetched_at,notes
    FROM gmx.fx_rates WHERE base_currency='USD' AND quote_currency='MXN'
    ORDER BY rate_date DESC,fetched_at DESC LIMIT $1`, [n]);
  return r.rows;
}

export async function effectiveUsdMxn({ autoRefresh = true } = {}) {
  const client = await pool.connect();
  try {
    const cfg = await configMap(client);
    const tijuanaEnabled = bool(cfg['finance.fx.tijuana_enabled'], true);
    const banxicoEnabled = bool(cfg['finance.fx.banxico_enabled'], true);
    const priority = txt(cfg['finance.fx.priority']) || 'TIJUANA_THEN_BANXICO';
    const maxAgeDays = Math.max(0, Math.min(10, Math.trunc(num(cfg['finance.fx.max_age_days'] || 3))));
    const blockIfStale = bool(cfg['finance.fx.block_if_stale'], true);
    const today = isoDate();

    const local = tijuanaEnabled ? await latestRateForDate(client, today, { operational: true }) : null;
    let official = await latestRate(client, { source: 'BANXICO_FIX', operational: false });

    if (banxicoEnabled && autoRefresh && (!official || ageDays(official.rate_date) > 0)) {
      try {
        client.release();
        const fresh = await fetchBanxicoUsdMxn();
        official = fresh || official;
        // Reconnect only for consistent return path below.
        const c2 = await pool.connect();
        try {
          return selectEffective({ local, official, cfg, priority, maxAgeDays, blockIfStale });
        } finally {c2.release();}
      } catch (e) {
        // Keep cached official/local and decide below.
        if (!String(e.message).startsWith('BANXICO_')) throw e;
      }
    }
    return selectEffective({ local, official, cfg, priority, maxAgeDays, blockIfStale });
  } finally {
    // client can already be released before external refresh.
    try {client.release();} catch {}
  }
}

function selectEffective({ local, official, priority, maxAgeDays, blockIfStale }) {
  const candidates = priority === 'BANXICO_THEN_TIJUANA' ?
  [official, local] :
  [local, official];
  const selected = candidates.find(Boolean) || null;
  if (!selected) return {
    available: false, rate: null, source: null, rate_date: null, stale: true,
    message: 'Configura el tipo de cambio en Configuración → Finanzas.'
  };
  const days = ageDays(selected.rate_date);
  const stale = days > maxAgeDays;
  if (stale && blockIfStale) return {
    available: false, rate: null, source: selected.source, rate_date: selected.rate_date, stale: true,
    message: `El tipo de cambio disponible está vencido (${selected.rate_date}). Actualízalo en Configuración → Finanzas.`
  };
  return {
    available: true,
    rate: Number(selected.rate),
    source: selected.source,
    location: selected.location || '',
    rate_date: selected.rate_date,
    fetched_at: selected.fetched_at,
    stale,
    age_days: days,
    priority
  };
}
