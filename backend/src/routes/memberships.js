import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import crypto from 'crypto';
import { query, pool } from '../db.js';

const router = Router();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.resolve(HERE, '../../uploads/products');
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function friendlyError(error) {
  const constraint = String(error?.constraint || '');
  if (error?.code === '23505' && constraint === 'membresia_tipos_codigo_key') return new Error('Ya existe una membresía con ese código. Se generará un código distinto al volver a intentar.');
  if (error?.code === '23505' && constraint === 'membresia_tipos_sku_key') return new Error('Ya existe una membresía con ese SKU.');
  return error;
}
const bad = (res, error, status = 400) => {
  const e = friendlyError(error);
  res.status(status).json({ success: false, error: e.message, message: e.message });
};

function slug(value, fallback = 'ITEM') {
  const out = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return out || fallback;
}

function generatedSku(input = {}) {
  const game = slug(input.id_juego, 'TCG');
  const name = slug(input.nombre, 'PLAN').slice(0, 18);
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MEM-${game}-${name}-${suffix}`.slice(0, 80);
}

async function saveMedia({ kind = 'membership', dataUrl = '', sourceName = '' }) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i);
  if (!match) throw new Error('IMAGE_INVALID');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('IMAGE_EMPTY');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const mime = match[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const prefix = kind === 'tournament' ? 'gmx-tournament' : 'gmx-membership';
  const base = slug(sourceName || prefix, prefix).toLowerCase();
  const filename = `${prefix}-${base}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, filename), buffer);
  return { path: `/uploads/products/${filename}`, mime, bytes: buffer.length };
}

