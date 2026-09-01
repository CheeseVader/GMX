import { query } from '../db.js';
import { hashToken } from '../security.js';

function parseCookies(header=''){
  return Object.fromEntries(String(header).split(';').map(x=>x.trim()).filter(Boolean).map(part=>{
    const i=part.indexOf('=');
    return i<0?[part,'']:[decodeURIComponent(part.slice(0,i)),decodeURIComponent(part.slice(i+1))];
  }));
}

export async function optionalClientAuth(req,_res,next){
  try{
    const cookies=parseCookies(req.headers.cookie||'');
    const token=String(cookies.shiny_client_session||'').trim();
    if(!token)return next();
    const r=await query(`
      SELECT s.id AS session_id,s.id_cuenta,s.id_cliente,s.email,s.expires_at,c.activo,
             cl.nombre,cl.telefono
      FROM gmx.cliente_sessions s
      JOIN gmx.cliente_cuentas c ON c.id_cuenta=s.id_cuenta
      LEFT JOIN gmx.clientes cl ON cl.id_cliente=s.id_cliente
      WHERE s.token_hash=$1
        AND s.revoked_at IS NULL
        AND s.expires_at>NOW()
        AND c.activo=true
      LIMIT 1
    `,[hashToken(token)]);
    if(r.rowCount){
      req.clientUser=r.rows[0];
      query(`UPDATE gmx.cliente_sessions SET last_seen_at=NOW() WHERE id=$1`,[r.rows[0].session_id]).catch(()=>{});
    }
  }catch{}
  next();
}

export async function requireClientAuth(req,res,next){
  await optionalClientAuth(req,res,()=>{
    if(!req.clientUser)return res.status(401).json({success:false,error:'CLIENT_AUTH_REQUIRED'});
    next();
  });
}

export function setClientSessionCookie(res,token,maxAgeSeconds){
  const secure=String(process.env.NODE_ENV||'').toLowerCase()==='production';
  const attrs=[
    `shiny_client_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(60,Number(maxAgeSeconds||3600))}`
  ];
  if(secure)attrs.push('Secure');
  res.setHeader('Set-Cookie',attrs.join('; '));
}

export function clearClientSessionCookie(res){
  res.setHeader('Set-Cookie','shiny_client_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
