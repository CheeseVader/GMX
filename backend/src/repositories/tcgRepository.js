import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';

const ids = {
  games: 'id_juego', sets: 'id_set', rarities: 'id_rareza', cards: 'id_carta'
};

export async function listGames() {
  return query(`
    SELECT *
    FROM (
      SELECT DISTINCT ON (
        UPPER(COALESCE(
          NULLIF(TRIM(catalogo_codigo),''),
          NULLIF(TRIM(codigo),''),
          NULLIF(TRIM(id_juego),'')
        ))
      ) j.*
      FROM gmx.tcg_juegos j
      ORDER BY
        UPPER(COALESCE(
          NULLIF(TRIM(catalogo_codigo),''),
          NULLIF(TRIM(codigo),''),
          NULLIF(TRIM(id_juego),'')
        )),
        CASE WHEN NULLIF(TRIM(catalogo_codigo),'') IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(activo,true)=true THEN 0 ELSE 1 END,
        row_id
    ) q
    ORDER BY COALESCE(orden,999999),nombre,row_id
  `);
}
export async function listSets(gameId = '') {
  return query(`SELECT * FROM gmx.tcg_sets
    ${gameId ? 'WHERE id_juego=$1' : ''}
    ORDER BY COALESCE(orden,999999),COALESCE(fecha_lanzamiento,'1900-01-01'::timestamptz) DESC,nombre,row_id`,
  gameId ? [gameId] : []);
}
export async function listRarities(gameId = '') {
  return query(`SELECT * FROM gmx.tcg_rarezas
    ${gameId ? 'WHERE id_juego=$1' : ''}
    ORDER BY COALESCE(orden,999999),nombre,row_id`, gameId ? [gameId] : []);
}
export async function listCards({ gameId = '', setId = '', search = '', limit = 300 } = {}) {
  const vals = [];const filters = [];
  if (gameId) {vals.push(gameId);filters.push(`c.id_juego=$${vals.length}`);}
  if (setId) {vals.push(setId);filters.push(`c.id_set=$${vals.length}`);}
  if (search) {
    vals.push(`%${search}%`);
    filters.push(`(COALESCE(c.nombre,'') ILIKE $${vals.length} OR COALESCE(c.numero_completo,'') ILIKE $${vals.length} OR COALESCE(c.id_carta,'') ILIKE $${vals.length})`);
  }
  vals.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
  return query(`
    SELECT c.*,j.nombre AS juego,s.nombre AS set_nombre
    FROM gmx.tcg_cartas c
    LEFT JOIN gmx.tcg_juegos j ON j.id_juego=c.id_juego
    LEFT JOIN gmx.tcg_sets s ON s.id_set=c.id_set
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY c.nombre,c.numero_completo,c.row_id
    LIMIT $${vals.length}
  `, vals);
}

