import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CMS_FILE = fileURLToPath(import.meta.url);
const CMS_REPOSITORIES_DIR = path.dirname(CMS_FILE);
const CMS_SRC_DIR = path.dirname(CMS_REPOSITORIES_DIR);
const CMS_BACKEND_DIR = path.dirname(CMS_SRC_DIR);
const CMS_PROJECT_DIR = path.dirname(CMS_BACKEND_DIR);

function mediaCandidatePaths(media) {
  const candidates = [];
  if (media?.ruta) candidates.push(path.resolve(media.ruta));
  const names = [media?.file_id, media?.nombre_archivo].filter(Boolean);
  for (const name of names) {
    candidates.push(path.join(CMS_BACKEND_DIR, 'storage', 'media', name));
    candidates.push(path.join(CMS_PROJECT_DIR, 'storage', 'media', name));
    candidates.push(path.join(process.cwd(), 'storage', 'media', name));
    candidates.push(path.join(process.cwd(), 'backend', 'storage', 'media', name));
  }
  return [...new Set(candidates)];
}

export function resolveCmsMediaPath(media) {
  for (const candidate of mediaCandidatePaths(media)) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const txt = (v) => String(v ?? '').trim();
const bool = (v) => v === true || String(v).toLowerCase() === 'true';
const int = (v, d = 0) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d;

function normalizeBanner(x = {}) {
  return {
    nombre: txt(x.nombre) || txt(x.titulo) || `Slide ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    zona: txt(x.zona || 'HOME_HERO'),
    tipo: txt(x.tipo || 'CAMPAIGN').toUpperCase(),
    titulo: txt(x.titulo) || null,
    subtitulo: txt(x.subtitulo) || null,
    texto_cta: txt(x.texto_cta) || null,
    ruta_cta: txt(x.ruta_cta) || null,
    id_media_desktop: txt(x.id_media_desktop) || null,
    id_media_mobile: txt(x.id_media_mobile) || null,
    fecha_inicio: txt(x.fecha_inicio) || null,
    fecha_fin: txt(x.fecha_fin) || null,
    prioridad: int(x.prioridad, 100),
    exclusivo: bool(x.exclusivo),
    activo: x.activo !== false,
    publicado: bool(x.publicado),
    overlay_opacity: Math.max(0, Math.min(1, Number(x.overlay_opacity ?? 0.2))),
    text_align: txt(x.text_align || 'LEFT').toUpperCase(),
    notas: txt(x.notas) || null,
    media_source: txt(x.media_source || 'LIBRARY').toUpperCase(),
    url_desktop: txt(x.url_desktop) || null,
    url_mobile: txt(x.url_mobile) || null,
    object_fit: txt(x.object_fit || 'cover'),
    object_position: txt(x.object_position || 'center center'),
    altura_desktop: x.altura_desktop === '' || x.altura_desktop == null ? null : int(x.altura_desktop),
    altura_tablet: x.altura_tablet === '' || x.altura_tablet == null ? null : int(x.altura_tablet),
    altura_mobile: x.altura_mobile === '' || x.altura_mobile == null ? null : int(x.altura_mobile),
    mostrar_flechas: x.mostrar_flechas !== false,
    mostrar_indicadores: x.mostrar_indicadores !== false,
    autoplay: x.autoplay !== false,
    intervalo_segundos: Math.max(2, Math.min(60, int(x.intervalo_segundos, 6))),
    pausa_hover: x.pausa_hover !== false,
    transicion: txt(x.transicion || 'FADE').toUpperCase(),
    permanente: x.permanente === true || String(x.permanente).toLowerCase() === 'true',
    fallback_principal: x.fallback_principal === true || String(x.fallback_principal).toLowerCase() === 'true'
  };
}

export async function listBanners({ zone = '' } = {}) {
  const vals = [],f = [];
  if (zone) {vals.push(zone);f.push(`b.zona=$${vals.length}`);}
  return query(`SELECT b.*,
    md.url AS desktop_library_url,mm.url AS mobile_library_url
    FROM gmx.cms_banners b
    LEFT JOIN gmx.multimedia md ON md.id_media=b.id_media_desktop
    LEFT JOIN gmx.multimedia mm ON mm.id_media=b.id_media_mobile
    ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
    ORDER BY b.zona,b.prioridad,b.fecha_inicio NULLS FIRST,b.row_id DESC`, vals);
}

export async function saveBanner(rowId, input, user) {
  const x = normalizeBanner(input);

  if (!['LIBRARY', 'URL'].includes(x.media_source)) throw new Error('INVALID_MEDIA_SOURCE');
  if (x.media_source === 'URL' && !x.url_desktop) throw new Error('BANNER_DESKTOP_URL_REQUIRED');
  if (x.fallback_principal) {
    x.tipo = 'MAIN';
    x.permanente = true;
  }
  if (x.permanente) {x.fecha_inicio = null;x.fecha_fin = null;}
  if (x.fecha_inicio && x.fecha_fin && new Date(x.fecha_fin) <= new Date(x.fecha_inicio)) throw new Error('BANNER_END_MUST_BE_AFTER_START');

  const vals = [
  x.nombre, x.zona, x.tipo, x.titulo, x.subtitulo, x.texto_cta, x.ruta_cta, x.id_media_desktop, x.id_media_mobile,
  x.fecha_inicio, x.fecha_fin, x.prioridad, x.exclusivo, x.activo, x.publicado, x.overlay_opacity, x.text_align, x.notas,
  x.media_source, x.url_desktop, x.url_mobile, x.object_fit, x.object_position, x.altura_desktop, x.altura_tablet, x.altura_mobile,
  x.mostrar_flechas, x.mostrar_indicadores, x.autoplay, x.intervalo_segundos, x.pausa_hover, x.transicion, x.permanente, x.fallback_principal];


  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let r;
    if (x.fallback_principal) {
      await client.query(`UPDATE gmx.cms_banners
        SET fallback_principal=false
        WHERE zona=$1
          AND fallback_principal=true
          AND ($2::bigint IS NULL OR row_id<>$2)`, [x.zona, rowId || null]);
    }
    if (rowId) {
      r = await client.query(`UPDATE gmx.cms_banners SET
        nombre=$2,zona=$3,tipo=$4,titulo=$5,subtitulo=$6,texto_cta=$7,ruta_cta=$8,
        id_media_desktop=$9,id_media_mobile=$10,fecha_inicio=$11,fecha_fin=$12,
        prioridad=$13,exclusivo=$14,activo=$15,publicado=$16,overlay_opacity=$17,text_align=$18,notas=$19,
        media_source=$20,url_desktop=$21,url_mobile=$22,object_fit=$23,object_position=$24,
        altura_desktop=$25,altura_tablet=$26,altura_mobile=$27,mostrar_flechas=$28,mostrar_indicadores=$29,
        autoplay=$30,intervalo_segundos=$31,pausa_hover=$32,transicion=$33,permanente=$34,fallback_principal=$35,fecha_actualizacion=NOW()
        WHERE row_id=$1 RETURNING *`, [rowId, ...vals]);
      if (!r.rowCount) throw new Error('BANNER_NOT_FOUND');
    } else {
      r = await client.query(`INSERT INTO gmx.cms_banners(
        id_banner,nombre,zona,tipo,titulo,subtitulo,texto_cta,ruta_cta,id_media_desktop,id_media_mobile,
        fecha_inicio,fecha_fin,prioridad,exclusivo,activo,publicado,overlay_opacity,text_align,notas,
        media_source,url_desktop,url_mobile,object_fit,object_position,altura_desktop,altura_tablet,altura_mobile,
        mostrar_flechas,mostrar_indicadores,autoplay,intervalo_segundos,pausa_hover,transicion,permanente,fallback_principal)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
        RETURNING *`, [uid('BNR'), ...vals]);
    }
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'CMS',${rowId ? "'EDITAR_BANNER'" : "'CREAR_BANNER'"},$1,$2,$3)`, [
    r.rows[0].id_banner, r.rows[0].nombre, user?.email || brandText("GMX Local")]
    );
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function runtimeContent({ zone = 'HOME_HERO' } = {}) {
  const settings = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'public.appearance.%'
       OR parametro LIKE 'public.carousel.%'
       OR parametro LIKE 'public.promo_bar.%'
       OR parametro LIKE 'public.hero.%'
       OR parametro LIKE 'public.home.%'
       OR parametro LIKE 'store.%'`);

  const campaigns = await query(`SELECT b.*,
      md.url AS desktop_library_url,mm.url AS mobile_library_url
    FROM gmx.cms_banners b
    LEFT JOIN gmx.multimedia md ON md.id_media=b.id_media_desktop
    LEFT JOIN gmx.multimedia mm ON mm.id_media=b.id_media_mobile
    WHERE b.zona=$1 AND b.tipo='CAMPAIGN' AND b.activo=true
      AND b.publicado=true
      AND (b.fecha_inicio IS NULL OR b.fecha_inicio<=NOW())
      AND (b.fecha_fin IS NULL OR b.fecha_fin>=NOW())
    ORDER BY b.exclusivo DESC,b.prioridad,b.row_id DESC`, [zone]);

  let active = campaigns.rows;
  const exclusive = active.find((x) => x.exclusivo);
  if (exclusive) active = [exclusive];

  if (!active.length) {
    const fallback = await query(`SELECT b.*,
        md.url AS desktop_library_url,mm.url AS mobile_library_url
      FROM gmx.cms_banners b
      LEFT JOIN gmx.multimedia md ON md.id_media=b.id_media_desktop
      LEFT JOIN gmx.multimedia mm ON mm.id_media=b.id_media_mobile
      WHERE b.zona=$1 AND b.activo=true AND b.publicado=true
        AND (b.fallback_principal=true OR b.tipo='MAIN')
      ORDER BY b.fallback_principal DESC,b.prioridad,b.row_id DESC LIMIT 1`, [zone]);
    active = fallback.rows;
  }

  const promotions = await query(`SELECT * FROM gmx.promociones
    WHERE UPPER(COALESCE(estado,'ACTIVA'))='ACTIVA'
      AND COALESCE(visible_publico,true)=true
      AND (NULLIF(inicio::text,'') IS NULL OR NULLIF(inicio::text,'')::timestamptz<=NOW())
      AND (NULLIF(fin::text,'') IS NULL OR NULLIF(fin::text,'')::timestamptz>=NOW())
    ORDER BY actualizacion DESC NULLS LAST,row_id DESC`);

  return {
    settings: Object.fromEntries(settings.rows.map((x) => [x.parametro, x.valor])),
    banners: active,
    promotions: promotions.rows
  };
}

export async function createAppearanceRevision(scope, user, comment = '') {
  scope = String(scope || 'public').toLowerCase() === 'admin' ? 'admin' : 'public';
  const prefix = scope === 'admin' ? 'admin.appearance.' : 'public.appearance.';
  const r = await query(`SELECT parametro,valor FROM gmx.configuracion WHERE parametro LIKE $1 ORDER BY parametro`, [`${prefix}%`]);
  const id = uid('THEME');
  const saved = await query(`INSERT INTO gmx.appearance_revisions(
    id_revision,scope,data_json,comentario,id_admin,administrador)
    VALUES($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`, [
  id, scope, JSON.stringify(Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]))),
  comment || null, user?.id_admin || 'LOCAL', user?.nombre || user?.email || brandText("GMX Local")]
  );
  return saved.rows[0];
}

export async function listAppearanceRevisions(scope = 'public') {
  scope = String(scope || 'public').toLowerCase() === 'admin' ? 'admin' : 'public';
  return query(`SELECT * FROM gmx.appearance_revisions WHERE scope=$1 ORDER BY fecha DESC,row_id DESC LIMIT 50`, [scope]);
}

export async function restoreAppearanceRevision(id, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.appearance_revisions WHERE id_revision=$1 FOR UPDATE`, [id]);
    if (!r.rowCount) throw new Error('THEME_REVISION_NOT_FOUND');
    const data = r.rows[0].data_json || {};
    for (const [key, value] of Object.entries(data)) {
      await client.query(`INSERT INTO gmx.configuracion(parametro,valor) VALUES($1,$2)
        ON CONFLICT(parametro) DO UPDATE SET valor=EXCLUDED.valor`, [key, String(value ?? '')]);
    }
    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'APARIENCIA','RESTAURAR',$1,$2,$3)`, [
    id, `Scope ${r.rows[0].scope}`, user?.email || brandText("GMX Local")]
    );
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


async function resolveZone(zone, preview = false) {
  // HOME_HERO_SIMPLE_CAROUSEL_R2
  // Simplified editor rule:
  // every active + published HOME_HERO record belongs to the carousel.
  // Legacy MAIN/CAMPAIGN/date/exclusive fields must not hide older slides.
  if (String(zone || '').toUpperCase() === 'HOME_HERO') {
    const hero = await query(`SELECT b.*,
      md.url AS desktop_library_url,
      mm.url AS mobile_library_url
      FROM gmx.cms_banners b
      LEFT JOIN gmx.multimedia md ON md.id_media=b.id_media_desktop
      LEFT JOIN gmx.multimedia mm ON mm.id_media=b.id_media_mobile
      WHERE b.zona=$1
      AND b.activo=true
      AND b.publicado=true
      ORDER BY b.prioridad,b.row_id DESC`, [zone]);
    return hero.rows;
  }
  const campaigns = await query(`SELECT b.*,
      md.url AS desktop_library_url,mm.url AS mobile_library_url
    FROM gmx.cms_banners b
    LEFT JOIN gmx.multimedia md ON md.id_media=b.id_media_desktop
    LEFT JOIN gmx.multimedia mm ON mm.id_media=b.id_media_mobile
    WHERE b.zona=$1 AND b.tipo='CAMPAIGN' AND b.activo=true
      AND b.publicado=true
      AND (b.fecha_inicio IS NULL OR b.fecha_inicio<=NOW())
      AND (b.fecha_fin IS NULL OR b.fecha_fin>=NOW())
    ORDER BY b.exclusivo DESC,b.prioridad,b.row_id DESC`, [zone]);

  let rows = campaigns.rows;
  const exclusive = rows.find((x) => x.exclusivo);
  if (exclusive) rows = [exclusive];

  if (!rows.length) {
    const fallback = await query(`SELECT b.*,
        md.url AS desktop_library_url,mm.url AS mobile_library_url
      FROM gmx.cms_banners b
      LEFT JOIN gmx.multimedia md ON md.id_media=b.id_media_desktop
      LEFT JOIN gmx.multimedia mm ON mm.id_media=b.id_media_mobile
      WHERE b.zona=$1 AND b.activo=true AND b.publicado=true
        AND (b.fallback_principal=true OR b.tipo='MAIN')
      ORDER BY b.fallback_principal DESC,b.prioridad,b.row_id DESC LIMIT 1`, [zone]);
    rows = fallback.rows;
  }
  return rows;
}

export async function storefrontRuntime({ preview = false } = {}) {
  const settings = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'public.%' OR parametro LIKE 'store.%'`);

  const promotions = await query(`SELECT * FROM gmx.promociones
    WHERE UPPER(COALESCE(estado,'ACTIVA'))='ACTIVA'
      AND COALESCE(visible_publico,true)=true
      AND (NULLIF(inicio::text,'') IS NULL OR NULLIF(inicio::text,'')::timestamptz<=NOW())
      AND (NULLIF(fin::text,'') IS NULL OR NULLIF(fin::text,'')::timestamptz>=NOW())
    ORDER BY actualizacion DESC NULLS LAST,row_id DESC`);

  const zoneNames = [
  'HOME_HERO',
  'HOME_FEATURED_BANNER',
  'HOME_MID_BANNER',
  'CATALOGO_TOP',
  'TCG_TOP',
  'CHECKOUT'];

  const pairs = await Promise.all(zoneNames.map(async (zone) => [zone, await resolveZone(zone, preview)]));

  return {
    settings: Object.fromEntries(settings.rows.map((x) => [x.parametro, x.valor])),
    promotions: promotions.rows,
    zones: Object.fromEntries(pairs)
  };
}


