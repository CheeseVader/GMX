import { query } from '../db.js';
import { hashToken } from '../security.js';

export const MODULES=[
  {id:'DASHBOARD',label:'Dashboard',group:'GENERAL'},
  {id:'PRODUCTOS',label:'Productos',group:'GENERAL'},
  {id:'CLIENTES',label:'Clientes',group:'GENERAL'},
  {id:'INVENTARIO',label:'Inventario',group:'GENERAL'},
  {id:'SUCURSALES',label:'Sucursales',group:'GENERAL'},
  {id:'PEDIDOS',label:'Pedidos / POS',group:'OPERACION'},
  {id:'COMPRAS',label:'Compras / Recepción',group:'OPERACION'},
  {id:'CAJA',label:'Caja / Arqueo',group:'OPERACION'},
  {id:'COMERCIAL',label:'Gestión Comercial',group:'OPERACION'},
  {id:'TCG',label:'TCG',group:'TCG'},
  {id:'BUYLIST',label:'Buylist',group:'TCG'},
  {id:'CONTENIDO',label:'Contenido / Promociones',group:'GESTION'},
  {id:'NOTIFICACIONES',label:'Notificaciones / Alertas',group:'GESTION'},
  {id:'REPORTES',label:'Reportes / Auditoría',group:'GESTION'},
  {id:'ADMIN',label:'Usuarios / Permisos',group:'SEGURIDAD'},
  {id:'SISTEMA',label:'Sistema / Configuración',group:'SEGURIDAD'}
];

const ACTIONS=['read','create','edit','delete','authorize'];
const none=()=>({read:false,create:false,edit:false,delete:false,authorize:false});
const read=()=>({read:true,create:false,edit:false,delete:false,authorize:false});
const operate=()=>({read:true,create:true,edit:true,delete:false,authorize:false});
const manage=()=>({read:true,create:true,edit:true,delete:false,authorize:true});
const full=()=>({read:true,create:true,edit:true,delete:true,authorize:true});

const operational=['PRODUCTOS','CLIENTES','INVENTARIO','PEDIDOS','COMPRAS','CAJA','COMERCIAL','TCG','BUYLIST'];
const supervisorModules=[...operational,'DASHBOARD','SUCURSALES','REPORTES','NOTIFICACIONES'];
const adminModules=[...supervisorModules,'CONTENIDO','SISTEMA'];

function roleDefaults(role,module){
  const r=String(role||'CONSULTA').toUpperCase();
  if(r==='SUPERADMIN')return full();
  if(r==='ADMIN'){
    if(module==='ADMIN')return read();
    if(adminModules.includes(module))return manage();
    return read();
  }
  if(r==='SUPERVISOR'){
    if(supervisorModules.includes(module))return manage();
    if(module==='CONTENIDO')return read();
    return none();
  }
  if(r==='OPERADOR'){
    // Dependencias de lectura necesarias para operar cualquier sucursal.
    // El usuario puede ver únicamente las sucursales de su alcance.
    if(['DASHBOARD','SUCURSALES','NOTIFICACIONES'].includes(module))return read();
    if(operational.includes(module))return operate();
    return none();
  }
  if(r==='CONSULTA'){
    if(['DASHBOARD','PRODUCTOS','CLIENTES','INVENTARIO','SUCURSALES','PEDIDOS','COMPRAS','CAJA','COMERCIAL','TCG','BUYLIST','CONTENIDO','REPORTES','NOTIFICACIONES'].includes(module))return read();
    return none();
  }
  return none();
}

function normalizeBranches(value){
  if(Array.isArray(value))return value.map(String).filter(Boolean);
  try{
    const parsed=JSON.parse(String(value||'[]'));
    return Array.isArray(parsed)?parsed.map(String).filter(Boolean):[];
  }catch{return [];}
}

