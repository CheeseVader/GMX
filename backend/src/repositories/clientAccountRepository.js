import fs from 'node:fs';
import { brandText } from "../config/brand.js";import crypto from 'node:crypto';
import { pool, query } from '../db.js';
import { hashPassword, verifyPassword, newToken, hashToken } from '../security.js';
import { queueAndSendEmail, verificationEmailHtml, passwordResetEmailHtml, passwordChangedEmailHtml } from '../emailService.js';
import { identityOwners, resolveExistingClient } from './clientIdentityRepository.js';

const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const txt = (v) => String(v ?? '').trim();

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 8) throw new Error('PASSWORD_MIN_8');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new Error('PASSWORD_LETTER_AND_NUMBER_REQUIRED');
  return p;
}

export async function registerClient({ name, email, phone, password, address = '', country = 'México', state = '', city = '', zip = '', settlement = '', ip, userAgent, baseUrl = '' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    email = txt(email).toLowerCase();name = txt(name);phone = txt(phone);
    if (!name || !email) throw new Error('NAME_EMAIL_REQUIRED');
    validatePassword(password);

    const owners = await identityOwners({ email, phone });
    const existingIdentity = resolveExistingClient(owners);
    if (existingIdentity) {
      if (owners.emailOwner) throw new Error('CLIENT_EMAIL_ALREADY_REGISTERED');
      if (owners.phoneOwner) throw new Error('CLIENT_PHONE_ALREADY_REGISTERED');
      throw new Error('CLIENT_IDENTITY_EXISTS');
    }

    const exists = await client.query(`SELECT id_cuenta FROM gmx.cliente_cuentas WHERE LOWER(email)=$1 LIMIT 1`, [email]);
    if (exists.rowCount) throw new Error('CLIENT_ACCOUNT_EXISTS');

    let customer = await client.query(`SELECT * FROM gmx.clientes WHERE LOWER(COALESCE(email,''))=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [email]);
    let idCliente;
    const fullAddress = [txt(address), txt(settlement)].filter(Boolean).join(', ');
    if (customer.rowCount) {
      idCliente = customer.rows[0].id_cliente;
      await client.query(`UPDATE gmx.clientes SET
        nombre=$2,telefono=COALESCE(NULLIF($3,''),telefono),direccion=COALESCE(NULLIF($4,''),direccion),
        ciudad=COALESCE(NULLIF($5,''),ciudad),estado=COALESCE(NULLIF($6,''),estado),cp=COALESCE(NULLIF($7,''),cp),
        pais=COALESCE(NULLIF($8,''),pais),fecha_actualizacion=NOW()
        WHERE id_cliente=$1`, [idCliente, name, phone, fullAddress, txt(city), txt(state), txt(zip), txt(country) || 'México']);
    } else {
      idCliente = uid('CLI-WEB');
      await client.query(`INSERT INTO gmx.clientes(id_cliente,nombre,telefono,email,direccion,ciudad,estado,cp,pais,fecha_registro,fecha_actualizacion)
        VALUES($1,$2,NULLIF($3,''),$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,NOW(),NOW())`,
      [idCliente, name, phone, email, fullAddress, txt(city), txt(state), txt(zip), txt(country) || 'México']);
    }

    const idCuenta = uid('CTA');
    await client.query(`INSERT INTO gmx.cliente_cuentas(id_cuenta,id_cliente,email,password_hash,email_verificado)
      VALUES($1,$2,$3,$4,false)`, [idCuenta, idCliente, email, hashPassword(password)]);

    const verifyToken = newToken();
    const cfg = await client.query(`SELECT valor FROM gmx.configuracion WHERE parametro='public.store.email_verification_hours'`);
    const hours = Math.min(Math.max(Number(cfg.rows[0]?.valor || 24), 1), 168);
    await client.query(`INSERT INTO gmx.cliente_email_tokens(token_hash,id_cuenta,id_cliente,email,expires_at)
      VALUES($1,$2,$3,$4,NOW()+($5||' hours')::interval)`, [hashToken(verifyToken), idCuenta, idCliente, email, String(hours)]);

    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'CLIENT_AUTH','REGISTER_PENDING_VERIFY',$1,$2,$3)`, [idCliente, email, email]);
    await client.query('COMMIT');

    const publicBase = String(baseUrl || process.env.SHINY_PUBLIC_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
    const verificationUrl = `${publicBase}/tienda/verificar-email?token=${encodeURIComponent(verifyToken)}`;
    const mail = await queueAndSendEmail({
      to: email,
      subject: brandText("GMX · Confirma tu cuenta"),
      html: verificationEmailHtml({ name, verificationUrl }),
      reference: idCliente
    });

    return {
      verification_required: true,
      email,
      mail,
      development_verification_url: String(process.env.NODE_ENV || 'development') === 'development' ? verificationUrl : undefined
    };
  } catch (e) {try {await client.query('ROLLBACK');} catch {} if(e?.code==='23505') throw new Error('CLIENT_ACCOUNT_EXISTS'); throw e;} finally {client.release();}
}

export async function verifyClientEmail({ token, ip, userAgent }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.cliente_email_tokens
      WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW()
      ORDER BY row_id DESC LIMIT 1 FOR UPDATE`, [hashToken(token)]);
    if (!r.rowCount) throw new Error('INVALID_OR_EXPIRED_VERIFICATION');
    const v = r.rows[0];

    await client.query(`UPDATE gmx.cliente_email_tokens SET used_at=NOW() WHERE row_id=$1`, [v.row_id]);
    await client.query(`UPDATE gmx.cliente_cuentas SET email_verificado=true,fecha_actualizacion=NOW() WHERE id_cuenta=$1`, [v.id_cuenta]);
    await client.query(`UPDATE gmx.clientes SET email_verificado=true,fecha_actualizacion=NOW() WHERE id_cliente=$1`, [v.id_cliente]);

    const profile = await client.query(`SELECT nombre,telefono,email,direccion,ciudad,estado,cp,pais FROM gmx.clientes WHERE id_cliente=$1 ORDER BY row_id LIMIT 1`, [v.id_cliente]);
    const p = profile.rows[0] || {};
    const sessionToken = newToken();
    const cfg = await client.query(`SELECT valor FROM gmx.configuracion WHERE parametro='public.store.client_session_hours'`);
    const hours = Math.min(Math.max(Number(cfg.rows[0]?.valor || 168), 1), 720);
    await client.query(`INSERT INTO gmx.cliente_sessions(token_hash,id_cuenta,id_cliente,email,expires_at,ip_address,user_agent)
      VALUES($1,$2,$3,$4,NOW()+($5||' hours')::interval,$6,$7)`,
    [hashToken(sessionToken), v.id_cuenta, v.id_cliente, v.email, String(hours), txt(ip), txt(userAgent).slice(0, 500)]);

    await client.query('COMMIT');
    return { token: sessionToken, hours, user: { id_cuenta: v.id_cuenta, id_cliente: v.id_cliente, ...p, email: v.email } };
  } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
}


export async function loginClient({ email, password, ip, userAgent }) {
  email = txt(email).toLowerCase();
  const r = await query(`SELECT c.*,cl.nombre,cl.telefono
    FROM gmx.cliente_cuentas c
    JOIN gmx.clientes cl ON cl.id_cliente=c.id_cliente
    WHERE LOWER(c.email)=$1 AND c.activo=true
    ORDER BY c.row_id LIMIT 1`, [email]);
  if (!r.rowCount || !verifyPassword(password, r.rows[0].password_hash)) throw new Error('INVALID_CLIENT_CREDENTIALS');
  if (r.rows[0].email_verificado !== true) throw new Error('EMAIL_NOT_VERIFIED');
  const row = r.rows[0],token = newToken();
  const cfg = await query(`SELECT valor FROM gmx.configuracion WHERE parametro='public.store.client_session_hours'`);
  const hours = Math.min(Math.max(Number(cfg.rows[0]?.valor || 168), 1), 720);
  await query(`INSERT INTO gmx.cliente_sessions(token_hash,id_cuenta,id_cliente,email,expires_at,ip_address,user_agent)
    VALUES($1,$2,$3,$4,NOW()+($5||' hours')::interval,$6,$7)`, [
  hashToken(token), row.id_cuenta, row.id_cliente, row.email, String(hours), txt(ip), txt(userAgent).slice(0, 500)]
  );
  await query(`UPDATE gmx.cliente_cuentas SET ultimo_login=NOW(),fecha_actualizacion=NOW() WHERE id_cuenta=$1`, [row.id_cuenta]);
  const profile = await clientProfile(row.id_cliente);
  return { token, hours, user: { id_cuenta: row.id_cuenta, ...profile, email: row.email } };
}

export async function logoutClient(sessionId) {
  await query(`UPDATE gmx.cliente_sessions SET revoked_at=NOW() WHERE id=$1`, [sessionId]);
}

export async function clientProfile(idCliente) {
  const r = await query(`SELECT id_cliente,nombre,telefono,email,direccion,ciudad,estado,cp,pais
    FROM gmx.clientes WHERE id_cliente=$1 ORDER BY row_id LIMIT 1`, [idCliente]);
  return r.rows[0] || null;
}

export async function clientOrders(idCliente) {
  return query(`SELECT id_pedido,fecha,total,estado_pedido,estado_pago,metodo_pago_publico,numero_comprobante,public_token,sucursal
    FROM gmx.pedidos WHERE id_cliente=$1 ORDER BY fecha DESC,row_id DESC LIMIT 100`, [idCliente]);
}

export async function clientLoyalty(idCliente) {
  const acc = await query(`SELECT * FROM gmx.fidelidad_cuentas WHERE id_cliente=$1 ORDER BY row_id LIMIT 1`, [idCliente]);
  const movements = await query(`SELECT fecha,tipo,puntos,saldo_nuevo,id_pedido,motivo
    FROM gmx.fidelidad_movimientos WHERE id_cliente=$1 ORDER BY fecha DESC,row_id DESC LIMIT 100`, [idCliente]);
  return { account: acc.rows[0] || { id_cliente: idCliente, puntos_disponibles: 0, nivel: 'BASE' }, movements: movements.rows };
}

export async function listAddresses(idCliente) {
  return query(`SELECT * FROM gmx.cliente_direcciones WHERE id_cliente=$1 AND activo=true
    ORDER BY principal DESC,row_id DESC`, [idCliente]);
}

export async function saveAddress(idCliente, input) {
  const id = txt(input.id_direccion) || uid('DIR');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.principal === true) {
      await client.query(`UPDATE gmx.cliente_direcciones SET principal=false WHERE id_cliente=$1`, [idCliente]);
    }
    const r = await client.query(`INSERT INTO gmx.cliente_direcciones(
      id_direccion,id_cliente,alias,nombre_receptor,telefono,direccion,ciudad,estado,cp,pais,principal,activo)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
      ON CONFLICT(id_direccion) DO UPDATE SET
        alias=EXCLUDED.alias,nombre_receptor=EXCLUDED.nombre_receptor,telefono=EXCLUDED.telefono,
        direccion=EXCLUDED.direccion,ciudad=EXCLUDED.ciudad,estado=EXCLUDED.estado,cp=EXCLUDED.cp,
        pais=EXCLUDED.pais,principal=EXCLUDED.principal,activo=true,fecha_actualizacion=NOW()
      WHERE gmx.cliente_direcciones.id_cliente=$2
      RETURNING *`, [
    id, idCliente, txt(input.alias) || null, txt(input.nombre_receptor) || null, txt(input.telefono) || null,
    txt(input.direccion), txt(input.ciudad) || null, txt(input.estado) || null, txt(input.cp) || null,
    txt(input.pais) || 'México', input.principal === true]
    );
    if (!r.rowCount) throw new Error('ADDRESS_NOT_FOUND');
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}


export async function requestPasswordReset({ email, ip, baseUrl = '' }) {
  email = txt(email).toLowerCase();
  if (!email) return { accepted: true };

  const r = await query(`SELECT c.id_cuenta,c.id_cliente,c.email,c.activo,c.email_verificado,cl.nombre
    FROM gmx.cliente_cuentas c
    LEFT JOIN gmx.clientes cl ON cl.id_cliente=c.id_cliente
    WHERE LOWER(c.email)=$1
    ORDER BY c.row_id LIMIT 1`, [email]);

  // Respuesta intencionalmente idéntica exista o no la cuenta.
  if (!r.rowCount || r.rows[0].activo !== true || r.rows[0].email_verificado !== true) {
    return { accepted: true };
  }

  const account = r.rows[0];
  const token = newToken();
  const cfg = await query(`SELECT valor FROM gmx.configuracion WHERE parametro='public.store.password_reset_minutes'`);
  const minutes = Math.min(Math.max(Number(cfg.rows[0]?.valor || 30), 5), 180);

  // Invalida solicitudes previas no utilizadas.
  await query(`UPDATE gmx.cliente_password_reset_tokens
    SET used_at=NOW()
    WHERE id_cuenta=$1 AND used_at IS NULL`, [account.id_cuenta]);

  await query(`INSERT INTO gmx.cliente_password_reset_tokens(
    token_hash,id_cuenta,id_cliente,email,expires_at,requested_ip)
    VALUES($1,$2,$3,$4,NOW()+($5||' minutes')::interval,$6)`, [
  hashToken(token), account.id_cuenta, account.id_cliente, account.email, String(minutes), txt(ip)]
  );

  const publicBase = String(baseUrl || process.env.SHINY_PUBLIC_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
  const resetUrl = `${publicBase}/tienda/recuperar-cuenta?token=${encodeURIComponent(token)}`;

  const mail = await queueAndSendEmail({
    to: account.email,
    subject: brandText("GMX · Recupera tu cuenta"),
    html: passwordResetEmailHtml({ name: account.nombre || '', resetUrl }),
    reference: account.id_cliente
  });

  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'CLIENT_AUTH','PASSWORD_RESET_REQUEST',$1,$2,'PUBLIC')`, [
  account.id_cliente, mail.sent ? 'EMAIL_SENT' : mail.queued ? 'EMAIL_QUEUED' : 'EMAIL_NOT_SENT']
  );

  return {
    accepted: true,
    development_reset_url: String(process.env.NODE_ENV || 'development') === 'development' ? resetUrl : undefined
  };
}

