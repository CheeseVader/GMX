import { brandText } from "./config/brand.js";import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.resolve(__dirname, '../storage/product-images');
const PUBLIC_PREFIX = '/api/public/product-images';

const HIGH_CONFIDENCE = {
  YGOPRODECK: 0.92,
  SCRYFALL: 0.94,
  POKEMON_TCG: 0.94,
  OPENVERSE: 0.97,
  WIKIMEDIA: 0.97,
  DUCKDUCKGO_WEB: 0.96
};

const TYPE_WORDS = [
'booster box', 'booster bundle', 'booster pack', 'elite trainer box', 'etb',
'commander deck', 'structure deck', 'starter deck', 'battle deck', 'gift bundle',
'mini tin', 'tin', 'collection', 'poster collection', 'premium poster collection',
'binder', 'deck box', 'sleeves', 'sleeve', 'playmat', 'top loaders', 'toploader'];


const BRAND_WORDS = [
'dragon shield', 'ultra pro', 'x vault', 'kraken', 'pokemon', 'magic', 'mtg',
'yu gi oh', 'yugioh', 'one piece', 'riftbound'];


function txt(v) {return String(v ?? '').trim();}
function lower(v) {return txt(v).toLowerCase();}
function clean(v) {
  return lower(v).
  normalize('NFD').replace(/[\u0300-\u036f]/g, '').
  replace(/[^a-z0-9]+/g, ' ').
  replace(/\s+/g, ' ').
  trim();
}
function tokens(v) {return new Set(clean(v).split(' ').filter((x) => x.length > 1));}
function jaccard(a, b) {
  const A = tokens(a),B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function coverage(a, b) {
  const A = [...tokens(a)],B = tokens(b);
  if (!A.length) return 0;
  return A.filter((x) => B.has(x)).length / A.length;
}
function safeName(v) {
  return txt(v).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || crypto.randomUUID();
}
function htmlDecode(v) {
  return String(v || '').
  replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").
  replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function stripTags(v) {return htmlDecode(String(v || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();}

function normalizeProductName(name) {
  let s = clean(name);
  const replacements = [
  [/\bplaymay\b/g, 'playmat'],
  [/\bcaos\b/g, 'chaos'],
  [/\bteasures\b/g, 'treasures'],
  [/\b4 fantastic\b/g, 'fantastic four'],
  [/\bmutant turtles ninja\b/g, 'teenage mutant ninja turtles'],
  [/\bcoleccion\b/g, 'collection'],
  [/\bcolecion\b/g, 'collection'],
  [/\bpokemon\b/g, 'pokemon'],
  [/\byu gi oh\b/g, 'yu-gi-oh'],
  [/\bop 16\b/g, 'op-16']];

  for (const [re, to] of replacements) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

function detectGame(product) {
  const sku = clean(product.sku).replace(/\s/g, '');
  const hay = clean(`${product.nombre} ${product.descripcion} ${product.categoria}`);
  if (sku.includes('pok') || hay.includes('pokemon')) return 'Pokemon';
  if (sku.includes('mtg') || hay.includes('magic the gathering') || hay.includes(' mtg ')) return 'Magic';
  if (sku.includes('ygo') || hay.includes('yugioh') || hay.includes('yu gi oh')) return 'Yu-Gi-Oh!';
  if (sku.includes('rif') || hay.includes('riftbound')) return 'Riftbound';
  if (sku.includes('op') || hay.includes('one piece')) return 'One Piece';
  return '';
}
function detectType(product) {
  const n = normalizeProductName(product.nombre);
  for (const t of TYPE_WORDS) {
    if (n.includes(clean(t))) return t;
  }
  const c = clean(product.categoria);
  if (c.includes('sellado')) return 'sealed product';
  if (c.includes('accesor')) return 'accessory';
  return '';
}
function detectBrand(product) {
  const n = normalizeProductName(`${product.nombre} ${product.descripcion}`);
  for (const b of BRAND_WORDS) {
    if (n.includes(clean(b))) return b;
  }
  return '';
}
function buildQueries(product) {
  const n = normalizeProductName(product.nombre);
  const game = detectGame(product);
  const type = detectType(product);
  const brand = detectBrand(product);
  const queries = [
  [brand, n, type].filter(Boolean).join(' '),
  [game, n, type].filter(Boolean).join(' '),
  [brand, n].filter(Boolean).join(' '),
  [game, n].filter(Boolean).join(' '),
  n];

  return [...new Set(queries.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 5);
}
function typeCompatibility(product, candidateTitle) {
  const expected = clean(detectType(product));
  if (!expected) return 1;
  const c = clean(candidateTitle);
  const parts = expected.split(' ').filter(Boolean);
  if (!parts.length) return 1;
  return parts.filter((x) => c.includes(x)).length / parts.length;
}
function brandCompatibility(product, candidateTitle) {
  const brand = clean(detectBrand(product));
  if (!brand) return 1;
  const c = clean(candidateTitle);
  const parts = brand.split(' ').filter(Boolean);
  return parts.filter((x) => c.includes(x)).length / parts.length;
}
function scoreCandidate(product, candidate) {
  const title = candidate.title || candidate.name || '';
  const normalized = normalizeProductName(product.nombre);
  const nameScore = Math.max(jaccard(normalized, title), coverage(normalized, title) * 0.92);
  const typeScore = typeCompatibility(product, title);
  const brandScore = brandCompatibility(product, title);
  const game = detectGame(product);
  const gameScore = !game ? 1 : clean(title).includes(clean(game)) ? 1 : 0.55;
  return Math.min(1, nameScore * 0.58 + typeScore * 0.18 + brandScore * 0.16 + gameScore * 0.08);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.SHINY_IMAGE_HTTP_TIMEOUT_MS || 9000));
  try {
    const r = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': "Mozilla/5.0 TCG-Store-Inventory-Image-Enrichment/2.0",
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...(options.headers || {})
      }
    });
    if (!r.ok) throw new Error(`HTTP_${r.status}`);
    return await r.text();
  } finally {clearTimeout(timer);}
}
async function fetchJson(url, options = {}) {
  const t = await fetchText(url, options);
  return JSON.parse(t);
}

async function providerYgo(product) {
  if (detectGame(product) !== 'Yu-Gi-Oh!' || detectType(product)) return [];
  try {
    const j = await fetchJson(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(product.nombre)}`);
    return (j.data || []).slice(0, 12).flatMap((card) =>
    (card.card_images || []).slice(0, 2).map((img) => ({
      provider: 'YGOPRODECK', title: card.name, imageUrl: img.image_url || img.image_url_small,
      sourceUrl: `https://ygoprodeck.com/card/?search=${encodeURIComponent(card.name)}`
    }))
    );
  } catch {return [];}
}