export async function createCatalog(kind, input) {
  if (kind === 'games') {
    const id = input.id_juego || `TCGJ-${Date.now()}`;
    return query(`INSERT INTO gmx.tcg_juegos(id_juego,nombre,codigo,imagen,descripcion,activo,orden)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, input.nombre || null, input.codigo || null, input.imagen || null, input.descripcion || null, input.activo !== false, Number(input.orden || 0)]);
  }
  if (kind === 'sets') {
    const id = input.id_set || `TCGS-${Date.now()}`;
    return query(`INSERT INTO gmx.tcg_sets(id_set,id_juego,nombre,codigo,logo_imagen,banner_imagen,descripcion,fecha_lanzamiento,total_cartas,activo,orden)
      VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::timestamptz,$9,$10,$11) RETURNING *`,
    [id, input.id_juego || null, input.nombre || null, input.codigo || null, input.logo_imagen || null, input.banner_imagen || null, input.descripcion || null, input.fecha_lanzamiento || '', Number(input.total_cartas || 0), input.activo !== false, Number(input.orden || 0)]);
  }
  if (kind === 'rarities') {
    const id = input.id_rareza || `TCGR-${Date.now()}`;
    return query(`INSERT INTO gmx.tcg_rarezas(id_rareza,id_juego,codigo,nombre,orden,activo)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, input.id_juego || null, input.codigo || null, input.nombre || null, Number(input.orden || 0), input.activo !== false]);
  }
  if (kind === 'cards') {
    if (!input.id_juego || !input.id_set) throw new Error('TCG_GAME_AND_SET_REQUIRED');
    const setCheck = await query(`SELECT id_juego FROM gmx.tcg_sets WHERE id_set=$1 ORDER BY row_id LIMIT 1`, [input.id_set]);
    if (!setCheck.rowCount || setCheck.rows[0].id_juego !== input.id_juego) throw new Error('TCG_SET_GAME_MISMATCH');
    if (String(input.rareza || '').trim()) {
      const rarityCheck = await query(`SELECT row_id FROM gmx.tcg_rarezas
        WHERE id_juego=$1 AND COALESCE(activo,true)=true
          AND (LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM($2))
            OR LOWER(TRIM(COALESCE(codigo,'')))=LOWER(TRIM($2)))
        LIMIT 1`, [input.id_juego, input.rareza]);
      if (!rarityCheck.rowCount) throw new Error('TCG_RARITY_GAME_MISMATCH');
    }
    const id = input.id_carta || `TCGC-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    return query(`INSERT INTO gmx.tcg_cartas(
      id_carta,id_juego,id_set,nombre,numero_carta,numero_set,numero_completo,rareza,
      tipo_carta,subtipo,artista,descripcion,imagen_principal,estado_catalogo,
      fecha_creacion,fecha_actualizacion)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()) RETURNING *`,
    [id, input.id_juego || null, input.id_set || null, input.nombre || null, input.numero_carta || null, input.numero_set || null, input.numero_completo || null, input.rareza || null, input.tipo_carta || null, input.subtipo || null, input.artista || null, input.descripcion || null, input.imagen_principal || null, input.estado_catalogo || 'ACTIVA']);
  }
  throw new Error('INVALID_CATALOG_KIND');
}

export async function updateCatalog(kind, rowId, input) {
  if (kind === 'games') return query(`UPDATE gmx.tcg_juegos SET nombre=$2,codigo=$3,imagen=$4,descripcion=$5,activo=$6,orden=$7 WHERE row_id=$1 RETURNING *`,
  [rowId, input.nombre || null, input.codigo || null, input.imagen || null, input.descripcion || null, input.activo !== false, Number(input.orden || 0)]);
  if (kind === 'sets') return query(`UPDATE gmx.tcg_sets SET id_juego=$2,nombre=$3,codigo=$4,logo_imagen=$5,banner_imagen=$6,descripcion=$7,fecha_lanzamiento=NULLIF($8,'')::timestamptz,total_cartas=$9,activo=$10,orden=$11 WHERE row_id=$1 RETURNING *`,
  [rowId, input.id_juego || null, input.nombre || null, input.codigo || null, input.logo_imagen || null, input.banner_imagen || null, input.descripcion || null, input.fecha_lanzamiento || '', Number(input.total_cartas || 0), input.activo !== false, Number(input.orden || 0)]);
  if (kind === 'rarities') return query(`UPDATE gmx.tcg_rarezas SET id_juego=$2,codigo=$3,nombre=$4,orden=$5,activo=$6 WHERE row_id=$1 RETURNING *`,
  [rowId, input.id_juego || null, input.codigo || null, input.nombre || null, Number(input.orden || 0), input.activo !== false]);
  if (kind === 'cards') return query(`UPDATE gmx.tcg_cartas SET id_juego=$2,id_set=$3,nombre=$4,numero_carta=$5,numero_set=$6,numero_completo=$7,rareza=$8,tipo_carta=$9,subtipo=$10,artista=$11,descripcion=$12,imagen_principal=$13,estado_catalogo=$14,fecha_actualizacion=NOW() WHERE row_id=$1 RETURNING *`,
  [rowId, input.id_juego || null, input.id_set || null, input.nombre || null, input.numero_carta || null, input.numero_set || null, input.numero_completo || null, input.rareza || null, input.tipo_carta || null, input.subtipo || null, input.artista || null, input.descripcion || null, input.imagen_principal || null, input.estado_catalogo || 'ACTIVA']);
  throw new Error('INVALID_CATALOG_KIND');
}

export async function listInventory({ branchId = '', gameId = '', setId = '', rarity = '', search = '', limit = 500 } = {}) {
  const vals = [];const filters = [];
  if (branchId) {vals.push(branchId);filters.push(`s.id_sucursal=$${vals.length}`);}
  if (gameId) {vals.push(gameId);filters.push(`c.id_juego=$${vals.length}`);}
  if (setId) {vals.push(setId);filters.push(`c.id_set=$${vals.length}`);}
  if (rarity) {vals.push(rarity);filters.push(`LOWER(COALESCE(c.rareza,''))=LOWER($${vals.length})`);}
  if (search) {
    vals.push(`%${search}%`);
    filters.push(`(COALESCE(i.sku,'') ILIKE $${vals.length} OR COALESCE(c.nombre,'') ILIKE $${vals.length} OR COALESCE(i.id_inventario,'') ILIKE $${vals.length})`);
  }
  vals.push(Math.min(Math.max(Number(limit) || 500, 1), 1000));
  return query(`
    SELECT i.row_id,i.id_inventario,i.id_carta,i.sku,i.idioma,i.condicion,i.acabado,i.edicion,
      i.graded,i.empresa_grading,i.grado,i.certificado,i.costo,i.precio,i.precio_oferta,
      i.stock AS stock_global,i.stock_reservado AS reservado_global,i.estado_venta,i.rareza,
      c.nombre AS carta,c.id_juego,c.id_set,c.numero_completo,
      s.id_sucursal,s.sucursal,s.stock,s.stock_reservado
    FROM gmx.tcg_inventario i
    LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
    LEFT JOIN gmx.tcg_inventario_sucursales s ON s.id_inventario=i.id_inventario
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY c.nombre,i.sku,s.sucursal
    LIMIT $${vals.length}
  `, vals);
}

export async function listAcquisitions({ limit = 200 } = {}) {
  return query(`SELECT * FROM gmx.tcg_adquisiciones ORDER BY fecha DESC NULLS LAST,row_id DESC LIMIT $1`,
  [Math.min(Math.max(Number(limit) || 200, 1), 500)]);
}


export async function updateInventoryCommercialData(inventoryId, input = {}) {
  const id = String(inventoryId || '').trim();

  const cost = Number(input.costo);
  const price = Number(input.precio);
  const offer = Number(input.precio_oferta || 0);
  const status = String(input.estado_venta || 'DISPONIBLE').trim().toUpperCase();

  if (!id) throw new Error('INVALID_INVENTORY_ID');

  if (
  !Number.isFinite(cost) || cost < 0 ||
  !Number.isFinite(price) || price < 0 ||
  !Number.isFinite(offer) || offer < 0)
  throw new Error('INVALID_PRICE');

  const allowedStatus = [
  'DISPONIBLE',
  'NO_DISPONIBLE',
  'PAUSADO'];


  if (!allowedStatus.includes(status))
  throw new Error('INVALID_SALE_STATUS');

  const r = await query(`
    UPDATE gmx.tcg_inventario
    SET
      costo=$2,
      precio=$3,
      precio_oferta=$4,
      estado_venta=$5,
      ultima_actualizacion=NOW()
    WHERE id_inventario=$1
    RETURNING
      row_id,
      id_inventario,
      id_carta,
      sku,
      costo,
      precio,
      precio_oferta,
      stock,
      stock_reservado,
      estado_venta,
      ultima_actualizacion
  `, [id, cost, price, offer, status]);

  return r.rows[0] || null;
}

export async function receiveInventory(input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cardId = String(input.id_carta || '').trim();
    const branchId = String(input.id_sucursal || '').trim();
    const quantity = Math.trunc(Number(input.cantidad));
    const cost = Number(input.costo_unitario || 0);
    const price = Number(input.precio_venta || 0);
    const offer = Number(input.precio_oferta || 0);
    if (!cardId || !branchId || !Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_ENTRY');
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(offer) || offer < 0) throw new Error('INVALID_PRICE');

    const card = await client.query(`SELECT * FROM gmx.tcg_cartas WHERE id_carta=$1 ORDER BY row_id LIMIT 1`, [cardId]);
    if (!card.rowCount) throw new Error('CARD_NOT_FOUND');
    const branch = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales WHERE id_sucursal=$1 AND COALESCE(activa,true)=true ORDER BY row_id LIMIT 1`, [branchId]);
    if (!branch.rowCount) throw new Error('BRANCH_NOT_FOUND');

    const v = {
      idioma: String(input.idioma || 'ES').toUpperCase(),
      condicion: String(input.condicion || 'NM').toUpperCase(),
      acabado: String(input.acabado || 'NORMAL').toUpperCase(),
      edicion: String(input.edicion || '').trim(),
      graded: input.graded === true,
      empresa: String(input.empresa_grading || '').trim(),
      grado: input.grado === '' || input.grado == null ? null : Number(input.grado),
      certificado: String(input.certificado || '').trim()
    };

    let inv = await client.query(`
      SELECT * FROM gmx.tcg_inventario
      WHERE id_carta=$1
        AND COALESCE(idioma,'')=$2 AND COALESCE(condicion,'')=$3
        AND COALESCE(acabado,'')=$4 AND COALESCE(edicion,'')=$5
        AND COALESCE(graded,false)=$6
        AND COALESCE(empresa_grading,'')=$7
        AND COALESCE(grado,-1)=COALESCE($8::numeric,-1)
        AND COALESCE(certificado,'')=$9
      ORDER BY row_id LIMIT 1 FOR UPDATE
    `, [cardId, v.idioma, v.condicion, v.acabado, v.edicion, v.graded, v.empresa, v.grado, v.certificado]);

    const cardRow = card.rows[0];
    if (!inv.rowCount) {
      const inventoryId = `TCGI-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
      const sku = `TCG-${String(cardRow.id_carta).replace(/[^A-Za-z0-9]/g, '').slice(-10)}-${v.idioma}-${v.condicion}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      inv = await client.query(`
        INSERT INTO gmx.tcg_inventario(
          id_inventario,id_carta,sku,idioma,condicion,acabado,edicion,graded,
          empresa_grading,grado,certificado,costo,precio,precio_oferta,stock,
          stock_reservado,ubicacion,sucursal,estado_venta,fecha_entrada,
          ultima_actualizacion,rareza)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0,$15,$16,'DISPONIBLE',NOW(),NOW(),$17)
        RETURNING *
      `, [inventoryId, cardId, sku, v.idioma, v.condicion, v.acabado, v.edicion, v.graded, v.empresa || null, v.grado, v.certificado || null, cost, price, offer, branchId, branch.rows[0].nombre_sucursal, cardRow.rareza || null]);
    }

    const invRow = inv.rows[0];
    const globalBefore = Number(invRow.stock || 0);
    const globalAfter = globalBefore + quantity;
    await client.query(`UPDATE gmx.tcg_inventario SET stock=$2,costo=$3,precio=$4,precio_oferta=$5,ultima_actualizacion=NOW() WHERE row_id=$1`,
    [invRow.row_id, globalAfter, cost, price, offer]);

    let local = await client.query(`SELECT * FROM gmx.tcg_inventario_sucursales WHERE id_sucursal=$1 AND id_inventario=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`,
    [branchId, invRow.id_inventario]);
    if (!local.rowCount) {
      local = await client.query(`
        INSERT INTO gmx.tcg_inventario_sucursales(
          id_registro,id_inventario,id_carta,sku,id_sucursal,sucursal,stock,stock_reservado,ultima_actualizacion)
        VALUES('TCGIS-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
          $1,$2,$3,$4,$5,0,0,NOW()) RETURNING *
      `, [invRow.id_inventario, cardId, invRow.sku, branchId, branch.rows[0].nombre_sucursal]);
    }
    const localBefore = Number(local.rows[0].stock || 0),localAfter = localBefore + quantity;
    await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$2,ultima_actualizacion=NOW() WHERE row_id=$1`,
    [local.rows[0].row_id, localAfter]);

    const acquisitionId = `TCGA-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const total = Number((cost * quantity).toFixed(4));
    const margin = Number((price - cost).toFixed(4));
    const marginPct = cost > 0 ? Number((margin / cost * 100).toFixed(4)) : 0;
    await client.query(`
      INSERT INTO gmx.tcg_adquisiciones(
        id_adquisicion,fecha,tipo_entrada,origen_nombre,origen_referencia,documento,
        id_juego,id_set,id_carta,id_inventario,sku,carta,rareza,idioma,condicion,edicion,
        graded,empresa_grading,grado,certificado,id_sucursal,sucursal,cantidad,costo_unitario,
        costo_total,precio_venta,precio_oferta,margen_unitario,margen_porcentaje,id_admin,
        administrador,notas,estado,mensaje)
      VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27,$28,'LOCAL','APP Local',$29,'COMPLETADA','Entrada local registrada')
    `, [acquisitionId, input.tipo_entrada || 'COMPRA', input.origen_nombre || null, input.origen_referencia || null, input.documento || null,
    cardRow.id_juego, cardRow.id_set, cardId, invRow.id_inventario, invRow.sku, cardRow.nombre, cardRow.rareza,
    v.idioma, v.condicion, v.edicion, v.graded, v.empresa || null, v.grado, v.certificado || null, branchId, branch.rows[0].nombre_sucursal,
    quantity, cost, total, price, offer, margin, marginPct, input.notas || null]);

    await client.query(`
      INSERT INTO gmx.tcg_movimientos_sucursales(
        id_movimiento,fecha,tipo,id_inventario,id_carta,sku,id_sucursal_destino,sucursal_destino,
        cantidad,stock_destino_anterior,stock_destino_nuevo,stock_global_anterior,stock_global_nuevo,
        referencia,motivo,id_admin,administrador)
      VALUES('TCGMOV-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
        NOW(),'ENTRADA',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Entrada TCG local','LOCAL','APP Local')
    `, [invRow.id_inventario, cardId, invRow.sku, branchId, branch.rows[0].nombre_sucursal, quantity, localBefore, localAfter, globalBefore, globalAfter, acquisitionId]);

    await client.query('COMMIT');
    return { id_adquisicion: acquisitionId, id_inventario: invRow.id_inventario, sku: invRow.sku, stock_sucursal: localAfter, stock_global: globalAfter };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


