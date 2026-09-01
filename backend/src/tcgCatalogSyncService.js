import { SPECIALIZED_REMOTE_PROVIDERS, SPECIALIZED_PROVIDER_ROWS, SPECIALIZED_SOURCE_REGISTRY } from './tcgSpecializedProviders.js';
import { brandText } from "./config/brand.js";import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.dirname(HERE);
const IMAGE_DIR = path.join(BACKEND_DIR, 'storage', 'tcg-images');

const txt = (v) => String(v ?? '').trim();
const hashObject = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const slug = (v) => txt(v).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120);

async function fetchJson(url, { headers = {}, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const host = (() => {try {return new URL(url).host;} catch {return 'remote';}})();
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': "TCG-Store-TCG-Catalog-Sync/10.6.2.3.1",
        ...headers
      },
      signal: ctrl.signal
    });
    if (!response.ok) {
      let detail = '';
      try {detail = String(await response.text()).replace(/\s+/g, ' ').slice(0, 220);} catch {}
      throw new Error(`REMOTE_HTTP_${response.status}:${host}${detail ? `:${detail}` : ''}`);
    }
    try {
      return await response.json();
    } catch (e) {
      throw new Error(`REMOTE_INVALID_JSON:${host}:${String(e.message || e).slice(0, 180)}`);
    }
  } catch (e) {
    if (String(e.message || '').startsWith('REMOTE_')) throw e;
    const code = e?.name === 'AbortError' ? 'REMOTE_TIMEOUT' : 'REMOTE_FETCH_FAILED';
    throw new Error(`${code}:${host}:${String(e?.cause?.message || e.message || e).slice(0, 220)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBuffer(url, { timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': "TCG-Store-TCG-Catalog-Sync/10.6.2.3" },
      signal: ctrl.signal
    });
    if (!response.ok) throw new Error(`IMAGE_HTTP_${response.status}`);
    const ab = await response.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: response.headers.get('content-type') || ''
    };
  } finally {
    clearTimeout(timer);
  }
}

async function cacheImage(gameCode, setCode, externalId, url) {
  if (!url) return '';
  const ext = /png/i.test(url) ? '.png' : /webp/i.test(url) ? '.webp' : '.jpg';
  const dir = path.join(IMAGE_DIR, slug(gameCode), slug(setCode));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${slug(externalId)}${ext}`;
  const full = path.join(dir, filename);
  if (!fs.existsSync(full)) {
    const { buffer } = await fetchBuffer(url);
    if (buffer.length > 12 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    fs.writeFileSync(full, buffer);
  }
  return `/api/public/tcg-images/${encodeURIComponent(slug(gameCode))}/${encodeURIComponent(slug(setCode))}/${encodeURIComponent(filename)}`;
}

function rarityCode(name = '') {
  const clean = txt(name).toUpperCase();
  if (!clean) return '';
  const initials = clean.split(/\s+/).filter(Boolean).map((x) => x[0]).join('').slice(0, 8);
  return initials || clean.replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'RAR';
}

// GMX_TCG_SPECIALIZED_PROVIDERS_R1
let specializedProviderInitPromise = null;
async function ensureSpecializedProviderRows() {
  if (!specializedProviderInitPromise) {
    specializedProviderInitPromise = (async () => {
      for (const p of SPECIALIZED_PROVIDER_ROWS) {
        await query(`INSERT INTO gmx.tcg_sync_providers(
          game_code,provider_code,provider_name,source_kind,official_source_url,status,
          supports_sets,supports_cards,supports_images,supports_prices,requires_api_key)
          VALUES($1,$2,$3,$4,$5,'READY',$6,$7,$8,$9,$10)
          ON CONFLICT(game_code) DO UPDATE SET
            provider_code=EXCLUDED.provider_code,provider_name=EXCLUDED.provider_name,
            source_kind=EXCLUDED.source_kind,official_source_url=EXCLUDED.official_source_url,
            status=CASE WHEN gmx.tcg_sync_providers.status='ERROR' THEN 'ERROR' ELSE 'READY' END,
            supports_sets=EXCLUDED.supports_sets,supports_cards=EXCLUDED.supports_cards,
            supports_images=EXCLUDED.supports_images,supports_prices=EXCLUDED.supports_prices,
            requires_api_key=EXCLUDED.requires_api_key`, [
          p.gameCode,p.providerCode,p.providerName,p.sourceKind,p.sourceUrl,
          p.supportsSets,p.supportsCards,p.supportsImages,p.supportsPrices,p.requiresApiKey
        ]);
        await query(`INSERT INTO gmx.tcg_sync_game_config(game_code) VALUES($1)
          ON CONFLICT(game_code) DO NOTHING`, [p.gameCode]);
      }
      return true;
    })().catch((e) => { specializedProviderInitPromise = null; throw e; });
  }
  return specializedProviderInitPromise;
}

async function providerRow(gameCode) {
  await ensureSpecializedProviderRows();
  const r = await query(`SELECT * FROM gmx.tcg_sync_providers WHERE game_code=$1 LIMIT 1`, [gameCode]);
  if (!r.rowCount) throw new Error('SYNC_PROVIDER_NOT_CONFIGURED');
  return r.rows[0];
}

async function markProvider(gameCode, field, { error = null } = {}) {
  const allowed = new Set(['last_sets_sync_at', 'last_cards_sync_at', 'last_prices_sync_at']);
  if (!allowed.has(field)) return;
  await query(`UPDATE gmx.tcg_sync_providers
    SET ${field}=NOW(),last_error=$2::text,status=CASE WHEN $2::text IS NULL THEN status ELSE 'ERROR' END
    WHERE game_code=$1`, [gameCode, error]);
}

async function clearProviderError(gameCode) {
  await query(`UPDATE gmx.tcg_sync_providers
    SET last_error=NULL,status=CASE WHEN status='ERROR' THEN 'READY' ELSE status END
    WHERE game_code=$1`, [gameCode]);
}

async function upsertMasterSet(client, gameCode, set) {
  const code = txt(set.code);
  if (!code || !txt(set.name)) return;
  await client.query(`INSERT INTO gmx.tcg_master_sets(
    id_juego,codigo,nombre,fecha_lanzamiento,total_cartas,activo,fuente_oficial,fecha_actualizacion)
    VALUES($1,$2,$3,NULLIF($4,'')::date,$5,true,NULLIF($6,''),NOW())
    ON CONFLICT(id_juego,codigo) DO UPDATE SET
      nombre=EXCLUDED.nombre,
      fecha_lanzamiento=COALESCE(EXCLUDED.fecha_lanzamiento,gmx.tcg_master_sets.fecha_lanzamiento),
      total_cartas=GREATEST(EXCLUDED.total_cartas,gmx.tcg_master_sets.total_cartas),
      activo=true,
      fuente_oficial=COALESCE(EXCLUDED.fuente_oficial,gmx.tcg_master_sets.fuente_oficial),
      fecha_actualizacion=NOW()`, [
  gameCode, code, txt(set.name), txt(set.releaseDate), Number(set.total || 0), txt(set.sourceUrl)]
  );
}

async function ensureMasterRarity(client, gameCode, rarity) {
  const name = txt(rarity);
  if (!name) return;
  const code = rarityCode(name);
  await client.query(`INSERT INTO gmx.tcg_master_rarezas(id_juego,codigo,nombre,activo,orden,fecha_actualizacion)
    VALUES($1,$2,$3,true,999,NOW())
    ON CONFLICT(id_juego,codigo) DO UPDATE SET
      nombre=EXCLUDED.nombre,activo=true,fecha_actualizacion=NOW()`, [
  gameCode, code, name]
  );
}

function canonicalCardKey(card) {
  const parts = [
  txt(card.gameCode).toLowerCase(),
  txt(card.setCode).toLowerCase(),
  txt(card.collectorNumber || card.number || '__NO_NUMBER__').toLowerCase(),
  txt(card.name).toLowerCase(),
  txt(card.language || 'en').toLowerCase()];
  if (txt(card.variantKey)) parts.push(txt(card.variantKey).toLowerCase());
  return parts.join('|');
}

async function upsertMasterCard(client, card, { incremental = false } = {}) {
  const comparable = {
    name: card.name || '', number: card.number || '', collectorNumber: card.collectorNumber || '',
    rarity: card.rarity || '', cardType: card.cardType || '', subtype: card.subtype || '',
    artist: card.artist || '', description: card.description || '', language: card.language || 'en',
    imageSmall: card.imageSmall || '', imageLarge: card.imageLarge || '',
    purchaseUrl: card.purchaseUrl || '', sourceUrl: card.sourceUrl || '',
    metadata: card.metadata || {}
  };
  const sourceHash = hashObject(comparable);
  const canonicalKey = canonicalCardKey(card);
  const providerRef = JSON.stringify({ [card.providerCode]: card.externalId });

  const existing = await client.query(`SELECT row_id,source_hash,image_local_url,source_refs
    FROM gmx.tcg_master_cards
    WHERE canonical_key=$1
       OR (provider_code=$2 AND external_id=$3 AND set_code=$4 AND language=$5)
    ORDER BY CASE WHEN canonical_key=$1 THEN 0 ELSE 1 END,row_id
    LIMIT 1`, [
  canonicalKey, card.providerCode, card.externalId, card.setCode, card.language || 'en']
  );

  if (existing.rowCount) {
    const row = existing.rows[0];

    if (incremental && row.source_hash === sourceHash) {
      await client.query(`UPDATE gmx.tcg_master_cards
        SET last_synced_at=NOW(),
            canonical_key=COALESCE(NULLIF(canonical_key,''),$2),
            source_refs=COALESCE(source_refs,'{}'::jsonb)||$3::jsonb
        WHERE row_id=$1`, [row.row_id, canonicalKey, providerRef]);
      return { rowId: row.row_id, changed: false, inserted: false, sourceHash };
    }

    const updated = await client.query(`UPDATE gmx.tcg_master_cards SET
      canonical_key=$2,
      source_refs=COALESCE(source_refs,'{}'::jsonb)||$3::jsonb,
      name=$4,
      number=NULLIF($5,''),
      collector_number=NULLIF($6,''),
      rarity=COALESCE(NULLIF($7,''),rarity),
      card_type=COALESCE(NULLIF($8,''),card_type),
      subtype=COALESCE(NULLIF($9,''),subtype),
      artist=COALESCE(NULLIF($10,''),artist),
      description=COALESCE(NULLIF($11,''),description),
      image_small_url=COALESCE(NULLIF($12,''),image_small_url),
      image_large_url=COALESCE(NULLIF($13,''),image_large_url),
      image_local_url=COALESCE(NULLIF($14,''),image_local_url),
      purchase_url=COALESCE(NULLIF($15,''),purchase_url),
      source_url=COALESCE(NULLIF($16,''),source_url),
      external_updated_at=COALESCE($17,external_updated_at),
      last_synced_at=NOW(),
      metadata=CASE WHEN $18::jsonb='{}'::jsonb THEN metadata ELSE $18::jsonb END,
      source_hash=$19,
      last_catalog_change_at=NOW()
      WHERE row_id=$1
      RETURNING row_id`, [
    row.row_id, canonicalKey, providerRef, card.name, card.number || '', card.collectorNumber || '',
    card.rarity || '', card.cardType || '', card.subtype || '', card.artist || '', card.description || '',
    card.imageSmall || '', card.imageLarge || '', card.imageLocal || '', card.purchaseUrl || '',
    card.sourceUrl || '', card.externalUpdatedAt || null, JSON.stringify(card.metadata || {}), sourceHash]
    );

    return { rowId: updated.rows[0].row_id, changed: true, inserted: false, sourceHash };
  }

  const r = await client.query(`INSERT INTO gmx.tcg_master_cards(
    game_code,provider_code,external_id,set_code,name,number,collector_number,rarity,
    card_type,subtype,artist,description,language,image_small_url,image_large_url,image_local_url,
    purchase_url,source_url,external_updated_at,last_synced_at,metadata,source_hash,
    last_catalog_change_at,canonical_key,source_refs)
    VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),
      NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),$13,NULLIF($14,''),NULLIF($15,''),NULLIF($16,''),
      NULLIF($17,''),NULLIF($18,''),$19,NOW(),$20::jsonb,$21,NOW(),$22,$23::jsonb)
    RETURNING row_id`, [
  card.gameCode, card.providerCode, card.externalId, card.setCode, card.name, card.number || '',
  card.collectorNumber || '', card.rarity || '', card.cardType || '', card.subtype || '', card.artist || '',
  card.description || '', card.language || 'en', card.imageSmall || '', card.imageLarge || '', card.imageLocal || '',
  card.purchaseUrl || '', card.sourceUrl || '', card.externalUpdatedAt || null, JSON.stringify(card.metadata || {}),
  sourceHash, canonicalKey, providerRef]
  );

  return { rowId: r.rows[0].row_id, changed: true, inserted: true, sourceHash };
}

async function upsertPrice(client, masterCardId, p, { incremental = false } = {}) {
  if (!p || !p.provider || !p.currency) return { changed: false };
  const payload = {
    low: n(p.low), mid: n(p.mid), high: n(p.high), market: n(p.market), trend: n(p.trend),
    sourceUrl: txt(p.sourceUrl) || null, providerUpdatedAt: p.providerUpdatedAt || null
  };
  const sourceHash = hashObject(payload);

  const existing = await client.query(`SELECT row_id,source_hash
    FROM gmx.tcg_card_price_current
    WHERE master_card_id=$1 AND price_provider=$2 AND variant=$3 AND currency=$4
    LIMIT 1`, [
  masterCardId, txt(p.provider), txt(p.variant) || 'default', txt(p.currency).toUpperCase()]
  );

  if (existing.rowCount && incremental && existing.rows[0].source_hash === sourceHash) {
    await client.query(`UPDATE gmx.tcg_card_price_current SET fetched_at=NOW() WHERE row_id=$1`, [
    existing.rows[0].row_id]
    );
    return { changed: false };
  }

  const values = [
  masterCardId, txt(p.provider), txt(p.variant) || 'default', txt(p.currency).toUpperCase(),
  payload.low, payload.mid, payload.high, payload.market, payload.trend, payload.sourceUrl,
  payload.providerUpdatedAt, sourceHash];


  await client.query(`INSERT INTO gmx.tcg_card_price_current(
    master_card_id,price_provider,variant,currency,low,mid,high,market,trend,
    source_url,provider_updated_at,fetched_at,source_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12)
    ON CONFLICT(master_card_id,price_provider,variant,currency) DO UPDATE SET
      low=EXCLUDED.low,mid=EXCLUDED.mid,high=EXCLUDED.high,market=EXCLUDED.market,
      trend=EXCLUDED.trend,source_url=EXCLUDED.source_url,
      provider_updated_at=EXCLUDED.provider_updated_at,fetched_at=NOW(),
      source_hash=EXCLUDED.source_hash`, values);

  await client.query(`INSERT INTO gmx.tcg_card_price_history(
    master_card_id,price_provider,variant,currency,low,mid,high,market,trend,
    source_url,provider_updated_at,fetched_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`, values.slice(0, 11));

  return { changed: true };
}

function pokemonPrices(card) {
  const out = [];
  const tcg = card.tcgplayer || {};
  for (const [variant, v] of Object.entries(tcg.prices || {})) {
    out.push({
      provider: 'TCGplayer', variant, currency: 'USD',
      low: v?.low, mid: v?.mid, high: v?.high, market: v?.market,
      sourceUrl: tcg.url, providerUpdatedAt: tcg.updatedAt ? `${String(tcg.updatedAt).replaceAll('/', '-')}T00:00:00Z` : null
    });
  }
  const cm = card.cardmarket || {};
  if (cm.prices) {
    out.push({
      provider: 'Cardmarket', variant: 'normal', currency: 'EUR',
      low: cm.prices.lowPrice, market: cm.prices.averageSellPrice, trend: cm.prices.trendPrice,
      sourceUrl: cm.url, providerUpdatedAt: cm.updatedAt ? `${String(cm.updatedAt).replaceAll('/', '-')}T00:00:00Z` : null
    });
    if (cm.prices.reverseHoloTrend != null || cm.prices.reverseHoloLow != null) {
      out.push({
        provider: 'Cardmarket', variant: 'reverseHolo', currency: 'EUR',
        low: cm.prices.reverseHoloLow, market: cm.prices.reverseHoloSell, trend: cm.prices.reverseHoloTrend,
        sourceUrl: cm.url, providerUpdatedAt: cm.updatedAt ? `${String(cm.updatedAt).replaceAll('/', '-')}T00:00:00Z` : null
      });
    }
  }
  return out;
}

function tcgdexPrices(card) {
  const out = [];
  const pricing = card?.pricing || {};
  const cm = pricing.cardmarket || {};
  if (Object.keys(cm).length) {
    out.push({
      provider: 'Cardmarket', variant: 'normal', currency: cm.unit || 'EUR',
      low: cm.low, market: cm.avg, trend: cm.trend,
      sourceUrl: 'https://www.cardmarket.com/', providerUpdatedAt: cm.updated || null
    });
    if (cm['low-holo'] != null || cm['avg-holo'] != null || cm['trend-holo'] != null) {
      out.push({
        provider: 'Cardmarket', variant: 'holo', currency: cm.unit || 'EUR',
        low: cm['low-holo'], market: cm['avg-holo'], trend: cm['trend-holo'],
        sourceUrl: 'https://www.cardmarket.com/', providerUpdatedAt: cm.updated || null
      });
    }
  }
  const tp = pricing.tcgplayer || {};
  for (const [variant, v] of Object.entries(tp)) {
    if (!v || typeof v !== 'object') continue;
    if (!('lowPrice' in v) && !('marketPrice' in v) && !('midPrice' in v) && !('highPrice' in v)) continue;
    out.push({
      provider: 'TCGplayer', variant, currency: tp.unit || 'USD',
      low: v.lowPrice, mid: v.midPrice, high: v.highPrice, market: v.marketPrice,
      sourceUrl: 'https://www.tcgplayer.com/', providerUpdatedAt: tp.updated || null
    });
  }
  return out;
}

async function mapTcgdexSetId(setCode) {
  // First try the exact ID because most modern IDs are directly compatible.
  try {
    const exact = await fetchJson(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setCode)}`, { timeout: 30000 });
    if (exact?.id) return exact.id;
  } catch {}

  // If the primary Pokémon API and TCGdex use different IDs, map by the
  // master set name instead of guessing.
  const master = await query(`SELECT nombre FROM gmx.tcg_master_sets
    WHERE id_juego='POKEMON' AND codigo=$1 LIMIT 1`, [setCode]);
  const wanted = String(master.rows[0]?.nombre || '').trim().toLowerCase();
  if (!wanted) return setCode;

  const sets = await fetchJson('https://api.tcgdex.net/v2/en/sets', { timeout: 30000 });
  const hit = (Array.isArray(sets) ? sets : []).find((x) => String(x.name || '').trim().toLowerCase() === wanted);
  return hit?.id || setCode;
}

async function tcgdexPokemonCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  const tcgdexSetId = await mapTcgdexSetId(setCode);
  const set = await fetchJson(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(tcgdexSetId)}`, { timeout: 45000 });
  const briefs = Array.isArray(set?.cards) ? set.cards : [];
  if (!briefs.length) throw new Error(`TCGDEX_SET_HAS_NO_CARDS:${tcgdexSetId}`);

  const cards = [];
  const concurrency = 8;
  for (let start = 0; start < briefs.length; start += concurrency) {
    const batch = briefs.slice(start, start + concurrency);
    const full = await Promise.all(batch.map(async (brief) => {
      const x = await fetchJson(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(brief.id)}`, { timeout: 30000 });
      const base = String(x.image || brief.image || '').replace(/\/$/, '');
      const imageSmall = base ? `${base}/low.webp` : '';
      const imageLarge = base ? `${base}/high.webp` : '';
      let local = '';
      if (downloadImages && imageLarge) {
        try {local = await cacheImage('POKEMON', setCode, x.id, imageLarge);} catch {}
      }
      return {
        gameCode: 'POKEMON', providerCode: 'TCGDEX', externalId: String(x.id),
        setCode, name: x.name || brief.name,
        number: String(x.localId || brief.localId || ''),
        collectorNumber: String(x.localId || brief.localId || ''),
        rarity: x.rarity || '', cardType: x.category || 'Pokemon',
        subtype: Array.isArray(x.types) ? x.types.join(' / ') : '',
        artist: x.illustrator || '', description: '',
        language: 'en', imageSmall, imageLarge, imageLocal: local,
        purchaseUrl: '', sourceUrl: `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(x.id)}`,
        externalUpdatedAt: null,
        prices: syncPrices ? tcgdexPrices(x) : [],
        metadata: {
          tcgdexSetId,
          hp: x.hp, types: x.types, stage: x.stage, suffix: x.suffix,
          regulationMark: x.regulationMark, legal: x.legal
        }
      };
    }));
    cards.push(...full);
  }
  cards._shinySource = 'TCGdex';
  return cards;
}

function scryfallPrices(card) {
  const out = [];
  const p = card.prices || {};
  if (p.usd != null) out.push({ provider: 'Scryfall', variant: 'normal', currency: 'USD', market: p.usd, sourceUrl: card.purchase_uris?.tcgplayer || card.scryfall_uri });
  if (p.usd_foil != null) out.push({ provider: 'Scryfall', variant: 'foil', currency: 'USD', market: p.usd_foil, sourceUrl: card.purchase_uris?.tcgplayer || card.scryfall_uri });
  if (p.usd_etched != null) out.push({ provider: 'Scryfall', variant: 'etched', currency: 'USD', market: p.usd_etched, sourceUrl: card.purchase_uris?.tcgplayer || card.scryfall_uri });
  if (p.eur != null) out.push({ provider: 'Scryfall', variant: 'normal', currency: 'EUR', market: p.eur, sourceUrl: card.purchase_uris?.cardmarket || card.scryfall_uri });
  if (p.eur_foil != null) out.push({ provider: 'Scryfall', variant: 'foil', currency: 'EUR', market: p.eur_foil, sourceUrl: card.purchase_uris?.cardmarket || card.scryfall_uri });
  return out;
}

function ygoPrices(card, setEntry) {
  const out = [];
  const prices = (card.card_prices || [])[0] || {};
  const add = (provider, currency, value, url = '') => {
    if (value != null && value !== '' && Number(value) > 0) out.push({
      provider, variant: 'lowest', currency, market: Number(value), sourceUrl: url
    });
  };
  add('TCGplayer', 'USD', prices.tcgplayer_price);
  add('Cardmarket', 'EUR', prices.cardmarket_price);
  add('eBay', 'USD', prices.ebay_price);
  add('Amazon', 'USD', prices.amazon_price);
  add('CoolStuffInc', 'USD', prices.coolstuffinc_price);
  if (setEntry?.set_price) out.push({
    provider: 'YGOPRODeck Set', variant: setEntry.set_rarity || 'set', currency: 'USD',
    market: Number(setEntry.set_price) || null
  });
  return out;
}

async function pokemonSets() {
  const headers = {};
  if (process.env.SHINY_POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.SHINY_POKEMON_TCG_API_KEY;

  try {
    let page = 1,all = [];
    while (true) {
      const j = await fetchJson(`https://api.pokemontcg.io/v2/sets?page=${page}&pageSize=250&orderBy=-releaseDate`, { headers });
      all.push(...(j.data || []));
      if (all.length >= Number(j.totalCount || all.length) || !(j.data || []).length) break;
      page++;
    }
    const sets = all.map((x) => ({
      code: x.id, name: x.name, releaseDate: txt(x.releaseDate).replaceAll('/', '-'),
      total: Number(x.total || x.printedTotal || 0),
      sourceUrl: `https://api.pokemontcg.io/v2/sets/${encodeURIComponent(x.id)}`
    }));
    sets._shinySource = 'Pokémon TCG API';
    return sets;
  } catch (primaryError) {
    // Fallback: TCGdex is an open Pokémon catalog API and does not require an API key.
    try {
      const all = await fetchJson('https://api.tcgdex.net/v2/en/sets', { timeout: 30000 });
      const sets = (Array.isArray(all) ? all : []).map((x) => ({
        code: txt(x.id), name: txt(x.name), releaseDate: '',
        total: Number(x.cardCount?.total || x.cardCount?.official || 0),
        sourceUrl: `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(x.id)}`
      })).filter((x) => x.code && x.name);
      sets._shinySource = 'TCGdex fallback';
      sets._shinyPrimaryError = String(primaryError.message || primaryError);
      return sets;
    } catch (fallbackError) {
      throw new Error(
        `POKEMON_SET_SYNC_UNAVAILABLE:primary=${String(primaryError.message || primaryError).slice(0, 260)};fallback=${String(fallbackError.message || fallbackError).slice(0, 260)}`
      );
    }
  }
}

async function pokemonCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  const headers = {};
  if (process.env.SHINY_POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.SHINY_POKEMON_TCG_API_KEY;

  try {
    let page = 1,all = [];
    while (true) {
      const q = encodeURIComponent(`set.id:${setCode}`);
      const j = await fetchJson(`https://api.pokemontcg.io/v2/cards?q=${q}&page=${page}&pageSize=250`, { headers, timeout: 45000 });
      all.push(...(j.data || []));
      if (all.length >= Number(j.totalCount || all.length) || !(j.data || []).length) break;
      page++;
    }
    if (!all.length) throw new Error(`POKEMON_API_SET_HAS_NO_CARDS:${setCode}`);

    const cards = [];
    for (const x of all) {
      let local = '';
      if (downloadImages && x.images?.large) {
        try {local = await cacheImage('POKEMON', setCode, x.id, x.images.large);} catch {}
      }
      cards.push({
        gameCode: 'POKEMON', providerCode: 'POKEMON_TCG_API', externalId: String(x.id),
        setCode, name: x.name, number: x.number, collectorNumber: x.number, rarity: x.rarity,
        cardType: x.supertype, subtype: (x.subtypes || []).join(' / '), artist: x.artist,
        description: (x.rules || []).join('\n'), language: 'en',
        imageSmall: x.images?.small, imageLarge: x.images?.large, imageLocal: local,
        purchaseUrl: x.tcgplayer?.url || x.cardmarket?.url,
        sourceUrl: `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(x.id)}`,
        externalUpdatedAt: x.updatedAt ? `${String(x.updatedAt).split(' ')[0].replaceAll('/', '-')}T00:00:00Z` : null,
        prices: syncPrices ? pokemonPrices(x) : [],
        metadata: { hp: x.hp, types: x.types, legalities: x.legalities, regulationMark: x.regulationMark }
      });
    }
    cards._shinySource = 'Pokémon TCG API';
    return cards;
  } catch (primaryError) {
    try {
      const cards = await tcgdexPokemonCards(setCode, { downloadImages, syncPrices });
      cards._shinyPrimaryError = String(primaryError.message || primaryError);
      return cards;
    } catch (fallbackError) {
      throw new Error(
        `POKEMON_CARD_SYNC_UNAVAILABLE:set=${setCode};primary=${String(primaryError.message || primaryError).slice(0, 260)};fallback=${String(fallbackError.message || fallbackError).slice(0, 260)}`
      );
    }
  }
}

async function magicSets() {
  const j = await fetchJson('https://api.scryfall.com/sets');
  return (j.data || []).filter((x) => !x.digital).map((x) => ({
    code: x.code, name: x.name, releaseDate: x.released_at, total: Number(x.card_count || 0),
    sourceUrl: x.scryfall_uri || x.uri
  }));
}

async function magicCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${setCode}`)}&unique=prints&order=set&dir=asc&include_extras=true`;
  const all = [];
  while (url) {
    const j = await fetchJson(url, { timeout: 45000 });
    all.push(...(j.data || []));
    url = j.has_more ? j.next_page : null;
    if (url) await new Promise((r) => setTimeout(r, 120));
  }
  const cards = [];
  for (const x of all) {
    const image = x.image_uris || x.card_faces?.[0]?.image_uris || {};
    let local = '';
    if (downloadImages && image.large) {
      try {local = await cacheImage('MAGIC', setCode, x.id, image.large);} catch {}
    }
    cards.push({
      gameCode: 'MAGIC', providerCode: 'SCRYFALL', externalId: String(x.id),
      setCode, name: x.name, number: x.collector_number, collectorNumber: x.collector_number,
      rarity: x.rarity ? String(x.rarity).replace(/\b\w/g, (c) => c.toUpperCase()) : '',
      cardType: x.type_line, subtype: '', artist: x.artist,
      description: x.oracle_text || x.card_faces?.map((f) => f.oracle_text).filter(Boolean).join('\n---\n') || '',
      language: x.lang || 'en', imageSmall: image.small, imageLarge: image.large, imageLocal: local,
      purchaseUrl: x.purchase_uris?.tcgplayer || x.purchase_uris?.cardmarket || x.scryfall_uri,
      sourceUrl: x.scryfall_uri || x.uri,
      externalUpdatedAt: null, prices: syncPrices ? scryfallPrices(x) : [],
      metadata: { mana_cost: x.mana_cost, colors: x.colors, finishes: x.finishes, frame_effects: x.frame_effects }
    });
  }
  return cards;
}

async function yugiohSets() {
  const j = await fetchJson('https://db.ygoprodeck.com/api/v7/cardsets.php', { timeout: 45000 });
  const rows = Array.isArray(j) ? j : [];
  const counts = new Map();
  for (const x of rows) {
    const base = txt(x.set_code) || slug(x.set_name).toUpperCase();
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  return rows.map((x) => {
    const base = txt(x.set_code) || slug(x.set_name).toUpperCase();
    const code = (counts.get(base) || 0) > 1 ?
    `${base}-${slug(x.set_name).toUpperCase().slice(0, 48)}` :
    base;
    return {
      code, name: x.set_name, releaseDate: x.tcg_date || '', total: Number(x.num_of_cards || 0),
      sourceUrl: 'https://db.ygoprodeck.com/api/v7/cardsets.php',
      providerSetName: x.set_name,
      providerBaseCode: base
    };
  });
}

async function yugiohCards(setCode, { downloadImages = false, syncPrices = true } = {}) {
  const master = await query(`SELECT * FROM gmx.tcg_master_sets WHERE id_juego='YUGIOH' AND codigo=$1 LIMIT 1`, [setCode]);
  if (!master.rowCount) throw new Error('SET_NOT_FOUND_IN_MASTER');
  const setName = master.rows[0].nombre;
  const j = await fetchJson(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(setName)}`, { timeout: 60000 });
  const all = j.data || [];
  const cards = [];
  for (const x of all) {
    const setEntry = (x.card_sets || []).find((s) => String(s.set_name).toLowerCase() === String(setName).toLowerCase()) || (x.card_sets || [])[0] || {};
    const image = (x.card_images || [])[0] || {};
    let local = '';
    if (downloadImages && image.image_url) {
      try {local = await cacheImage('YUGIOH', setCode, x.id, image.image_url);} catch {}
    }
    cards.push({
      gameCode: 'YUGIOH', providerCode: 'YGOPRODECK', externalId: String(x.id),
      setCode, name: x.name, number: setEntry.set_code || String(x.id),
      collectorNumber: setEntry.set_code || '', rarity: setEntry.set_rarity || '',
      cardType: x.type, subtype: x.race || '', artist: '', description: x.desc || '', language: 'en',
      imageSmall: image.image_url_small, imageLarge: image.image_url, imageLocal: local,
      purchaseUrl: '', sourceUrl: `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(x.id)}`,
      prices: syncPrices ? ygoPrices(x, setEntry) : [],
      metadata: { atk: x.atk, def: x.def, level: x.level, attribute: x.attribute, archetype: x.archetype }
    });
  }
  return cards;
}


const SOURCE_REGISTRY = {
  ...SPECIALIZED_SOURCE_REGISTRY,
  POKEMON: {
    catalog: [
    { code: 'AUTO', name: 'Automático', description: 'Pokémon TCG API con TCGdex como respaldo' },
    { code: 'POKEMON_TCG_API', name: 'Pokémon TCG API', description: 'Forzar Pokémon TCG API' },
    { code: 'TCGDEX', name: 'TCGdex', description: 'Forzar TCGdex' }],

    images: [
    { code: 'AUTO', name: 'Automático', description: 'Usar la imagen de la fuente de catálogo elegida' },
    { code: 'CATALOG', name: 'Fuente de catálogo', description: 'Usar la imagen entregada por la fuente de catálogo' }],

    prices: [
    { code: 'TCGPLAYER', name: 'TCGplayer' },
    { code: 'CARDMARKET', name: 'Cardmarket' },
    { code: 'COLLECTR', name: 'Collectr', requiresCredential: true, credentialEnv: 'SHINY_COLLECTR_API_KEY' }]

  },
  MAGIC: {
    catalog: [{ code: 'SCRYFALL', name: 'Scryfall', description: 'Catálogo disponible para Magic' }],
    images: [{ code: 'SCRYFALL', name: 'Scryfall' }],
    prices: [
    { code: 'SCRYFALL', name: 'Scryfall' },
    { code: 'COLLECTR', name: 'Collectr', requiresCredential: true, credentialEnv: 'SHINY_COLLECTR_API_KEY' }]

  },
  YUGIOH: {
    catalog: [{ code: 'YGOPRODECK', name: 'YGOPRODeck', description: 'Catálogo disponible para Yu-Gi-Oh!' }],
    images: [{ code: 'YGOPRODECK', name: 'YGOPRODeck' }],
    prices: [
    { code: 'TCGPLAYER', name: 'TCGplayer' },
    { code: 'CARDMARKET', name: 'Cardmarket' },
    { code: 'EBAY', name: 'eBay' },
    { code: 'AMAZON', name: 'Amazon' },
    { code: 'COOLSTUFFINC', name: 'CoolStuffInc' },
    { code: 'YGOPRODECK_SET', name: 'YGOPRODeck Set' },
    { code: 'COLLECTR', name: 'Collectr', requiresCredential: true, credentialEnv: 'SHINY_COLLECTR_API_KEY' }]

  }
};

function sourceOptionStatus(option) {
  if (!option?.requiresCredential) return { ...option, configured: true, enabled: true };
  const configured = Boolean(process.env[option.credentialEnv || '']);
  return { ...option, configured, enabled: configured };
}

function availableSourceRegistry(gameCode) {
  const raw = SOURCE_REGISTRY[gameCode] || { catalog: [], images: [], prices: [] };
  return {
    catalog: raw.catalog.map(sourceOptionStatus),
    images: raw.images.map(sourceOptionStatus),
    prices: raw.prices.map(sourceOptionStatus)
  };
}

function normalizeSourcePreferences(gameCode, prefs = {}) {
  const available = availableSourceRegistry(gameCode);
  const catalogCodes = new Set(available.catalog.filter((x) => x.enabled !== false).map((x) => x.code));
  const imageCodes = new Set(available.images.filter((x) => x.enabled !== false).map((x) => x.code));
  const priceCodes = new Set(available.prices.filter((x) => x.enabled !== false).map((x) => x.code));
  const defaultCatalog = available.catalog.some((x) => x.code === 'AUTO') ? 'AUTO' : available.catalog[0]?.code || 'AUTO';
  const defaultImage = available.images.some((x) => x.code === 'AUTO') ? 'AUTO' : available.images[0]?.code || 'AUTO';
  const requestedPrices = Array.isArray(prefs.priceSources) ? prefs.priceSources.map((x) => String(x || '').toUpperCase()) : [];
  return {
    catalogSource: catalogCodes.has(String(prefs.catalogSource || '').toUpperCase()) ? String(prefs.catalogSource).toUpperCase() : defaultCatalog,
    imageSource: imageCodes.has(String(prefs.imageSource || '').toUpperCase()) ? String(prefs.imageSource).toUpperCase() : defaultImage,
    priceSources: (requestedPrices.length ? requestedPrices : available.prices.filter((x) => x.enabled !== false).map((x) => x.code)).filter((x) => priceCodes.has(x)),
    allowFallback: prefs.allowFallback !== false
  };
}

async function sourcePreferences(gameCode) {
  await ensureSpecializedProviderRows();
  const r = await query(`SELECT source_preferences FROM gmx.tcg_sync_game_config WHERE game_code=$1 LIMIT 1`, [gameCode]);
  return normalizeSourcePreferences(gameCode, r.rows[0]?.source_preferences || {});
}

function filterPricesByPreference(prices, prefs) {
  if (!Array.isArray(prices)) return [];
  const allowed = new Set((prefs.priceSources || []).map((x) => String(x).toUpperCase()));
  if (!allowed.size) return [];
  return prices.filter((p) => {
    const code = String(p.provider || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    return allowed.has(code);
  });
}

async function pokemonSetsByPreference(prefs) {
  if (prefs.catalogSource === 'TCGDEX') {
    const all = await fetchJson('https://api.tcgdex.net/v2/en/sets', { timeout: 30000 });
    const sets = (Array.isArray(all) ? all : []).map((x) => ({
      code: txt(x.id), name: txt(x.name), releaseDate: '',
      total: Number(x.cardCount?.total || x.cardCount?.official || 0),
      sourceUrl: `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(x.id)}`
    })).filter((x) => x.code && x.name);
    sets._shinySource = 'TCGdex';
    return sets;
  }
  if (prefs.catalogSource === 'POKEMON_TCG_API') {
    const headers = {};
    if (process.env.SHINY_POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.SHINY_POKEMON_TCG_API_KEY;
    let page = 1,all = [];
    while (true) {
      const j = await fetchJson(`https://api.pokemontcg.io/v2/sets?page=${page}&pageSize=250&orderBy=-releaseDate`, { headers });
      all.push(...(j.data || []));
      if (all.length >= Number(j.totalCount || all.length) || !(j.data || []).length) break;
      page++;
    }
    const sets = all.map((x) => ({
      code: x.id, name: x.name, releaseDate: txt(x.releaseDate).replaceAll('/', '-'),
      total: Number(x.total || x.printedTotal || 0),
      sourceUrl: `https://api.pokemontcg.io/v2/sets/${encodeURIComponent(x.id)}`
    }));
    sets._shinySource = 'Pokémon TCG API';
    return sets;
  }
  return pokemonSets();
}

