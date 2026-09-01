import { brandText } from "./config/brand.js";import { pool, query } from './db.js';

const CHANNEL = 'shiny_storefront_live';
const clients = new Set();
const MAX_CONNECTIONS = Math.max(100, Number(process.env.SHINY_SSE_MAX_CONNECTIONS || 20000));
const HEARTBEAT_MS = Math.max(10000, Number(process.env.SHINY_SSE_HEARTBEAT_MS || 25000));
const RETRY_MIN_MS = Math.max(1000, Number(process.env.SHINY_SSE_RETRY_MIN_MS || 5000));
const RETRY_JITTER_MS = Math.max(0, Number(process.env.SHINY_SSE_RETRY_JITTER_MS || 10000));
let currentVersion = 0,lastBroadcastVersion = 0;
let listenerClient = null,reconnectTimer = null,heartbeatTimer = null,started = false;
let totalOpened = 0,totalClosed = 0,totalRejected = 0,peakConnections = 0;

const norm = (x) => [...new Set((Array.isArray(x) ? x : [x]).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))];

function safeWrite(res, text) {
  if (res.destroyed || res.writableEnded) return false;
  if (Number(res.writableLength || 0) > 512 * 1024) {
    try {res.end();} catch {}
    return false;
  }
  try {return res.write(text);} catch {return false;}
}
function send(res, { event = 'message', id = null, data = {} } = {}) {
  let s = '';
  if (id !== null) s += `id: ${id}\n`;
  if (event) s += `event: ${event}\n`;
  s += `data: ${JSON.stringify(data)}\n\n`;
  return safeWrite(res, s);
}
function broadcast(payload) {
  const v = Number(payload?.version || 0);
  if (v && v <= lastBroadcastVersion) return;
  if (v) {lastBroadcastVersion = v;currentVersion = Math.max(currentVersion, v);}
  for (const res of [...clients]) {
    if (res.destroyed || res.writableEnded) {clients.delete(res);continue;}
    send(res, { event: 'storefront-updated', id: v || Date.now(), data: payload });
  }
}
async function ensureVersion() {
  try {
    const r = await query(`SELECT valor FROM gmx.configuracion WHERE parametro='live.storefront_version' LIMIT 1`);
    currentVersion = Number(r.rows[0]?.valor || 0);
  } catch {currentVersion = 0;}
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {reconnectTimer = null;connectListener().catch(() => scheduleReconnect());}, 5000);
}
async function connectListener() {
  if (listenerClient) return;
  const c = await pool.connect();listenerClient = c;
  c.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {broadcast(JSON.parse(msg.payload));} catch {}
  });
  c.on('error', (e) => {
    console.error(brandText("[GMX] Storefront LISTEN:"), e.message);
    try {c.release(true);} catch {}
    if (listenerClient === c) listenerClient = null;
    scheduleReconnect();
  });
  try {await c.query(`LISTEN ${CHANNEL}`);}
  catch (e) {try {c.release(true);} catch {};listenerClient = null;throw e;}
}
export async function initStorefrontLiveSync() {
  if (started) return;started = true;
  await ensureVersion();
  connectListener().catch((e) => {console.error(brandText("[GMX] Storefront LISTEN startup:"), e.message);scheduleReconnect();});
  // 1 timer global, no uno por cada uno de los 1,000+ clientes.
  heartbeatTimer = setInterval(() => {
    for (const res of [...clients]) {
      if (res.destroyed || res.writableEnded) {clients.delete(res);continue;}
      safeWrite(res, `: heartbeat ${Date.now()}\n\n`);
    }
  }, HEARTBEAT_MS);
  console.log(brandText(`[Shiny] Storefront live sync ready · version=${currentVersion}`));
}