export async function listMasterGames() {
  return query(`SELECT m.*,
      j.row_id AS tienda_row_id,j.id_juego AS tienda_id_juego,
      COALESCE(j.activo,false) AS agregado_tienda,
      COALESCE(j.visible_portal,false) AS visible_portal
    FROM gmx.tcg_master_juegos m
    LEFT JOIN LATERAL (
      SELECT x.*
      FROM gmx.tcg_juegos x
      WHERE UPPER(COALESCE(NULLIF(TRIM(x.catalogo_codigo),''),NULLIF(TRIM(x.codigo),'')))=UPPER(m.codigo)
      ORDER BY
        CASE WHEN x.catalogo_codigo=m.codigo THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(x.activo,true)=true THEN 0 ELSE 1 END,
        x.row_id
      LIMIT 1
    ) j ON true
    ORDER BY COALESCE(m.orden,999999),m.nombre`);
}

export async function listMasterSets(gameCode = '') {
  return query(`SELECT * FROM gmx.tcg_master_sets
    ${gameCode ? 'WHERE id_juego=$1' : ''}
    ORDER BY COALESCE(fecha_lanzamiento,'1900-01-01'::date) DESC,nombre`,
  gameCode ? [gameCode] : []);
}

export async function listMasterRarities(gameCode = '') {
  return query(`SELECT * FROM gmx.tcg_master_rarezas
    ${gameCode ? 'WHERE id_juego=$1' : ''}
    ORDER BY COALESCE(orden,999999),nombre`,
  gameCode ? [gameCode] : []);
}