async function syncMembershipProduct(client, membership) {
  const id = `MEMBERSHIP-${membership.id}`;
  const sku = membership.sku;
  const name = membership.nombre;
  const description = `Membresía GMX · ${membership.id_juego}`;
  const price = Number(membership.precio || 0);
  const image = membership.imagen || null;
  const status = membership.activo === false ? 'INACTIVO' : 'ACTIVO';

  const found = await client.query(`SELECT id,sku FROM gmx.productos WHERE id=$1 OR sku=$2 ORDER BY row_id NULLS LAST LIMIT 1`, [id, sku]);
  if (found.rowCount) {
    await client.query(`UPDATE gmx.productos SET id=$1,sku=$2,nombre=$3,descripcion=$4,precio=$5,costo=0,stock=999999,stock_minimo=0,categoria='MEMBRESIA',imagen=$6,estado=$7,fecha_actualizacion=NOW() WHERE id=$1 OR sku=$2`, [id, sku, name, description, price, image, status]);
  } else {
    await client.query(`INSERT INTO gmx.productos(id,sku,nombre,descripcion,precio,costo,stock,stock_minimo,categoria,imagen,estado,fecha_creacion,fecha_actualizacion) VALUES($1,$2,$3,$4,$5,0,999999,0,'MEMBRESIA',$6,$7,NOW(),NOW())`, [id, sku, name, description, price, image, status]);
  }

  // Compatibilidad con el POS actual: crea un renglón virtual de inventario por sucursal.
  const branches = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales WHERE COALESCE(activa,true)=true`);
  for (const branch of branches.rows) {
    const exists = await client.query(`SELECT 1 FROM gmx.inventario_sucursales WHERE id_sucursal=$1 AND id_producto=$2 LIMIT 1`, [branch.id_sucursal, id]);
    if (exists.rowCount) {
      await client.query(`UPDATE gmx.inventario_sucursales SET sku=$3,producto=$4,stock=999999,stock_minimo=0,fecha_actualizacion=NOW() WHERE id_sucursal=$1 AND id_producto=$2`, [branch.id_sucursal, id, sku, name]);
    } else {
      await client.query(`INSERT INTO gmx.inventario_sucursales(id_registro,id_sucursal,sucursal,id_producto,sku,producto,stock,stock_minimo,fecha_actualizacion) VALUES($1,$2,$3,$4,$5,$6,999999,0,NOW())`, [`MEMINV-${membership.id}-${branch.id_sucursal}`, branch.id_sucursal, branch.nombre_sucursal || branch.id_sucursal, id, sku, name]);
    }
  }
}

router.post('/media', async (req, res) => {
  try {
    const result = await saveMedia({ kind: req.body?.kind, dataUrl: req.body?.dataUrl, sourceName: req.body?.sourceName });
    res.json({ success: true, data: result });
  } catch (e) { bad(res, e); }
});

router.get('/types', async (_req, res) => {
  try {
    const r = await query(`SELECT m.*,j.nombre tcg_nombre,j.imagen tcg_imagen FROM gmx.membresia_tipos m LEFT JOIN gmx.tcg_juegos j ON j.id_juego=m.id_juego ORDER BY m.activo DESC,j.nombre,m.nombre`);
    res.json({ success: true, data: r.rows });
  } catch (e) { bad(res, e, 500); }
});


// R5F: opciones propias del modulo COMERCIAL.
// No dependen de permisos CLIENTES/TCG de otros routers, por lo que
// Membresias puede mostrar SIEMPRE los clientes y TCG activos de GMX.
router.get('/client-options', async (_req, res) => {
  try {
    const r = await query(`
      SELECT
        c.row_id,
        c.id_cliente,
        c.nombre,
        c.telefono,
        c.email
      FROM gmx.clientes c
      WHERE NULLIF(BTRIM(COALESCE(c.id_cliente,'')),'') IS NOT NULL
      ORDER BY COALESCE(NULLIF(BTRIM(c.nombre),''),c.id_cliente),c.row_id
    `);
    res.json({ success: true, data: r.rows, count: r.rowCount });
  } catch (e) { bad(res, e, 500); }
});

router.get('/tcg-options', async (_req, res) => {
  try {
    const r = await query(`
      SELECT
        j.row_id,
        j.id_juego,
        j.nombre,
        j.codigo,
        j.imagen,
        COALESCE(j.activo,true) AS activo,
        COALESCE(j.orden,0) AS orden
      FROM gmx.tcg_juegos j
      WHERE COALESCE(j.activo,true)=true
      ORDER BY COALESCE(j.orden,0),j.nombre,j.row_id
    `);
    res.json({ success: true, data: r.rows, count: r.rowCount });
  } catch (e) { bad(res, e, 500); }
});

router.get('/clients', async (req, res) => {
  try {
    const search = String(req.query?.search || '').trim();
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE (c.id_cliente::text ILIKE $1 OR COALESCE(c.nombre,'') ILIKE $1 OR COALESCE(c.email,'') ILIKE $1 OR COALESCE(c.telefono,'') ILIKE $1 OR COALESCE(mt.nombre,'') ILIKE $1 OR COALESCE(j.nombre,'') ILIKE $1)`;
    }
    const r = await query(`SELECT cm.id,cm.id_cliente,cm.inicio,cm.fin,cm.estado,cm.codigo_membresia,cm.qr_codigo,cm.id_pedido,cm.codigo_membresia,cm.qr_codigo,mt.id id_tipo,mt.nombre membresia_nombre,mt.id_juego,mt.sku,mt.precio,mt.imagen,c.nombre cliente_nombre,c.email cliente_email,c.telefono cliente_telefono,j.nombre tcg_nombre,j.imagen tcg_imagen FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo JOIN gmx.clientes c ON c.id_cliente=cm.id_cliente LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego ${where} ORDER BY CASE UPPER(COALESCE(cm.estado,cm.codigo_membresia,cm.qr_codigo,'')) WHEN 'ACTIVA' THEN 0 WHEN 'PROGRAMADA' THEN 1 ELSE 2 END,cm.fin DESC,c.nombre LIMIT 500`, params);
    res.json({ success: true, data: r.rows });
  } catch (e) { bad(res, e, 500); }
});


