import { brandText } from "../config/brand.js";import { Router } from 'express';
import { requireModule } from '../middleware/auth.js';
import {
  ensureOperationalIdentities,
  resolveVisualIdentities,
  visualTcgLimits
} from '../externalCardVisualAdapter.js';

const router = Router();
// SHINY_FEATURE_EXTERNAL_BETA_GATE_R1
router.use((req,res,next)=>process.env.SHINY_FEATURE_EXTERNAL_BETA==='true'?next():res.status(404).json({success:false,error:'FEATURE_DISABLED'}));
const VISUAL_SERVICE_URL = String(process.env.SHINY_VISUAL_BETA_URL || 'http://127.0.0.1:8011').replace(/\/$/, '');

function clean(v, max = 500) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function onlinePrice(provider, variant, currency, values = {}, sourceUrl = '', updatedAt = null) {
  return {
    provider, variant: clean(variant || 'default', 120), currency: clean(currency || 'USD', 20),
    low: num(values.low ?? values.lowPrice), mid: num(values.mid ?? values.midPrice),
    high: num(values.high ?? values.highPrice), market: num(values.market ?? values.marketPrice),
    trend: num(values.trend), source_url: clean(sourceUrl, 700), provider_updated_at: updatedAt || null,
    fetched_at: new Date().toISOString(), origin: 'INTERNET'
  };
}

function pokemonApiPrices(card) {
  return Object.entries(card?.tcgplayer?.prices || {}).map(([variant, values]) =>
    onlinePrice('TCGplayer', variant, 'USD', values, card?.tcgplayer?.url, card?.tcgplayer?.updatedAt));
}

