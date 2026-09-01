import { pool, query } from './db.js';

const MAX_BATCH = 500;
const INSTALL_BATCH = 200;
const FRESH_DAYS = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };

function text(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalized(value) {
  return text(value, 300).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value) {
  return normalized(value).replace(/\s+/g, '');
}

function providerCode(value) {
  const key = normalized(value).replace(/\s+/g, '');
  if (key === 'tcgdex') return 'TCGDEX';
  if (key === 'pokemontcgapi') return 'POKEMON_TCG_API';
  if (key === 'ygoprodeck') return 'YGOPRODECK';
  if (key === 'scryfall') return 'SCRYFALL';
  return text(value, 80).toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
}

function identityKey(row = {}) {
  return [
    text(row.game, 30).toUpperCase(), providerCode(row.source), text(row.external_id, 120),
    compact(row.set_code || row.set_name), compact(row.collector_number), normalized(row.name),
    text(row.language || 'EN', 20).toUpperCase()
  ].join('|');
}

function normalizeIdentity(row = {}) {
  const gameCode = text(row.game, 30).toUpperCase();
  const name = text(row.name, 220);
  if (!gameCode || !name) throw new Error('VISUAL_IDENTITY_INCOMPLETE');
  return {
    key: text(row.key, 700) || identityKey(row),
    game_code: gameCode,
    provider_code: providerCode(row.source || row.provider_code),
    external_id: text(row.external_id, 140),
    name,
    name_lower: name.toLowerCase(),
    name_normalized: normalized(name),
    set_code: text(row.set_code, 120),
    set_name: text(row.set_name, 220),
    collector_number: text(row.collector_number, 120),
    language: text(row.language || 'EN', 20).toUpperCase(),
    rarity: text(row.rarity, 120),
    card_type: text(row.type || row.card_type, 180),
    description: text(row.description, 2000),
    image: text(row.image, 700),
    source_url: text(row.source_url || row.raw_hint?.source_url, 700),
    internet_prices: (Array.isArray(row.internet_prices) ? row.internet_prices : []).slice(0, 30).map((price) => ({
      provider: text(price?.provider, 80), variant: text(price?.variant || 'default', 120),
      currency: text(price?.currency || 'USD', 20), low: priceNumber(price?.low), mid: priceNumber(price?.mid),
      high: priceNumber(price?.high), market: priceNumber(price?.market), trend: priceNumber(price?.trend),
      source_url: text(price?.source_url, 700), provider_updated_at: price?.provider_updated_at || null,
      fetched_at: price?.fetched_at || new Date().toISOString(), origin: 'INTERNET'
    }))
  };
}

function sourceRefs(card) {
  return card?.source_refs && typeof card.source_refs === 'object' ? card.source_refs : {};
}

function scoreCandidate(identity, card) {
  const refs = sourceRefs(card);
  let score = 0;
  const reasons = [];
  const providerId = text(refs[identity.provider_code] || '', 140);
  if (identity.external_id && (
    (text(card.provider_code, 80).toUpperCase() === identity.provider_code && text(card.external_id, 140) === identity.external_id) ||
    providerId === identity.external_id
  )) {
    score += 100;
    reasons.push('provider_external_id');
  }
  const wantedName = identity.name_normalized;
  const cardName = normalized(card.name);
  if (wantedName && cardName === wantedName) {
    score += 50;
    reasons.push('name');
  } else if (wantedName && (cardName.includes(wantedName) || wantedName.includes(cardName))) {
    score += 18;
    reasons.push('partial_name');
  }
  if (identity.set_code && compact(card.set_code) === compact(identity.set_code)) {
    score += 25;
    reasons.push('set_code');
  }
  const wantedNumber = compact(identity.collector_number);
  if (wantedNumber && [card.collector_number, card.number].some((v) => compact(v) === wantedNumber)) {
    score += 25;
    reasons.push('collector_number');
  }
  if (identity.language && text(card.language, 20).toUpperCase() === identity.language) {
    score += 5;
    reasons.push('language');
  }
  return { score, reasons };
}

function metadataValue(metadata, paths) {
  for (const path of paths) {
    let current = metadata;
    for (const key of path) current = current && typeof current === 'object' ? current[key] : undefined;
    const value = text(current, 140);
    if (value) return value;
  }
  return null;
}

function existingTcgplayerIds(card) {
  const refs = sourceRefs(card);
  const metadata = card?.metadata && typeof card.metadata === 'object' ? card.metadata : {};
  const productId = text(refs.TCGPLAYER || refs.TCGPLAYER_PRODUCT_ID || '', 140) || metadataValue(metadata, [
    ['tcgplayer', 'productId'], ['tcgplayer', 'product_id'], ['tcgplayerProductId'], ['tcgplayer_product_id']
  ]);
  const sku = metadataValue(metadata, [
    ['tcgplayer', 'sku'], ['tcgplayer', 'skuId'], ['tcgplayer', 'sku_id'], ['tcgplayerSku'], ['tcgplayer_sku']
  ]);
  return {
    product_id: productId || null,
    sku: sku || null,
    status: productId || sku ? 'EXISTING_METADATA' : 'NOT_STORED'
  };
}

function priceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapPrice(row) {
  return {
    provider: text(row.price_provider, 80), variant: text(row.variant, 120), currency: text(row.currency, 20),
    low: priceNumber(row.low), mid: priceNumber(row.mid), high: priceNumber(row.high),
    market: priceNumber(row.market), trend: priceNumber(row.trend), source_url: text(row.source_url, 700),
    provider_updated_at: row.provider_updated_at || null, fetched_at: row.fetched_at || null
  };
}

function freshness(prices, frequency) {
  const policy = FRESH_DAYS[text(frequency, 20).toUpperCase()] || FRESH_DAYS.WEEKLY;
  const timestamps = prices.map((row) => new Date(row.fetched_at).getTime()).filter(Number.isFinite);
  if (!timestamps.length) return { fresh: false, age_hours: null, policy_days: policy, newest_at: null };
  const newest = Math.max(...timestamps);
  const ageHours = Math.max(0, (Date.now() - newest) / 3_600_000);
  return {
    fresh: ageHours <= policy * 24,
    age_hours: Number(ageHours.toFixed(1)),
    policy_days: policy,
    newest_at: new Date(newest).toISOString()
  };
}

async function candidateRows(identities) {
  const result = await query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(
        key text,game_code text,provider_code text,external_id text,name text,name_lower text,
        name_normalized text,set_code text,set_name text,collector_number text,language text
      )
    )
    SELECT i.key AS input_key,c.*
    FROM input i
    JOIN LATERAL (
      SELECT c.*
      FROM gmx.tcg_master_cards c
      WHERE c.game_code=i.game_code
        AND (
          (i.external_id<>'' AND (
            (UPPER(c.provider_code)=i.provider_code AND c.external_id=i.external_id)
            OR COALESCE(c.source_refs->>i.provider_code,'')=i.external_id
          ))
          OR LOWER(TRIM(c.name))=i.name_lower
          OR (
            i.collector_number<>''
            AND LOWER(c.name) LIKE '%'||REPLACE(REPLACE(i.name_lower,'%',''),'_','')||'%'
            AND regexp_replace(LOWER(COALESCE(c.collector_number,c.number,'')),'[^a-z0-9]','','g')=
                regexp_replace(LOWER(i.collector_number),'[^a-z0-9]','','g')
          )
        )
      ORDER BY c.last_synced_at DESC NULLS LAST,c.row_id
      LIMIT 20
    ) c ON true
  `, [JSON.stringify(identities)]);
  return result.rows;
}

async function operationalByIdentity(identities) {
  const result = await query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(
        key text,game_code text,provider_code text,external_id text,name text,name_lower text,
        set_code text,collector_number text
      )
    )
    SELECT i.key AS input_key,c.id_carta,c.row_id AS card_row_id,c.estado_catalogo,
      inv.id_inventario,inv.sku,inv.idioma,inv.condicion,inv.acabado,inv.edicion,
      inv.stock,inv.precio,inv.precio_oferta
    FROM input i
    JOIN gmx.tcg_juegos g ON UPPER(COALESCE(NULLIF(g.catalogo_codigo,''),NULLIF(g.codigo,'')))=i.game_code
    JOIN gmx.tcg_cartas c ON c.id_juego=g.id_juego AND (
      (i.external_id<>'' AND UPPER(COALESCE(c.provider_code,''))=i.provider_code AND c.external_id=i.external_id)
      OR (LOWER(TRIM(c.nombre))=i.name_lower AND (
        i.collector_number='' OR regexp_replace(LOWER(COALESCE(c.numero_completo,c.numero_carta,'')),'[^a-z0-9]','','g')=
        regexp_replace(LOWER(i.collector_number),'[^a-z0-9]','','g')
      ))
    )
    LEFT JOIN gmx.tcg_inventario inv ON inv.id_carta=c.id_carta
    ORDER BY i.key,c.row_id,inv.row_id
  `, [JSON.stringify(identities)]);
  const output = new Map();
  for (const row of result.rows) {
    if (!output.has(row.input_key)) output.set(row.input_key, { card: null, variants: [] });
    const item = output.get(row.input_key);
    if (!item.card) item.card = {
      row_id: Number(row.card_row_id), id_carta: row.id_carta, estado_catalogo: row.estado_catalogo
    };
    if (row.id_inventario) item.variants.push({
      id_inventario: row.id_inventario, sku: row.sku, idioma: row.idioma, condicion: row.condicion,
      acabado: row.acabado, edicion: row.edicion, stock: priceNumber(row.stock),
      precio: priceNumber(row.precio), precio_oferta: priceNumber(row.precio_oferta)
    });
  }
  return output;
}