router.get('/eligibility/:clientId/:typeId', async (req, res) => {
  try {
    const typeResult = await query(`
      SELECT id,id_juego,nombre,sku,activo
      FROM gmx.membresia_tipos
      WHERE id=$1
      LIMIT 1
    `,[req.params.typeId]);
    const type = typeResult.rows[0];
    if (!type) return res.status(404).json({success:false,error:'MEMBERSHIP_TYPE_NOT_FOUND'});
    const duplicate = await query(`
      SELECT cm.id,cm.estado,cm.codigo_membresia,cm.qr_codigo,cm.inicio,cm.fin,mt.nombre,mt.sku,mt.id_juego
      FROM gmx.cliente_membresias cm
      JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo
      WHERE cm.id_cliente=$1
        AND mt.id_juego=$2
        AND UPPER(COALESCE(cm.estado,cm.codigo_membresia,cm.qr_codigo,'')) IN ('ACTIVA','PROGRAMADA')
        AND cm.fin>NOW()
      ORDER BY cm.fin DESC
      LIMIT 1
    `,[req.params.clientId,type.id_juego]);
    res.json({
      success:true,
      data:{
        eligible:duplicate.rowCount===0,
        existing:duplicate.rows[0]||null,
        type
      }
    });
  } catch(e){ bad(res,e,500); }
});

router.get('/clients/:clientId', async (req, res) => {
  try {
    const r = await query(`SELECT cm.id,cm.inicio,cm.fin,cm.estado,cm.codigo_membresia,cm.qr_codigo,cm.codigo_membresia,cm.qr_codigo,mt.nombre,mt.id_juego,mt.descuento_pct,mt.entradas_incluidas,mt.limite_semanal,mt.imagen,j.nombre tcg_nombre,j.imagen tcg_imagen FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego WHERE cm.id_cliente=$1 ORDER BY cm.fin DESC`, [req.params.clientId]);
    res.json({ success: true, data: r.rows });
  } catch (e) { bad(res, e, 500); }
});