export async function activateMasterGame(gameCode, { visiblePortal = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query(`SELECT * FROM gmx.tcg_master_juegos WHERE codigo=$1 AND activo=true LIMIT 1`, [gameCode]);
    if (!m.rowCount) throw new Error('MASTER_GAME_NOT_FOUND');
    const game = m.rows[0];

    let existing = await client.query(`SELECT * FROM gmx.tcg_juegos WHERE catalogo_codigo=$1 OR UPPER(COALESCE(codigo,''))=$1 ORDER BY row_id LIMIT 1`, [gameCode]);
    let local;
    if (existing.rowCount) {
      local = (await client.query(`UPDATE gmx.tcg_juegos SET
        nombre=$2,codigo=$3,catalogo_codigo=$3,publisher=$4,sitio_oficial=$5,
        activo=true,visible_portal=$6,orden=$7
        WHERE row_id=$1 RETURNING *`, [
      existing.rows[0].row_id, game.nombre, game.codigo, game.publisher, game.sitio_oficial, visiblePortal === true, game.orden]
      )).rows[0];
    } else {
      const id = `TCGJ-${game.codigo}`;
      local = (await client.query(`INSERT INTO gmx.tcg_juegos(
        id_juego,nombre,codigo,catalogo_codigo,publisher,sitio_oficial,activo,visible_portal,orden)
        VALUES($1,$2,$3,$3,$4,$5,true,$6,$7) RETURNING *`, [
      id, game.nombre, game.codigo, game.publisher, game.sitio_oficial, visiblePortal === true, game.orden]
      )).rows[0];
    }

    const sets = await client.query(`SELECT * FROM gmx.tcg_master_sets WHERE id_juego=$1 AND activo=true`, [gameCode]);
    for (const s of sets.rows) {
      const ex = await client.query(`SELECT row_id FROM gmx.tcg_sets
        WHERE id_juego=$1 AND UPPER(COALESCE(codigo,''))=UPPER($2) ORDER BY row_id LIMIT 1`, [local.id_juego, s.codigo]);
      if (ex.rowCount) {
        await client.query(`UPDATE gmx.tcg_sets SET nombre=$3,fecha_lanzamiento=$4,total_cartas=$5,
          activo=true,fuente_oficial=$6 WHERE row_id=$1 AND id_juego=$2`, [
        ex.rows[0].row_id, local.id_juego, s.nombre, s.fecha_lanzamiento, s.total_cartas, s.fuente_oficial]
        );
      } else {
        await client.query(`INSERT INTO gmx.tcg_sets(
          id_set,id_juego,nombre,codigo,fecha_lanzamiento,total_cartas,activo,orden,fuente_oficial)
          VALUES($1,$2,$3,$4,$5,$6,true,0,$7)`, [
        `${gameCode}-${s.codigo}`, local.id_juego, s.nombre, s.codigo, s.fecha_lanzamiento, s.total_cartas, s.fuente_oficial]
        );
      }
    }

    const rarities = await client.query(`SELECT * FROM gmx.tcg_master_rarezas WHERE id_juego=$1 AND activo=true`, [gameCode]);
    for (const r of rarities.rows) {
      const ex = await client.query(`SELECT row_id FROM gmx.tcg_rarezas
        WHERE id_juego=$1 AND UPPER(COALESCE(codigo,''))=UPPER($2) ORDER BY row_id LIMIT 1`, [local.id_juego, r.codigo]);
      if (ex.rowCount) {
        await client.query(`UPDATE gmx.tcg_rarezas SET nombre=$3,orden=$4,activo=true WHERE row_id=$1 AND id_juego=$2`, [
        ex.rows[0].row_id, local.id_juego, r.nombre, r.orden]
        );
      } else {
        await client.query(`INSERT INTO gmx.tcg_rarezas(id_rareza,id_juego,codigo,nombre,orden,activo)
          VALUES($1,$2,$3,$4,$5,true)`, [
        `${gameCode}-${r.codigo}`, local.id_juego, r.codigo, r.nombre, r.orden]
        );
      }
    }

    await client.query('COMMIT');
    return { game: local, sets: sets.rowCount, rarities: rarities.rowCount };
  } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
}