export async function resolveUserAccess(user){
  const role=String(user?.rol||'CONSULTA').toUpperCase();
  const email=String(user?.email||'').toLowerCase();
  const custom=await query(`SELECT modulo,leer,crear,editar,eliminar,autorizar
    FROM gmx.permisos_admin WHERE LOWER(email)=$1 ORDER BY row_id`,[email]);
  const byModule=new Map(custom.rows.map(x=>[String(x.modulo).toUpperCase(),x]));
  const permissions={};

  for(const m of MODULES){
    if(role==='SUPERADMIN'){permissions[m.id]=full();continue;}
    // OPERADOR es un rol POS fijo: conserva las dependencias API necesarias para vender,
    // pero su navegación de backoffice se limita en frontend al entorno POS.
    if(role==='OPERADOR'){permissions[m.id]=roleDefaults(role,m.id);continue;}
    const p=byModule.get(m.id);
    permissions[m.id]=p?{
      read:p.leer===true,create:p.crear===true,edit:p.editar===true,
      delete:p.eliminar===true,authorize:p.autorizar===true
    }:roleDefaults(role,m.id);
  }

  const allowedBranches=normalizeBranches(user?.sucursales_permitidas);
  const principal=String(user?.sucursal_principal||'').trim();
  if(principal&&!allowedBranches.includes(principal))allowedBranches.unshift(principal);

  return {role,permissions,branchScope:{
    all:role==='SUPERADMIN'||allowedBranches.length===0,
    principal:principal||null,allowed:allowedBranches
  }};
}

export async function requireAuth(req,res,next){
  try{
    const header=String(req.headers.authorization||'');
    if(!header.startsWith('Bearer '))return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    const token=header.slice(7).trim();
    const r=await query(`
      SELECT s.id AS session_id,s.id_admin,s.email,s.expires_at,a.nombre,a.rol,a.activo,
             a.sucursal_principal,a.sucursales_permitidas
      FROM gmx.admin_sessions s JOIN gmx.administradores a ON a.id_admin=s.id_admin
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() LIMIT 1
    `,[hashToken(token)]);
    if(!r.rowCount||r.rows[0].activo===false)return res.status(401).json({success:false,error:'SESSION_INVALID'});
    req.user=r.rows[0];
    req.access=await resolveUserAccess(req.user);
    await query(`UPDATE gmx.admin_sessions SET last_seen_at=NOW() WHERE id=$1`,[req.user.session_id]);
    next();
  }catch(_e){res.status(500).json({success:false,error:'AUTH_CHECK_FAILED'});}
}

export function requirePermission(module,action='read'){
  return async(req,res,next)=>{
    try{
      const m=String(module||'').toUpperCase();
      const a=ACTIONS.includes(action)?action:'read';
      const access=req.access||await resolveUserAccess(req.user);
      if(access.permissions?.[m]?.[a]!==true)return res.status(403).json({success:false,error:'FORBIDDEN',module:m,action:a});
      next();
    }catch(_e){res.status(500).json({success:false,error:'PERMISSION_CHECK_FAILED'});}
  };
}

const PRIVATE_COST_KEYS = new Set([
  'costo','cost','costo_unitario','unit_cost','valor_costo','cost_value','margen_costo'
]);

function removePrivateCostFields(value){
  if(Array.isArray(value))return value.map(removePrivateCostFields);
  if(!value||typeof value!=='object')return value;
  const clean={};
  for(const [key,item] of Object.entries(value)){
    if(PRIVATE_COST_KEYS.has(String(key).toLowerCase()))continue;
    clean[key]=removePrivateCostFields(item);
  }
  return clean;
}

export function enforceSuperadminCostPrivacy(req,res,next){
  if(String(req.access?.role||req.user?.rol||'').toUpperCase()==='SUPERADMIN')return next();
  if(req.body&&typeof req.body==='object')req.body=removePrivateCostFields(req.body);
  const originalJson=res.json.bind(res);
  res.json=(payload)=>originalJson(removePrivateCostFields(payload));
  next();
}

const BRANCH_KEYS=[
  'branchId','branch_id','id_sucursal','idSucursal','sucursalId',
  'originId','destinationId',
  'originBranchId','destinationBranchId',
  'id_sucursal_origen','id_sucursal_destino'
];
function extractRequestedBranches(req){
  const values=[];
  for(const source of [req.query||{},req.body||{},req.params||{}]){
    for(const k of BRANCH_KEYS){
      const v=source?.[k];
      if(Array.isArray(v))values.push(...v.map(String));
      else if(v!==undefined&&v!==null&&String(v).trim())values.push(String(v).trim());
    }
  }
  return [...new Set(values.filter(Boolean))];
}