// GMX_MEMBERSHIP_CLIENT_DETAIL_R6A
// Detalle por cliente: cada membresia conserva su propio contador e historial de entradas.
router.get('/clients/:clientId/detail', async (req, res) => {
  try {
    const memberships = await query(`
      SELECT
        cm.id,
        cm.id_cliente,
        cm.inicio,
        cm.fin,
        cm.estado,cm.codigo_membresia,cm.qr_codigo,
        cm.id_pedido,
        mt.id AS id_tipo,
        mt.nombre,
        mt.id_juego,
        mt.sku,
        mt.precio,
        mt.vigencia_dias,
        mt.descuento_pct,
        mt.entradas_incluidas,
        mt.limite_semanal,
        mt.imagen,
        j.nombre AS tcg_nombre,
        j.imagen AS tcg_imagen,
        COALESCE((
          SELECT SUM(CASE WHEN mv.tipo='USO_TORNEO' THEN GREATEST(COALESCE(mv.cantidad,0),0) ELSE 0 END)
          FROM gmx.membresia_movimientos mv
          WHERE mv.id_membresia=cm.id
        ),0)::int AS entradas_usadas
      FROM gmx.cliente_membresias cm
      JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo
      LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego
      WHERE cm.id_cliente=$1
      ORDER BY
        CASE UPPER(COALESCE(cm.estado,cm.codigo_membresia,cm.qr_codigo,'')) WHEN 'ACTIVA' THEN 0 WHEN 'PROGRAMADA' THEN 1 ELSE 2 END,
        cm.fin DESC,
        cm.id DESC
    `,[req.params.clientId]);

    if (!memberships.rowCount) return res.json({ success:true, data:[] });
    const ids = memberships.rows.map(x=>x.id);
    const movements = await query(`
      SELECT id,id_membresia,fecha,tipo,cantidad,id_torneo,referencia,detalle,usuario
      FROM gmx.membresia_movimientos
      WHERE id_membresia = ANY($1::bigint[])
        AND tipo='USO_TORNEO'
        AND COALESCE(cantidad,0)>0
      ORDER BY fecha DESC,id DESC
    `,[ids]);
    const byMembership = new Map();
    for (const mv of movements.rows) {
      const k=String(mv.id_membresia);
      if(!byMembership.has(k)) byMembership.set(k,[]);
      byMembership.get(k).push(mv);
    }
    const data=memberships.rows.map(m=>({
      ...m,
      entradas_restantes:Math.max(0,Number(m.entradas_incluidas||0)-Number(m.entradas_usadas||0)),
      movimientos:byMembership.get(String(m.id))||[]
    }));
    res.json({ success:true, data });
  } catch (e) { bad(res,e,500); }
});
router.post('/types', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const x = req.body || {};
    if (!String(x.nombre || '').trim() || !String(x.id_juego || '').trim()) throw new Error('Captura nombre del plan y TCG.');
    const sku = String(x.sku || generatedSku(x)).toUpperCase().replace(/[^A-Z0-9-]/g, '-');
    const code = String(x.codigo || sku).toUpperCase().replace(/[^A-Z0-9-]/g, '-');
    const r = await client.query(`INSERT INTO gmx.membresia_tipos(codigo,nombre,id_juego,precio,vigencia_dias,descuento_pct,entradas_incluidas,limite_semanal,activo,sku,notas_publicas,imagen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [code, String(x.nombre).trim(), x.id_juego, Number(x.precio || 0), Number(x.vigencia_dias || 30), Number(x.descuento_pct || 0), Number(x.entradas_incluidas ?? 4), Number(x.limite_semanal ?? 1), x.activo !== false, sku, x.notas_publicas || null, x.imagen || null]);
    await syncMembershipProduct(client, r.rows[0]);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    bad(res, e);
  } finally { client.release(); }
});

router.put('/types/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const x = req.body || {};
    const r = await client.query(`UPDATE gmx.membresia_tipos SET nombre=$2,id_juego=$3,precio=$4,vigencia_dias=$5,descuento_pct=$6,entradas_incluidas=$7,limite_semanal=$8,activo=$9,notas_publicas=$10,imagen=$11,actualizado_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, x.nombre, x.id_juego, Number(x.precio || 0), Number(x.vigencia_dias || 30), Number(x.descuento_pct || 0), Number(x.entradas_incluidas ?? 4), Number(x.limite_semanal ?? 1), x.activo !== false, x.notas_publicas || null, x.imagen || null]);
    if (!r.rowCount) throw new Error('MEMBERSHIP_NOT_FOUND');
    await syncMembershipProduct(client, r.rows[0]);
    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    bad(res, e);
  } finally { client.release(); }
});

router.get('/tournaments', async (_req, res) => {
  try {
    const r = await query(`SELECT t.*,j.nombre tcg_nombre,j.imagen tcg_imagen,s.nombre_sucursal FROM gmx.torneos t LEFT JOIN gmx.tcg_juegos j ON j.id_juego=t.id_juego LEFT JOIN gmx.sucursales s ON s.id_sucursal=t.id_sucursal ORDER BY t.fecha_inicio DESC`);
    res.json({ success: true, data: r.rows });
  } catch (e) { bad(res, e, 500); }
});

function tournamentAccepts(x = {}) {
  const cat = String(x.categoria || 'LOCAL').toUpperCase();
  const major = ['OFICIAL','CLASIFICATORIO','REGIONAL','PREMIER','ESPECIAL'].includes(cat);
  const accepts = major ? Boolean(x.acepta_membresia && x.confirmar_excepcion) : Boolean(x.acepta_membresia);
  return { cat, accepts };
}

