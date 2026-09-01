import { Router } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '../db.js';
import { hashPassword,verifyPassword } from '../security.js';
import { requirePermission,audit,MODULES,resolveUserAccess } from '../middleware/auth.js';
import { requestAdminPasswordReset } from '../adminRecoveryService.js';

const router=Router();

async function getAdminByRowId(rowId){
  const r=await query(`SELECT * FROM gmx.administradores WHERE row_id=$1`,[rowId]);
  return r.rows[0]||null;
}

async function activeSuperadminCount(){
  const r=await query(`SELECT COUNT(*)::bigint AS total
    FROM gmx.administradores
    WHERE UPPER(COALESCE(rol,''))='SUPERADMIN' AND COALESCE(activo,true)=true`);
  return Number(r.rows[0].total||0);
}
async function ensureAdminEmailAvailable(email,excludeRowId=null){
  const normalized=String(email||'').trim().toLowerCase();
  const params=[normalized];
  let sql=`SELECT row_id FROM gmx.administradores WHERE LOWER(email)=$1`;

  if(excludeRowId!==null){
    params.push(Number(excludeRowId));
    sql+=` AND row_id<>$2`;
  }

  sql+=` LIMIT 1`;

  const r=await query(sql,params);
  if(r.rowCount){
    const error=new Error('ADMIN_EMAIL_ALREADY_EXISTS');
    error.statusCode=409;
    throw error;
  }
}

async function requireCurrentPassword(req,password){
  const r=await query(`SELECT password_hash FROM gmx.administradores
    WHERE id_admin=$1 ORDER BY row_id LIMIT 1`,[req.user.id_admin]);
  if(!r.rowCount||!verifyPassword(String(password||''),r.rows[0].password_hash)){
    const error=new Error('CURRENT_PASSWORD_INVALID');
    error.statusCode=403;
    throw error;
  }
}

function sendError(res,e){
  res.status(e.statusCode||400).json({
    success:false,
    error:e.message,
    message:e.message
  });
}

function requireSuperadmin(req,res,next){
  if(String(req.user?.rol||'').toUpperCase()!=='SUPERADMIN'){
    return res.status(403).json({success:false,error:'SUPERADMIN_REQUIRED'});
  }
  next();
}

router.get('/access/modules',requirePermission('ADMIN','read'),async(req,res)=>{
  try{
    const branches=await query(`SELECT id_sucursal,nombre_sucursal,ciudad,estado
      FROM gmx.sucursales WHERE COALESCE(activa,true)=true ORDER BY nombre_sucursal,row_id`);
    res.json({success:true,data:{
      modules:MODULES,
      actions:[{id:'read',label:'Leer'},{id:'create',label:'Crear'},{id:'edit',label:'Editar'},{id:'delete',label:'Eliminar'},{id:'authorize',label:'Autorizar'}],
      roles:['SUPERADMIN','ADMIN','SUPERVISOR','OPERADOR','CONSULTA'],
      branches:branches.rows,current:req.access
    }});
  }catch(e){sendError(res,e);}
});