const RESPONSE_BRANCH_KEYS=[
  'id_sucursal','branchId','branch_id','idSucursal','sucursalId',
  'id_sucursal_recepcion','id_sucursal_origen','id_sucursal_destino'
];

function objectBranchIds(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return [];
  const ids=[];
  for(const key of RESPONSE_BRANCH_KEYS){
    const v=value[key];
    if(v!==undefined&&v!==null&&String(v).trim())ids.push(String(v).trim());
  }
  return [...new Set(ids)];
}

function itemWithinBranchScope(item,allowed){
  const ids=objectBranchIds(item);
  if(!ids.length)return true;
  return ids.some(id=>allowed.includes(id));
}

export function applyDefaultBranchScope(req,res,next){
  try{
    const scope=req.access?.branchScope;
    if(!scope||scope.all||scope.allowed.length!==1)return next();

    // Muchas pantallas históricas esperan branchId pero no siempre lo envían
    // en sus cargas auxiliares. Para un usuario de una sola sucursal,
    // utilizamos esa sucursal como contexto predeterminado.
    if(String(req.method||'GET').toUpperCase()==='GET'){
      const only=scope.allowed[0];
      if(!req.query?.branchId){
        try{req.query.branchId=only;}catch{}
      }
      req.scopedBranchId=only;
    }
    next();
  }catch(_e){
    res.status(500).json({success:false,error:'BRANCH_DEFAULT_SCOPE_FAILED'});
  }
}

export function filterResponseByBranchScope(req,res,next){
  const scope=req.access?.branchScope;
  if(!scope||scope.all)return next();

  const originalJson=res.json.bind(res);
  res.json=(payload)=>{
    try{
      if(!payload||payload.success===false)return originalJson(payload);
      const allowed=scope.allowed||[];

      if(Array.isArray(payload.data)){
        payload={...payload,data:payload.data.filter(item=>itemWithinBranchScope(item,allowed))};
        if(typeof payload.count==='number')payload.count=payload.data.length;
      }else if(payload.data&&typeof payload.data==='object'){
        const ids=objectBranchIds(payload.data);
        if(ids.length&&!ids.some(id=>allowed.includes(id))){
          return res.status(403).json({
            success:false,error:'BRANCH_FORBIDDEN',
            allowedBranches:allowed
          });
        }

        // Filtra colecciones anidadas conocidas sin alterar catálogos globales.
        const data={...payload.data};
        for(const key of ['rows','items','orders','sales','inventory','movements','purchases','expenses','payables','branches','sessions']){
          if(Array.isArray(data[key])){
            data[key]=data[key].filter(item=>itemWithinBranchScope(item,allowed));
          }
        }
        payload={...payload,data};
      }
    }catch{}
    return originalJson(payload);
  };
  next();
}

export function enforceBranchScope(req,res,next){
  try{
    const scope=req.access?.branchScope;
    if(!scope||scope.all)return next();
    const denied=extractRequestedBranches(req).find(x=>!scope.allowed.includes(x));
    if(denied)return res.status(403).json({success:false,error:'BRANCH_FORBIDDEN',branchId:denied,allowedBranches:scope.allowed});
    next();
  }catch(_e){res.status(500).json({success:false,error:'BRANCH_SCOPE_CHECK_FAILED'});}
}

export function requireModule(module){
  return (req,res,next)=>{
    const method=String(req.method||'GET').toUpperCase();
    const action=method==='GET'?'read':method==='DELETE'?'delete':method==='PUT'||method==='PATCH'?'edit':'create';
    return requirePermission(module,action)(req,res,next);
  };
}

export async function audit(req,module,action,reference='',detail=''){
  try{
    await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),$1,$2,$3,$4,$5)`,[module,action,reference||null,detail||null,req.user?.email||'system']);
  }catch{}
}