router.post('/tournaments', async (req, res) => {
  try {
    const x = req.body || {};
    if (!x.nombre || !x.id_juego || !x.fecha_inicio) throw new Error('TORNEO_DATOS_REQUIRED');
    const { cat, accepts } = tournamentAccepts(x);
    const r = await query(`INSERT INTO gmx.torneos(nombre,id_juego,categoria,fecha_inicio,id_sucursal,costo,cupo,acepta_membresia,estado,descripcion,imagen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [x.nombre, x.id_juego, cat, x.fecha_inicio, x.id_sucursal || null, Number(x.costo || 0), x.cupo ? Number(x.cupo) : null, accepts, x.estado || 'PROGRAMADO', x.descripcion || null, x.imagen || null]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { bad(res, e); }
});

router.put('/tournaments/:id', async (req, res) => {
  try {
    const x = req.body || {};
    if (!x.nombre || !x.id_juego || !x.fecha_inicio) throw new Error('TORNEO_DATOS_REQUIRED');
    const { cat, accepts } = tournamentAccepts(x);
    const r = await query(`UPDATE gmx.torneos SET nombre=$2,id_juego=$3,categoria=$4,fecha_inicio=$5,id_sucursal=$6,costo=$7,cupo=$8,acepta_membresia=$9,estado=$10,descripcion=$11,imagen=$12,actualizado_at=NOW() WHERE id=$1 RETURNING *`, [req.params.id, x.nombre, x.id_juego, cat, x.fecha_inicio, x.id_sucursal || null, Number(x.costo || 0), x.cupo ? Number(x.cupo) : null, accepts, x.estado || 'PROGRAMADO', x.descripcion || null, x.imagen || null]);
    if (!r.rowCount) throw new Error('TOURNAMENT_NOT_FOUND');
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { bad(res, e); }
});


// GMX_TOURNAMENT_REGISTRATIONS_R7C
router.get('/tournaments/:id/registrations', async (req,res) => {
  try {
    const q=await query(`
      SELECT
        ti.id,
        ti.id_torneo,
        ti.id_cliente,
        ti.id_membresia,
        ti.tipo_pago,
        ti.estado,
        c.nombre,
        c.telefono,
        c.email,
        mt.nombre AS membresia_nombre,
        mt.sku AS membresia_sku
      FROM gmx.torneo_inscripciones ti
      JOIN gmx.clientes c ON c.id_cliente=ti.id_cliente
      LEFT JOIN gmx.cliente_membresias cm ON cm.id=ti.id_membresia
      LEFT JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo
      WHERE ti.id_torneo=$1
      ORDER BY ti.id DESC
    `,[req.params.id]);
    res.json({success:true,data:q.rows});
  } catch(e) { bad(res,e,500); }
});
// GMX_TOURNAMENT_DUPLICATE_GUARD_R7E2
router.post('/tournaments/:id/register-client', async (req,res,next) => {
  try {
    const tournamentId=String(req.params.id||'').trim();
    const clientId=String(
      req.body?.id_cliente ??
      req.body?.client_id ??
      req.body?.clientId ??
      ''
    ).trim();

    if(!tournamentId || !clientId) return next();

    const existing=await query(`
      SELECT ti.id
      FROM gmx.torneo_inscripciones ti
      WHERE ti.id_torneo=$1
        AND ti.id_cliente=$2
        AND UPPER(COALESCE(ti.estado,'ACTIVA')) NOT IN ('CANCELADA','CANCELADO')
      LIMIT 1
    `,[tournamentId,clientId]);

    if(!existing.rowCount) return next();

    const tq=await query(`
      SELECT nombre
      FROM gmx.torneos
      WHERE id=$1
      LIMIT 1
    `,[tournamentId]);

    const tournamentName=String(tq.rows[0]?.nombre||tournamentId)
      .replace(/\|/g,' ')
      .trim();

    return res.status(409).json({
      success:false,
      code:'TOURNAMENT_ALREADY_REGISTERED',
      error:`TOURNAMENT_ALREADY_REGISTERED|${tournamentName}`,
      message:`TOURNAMENT_ALREADY_REGISTERED|${tournamentName}`
    });
  } catch(e) {
    next(e);
  }
});
router.post('/tournaments/:id/register-client', async (req, res) => {
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const clientId = String(req.body?.clientId || '').trim();
    if (!clientId) throw new Error('CLIENT_REQUIRED');
    const c = (await cx.query(`SELECT id_cliente,nombre FROM gmx.clientes WHERE id_cliente=$1 ORDER BY row_id LIMIT 1`, [clientId])).rows[0];
    if (!c) throw new Error('CLIENT_NOT_FOUND');
    const tournament = (await cx.query(`SELECT * FROM gmx.torneos WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    let membershipId = null;
    let type = 'NORMAL';
    if (req.body?.useMembership) {
      if (!tournament.acepta_membresia) throw new Error('MEMBRESIA_NO_APLICA_EN_ESTE_TORNEO');
      const membership = (await cx.query(`SELECT cm.id,cm.inicio,cm.fin,mt.entradas_incluidas,mt.limite_semanal FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo WHERE cm.id_cliente=$1 AND mt.id_juego=$2 AND cm.estado='ACTIVA' AND cm.inicio<=NOW() AND cm.fin>NOW() ORDER BY cm.fin LIMIT 1 FOR UPDATE OF cm`, [clientId, tournament.id_juego])).rows[0];
      if (!membership) throw new Error('CLIENTE_SIN_MEMBRESIA_ACTIVA_DEL_TCG');
      const used = Number((await cx.query(`SELECT COALESCE(SUM(CASE WHEN tipo='USO_TORNEO' THEN cantidad ELSE 0 END),0)::int n FROM gmx.membresia_movimientos WHERE id_membresia=$1`, [membership.id])).rows[0].n);
      if (used >= Number(membership.entradas_incluidas || 4)) throw new Error('MEMBRESIA_SIN_ENTRADAS_DISPONIBLES');
      const week = Number((await cx.query(`SELECT COALESCE(SUM(CASE WHEN tipo='USO_TORNEO' THEN cantidad ELSE 0 END),0)::int n FROM gmx.membresia_movimientos WHERE id_membresia=$1 AND fecha>=date_trunc('week',NOW()) AND fecha<date_trunc('week',NOW())+interval '7 days'`, [membership.id])).rows[0].n);
      if (week >= Number(membership.limite_semanal || 1)) throw new Error('LIMITE_SEMANAL_MEMBRESIA_ALCANZADO');
      membershipId = membership.id;
      type = 'MEMBRESIA';
    }
    const existing = await cx.query(`SELECT id FROM gmx.torneo_inscripciones WHERE id_torneo=$1 AND id_cliente=$2 AND estado='CONFIRMADA' LIMIT 1`, [tournament.id, clientId]);
    if (existing.rowCount) throw new Error('CLIENTE_YA_INSCRITO_EN_TORNEO');
    await cx.query(`INSERT INTO gmx.torneo_inscripciones(id_torneo,id_cliente,id_membresia,tipo_pago,estado) VALUES($1,$2,$3,$4,'CONFIRMADA')`, [tournament.id, clientId, membershipId, type]);
    if (membershipId) await cx.query(`INSERT INTO gmx.membresia_movimientos(id_membresia,tipo,cantidad,id_torneo,referencia,detalle,usuario) VALUES($1,'USO_TORNEO',1,$2,$3,$4,$5)`, [membershipId, tournament.id, `TORNEO-${tournament.id}`, tournament.nombre, 'ADMIN']);
    await cx.query('COMMIT');
    res.json({ success: true, message: type === 'MEMBRESIA' ? 'Cliente inscrito usando beneficio de membresía.' : 'Cliente inscrito al torneo.', data: { clientId, tournamentId: tournament.id, membershipId, type } });
  } catch (e) {
    await cx.query('ROLLBACK').catch(() => {});
    bad(res, e);
  } finally { cx.release(); }
});

router.post('/validate', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const h = crypto.createHash('sha256').update(code).digest('hex');
    const r = await query(`SELECT cm.*,mt.nombre,mt.id_juego,mt.descuento_pct,mt.entradas_incluidas,mt.limite_semanal,mt.imagen,c.nombre cliente,j.nombre tcg_nombre,j.imagen tcg_imagen FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo JOIN gmx.clientes c ON c.id_cliente=cm.id_cliente LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego WHERE cm.qr_token_hash=$1 LIMIT 1`, [h]);
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'MEMBRESIA_NO_ENCONTRADA' });
    const membership = r.rows[0];
    if (new Date(membership.fin) <= new Date() || membership.estado === 'CADUCADA') return res.status(409).json({ success: false, error: 'MEMBRESIA_CADUCADA', data: membership });
    res.json({ success: true, data: { ...membership, estado_efectivo: new Date(membership.inicio) > new Date() ? 'PROGRAMADA' : 'ACTIVA' } });
  } catch (e) { bad(res, e, 500); }
});