router.get('/users',requirePermission('ADMIN','read'),async(_req,res)=>{
  try{
    const r=await query(`SELECT row_id,id_admin,nombre,email,SPLIT_PART(email,'@',1) AS username,rol,activo,fecha_creacion,fecha_actualizacion,
      sucursal_principal,sucursales_permitidas FROM gmx.administradores ORDER BY nombre,email,row_id`);
    res.json({success:true,data:r.rows});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

async function validateUserBranches(principal,allowed){
  const ids=[String(principal||'').trim(),...(Array.isArray(allowed)?allowed:[])].filter(Boolean);
  const unique=[...new Set(ids.map(String))];
  if(!unique.length)return {principal:null,allowed:[]};
  const r=await query(`SELECT id_sucursal FROM gmx.sucursales
    WHERE id_sucursal=ANY($1::text[]) AND COALESCE(activa,true)=true`,[unique]);
  const found=new Set(r.rows.map(x=>x.id_sucursal));
  const invalid=unique.find(x=>!found.has(x));
  if(invalid)throw new Error(`BRANCH_NOT_FOUND:${invalid}`);
  const p=String(principal||'').trim()||unique[0];
  return {principal:p,allowed:unique.includes(p)?unique:[p,...unique]};
}

router.post('/users',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    const b=req.body||{};
    const username=String(b.username||'').trim().toLowerCase();
    if(!/^[a-z0-9._-]{3,32}$/.test(username))throw new Error('INVALID_USERNAME');
    const email=`${username}@gmx.local`;
    if(!email||password.length<10)throw new Error('EMAIL_AND_PASSWORD_10_REQUIRED');

    await ensureAdminEmailAvailable(email);

    const requestedRole=String(b.rol||'OPERADOR').toUpperCase();
    if(!['SUPERADMIN','ADMIN','SUPERVISOR','OPERADOR','CONSULTA'].includes(requestedRole))throw new Error('INVALID_ADMIN_ROLE');
    let branchScope=await validateUserBranches(b.sucursal_principal,b.sucursales_permitidas);
    if(requestedRole==='OPERADOR'){
      if(!branchScope.principal)throw new Error('OPERATOR_BRANCH_REQUIRED');
      branchScope={principal:branchScope.principal,allowed:[branchScope.principal]};
    }
    if(requestedRole==='SUPERADMIN'){
      await requireCurrentPassword(req,b.currentPassword);
    }

    const id=String(b.id_admin||'').trim()||`ADM-${Date.now()}`;
    const r=await query(`INSERT INTO gmx.administradores(
      id_admin,nombre,email,password_hash,rol,activo,fecha_creacion,fecha_actualizacion,sucursal_principal,sucursales_permitidas)
      VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW(),$7,$8::jsonb)
      RETURNING row_id,id_admin,nombre,email,SPLIT_PART(email,'@',1) AS username,rol,activo,sucursal_principal,sucursales_permitidas`,
      [id,b.nombre||null,email,hashPassword(password),requestedRole,b.activo!==false,
       requestedRole==='SUPERADMIN'?null:branchScope.principal,
       JSON.stringify(requestedRole==='SUPERADMIN'?[]:branchScope.allowed)]);

    await audit(req,'ADMIN','CREATE_USER',id,`${username} rol=${requestedRole}`);
    res.status(201).json({success:true,data:r.rows[0]});
  }catch(e){sendError(res,e);}
});

router.put('/users/:rowId',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    const b=req.body||{},rowId=Number(req.params.rowId);
    const existing=await getAdminByRowId(rowId);
    if(!existing)throw new Error('ADMIN_NOT_FOUND');

    const newEmail=existing.email;
    if(!newEmail)throw new Error('EMAIL_REQUIRED');
    await ensureAdminEmailAvailable(newEmail,rowId);

    const newRole=String(b.rol||existing.rol||'OPERADOR').toUpperCase();
    if(!['SUPERADMIN','ADMIN','SUPERVISOR','OPERADOR','CONSULTA'].includes(newRole))throw new Error('INVALID_ADMIN_ROLE');
    let branchScope=await validateUserBranches(
      b.sucursal_principal??existing.sucursal_principal,
      b.sucursales_permitidas??existing.sucursales_permitidas??[]
    );
    if(newRole==='OPERADOR'){
      if(!branchScope.principal)throw new Error('OPERATOR_BRANCH_REQUIRED');
      branchScope={principal:branchScope.principal,allowed:[branchScope.principal]};
    }
    const newActive=b.activo!==false;
    const roleChangesToSuper=
      String(existing.rol||'').toUpperCase()!=='SUPERADMIN' && newRole==='SUPERADMIN';
    const roleChangesFromSuper=
      String(existing.rol||'').toUpperCase()==='SUPERADMIN' && newRole!=='SUPERADMIN';
    const disablesSuper=
      String(existing.rol||'').toUpperCase()==='SUPERADMIN' && existing.activo!==false && !newActive;

    if(roleChangesToSuper||roleChangesFromSuper||disablesSuper){
      await requireCurrentPassword(req,b.currentPassword);
    }

    if((roleChangesFromSuper||disablesSuper) && existing.activo!==false){
      const count=await activeSuperadminCount();
      if(count<=1)throw new Error('LAST_SUPERADMIN_CANNOT_BE_REMOVED');
    }

    if(existing.id_admin===req.user.id_admin && !newActive){
      throw new Error('CANNOT_DISABLE_CURRENT_USER');
    }

    const r=await query(`UPDATE gmx.administradores
      SET nombre=$2,email=LOWER($3),rol=$4,activo=$5,
          sucursal_principal=$6,sucursales_permitidas=$7::jsonb,fecha_actualizacion=NOW()
      WHERE row_id=$1
      RETURNING row_id,id_admin,nombre,email,SPLIT_PART(email,'@',1) AS username,rol,activo,sucursal_principal,sucursales_permitidas`,
      [rowId,b.nombre??existing.nombre,newEmail,newRole,newActive,
       newRole==='SUPERADMIN'?null:branchScope.principal,
       JSON.stringify(newRole==='SUPERADMIN'?[]:branchScope.allowed)]);

    if(b.password){
      if(String(b.password).length<10)throw new Error('PASSWORD_10_REQUIRED');
      if(existing.id_admin===req.user.id_admin){
        await requireCurrentPassword(req,b.currentPassword);
      }
      await query(`UPDATE gmx.administradores
        SET password_hash=$2,fecha_actualizacion=NOW()
        WHERE row_id=$1`,[rowId,hashPassword(b.password)]);
      await query(`UPDATE gmx.admin_sessions
        SET revoked_at=NOW()
        WHERE id_admin=$1 AND revoked_at IS NULL AND id<>$2`,
        [existing.id_admin,req.user.session_id]);
    }

    await audit(req,'ADMIN','UPDATE_USER',existing.id_admin,
      `${existing.email} -> ${r.rows[0].email}; ${existing.rol} -> ${newRole}; active=${newActive}`);

    res.json({success:true,data:r.rows[0]});
  }catch(e){sendError(res,e);}
});


