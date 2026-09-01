import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.dirname(HERE);
const BACKEND_DIR = path.dirname(BACKEND_SRC);
const TCG_IMAGE_ROOT = path.resolve(BACKEND_DIR, 'storage', 'tcg-images');
const VISUAL_SERVICE_URL = String(process.env.SHINY_VISUAL_BETA_URL || 'http://127.0.0.1:8011').replace(/\/$/, '');
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MIN_SIMILARITY = Math.max(0.45, Math.min(0.95, Number(process.env.SHINY_VISUAL_LAB_MIN_SIMILARITY || 0.70)));
const MIN_GAP = Math.max(0, Math.min(0.25, Number(process.env.SHINY_VISUAL_LAB_MIN_GAP || 0.025)));
const sessions = new Map();

const GAME_CODES = new Set(['YUGIOH', 'POKEMON', 'MAGIC']);

function clean(v, max = 500) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeGame(v) {
  const game = clean(v, 20).toUpperCase();
  return GAME_CODES.has(game) ? game : 'YUGIOH';
}

function localTcgPath(publicUrl = '') {
  const value = String(publicUrl || '').trim();
  const prefix = '/api/public/tcg-images/';
  if (!value.startsWith(prefix)) return null;
  const rel = decodeURIComponent(value.slice(prefix.length)).replaceAll('\\', '/');
  if (!rel || rel.includes('..')) return null;
  const full = path.resolve(TCG_IMAGE_ROOT, rel);
  if (!full.startsWith(TCG_IMAGE_ROOT + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function scoreOf(match = {}) {
  const n = Number(match.similarity ?? match.visual_similarity ?? match.score ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function masterCatalog(gameCode) {
  const rows = await query(`
    SELECT c.row_id,c.game_code,c.provider_code,c.external_id,c.set_code,c.name,
           c.number,c.collector_number,c.rarity,c.card_type,c.subtype,c.language,
           c.image_small_url,c.image_large_url,c.image_local_url,c.source_refs,c.last_synced_at,
           s.nombre AS set_name
    FROM gmx.tcg_master_cards c
    LEFT JOIN gmx.tcg_master_sets s
      ON s.id_juego=c.game_code AND s.codigo=c.set_code
    WHERE c.game_code=$1
      AND COALESCE(c.image_local_url,'')<>''
    ORDER BY c.row_id
    LIMIT 12000
  `, [gameCode]);

  return (rows.rows || []).map((card) => {
    const localPath = localTcgPath(card.image_local_url);
    if (!localPath) return null;
    return {
      row_id: card.row_id,
      id: card.external_id,
      sku: card.collector_number || card.number || card.external_id,
      nombre: card.name,
      categoria: card.game_code,
      imagen: card.image_local_url,
      local_path: localPath,
      _card: card
    };
  }).filter(Boolean);
}

async function visualHealth() {
  try {
    const r = await fetch(`${VISUAL_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3500) });
    const payload = await r.json().catch(() => ({}));
    return { ok: r.ok, ...payload };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export async function labHealth() {
  const counts = await query(`
    SELECT game_code,
           COUNT(*)::int AS master_cards,
           COUNT(*) FILTER (WHERE COALESCE(image_local_url,'')<>'')::int AS local_images
    FROM gmx.tcg_master_cards
    WHERE game_code IN ('YUGIOH','POKEMON','MAGIC')
    GROUP BY game_code
    ORDER BY game_code
  `);
  return {
    module: 'GMX Visual Lab R2',
    read_only: true,
    visual_service: await visualHealth(),
    catalogs: counts.rows || [],
    pricing_policy: 'CACHE_ONLY_NO_REFRESH_POLICY_DEFINED',
    recognition_policy: { min_similarity: MIN_SIMILARITY, min_top_gap: MIN_GAP },
    note: 'La identificación visual usa imágenes locales del catálogo maestro. OCR no es requisito.'
  };
}

async function enrichMasterCard(masterCardId) {
  const cardResult = await query(`
    SELECT c.*, s.nombre AS set_name,
           op.row_id AS operational_row_id,op.id_carta AS operational_id,
           op.estado_catalogo AS operational_status
    FROM gmx.tcg_master_cards c
    LEFT JOIN gmx.tcg_master_sets s
      ON s.id_juego=c.game_code AND s.codigo=c.set_code
    LEFT JOIN LATERAL (
      SELECT row_id,id_carta,estado_catalogo
      FROM gmx.tcg_cartas
      WHERE master_card_id=c.row_id
      ORDER BY row_id
      LIMIT 1
    ) op ON true
    WHERE c.row_id=$1
    LIMIT 1
  `, [masterCardId]);
  if (!cardResult.rowCount) return null;

  const prices = await query(`
    SELECT row_id,price_provider,variant,currency,low,mid,high,market,trend,
           source_url,provider_updated_at,fetched_at
    FROM gmx.tcg_card_price_current
    WHERE master_card_id=$1
    ORDER BY CASE WHEN UPPER(price_provider)='TCGPLAYER' THEN 0 ELSE 1 END,
             currency,price_provider,variant
  `, [masterCardId]);

  const card = cardResult.rows[0];
  const tcgplayer = (prices.rows || []).filter((x) => String(x.price_provider || '').toUpperCase() === 'TCGPLAYER');
  return {
    card,
    prices: prices.rows || [],
    tcgplayer,
    cached_price_available: Boolean(prices.rowCount),
    tcgplayer_cached: Boolean(tcgplayer.length),
    provider_refs: card.source_refs || {},
    operational: card.operational_row_id ? {
      row_id: card.operational_row_id,
      id_carta: card.operational_id,
      status: card.operational_status
    } : null
  };
}

export async function identifyCard({ imageBase64, gameCode = 'YUGIOH', limit = 6 } = {}) {
  const startedAt = Date.now();
  const game = safeGame(gameCode);
  const image = String(imageBase64 || '');
  if (!image) throw new Error('IMAGE_REQUIRED');
  if (image.length > 10_000_000) throw new Error('IMAGE_TOO_LARGE');

  const health = await visualHealth();
  if (!health.ok) {
    const e = new Error('VISUAL_SERVICE_OFFLINE');
    e.detail = health.error || '';
    throw e;
  }

  const catalogStarted = Date.now();
  const catalog = await masterCatalog(game);
  const catalogMs = Date.now() - catalogStarted;
  if (!catalog.length) {
    return {
      game,
      matches: [],
      catalog_count: 0,
      indexed_count: 0,
      message: `El catálogo maestro ${game} no tiene imágenes locales indexables. Sin imágenes locales no se fuerza OCR ni scraping.`,
      diagnostics: { total_ms: Date.now() - startedAt, catalog_ms: catalogMs }
    };
  }

  const visualStarted = Date.now();
  const response = await fetch(`${VISUAL_SERVICE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_base64: image,
      catalog: catalog.map(({ _card, ...x }) => x),
      limit: Math.max(1, Math.min(Number(limit) || 6, 10))
    }),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = new Error('VISUAL_SEARCH_FAILED');
    e.detail = clean(payload?.detail || payload?.message || '', 240);
    throw e;
  }
  const visualMs = Date.now() - visualStarted;

  const byId = new Map(catalog.map((x) => [String(x.row_id), x._card]));
  const rawMatches = Array.isArray(payload?.matches) ? payload.matches : [];
  const matches = [];
  for (const raw of rawMatches) {
    const card = byId.get(String(raw.row_id));
    if (!card) continue;
    const enriched = await enrichMasterCard(card.row_id);
    matches.push({
      similarity: scoreOf(raw),
      master_card_id: card.row_id,
      identity_key: `${card.game_code}|${card.set_code}|${card.collector_number || card.number || card.external_id}`.toLowerCase(),
      name: card.name,
      game_code: card.game_code,
      set_code: card.set_code,
      set_name: card.set_name || '',
      collector_number: card.collector_number || card.number || '',
      rarity: card.rarity || '',
      language: card.language || '',
      image: card.image_local_url || card.image_large_url || card.image_small_url || '',
      provider_code: card.provider_code,
      external_id: card.external_id,
      provider_refs: enriched?.provider_refs || {},
      operational: enriched?.operational || null,
      prices: enriched?.prices || [],
      tcgplayer: enriched?.tcgplayer || [],
      cached_price_available: Boolean(enriched?.cached_price_available),
      tcgplayer_cached: Boolean(enriched?.tcgplayer_cached)
    });
  }

  const topScore = Number(matches[0]?.similarity || 0);
  const secondScore = Number(matches[1]?.similarity || 0);
  const gap = topScore - secondScore;
  const accepted = Boolean(matches.length) && topScore >= MIN_SIMILARITY && (gap >= MIN_GAP || topScore >= 0.88);

  return {
    game,
    matches,
    decision: { accepted, top_similarity: topScore, second_similarity: secondScore, gap, min_similarity: MIN_SIMILARITY, min_gap: MIN_GAP },
    catalog_count: catalog.length,
    indexed_count: Number(payload?.indexed_count || catalog.length),
    card_detected: Boolean(payload?.card_detected),
    diagnostics: {
      catalog_ms: catalogMs,
      visual_ms: visualMs,
      total_ms: Date.now() - startedAt,
      source_identity: 'SHINY_MASTER_LOCAL_IMAGE_OPENCLIP',
      source_pricing: 'SHINY_TCG_CARD_PRICE_CURRENT_CACHE'
    }
  };
}

function purgeSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

export function startBulkSession({ gameCode = 'YUGIOH' } = {}) {
  purgeSessions();
  const id = randomUUID();
  const now = Date.now();
  const session = {
    id,
    game_code: safeGame(gameCode),
    createdAt: now,
    updatedAt: now,
    physical_count: 0,
    recognized_count: 0,
    unrecognized_count: 0,
    unique_count: 0,
    identities: new Map()
  };
  sessions.set(id, session);
  return serializeSession(session);
}

function serializeSession(session) {
  return {
    id: session.id,
    game_code: session.game_code,
    created_at: new Date(session.createdAt).toISOString(),
    updated_at: new Date(session.updatedAt).toISOString(),
    physical_count: session.physical_count,
    recognized_count: session.recognized_count,
    unrecognized_count: session.unrecognized_count,
    unique_count: session.identities.size,
    identities: [...session.identities.values()].sort((a, b) => b.quantity - a.quantity)
  };
}

export function getBulkSession(id) {
  purgeSessions();
  const session = sessions.get(String(id || ''));
  return session ? serializeSession(session) : null;
}

export async function captureBulk({ sessionId, imageBase64 } = {}) {
  purgeSessions();
  const session = sessions.get(String(sessionId || ''));
  if (!session) throw new Error('BULK_SESSION_NOT_FOUND');
  session.physical_count += 1;
  session.updatedAt = Date.now();

  const result = await identifyCard({ imageBase64, gameCode: session.game_code, limit: 3 });
  const top = result.matches?.[0] || null;
  if (!top || !result.decision?.accepted) {
    session.unrecognized_count += 1;
    return { recognized: false, result, session: serializeSession(session) };
  }

  session.recognized_count += 1;
  const key = top.identity_key;
  const existing = session.identities.get(key);
  if (existing) {
    existing.quantity += 1;
    existing.last_seen_at = new Date().toISOString();
  } else {
    session.identities.set(key, {
      identity_key: key,
      master_card_id: top.master_card_id,
      name: top.name,
      set_code: top.set_code,
      set_name: top.set_name,
      collector_number: top.collector_number,
      rarity: top.rarity,
      image: top.image,
      quantity: 1,
      similarity: top.similarity,
      cached_price_available: top.cached_price_available,
      tcgplayer_cached: top.tcgplayer_cached,
      tcgplayer: top.tcgplayer,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    });
  }
  session.unique_count = session.identities.size;

  return {
    recognized: true,
    duplicate_identity: Boolean(existing),
    match: top,
    result: {
      catalog_count: result.catalog_count,
      indexed_count: result.indexed_count,
      diagnostics: result.diagnostics
    },
    session: serializeSession(session)
  };
}