export async function publishStorefrontUpdate({
  sections = ['storefront'], reason = 'CHANGE', actor = brandText("GMX"), changes = []
} = {}) {
  const r = await query(`
    INSERT INTO gmx.configuracion(parametro,valor) VALUES('live.storefront_version','1')
    ON CONFLICT(parametro) DO UPDATE SET valor=
      CASE WHEN configuracion.valor ~ '^[0-9]+$'
        THEN (configuracion.valor::bigint+1)::text ELSE '1' END
    RETURNING valor`);
  const version = Number(r.rows[0]?.valor || Date.now());
  const payload = {
    version, sections: norm(sections), reason: String(reason).slice(0, 140),
    actor: String(actor || brandText("GMX")).slice(0, 160), changes: Array.isArray(changes) ? changes.slice(0, 200) : [],
    at: new Date().toISOString()
  };
  currentVersion = Math.max(currentVersion, version);
  broadcast(payload);
  await query(`SELECT pg_notify($1,$2)`, [CHANNEL, JSON.stringify(payload)]);
  return payload;
}
export const getStorefrontVersion = () => currentVersion;
export const getStorefrontLiveStats = () => ({
  version: currentVersion, connections: clients.size, peakConnections, totalOpened, totalClosed, totalRejected,
  maxConnections: MAX_CONNECTIONS, utilizationPct: Math.round(clients.size / MAX_CONNECTIONS * 10000) / 100,
  heartbeatMs: HEARTBEAT_MS, channel: CHANNEL
});

export function openStorefrontEventStream(req, res) {
  const retryMs = RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_JITTER_MS + 1));
  if (clients.size >= MAX_CONNECTIONS) {
    totalRejected++;
    // Abrimos SSE brevemente para que el navegador aprenda un retry con jitter antes de cerrar.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'close');
    res.setHeader('X-Accel-Buffering', 'no');
    try {res.flushHeaders?.();} catch {}
    safeWrite(res, `retry: ${retryMs}\nevent: capacity\ndata: ${JSON.stringify({ connected: false, reason: 'INSTANCE_CAPACITY', retryMs })}\n\n`);
    return setTimeout(() => {try {res.end();} catch {}}, 25);
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  try {res.flushHeaders?.();} catch {}
  try {req.socket?.setKeepAlive?.(true, 30000);req.socket?.setNoDelay?.(true);} catch {}
  clients.add(res);totalOpened++;peakConnections = Math.max(peakConnections, clients.size);
  safeWrite(res, `retry: ${retryMs}\n\n`);
  const clientVersion = Math.max(0, Number(req.query?.version || 0), Number(req.headers['last-event-id'] || 0));
  send(res, { event: 'storefront-version', id: currentVersion, data: { version: currentVersion, connected: true, retryMs } });
  if (clientVersion < currentVersion) {
    send(res, { event: 'storefront-updated', id: currentVersion, data: {
        version: currentVersion, sections: ['all'], reason: 'RECONNECT_CATCHUP', actor: 'SYSTEM', changes: []
      } });
  }
  let closed = false;
  const close = () => {if (closed) return;closed = true;if (clients.delete(res)) totalClosed++;};
  req.on('close', close);req.on('aborted', close);res.on('close', close);res.on('finish', close);
}

function classify(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  const url = String(req.originalUrl || req.url || '').split('?')[0];

  if (url.startsWith('/api/v1/content/settings')) return ['appearance', 'settings'];
  if (method === 'DELETE' && url.startsWith('/api/v1/content/media/')) return ['media', 'appearance', 'slideshow'];
  if (url.startsWith('/api/v1/cms/')) return ['slideshow', 'appearance'];
  if (url.startsWith('/api/v1/benefits/')) return ['promotions'];
  if (url.startsWith('/api/v1/products/')) return ['catalog'];
  if (url.startsWith('/api/v1/tcg/') && !url.startsWith('/api/v1/tcg-sync/')) return ['tcg'];
  return null;
}

export function storefrontMutationPublisher(req, res, next) {
  const sections = classify(req);if (!sections) return next();
  res.once('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      publishStorefrontUpdate({
        sections, reason: `${String(req.method).toUpperCase()} ${String(req.originalUrl || req.url).split('?')[0]}`,
        actor: req.user?.email || req.user?.id || 'ADMIN'
      }).catch((e) => console.error(brandText("[GMX] Storefront publish:"), e.message));
    }
  });
  next();
}
export async function stopStorefrontLiveSync() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  heartbeatTimer = reconnectTimer = null;
  for (const res of [...clients]) try {res.end();} catch {}
  clients.clear();
  if (listenerClient) {
    const c = listenerClient;listenerClient = null;
    try {await c.query(`UNLISTEN ${CHANNEL}`);} catch {}
    try {c.release();} catch {}
  }
  started = false;
}