async function pokemonCardsByPreference(setCode, opts, prefs) {
  let cards;
  if (prefs.catalogSource === 'TCGDEX') {
    cards = await tcgdexPokemonCards(setCode, opts);
    cards._shinySource = 'TCGdex';
  } else if (prefs.catalogSource === 'POKEMON_TCG_API') {
    const headers = {};
    if (process.env.SHINY_POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.SHINY_POKEMON_TCG_API_KEY;
    let page = 1,all = [];
    while (true) {
      const q = encodeURIComponent(`set.id:${setCode}`);
      const j = await fetchJson(`https://api.pokemontcg.io/v2/cards?q=${q}&page=${page}&pageSize=250`, { headers, timeout: 45000 });
      all.push(...(j.data || []));
      if (all.length >= Number(j.totalCount || all.length) || !(j.data || []).length) break;
      page++;
    }
    if (!all.length) throw new Error(`POKEMON_API_SET_HAS_NO_CARDS:${setCode}`);
    cards = [];
    for (const x of all) {
      let local = '';
      if (opts.downloadImages && x.images?.large) {
        try {local = await cacheImage('POKEMON', setCode, x.id, x.images.large);} catch {}
      }
      cards.push({
        gameCode: 'POKEMON', providerCode: 'POKEMON_TCG_API', externalId: String(x.id),
        setCode, name: x.name, number: x.number, collectorNumber: x.number, rarity: x.rarity,
        cardType: x.supertype, subtype: (x.subtypes || []).join(' / '), artist: x.artist,
        description: (x.rules || []).join('\n'), language: 'en',
        imageSmall: x.images?.small, imageLarge: x.images?.large, imageLocal: local,
        purchaseUrl: x.tcgplayer?.url || x.cardmarket?.url,
        sourceUrl: `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(x.id)}`,
        externalUpdatedAt: x.updatedAt ? `${String(x.updatedAt).split(' ')[0].replaceAll('/', '-')}T00:00:00Z` : null,
        prices: opts.syncPrices ? pokemonPrices(x) : [],
        metadata: { hp: x.hp, types: x.types, legalities: x.legalities, regulationMark: x.regulationMark }
      });
    }
    cards._shinySource = 'Pokémon TCG API';
  } else {
    cards = await pokemonCards(setCode, opts);
  }
  for (const c of cards) c.prices = filterPricesByPreference(c.prices, prefs);
  return cards;
}

export function listAvailableSources(gameCode = '') {
  if (gameCode) return availableSourceRegistry(gameCode);
  return Object.fromEntries(Object.keys(SOURCE_REGISTRY).map((code) => [code, availableSourceRegistry(code)]));
}

export async function getSourcePreferences(gameCode) {
  return sourcePreferences(gameCode);
}

export async function saveSourcePreferences(gameCode, input = {}) {
  const prefs = normalizeSourcePreferences(gameCode, input);
  await query(`INSERT INTO gmx.tcg_sync_game_config(
    game_code,enabled,region,language,sync_cards,sync_prices,download_images,
    selected_sets,auto_sync_enabled,auto_sync_frequency,source_preferences,updated_at)
    VALUES($1,true,'NA_LATAM','en',true,true,false,'[]'::jsonb,false,'WEEKLY',$2::jsonb,NOW())
    ON CONFLICT(game_code) DO UPDATE SET source_preferences=EXCLUDED.source_preferences,updated_at=NOW()`,
  [gameCode, JSON.stringify(prefs)]);
  return prefs;
}

const REMOTE_PROVIDERS = {
  ...SPECIALIZED_REMOTE_PROVIDERS,
  POKEMON: { sets: pokemonSets, cards: pokemonCards },
  MAGIC: { sets: magicSets, cards: magicCards },
  YUGIOH: { sets: yugiohSets, cards: yugiohCards }
};

export async function listSyncProviders() {
  await ensureSpecializedProviderRows();
  return query(`SELECT p.*,m.nombre AS game_name,m.publisher,
      c.enabled,c.region,c.language,c.sync_cards,c.sync_prices,c.download_images,
      c.selected_sets,c.auto_sync_enabled,c.auto_sync_frequency,c.source_preferences,c.updated_at AS config_updated_at,
      COALESCE(
        NULLIF(c.source_preferences->>'usdMxnRate','')::numeric,
        CASE p.game_code
          WHEN 'POKEMON' THEN 15
          WHEN 'YUGIOH' THEN 17
          WHEN 'MAGIC' THEN 21
          WHEN 'RIFTBOUND' THEN 30
          ELSE NULL
        END
      ) AS usd_mxn_rate,
      (SELECT COUNT(*)::bigint FROM gmx.tcg_master_sets s WHERE s.id_juego=p.game_code AND s.activo=true) AS master_sets,
      (SELECT COUNT(*)::bigint FROM gmx.tcg_master_cards mc WHERE mc.game_code=p.game_code) AS master_cards
    FROM gmx.tcg_sync_providers p
    LEFT JOIN gmx.tcg_master_juegos m ON m.codigo=p.game_code
    LEFT JOIN gmx.tcg_sync_game_config c ON c.game_code=p.game_code
    ORDER BY COALESCE(m.orden,999999),m.nombre,p.game_code`);
}

export async function getSyncSets(gameCode) {
  return query(`SELECT s.*,
      COALESCE((c.selected_sets ? s.codigo),false) AS selected,
      (SELECT COUNT(*)::bigint FROM gmx.tcg_master_cards mc
        WHERE mc.game_code=s.id_juego AND mc.set_code=s.codigo) AS synced_cards
    FROM gmx.tcg_master_sets s
    LEFT JOIN gmx.tcg_sync_game_config c ON c.game_code=s.id_juego
    WHERE s.id_juego=$1 AND s.activo=true
    ORDER BY COALESCE(s.fecha_lanzamiento,'1900-01-01'::date) DESC,s.nombre`, [gameCode]);
}

export async function updateSyncConfig(gameCode, input = {}) {
  const selected = Array.isArray(input.selectedSets) ? input.selectedSets.map(txt).filter(Boolean) : [];
  const r = await query(`INSERT INTO gmx.tcg_sync_game_config(
    game_code,enabled,region,language,sync_cards,sync_prices,download_images,
    selected_sets,auto_sync_enabled,auto_sync_frequency,source_preferences,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,NOW())
    ON CONFLICT(game_code) DO UPDATE SET
      enabled=EXCLUDED.enabled,region=EXCLUDED.region,language=EXCLUDED.language,
      sync_cards=EXCLUDED.sync_cards,sync_prices=EXCLUDED.sync_prices,
      download_images=EXCLUDED.download_images,selected_sets=EXCLUDED.selected_sets,
      auto_sync_enabled=EXCLUDED.auto_sync_enabled,
      auto_sync_frequency=EXCLUDED.auto_sync_frequency,
      source_preferences=COALESCE(EXCLUDED.source_preferences,gmx.tcg_sync_game_config.source_preferences),
      updated_at=NOW()
    RETURNING *`, [
  gameCode, input.enabled === true, txt(input.region) || 'NA_LATAM', txt(input.language) || 'en',
  input.syncCards !== false, input.syncPrices !== false, input.downloadImages === true,
  JSON.stringify(selected), input.autoSyncEnabled === true, txt(input.autoSyncFrequency) || 'WEEKLY',
  JSON.stringify(normalizeSourcePreferences(gameCode, input.sourcePreferences || {}))]
  );
  return r.rows[0];
}

export async function syncGameSets(gameCode) {
  const provider = await providerRow(gameCode);
  const remote = REMOTE_PROVIDERS[gameCode];
  try {
    if (!remote?.sets) {
      // Catalog-only TCGs still work: their master sets are already managed by official/manual import.
      await markProvider(gameCode, 'last_sets_sync_at');
      await clearProviderError(gameCode);
      const r = await query(`SELECT COUNT(*)::bigint total FROM gmx.tcg_master_sets WHERE id_juego=$1 AND activo=true`, [gameCode]);
      return { gameCode, mode: 'MASTER_CATALOG', sets: Number(r.rows[0]?.total || 0), provider: provider.provider_name };
    }
    const prefs = await sourcePreferences(gameCode);
    let sets;
    if (gameCode === 'POKEMON') {
      try {sets = await pokemonSetsByPreference(prefs);}
      catch (e) {
        if (!prefs.allowFallback || prefs.catalogSource === 'AUTO') throw e;
        sets = await pokemonSets();
        sets._shinyPrimaryError = String(e.message || e);
      }
    } else {
      sets = await remote.sets();
    }
    const sourceUsed = sets?._shinySource || provider.provider_name;
    const primaryError = sets?._shinyPrimaryError || null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const set of sets) await upsertMasterSet(client, gameCode, set);
      await client.query('COMMIT');
    } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
    await markProvider(gameCode, 'last_sets_sync_at');
    await clearProviderError(gameCode);
    return {
      gameCode, mode: 'REMOTE_API', sets: sets.length, provider: provider.provider_name,
      sourceUsed, warning: primaryError ? `Fuente principal no disponible; se utilizó ${sourceUsed}.` : null
    };
  } catch (e) {
    await query(`UPDATE gmx.tcg_sync_providers SET last_error=$2,status='ERROR' WHERE game_code=$1`, [gameCode, String(e.message || e).slice(0, 500)]);
    throw e;
  }
}