// GMX_MEMBERSHIP_CREDENTIAL_R1
router.get('/credential/:id', async (req,res)=>{
  try{
    const r=await query(`
      SELECT
        cm.id,cm.id_cliente,cm.id_tipo,cm.inicio,cm.fin,cm.estado,cm.codigo_membresia,cm.qr_codigo,cm.id_pedido,
        cm.codigo_membresia,cm.qr_codigo,cm.creado_at,
        mt.nombre AS membresia_nombre,mt.id_juego,mt.sku,mt.precio,
        mt.descuento_pct,mt.entradas_incluidas,mt.limite_semanal,mt.imagen,
        c.nombre AS cliente_nombre,c.email AS cliente_email,c.telefono AS cliente_telefono,
        j.nombre AS tcg_nombre,j.imagen AS tcg_imagen
      FROM gmx.cliente_membresias cm
      JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo
      JOIN gmx.clientes c ON c.id_cliente=cm.id_cliente
      LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego
      WHERE cm.id=$1
      LIMIT 1
    `,[req.params.id]);
    if(!r.rowCount)return res.status(404).json({success:false,error:'MEMBRESIA_NO_ENCONTRADA'});
    const m=r.rows[0];
    res.json({success:true,data:{...m,estado_efectivo:new Date(m.fin)<=new Date()?'CADUCADA':(new Date(m.inicio)>new Date()?'PROGRAMADA':String(m.estado||'ACTIVA').toUpperCase())}});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});

router.post('/validate-code', async (req,res)=>{
  try{
    const code=String(req.body?.code||'').trim();
    if(!code)return res.status(400).json({success:false,error:'CODIGO_REQUERIDO'});
    const crypto=await import('node:crypto');
    const h=crypto.createHash('sha256').update(code).digest('hex');
    const r=await query(`
      SELECT cm.*,mt.nombre,mt.id_juego,mt.descuento_pct,mt.entradas_incluidas,mt.limite_semanal,mt.imagen,
             c.nombre cliente,j.nombre tcg_nombre,j.imagen tcg_imagen
      FROM gmx.cliente_membresias cm
      JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo
      JOIN gmx.clientes c ON c.id_cliente=cm.id_cliente
      LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego
      WHERE cm.qr_token_hash=$1 OR UPPER(cm.codigo_membresia)=UPPER($2)
      LIMIT 1
    `,[h,code]);
    if(!r.rowCount)return res.status(404).json({success:false,error:'MEMBRESIA_NO_ENCONTRADA'});
    const membership=r.rows[0];
    if(new Date(membership.fin)<=new Date()||String(membership.estado||'').toUpperCase()==='CADUCADA')
      return res.status(409).json({success:false,error:'MEMBRESIA_CADUCADA',data:membership});
    res.json({success:true,data:{...membership,estado_efectivo:new Date(membership.inicio)>new Date()?'PROGRAMADA':'ACTIVA'}});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});
export default router;
