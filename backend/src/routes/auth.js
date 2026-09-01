import fs from 'node:fs';
import { Router } from 'express';
import { query } from '../db.js';
import { hashToken,newToken,verifyPassword } from '../security.js';
import { requireAuth,audit } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requestAdminPasswordReset,completeAdminPasswordReset } from '../adminRecoveryService.js';

const router=Router();


router.post('/recover',rateLimit({keyPrefix:'ADMIN_RECOVER',max:6}),async(req,res)=>{
  try{
    const baseUrl=`${req.protocol}://${req.get('host')}`.replace(':8787',':5173');
    const r=await requestAdminPasswordReset({
      email:req.body?.email,
      ip:req.ip,
      baseUrl,
      requestedBy:'PUBLIC_ADMIN_RECOVERY'
    });

    // La respuesta pública nunca revela si la cuenta existe.
    const data={accepted:true};
    if(r.development_reset_url)data.development_reset_url=r.development_reset_url;
    res.json({success:true,data});
  }catch(_e){
    res.json({success:true,data:{accepted:true}});
  }
});

router.post('/reset-password',rateLimit({keyPrefix:'ADMIN_RESET',max:8}),async(req,res)=>{
  try{
    const r=await completeAdminPasswordReset({
      token:req.body?.token,
      password:req.body?.password,
      ip:req.ip
    });
    res.json({success:true,data:{reset:r.reset,revoked:r.revoked}});
  }catch(e){
    const known=new Set([
      'ADMIN_PASSWORD_MIN_10',
      'ADMIN_PASSWORD_LETTER_AND_NUMBER_REQUIRED',
      'INVALID_OR_EXPIRED_ADMIN_RESET_TOKEN'
    ]);
    const code=known.has(e.message)?e.message:'ADMIN_PASSWORD_RESET_FAILED';
    res.status(known.has(e.message)?400:500).json({success:false,error:code});
  }
});

/* SHINY_LOGIN_PUBLIC_APPEARANCE_R63M */
router.get('/login-appearance',async(_req,res)=>{
  try{
    const keys=[
      'admin.appearance.login_background_design',
      'admin.appearance.login_background_glow',
      'admin.appearance.login_background_media_id',
      'admin.appearance.login_background_opacity',
      'admin.appearance.login_background_fit'
    ];
    const r=await query(
      `SELECT parametro,valor FROM gmx.configuracion WHERE parametro = ANY($1::text[])`,
      [keys]
    );
    const cfg=Object.fromEntries((r.rows||[]).map((x)=>[x.parametro,x.valor]));
    const value=(key,fallback='')=>String(cfg[`admin.appearance.${key}`]??fallback);
    res.setHeader('Cache-Control','no-store');
    res.json({
      success:true,
      data:{
        design:value('login_background_design','network4'),
        glow:value('login_background_glow','violet'),
        mediaId:value('login_background_media_id',''),
        opacity:Math.max(0,Math.min(1,Number(value('login_background_opacity','1'))||1)),
        fit:['cover','contain','fill'].includes(value('login_background_fit','cover'))?value('login_background_fit','cover'):'cover'
      }
    });
  }catch(error){
    res.status(500).json({success:false,error:'LOGIN_APPEARANCE_FAILED',message:error.message});
  }
});

