import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.dirname(HERE);
const IMAGE_DIR = path.join(BACKEND_DIR, 'storage', 'tcg-images');

const txt = (v) => String(v ?? '').trim();
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(x) ? x : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (v) => txt(v).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120);

async function fetchJson(url, { timeout = 45000, delayMs = 0 } = {}) {
  if (delayMs > 0) await sleep(delayMs);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const host = (() => { try { return new URL(url).host; } catch { return 'remote'; } })();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GMX-TCG-Specialized-Providers/1.0'
      },
      signal: ctrl.signal
    });
    if (!response.ok) {
      let detail = '';
      try { detail = String(await response.text()).replace(/\s+/g, ' ').slice(0, 240); } catch {}
      throw new Error(`REMOTE_HTTP_${response.status}:${host}${detail ? `:${detail}` : ''}`);
    }
    return await response.json();
  } catch (e) {
    if (String(e?.message || '').startsWith('REMOTE_')) throw e;
    const code = e?.name === 'AbortError' ? 'REMOTE_TIMEOUT' : 'REMOTE_FETCH_FAILED';
    throw new Error(`${code}:${host}:${String(e?.cause?.message || e?.message || e).slice(0, 240)}`);
  } finally {
    clearTimeout(timer);
  }
}

function rowsOf(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.cards)) return payload.cards;
  return [];
}

