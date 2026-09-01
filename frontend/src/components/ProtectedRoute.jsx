import { Navigate,Outlet,useLocation } from 'react-router';
import { useEffect,useState } from 'react';

const routeModules=[
  ['/admin/dashboard','DASHBOARD'],['/admin/productos','PRODUCTOS'],['/admin/alta-externa-beta','PRODUCTOS'],['/admin/busqueda-visual-beta','PRODUCTOS'],['/admin/categorias','PRODUCTOS'],['/admin/clientes','CLIENTES'],
  ['/admin/inventario','INVENTARIO'],['/admin/sucursales','SUCURSALES'],['/admin/pedidos','PEDIDOS'],['/admin/historial-ventas','PEDIDOS'],
  ['/admin/compras','COMPRAS'],['/admin/caja','CAJA'],['/admin/comercial','COMERCIAL'],
  ['/admin/tcg-operacion','TCG'],['/admin/tcg','TCG'],['/admin/buylist','BUYLIST'],
  ['/admin/promociones','CONTENIDO'],['/admin/contenido','CONTENIDO'],['/admin/notificaciones','NOTIFICACIONES'],['/admin/reportes','REPORTES'],
  ['/admin/administracion','ADMIN'],['/admin/sistema','SISTEMA']
];

const ACCESS_UPDATED_EVENT='shiny-auth-access-updated';
function notifyAccessUpdated(){window.dispatchEvent(new Event(ACCESS_UPDATED_EVENT));}

function clearSession(){
  localStorage.removeItem('SHINY_AUTH_TOKEN');localStorage.removeItem('SHINY_AUTH_USER');localStorage.removeItem('SHINY_AUTH_ACCESS');
  notifyAccessUpdated();
}
function moduleFor(path){return routeModules.find(([prefix])=>path===prefix||path.startsWith(`${prefix}/`))?.[1]||null;}

export default function ProtectedRoute(){
  const location=useLocation(),token=localStorage.getItem('SHINY_AUTH_TOKEN');
  const [state,setState]=useState(()=>token?'checking':'denied'),[access,setAccess]=useState(null);

  useEffect(()=>{
    let cancelled=false;
    if(!token){setState('denied');return()=>{cancelled=true;};}
    fetch('/api/auth/me',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'})
      .then(async r=>{
        if(cancelled)return;
        if(!r.ok){clearSession();setState('denied');return;}
        const body=await r.json(),a=body.data?.access||null;
        localStorage.setItem('SHINY_AUTH_ACCESS',JSON.stringify(a||{}));
        localStorage.setItem('SHINY_AUTH_USER',JSON.stringify(body.data?.user||{}));
        notifyAccessUpdated();
        setAccess(a);setState('allowed');
      })
      .catch(()=>{if(!cancelled){clearSession();setState('denied');}});
    return()=>{cancelled=true;};
  },[token,location.pathname]);

  if(state==='denied')return <Navigate to="/login" replace/>;
  if(state!=='allowed')return <div className="admin-auth-gate"><div className="admin-auth-gate-spinner"/></div>;

  let currentUser={};
  try{currentUser=JSON.parse(localStorage.getItem('SHINY_AUTH_USER')||'{}');}catch{}
  const role=String(currentUser?.rol||'').toUpperCase();

  // OPERADOR = entorno POS único.
  // R11 permite dos formas de ejecución:
  // - /admin/pos               -> POS Web (Fullscreen API con acción del usuario)
  // - /admin/pos?kiosk=1       -> terminal kiosk/PWA gestionada
  // Cualquier otra pantalla administrativa vuelve al POS.
  if(role==='OPERADOR'){
    const kiosk=String(new URLSearchParams(location.search).get('kiosk')||'')==='1';
    const operatorTarget=kiosk?'/admin/pos?kiosk=1':'/admin/pos';
    if(location.pathname!=='/admin/pos'){
      return <Navigate to={operatorTarget} replace/>;
    }
  }

  const module=moduleFor(location.pathname);
  if(module&&access?.permissions?.[module]?.read!==true){
    if(role==='OPERADOR'){
      const kiosk=String(new URLSearchParams(location.search).get('kiosk')||'')==='1';
      return <Navigate to={kiosk?'/admin/pos?kiosk=1':'/admin/pos'} replace/>;
    }
    return <Navigate to="/admin/dashboard" replace/>;
  }
  return <Outlet/>;
}