router.get('/login-background',async(_req,res)=>{
  try{
    const r=await query(`
      SELECT m.ruta,m.mime_type,m.nombre_archivo
      FROM gmx.configuracion c
      JOIN gmx.multimedia m ON m.id_media=c.valor
      WHERE c.parametro='admin.appearance.login_background_media_id'
        AND COALESCE(m.activo,true)=true
      ORDER BY m.row_id DESC
      LIMIT 1
    `);
    const m=r.rows?.[0];
    if(!m?.ruta || !fs.existsSync(m.ruta)){
      return res.status(404).json({success:false,error:'LOGIN_BACKGROUND_NOT_FOUND'});
    }
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',m.mime_type||'image/jpeg');
    res.setHeader('Content-Disposition','inline');
    fs.createReadStream(m.ruta).pipe(res);
  }catch(error){
    res.status(500).json({success:false,error:'LOGIN_BACKGROUND_FAILED',message:error.message});
  }
});
router.post('/login',rateLimit({keyPrefix:'ADMIN_LOGIN',max:10}),async(req,res)=>{
  try{
    const username=String(req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    if(!username||!password)return res.status(400).json({success:false,error:'CREDENTIALS_REQUIRED'});

    const r=await query(`SELECT * FROM gmx.administradores
      WHERE (
        LOWER(SPLIT_PART(email,'@',1))=LOWER($1)
        OR LOWER(email)=LOWER($1)
        OR (LOWER($1)='admin' AND UPPER(rol)='SUPERADMIN')
      ) AND COALESCE(activo,true)=true
      ORDER BY CASE
        WHEN LOWER(SPLIT_PART(email,'@',1))=LOWER($1) THEN 0
        WHEN LOWER(email)=LOWER($1) THEN 1
        WHEN LOWER($1)='admin' AND UPPER(rol)='SUPERADMIN' THEN 2
        ELSE 9
      END, row_id
      LIMIT 1`,[username]);
    if(!r.rowCount||!verifyPassword(password,r.rows[0].password_hash))
      return res.status(401).json({success:false,error:'INVALID_CREDENTIALS'});

    const admin=r.rows[0];
    const token=newToken();
    const hours=Math.min(Math.max(Number(process.env.SHINY_SESSION_HOURS||12),1),72);
    await query(`INSERT INTO gmx.admin_sessions(token_hash,id_admin,email,expires_at,ip_address,user_agent)
      VALUES($1,$2,$3,NOW()+($4||' hours')::interval,$5,$6)`,
      [hashToken(token),admin.id_admin,admin.email,String(hours),req.ip,String(req.headers['user-agent']||'').slice(0,500)]);

    req.user={email:admin.email,username:String(admin.email||'').split('@')[0]};
    await audit(req,'AUTH','LOGIN',admin.id_admin,'Inicio de sesión local');

    res.json({success:true,data:{
      token,expiresInHours:hours,user:{
        id_admin:admin.id_admin,nombre:admin.nombre,email:admin.email,username:String(admin.email||'').split('@')[0],rol:admin.rol,
        sucursal_principal:admin.sucursal_principal,sucursales_permitidas:admin.sucursales_permitidas
      }
    }});
  }catch(_e){res.status(500).json({success:false,error:'LOGIN_FAILED'});}
});

router.get('/me',requireAuth,async(req,res)=>{
  res.json({success:true,data:{user:req.user,access:req.access}});
});

router.post('/verify-password',requireAuth,rateLimit({keyPrefix:'POS_PROTECTED_EXIT',max:8}),async(req,res)=>{
  try{
    const password=String(req.body?.password||'');
    if(!password)return res.status(400).json({success:false,error:'PASSWORD_REQUIRED'});
    const r=await query(`SELECT password_hash FROM gmx.administradores
      WHERE id_admin=$1 AND COALESCE(activo,true)=true
      ORDER BY row_id LIMIT 1`,[req.user.id_admin]);
    if(!r.rowCount||!verifyPassword(password,r.rows[0].password_hash)){
      await audit(req,'AUTH','POS_EXIT_DENIED',req.user.id_admin,'Contraseña incorrecta para salida protegida del POS');
      return res.status(401).json({success:false,error:'INVALID_CREDENTIALS'});
    }
    await audit(req,'AUTH','POS_EXIT_AUTHORIZED',req.user.id_admin,'Salida protegida del POS autorizada');
    res.json({success:true,data:{authorized:true}});
  }catch(e){
    res.status(500).json({success:false,error:'PASSWORD_VERIFY_FAILED',message:e.message});
  }
});

router.post('/logout',requireAuth,async(req,res)=>{
  try{
    await query(`UPDATE gmx.admin_sessions SET revoked_at=NOW() WHERE id=$1`,[req.user.session_id]);
    await audit(req,'AUTH','LOGOUT',req.user.id_admin,'Cierre de sesión');
    res.json({success:true});
  }catch(e){res.status(500).json({success:false,error:'LOGOUT_FAILED',message:e.message});}
});

export default router;