export async function getCmsMediaMeta(id) {
  const r = await query(`SELECT id_media,nombre,nombre_archivo,mime_type,ruta,file_id,tamano_bytes,activo
    FROM gmx.multimedia WHERE id_media=$1 ORDER BY row_id LIMIT 1`, [id]);
  return r.rows[0] || null;
}


export async function deleteBannerSafe(rowId, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(`SELECT * FROM gmx.cms_banners WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!r.rowCount) throw new Error('BANNER_NOT_FOUND');
    const banner = r.rows[0];

    const isPrincipal = banner.fallback_principal === true || String(banner.tipo || '').toUpperCase() === 'MAIN';

    if (isPrincipal) {
      const other = await client.query(`
        SELECT row_id,id_banner,nombre
        FROM gmx.cms_banners
        WHERE zona=$1
          AND row_id<>$2
          AND activo=true
          AND (fallback_principal=true OR UPPER(COALESCE(tipo,''))='MAIN')
        ORDER BY fallback_principal DESC, prioridad, row_id
        LIMIT 1
        FOR UPDATE
      `, [banner.zona, rowId]);

      if (!other.rowCount) {
        throw new Error('CANNOT_DELETE_LAST_FALLBACK');
      }

      if (banner.fallback_principal === true) {
        await client.query(`
          UPDATE gmx.cms_banners
          SET fallback_principal=true,
              tipo='MAIN',
              permanente=true,
              fecha_inicio=NULL,
              fecha_fin=NULL,
              fecha_actualizacion=NOW()
          WHERE row_id=$1
        `, [other.rows[0].row_id]);
      }
    }

    await client.query(`DELETE FROM gmx.cms_banners WHERE row_id=$1`, [rowId]);

    await client.query(`
      INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'CMS','ELIMINAR_BANNER',$1,$2,$3)
    `, [
    banner.id_banner,
    `${banner.zona} · ${banner.nombre || banner.titulo || 'slide'}`,
    user?.email || user?.nombre || brandText("GMX Local")]
    );

    await client.query('COMMIT');
    return {
      row_id: rowId,
      id_banner: banner.id_banner,
      zona: banner.zona,
      deleted: true
    };
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {
    client.release();
  }
}
