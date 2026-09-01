import { brandText } from "./config/brand.js";import { query } from './db.js';
import { generateAlerts } from './repositories/notificationsRepository.js';

let timer = null;
let running = false;
let pendingImmediate = null;
let rerunRequested = false;

async function settings() {
  const r = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro IN ('alerts.auto_generate_enabled','alerts.auto_generate_minutes')`);
  return Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
}

async function tick(reason = 'SCHEDULED') {
  if (running) {
    rerunRequested = true;
    return;
  }
  running = true;
  try {
    const cfg = await settings();
    if (String(cfg['alerts.auto_generate_enabled'] || 'true').toLowerCase() === 'true') {
      await generateAlerts({ email: 'SISTEMA' }, { scope: null });
    }
  } catch (e) {
    console.error(brandText(`[Shiny] Alert refresh (${reason}):`), e.message);
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      setTimeout(() => tick('COALESCED'), 800);
    }
  }
}

/**
 * Solicita una revisión casi inmediata después de una operación que pueda
 * cambiar una condición de alerta. El debounce evita ejecutar el motor varias
 * veces durante una misma transacción/pantalla.
 */
export function requestAlertRefresh(reason = 'OPERATION') {
  if (pendingImmediate) clearTimeout(pendingImmediate);
  pendingImmediate = setTimeout(() => {
    pendingImmediate = null;
    tick(reason);
  }, 900);
}

export function alertMutationTrigger(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  const url = String(req.originalUrl || req.url || '');
  const relevant = [
  '/api/v1/orders',
  '/api/v1/inventory',
  '/api/v1/purchases',
  '/api/v1/cash',
  '/api/v1/commercial',
  '/api/v1/tcg'].
  some((prefix) => url.startsWith(prefix));

  if (!relevant || url.startsWith('/api/v1/notifications')) return next();

  res.once('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      requestAlertRefresh(`${method} ${url.split('?')[0]}`);
    }
  });
  next();
}

export async function startAlertScheduler() {
  if (timer) return;
  let minutes = 15;
  try {
    const cfg = await settings();
    minutes = Math.min(Math.max(Number(cfg['alerts.auto_generate_minutes'] || 15), 5), 1440);
  } catch {}
  setTimeout(() => tick('STARTUP'), 8000);
  timer = setInterval(() => tick('SCHEDULED'), minutes * 60 * 1000);
  console.log(brandText(`[Shiny] Alert scheduler: every ${minutes} min + event-driven refresh`));
}