export async function completePasswordReset({ token, password, ip, userAgent }) {
  validatePassword(password);

  const client = await pool.connect();
  let account = null;
  try {
    await client.query('BEGIN');

    const r = await client.query(`SELECT t.*,c.activo,c.email_verificado,cl.nombre,cl.telefono,cl.direccion,
        cl.ciudad,cl.estado,cl.cp,cl.pais
      FROM gmx.cliente_password_reset_tokens t
      JOIN gmx.cliente_cuentas c ON c.id_cuenta=t.id_cuenta
      LEFT JOIN gmx.clientes cl ON cl.id_cliente=t.id_cliente
      WHERE t.token_hash=$1
        AND t.used_at IS NULL
        AND t.expires_at>NOW()
        AND c.activo=true
      ORDER BY t.row_id DESC
      LIMIT 1
      FOR UPDATE OF t`, [hashToken(token)]);

    if (!r.rowCount) throw new Error('INVALID_OR_EXPIRED_RESET_TOKEN');
    account = r.rows[0];

    await client.query(`UPDATE gmx.cliente_cuentas
      SET password_hash=$2,fecha_actualizacion=NOW()
      WHERE id_cuenta=$1`, [account.id_cuenta, hashPassword(password)]);

    await client.query(`UPDATE gmx.cliente_password_reset_tokens
      SET used_at=NOW(),completed_ip=$2
      WHERE row_id=$1`, [account.row_id, txt(ip)]);

    // Cierra absolutamente todas las sesiones previas.
    await client.query(`UPDATE gmx.cliente_sessions
      SET revoked_at=COALESCE(revoked_at,NOW())
      WHERE id_cuenta=$1`, [account.id_cuenta]);

    const sessionToken = newToken();
    const cfg = await client.query(`SELECT valor FROM gmx.configuracion WHERE parametro='public.store.client_session_hours'`);
    const hours = Math.min(Math.max(Number(cfg.rows[0]?.valor || 168), 1), 720);

    await client.query(`INSERT INTO gmx.cliente_sessions(
      token_hash,id_cuenta,id_cliente,email,expires_at,ip_address,user_agent)
      VALUES($1,$2,$3,$4,NOW()+($5||' hours')::interval,$6,$7)`, [
    hashToken(sessionToken), account.id_cuenta, account.id_cliente, account.email,
    String(hours), txt(ip), txt(userAgent).slice(0, 500)]
    );

    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'CLIENT_AUTH','PASSWORD_RESET_COMPLETE',$1,'Sesiones anteriores revocadas',$2)`, [
    account.id_cliente, account.email]
    );

    await client.query('COMMIT');

    await queueAndSendEmail({
      to: account.email,
      subject: brandText("GMX · Tu contraseña fue actualizada"),
      html: passwordChangedEmailHtml({ name: account.nombre || '' }),
      reference: account.id_cliente
    });

    return {
      token: sessionToken,
      hours,
      user: {
        id_cuenta: account.id_cuenta,
        id_cliente: account.id_cliente,
        nombre: account.nombre,
        email: account.email,
        telefono: account.telefono,
        direccion: account.direccion,
        ciudad: account.ciudad,
        estado: account.estado,
        cp: account.cp,
        pais: account.pais
      }
    };
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {
    client.release();
  }
}

/* GMX_CLIENT_PREFERENCES_R2_3
   Preferencias del portal de cliente.
   Se guardan en backend/data/client-preferences.json.
   Los TCG se validan siempre contra gmx.tcg_juegos.
*/
const CLIENT_PREFS_DIR = new URL('../../data/', import.meta.url);
const CLIENT_PREFS_FILE = new URL('../../data/client-preferences.json', import.meta.url);

function clientPreferencesDefaults(idCliente='') {
  return {
    id_cliente:String(idCliente || ''),
    tcg_favoritos:[],
    promociones:true,
    lanzamientos:true,
    pedidos:true,
    idioma:'es',
    moneda:'mxn',
    configured:false
  };
}

function readClientPreferencesFile() {
  try {
    fs.mkdirSync(CLIENT_PREFS_DIR,{recursive:true});

    if(!fs.existsSync(CLIENT_PREFS_FILE)){
      return {};
    }

    const raw=fs.readFileSync(CLIENT_PREFS_FILE,'utf8').trim();
    if(!raw){
      return {};
    }

    const parsed=JSON.parse(raw);
    return parsed && typeof parsed==='object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch(e) {
    console.error('[CLIENT_PREFERENCES_FILE_READ]',e);
    return {};
  }
}

function writeClientPreferencesFile(store) {
  fs.mkdirSync(CLIENT_PREFS_DIR,{recursive:true});

  const temp=new URL(
    `../../data/client-preferences-${process.pid}-${Date.now()}.tmp`,
    import.meta.url
  );

  fs.writeFileSync(
    temp,
    JSON.stringify(store,null,2),
    'utf8'
  );

  fs.renameSync(temp,CLIENT_PREFS_FILE);
}

async function publicTcgIdsForPreferences() {
  const r=await query(`
    SELECT id_juego
    FROM gmx.tcg_juegos
    WHERE COALESCE(activo,true)=true
      AND COALESCE(visible_portal,true)=true
      AND LOWER(TRIM(COALESCE(nombre,'')))<>'conosmon'
      AND LOWER(TRIM(COALESCE(codigo,'')))<>'conosmon'
    ORDER BY COALESCE(orden,999999),nombre,row_id
  `);

  return new Set(
    r.rows
      .map(x=>String(x.id_juego ?? '').trim())
      .filter(Boolean)
  );
}

export async function clientPreferences(idCliente) {
  const key=String(idCliente ?? '').trim();

  if(!key){
    return clientPreferencesDefaults('');
  }

  const store=readClientPreferencesFile();
  const saved=store[key];

  if(!saved || typeof saved!=='object'){
    return clientPreferencesDefaults(key);
  }

  const allowed=await publicTcgIdsForPreferences();

  const favorites=[
    ...new Set(
      (Array.isArray(saved.tcg_favoritos) ? saved.tcg_favoritos : [])
        .map(x=>String(x ?? '').trim())
        .filter(x=>allowed.has(x))
    )
  ];

  return {
    id_cliente:key,
    tcg_favoritos:favorites,
    promociones:saved.promociones!==false,
    lanzamientos:saved.lanzamientos!==false,
    pedidos:saved.pedidos!==false,
    idioma:'es',
    moneda:'mxn',
    configured:true
  };
}

export async function saveClientPreferences(idCliente,input={}) {
  const key=String(idCliente ?? '').trim();

  if(!key){
    throw new Error('CLIENT_NOT_AUTHENTICATED');
  }

  const allowed=await publicTcgIdsForPreferences();

  const favorites=[
    ...new Set(
      (Array.isArray(input.tcg_favoritos) ? input.tcg_favoritos : [])
        .map(x=>String(x ?? '').trim())
        .filter(x=>allowed.has(x))
    )
  ];

  const value={
    id_cliente:key,
    tcg_favoritos:favorites,
    promociones:input.promociones!==false,
    lanzamientos:input.lanzamientos!==false,
    pedidos:input.pedidos!==false,
    idioma:'es',
    moneda:'mxn',
    configured:true,
    fecha_actualizacion:new Date().toISOString()
  };

  const store=readClientPreferencesFile();
  store[key]=value;
  writeClientPreferencesFile(store);

  return value;
}