router.post('/users/:rowId/send-password-reset',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    const target=await getAdminByRowId(Number(req.params.rowId));
    if(!target)throw new Error('ADMIN_NOT_FOUND');
    if(target.activo===false)throw new Error('ADMIN_INACTIVE');

    // Operación sensible: quien la solicita confirma su propia contraseña.
    await requireCurrentPassword(req,req.body?.currentPassword);

    const baseUrl=String(process.env.SHINY_PUBLIC_BASE_URL||'http://127.0.0.1:5173');
    const r=await requestAdminPasswordReset({
      email:target.email,
      ip:req.ip,
      baseUrl,
      requestedBy:req.user.email
    });

    await audit(req,'ADMIN','SEND_PASSWORD_RESET',target.id_admin,`Enlace de recuperación enviado a ${target.email}`);
    res.json({success:true,data:{
      queued:!!r.mail?.queued,
      sent:!!r.mail?.sent,
      development_reset_url:r.development_reset_url
    }});
  }catch(e){sendError(res,e);}
});

router.post('/users/:rowId/change-password',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    const rowId=Number(req.params.rowId);
    const target=await getAdminByRowId(rowId);
    if(!target)throw new Error('ADMIN_NOT_FOUND');

    const currentPassword=String(req.body?.currentPassword||'');
    const newPassword=String(req.body?.newPassword||'');
    if(newPassword.length<10)throw new Error('PASSWORD_10_REQUIRED');

    // Any password change is a sensitive administrative operation.
    await requireCurrentPassword(req,currentPassword);

    await query(`UPDATE gmx.administradores
      SET password_hash=$2,fecha_actualizacion=NOW()
      WHERE row_id=$1`,[rowId,hashPassword(newPassword)]);

    await query(`UPDATE gmx.admin_sessions
      SET revoked_at=NOW()
      WHERE id_admin=$1 AND revoked_at IS NULL
        AND NOT ($1=$2 AND id=$3)`,
      [target.id_admin,req.user.id_admin,req.user.session_id]);

    await audit(req,'ADMIN','CHANGE_PASSWORD',target.id_admin,
      `Password actualizado por ${req.user.email}`);

    res.json({success:true});
  }catch(e){sendError(res,e);}
});

