import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORIES_DIR = path.dirname(THIS_FILE);
const SRC_DIR = path.dirname(REPOSITORIES_DIR);
const BACKEND_DIR = path.dirname(SRC_DIR);

const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const txt = (v) => String(v ?? '').trim();
const num = (v) => Number(v || 0);

export async function getSettings(prefix = '') {
  const values = [],where = [];
  if (prefix) {values.push(`${prefix}%`);where.push(`parametro LIKE $1`);}
  return query(`SELECT parametro,valor FROM gmx.configuracion
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY parametro`, values);
}

export async function saveSettings(items, user) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('SETTINGS_OBJECT_REQUIRED');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(items)) {
      if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) throw new Error(`INVALID_SETTING_KEY:${key}`);
      await client.query(`INSERT INTO gmx.configuracion(parametro,valor)
        VALUES($1,$2)
        ON CONFLICT(parametro) DO UPDATE SET valor=EXCLUDED.valor`,
      [key, String(value ?? '')]);
    }
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'CONFIGURACION','ACTUALIZAR','SETTINGS',$1,$2)`,
    [`${Object.keys(items).length} parámetro(s)`, user?.email || brandText("GMX Local")]);
    await client.query('COMMIT');
    return getSettings();
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function listPromotions({ search = '', status = '' } = {}) {
  const vals = [],f = [];
  if (search) {vals.push(`%${search}%`);f.push(`(COALESCE(nombre,'') ILIKE $${vals.length}
    OR COALESCE(codigo,'') ILIKE $${vals.length} OR COALESCE(tipo,'') ILIKE $${vals.length})`);}
  if (status) {vals.push(status.toUpperCase());f.push(`UPPER(COALESCE(estado,''))=$${vals.length}`);}
  return query(`SELECT * FROM gmx.promociones ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY actualizacion DESC NULLS LAST,row_id DESC`, vals);
}

export async function listPromotionRedemptions({ limit = 500 } = {}) {
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  return query(`SELECT *
    FROM gmx.promociones_redenciones
    ORDER BY row_id DESC
    LIMIT $1`, [safeLimit]);
}
export async function savePromotion(rowId, b, user) {
  const data = {
    nombre: txt(b.nombre),
    tipo: txt(b.tipo || 'PORCENTAJE').toUpperCase(),
    valor: txt(b.valor),
    codigo: txt(b.codigo).toUpperCase(),
    inicio: txt(b.inicio),
    fin: txt(b.fin),
    ambito: txt(b.ambito || 'GENERAL').toUpperCase(),
    estado: txt(b.estado || 'ACTIVA').toUpperCase(),
    minimo_compra: txt(b.minimo_compra || '0'),
    limite_usos: b.limite_usos === '' || b.limite_usos == null ?
    null :
    Math.max(0, Math.trunc(num(b.limite_usos))),
    notas: txt(b.notas),
    limite_por_cliente: b.limite_por_cliente === '' || b.limite_por_cliente == null ?
    null :
    Math.max(0, Math.trunc(num(b.limite_por_cliente))),
    max_discount: b.max_discount === '' || b.max_discount == null ?
    null :
    Math.max(0, num(b.max_discount)),
    canales: txt(b.canales).toUpperCase() || null,
    id_sucursal: txt(b.id_sucursal) || null,
    acumulable_puntos: b.acumulable_puntos == null ?
    true :
    !!b.acumulable_puntos,
    acumulable_otras: b.acumulable_otras == null ?
    false :
    !!b.acumulable_otras,
    visible_publico: b.visible_publico == null ?
    true :
    !!b.visible_publico
  };

  if (!data.nombre) throw new Error('PROMOTION_NAME_REQUIRED');

  if (rowId) {
    const r = await query(`UPDATE gmx.promociones SET
      nombre=$2,
      tipo=$3,
      valor=$4,
      codigo=$5,
      inicio=$6,
      fin=$7,
      ambito=$8,
      estado=$9,
      minimo_compra=$10,
      limite_usos=$11,
      notas=$12,
      limite_por_cliente=$13,
      max_discount=$14,
      canales=$15,
      id_sucursal=$16,
      acumulable_puntos=$17,
      acumulable_otras=$18,
      visible_publico=$19,
      actualizacion=NOW()
      WHERE row_id=$1
      RETURNING *`, [
    rowId,
    data.nombre,
    data.tipo,
    data.valor,
    data.codigo || null,
    data.inicio || null,
    data.fin || null,
    data.ambito,
    data.estado,
    data.minimo_compra,
    data.limite_usos,
    data.notas || null,
    data.limite_por_cliente,
    data.max_discount,
    data.canales,
    data.id_sucursal,
    data.acumulable_puntos,
    data.acumulable_otras,
    data.visible_publico]
    );

    if (!r.rowCount) throw new Error('PROMOTION_NOT_FOUND');

    return r.rows[0];
  }

  const r = await query(`INSERT INTO gmx.promociones(
    id,
    nombre,
    tipo,
    valor,
    codigo,
    inicio,
    fin,
    ambito,
    estado,
    minimo_compra,
    limite_usos,
    usos,
    notas,
    limite_por_cliente,
    max_discount,
    canales,
    id_sucursal,
    acumulable_puntos,
    acumulable_otras,
    visible_publico,
    actualizacion
  )
  VALUES(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,0,$12,$13,$14,$15,$16,$17,$18,$19,NOW()
  )
  RETURNING *`, [
  uid('PROMO'),
  data.nombre,
  data.tipo,
  data.valor,
  data.codigo || null,
  data.inicio || null,
  data.fin || null,
  data.ambito,
  data.estado,
  data.minimo_compra,
  data.limite_usos,
  data.notas || null,
  data.limite_por_cliente,
  data.max_discount,
  data.canales,
  data.id_sucursal,
  data.acumulable_puntos,
  data.acumulable_otras,
  data.visible_publico]
  );

  return r.rows[0];
}

export async function listNotifications({ unread = '', priority = '' } = {}) {
  const vals = [],f = [];
  if (unread !== '') {vals.push(String(unread).toLowerCase() === 'true');f.push(`COALESCE(leida,false)<>$${vals.length}`);}
  if (priority) {vals.push(priority.toUpperCase());f.push(`UPPER(COALESCE(prioridad,''))=$${vals.length}`);}
  return query(`SELECT * FROM gmx.notificaciones_admin ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY COALESCE(leida,false),CASE UPPER(COALESCE(prioridad,'')) WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
    fecha DESC NULLS LAST,row_id DESC`, vals);
}

export async function markNotification(rowId, read = true) {
  const r = await query(`UPDATE gmx.notificaciones_admin SET leida=$2,actualizacion=NOW()
    WHERE row_id=$1 RETURNING *`, [rowId, !!read]);
  if (!r.rowCount) throw new Error('NOTIFICATION_NOT_FOUND');
  return r.rows[0];
}

export async function generateAlerts(user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cfg = await client.query(`SELECT parametro,valor FROM gmx.configuracion
      WHERE parametro IN ('alerts.low_stock_enabled','alerts.low_stock_threshold')`);
    const m = Object.fromEntries(cfg.rows.map((x) => [x.parametro, x.valor]));
    if (String(m['alerts.low_stock_enabled'] || 'true').toLowerCase() !== 'true') {
      await client.query('COMMIT');return { created: 0, disabled: true };
    }
    const threshold = Math.max(0, Math.trunc(Number(m['alerts.low_stock_threshold'] || 5)));
    const rows = await client.query(`SELECT s.id_sucursal,s.sucursal,s.id_producto,s.sku,s.producto,s.stock,s.stock_minimo
      FROM gmx.inventario_sucursales s
      WHERE COALESCE(s.stock,0) <= GREATEST(COALESCE(s.stock_minimo,0),$1)
      ORDER BY s.sucursal,s.producto`, [threshold]);
    let created = 0;
    for (const x of rows.rows) {
      const reference = `LOWSTOCK:${x.id_sucursal}:${x.id_producto}`;
      const exists = await client.query(`SELECT 1 FROM gmx.notificaciones_admin
        WHERE modulo='INVENTARIO' AND mensaje LIKE $1 AND COALESCE(leida,false)=false LIMIT 1`,
      [`%${reference}%`]);
      if (exists.rowCount) continue;
      await client.query(`INSERT INTO gmx.notificaciones_admin(
        id,fecha,tipo,titulo,mensaje,modulo,prioridad,leida,actualizacion)
        VALUES($1,NOW(),'STOCK_BAJO',$2,$3,'INVENTARIO',$4,false,NOW())`, [
      uid('ALERTA'), `Stock bajo · ${x.producto}`,
      `${x.sucursal} · ${x.sku} · stock ${x.stock}. ${reference}`,
      Number(x.stock) <= 0 ? 'ALTA' : 'MEDIA']
      );
      created++;
    }
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'ALERTAS','GENERAR','STOCK_BAJO',$1,$2)`,
    [`${created} alerta(s) nuevas`, user?.email || brandText("GMX Local")]);
    await client.query('COMMIT');
    return { created, checked: rows.rowCount, threshold };
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function listMedia({ search = '', category = '', active = '' } = {}) {
  const vals = [],f = [];
  if (search) {vals.push(`%${search}%`);f.push(`(COALESCE(nombre,'') ILIKE $${vals.length}
    OR COALESCE(nombre_archivo,'') ILIKE $${vals.length} OR COALESCE(categoria,'') ILIKE $${vals.length})`);}
  if (category) {vals.push(category);f.push(`categoria=$${vals.length}`);}
  if (active !== '') {vals.push(String(active).toLowerCase() === 'true');f.push(`COALESCE(activo,true)=$${vals.length}`);}
  return query(`SELECT * FROM gmx.multimedia ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY fecha DESC NULLS LAST,row_id DESC`, vals);
}