async function providerScryfall(product) {
  if (detectGame(product) !== 'Magic' || detectType(product)) return [];
  try {
    const c = await fetchJson(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(product.nombre)}`);
    const image = c.image_uris?.normal || c.image_uris?.large || c.card_faces?.[0]?.image_uris?.normal;
    return image ? [{ provider: 'SCRYFALL', title: c.name, imageUrl: image, sourceUrl: c.scryfall_uri || '' }] : [];
  } catch {return [];}
}

async function providerPokemon(product) {
  if (detectGame(product) !== 'Pokemon' || detectType(product)) return [];
  const headers = {};
  if (process.env.POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMON_TCG_API_KEY;
  try {
    const q = `name:"${txt(product.nombre).replace(/"/g, '')}"`;
    const j = await fetchJson(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=20`, { headers });
    return (j.data || []).map((c) => ({
      provider: 'POKEMON_TCG', title: c.name, imageUrl: c.images?.large || c.images?.small,
      sourceUrl: `https://pokemontcg.io/card/${encodeURIComponent(c.id)}`
    })).filter((x) => x.imageUrl);
  } catch {return [];}
}

async function providerOpenverse(product) {
  const out = [];
  for (const q of buildQueries(product).slice(0, 3)) {
    try {
      const j = await fetchJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20`);
      for (const x of j.results || []) {
        if (!x.url && !x.thumbnail) continue;
        out.push({
          provider: 'OPENVERSE',
          title: x.title || '',
          imageUrl: x.url || x.thumbnail,
          sourceUrl: x.foreign_landing_url || x.detail_url || '',
          license: x.license || '',
          creator: x.creator || ''
        });
      }
    } catch {}
  }
  return out;
}

async function providerWikimedia(product) {
  const out = [];
  for (const q of buildQueries(product).slice(0, 3)) {
    try {
      const params = new URLSearchParams({
        action: 'query', format: 'json', origin: '*', generator: 'search',
        gsrnamespace: '6', gsrsearch: q, gsrlimit: '15',
        prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1200'
      });
      const j = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
      for (const p of Object.values(j.query?.pages || {})) {
        const ii = p.imageinfo?.[0] || {};
        if (!ii.thumburl && !ii.url) continue;
        out.push({
          provider: 'WIKIMEDIA',
          title: String(p.title || '').replace(/^File:/i, ''),
          imageUrl: ii.thumburl || ii.url,
          sourceUrl: ii.descriptionurl || '',
          license: ii.extmetadata?.LicenseShortName?.value || ''
        });
      }
    } catch {}
  }
  return out;
}

function ddgDecodeUrl(href) {
  try {
    const u = new URL(htmlDecode(href), 'https://html.duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.href;
  } catch {return '';}
}
async function extractOgImage(pageUrl) {
  try {
    const html = await fetchText(pageUrl);
    const title =
    stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i];

    let image = '';
    for (const re of patterns) {
      const m = html.match(re);if (m?.[1]) {image = htmlDecode(m[1]);break;}
    }
    if (image) {
      try {image = new URL(image, pageUrl).href;} catch {}
    }
    return image ? { title, imageUrl: image, sourceUrl: pageUrl } : null;
  } catch {return null;}
}
async function providerDuckDuckGoWeb(product) {
  if (String(process.env.SHINY_IMAGE_DDG_WEB ?? '1') === '0') return [];
  const out = [];
  for (const q of buildQueries(product).slice(0, 3)) {
    try {
      const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const re = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m,count = 0;
      while ((m = re.exec(html)) && count < 8) {
        count++;
        const url = ddgDecodeUrl(m[1]);
        const resultTitle = stripTags(m[2]);
        if (!/^https?:\/\//i.test(url)) continue;
        const host = (() => {try {return new URL(url).hostname.toLowerCase();} catch {return '';}})();
        if (!host || host.includes('duckduckgo.com')) continue;
        const og = await extractOgImage(url);
        if (!og) continue;
        out.push({
          provider: 'DUCKDUCKGO_WEB',
          title: [resultTitle, og.title].filter(Boolean).join(' · '),
          imageUrl: og.imageUrl,
          sourceUrl: url
        });
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch {}
  }
  return out;
}

const PROVIDERS = [
providerYgo, providerScryfall, providerPokemon,
providerOpenverse, providerWikimedia, providerDuckDuckGoWeb];


export async function discoverProductImage(product) {
  const all = [];
  for (const provider of PROVIDERS) {
    try {
      const items = await provider(product);
      for (const x of items) {
        if (!x.imageUrl) continue;
        all.push({ ...x, score: scoreCandidate(product, x) });
      }
    } catch {}
  }
  all.sort((a, b) => b.score - a.score);
  const best = all[0] || null;
  if (!best) return { status: 'SIN_MATCH', best: null, candidates: [] };

  const threshold = HIGH_CONFIDENCE[best.provider] ?? 0.99;
  const status = best.score >= threshold ?
  best.score >= 0.985 ? 'MATCH_EXACTO' : 'MATCH_ALTO' :
  'REVISAR';

  return { status, best, candidates: all.slice(0, 10) };
}

function extFromMime(mime) {
  const m = lower(mime).split(';')[0];
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/gif') return '.gif';
  return '';
}

export async function downloadProductImage(product, candidate) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.SHINY_IMAGE_HTTP_TIMEOUT_MS || 12000));
  try {
    const r = await fetch(candidate.imageUrl, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': "Mozilla/5.0 TCG-Store-Inventory-Image-Enrichment/2.0", 'Accept': 'image/*' }
    });
    if (!r.ok) throw new Error(`IMAGE_HTTP_${r.status}`);
    const mime = String(r.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const ext = extFromMime(mime);
    if (!ext) throw new Error(`IMAGE_MIME_NOT_ALLOWED:${mime || 'unknown'}`);
    const max = Number(process.env.SHINY_IMAGE_MAX_BYTES || 8 * 1024 * 1024);
    const ab = await r.arrayBuffer(),buf = Buffer.from(ab);
    if (!buf.length || buf.length > max) throw new Error('IMAGE_SIZE_INVALID');
    const filename = `${safeName(product.sku || product.id || product.row_id)}${ext}`;
    const target = path.join(STORAGE_DIR, filename);
    fs.writeFileSync(target, buf);
    return { diskPath: target, publicPath: `${PUBLIC_PREFIX}/${encodeURIComponent(filename)}`, mime, bytes: buf.length };
  } finally {clearTimeout(timer);}
}

export async function enrichProduct(product, { mode = 'preview' } = {}) {
  if (!product || txt(product.imagen)) return { sku: product?.sku || '', status: 'SKIP_HAS_IMAGE' };
  const discovery = await discoverProductImage(product);
  const base = {
    row_id: product.row_id, id: product.id, sku: product.sku, nombre: product.nombre,
    categoria: product.categoria, game: detectGame(product), productType: detectType(product),
    status: discovery.status, provider: discovery.best?.provider || '',
    score: Number(discovery.best?.score || 0),
    sourceUrl: discovery.best?.sourceUrl || '',
    imageUrl: discovery.best?.imageUrl || '',
    license: discovery.best?.license || '',
    normalizedName: normalizeProductName(product.nombre)
  };
  if (mode !== 'apply' || !['MATCH_EXACTO', 'MATCH_ALTO'].includes(discovery.status)) return base;

  const saved = await downloadProductImage(product, discovery.best);
  await query(`
    UPDATE gmx.productos
    SET imagen=$2,fecha_actualizacion=NOW()
    WHERE row_id=$1 AND COALESCE(BTRIM(imagen),'')=''
  `, [product.row_id, saved.publicPath]);
  return { ...base, applied: true, localImage: saved.publicPath, bytes: saved.bytes };
}

export async function enrichMissingProductImages({ mode = 'preview', limit = 100 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const r = await query(`
    SELECT row_id,id,sku,nombre,descripcion,categoria,imagen,estado
    FROM gmx.productos
    WHERE COALESCE(BTRIM(imagen),'')=''
      AND COALESCE(estado,'Activo')='Activo'
    ORDER BY row_id
    LIMIT $1
  `, [n]);
  const results = [];
  for (const product of r.rows) {
    try {results.push(await enrichProduct(product, { mode }));}
    catch (e) {results.push({ row_id: product.row_id, sku: product.sku, nombre: product.nombre, status: 'ERROR', error: String(e?.message || e) });}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const summary = results.reduce((acc, x) => {
    acc[x.status] = (acc[x.status] || 0) + 1;
    if (x.applied) acc.APPLIED = (acc.APPLIED || 0) + 1;
    return acc;
  }, { TOTAL: results.length });
  return { mode, summary, results };
}

let scheduler = null,running = false;
export function startProductImageEnrichmentScheduler() {
  if (scheduler) return scheduler;
  const enabled = String(process.env.SHINY_PRODUCT_IMAGE_AUTO ?? '1') !== '0';
  if (!enabled) {
    console.log(brandText("[GMX][IMG-002] auto enrichment disabled."));
    return null;
  }
  const interval = Math.max(Number(process.env.SHINY_PRODUCT_IMAGE_INTERVAL_MS || 15 * 60 * 1000), 60 * 1000);
  const batch = Math.min(Math.max(Number(process.env.SHINY_PRODUCT_IMAGE_BATCH || 8), 1), 50);
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await enrichMissingProductImages({ mode: 'apply', limit: batch });
      console.log(brandText("[GMX][IMG-002]"), JSON.stringify(result.summary));
    } catch (e) {console.error(brandText("[GMX][IMG-002]"), String(e?.message || e));} finally
    {running = false;}
  };
  setTimeout(tick, 8000);
  scheduler = setInterval(tick, interval);
  scheduler.unref?.();
  return scheduler;
}
export function stopProductImageEnrichmentScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}