function isoDate(v) {
  const s = txt(v);
  if (!s) return '';
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

function imageExt(url, contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  if (ct.includes('avif') || /\.avif(?:\?|$)/.test(u)) return '.avif';
  if (ct.includes('webp') || /\.webp(?:\?|$)/.test(u)) return '.webp';
  if (ct.includes('png') || /\.png(?:\?|$)/.test(u)) return '.png';
  if (ct.includes('gif') || /\.gif(?:\?|$)/.test(u)) return '.gif';
  return '.jpg';
}

async function cacheImage(gameCode, setCode, externalId, url) {
  if (!url) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'GMX-TCG-Specialized-Providers/1.0' },
      signal: ctrl.signal
    });
    if (!response.ok) throw new Error(`IMAGE_HTTP_${response.status}`);
    const ab = await response.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (buffer.length > 12 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    const ext = imageExt(url, response.headers.get('content-type') || '');
    const dir = path.join(IMAGE_DIR, slug(gameCode), slug(setCode));
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${slug(externalId)}${ext}`;
    const full = path.join(dir, filename);
    if (!fs.existsSync(full)) fs.writeFileSync(full, buffer);
    return `/api/public/tcg-images/${encodeURIComponent(slug(gameCode))}/${encodeURIComponent(slug(setCode))}/${encodeURIComponent(filename)}`;
  } finally {
    clearTimeout(timer);
  }
}

function price(provider, variant, currency, values = {}, sourceUrl = '') {
  const p = {
    provider,
    variant: txt(variant) || 'normal',
    currency: txt(currency).toUpperCase() || 'USD',
    low: num(values.low ?? values.inventory ?? values.inventory_price ?? values.lowPrice),
    mid: num(values.mid ?? values.midPrice),
    high: num(values.high ?? values.highPrice),
    market: num(values.market ?? values.market_price ?? values.marketPrice ?? values.price),
    trend: num(values.trend ?? values.trendPrice),
    sourceUrl: txt(sourceUrl)
  };
  if ([p.low, p.mid, p.high, p.market, p.trend].every((v) => v == null)) return null;
  return p;
}

async function maybeCache(gameCode, setCode, externalId, imageUrl, downloadImages) {
  if (!downloadImages || !imageUrl) return '';
  try { return await cacheImage(gameCode, setCode, externalId, imageUrl); } catch { return ''; }
}

/* ------------------------------------------------------------------ */
/* LORCANA / LORCAST                                                  */
/* ------------------------------------------------------------------ */

const LORCAST_BASE = 'https://api.lorcast.com/v0';

async function lorcastSets() {
  const payload = await fetchJson(`${LORCAST_BASE}/sets`, { delayMs: 80 });
  const rows = rowsOf(payload, ['results']);
  const out = rows.map((x) => ({
    code: txt(x.code || x.id),
    name: txt(x.name || x.code || x.id),
    releaseDate: isoDate(x.released_at || x.release_date),
    total: Number(x.card_count || x.total_cards || 0),
    sourceUrl: `${LORCAST_BASE}/sets/${encodeURIComponent(txt(x.code || x.id))}`
  })).filter((x) => x.code && x.name);
  out._gmxSource = 'Lorcast';
  return out;
}

async function lorcastCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  const payload = await fetchJson(`${LORCAST_BASE}/sets/${encodeURIComponent(setCode)}/cards`, { timeout: 60000, delayMs: 80 });
  const rows = rowsOf(payload);
  const cards = [];
  for (const x of rows) {
    const externalId = txt(x.id || `${setCode}-${x.collector_number}-${x.name}`);
    const image = x.image_uris?.digital || x.image_uris || {};
    const imageSmall = txt(image.small || image.normal || '');
    const imageLarge = txt(image.large || image.normal || image.small || '');
    const local = await maybeCache('LORCANA', setCode, externalId, imageLarge, downloadImages);
    const prices = [];
    if (syncPrices) {
      const normal = price('Lorcast', 'normal', 'USD', { market: x.prices?.usd }, `${LORCAST_BASE}/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(txt(x.collector_number))}`);
      const foil = price('Lorcast', 'foil', 'USD', { market: x.prices?.usd_foil }, `${LORCAST_BASE}/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(txt(x.collector_number))}`);
      if (normal) prices.push(normal);
      if (foil) prices.push(foil);
    }
    cards.push({
      gameCode: 'LORCANA',
      providerCode: 'LORCAST',
      externalId,
      variantKey: externalId,
      setCode: txt(x.set?.code || setCode),
      name: txt(x.name),
      number: txt(x.collector_number),
      collectorNumber: txt(x.collector_number),
      rarity: txt(x.rarity).replaceAll('_', ' '),
      cardType: Array.isArray(x.type) ? x.type.join(' / ') : txt(x.type),
      subtype: [txt(x.version), ...(Array.isArray(x.classifications) ? x.classifications : [])].filter(Boolean).join(' / '),
      artist: Array.isArray(x.illustrators) ? x.illustrators.join(' / ') : txt(x.illustrator),
      description: txt(x.text),
      language: txt(x.lang) || 'en',
      imageSmall,
      imageLarge,
      imageLocal: local,
      purchaseUrl: '',
      sourceUrl: `${LORCAST_BASE}/cards/${encodeURIComponent(txt(x.set?.code || setCode))}/${encodeURIComponent(txt(x.collector_number))}`,
      externalUpdatedAt: null,
      prices,
      metadata: {
        version: x.version || null,
        layout: x.layout || null,
        ink: x.ink || null,
        inkwell: x.inkwell ?? null,
        cost: x.cost ?? null,
        strength: x.strength ?? null,
        willpower: x.willpower ?? null,
        lore: x.lore ?? null,
        tcgplayer_id: x.tcgplayer_id ?? null,
        legalities: x.legalities || {},
        released_at: x.released_at || null
      }
    });
  }
  cards._gmxSource = 'Lorcast';
  return cards;
}

/* ------------------------------------------------------------------ */
/* ONE PIECE / OPTCG API                                              */
/* ------------------------------------------------------------------ */

const OPTCG_BASE = 'https://optcgapi.com/api';
const opBulkCache = new Map();

function opCode(v) {
  return txt(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function opFetchBulk(kind, url, ttlMs = 10 * 60 * 1000) {
  const cached = opBulkCache.get(kind);
  if (cached && Date.now() - cached.at < ttlMs) return cached.rows;
  const payload = await fetchJson(url, { timeout: 90000 });
  const rows = rowsOf(payload);
  opBulkCache.set(kind, { at: Date.now(), rows });
  return rows;
}

async function onePieceSets() {
  const [setPayload, deckPayload] = await Promise.all([
    fetchJson(`${OPTCG_BASE}/allSets/`, { timeout: 60000 }),
    fetchJson(`${OPTCG_BASE}/allDecks/`, { timeout: 60000 }).catch(() => [])
  ]);
  const sets = rowsOf(setPayload).map((x) => ({
    code: txt(x.set_id || x.code || x.id),
    name: txt(x.set_name || x.name || x.set_id || x.id),
    releaseDate: isoDate(x.release_date || x.released_at || x.date),
    total: Number(x.total_cards || x.card_count || 0),
    sourceUrl: `${OPTCG_BASE}/sets/${encodeURIComponent(txt(x.set_id || x.code || x.id))}/`
  }));
  const decks = rowsOf(deckPayload).map((x) => ({
    code: txt(x.st_id || x.deck_id || x.set_id || x.code || x.id),
    name: txt(x.st_name || x.deck_name || x.set_name || x.name || x.st_id || x.id),
    releaseDate: isoDate(x.release_date || x.released_at || x.date),
    total: Number(x.total_cards || x.card_count || 0),
    sourceUrl: `${OPTCG_BASE}/decks/${encodeURIComponent(txt(x.st_id || x.deck_id || x.set_id || x.code || x.id))}/`
  }));
  const merged = [...sets, ...decks].filter((x) => x.code && x.name);
  const seen = new Set();
  const out = merged.filter((x) => {
    const k = x.code.toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  out.push(
    { code: 'PROMO', name: 'Promotional Cards', releaseDate: '', total: 0, sourceUrl: `${OPTCG_BASE}/allPromoCards/` },
    { code: 'DON', name: 'DON!! Cards', releaseDate: '', total: 0, sourceUrl: `${OPTCG_BASE}/allDonCards/` }
  );
  out._gmxSource = 'OPTCG API';
  return out;
}

function opRowsForSet(rows, setCode) {
  const wanted = opCode(setCode);
  return rows.filter((x) => {
    const explicit = opCode(x.set_id || x.st_id || x.deck_id || x.card_set || x.set_code || x.card_set_code);
    const cardId = opCode(x.card_set_id || x.card_id || x.card_number || x.cardnumber || '');
    const setName = opCode(x.set_name || x.deck_name || '');
    return explicit === wanted || cardId.startsWith(wanted) || setName === wanted;
  });
}

async function onePieceRawCards(setCode) {
  const code = txt(setCode).toUpperCase();
  if (code === 'PROMO') {
    return opFetchBulk('PROMO', `${OPTCG_BASE}/allPromoCards/`, 15 * 60 * 1000);
  }
  if (code === 'DON') return opFetchBulk('DON', `${OPTCG_BASE}/allDonCards/`, 15 * 60 * 1000);

  const isStarter = /^ST[-_]?\d+/i.test(code);
  const directUrl = isStarter
    ? `${OPTCG_BASE}/decks/${encodeURIComponent(setCode)}/`
    : `${OPTCG_BASE}/sets/${encodeURIComponent(setCode)}/`;

  try {
    const direct = rowsOf(await fetchJson(directUrl, { timeout: 60000 }));
    if (direct.length) return direct;
  } catch {}

  const bulk = isStarter
    ? await opFetchBulk('STARTERS', `${OPTCG_BASE}/allSTCards/`, 15 * 60 * 1000)
    : await opFetchBulk('SETS', `${OPTCG_BASE}/allSetCards/`, 15 * 60 * 1000);
  return opRowsForSet(bulk, setCode);
}

async function onePieceCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  const rows = await onePieceRawCards(setCode);
  const cards = [];
  for (const x of rows) {
    const printed = txt(x.card_set_id || x.card_id || x.card_number || x.cardnumber || x.number);
    const imageId = txt(x.card_image_id || x.image_id || '');
    const externalId = txt(x.id || imageId || [printed, x.card_name || x.name, x.variant || x.art].filter(Boolean).join(':'));
    const imageLarge = txt(x.card_image || x.image_url || x.image || x.card_image_url || '');
    const local = await maybeCache('ONEPIECE', setCode, externalId, imageLarge, downloadImages);
    const prices = [];
    if (syncPrices) {
      const p = price('TCGplayer', 'normal', 'USD', {
        low: x.inventory_price ?? x.low_price,
        market: x.market_price ?? x.tcgplayer_price
      }, 'https://www.tcgplayer.com/');
      if (p) prices.push(p);
    }
    cards.push({
      gameCode: 'ONEPIECE',
      providerCode: 'OPTCG_API',
      externalId,
      variantKey: externalId,
      setCode,
      name: txt(x.card_name || x.name),
      number: printed,
      collectorNumber: printed,
      rarity: txt(x.rarity || x.card_rarity),
      cardType: txt(x.card_type || x.type),
      subtype: [txt(x.card_color || x.color), txt(x.variant || x.art || x.card_variant)].filter(Boolean).join(' / '),
      artist: txt(x.artist),
      description: txt(x.card_text || x.text || x.effect),
      language: txt(x.language || x.lang) || 'en',
      imageSmall: imageLarge,
      imageLarge,
      imageLocal: local,
      purchaseUrl: '',
      sourceUrl: directSourceForOnePiece(setCode, printed),
      externalUpdatedAt: x.updated_at || x.date_updated || null,
      prices,
      metadata: {
        card_image_id: imageId || null,
        set_name: x.set_name || x.deck_name || null,
        counter: x.counter ?? x.card_counter ?? null,
        cost: x.cost ?? x.card_cost ?? null,
        power: x.power ?? x.card_power ?? null,
        attribute: x.attribute ?? x.card_attribute ?? null
      }
    });
  }
  cards._gmxSource = 'OPTCG API';
  return cards;
}

function directSourceForOnePiece(setCode, printed) {
  const code = txt(setCode).toUpperCase();
  if (code === 'PROMO') return `${OPTCG_BASE}/promos/card/${encodeURIComponent(printed)}/`;
  if (code === 'DON') return `${OPTCG_BASE}/don/filtered/`;
  if (/^ST[-_]?\d+/i.test(code)) return `${OPTCG_BASE}/decks/card/${encodeURIComponent(printed)}/`;
  return `${OPTCG_BASE}/sets/card/${encodeURIComponent(printed)}/`;
}

/* ------------------------------------------------------------------ */
/* DIGIMON / DIGIMONCARD.IO                                          */
/* ------------------------------------------------------------------ */

const DIGIMON_BASE = 'https://digimoncard.io/api-public';
let digimonSimpleCache = { at: 0, rows: [] };

async function digimonSimpleCards() {
  if (digimonSimpleCache.rows.length && Date.now() - digimonSimpleCache.at < 30 * 60 * 1000) {
    return digimonSimpleCache.rows;
  }
  const payload = await fetchJson(`${DIGIMON_BASE}/getAllCards?series=${encodeURIComponent('Digimon Card Game')}&sort=card_number&sortdirection=asc`, { timeout: 90000 });
  const rows = rowsOf(payload).filter((x) => txt(x.cardnumber || x.id));
  digimonSimpleCache = { at: Date.now(), rows };
  return rows;
}

function digimonSetCode(cardNumber) {
  return txt(cardNumber).toUpperCase().split('-')[0];
}

async function digimonSearchByNumbers(numbers) {
  const ids = [...new Set(numbers.map(txt).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const url = `${DIGIMON_BASE}/search?series=${encodeURIComponent('Digimon Card Game')}&card=${encodeURIComponent(chunk.join(','))}&sort=code&sortdirection=asc&limit=500`;
    const payload = await fetchJson(url, { timeout: 60000, delayMs: 750 });
    out.push(...rowsOf(payload));
  }
  return out;
}

async function digimonSets() {
  const simple = await digimonSimpleCards();
  const groups = new Map();
  for (const x of simple) {
    const number = txt(x.cardnumber || x.id);
    const code = digimonSetCode(number);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, { count: 0, first: number });
    groups.get(code).count++;
  }
  let detailById = new Map();
  try {
    const samples = [...groups.values()].map((x) => x.first);
    const details = await digimonSearchByNumbers(samples);
    detailById = new Map(details.map((x) => [txt(x.id || x.cardnumber), x]));
  } catch {}

  const out = [...groups.entries()].map(([code, info]) => {
    const d = detailById.get(info.first) || {};
    const names = Array.isArray(d.set_name) ? d.set_name : [d.set_name];
    return {
      code,
      name: txt(names.filter(Boolean)[0]) || code,
      releaseDate: '',
      total: info.count,
      sourceUrl: `${DIGIMON_BASE}/search?card=${encodeURIComponent(info.first)}`
    };
  }).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  out._gmxSource = 'DigimonCard.io';
  return out;
}

async function digimonCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  void downloadImages;
  void syncPrices;
  const simple = await digimonSimpleCards();
  const ids = simple
    .map((x) => txt(x.cardnumber || x.id))
    .filter((number) => digimonSetCode(number) === txt(setCode).toUpperCase());
  if (!ids.length) throw new Error(`DIGIMON_SET_HAS_NO_CARDS:${setCode}`);
  const rows = await digimonSearchByNumbers(ids);
  const cards = rows.map((x) => {
    const printed = txt(x.id || x.cardnumber);
    const externalId = txt(x.pretty_url || printed);
    const setNames = Array.isArray(x.set_name) ? x.set_name : [x.set_name];
    return {
      gameCode: 'DIGIMON',
      providerCode: 'DIGIMONCARD_API',
      externalId,
      variantKey: externalId,
      setCode,
      name: txt(x.name),
      number: printed,
      collectorNumber: printed,
      rarity: txt(x.rarity).toUpperCase(),
      cardType: txt(x.type),
      subtype: [txt(x.color), txt(x.color2), txt(x.digi_type), txt(x.form), txt(x.stage)].filter(Boolean).join(' / '),
      artist: txt(x.artist),
      description: [x.main_effect, x.source_effect, x.alt_effect].map(txt).filter(Boolean).join('\n'),
      language: 'en',
      imageSmall: txt(x.image_url || x.image || ''),
      imageLarge: txt(x.image_url || x.image || ''),
      imageLocal: '',
      purchaseUrl: '',
      sourceUrl: `${DIGIMON_BASE}/search?card=${encodeURIComponent(printed)}`,
      externalUpdatedAt: x.date_added || null,
      prices: [],
      metadata: {
        level: x.level ?? null,
        play_cost: x.play_cost ?? null,
        evolution_cost: x.evolution_cost ?? null,
        evolution_color: x.evolution_color ?? null,
        evolution_level: x.evolution_level ?? null,
        dp: x.dp ?? null,
        attribute: x.attribute ?? null,
        set_name: setNames.filter(Boolean),
        tcgplayer_name: x.tcgplayer_name || null,
        tcgplayer_id: x.tcgplayer_id ?? null
      }
    };
  });
  cards._gmxSource = 'DigimonCard.io';
  return cards;
}

/* ------------------------------------------------------------------ */
/* STAR WARS UNLIMITED / SWU API                                     */
/* ------------------------------------------------------------------ */

const SWU_BASE = 'https://api.swuapi.com';

async function swuSets() {
  const payload = await fetchJson(`${SWU_BASE}/sets`, { timeout: 60000 });
  const rows = rowsOf(payload, ['sets']);
  const out = rows.map((x) => ({
    code: txt(x.code),
    name: txt(x.name || x.code),
    releaseDate: isoDate(x.release_date || x.released_at),
    total: Number(x.total_cards || x.card_count || 0),
    sourceUrl: `${SWU_BASE}/sets/${encodeURIComponent(txt(x.code))}`
  })).filter((x) => x.code && x.name);
  out._gmxSource = 'SWU API';
  return out;
}

async function swuCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  void syncPrices;
  const all = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const payload = await fetchJson(`${SWU_BASE}/cards?set=${encodeURIComponent(setCode)}&limit=${limit}&offset=${offset}`, { timeout: 60000 });
    const rows = rowsOf(payload, ['cards']);
    all.push(...rows);
    const total = Number(payload?.pagination?.total || 0);
    if (!rows.length || rows.length < limit || (total > 0 && all.length >= total)) break;
    offset += rows.length;
  }

  const cards = [];
  for (const x of all) {
    const externalId = txt(x.uuid || x.external_uid || x.external_id || x.id);
    const printed = txt(x.collector_number || x.collectorNumber || x.id);
    const variant = txt(x.variant_type || x.variantType || x.variant);
    const imageLarge = txt(x.front_image_url || x.frontImageUrl || x.image_url || x.imageUrl || '');
    const local = await maybeCache('SWU', setCode, externalId, imageLarge, downloadImages);
    cards.push({
      gameCode: 'SWU',
      providerCode: 'SWU_API',
      externalId,
      variantKey: externalId,
      setCode,
      name: txt(x.name),
      number: printed,
      collectorNumber: printed,
      rarity: txt(x.rarity),
      cardType: txt(x.type),
      subtype: [txt(x.subtitle), variant].filter(Boolean).join(' / '),
      artist: txt(x.artist),
      description: [x.text, x.deploy_box || x.deployBox, x.epic_action || x.epicAction].map(txt).filter(Boolean).join('\n'),
      language: txt(x.language || x.lang) || 'en',
      imageSmall: imageLarge,
      imageLarge,
      imageLocal: local,
      purchaseUrl: '',
      sourceUrl: `${SWU_BASE}/cards/${encodeURIComponent(externalId || printed)}`,
      externalUpdatedAt: x.updated_at || x.updatedAt || null,
      prices: [],
      metadata: {
        subtitle: x.subtitle || null,
        variant_type: variant || null,
        back_image_url: x.back_image_url || x.backImageUrl || null,
        aspects: x.aspects || [],
        traits: x.traits || [],
        keywords: x.keywords || [],
        cost: x.cost ?? null,
        power: x.power ?? null,
        hp: x.hp ?? null,
        is_unique: x.is_unique ?? x.isUnique ?? null,
        is_leader: x.is_leader ?? x.isLeader ?? null,
        external_uid: x.external_uid || null
      }
    });
  }
  cards._gmxSource = 'SWU API';
  return cards;
}

export const SPECIALIZED_SOURCE_REGISTRY = Object.freeze({
  LORCANA: {
    catalog: [{ code: 'LORCAST', name: 'Lorcast', description: 'Catálogo e imágenes de Disney Lorcana' }],
    images: [{ code: 'LORCAST', name: 'Lorcast' }],
    prices: [{ code: 'LORCAST', name: 'Lorcast' }]
  },
  ONEPIECE: {
    catalog: [{ code: 'OPTCG_API', name: 'OPTCG API', description: 'Catálogo público de One Piece Card Game' }],
    images: [{ code: 'OPTCG_API', name: 'OPTCG API' }],
    prices: [{ code: 'TCGPLAYER', name: 'TCGplayer (vía OPTCG API)' }]
  },
  DIGIMON: {
    catalog: [{ code: 'DIGIMONCARD_API', name: 'DigimonCard.io', description: 'Catálogo público de Digimon Card Game' }],
    images: [],
    prices: []
  },
  SWU: {
    catalog: [{ code: 'SWU_API', name: 'SWU API', description: 'Catálogo público de Star Wars Unlimited' }],
    images: [{ code: 'SWU_API', name: 'SWU API' }],
    prices: []
  }
});

export const SPECIALIZED_PROVIDER_ROWS = Object.freeze([
  {
    gameCode: 'LORCANA', providerCode: 'LORCAST', providerName: 'Lorcast',
    sourceKind: 'API', sourceUrl: LORCAST_BASE, supportsSets: true, supportsCards: true,
    supportsImages: true, supportsPrices: true, requiresApiKey: false
  },
  {
    gameCode: 'ONEPIECE', providerCode: 'OPTCG_API', providerName: 'OPTCG API',
    sourceKind: 'API', sourceUrl: 'https://optcgapi.com/documentation', supportsSets: true, supportsCards: true,
    supportsImages: true, supportsPrices: true, requiresApiKey: false
  },
  {
    gameCode: 'DIGIMON', providerCode: 'DIGIMONCARD_API', providerName: 'DigimonCard.io',
    sourceKind: 'API', sourceUrl: 'https://digimoncard.io/api-documentation', supportsSets: true, supportsCards: true,
    supportsImages: false, supportsPrices: false, requiresApiKey: false
  },
  {
    gameCode: 'SWU', providerCode: 'SWU_API', providerName: 'SWU API',
    sourceKind: 'API', sourceUrl: 'https://www.swuapi.com/docs', supportsSets: true, supportsCards: true,
    supportsImages: true, supportsPrices: false, requiresApiKey: false
  }
]);

export const SPECIALIZED_REMOTE_PROVIDERS = Object.freeze({
  LORCANA: { sets: lorcastSets, cards: lorcastCards },
  ONEPIECE: { sets: onePieceSets, cards: onePieceCards },
  DIGIMON: { sets: digimonSets, cards: digimonCards },
  SWU: { sets: swuSets, cards: swuCards }
});
