import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { api } from '../services/api.js';

const ADMIN_PATH_PREFIXES=[
  '/admin/dashboard',
  '/admin/productos',
  '/admin/categorias',
  '/admin/clientes',
  '/admin/inventario',
  '/admin/sucursales',
  '/admin/pedidos',
  '/admin/compras',
  '/admin/caja',
  '/admin/comercial',
  '/admin/contenido',
  '/admin/promociones',
  '/admin/notificaciones',
  '/admin/tcg',
  '/admin/tcg-operacion',
  '/admin/buylist',
  '/admin/reportes',
  '/admin/administracion',
  '/admin/sistema'
];

function isAdminPath(pathname){
  return ADMIN_PATH_PREFIXES.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`));
}

export default function GlobalTheme(){
  const {pathname}=useLocation();

  useEffect(()=>{
    let objectUrl='';
    let cancelled=false;

    async function loadTheme(){
      if(objectUrl){
        URL.revokeObjectURL(objectUrl);
        objectUrl='';
      }

      // El storefront utiliza PublicStoreProvider y su propio tema.
      // No consultar jamás /api/v1/* desde /, /tienda/* o /login.
      if(!isAdminPath(pathname))return;

      const token=localStorage.getItem('SHINY_AUTH_TOKEN')||'';
      if(!token)return;

      try{
        const r=await api('/api/v1/content/settings');
        if(cancelled)return;

        const s=Object.fromEntries((r.data||[]).map(x=>[x.parametro,x.valor]));
        const root=document.documentElement;
        const a=(key,fallback='')=>s[`admin.appearance.${key}`]??s[`appearance.${key}`]??fallback;

        root.style.setProperty('--tcg_store_template-primary',a('primary','#101828'));
        root.style.setProperty('--tcg_store_template-surface',a('surface','#ffffff'));
        root.style.setProperty('--tcg_store_template-background',a('background','#f2f4f7'));
        root.style.setProperty('--tcg_store_template-radius',`${Number(a('radius','14'))}px`);
        root.style.setProperty('--tcg_store_template-panel-opacity',String(a('panel_opacity','0.90')));
        root.style.setProperty('--tcg_store_template-bg-opacity',String(a('background_opacity','0.18')));
        root.style.setProperty('--tcg_store_template-bg-overlay',String(a('background_overlay','0.30')));
        root.style.setProperty('--tcg_store_template-bg-blur',`${Number(a('background_blur','0'))}px`);
        root.style.setProperty('--tcg_store_template-bg-position',a('background_position','center center'));
        root.style.setProperty('--tcg_store_template-bg-size',a('background_size','cover'));
        root.style.setProperty('--tcg_store_template-bg-attachment',String(a('background_fixed','true'))==='true'?'fixed':'scroll');
        document.body.dataset.tcg_store_templateDensity=a('density','comfortable');
        try {
          localStorage.setItem('Shiny_ADMIN_BRAND', JSON.stringify({
            name: String(a('brand_name', 'GMX') || 'GMX').replace(/^Shiny$/i, 'GMX'),
            logoText: (() => {
              const raw = String(a('logo_text', a('brand_name', 'GMX')) || 'GMX');
              return /^Shiny$/i.test(raw) ? 'GMX' : raw;
            })(),
            descriptor: a('brand_descriptor', 'LOCAL')
          }));
        } catch {}

        const mediaId=String(a('background_media_id','')).trim();
        if(mediaId){
          const resp=await fetch(`/api/v1/content/media/${encodeURIComponent(mediaId)}/file`,{
            headers:{Authorization:`Bearer ${token}`}
          });
          if(cancelled)return;

          if(resp.ok){
            const blob=await resp.blob();
            objectUrl=URL.createObjectURL(blob);
            root.style.setProperty('--tcg_store_template-bg-image',`url("${objectUrl}")`);
          }else{
            root.style.setProperty('--tcg_store_template-bg-image','none');
          }
        }else{
          root.style.setProperty('--tcg_store_template-bg-image','none');
        }
      }catch{
        // ProtectedRoute controla el acceso; no mostrar datos administrativos.
      }
    }

    loadTheme();
    window.addEventListener('tcg_store_template-theme-changed',loadTheme);

    return()=>{
      cancelled=true;
      window.removeEventListener('tcg_store_template-theme-changed',loadTheme);
      if(objectUrl)URL.revokeObjectURL(objectUrl);
    };
  },[pathname]);

  return null;
}