export async function saveMediaFile({ buffer, name, mime, category, user }) {
  if (!buffer?.length) throw new Error('EMPTY_FILE');
  const safeName = String(name || 'archivo.bin').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  // Evita volver a registrar exactamente el mismo contenido.
  const existing = await query(`SELECT * FROM gmx.multimedia WHERE hash=$1 ORDER BY activo DESC,fecha DESC NULLS LAST,row_id DESC LIMIT 1`, [hash]);
  if (existing.rowCount) return { ...existing.rows[0], duplicate: true };

  const id = uid('MEDIA');
  const storage = process.env.SHINY_MEDIA_DIR ?
  path.resolve(process.env.SHINY_MEDIA_DIR) :
  path.join(BACKEND_DIR, 'storage', 'media');
  await fs.mkdir(storage, { recursive: true });
  const diskName = `${id}-${safeName}`;
  const diskPath = path.join(storage, diskName);
  await fs.writeFile(diskPath, buffer);
  const type = String(mime || 'application/octet-stream').split('/')[0].toUpperCase();
  try {
    const r = await query(`INSERT INTO gmx.multimedia(
      id_media,nombre,nombre_archivo,tipo,mime_type,categoria,proveedor,ruta,file_id,url,url_drive,
      tamano_bytes,hash,activo,fecha,actualizacion,admin)
      VALUES($1,$2,$3,$4,$5,$6,'LOCAL',$7,$8,$9,NULL,$10,$11,true,NOW(),NOW(),$12)
      RETURNING *`, [
    id, safeName, safeName, type, mime || 'application/octet-stream', category || 'GENERAL',
    diskPath, diskName, `/api/v1/content/media/${id}/file`, buffer.length, hash, user?.email || brandText("GMX Local")]
    );
    return r.rows[0];
  } catch (e) {
    try {await fs.unlink(diskPath);} catch {}
    throw e;
  }
}