export async function syncSelectedCards(gameCode, { setCodes = [], downloadImages = false, syncPrices = true, onProgress = null, incremental = true } = {}) {
  const provider = await providerRow(gameCode);
  const remote = REMOTE_PROVIDERS[gameCode];
  if (!remote?.cards) throw new Error('PROVIDER_CARDS_NOT_AVAILABLE');
  const prefs = await sourcePreferences(gameCode);

  const selected = [...new Set((setCodes || []).map(txt).filter(Boolean))];
  if (!selected.length) throw new Error('SELECT_AT_LEAST_ONE_SET');

  const known = await query(`SELECT codigo,COALESCE(total_cartas,0)::int AS total_cartas
    FROM gmx.tcg_master_sets
    WHERE id_juego=$1 AND codigo=ANY($2::text[]) AND activo=true`, [gameCode, selected]);
  const valid = new Set(known.rows.map((x) => x.codigo));
  const estimatedBySet = new Map(known.rows.map((x) => [x.codigo, Number(x.total_cartas || 0)]));
  const estimatedCards = Math.max(
    known.rows.reduce((sum, x) => sum + Number(x.total_cartas || 0), 0),
    selected.length
  );
  let processedCards = 0;
  let processedSets = 0;
  const notify = async (payload) => {
    if (typeof onProgress !== 'function') return;
    try {await onProgress({
        selectedSets: selected.length,
        processedSets,
        estimatedCards,
        processedCards,
        ...payload
      });} catch {}
  };
  await notify({ phase: 'starting', setCode: null, message: 'Preparando sincronización de cartas…' });
  const invalid = selected.filter((x) => !valid.has(x));
  if (invalid.length) throw new Error(`UNKNOWN_SET:${invalid.join(',')}`);

  const result = {
    gameCode, provider: provider.provider_name, sets: [], cards: 0, prices: 0, errors: [],
    insertedCards: 0, updatedCards: 0, unchangedCards: 0, updatedPrices: 0, unchangedPrices: 0
  };
  for (const setCode of selected) {
    try {
      await notify({
        phase: 'fetching_set',
        setCode,
        setEstimatedCards: Number(estimatedBySet.get(setCode) || 0),
        message: `Descargando ${setCode}…`
      });
      const effectiveDownloadImages = gameCode === 'YUGIOH' ? true : downloadImages;
      let cards;
      if (gameCode === 'POKEMON') {
        try {
          cards = await pokemonCardsByPreference(setCode, { downloadImages: effectiveDownloadImages, syncPrices }, prefs);
        } catch (e) {
          if (!prefs.allowFallback || prefs.catalogSource === 'AUTO') throw e;
          cards = await pokemonCards(setCode, { downloadImages: effectiveDownloadImages, syncPrices });
          cards._shinyPrimaryError = String(e.message || e);
          for (const c of cards) c.prices = filterPricesByPreference(c.prices, prefs);
        }
      } else {
        cards = await remote.cards(setCode, { downloadImages: effectiveDownloadImages, syncPrices });
        for (const c of cards) c.prices = filterPricesByPreference(c.prices, prefs);
      }
      await notify({
        phase: 'saving_cards',
        setCode,
        setActualCards: cards.length,
        message: `Guardando ${cards.length} carta(s) de ${setCode}…`
      });
      const client = await pool.connect();
      let setCards = 0,setPrices = 0;
      try {
        await client.query('BEGIN');
        for (const card of cards) {
          await ensureMasterRarity(client, gameCode, card.rarity);
          const cardResult = await upsertMasterCard(client, card, { incremental });
          const id = cardResult.rowId;
          if (cardResult.inserted) result.insertedCards++;else
          if (cardResult.changed) result.updatedCards++;else
          result.unchangedCards++;

          for (const price of card.prices || []) {
            const priceResult = await upsertPrice(client, id, price, { incremental });
            if (priceResult.changed) {setPrices++;result.updatedPrices++;} else
            result.unchangedPrices++;
          }
          setCards++;
          processedCards++;
          if (setCards === 1 || setCards % 10 === 0 || setCards === cards.length) {
            await notify({
              phase: 'saving_cards',
              setCode,
              setActualCards: cards.length,
              setProcessedCards: setCards,
              message: `${setCode}: ${setCards}/${cards.length} cartas guardadas`
            });
          }
        }
        await client.query('COMMIT');
      } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
      result.cards += setCards;result.prices += setPrices;
      processedSets++;
      result.sets.push({
        setCode, cards: setCards, prices: setPrices,
        sourceUsed: cards?._shinySource || provider.provider_name,
        warning: cards?._shinyPrimaryError ? `Fuente principal no disponible: ${String(cards._shinyPrimaryError).slice(0, 220)}` : null
      });
      await notify({
        phase: 'set_complete', setCode, setActualCards: setCards,
        message: `${setCode} completada: ${setCards} cartas`
      });
    } catch (e) {
      processedSets++;
      result.errors.push({ setCode, error: String(e.message || e).slice(0, 500) });
      await notify({
        phase: 'set_error', setCode,
        message: `${setCode}: ${String(e.message || e).slice(0, 220)}`
      });
    }
  }

  await query(`UPDATE gmx.tcg_sync_game_config SET
    enabled=true,selected_sets=$2::jsonb,sync_prices=$3,download_images=$4,updated_at=NOW()
    WHERE game_code=$1`, [gameCode, JSON.stringify(selected), syncPrices === true, downloadImages === true]);

  await markProvider(gameCode, 'last_cards_sync_at', { error: result.errors.length ? JSON.stringify(result.errors.slice(0, 5)) : null });
  if (syncPrices) await markProvider(gameCode, 'last_prices_sync_at', { error: result.errors.length ? JSON.stringify(result.errors.slice(0, 5)) : null });
  if (!result.errors.length) await clearProviderError(gameCode);
  await notify({ phase: 'sync_complete', message: 'Sincronización de cartas terminada.' });
  return result;
}