function tcgdexPrices(card) {
  const tcg = card?.pricing?.tcgplayer || {};
  const rows = [];
  for (const [variant, values] of Object.entries(tcg)) {
    if (!values || typeof values !== 'object') continue;
    if (!['lowPrice', 'midPrice', 'highPrice', 'marketPrice'].some((key) => key in values)) continue;
    rows.push(onlinePrice('TCGplayer', variant, tcg.unit || 'USD', values, 'https://www.tcgplayer.com/', tcg.updated));
  }
  return rows;
}
function externalQueryVariants(value) {
  const original = clean(value, 180);

  const simplified = original.
  replace(/[._/\\]+/g, ' ').
  replace(/[^A-Za-z0-9À-ÿ'’:\- ]+/g, ' ').
  replace(/\s+/g, ' ').
  trim();

  const noPunctuation = simplified.
  replace(/[:'’\-]+/g, ' ').
  replace(/\s+/g, ' ').
  trim();

  const words = noPunctuation.split(' ').filter(Boolean);

  const variants = [
  original,
  simplified,
  noPunctuation,
  words.slice(0, 5).join(' '),
  words.slice(0, 3).join(' '),
  words.slice(0, 2).join(' ')].

  map((x) => clean(x, 180)).
  filter((x) => x.length >= 2);

  return [...new Set(variants)];
}


async function getJson(url, { headers = {}, timeout = 15000 } = {}) {
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json;q=0.9,*/*;q=0.8',
      'User-Agent': "TCG-Store-External-Card-Beta/1.0",
      ...headers
    },
    signal: AbortSignal.timeout(timeout)
  });
  let body = null;
  try {body = await r.json();} catch {}
  if (!r.ok) {
    const e = new Error(`REMOTE_HTTP_${r.status}`);
    e.status = r.status;
    e.remote = body;
    throw e;
  }
  return body;
}

/* SHINY_YUGIOH_SET_HINT_R26B */
function r26bCompact(v='') {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function r26bOcrVariants(token='') {
  const base = r26bCompact(token);
  const vars = new Set([base]);

  const maps = [
    [/Z/g,'2'],
    [/O/g,'0'],
    [/[IL]/g,'1'],
    [/S/g,'5'],
    [/B/g,'8'],
    [/G/g,'6']
  ];

  for (const [re,to] of maps) {
    for (const v of [...vars]) vars.add(v.replace(re,to));
  }

  return [...vars].filter(Boolean);
}

function r26bSetPrefixScore(row, hint='') {
  const prefix = r26bCompact(row?.set_code || '');
  if (!prefix || prefix.length < 3) return 0;

  const tokens = String(hint || '')
    .toUpperCase()
    .match(/[A-Z0-9]{3,12}/g) || [];

  let best = 0;

  for (const raw of tokens) {
    for (const v of r26bOcrVariants(raw)) {
      if (v === prefix) best = Math.max(best, 1000);
      else if (v.startsWith(prefix)) best = Math.max(best, 950);
      else if (prefix.startsWith(v) && v.length >= 3) best = Math.max(best, 850);
      else if (v.includes(prefix)) best = Math.max(best, 800);
    }
  }

  return best;
}

function r26bPrioritizeSetHint(rows=[], hint='') {
  const scored = (rows || []).map((row, index) => ({
    row,
    index,
    score: r26bSetPrefixScore(row, hint)
  }));

  const max = scored.reduce((m,x) => Math.max(m,x.score), 0);
  if (max < 850) return { rows, matched:false, score:max };

  const best = scored
    .filter(x => x.score === max)
    .sort((a,b) => a.index - b.index)
    .map(x => x.row);

  const rest = scored
    .filter(x => x.score !== max)
    .sort((a,b) => a.index - b.index)
    .map(x => x.row);

  return {
    rows: [...best, ...rest],
    matched: true,
    score: max
  };
}

/* SHINY_YUGIOH_SET_CODE_R25 */
function ygoRows(cards = [], identifiers = []) {
  const out = [];

  const wantedIdsR25 = (identifiers || [])
    .map(strongIdentity)
    .filter(Boolean);

  for (const c of cards) {
    const originalSets =
      Array.isArray(c.card_sets) && c.card_sets.length
        ? c.card_sets
        : [null];

    const sets = [...originalSets].sort((a, b) => {
      const aCode = strongIdentity(a?.set_code);
      const bCode = strongIdentity(b?.set_code);

      const aExact = wantedIdsR25.some(
        (id) => aCode === id
      );

      const bExact = wantedIdsR25.some(
        (id) => bCode === id
      );

      if (aExact !== bExact) {
        return aExact ? -1 : 1;
      }

      return 0;
    });
    const img = c.card_images?.[0]?.image_url_small || c.card_images?.[0]?.image_url || '';
    const prices = c.card_prices?.[0] || {};
    for (const set of sets) {
      const printCode = clean(set?.set_code, 80);
      const setCode = clean(printCode.split('-')[0] || set?.set_name, 80).toUpperCase();
      const internetPrices = [
        onlinePrice('TCGplayer', 'lowest', 'USD', { market: prices.tcgplayer_price }),
        onlinePrice('Cardmarket', 'lowest', 'EUR', { market: prices.cardmarket_price }),
        onlinePrice('eBay', 'lowest', 'USD', { market: prices.ebay_price }),
        onlinePrice('Amazon', 'lowest', 'USD', { market: prices.amazon_price })
      ].filter((row) => row.market != null);
      out.push({
        source: 'YGOPRODeck',
        game: 'YUGIOH',
        external_id: String(c.id || ''),
        name: clean(c.name, 180),
        set_name: clean(set?.set_name, 220),
        set_code: setCode,
        collector_number: printCode,
        rarity: clean(set?.set_rarity, 120),
        type: clean(c.type, 120),
        description: clean(c.desc, 1200),
        image: img,
        language: 'EN',
        market_price_usd: num(prices.tcgplayer_price),
        internet_prices: internetPrices,
        identification_source: 'INTERNET',
        raw_hint: { card_id: c.id, archetype: clean(c.archetype, 120) }
      });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

async function searchYgo(q, identifiers = []) {
  /* YGO_ROBUST_VARIANTS_R12B */

  const variants = externalQueryVariants(q);

  for (const variant of variants) {
    try {
      const params = new URLSearchParams({
        fname: variant,
        num: '30',
        offset: '0'
      });

      const body = await getJson(
        `https://db.ygoprodeck.com/api/v7/cardinfo.php?${params}`
      );

      const rows = ygoRows(body?.data || [], identifiers);

      if (rows.length) {
        return rows;
      }
    } catch (error) {
      /*
       * YGOPRODeck returns HTTP 400 when no card matches fname.
       * For OCR searches this is a normal "no match" condition,
       * not a Shiny system failure.
       */
      if (Number(error?.status || 0) === 400) {
        continue;
      }

      throw error;
    }
  }

  return [];
}

async function searchPokemon(q) {
  const headers = {};
  if (process.env.SHINY_POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.SHINY_POKEMON_TCG_API_KEY;
  try {
    const escaped = clean(q, 120).replace(/["\\]/g, ' ');
    const params = new URLSearchParams({ q: `name:"${escaped}"`, pageSize: '30', orderBy: '-set.releaseDate' });
    const body = await getJson(`https://api.pokemontcg.io/v2/cards?${params}`, { headers, timeout: 30000 });
    const cards = Array.isArray(body?.data) ? body.data : [];
    if (cards.length) return cards.map((c) => {
      const prices = pokemonApiPrices(c);
      return {
        source: 'POKEMON_TCG_API', game: 'POKEMON', external_id: clean(c.id, 100),
        name: clean(c.name, 180), set_name: clean(c.set?.name, 220), set_code: clean(c.set?.id, 80),
        collector_number: clean(c.number, 80), rarity: clean(c.rarity, 120),
        type: clean([c.supertype, ...(c.subtypes || [])].filter(Boolean).join(' · '), 180),
        description: clean((c.rules || []).join(' '), 1200), image: clean(c.images?.large || c.images?.small, 500),
        language: 'EN', market_price_usd: prices.find((row) => row.market != null)?.market ?? null,
        internet_prices: prices, identification_source: 'INTERNET',
        raw_hint: { hp: c.hp ?? null, illustrator: clean(c.artist, 150), source_url: `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(c.id)}` }
      };
    });
  } catch (error) {
    console.warn(brandText('[GMX][INTERNET_POKEMON_PRIMARY]'), String(error?.message || error));
  }

  const params = new URLSearchParams({ name: q });
  const list = await getJson(`https://api.tcgdex.net/v2/en/cards?${params}`);
  const brief = (Array.isArray(list) ? list : []).slice(0, 20);
  const details = await Promise.all(brief.map(async (item) => {
    try { return await getJson(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(item.id)}`, { timeout: 15000 }); }
    catch { return item; }
  }));
  return details.map((c) => {
    const prices = tcgdexPrices(c);
    return {
      source: 'TCGDEX', game: 'POKEMON', external_id: clean(c.id, 100), name: clean(c.name, 180),
      set_name: clean(c.set?.name, 220), set_code: clean(c.set?.id, 80), collector_number: clean(c.localId, 80),
      rarity: clean(c.rarity, 120), type: clean(Array.isArray(c.types) ? c.types.join(', ') : c.category, 120),
      description: clean(c.effect || c.description || '', 1200), image: clean(c.image, 500), language: 'EN',
      market_price_usd: prices.find((row) => row.market != null)?.market ?? null,
      internet_prices: prices, identification_source: 'INTERNET',
      raw_hint: { hp: c.hp ?? null, illustrator: clean(c.illustrator, 150) }
    };
  });
}

async function searchMagic(q) {
  const params = new URLSearchParams({ q });
  const body = await getJson(`https://api.scryfall.com/cards/search?${params}`);
  return (body?.data || []).slice(0, 20).map((c) => {
    const prices = [
      onlinePrice('Scryfall', 'normal', 'USD', { market: c.prices?.usd }, c.purchase_uris?.tcgplayer || c.scryfall_uri),
      onlinePrice('Scryfall', 'foil', 'USD', { market: c.prices?.usd_foil }, c.purchase_uris?.tcgplayer || c.scryfall_uri),
      onlinePrice('Scryfall', 'etched', 'USD', { market: c.prices?.usd_etched }, c.purchase_uris?.tcgplayer || c.scryfall_uri)
    ].filter((row) => row.market != null);
    return ({
    source: 'Scryfall',
    game: 'MAGIC',
    external_id: clean(c.id, 100),
    name: clean(c.name, 180),
    set_name: clean(c.set_name, 220),
    set_code: clean(c.set, 80).toUpperCase(),
    collector_number: clean(c.collector_number, 80),
    rarity: clean(c.rarity, 120),
    type: clean(c.type_line, 180),
    description: clean(c.oracle_text, 1200),
    image: clean(c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '', 500),
    language: clean(c.lang, 20).toUpperCase(),
    market_price_usd: num(c.prices?.usd),
    internet_prices: prices,
    identification_source: 'INTERNET',
    raw_hint: { released_at: c.released_at || '', mana_cost: clean(c.mana_cost, 80) }
    });
  });
}

function normalized(value) {
  return clean(value, 300).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* SHINY_IDENTITY_PRIORITY_R14C */
function strongIdentity(value) {
  return normalized(value).replace(/\s+/g, '');
}
function identityPriority(row, nameHint, identifiers = []) {
  const wantedName = normalized(nameHint);
  const rowName = normalized(row?.name);
  let nameScore = 0;
  if (wantedName && rowName === wantedName) nameScore = 100;
  else if (wantedName && (rowName.startsWith(wantedName) || wantedName.startsWith(rowName))) nameScore = 85;
  else if (wantedName && (rowName.includes(wantedName) || wantedName.includes(rowName))) nameScore = 70;

  const fields = [row?.external_id,row?.set_code,row?.collector_number].map(strongIdentity).filter(Boolean);
  const ids = identifiers.map(strongIdentity).filter(Boolean);
  const idMatch = ids.length ? ids.some((id) => fields.some((field) => field === id || field.includes(id) || id.includes(field))) : false;
  return { score: (idMatch ? 200 : 0) + nameScore, idMatch, nameScore };
}
function prioritizeIdentity(rows, nameHint, identifiers = []) {
  const scored = rows.map((row) => ({ row, priority: identityPriority(row,nameHint,identifiers) }));
  const idMatches = scored.filter((x) => x.priority.idMatch);
  const pool = idMatches.length ? idMatches : scored.filter((x) => x.priority.nameScore > 0);
  const usable = pool.length ? pool : scored;
  usable.sort((a,b) => b.priority.score-a.priority.score);
  const best = usable[0]?.priority.score || 0;
  const tier = best > 0 ? usable.filter((x) => x.priority.score === best) : usable;
  return tier.map((x) => ({ ...x.row, internet_match_score: x.priority.score }));
}
/* SHINY_OCR_CATALOG_MATCH_R19B */
function r19bCompact(value) {
  return normalized(value).replace(/\s+/g, '');
}

function r19bLevenshtein(aValue,bValue){
  const a=r19bCompact(aValue);
  const b=r19bCompact(bValue);

  if(!a)return b.length;
  if(!b)return a.length;

  const prev=Array.from({length:b.length+1},(_,i)=>i);
  const curr=new Array(b.length+1);

  for(let i=1;i<=a.length;i++){
    curr[0]=i;

    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1]?0:1;

      curr[j]=Math.min(
        curr[j-1]+1,
        prev[j]+1,
        prev[j-1]+cost
      );
    }

    for(let j=0;j<=b.length;j++)prev[j]=curr[j];
  }

  return prev[b.length];
}

function r19bSimilarity(aValue,bValue){
  const a=r19bCompact(aValue);
  const b=r19bCompact(bValue);

  if(!a||!b)return 0;
  if(a===b)return 1;

  if(a.includes(b)||b.includes(a)){
    const ratio=Math.min(a.length,b.length)/Math.max(a.length,b.length);
    return Math.max(0.80,ratio);
  }

  const distance=r19bLevenshtein(a,b);
  return Math.max(0,1-(distance/Math.max(a.length,b.length)));
}

function r19bQueryVariants(value){
  const literal=clean(value,180);

  const normalizedText=literal
    .replace(/[|[\]{}<>]/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const tokens=normalizedText.split(' ').filter(Boolean);
  const out=[
    literal,
    normalizedText,
    normalizedText
      .replace(/^[^A-Za-z0-9]+/,'')
      .replace(/[^A-Za-z0-9]+$/,'')
      .trim()
  ];

  // Conservative edge cleanup only.
  if(tokens.length>=2){
    if(tokens[tokens.length-1].replace(/[^A-Za-z0-9]/g,'').length<=3){
      out.push(tokens.slice(0,-1).join(' '));
    }

    if(tokens[0].replace(/[^A-Za-z0-9]/g,'').length<=2){
      out.push(tokens.slice(1).join(' '));
    }
  }

  // Substantial individual words can be provider clues.
  for(const token of tokens){
    if(token.replace(/[^A-Za-z0-9]/g,'').length>=4)out.push(token);
  }

  return [...new Set(
    out.map((x)=>clean(x,180)).filter((x)=>x.length>=2)
  )].slice(0,8);
}


/* SHINY_YUGIOH_EXACT_PROVIDER_CODE_R26D2
 * OCR is only a clue.
 * The final Yu-Gi-Oh! collector_number MUST be an exact value
 * returned by YGOPRODeck for the detected card.
 */
function r26d2Normalize(value=''){
  return String(value || '')
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g,'-')
    .replace(/[^A-Z0-9-]/g,'');
}

function r26d2Variants(value=''){
  const base=r26d2Normalize(value);
  const vars=new Set([base]);

  const maps=[
    ['Z','2'],
    ['O','0'],
    ['I','1'],
    ['L','1'],
    ['S','5'],
    ['B','8'],
    ['G','6']
  ];

  for(const [from,to] of maps){
    if(base.includes(from)){
      vars.add(base.split(from).join(to));
    }
  }

  for(const current of [...vars]){
    for(const [from,to] of maps){
      if(current.includes(from)){
        vars.add(current.split(from).join(to));
      }
    }
  }

  return [...vars].filter(Boolean);
}

function r26d2HintTokens(hint=''){
  const raw=String(hint || '').toUpperCase();

  const full=
    raw.match(/\b[A-Z0-9]{2,10}-[A-Z0-9]{2,12}\b/g) || [];

  const noisy=
    raw.match(/\b[A-Z0-9]{4,12}\b/g) || [];

  return [...new Set([...full,...noisy])]
    .filter(token =>
      /[A-Z]/.test(token) &&
      (/\d/.test(token) || /[ZOILSBG]/.test(token))
    );
}

function r26d2ResolveExactProviderCode(rows=[], nameHint='', ocrHint=''){
  if(!Array.isArray(rows) || !rows.length){
    return {
      resolved:false,
      rows,
      reason:'NO_ROWS'
    };
  }

  const wantedName=
    String(nameHint || '').trim().toUpperCase();

  const sameName=rows.filter(row =>
    String(row?.name || '').trim().toUpperCase() === wantedName
  );

  const pool=sameName.length ? sameName : rows;
  const tokens=r26d2HintTokens(ocrHint);

  if(!tokens.length){
    return {
      resolved:false,
      rows,
      reason:'NO_OCR_SET_HINT'
    };
  }

  const evidence=[];

  for(const token of tokens){
    for(const variant of r26d2Variants(token)){
      for(const row of pool){
        const collector=
          r26d2Normalize(row?.collector_number || '');

        const prefix=
          r26d2Normalize(row?.set_code || '') ||
          collector.split('-')[0] ||
          '';

        if(!collector || !prefix || prefix.length < 4){
          continue;
        }

        let score=0;
        let mode='';

        if(variant === collector){
          score=2000;
          mode='EXACT_COLLECTOR';
        }
        else if(variant.includes(collector)){
          score=1900;
          mode='CONTAINS_COLLECTOR';
        }
        else if(
          variant.startsWith(prefix) &&
          prefix.length >= 4
        ){
          score=1400 + prefix.length;
          mode='PROVIDER_PREFIX';
        }
        else if(
          variant.includes(prefix) &&
          prefix.length >= 5
        ){
          score=1200 + prefix.length;
          mode='CONTAINS_PREFIX';
        }

        if(score > 0){
          evidence.push({
            row,
            score,
            mode,
            token,
            variant,
            prefix,
            collector
          });
        }
      }
    }
  }

  if(!evidence.length){
    return {
      resolved:false,
      rows,
      reason:'NO_PROVIDER_CODE_MATCH'
    };
  }

  evidence.sort((a,b)=>b.score-a.score);

  const bestScore=evidence[0].score;
  const top=evidence.filter(item => item.score === bestScore);

  const collectors=[
    ...new Set(top.map(item => item.collector))
  ];

  if(collectors.length !== 1){
    return {
      resolved:false,
      rows,
      reason:'AMBIGUOUS_PROVIDER_CODES',
      candidates:collectors
    };
  }

  const exactCollector=collectors[0];

  const exactRows=pool.filter(row =>
    r26d2Normalize(row?.collector_number || '') === exactCollector
  );

  if(exactRows.length !== 1){
    return {
      resolved:false,
      rows,
      reason:'NON_UNIQUE_PROVIDER_ROW',
      collector_number:exactCollector
    };
  }

  const winner=exactRows[0];

  const reordered=[
    winner,
    ...rows.filter(row =>
      !(
        String(row?.name || '').trim().toUpperCase() ===
          String(winner?.name || '').trim().toUpperCase()
        &&
        r26d2Normalize(row?.collector_number || '') === exactCollector
      )
    )
  ];

  return {
    resolved:true,
    rows:reordered,
    winner,
    collector_number:exactCollector,
    set_code:r26d2Normalize(winner?.set_code || ''),
    set_name:String(winner?.set_name || ''),
    score:bestScore,
    mode:top[0]?.mode || '',
    ocr_token:top[0]?.token || '',
    ocr_variant:top[0]?.variant || '',
    reason:'UNIQUE_PROVIDER_CODE'
  };
}

/* SHINY_MARKET_PRICE_MAX_R29 */
function shinyHighestMarketPriceR29(rows = []) {
  const list = Array.isArray(rows) ? rows : [];

  const clean = (value) =>
    String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');

  const exactKey = (row) => [
    clean(row?.name),
    clean(row?.collector_number || row?.external_id),
    clean(row?.set_code),
    clean(row?.set_name),
    clean(row?.rarity),
    clean(
      row?.variant ||
      row?.printing ||
      row?.finish ||
      row?.foil ||
      row?.treatment
    )
  ].join('|');

  const validMarket = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const maxByExactIdentity = new Map();

  for (const row of list) {
    const price = validMarket(row?.market_price_usd);
    if (price === null) continue;

    const key = exactKey(row);
    const current = maxByExactIdentity.get(key);

    if (current === undefined || price > current) {
      maxByExactIdentity.set(key, price);
    }
  }

  return list.map((row) => {
    const key = exactKey(row);
    const highest = maxByExactIdentity.get(key);

    if (highest === undefined) return row;

    const original = validMarket(row?.market_price_usd);

    return {
      ...row,
      market_price_usd: highest,
      market_price_original_usd: original,
      market_price_rule: 'MAX_MARKET_PRICE_EXACT_IDENTITY_R29'
    };
  });
}
async function r19bProviderSearch(game,variants,identifiers=[]){
  const merged=[];
  const seen=new Set();

  for(const query of variants){
    let rows=[];

    if(game==='YUGIOH')rows=await searchYgo(query,identifiers);
    else if(game==='POKEMON')rows=await searchPokemon(query);
    else if(game==='MAGIC')rows=await searchMagic(query);

    for(const row of rows||[]){
      const key=[
        row?.source,
        row?.external_id,
        row?.set_code,
        row?.collector_number,
        row?.name
      ].map((x)=>String(x||'')).join('|');

      if(seen.has(key))continue;
      seen.add(key);
      merged.push(row);

      if(merged.length>=80)return merged;
    }
  }

  return merged;
}

function r19bRankOfficialNames(rows,ocrClue,variants){
  return [...rows].map((row)=>{
    const scores=variants.map((variant)=>r19bSimilarity(variant,row?.name));
    const best=Math.max(0,...scores);
    const literal=r19bSimilarity(ocrClue,row?.name);

    return {
      ...row,
      internet_match_score:Math.round(best*100),
      ocr_catalog_similarity:best,
      ocr_literal_similarity:literal
    };
  }).sort((a,b)=>
    Number(b.ocr_catalog_similarity||0)-Number(a.ocr_catalog_similarity||0) ||
    Number(b.ocr_literal_similarity||0)-Number(a.ocr_literal_similarity||0) ||
    String(a.name||'').localeCompare(String(b.name||''))
  );
}
function rankInternetCandidates(rows, query) {
  const wanted = normalized(query);
  return [...rows].map((row) => {
    const name = normalized(row.name);
    const internetMatchScore = name === wanted ? 100 : name.startsWith(wanted) ? 85 :
      name.includes(wanted) || wanted.includes(name) ? 70 : 40;
    return { ...row, internet_match_score: internetMatchScore };
  }).sort((a, b) => b.internet_match_score - a.internet_match_score || String(a.name).localeCompare(String(b.name))).slice(0, 30);
}

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      ok: true,
      module: 'External Card Lookup Beta',
      read_only: false,
      mode: 'VISUAL_TCG_R3_INTERNET_FIRST',
      internet_identity: true,
      local_visual_model: false,
      tcgplayer: {
        direct_client: false,
        pricing_source: 'EXISTING_INTERNET_PROVIDERS_WITH_SHINY_CACHE_FALLBACK',
        scraping: false
      },
      batch_limits: visualTcgLimits,
      providers: [
      { id: 'POKEMON', name: 'Pokémon TCG API / TCGdex', api_key: false },
      { id: 'YUGIOH', name: 'YGOPRODeck', api_key: false },
      { id: 'MAGIC', name: 'Scryfall', api_key: false }]

    }
  });
});

function adapterError(res, error) {
  const code = String(error?.message || error || 'VISUAL_TCG_ADAPTER_FAILED');
  const clientErrors = new Set([
    'VISUAL_IDENTITY_INCOMPLETE', 'VISUAL_BATCH_TOO_LARGE', 'MASTER_CARD_IDS_REQUIRED',
    'INSTALL_BATCH_TOO_LARGE', 'MASTER_CARD_NOT_FOUND', 'MASTER_GAME_NOT_FOUND'
  ]);
  const schemaUnavailable = error?.code === '42P01' || error?.code === '42703';
  console.error(brandText('[GMX][VISUAL_TCG_ADAPTER]'), code, error?.code || '');
  return res.status(schemaUnavailable ? 503 : clientErrors.has(code) ? 400 : 500).json({
    success: false,
    error: schemaUnavailable ? 'TCG_MASTER_CATALOG_NOT_AVAILABLE' : code,
    message: schemaUnavailable ?
      'El catálogo maestro TCG actual no está disponible. Ejecuta primero las migraciones y sincronización TCG existentes.' :
      code
  });
}

router.post('/resolve-shiny', async (req, res) => {
  try {
    const rows = await resolveVisualIdentities([req.body?.identity || req.body || {}]);
    return res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    return adapterError(res, error);
  }
});

router.post('/bulk-resolve-shiny', async (req, res) => {
  try {
    const identities = Array.isArray(req.body?.identities) ? req.body.identities : [];
    const rows = await resolveVisualIdentities(identities);
    return res.json({
      success: true,
      data: {
        requested: identities.length,
        unique: rows.length,
        identified: rows.filter((row) => row.status === 'INTERNET_IDENTIFIED').length,
        rows
      }
    });
  } catch (error) {
    return adapterError(res, error);
  }
});

router.post('/ensure-operational', requireModule('TCG'), async (req, res) => {
  try {
    const cards = await ensureOperationalIdentities([req.body?.identity || {}]);
    return res.status(201).json({ success: true, data: cards[0] || null });
  } catch (error) {
    return adapterError(res, error);
  }
});

router.post('/bulk-ensure-operational', requireModule('TCG'), async (req, res) => {
  try {
    const cards = await ensureOperationalIdentities(req.body?.identities || []);
    return res.status(201).json({ success: true, data: { count: cards.length, cards } });
  } catch (error) {
    return adapterError(res, error);
  }
});

router.get('/search', async (req, res) => {
  const game = clean(req.query.game, 20).toUpperCase();
  const q = clean(req.query.q, 180);

  if (!q || q.length < 2) {
    return res.status(400).json({ success: false, error: 'QUERY_REQUIRED', message: 'Escribe al menos 2 caracteres para buscar.' });
  }

  try {
    let rows = [];
    if (game === 'YUGIOH') rows = await searchYgo(q);else
    if (game === 'POKEMON') rows = await searchPokemon(q);else
    if (game === 'MAGIC') rows = await searchMagic(q);else
    return res.status(400).json({ success: false, error: 'GAME_REQUIRED', message: 'Selecciona Pokémon, Yu-Gi-Oh! o Magic.' });

    res.json({
      success: true,
      data: {
        game,
        query: q,
        count: rows.length,
        rows
      }
    });
  } catch (error) {
    console.error(brandText("[GMX][EXTERNAL_CARD_BETA]"), game, q, error);
    const status = Number(error?.status || 0);
    res.status(status === 429 ? 429 : 502).json({
      success: false,
      error: status === 429 ? 'EXTERNAL_RATE_LIMIT' : 'EXTERNAL_LOOKUP_FAILED',
      message: status === 429 ?
      'La fuente externa está limitando temporalmente las consultas. Espera un momento.' :
      'No fue posible consultar la fuente externa en este momento.'
    });
  }
});


router.post('/visual-search', async (req, res) => {
  const game = clean(req.body?.game, 20).toUpperCase();
  const q = clean(req.body?.q, 180);
  const imageBase64 = String(req.body?.image_base64 || req.body?.imageBase64 || '');

  const identifiers = Array.isArray(req.body?.identifiers)
    ? req.body.identifiers
        .map((value) => clean(value, 100).toUpperCase())
        .filter(Boolean)
        .slice(0, 20)
    : [];
    const setCodeOcrHintR26B = String(req.body?.set_code_ocr_hint || '');

  if (!q || q.length < 2) {
    return res.status(400).json({
      success: false,
      error: 'QUERY_REQUIRED',
      message: 'Se requiere una pista OCR legible para comparar contra nombres reales del catálogo.'
    });
  }

  if (!['YUGIOH','POKEMON','MAGIC'].includes(game)) {
    return res.status(400).json({
      success:false,
      error:'GAME_REQUIRED',
      message:'Selecciona Pokémon, Yu-Gi-Oh! o Magic.'
    });
  }

  try {
    const queryVariants = r19bQueryVariants(q);

    let candidates = await r19bProviderSearch(game, queryVariants, identifiers);
    candidates = shinyHighestMarketPriceR29(candidates);
    const setCodeOcrHintR26D2 = String(
      req.body?.set_code_ocr_hint || ''
    );

    let r26d2ExactCode = null;

    if(
      String(game || '').toUpperCase() === 'YUGIOH' &&
      Array.isArray(candidates) &&
      candidates.length
    ){
      r26d2ExactCode =
        r26d2ResolveExactProviderCode(
          candidates,
          q,
          setCodeOcrHintR26D2
        );

      if(r26d2ExactCode?.resolved){
        candidates = r26d2ExactCode.rows;
      }
    }

    let setHintMatchR26B = false;
    let setHintScoreR26B = 0;

    if (
      String(game || '').toUpperCase() === 'YUGIOH' &&
      setCodeOcrHintR26B
    ) {
      const hintPriorityR26B =
        r26bPrioritizeSetHint(candidates, setCodeOcrHintR26B);

      candidates = hintPriorityR26B.rows;
      setHintMatchR26B = hintPriorityR26B.matched;
      setHintScoreR26B = hintPriorityR26B.score;
    }

    if (!candidates.length) {
      return res.json({
        success:true,
        data:{
          game,
          query:q,
          query_variants:queryVariants,
          matches:[],
          candidate_count:0,
          compared_count:0,
          identification_mode:'OCR_CATALOG_NAMES_R19B',
          message:'El proveedor no encontró candidatos para las pistas OCR.'
        }
      });
    }

    let ranked = r19bRankOfficialNames(candidates,q,queryVariants);
    if(r26d2ExactCode?.resolved){
      const exactCollectorR26D2 =
        r26d2Normalize(
          r26d2ExactCode.collector_number
        );

      const exactRowsR26D2 =
        ranked.filter(row =>
          r26d2Normalize(
            row?.collector_number || ''
          ) === exactCollectorR26D2
        );

      if(exactRowsR26D2.length){
        ranked = exactRowsR26D2;
      }
    }


    const exactIdentifierMatchesR25 =
      game === 'YUGIOH' && identifiers.length
        ? ranked.filter(
            (row) =>
              identityPriority(
                row,
                q,
                identifiers
              ).idMatch
          )
        : [];

    /*
     * R25 strict priority:
     * exact Yu-Gi-Oh! print/set identifier > OCR name > image.
     * OpenCLIP is never allowed to replace an exact set-code match.
     */
    const rankedForIdentityR25 =
      exactIdentifierMatchesR25.length
        ? exactIdentifierMatchesR25
        : ranked;

    // OCR is only a clue. Official provider names are authoritative.
    // Keep broad text matches; visual comparison breaks close ties.
    const textCompatible = rankedForIdentityR25.filter((row)=>
      Number(row.ocr_catalog_similarity||0) >= 0.42
    );

    const identityPool = (
      textCompatible.length
        ? textCompatible
        : rankedForIdentityR25.slice(0,20)
    ).slice(0,30);

    let matches = identityPool;
    let comparedCount = 0;
    let identificationMode = 'OCR_CATALOG_NAMES_R19B';

    if (imageBase64 && identityPool.length) {
      const visualResponse = await fetch(`${VISUAL_SERVICE_URL}/external-rank`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          image_base64:imageBase64,
          candidates:identityPool.map((c)=>({
            source:c.source,
            game:c.game,
            external_id:c.external_id,
            name:c.name,
            set_name:c.set_name,
            set_code:c.set_code,
            collector_number:c.collector_number,
            rarity:c.rarity,
            type:c.type,
            description:c.description,
            image:c.image,
            language:c.language,
            market_price_usd:c.market_price_usd,
            raw_hint:{
              ...(c.raw_hint||{}),
              internet_prices:c.internet_prices||[],
              internet_match_score:c.internet_match_score,
              ocr_catalog_similarity:c.ocr_catalog_similarity,
              ocr_literal_similarity:c.ocr_literal_similarity
            }
          })),
          limit:Math.min(10,identityPool.length)
        }),
        signal:AbortSignal.timeout(120000)
      });

      const visualPayload = await visualResponse.json().catch(()=>({}));

      if (!visualResponse.ok) {
        throw new Error(`VISUAL_EXTERNAL_RANK_FAILED:${visualPayload?.detail || visualResponse.status}`);
      }

      matches = (visualPayload.matches || []).map((m)=>({
        ...m,
        internet_prices:m?.raw_hint?.internet_prices||[],
        internet_match_score:
          m?.raw_hint?.internet_match_score ??
          m?.internet_match_score ??
          null,
        ocr_catalog_similarity:
          m?.raw_hint?.ocr_catalog_similarity ??
          null,
        ocr_literal_similarity:
          m?.raw_hint?.ocr_literal_similarity ??
          null,
        similarity:Number(m.visual_similarity||0)
      })).sort((a,b)=>{
        const aText=Number(a.ocr_catalog_similarity||0);
        const bText=Number(b.ocr_catalog_similarity||0);

        // Text identity first; image only resolves close text matches.
        const aBucket=Math.round(aText*10);
        const bBucket=Math.round(bText*10);

        if(aBucket!==bBucket)return bBucket-aBucket;

        return Number(b.visual_similarity||0)-Number(a.visual_similarity||0);
      });

      comparedCount=Number(visualPayload.compared_count||0);
      identificationMode='OCR_CATALOG_NAMES_OPENCLIP_R19B';
    }

    return res.json({
      success:true,
      data:{
        game,
        query:q,
        query_variants:queryVariants,
        matches,
        candidate_count:candidates.length,
        text_candidate_count:identityPool.length,
        compared_count:comparedCount,
        identification_mode:identificationMode,
        provider:candidates[0]?.source||'',
        identifiers,
        exact_identifier_match:
          exactIdentifierMatchesR25.length > 0,
        exact_identifier_match_count:
          exactIdentifierMatchesR25.length,
        local_catalog_used:false
      }
    });
  } catch (error) {
    console.error(brandText('[GMX][EXTERNAL_PHOTO_SEARCH_R19B]'), game, q, error);

    const detail=String(error?.message||error);
    const offline=/fetch failed|aborted|timeout|VISUAL_EXTERNAL_RANK_FAILED/i.test(detail);

    return res.status(offline?503:502).json({
      success:false,
      error:offline
        ?'INTERNET_OR_VISUAL_PROVIDER_OFFLINE'
        :'EXTERNAL_PHOTO_SEARCH_FAILED',
      message:offline
        ?'No fue posible conectar con el proveedor de Internet o con OpenCLIP.'
        :'No fue posible completar la identificación mediante Internet.',
      provider_error_detail:detail.slice(0,240)
    });
  }
});
export default router;