router.post('/users/:rowId/revoke-sessions',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    const target=await getAdminByRowId(Number(req.params.rowId));
    if(!target)throw new Error('ADMIN_NOT_FOUND');

    await requireCurrentPassword(req,req.body?.currentPassword);

    const r=await query(`UPDATE gmx.admin_sessions
      SET revoked_at=NOW()
      WHERE id_admin=$1 AND revoked_at IS NULL
        AND NOT ($1=$2 AND id=$3)
      RETURNING id`,
      [target.id_admin,req.user.id_admin,req.user.session_id]);

    await audit(req,'ADMIN','REVOKE_SESSIONS',target.id_admin,
      `${r.rowCount} sesión(es) revocada(s)`);

    res.json({success:true,data:{revoked:r.rowCount}});
  }catch(e){sendError(res,e);}
});

router.get('/permissions/:email',requirePermission('ADMIN','read'),async(req,res)=>{
  try{
    const r=await query(`SELECT * FROM gmx.permisos_admin
      WHERE LOWER(email)=LOWER($1) ORDER BY modulo,row_id`,[req.params.email]);
    const target=await query(`SELECT * FROM gmx.administradores
      WHERE LOWER(email)=LOWER($1) ORDER BY row_id LIMIT 1`,[req.params.email]);
    res.json({success:true,data:{
      custom:r.rows,
      effective:target.rowCount?await resolveUserAccess(target.rows[0]):null
    }});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

router.put('/permissions/:email',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    await requireCurrentPassword(req,req.body?.currentPassword);
    const email=String(req.params.email||'').toLowerCase();
    const rows=Array.isArray(req.body?.permissions)?req.body.permissions:[];
    const validModules=new Set(MODULES.map(x=>x.id));
    const target=await query(`SELECT * FROM gmx.administradores WHERE LOWER(email)=$1 ORDER BY row_id LIMIT 1`,[email]);
    if(!target.rowCount)throw new Error('ADMIN_NOT_FOUND');
    if(String(target.rows[0].rol||'').toUpperCase()==='SUPERADMIN'&&rows.length)throw new Error('SUPERADMIN_PERMISSIONS_ARE_IMPLICIT');

    await query(`DELETE FROM gmx.permisos_admin WHERE LOWER(email)=$1`,[email]);
    for(const p of rows){
      const module=String(p.modulo||'').toUpperCase();
      if(!validModules.has(module))throw new Error(`INVALID_PERMISSION_MODULE:${module}`);
      await query(`INSERT INTO gmx.permisos_admin(
        email,modulo,leer,crear,editar,eliminar,autorizar,actualizacion)
        VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,[
          email,module,!!p.leer,!!p.crear,!!p.editar,!!p.eliminar,!!p.autorizar
        ]);
    }

    await audit(req,'ADMIN','UPDATE_PERMISSIONS',email,`${rows.length} módulos`);
    res.json({success:true});
  }catch(e){sendError(res,e);}
});

router.get('/audit',requirePermission('ADMIN','read'),async(req,res)=>{
  try{
    const limit=Math.min(Math.max(Number(req.query.limit||300),1),1000);
    const r=await query(`SELECT * FROM gmx.auditoria
      ORDER BY fecha DESC NULLS LAST,row_id DESC LIMIT $1`,[limit]);
    res.json({success:true,data:r.rows});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

router.post('/backup',requirePermission('ADMIN','authorize'),async(req,res)=>{
  try{
    const dir=path.resolve(process.env.SHINY_BACKUP_DIR||'./backups');
    fs.mkdirSync(dir,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const file=path.join(dir,`gmx_db_${stamp}.dump`);
    const args=[
      '-h',process.env.PGHOST||'127.0.0.1',
      '-p',process.env.PGPORT||'5432',
      '-U',process.env.PGUSER||'gmx_app',
      '-d',process.env.PGDATABASE||'gmx_db',
      '-Fc','-f',file
    ];
    const child=spawn(process.env.PG_DUMP_BIN||'pg_dump',args,{
      shell:false,
      env:{...process.env,PGPASSWORD:process.env.PGPASSWORD||''}
    });

    let stderr='';
    child.stderr.on('data',d=>stderr+=d.toString());
    child.on('error',e=>{
      if(!res.headersSent)res.status(500).json({
        success:false,error:'PG_DUMP_FAILED',message:e.message
      });
    });
    child.on('close',async code=>{
      if(res.headersSent)return;
      if(code!==0)return res.status(500).json({
        success:false,error:'PG_DUMP_FAILED',message:stderr
      });
      const stat=fs.statSync(file);
      await audit(req,'BACKUP','CREATE',path.basename(file),`${stat.size} bytes`);
      res.json({success:true,data:{
        file:path.basename(file),directory:dir,size:stat.size
      }});
    });
  }catch(e){res.status(500).json({success:false,error:e.message,message:e.message});}
});

router.get('/diagnostic',requirePermission('ADMIN','read'),async(_req,res)=>{
  try{
    const [db,migrations,admins,sessions,superadmins]=await Promise.all([
      query(`SELECT current_database() database,current_user db_user,current_schema() schema,
        version() postgres_version,NOW() server_time`),
      query(`SELECT version,description,applied_at
        FROM gmx.schema_migrations ORDER BY applied_at,version`),
      query(`SELECT COUNT(*)::bigint total,
        COUNT(*) FILTER(WHERE COALESCE(activo,true))::bigint active
        FROM gmx.administradores`),
      query(`SELECT COUNT(*)::bigint active
        FROM gmx.admin_sessions
        WHERE revoked_at IS NULL AND expires_at>NOW()`),
      query(`SELECT COUNT(*)::bigint active
        FROM gmx.administradores
        WHERE UPPER(COALESCE(rol,''))='SUPERADMIN'
          AND COALESCE(activo,true)=true`)
    ]);

    res.json({success:true,data:{
      database:db.rows[0],
      migrations:migrations.rows,
      admins:admins.rows[0],
      sessions:sessions.rows[0],
      superadmins:superadmins.rows[0],
      runtime:{
        node:process.version,
        env:process.env.NODE_ENV||'development',
        bind:'127.0.0.1',
        legacyRuntime:false
      }
    }});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});

router.get('/technical/diagnostic',requireSuperadmin,async(req,res)=>{
  try{
    const [db,schema,tables,migrations,auditRows,sessions]=await Promise.all([
      query(`SELECT current_database() database,current_user db_user,current_schema() schema,
        version() postgres_version,NOW() server_time,
        pg_database_size(current_database())::bigint bytes,
        pg_size_pretty(pg_database_size(current_database())) size`),
      query(`SELECT COALESCE(SUM(pg_total_relation_size(c.oid)),0)::bigint bytes,
        pg_size_pretty(COALESCE(SUM(pg_total_relation_size(c.oid)),0)) size
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='gmx' AND c.relkind IN ('r','m')`),
      query(`SELECT c.relname table_name,pg_total_relation_size(c.oid)::bigint total_bytes,
        pg_size_pretty(pg_total_relation_size(c.oid)) total_size,
        pg_relation_size(c.oid)::bigint table_bytes,
        pg_size_pretty(pg_relation_size(c.oid)) table_size
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='gmx' AND c.relkind='r'
        ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 80`),
      query(`SELECT version,description,applied_at
        FROM gmx.schema_migrations ORDER BY applied_at DESC,version DESC LIMIT 100`),
      query(`SELECT row_id,fecha,modulo,accion,referencia,detalle,usuario
        FROM gmx.auditoria ORDER BY fecha DESC NULLS LAST,row_id DESC LIMIT 500`),
      query(`SELECT s.id,s.id_admin,s.email,s.created_at,s.last_seen_at,s.expires_at,
        CASE WHEN s.revoked_at IS NULL AND s.expires_at>NOW() THEN 'ACTIVA' ELSE 'CERRADA' END estado
        FROM gmx.admin_sessions s ORDER BY s.last_seen_at DESC NULLS LAST LIMIT 100`)
    ]);

    await audit(req,'SISTEMA','TECHNICAL_DIAGNOSTIC','SUPERADMIN','Consulta técnica de diagnóstico');
    res.json({success:true,data:{
      database:db.rows[0],schema:schema.rows[0],tables:tables.rows,
      migrations:migrations.rows,audit:auditRows.rows,sessions:sessions.rows,
      runtime:{
        node:process.version,env:process.env.NODE_ENV||'development',
        platform:process.platform,pid:process.pid,uptimeSeconds:Math.round(process.uptime())
      }
    }});
  }catch(e){sendError(res,e);}
});


export default router;