export async function installSelectedToOperational(gameCode, setCodes = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const masterGame = await client.query(`SELECT * FROM gmx.tcg_master_juegos WHERE codigo=$1 AND activo=true LIMIT 1`, [gameCode]);
    if (!masterGame.rowCount) throw new Error('MASTER_GAME_NOT_FOUND');
    const game = masterGame.rows[0];

    let local = (await client.query(`SELECT * FROM gmx.tcg_juegos WHERE catalogo_codigo=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [gameCode])).rows[0];
    if (!local) {
      local = (await client.query(`INSERT INTO gmx.tcg_juegos(
        id_juego,nombre,codigo,catalogo_codigo,publisher,sitio_oficial,activo,visible_portal,orden)
        VALUES($1,$2,$3,$3,$4,$5,true,false,$6) RETURNING *`, [
      `TCGJ-${gameCode}`, game.nombre, gameCode, game.publisher, game.sitio_oficial, game.orden]
      )).rows[0];
    }

    const selected = [...new Set((setCodes || []).map(txt).filter(Boolean))];
    if (!selected.length) throw new Error('SELECT_AT_LEAST_ONE_SET');

    const sets = await client.query(`SELECT * FROM gmx.tcg_master_sets
      WHERE id_juego=$1 AND codigo=ANY($2::text[]) AND activo=true`, [gameCode, selected]);

    for (const set of sets.rows) {
      const existing = await client.query(`SELECT row_id FROM gmx.tcg_sets
        WHERE id_juego=$1 AND UPPER(COALESCE(codigo,''))=UPPER($2) LIMIT 1`, [local.id_juego, set.codigo]);
      if (existing.rowCount) {
        await client.query(`UPDATE gmx.tcg_sets SET nombre=$3,fecha_lanzamiento=$4,total_cartas=$5,
          activo=true,fuente_oficial=$6 WHERE row_id=$1 AND id_juego=$2`, [
        existing.rows[0].row_id, local.id_juego, set.nombre, set.fecha_lanzamiento, set.total_cartas, set.fuente_oficial]
        );
      } else {
        await client.query(`INSERT INTO gmx.tcg_sets(
          id_set,id_juego,nombre,codigo,fecha_lanzamiento,total_cartas,activo,orden,fuente_oficial)
          VALUES($1,$2,$3,$4,$5,$6,true,0,$7)`, [
        `${gameCode}-${set.codigo}`, local.id_juego, set.nombre, set.codigo, set.fecha_lanzamiento, set.total_cartas, set.fuente_oficial]
        );
      }
    }

    const rarities = await client.query(`SELECT * FROM gmx.tcg_master_rarezas WHERE id_juego=$1 AND activo=true`, [gameCode]);
    for (const rarity of rarities.rows) {
      await client.query(`INSERT INTO gmx.tcg_rarezas(id_rareza,id_juego,codigo,nombre,orden,activo)
        VALUES($1,$2,$3,$4,$5,true)
        ON CONFLICT DO NOTHING`, [
      `${gameCode}-${rarity.codigo}`, local.id_juego, rarity.codigo, rarity.nombre, rarity.orden]
      );
    }

    let cardsInstalled = 0;
    const cards = await client.query(`SELECT * FROM gmx.tcg_master_cards
      WHERE game_code=$1 AND set_code=ANY($2::text[])`, [gameCode, selected]);
    for (const card of cards.rows) {
      const setId = `${gameCode}-${card.set_code}`;
      const existing = await client.query(`SELECT row_id FROM gmx.tcg_cartas
        WHERE master_card_id=$1 OR (id_juego=$2 AND id_set=$3 AND COALESCE(numero_completo,'')=COALESCE($4,''))
        ORDER BY row_id LIMIT 1`, [card.row_id, local.id_juego, setId, card.collector_number || card.number || '']);
      const image = card.image_local_url || card.image_large_url || card.image_small_url || null;
      if (existing.rowCount) {
        await client.query(`UPDATE gmx.tcg_cartas SET
          master_card_id=$2,provider_code=$3,external_id=$4,id_juego=$5,id_set=$6,
          nombre=$7,numero_carta=$8,numero_completo=$9,rareza=$10,tipo_carta=$11,
          subtipo=$12,artista=$13,descripcion=$14,imagen_principal=$15,image_source_url=$16,
          estado_catalogo='ACTIVA',fecha_actualizacion=NOW()
          WHERE row_id=$1`, [
        existing.rows[0].row_id, card.row_id, card.provider_code, card.external_id, local.id_juego, setId,
        card.name, card.number, card.collector_number || card.number, card.rarity, card.card_type,
        card.subtype, card.artist, card.description, image, card.image_large_url || card.image_small_url]
        );
      } else {
        await client.query(`INSERT INTO gmx.tcg_cartas(
          id_carta,master_card_id,provider_code,external_id,id_juego,id_set,nombre,
          numero_carta,numero_completo,rareza,tipo_carta,subtipo,artista,descripcion,
          imagen_principal,image_source_url,estado_catalogo,fecha_creacion,fecha_actualizacion)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ACTIVA',NOW(),NOW())`, [
        `TCGC-${gameCode}-${slug(card.external_id)}-${slug(card.set_code)}`,
        card.row_id, card.provider_code, card.external_id, local.id_juego, setId, card.name,
        card.number, card.collector_number || card.number, card.rarity, card.card_type,
        card.subtype, card.artist, card.description, image, card.image_large_url || card.image_small_url]
        );
      }
      cardsInstalled++;
    }

    await client.query('COMMIT');
    return { game: local, sets: sets.rowCount, rarities: rarities.rowCount, cards: cardsInstalled };
  } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
}