export async function updateGameVisibility(rowId, { visiblePortal, activo } = {}) {
  const r = await query(`UPDATE gmx.tcg_juegos SET
    visible_portal=COALESCE($2,visible_portal),
    activo=COALESCE($3,activo)
    WHERE row_id=$1 RETURNING *`, [
  rowId, typeof visiblePortal === 'boolean' ? visiblePortal : null, typeof activo === 'boolean' ? activo : null]
  );
  return r.rows[0] || null;
}


export async function receiveInventoryBulk({ rows = [], sourceType = 'ADQUISICION' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error('EMPTY_BULK_RECEIPT');
  if (list.length > 500) throw new Error('BULK_CHUNK_TOO_LARGE');

  const result = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    try {
      const data = await receiveInventory({
        ...row,
        tipo_entrada: String(row.tipo_entrada || sourceType || 'ADQUISICION').toUpperCase(),
        origen_nombre: row.origen_nombre || (
        String(sourceType || '').toUpperCase() === 'INVENTARIO_INICIAL' ?
        'Inventario inicial' :
        'Recepción masiva'),

        origen_referencia: row.origen_referencia || row.lote || ''
      });
      result.push({ index: i, ok: true, data });
    } catch (error) {
      result.push({
        index: i, ok: false,
        id_carta: String(row.id_carta || ''),
        error: String(error?.message || error)
      });
    }
  }
  return {
    total: list.length,
    ok: result.filter((x) => x.ok).length,
    failed: result.filter((x) => !x.ok).length,
    result
  };
}