function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] === 169 && p[1] === 254 ||
    p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168 ||
    p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] >= 224;
  }
  if (net.isIP(address) === 6) {
    const a = address.toLowerCase();
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') ||
    a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') ||
    a.startsWith('feb') || a.startsWith('ff');
  }
  return true;
}
async function validateRemoteUrl(raw) {
  let u;
  try {u = new URL(String(raw || '').trim());} catch {throw new Error('INVALID_IMAGE_URL');}
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('IMAGE_URL_HTTP_REQUIRED');
  if (u.username || u.password) throw new Error('IMAGE_URL_CREDENTIALS_NOT_ALLOWED');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('IMAGE_URL_PRIVATE_HOST');
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((x) => isPrivateIp(x.address))) throw new Error('IMAGE_URL_PRIVATE_HOST');
  return u;
}
function extensionFromMime(mime) {
  return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg' }[
  String(mime || '').toLowerCase().split(';')[0].trim()] || '';
}
async function fetchRemoteImage(rawUrl) {
  let current = await validateRemoteUrl(rawUrl);
  const maxBytes = Math.max(1024 * 1024, Number(process.env.SHINY_REMOTE_IMAGE_LIMIT_BYTES || 20 * 1024 * 1024));
  for (let redirect = 0; redirect <= 3; redirect++) {
    const controller = new AbortController(),timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': "TCG-Store-Media-Importer/1.0", 'Accept': 'image/*' } });
    } catch (e) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') throw new Error('IMAGE_URL_TIMEOUT');
      throw new Error('IMAGE_URL_DOWNLOAD_FAILED');
    }
    clearTimeout(timer);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('IMAGE_URL_REDIRECT_INVALID');
      current = await validateRemoteUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`IMAGE_URL_HTTP_${response.status}`);
    const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) throw new Error('IMAGE_URL_NOT_AN_IMAGE');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('IMAGE_URL_TOO_LARGE');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('IMAGE_URL_EMPTY_BODY');
    const chunks = [];let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {try {await reader.cancel();} catch {}throw new Error('IMAGE_URL_TOO_LARGE');}
      chunks.push(Buffer.from(value));
    }
    if (!total) throw new Error('IMAGE_URL_EMPTY_BODY');
    return { buffer: Buffer.concat(chunks), mime, finalUrl: current.toString() };
  }
  throw new Error('IMAGE_URL_TOO_MANY_REDIRECTS');
}
export async function importMediaFromUrl({ url, name = '', category = 'GENERAL', user }) {
  const d = await fetchRemoteImage(url);
  let safeName = String(name || '').trim();
  if (!safeName) {try {safeName = decodeURIComponent(new URL(d.finalUrl).pathname.split('/').filter(Boolean).pop() || '');} catch {}}
  const ext = extensionFromMime(d.mime);
  if (!safeName) safeName = `imagen-remota${ext || '.img'}`;
  if (ext && !safeName.toLowerCase().endsWith(ext)) safeName += ext;
  const media = await saveMediaFile({ buffer: d.buffer, name: safeName, mime: d.mime, category, user });
  await query(`UPDATE gmx.multimedia SET url_origen=$2,actualizacion=NOW() WHERE id_media=$1`, [media.id_media, d.finalUrl]);
  return { ...media, url_origen: d.finalUrl, storedLocally: true };
}
export async function importManyMediaFromUrls({ urls = [], category = 'GENERAL', user }) {
  const results = [];
  for (const raw of urls.slice(0, 100)) {
    const url = String(raw || '').trim();if (!url) continue;
    try {results.push({ url, success: true, media: await importMediaFromUrl({ url, category, user }) });}
    catch (e) {results.push({ url, success: false, error: e.message });}
  }
  return results;
}

export async function mediaMeta(id) {
  const r = await query(`SELECT * FROM gmx.multimedia WHERE id_media=$1 ORDER BY row_id LIMIT 1`, [id]);
  return r.rows[0] || null;
}

export async function setMediaActive(id, active) {
  const r = await query(`UPDATE gmx.multimedia SET activo=$2,actualizacion=NOW()
    WHERE id_media=$1 RETURNING *`, [id, !!active]);
  if (!r.rowCount) throw new Error('MEDIA_NOT_FOUND');
  return r.rows[0];
}


export async function mediaImpact(id) {
  const media = await mediaMeta(id);
  if (!media) throw new Error('MEDIA_NOT_FOUND');

  const refs = await query(`
    SELECT 'SLIDESHOW_DESKTOP' source,row_id::text reference,
      COALESCE(titulo,'Slide '||row_id::text) label
    FROM gmx.cms_banners WHERE id_media_desktop=$1
    UNION ALL
    SELECT 'SLIDESHOW_MOBILE',row_id::text,
      COALESCE(titulo,'Slide '||row_id::text)||' (móvil)'
    FROM gmx.cms_banners WHERE id_media_mobile=$1
    UNION ALL
    SELECT 'BACKGROUND',parametro,parametro
    FROM gmx.configuracion
    WHERE parametro IN (
      'appearance.background_media_id',
      'admin.appearance.background_media_id',
      'public.appearance.background_media_id'
    ) AND valor=$1
    ORDER BY source,reference
  `, [id]);

  const references = refs.rows.map((x) => ({
    ...x,
    label: x.source === 'BACKGROUND' ?
    `${x.reference} (imagen de fondo)` :
    `${x.label} · ${x.source === 'SLIDESHOW_MOBILE' ? 'Slideshow móvil' : 'Slideshow / Hero'}`
  }));
  return { media, references, totalReferences: references.length };
}

export async function deleteMediaSafe(id, user, { detach = false } = {}) {
  const client = await pool.connect();
  let media = null,detachedReferences = 0;
  try {
    await client.query('BEGIN');
    const m = await client.query(`SELECT * FROM gmx.multimedia WHERE id_media=$1 FOR UPDATE`, [id]);
    if (!m.rowCount) throw new Error('MEDIA_NOT_FOUND');
    media = m.rows[0];

    const refs = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM gmx.cms_banners WHERE id_media_desktop=$1)::int desktop,
        (SELECT COUNT(*) FROM gmx.cms_banners WHERE id_media_mobile=$1)::int mobile,
        (SELECT COUNT(*) FROM gmx.configuracion WHERE parametro IN (
          'appearance.background_media_id','admin.appearance.background_media_id','public.appearance.background_media_id'
        ) AND valor=$1)::int backgrounds
    `, [id]);
    const counts = refs.rows[0] || { desktop: 0, mobile: 0, backgrounds: 0 };
    detachedReferences = Number(counts.desktop || 0) + Number(counts.mobile || 0) + Number(counts.backgrounds || 0);

    if (detachedReferences && !detach) {
      throw new Error(`MEDIA_IN_USE:${detachedReferences}`);
    }

    if (detach) {
      await client.query(`UPDATE gmx.cms_banners SET
        id_media_desktop=CASE WHEN id_media_desktop=$1 THEN NULL ELSE id_media_desktop END,
        id_media_mobile=CASE WHEN id_media_mobile=$1 THEN NULL ELSE id_media_mobile END,
        actualizacion=NOW()
        WHERE id_media_desktop=$1 OR id_media_mobile=$1`, [id]);
      await client.query(`UPDATE gmx.configuracion SET valor=''
        WHERE parametro IN (
          'appearance.background_media_id','admin.appearance.background_media_id','public.appearance.background_media_id'
        ) AND valor=$1`, [id]);
    }

    await client.query(`DELETE FROM gmx.multimedia WHERE id_media=$1`, [id]);
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'MULTIMEDIA','ELIMINAR',$1,$2,$3)`, [
    id,
    `${media.nombre_archivo || media.nombre || 'archivo'} · referencias retiradas: ${detachedReferences}`,
    user?.email || brandText("GMX Local")]
    );
    await client.query('COMMIT');
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {client.release();}

  if (media?.ruta) {
    try {await fs.unlink(media.ruta);} catch (e) {if (e?.code !== 'ENOENT') throw e;}
  }
  return { id_media: id, deleted: true, detachedReferences };
}