export async function cardPriceComparison(masterCardId) {
  const card = await query(`SELECT * FROM gmx.tcg_master_cards WHERE row_id=$1 LIMIT 1`, [masterCardId]);
  if (!card.rowCount) throw new Error('MASTER_CARD_NOT_FOUND');
  const prices = await query(`SELECT * FROM gmx.tcg_card_price_current
    WHERE master_card_id=$1
      AND UPPER(price_provider)='TCGPLAYER'
    ORDER BY currency,variant`, [masterCardId]);
  return {
    card: card.rows[0],
    prices: prices.rows,
    price_source: 'TCGPLAYER',
    strict_price_source: true,
    tcgplayer_cached: Boolean(prices.rowCount)
  };
}


export async function listSyncedMasterCards({ gameCode = '', setCode = '', search = '', limit = 100 } = {}) {
  const values = [],filters = [];
  if (gameCode) {values.push(gameCode);filters.push(`c.game_code=$${values.length}`);}
  if (setCode) {values.push(setCode);filters.push(`c.set_code=$${values.length}`);}
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(c.name ILIKE $${values.length} OR COALESCE(c.collector_number,'') ILIKE $${values.length})`);
  }
  values.push(Math.min(Math.max(Number(limit) || 100, 1), 300));
  return query(`SELECT c.*,
      (SELECT COUNT(*)::bigint FROM gmx.tcg_card_price_current p WHERE p.master_card_id=c.row_id) AS price_sources
    FROM gmx.tcg_master_cards c
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY c.name,c.collector_number,c.row_id
    LIMIT $${values.length}`, values);
}

function dueByFrequency(lastAt, frequency) {
  if (!lastAt) return true;
  const ms = Date.now() - new Date(lastAt).getTime();
  const days = String(frequency || 'WEEKLY').toUpperCase() === 'DAILY' ? 1 :
  String(frequency || 'WEEKLY').toUpperCase() === 'MONTHLY' ? 30 : 7;
  return ms >= days * 24 * 60 * 60 * 1000;
}

let schedulerTimer = null;
let schedulerRunning = false;

export function startTcgSyncScheduler() {
  if (schedulerTimer) return schedulerTimer;

  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const enabled = await query(`SELECT c.*,p.last_sets_sync_at,p.last_cards_sync_at,p.supports_cards
        FROM gmx.tcg_sync_game_config c
        JOIN gmx.tcg_sync_providers p ON p.game_code=c.game_code
        WHERE c.enabled=true AND c.auto_sync_enabled=true`);

      for (const cfg of enabled.rows) {
        try {
          if (!dueByFrequency(cfg.last_sets_sync_at, cfg.auto_sync_frequency)) continue;

          await syncGameSets(cfg.game_code);

          const sets = Array.isArray(cfg.selected_sets) ? cfg.selected_sets : [];
          if (cfg.supports_cards && cfg.sync_cards && sets.length && dueByFrequency(cfg.last_cards_sync_at, cfg.auto_sync_frequency)) {
            await syncSelectedCards(cfg.game_code, {
              setCodes: sets,
              downloadImages: cfg.download_images === true,
              syncPrices: cfg.sync_prices !== false
            });
          }
        } catch (e) {
          await query(`UPDATE gmx.tcg_sync_providers SET last_error=$2,status='ERROR' WHERE game_code=$1`, [
          cfg.game_code, String(e.message || e).slice(0, 500)]
          ).catch(() => {});
        }
      }
    } catch {


      // Scheduler failures never interrupt the API.
    } finally {schedulerRunning = false;}
  };

  // Delayed first pass, then check every six hours.
  setTimeout(tick, 90_000);
  schedulerTimer = setInterval(tick, 6 * 60 * 60 * 1000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}


export async function masterCatalogSummary() {
  return query(`
    WITH card_stats AS (
      SELECT
        c.game_code,
        COUNT(*)::bigint AS cards_count,
        COUNT(DISTINCT c.set_code)::bigint AS synced_sets_count,
        COUNT(DISTINCT CASE WHEN p.row_id IS NOT NULL THEN c.row_id END)::bigint AS cards_with_prices,
        MAX(c.last_synced_at) AS last_card_sync_at
      FROM gmx.tcg_master_cards c
      LEFT JOIN gmx.tcg_card_price_current p
        ON p.master_card_id=c.row_id
      GROUP BY c.game_code
    ),
    set_stats AS (
      SELECT
        s.id_juego AS game_code,
        COUNT(*)::bigint AS sets_count
      FROM gmx.tcg_master_sets s
      WHERE COALESCE(s.activo,true)=true
      GROUP BY s.id_juego
    )
    SELECT
      COALESCE(g.codigo,cs.game_code,ss.game_code) AS game_code,
      COALESCE(g.nombre,cs.game_code,ss.game_code) AS game_name,
      g.publisher,
      COALESCE(ss.sets_count,0)::bigint AS sets_count,
      COALESCE(cs.synced_sets_count,0)::bigint AS synced_sets_count,
      COALESCE(cs.cards_count,0)::bigint AS cards_count,
      COALESCE(cs.cards_with_prices,0)::bigint AS cards_with_prices,
      cs.last_card_sync_at
    FROM gmx.tcg_master_juegos g
    FULL OUTER JOIN card_stats cs
      ON cs.game_code=g.codigo
    FULL OUTER JOIN set_stats ss
      ON ss.game_code=COALESCE(g.codigo,cs.game_code)
    WHERE
      COALESCE(g.activo,true)=true
      AND (
        COALESCE(ss.sets_count,0)>0
        OR COALESCE(cs.cards_count,0)>0
      )
    ORDER BY COALESCE(g.orden,999999),COALESCE(g.nombre,cs.game_code,ss.game_code)
  `);
}

export async function masterCatalogSets(gameCode, search = '') {
  return query(`
    WITH downloaded AS (
      SELECT
        c.set_code AS codigo,
        COUNT(*)::bigint AS synced_cards,
        COUNT(DISTINCT CASE WHEN p.row_id IS NOT NULL THEN c.row_id END)::bigint AS cards_with_prices,
        MAX(c.last_synced_at) AS last_sync_at
      FROM gmx.tcg_master_cards c
      LEFT JOIN gmx.tcg_card_price_current p
        ON p.master_card_id=c.row_id
      WHERE c.game_code=$1
        AND (
          NULLIF(TRIM($2::text),'') IS NULL
          OR c.name ILIKE '%'||$2::text||'%'
          OR COALESCE(c.collector_number,'') ILIKE '%'||$2::text||'%'
          OR COALESCE(c.number,'') ILIKE '%'||$2::text||'%'
          OR COALESCE(c.external_id,'') ILIKE '%'||$2::text||'%'
        )
      GROUP BY c.set_code
    )
    SELECT
      COALESCE(s.codigo,d.codigo) AS codigo,
      COALESCE(s.nombre,d.codigo) AS nombre,
      s.fecha_lanzamiento,
      COALESCE(s.total_cartas,0) AS total_cartas,
      COALESCE(d.synced_cards,0)::bigint AS synced_cards,
      COALESCE(d.cards_with_prices,0)::bigint AS cards_with_prices,
      d.last_sync_at
    FROM gmx.tcg_master_sets s
    FULL OUTER JOIN downloaded d
      ON d.codigo=s.codigo
    WHERE
      COALESCE(s.id_juego,$1)=$1
      AND COALESCE(s.activo,true)=true
      AND (s.id_juego=$1 OR d.codigo IS NOT NULL)
    ORDER BY COALESCE(s.fecha_lanzamiento,'1900-01-01'::date) DESC,
             COALESCE(s.nombre,d.codigo)
  `, [gameCode, search]);
}

export async function browseMasterCatalogCards({
  gameCode = '', setCode = '', rarity = '', search = '', page = 1, pageSize = 60
} = {}) {
  const vals = [],filters = [];
  if (gameCode) {vals.push(gameCode);filters.push(`c.game_code=$${vals.length}`);}
  if (setCode) {vals.push(setCode);filters.push(`c.set_code=$${vals.length}`);}
  if (rarity) {vals.push(rarity);filters.push(`LOWER(COALESCE(c.rarity,''))=LOWER($${vals.length})`);}
  if (search) {
    vals.push(`%${search}%`);
    filters.push(`(
      c.name ILIKE $${vals.length}
      OR COALESCE(c.collector_number,'') ILIKE $${vals.length}
      OR COALESCE(c.number,'') ILIKE $${vals.length}
      OR COALESCE(c.external_id,'') ILIKE $${vals.length}
    )`);
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(Math.max(Number(pageSize) || 60, 12), 120);
  const offset = (safePage - 1) * safeSize;

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const count = await query(`SELECT COUNT(*)::bigint total FROM gmx.tcg_master_cards c ${where}`, vals);

  const qvals = [...vals, safeSize, offset];
  const limitParam = `$${vals.length + 1}`;
  const offsetParam = `$${vals.length + 2}`;

  const rows = await query(`
    SELECT
      c.row_id,c.game_code,c.provider_code,c.external_id,c.set_code,c.name,
      c.number,c.collector_number,c.rarity,c.card_type,c.subtype,c.artist,
      c.language,c.image_small_url,c.image_large_url,c.image_local_url,
      c.purchase_url,c.source_url,c.last_synced_at,
      s.nombre AS set_name,s.fecha_lanzamiento,
      COUNT(p.row_id)::bigint AS price_rows,
      COUNT(DISTINCT p.price_provider)::bigint AS price_providers,
      MIN(p.market) FILTER (WHERE p.market IS NOT NULL) AS lowest_market_numeric,

      /* SHINY_TCGPLAYER_CATALOG_R3
         Precio de referencia principal para Catalogo Maestro:
         TCGplayer en USD. El precio interno de tienda permanece separado.
      */
      COALESCE(
        MIN(NULLIF(p.market,0)) FILTER (
          WHERE UPPER(COALESCE(p.price_provider,''))='TCGPLAYER'
            AND UPPER(COALESCE(p.currency,''))='USD'
        ),
        MIN(NULLIF(p.trend,0)) FILTER (
          WHERE UPPER(COALESCE(p.price_provider,''))='TCGPLAYER'
            AND UPPER(COALESCE(p.currency,''))='USD'
        ),
        MIN(NULLIF(p.mid,0)) FILTER (
          WHERE UPPER(COALESCE(p.price_provider,''))='TCGPLAYER'
            AND UPPER(COALESCE(p.currency,''))='USD'
        ),
        MIN(NULLIF(p.low,0)) FILTER (
          WHERE UPPER(COALESCE(p.price_provider,''))='TCGPLAYER'
            AND UPPER(COALESCE(p.currency,''))='USD'
        )
      ) AS tcgplayer_market_usd,

      MAX(COALESCE(p.provider_updated_at,p.fetched_at)) FILTER (
        WHERE UPPER(COALESCE(p.price_provider,''))='TCGPLAYER'
          AND UPPER(COALESCE(p.currency,''))='USD'
      ) AS tcgplayer_price_updated_at,

      (
        SELECT MIN(NULLIF(i.precio,0))
        FROM gmx.tcg_cartas lc
        JOIN gmx.tcg_inventario i
          ON i.id_carta=lc.id_carta
        WHERE lc.master_card_id=c.row_id
          AND COALESCE(i.precio,0)>0
      ) AS store_price_mxn
    FROM gmx.tcg_master_cards c
    LEFT JOIN gmx.tcg_master_sets s
      ON s.id_juego=c.game_code AND s.codigo=c.set_code
    LEFT JOIN gmx.tcg_card_price_current p
      ON p.master_card_id=c.row_id
    ${where}
    GROUP BY c.row_id,s.nombre,s.fecha_lanzamiento
    ORDER BY c.name,COALESCE(c.collector_number,c.number,''),c.row_id
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `, qvals);

  return {
    rows: rows.rows,
    total: Number(count.rows[0]?.total || 0),
    page: safePage,
    pageSize: safeSize,
    pages: Math.max(1, Math.ceil(Number(count.rows[0]?.total || 0) / safeSize))
  };
}

export async function masterCatalogRarities(gameCode = '', setCode = '', search = '') {
  const vals = [],filters = ["COALESCE(NULLIF(TRIM(c.rarity),''),'')<>''"];
  if (gameCode) {vals.push(gameCode);filters.push(`c.game_code=$${vals.length}`);}
  if (setCode) {vals.push(setCode);filters.push(`c.set_code=$${vals.length}`);}
  if (search) {
    vals.push(`%${search}%`);
    filters.push(`(
      c.name ILIKE $${vals.length}
      OR COALESCE(c.collector_number,'') ILIKE $${vals.length}
      OR COALESCE(c.number,'') ILIKE $${vals.length}
      OR COALESCE(c.external_id,'') ILIKE $${vals.length}
    )`);
  }
  return query(`
    SELECT c.rarity,COUNT(*)::bigint cards
    FROM gmx.tcg_master_cards c
    WHERE ${filters.join(' AND ')}
    GROUP BY c.rarity
    ORDER BY COUNT(*) DESC,c.rarity
  `, vals);
}

// SHINY_TCG_FX_PER_GAME_R1
const SHINY_TCG_FX_DEFAULTS = Object.freeze({
  POKEMON:15,
  YUGIOH:17,
  MAGIC:21,
  RIFTBOUND:30
});

function shinyTcgFxDefault(gameCode){
  const code=txt(gameCode).toUpperCase();
  const rate=Number(SHINY_TCG_FX_DEFAULTS[code]||0);
  return Number.isFinite(rate)&&rate>0?rate:null;
}

export async function getTcgExchangeRate(gameCode){
  const code=txt(gameCode).toUpperCase();
  if(!code){
    return {game_code:'',available:false,rate:null,source:'SHINY_TCG',rate_date:null,message:'TCG_REQUIRED'};
  }

  const r=await query(`
    SELECT source_preferences,updated_at
    FROM gmx.tcg_sync_game_config
    WHERE game_code=$1
    LIMIT 1
  `,[code]);

  const prefs=r.rows[0]?.source_preferences||{};
  const configured=Number(prefs?.usdMxnRate||0);
  const fallback=shinyTcgFxDefault(code);
  const rate=Number.isFinite(configured)&&configured>0?configured:fallback;

  return {
    game_code:code,
    available:Number.isFinite(Number(rate))&&Number(rate)>0,
    rate:rate?Number(rate):null,
    source:(Number.isFinite(configured)&&configured>0)?'SHINY_TCG_CONFIG':'SHINY_TCG_DEFAULT',
    rate_date:r.rows[0]?.updated_at||null,
    message:rate?'':`Configura el TDC USD→MXN para ${code} en TCG → Auto Sync.`
  };
}

export async function saveTcgExchangeRate(gameCode,input={}){
  const code=txt(gameCode).toUpperCase();
  const rate=Number(input?.rate);
  if(!code)throw new Error('TCG_REQUIRED');
  if(!Number.isFinite(rate)||rate<=0||rate>999)throw new Error('INVALID_TCG_FX_RATE');

  const r=await query(`
    INSERT INTO gmx.tcg_sync_game_config(game_code,source_preferences,updated_at)
    VALUES(
      $1,
      jsonb_build_object(
        'usdMxnRate',$2::numeric,
        'usdMxnUpdatedAt',NOW()::text
      ),
      NOW()
    )
    ON CONFLICT(game_code) DO UPDATE SET
      source_preferences=
        COALESCE(gmx.tcg_sync_game_config.source_preferences,'{}'::jsonb)
        || jsonb_build_object(
          'usdMxnRate',$2::numeric,
          'usdMxnUpdatedAt',NOW()::text
        ),
      updated_at=NOW()
    RETURNING game_code,source_preferences,updated_at
  `,[code,rate]);

  return {
    game_code:code,
    available:true,
    rate,
    source:'SHINY_TCG_CONFIG',
    rate_date:r.rows[0]?.updated_at||null
  };
}