async function enrich(masterIds) {
  const ids = [...new Set(masterIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return new Map();
  const [priceResult, operationResult, configResult] = await Promise.all([
    query(`SELECT * FROM gmx.tcg_card_price_current WHERE master_card_id=ANY($1::bigint[])
      ORDER BY master_card_id,CASE WHEN LOWER(price_provider)='tcgplayer' THEN 0 ELSE 1 END,price_provider,variant`, [ids]),
    query(`SELECT c.master_card_id,c.id_carta,c.row_id AS card_row_id,c.estado_catalogo,
        i.id_inventario,i.sku,i.idioma,i.condicion,i.acabado,i.edicion,i.stock,i.precio,i.precio_oferta
      FROM gmx.tcg_cartas c
      LEFT JOIN gmx.tcg_inventario i ON i.id_carta=c.id_carta
      WHERE c.master_card_id=ANY($1::bigint[])
      ORDER BY c.master_card_id,c.row_id,i.row_id`, [ids]),
    query(`SELECT game_code,auto_sync_frequency,auto_sync_enabled,sync_prices
      FROM gmx.tcg_sync_game_config`)
  ]);
  const configs = new Map(configResult.rows.map((row) => [text(row.game_code, 30).toUpperCase(), row]));
  const prices = new Map();
  for (const row of priceResult.rows) {
    const key = Number(row.master_card_id);
    if (!prices.has(key)) prices.set(key, []);
    prices.get(key).push(mapPrice(row));
  }
  const operations = new Map();
  for (const row of operationResult.rows) {
    const key = Number(row.master_card_id);
    if (!operations.has(key)) operations.set(key, { card: null, variants: [] });
    const item = operations.get(key);
    if (!item.card) item.card = {
      row_id: Number(row.card_row_id), id_carta: row.id_carta, estado_catalogo: row.estado_catalogo
    };
    if (row.id_inventario) item.variants.push({
      id_inventario: row.id_inventario, sku: row.sku, idioma: row.idioma, condicion: row.condicion,
      acabado: row.acabado, edicion: row.edicion, stock: priceNumber(row.stock),
      precio: priceNumber(row.precio), precio_oferta: priceNumber(row.precio_oferta)
    });
  }
  const output = new Map();
  for (const id of ids) output.set(id, {
    prices: prices.get(id) || [],
    operational: operations.get(id) || { card: null, variants: [] },
    configFor(gameCode) { return configs.get(text(gameCode, 30).toUpperCase()) || {}; }
  });
  return output;
}

export async function resolveVisualIdentities(rows = []) {
  const raw = Array.isArray(rows) ? rows : [];
  if (!raw.length) return [];
  if (raw.length > MAX_BATCH) throw new Error('VISUAL_BATCH_TOO_LARGE');
  const unique = new Map();
  for (const row of raw) {
    const item = normalizeIdentity(row);
    if (!unique.has(item.key)) unique.set(item.key, item);
  }
  const identities = [...unique.values()];
  let candidates = [];
  let operationalMatches = new Map();
  try { candidates = await candidateRows(identities); }
  catch (error) {
    if (!['42P01', '42703'].includes(error?.code)) throw error;
  }
  try { operationalMatches = await operationalByIdentity(identities); }
  catch (error) {
    if (!['42P01', '42703'].includes(error?.code)) throw error;
  }
  const byInput = new Map();
  for (const row of candidates) {
    if (!byInput.has(row.input_key)) byInput.set(row.input_key, []);
    byInput.get(row.input_key).push(row);
  }
  const matches = new Map();
  for (const identity of identities) {
    const scored = (byInput.get(identity.key) || [])
      .map((card) => ({ card, ...scoreCandidate(identity, card) }))
      .sort((a, b) => b.score - a.score || Number(a.card.row_id) - Number(b.card.row_id));
    const best = scored[0];
    const second = scored.find((item) => Number(item.card.row_id) !== Number(best?.card?.row_id));
    if (!best || best.score < 60) {
      matches.set(identity.key, { local_status: 'NOT_FOUND', confidence: best?.score || 0, reasons: best?.reasons || [] });
    } else if (second && second.score >= best.score - 5) {
      matches.set(identity.key, {
        local_status: 'AMBIGUOUS', confidence: best.score, reasons: best.reasons,
        local_candidates: scored.slice(0, 3).map((item) => ({
          master_card_id: Number(item.card.row_id), name: item.card.name, set_code: item.card.set_code,
          collector_number: item.card.collector_number || item.card.number, score: item.score
        }))
      });
    } else {
      matches.set(identity.key, { local_status: 'MATCHED', confidence: best.score, reasons: best.reasons, card: best.card });
    }
  }
  let cache = new Map();
  try { cache = await enrich([...matches.values()].filter((x) => x.local_status === 'MATCHED').map((x) => x.card.row_id)); }
  catch (error) {
    if (!['42P01', '42703'].includes(error?.code)) throw error;
  }
  return identities.map((identity) => {
    const match = matches.get(identity.key);
    const card = match?.local_status === 'MATCHED' ? match.card : null;
    const cached = card ? cache.get(Number(card.row_id)) : null;
    const prices = cached?.prices || [];
    const onlinePrices = identity.internet_prices || [];
    const config = cached?.configFor(card?.game_code || identity.game_code) || {};
    const tcgPrices = onlinePrices.filter((row) => row.provider.toLowerCase() === 'tcgplayer');
    const cachedTcgPrices = prices.filter((row) => row.provider.toLowerCase() === 'tcgplayer');
    const preferred = tcgPrices.find((row) => row.market != null) || tcgPrices[0] ||
      onlinePrices.find((row) => row.market != null) || onlinePrices[0] ||
      cachedTcgPrices.find((row) => row.market != null) || cachedTcgPrices[0] ||
      prices.find((row) => row.market != null) || prices[0] || null;
    const operational = cached?.operational?.card ? cached.operational :
      operationalMatches.get(identity.key) || { card: null, variants: [] };
    return {
      key: identity.key,
      identity,
      status: 'INTERNET_IDENTIFIED',
      identification_source: 'INTERNET',
      local_status: match?.local_status || 'NOT_FOUND',
      confidence: match?.confidence || 0,
      reasons: match?.reasons || [],
      local_candidates: match?.local_candidates || [],
      master: card ? {
        row_id: Number(card.row_id), game_code: card.game_code, provider_code: card.provider_code,
        external_id: card.external_id, source_refs: sourceRefs(card), name: card.name,
        set_code: card.set_code, number: card.number, collector_number: card.collector_number,
        rarity: card.rarity, card_type: card.card_type, subtype: card.subtype, language: card.language,
        image: card.image_local_url || card.image_large_url || card.image_small_url || null,
        purchase_url: card.purchase_url || null, source_url: card.source_url || null,
        last_synced_at: card.last_synced_at || null
      } : null,
      tcgplayer: card ? existingTcgplayerIds(card) : { product_id: null, sku: null, status: 'NOT_STORED' },
      internet_prices: onlinePrices,
      cached_prices: prices,
      tcgplayer_prices: tcgPrices.length ? tcgPrices : cachedTcgPrices,
      preferred_price: preferred,
      price_cache: onlinePrices.length ? {
        fresh: true, age_hours: 0, policy_days: FRESH_DAYS[text(config.auto_sync_frequency, 20).toUpperCase()] || 7,
        newest_at: new Date().toISOString(), origin: 'INTERNET',
        frequency: text(config.auto_sync_frequency || 'WEEKLY', 20).toUpperCase(),
        auto_sync_enabled: config.auto_sync_enabled === true,
        sync_prices: config.sync_prices !== false
      } : {
        ...freshness(prices, config.auto_sync_frequency), origin: 'SHINY_CACHE',
        frequency: text(config.auto_sync_frequency || 'WEEKLY', 20).toUpperCase(),
        auto_sync_enabled: config.auto_sync_enabled === true, sync_prices: config.sync_prices !== false
      },
      operational
    };
  });
}

function slug(value) {
  return text(value, 160).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'CARD';
}

async function ensureOne(client, masterCardId) {
  const result = await client.query(`SELECT * FROM gmx.tcg_master_cards WHERE row_id=$1 LIMIT 1 FOR UPDATE`, [masterCardId]);
  if (!result.rowCount) throw new Error('MASTER_CARD_NOT_FOUND');
  const card = result.rows[0];
  const gameResult = await client.query(`SELECT * FROM gmx.tcg_master_juegos WHERE codigo=$1 AND activo=true LIMIT 1`, [card.game_code]);
  if (!gameResult.rowCount) throw new Error('MASTER_GAME_NOT_FOUND');
  const masterGame = gameResult.rows[0];
  let game = (await client.query(`SELECT * FROM gmx.tcg_juegos
    WHERE catalogo_codigo=$1 OR UPPER(COALESCE(codigo,''))=UPPER($1)
    ORDER BY CASE WHEN catalogo_codigo=$1 THEN 0 ELSE 1 END,row_id LIMIT 1 FOR UPDATE`, [card.game_code])).rows[0];
  if (!game) {
    game = (await client.query(`INSERT INTO gmx.tcg_juegos(
      id_juego,nombre,codigo,catalogo_codigo,publisher,sitio_oficial,activo,visible_portal,orden)
      VALUES($1,$2,$3,$3,$4,$5,true,false,$6) RETURNING *`, [
      `TCGJ-${card.game_code}`, masterGame.nombre, card.game_code, masterGame.publisher,
      masterGame.sitio_oficial, masterGame.orden
    ])).rows[0];
  }
  const masterSet = (await client.query(`SELECT * FROM gmx.tcg_master_sets
    WHERE id_juego=$1 AND codigo=$2 LIMIT 1`, [card.game_code, card.set_code])).rows[0];
  let set = (await client.query(`SELECT * FROM gmx.tcg_sets
    WHERE id_juego=$1 AND UPPER(COALESCE(codigo,''))=UPPER($2)
    ORDER BY row_id LIMIT 1 FOR UPDATE`, [game.id_juego, card.set_code])).rows[0];
  if (!set) {
    set = (await client.query(`INSERT INTO gmx.tcg_sets(
      id_set,id_juego,nombre,codigo,fecha_lanzamiento,total_cartas,activo,orden,fuente_oficial)
      VALUES($1,$2,$3,$4,$5,$6,true,0,$7) RETURNING *`, [
      `${card.game_code}-${slug(card.set_code)}`, game.id_juego, masterSet?.nombre || card.set_code,
      card.set_code, masterSet?.fecha_lanzamiento || null, masterSet?.total_cartas || 0,
      masterSet?.fuente_oficial || card.source_url || null
    ])).rows[0];
  }
  if (card.rarity) {
    const rarity = (await client.query(`SELECT * FROM gmx.tcg_master_rarezas
      WHERE id_juego=$1 AND (LOWER(nombre)=LOWER($2) OR LOWER(codigo)=LOWER($2)) LIMIT 1`, [card.game_code, card.rarity])).rows[0];
    if (rarity) {
      const existing = await client.query(`SELECT row_id FROM gmx.tcg_rarezas
        WHERE id_juego=$1 AND (LOWER(nombre)=LOWER($2) OR LOWER(codigo)=LOWER($3)) LIMIT 1`,
      [game.id_juego, rarity.nombre, rarity.codigo]);
      if (!existing.rowCount) await client.query(`INSERT INTO gmx.tcg_rarezas(id_rareza,id_juego,codigo,nombre,orden,activo)
        VALUES($1,$2,$3,$4,$5,true)`, [`${card.game_code}-${slug(rarity.codigo)}`, game.id_juego, rarity.codigo, rarity.nombre, rarity.orden]);
    }
  }
  const existing = await client.query(`SELECT * FROM gmx.tcg_cartas
    WHERE master_card_id=$1 OR (UPPER(COALESCE(provider_code,''))=UPPER($2) AND external_id=$3 AND id_set=$4)
    ORDER BY CASE WHEN master_card_id=$1 THEN 0 ELSE 1 END,row_id LIMIT 1 FOR UPDATE`,
  [card.row_id, card.provider_code, card.external_id, set.id_set]);
  const image = card.image_local_url || card.image_large_url || card.image_small_url || null;
  if (existing.rowCount) {
    return (await client.query(`UPDATE gmx.tcg_cartas SET
      master_card_id=$2,provider_code=$3,external_id=$4,id_juego=$5,id_set=$6,nombre=$7,
      numero_carta=$8,numero_completo=$9,rareza=$10,tipo_carta=$11,subtipo=$12,artista=$13,
      descripcion=$14,imagen_principal=$15,image_source_url=$16,estado_catalogo='ACTIVA',fecha_actualizacion=NOW()
      WHERE row_id=$1 RETURNING *`, [
      existing.rows[0].row_id, card.row_id, card.provider_code, card.external_id, game.id_juego, set.id_set,
      card.name, card.number, card.collector_number || card.number, card.rarity, card.card_type, card.subtype,
      card.artist, card.description, image, card.image_large_url || card.image_small_url
    ])).rows[0];
  }
  return (await client.query(`INSERT INTO gmx.tcg_cartas(
    id_carta,master_card_id,provider_code,external_id,id_juego,id_set,nombre,numero_carta,
    numero_completo,rareza,tipo_carta,subtipo,artista,descripcion,imagen_principal,image_source_url,
    estado_catalogo,fecha_creacion,fecha_actualizacion)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ACTIVA',NOW(),NOW()) RETURNING *`, [
    `TCGC-${slug(card.game_code)}-${card.row_id}`, card.row_id, card.provider_code, card.external_id,
    game.id_juego, set.id_set, card.name, card.number, card.collector_number || card.number, card.rarity,
    card.card_type, card.subtype, card.artist, card.description, image, card.image_large_url || card.image_small_url
  ])).rows[0];
}

async function masterForInternetIdentity(client, identity) {
  const result = await client.query(`SELECT * FROM gmx.tcg_master_cards c
    WHERE c.game_code=$1 AND (
      ($2<>'' AND ((UPPER(c.provider_code)=$3 AND c.external_id=$2) OR COALESCE(c.source_refs->>$3,'')=$2))
      OR LOWER(TRIM(c.name))=LOWER(TRIM($4))
    )
    ORDER BY c.last_synced_at DESC NULLS LAST,c.row_id LIMIT 20`, [
    identity.game_code, identity.external_id, identity.provider_code, identity.name
  ]);
  const scored = result.rows.map((card) => ({ card, ...scoreCandidate(identity, card) }))
    .sort((a, b) => b.score - a.score || Number(a.card.row_id) - Number(b.card.row_id));
  const best = scored[0];
  const second = scored.find((item) => Number(item.card.row_id) !== Number(best?.card?.row_id));
  return best && best.score >= 60 && (!second || second.score < best.score - 5) ? best.card : null;
}

async function ensureInternetOne(client, identity) {
  const master = await masterForInternetIdentity(client, identity);
  if (master) return ensureOne(client, Number(master.row_id));

  const gameNames = { POKEMON: 'Pokémon', YUGIOH: 'Yu-Gi-Oh!', MAGIC: 'Magic: The Gathering' };
  let game = (await client.query(`SELECT * FROM gmx.tcg_juegos
    WHERE UPPER(COALESCE(NULLIF(catalogo_codigo,''),NULLIF(codigo,'')))=$1
    ORDER BY CASE WHEN catalogo_codigo=$1 THEN 0 ELSE 1 END,row_id LIMIT 1 FOR UPDATE`,
  [identity.game_code])).rows[0];
  if (!game) {
    game = (await client.query(`INSERT INTO gmx.tcg_juegos(
      id_juego,nombre,codigo,catalogo_codigo,activo,visible_portal,orden)
      VALUES($1,$2,$3,$3,true,false,0) RETURNING *`, [
      `TCGJ-${identity.game_code}`, gameNames[identity.game_code] || identity.game_code, identity.game_code
    ])).rows[0];
  }

  const setCode = identity.set_code || slug(identity.set_name || 'INTERNET');
  let set = (await client.query(`SELECT * FROM gmx.tcg_sets
    WHERE id_juego=$1 AND UPPER(COALESCE(codigo,''))=UPPER($2)
    ORDER BY row_id LIMIT 1 FOR UPDATE`, [game.id_juego, setCode])).rows[0];
  if (!set) {
    set = (await client.query(`INSERT INTO gmx.tcg_sets(
      id_set,id_juego,nombre,codigo,total_cartas,activo,orden,fuente_oficial)
      VALUES($1,$2,$3,$4,0,true,0,$5) RETURNING *`, [
      `${identity.game_code}-${slug(setCode)}`, game.id_juego, identity.set_name || setCode,
      setCode, identity.source_url || `INTERNET:${identity.provider_code}`
    ])).rows[0];
  }

  if (identity.rarity) {
    const rarity = await client.query(`SELECT row_id FROM gmx.tcg_rarezas
      WHERE id_juego=$1 AND (LOWER(COALESCE(nombre,''))=LOWER($2) OR LOWER(COALESCE(codigo,''))=LOWER($2))
      LIMIT 1`, [game.id_juego, identity.rarity]);
    if (!rarity.rowCount) await client.query(`INSERT INTO gmx.tcg_rarezas(
      id_rareza,id_juego,codigo,nombre,orden,activo) VALUES($1,$2,$3,$4,0,true)`, [
      `TCGR-${identity.game_code}-${slug(identity.rarity)}`, game.id_juego, slug(identity.rarity).toUpperCase(), identity.rarity
    ]);
  }

  const existing = await client.query(`SELECT * FROM gmx.tcg_cartas c
    WHERE c.id_juego=$1 AND c.id_set=$2 AND (
      ($3<>'' AND UPPER(COALESCE(c.provider_code,''))=$4 AND c.external_id=$3)
      OR (LOWER(TRIM(c.nombre))=LOWER(TRIM($5)) AND
        regexp_replace(LOWER(COALESCE(c.numero_completo,c.numero_carta,'')),'[^a-z0-9]','','g')=
        regexp_replace(LOWER($6),'[^a-z0-9]','','g'))
    ) ORDER BY row_id LIMIT 1 FOR UPDATE`, [
    game.id_juego, set.id_set, identity.external_id, identity.provider_code, identity.name, identity.collector_number
  ]);
  if (existing.rowCount) {
    return (await client.query(`UPDATE gmx.tcg_cartas SET
      provider_code=$2,external_id=$3,nombre=$4,numero_carta=$5,numero_completo=$5,
      rareza=$6,tipo_carta=$7,descripcion=$8,imagen_principal=COALESCE(NULLIF($9,''),imagen_principal),
      image_source_url=COALESCE(NULLIF($9,''),image_source_url),estado_catalogo='ACTIVA',fecha_actualizacion=NOW()
      WHERE row_id=$1 RETURNING *`, [
      existing.rows[0].row_id, identity.provider_code, identity.external_id, identity.name,
      identity.collector_number, identity.rarity, identity.card_type, identity.description, identity.image
    ])).rows[0];
  }
  return (await client.query(`INSERT INTO gmx.tcg_cartas(
    id_carta,provider_code,external_id,id_juego,id_set,nombre,numero_carta,numero_completo,
    rareza,tipo_carta,descripcion,imagen_principal,image_source_url,estado_catalogo,fecha_creacion,fecha_actualizacion)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$11,'ACTIVA',NOW(),NOW()) RETURNING *`, [
    `TCGC-EXT-${slug(identity.game_code)}-${slug(identity.provider_code)}-${slug(identity.external_id || identity.name)}-${slug(setCode)}`,
    identity.provider_code, identity.external_id, game.id_juego, set.id_set, identity.name,
    identity.collector_number, identity.rarity, identity.card_type, identity.description, identity.image
  ])).rows[0];
}

export async function ensureOperationalCards(masterCardIds = []) {
  const ids = [...new Set((Array.isArray(masterCardIds) ? masterCardIds : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error('MASTER_CARD_IDS_REQUIRED');
  if (ids.length > INSTALL_BATCH) throw new Error('INSTALL_BATCH_TOO_LARGE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cards = [];
    for (const id of ids) cards.push(await ensureOne(client, id));
    await client.query('COMMIT');
    return cards.map((card) => ({
      master_card_id: Number(card.master_card_id), row_id: Number(card.row_id), id_carta: card.id_carta,
      name: card.nombre, created_or_updated: true
    }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureOperationalIdentities(rows = []) {
  const raw = Array.isArray(rows) ? rows : [];
  if (!raw.length) throw new Error('INTERNET_IDENTITIES_REQUIRED');
  if (raw.length > INSTALL_BATCH) throw new Error('INSTALL_BATCH_TOO_LARGE');
  const unique = new Map();
  for (const row of raw) {
    const identity = normalizeIdentity(row);
    if (!unique.has(identity.key)) unique.set(identity.key, identity);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cards = [];
    for (const identity of unique.values()) cards.push({ identity, card: await ensureInternetOne(client, identity) });
    await client.query('COMMIT');
    return cards.map(({ identity, card }) => ({
      key: identity.key, master_card_id: card.master_card_id == null ? null : Number(card.master_card_id),
      row_id: Number(card.row_id), id_carta: card.id_carta, name: card.nombre, created_or_updated: true
    }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export const visualTcgLimits = { resolve: MAX_BATCH, install: INSTALL_BATCH };
