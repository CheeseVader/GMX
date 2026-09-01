import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import SecureMedia from './SecureMedia.jsx';
import SlideshowMedia from './SlideshowMedia.jsx';
import BannerManager from './BannerManager.jsx';

const TEMPLATES = {
  TCG_BATTLE_ARENA: {
    name: 'TCG Battle Arena', recommended: true, premium: true,
    description: 'Competitivo y enfocado en torneos: cartas destacadas, eventos y una estética de arena TCG.',
    values: { primary: '#0b1220', secondary: '#f59e0b', accent: '#22d3ee', surface: '#111827', background: '#050914', text: '#f8fafc', muted: '#94a3b8', radius: '14', header_style: 'floating', card_style: 'glass', panel_opacity: '0.90', background_opacity: '0.30', background_overlay: '0.44', hero_height: '540', visual_fx: 'hud' }
  },
  ANIME_NEON_CITY: {
    name: 'Anime Neon City', premium: true,
    description: 'Ciudad nocturna anime/cyber con neón, paneles brillantes y hero de alto impacto.',
    values: { primary: '#11112b', secondary: '#22d3ee', accent: '#f472b6', surface: '#17172f', background: '#070716', text: '#ffffff', muted: '#c4b5fd', radius: '22', header_style: 'floating', card_style: 'glass', panel_opacity: '0.84', background_opacity: '0.40', background_overlay: '0.34', hero_height: '580', visual_fx: 'grid' }
  },
  RETRO_ARCADE_96: {
    name: 'Retro Arcade 96', premium: true,
    description: 'Arcade noventero con sensación CRT, bloques compactos y energía de gabinete clásico.',
    values: { primary: '#07111f', secondary: '#22d3ee', accent: '#ff3cac', surface: '#0b1728', background: '#030712', text: '#f8fafc', muted: '#8da2bd', radius: '8', header_style: 'solid', card_style: 'bordered', panel_opacity: '0.94', background_opacity: '0.30', background_overlay: '0.46', hero_height: '500', visual_fx: 'scanlines' }
  },
  COLLECTOR_VAULT: {
    name: 'Collector Vault', premium: true,
    description: 'Bóveda premium para singles, slabs y coleccionables de alto valor con foco en producto.',
    values: { primary: '#0b1220', secondary: '#d4af37', accent: '#67e8f9', surface: '#101827', background: '#050914', text: '#ffffff', muted: '#a5b4fc', radius: '12', header_style: 'solid', card_style: 'bordered', panel_opacity: '0.96', background_opacity: '0.18', background_overlay: '0.54', hero_height: '500', visual_fx: 'holo' }
  },
  SHONEN_CARD_FEST: {
    name: 'Shonen Card Fest', premium: true,
    description: 'Promociones, lanzamientos y eventos con una composición viva inspirada en festivales anime/TCG.',
    values: { primary: '#1e1b4b', secondary: '#fb7185', accent: '#facc15', surface: '#27224f', background: '#100d2c', text: '#fff7ed', muted: '#ddd6fe', radius: '20', header_style: 'floating', card_style: 'soft', panel_opacity: '0.90', background_opacity: '0.34', background_overlay: '0.32', hero_height: '560', visual_fx: 'sunset' }
  }
};

const pKey = (k) => `public.appearance.${k}`;
const aKey = (k) => `admin.appearance.${k}`;

export default function DualAppearanceDesigner({ settings, setSettings, media = [] }) {
  const [liveMedia, setLiveMedia] = useState(media || []);
  useEffect(() => setLiveMedia(media || []), [media]);

  async function refreshMediaLibrary() {
    try {
      const r = await api('/api/v1/content/media');
      setLiveMedia(r.data || []);
    } catch {}
  }

  useEffect(() => {
    window.addEventListener('tcg_store_template-media-library-updated', refreshMediaLibrary);
    return () => window.removeEventListener('tcg_store_template-media-library-updated', refreshMediaLibrary);
  }, []);

  const [scope, setScope] = useState('client');
  const [device, setDevice] = useState('desktop');
  const [runtime, setRuntime] = useState({ zones: {}, promotions: [], settings: {} });
  const [message, setMessage] = useState('');
  const [fullPreview, setFullPreview] = useState(false);
  const [builderTab, setBuilderTab] = useState('theme');

  useEffect(() => {
    api('/api/v1/cms/storefront-runtime?preview=true').then((r) => setRuntime(r.data || { zones: {}, promotions: [], settings: {} })).catch(() => {});
  }, []);

  function get(scopeName, key, fallback = '') {
    const prefix = scopeName === 'client' ? pKey(key) : aKey(key);
    const legacy = `appearance.${key}`;
    return settings[prefix] ?? settings[legacy] ?? fallback;
  }
  function set(scopeName, key, value) {
    const full = scopeName === 'client' ? pKey(key) : aKey(key);
    setSettings((x) => ({ ...x, [full]: String(value) }));
  }

  function applyTemplate(id) {
    const t = TEMPLATES[id];if (!t) return;
    setSettings((cur) => {
      const next = { ...cur, [pKey('template')]: id };
      Object.entries(t.values).forEach(([k, v]) => next[pKey(k)] = String(v));
      return next;
    });
    setMessage(`Template ${t.name} aplicado a la vista Cliente. Guarda para hacerlo permanente.`);
  }

  async function save() {
    const prefix = scope === 'client' ? 'public.appearance.' : 'admin.appearance.';
    const payload = Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith(prefix)));
    try {
      await api('/api/v1/content/settings', { method: 'PUT', body: JSON.stringify(payload) });
      if (scope === 'admin') {
        try {
          localStorage.setItem('Shiny_ADMIN_BRAND', JSON.stringify({
            name: get('admin', 'brand_name', brandText("GMX")),
            logoText: get('admin', 'logo_text', 'GMX'),
            descriptor: get('admin', 'brand_descriptor', 'LOCAL')
          }));
        /* SHINY_LOGIN_APPEARANCE_R63 */
        localStorage.setItem('SHINY_LOGIN_APPEARANCE_R55', JSON.stringify({
          design: get('admin', 'login_background_design', 'network4'),
          glow: get('admin', 'login_background_glow', 'violet'),
          mediaId: get('admin', 'login_background_media_id', ''),
          opacity: get('admin', 'login_background_opacity', '1'),
          fit: get('admin', 'login_background_fit', 'cover')
        }));

        } catch {}
        window.dispatchEvent(new Event('tcg_store_template-theme-changed'));
      }
      setMessage(scope === 'client' ? 'Tema del CLIENTE guardado.' : 'Tema de ADMINISTRACIÓN guardado.');
    } catch (e) {setMessage(e.message);}
  }

  const publicStyle = {
    '--p-primary': get('client', 'primary', '#111827'),
    '--p-secondary': get('client', 'secondary', '#f59e0b'),
    '--p-accent': get('client', 'accent', '#8b5cf6'),
    '--p-surface': get('client', 'surface', '#111827'),
    '--p-bg': get('client', 'background', '#090e1a'),
    '--p-text': get('client', 'text', '#f8fafc'),
    '--p-muted': get('client', 'muted', '#94a3b8'),
    '--p-radius': `${Number(get('client', 'radius', '18'))}px`,
    '--p-panel-opacity': get('client', 'panel_opacity', '0.88')
  };

  return <div className="dual-designer">
    {message ? <div className="message">{message}</div> : null}
    <div className="designer-toolbar">
      <div className="scope-switch">
        <button className={scope === 'client' ? 'active' : ''} onClick={() => setScope('client')}>🛍 Cliente / Tienda</button>
        <button className={scope === 'admin' ? 'active' : ''} onClick={() => setScope('admin')}>🛠 Administración</button>
      </div>
      <div className="device-switch">
        <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}>▱ Desktop</button>
        <button className={device === 'tablet' ? 'active' : ''} onClick={() => setDevice('tablet')}>▯ Tablet</button>
        <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}>▯ Móvil</button>
      </div>
      <button onClick={save}>Guardar {scope === 'client' ? 'tienda' : 'admin'}</button>
    </div>

    {scope === 'client' ? <>
      <div className="store-builder-tabs">
        <button className={builderTab === 'theme' ? 'active' : ''} onClick={() => setBuilderTab('theme')}>🎨 Tema / Templates</button>
        <button className={builderTab === 'hero' ? 'active' : ''} onClick={() => setBuilderTab('hero')}>🎞 Slideshow / Hero</button>
      </div>

      {builderTab === 'theme' ? <>
        <div className="designer-layout designer-layout-theme">
          <ThemeForm title="Tema de la tienda" scope="client" get={get} set={set} media={liveMedia} />
          <StorePreview device={device} style={publicStyle} settings={settings} get={get} runtime={runtime} onOpenFull={() => setFullPreview(true)} />
        </div>
        <details className="template-section template-section-collapsed">
          <summary><span>Templates Arcade / TCG / Anime</span><small>Usar un estilo como punto de partida</small></summary>
          <div className="template-grid">
            {Object.entries(TEMPLATES).map(([id, t]) => <button key={id} className={`template-card ${t.premium ? 'premium-template' : ''} ${get('client', 'template') === id ? 'selected' : ''}`} onClick={() => applyTemplate(id)}>
              <div className="template-badges">{t.premium ? <span className="premium-badge">ARCADE / TCG</span> : null}{t.recommended ? <span className="recommended">RECOMENDADO</span> : null}</div>
              <strong>{t.name}</strong><small>{t.description}</small>
              <div className="template-swatches"><i style={{ background: t.values.background }} /><i style={{ background: t.values.primary }} /><i style={{ background: t.values.secondary }} /><i style={{ background: t.values.accent }} /></div>
            </button>)}
          </div>
        </details>
      </> : null}

      {builderTab === 'hero' ? <section className="hero-builder-wrap">
        <div className="designer-section-title"><div><h3>Slideshow / Hero</h3><p>Gestiona slides, imágenes, URLs, vigencia, autoplay y comportamiento responsive mientras observas el resultado.</p></div></div>
        <div className="hero-builder-grid">
          <BannerManager
            media={liveMedia}
            onMediaChanged={refreshMediaLibrary}
            onChanged={async () => {
              try {
                const r = await api('/api/v1/cms/storefront-runtime?preview=true');
                setRuntime(r.data || { zones: {}, promotions: [], settings: {} });
              } catch {}
            }} />

          <StorePreview device={device} style={publicStyle} settings={settings} get={get} runtime={runtime} heroOnly onOpenFull={() => setFullPreview(true)} />
        </div>
      </section> : null}

      {fullPreview ? <div className="fullscreen-preview-modal">
        <div className="fullscreen-preview-toolbar"><strong>Preview completo · {device}</strong><button onClick={() => setFullPreview(false)}>Cerrar ✕</button></div>
        <StorePreview device={device} style={publicStyle} settings={settings} get={get} runtime={runtime} full />
      </div> : null}
    </> : <>
      <div className="designer-layout">
        <ThemeForm title="Tema del administrador" scope="admin" get={get} set={set} media={liveMedia} />
        <AdminPreview device={device} get={get} />
      </div>
    </>}
  </div>;
}

function AuthenticatedMediaPreview({ mediaId, className = '', alt = '' }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    setSrc('');
    setFailed(false);
    if (!mediaId) return undefined;

    const token = localStorage.getItem('SHINY_AUTH_TOKEN') || localStorage.getItem('Shiny_AUTH_TOKEN') || '';
    fetch(`/api/v1/content/media/${encodeURIComponent(mediaId)}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        objectUrl = URL.createObjectURL(blob);
        if (alive) setSrc(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId]);

  if (failed) return <div className={`${className} authenticated-media-error`} aria-label={alt}>No se pudo cargar la vista previa.</div>;
  if (!src) return <div className={`${className} authenticated-media-loading`} aria-label={alt}><span /></div>;
  return <img src={src} className={className} alt={alt} />;
}

function ThemeForm({ title, scope, get, set, media }) {
  /* SHINY_LOGIN_CUSTOM_IMAGE_R63M */
  const [loginUploadBusy,setLoginUploadBusy]=useState(false);
  const [loginUploadMessage,setLoginUploadMessage]=useState('');

  async function uploadLoginBackground(file){
    if(!file)return;
    if(!String(file.type||'').startsWith('image/')){
      setLoginUploadMessage('Selecciona un archivo de imagen valido.');
      return;
    }
    if(file.size>20*1024*1024){
      setLoginUploadMessage('La imagen debe pesar maximo 20 MB.');
      return;
    }

    setLoginUploadBusy(true);
    setLoginUploadMessage('');
    try{
      const token=localStorage.getItem('SHINY_AUTH_TOKEN')||localStorage.getItem('Shiny_AUTH_TOKEN')||'';
      const response=await fetch('/api/v1/content/media/upload',{
        method:'POST',
        headers:{
          'Content-Type':'application/octet-stream',
          Authorization:`Bearer ${token}`,
          'X-SHINY-File-Name':encodeURIComponent(file.name),
          'X-SHINY-File-Type':file.type||'application/octet-stream',
          'X-SHINY-Category':'LOGIN_BACKGROUND'
        },
        body:file
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok || body.success===false){
        throw new Error(body.message||body.error||`HTTP ${response.status}`);
      }
      const mediaId=
        body.data?.id_media||
        body.data?.media?.id_media||
        body.data?.row?.id_media||
        body.id_media||
        '';
      if(!mediaId)throw new Error('La biblioteca multimedia no devolvio id_media.');

      set(scope,'login_background_media_id',String(mediaId));
      set(scope,'login_background_design','custom');
      setLoginUploadMessage('Imagen cargada. Guarda ADMIN para publicarla en el login.');
      window.dispatchEvent(new CustomEvent('tcg_store_template-media-library-updated'));
    }catch(error){
      setLoginUploadMessage(error?.message||'No fue posible subir la imagen.');
    }finally{
      setLoginUploadBusy(false);
    }
  }
  const client = scope === 'client';
  return <article className="contentmk-card theme-form">
    <h3>{title}</h3>
    <div className="contentmk-fields cols2">
      <label>Nombre de marca<input value={get(scope, 'brand_name', brandText("GMX"))} onChange={(e) => set(scope, 'brand_name', e.target.value)} /></label>
      <label>Texto/logo<input maxLength="12" value={get(scope, 'logo_text', client ? 'S' : 'GMX')} onChange={(e) => set(scope, 'logo_text', e.target.value)} /></label>
      {!client ? <>
        <label>Fondo del login
          <select value={get(scope, 'login_background_design', 'network4')} onChange={(e) => set(scope, 'login_background_design', e.target.value)}>
            <option value="network4">Diseno 4 - Red de conexiones</option>
            <option value="gradient">Gradiente limpio</option>
            <option value="solid">Fondo solido</option>
            <option value="custom">Imagen personalizada</option>
          </select>
        </label>
        <label>Resplandor del login
          <select value={get(scope, 'login_background_glow', 'violet')} onChange={(e) => set(scope, 'login_background_glow', e.target.value)}>
            <option value="violet">Violeta / azul</option>
            <option value="blue">Azul</option>
            <option value="soft">Suave</option>
          </select>
        </label>
        <label className="span2 shiny-login-custom-media-r63m">Imagen personalizada del login
          <select
            value={get(scope,'login_background_media_id','')}
            onChange={(e)=>{
              set(scope,'login_background_media_id',e.target.value);
              if(e.target.value)set(scope,'login_background_design','custom');
            }}>
            <option value="">Sin imagen personalizada</option>
            {(media||[])
              .filter((m)=>m.activo!==false && (m.tipo==='IMAGE'||String(m.mime_type||'').startsWith('image/')))
              .map((m)=><option key={m.id_media} value={m.id_media}>{m.nombre||m.nombre_archivo||m.id_media}</option>)}
          </select>

          <span className="shiny-login-upload-row-r63m">
            <label className="shiny-login-upload-button-r63m">
              {loginUploadBusy?'Subiendo...':'Seleccionar / subir imagen'}
              <input
                type="file"
                accept="image/*"
                disabled={loginUploadBusy}
                onChange={async(e)=>{
                  const file=e.target.files?.[0];
                  await uploadLoginBackground(file);
                  e.target.value='';
                }}
              />
            </label>
            <small>Recomendado 1920 x 1080 Â· JPG, PNG o WEBP Â· max. 20 MB.</small>
          </span>

          {get(scope,'login_background_media_id','') ?
            <div className="shiny-login-custom-preview-r63m">
              <AuthenticatedMediaPreview
                mediaId={get(scope,'login_background_media_id','')}
                className="shiny-login-custom-preview-image-r63m"
                alt="Vista previa del fondo del login"
              />
            </div> : null}

          {loginUploadMessage?<small className="shiny-login-upload-message-r63m">{loginUploadMessage}</small>:null}
        </label>

        <label>Opacidad imagen login
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={get(scope,'login_background_opacity','1')}
            onChange={(e)=>set(scope,'login_background_opacity',e.target.value)}
          />
          <span>{Math.round(Number(get(scope,'login_background_opacity','1'))*100)}%</span>
        </label>

        <label>Ajuste imagen login
          <select value={get(scope,'login_background_fit','cover')} onChange={(e)=>set(scope,'login_background_fit',e.target.value)}>
            <option value="cover">Cubrir pantalla</option>
            <option value="contain">Mostrar completa</option>
            <option value="fill">Estirar</option>
          </select>
        </label>
      </> : null}
      {!client ? <label>Descriptor del logo<input maxLength="16" value={get(scope, 'brand_descriptor', 'LOCAL')} onChange={(e) => set(scope, 'brand_descriptor', e.target.value.toUpperCase())} placeholder="LOCAL" /></label> : null}
      <label>Principal<input type="color" value={get(scope, 'primary', '#111827')} onChange={(e) => set(scope, 'primary', e.target.value)} /></label>
      {client ? <label>Secundario<input type="color" value={get(scope, 'secondary', '#f59e0b')} onChange={(e) => set(scope, 'secondary', e.target.value)} /></label> : null}
      {client ? <label>Acento<input type="color" value={get(scope, 'accent', '#8b5cf6')} onChange={(e) => set(scope, 'accent', e.target.value)} /></label> : null}
      <label>Superficie<input type="color" value={get(scope, 'surface', '#ffffff')} onChange={(e) => set(scope, 'surface', e.target.value)} /></label>
      <label>Fondo<input type="color" value={get(scope, 'background', '#f2f4f7')} onChange={(e) => set(scope, 'background', e.target.value)} /></label>
      {client ? <label>Texto<input type="color" value={get(scope, 'text', '#f8fafc')} onChange={(e) => set(scope, 'text', e.target.value)} /></label> : null}
      <label className="span2 background-media-field">Fondo de la {client ? 'tienda' : 'administración'}
        <select value={get(scope, 'background_media_id', '')} onChange={(e) => set(scope, 'background_media_id', e.target.value)}>
          <option value="">Sin imagen</option>{media.filter((m) => m.activo !== false).map((m) => <option key={m.id_media} value={m.id_media}>{m.nombre || m.nombre_archivo}</option>)}
        </select>
        {get(scope, 'background_media_id', '') ? <div className="background-live-preview">
          <AuthenticatedMediaPreview mediaId={get(scope, 'background_media_id', '')} className="background-live-preview-image" alt="Vista previa del fondo seleccionado" />
          <div><strong>Fondo seleccionado</strong><small>La previsualización se actualiza inmediatamente.</small></div>
        </div> : <div className="background-empty-preview">Selecciona una imagen de la biblioteca para usarla como fondo.</div>}
      </label>
      <label>Radio<input type="range" min="4" max="30" value={get(scope, 'radius', client ? '18' : '14')} onChange={(e) => set(scope, 'radius', e.target.value)} /><span>{get(scope, 'radius', client ? '18' : '14')} px</span></label>
      <label>Opacidad paneles<input type="range" min=".55" max="1" step=".05" value={get(scope, 'panel_opacity', client ? '.88' : '.90')} onChange={(e) => set(scope, 'panel_opacity', e.target.value)} /><span>{Math.round(Number(get(scope, 'panel_opacity', client ? '.88' : '.90')) * 100)}%</span></label>
      <label>Opacidad background<input type="range" min="0" max="1" step=".05" value={get(scope, 'background_opacity', client ? '.28' : '.18')} onChange={(e) => set(scope, 'background_opacity', e.target.value)} /><span>{Math.round(Number(get(scope, 'background_opacity', client ? '.28' : '.18')) * 100)}%</span></label>
      <label>Overlay<input type="range" min="0" max=".85" step=".05" value={get(scope, 'background_overlay', client ? '.38' : '.30')} onChange={(e) => set(scope, 'background_overlay', e.target.value)} /><span>{Math.round(Number(get(scope, 'background_overlay', client ? '.38' : '.30')) * 100)}%</span></label>
      {client ? <label>Altura Hero<input type="range" min="320" max="720" step="20" value={get(scope, 'hero_height', '520')} onChange={(e) => set(scope, 'hero_height', e.target.value)} /><span>{get(scope, 'hero_height', '520')} px</span></label> : null}
      {client ? <label>Estilo header<select value={get(scope, 'header_style', 'floating')} onChange={(e) => set(scope, 'header_style', e.target.value)}><option value="floating">Floating</option><option value="solid">Sólido</option><option value="transparent">Transparente</option></select></label> : null}
      {client ? <label>Tarjetas<select value={get(scope, 'card_style', 'glass')} onChange={(e) => set(scope, 'card_style', e.target.value)}><option value="glass">Glass</option><option value="bordered">Bordeadas</option><option value="soft">Soft</option></select></label> : null}
    </div>
  </article>;
}

function StorePreview({ device, style, get, runtime, heroOnly = false, onOpenFull = () => {}, full = false }) {
  const zones = runtime?.zones || {};
  const promos = runtime?.promotions || [];
  const width = full ? '100%' : device === 'desktop' ? 1180 : device === 'tablet' ? 760 : 390;
  const bgId = get('client', 'background_media_id', '');
  const showFeatured = String(runtime?.settings?.['public.home.featured_banner_enabled'] ?? 'true') === 'true';
  const showMid = String(runtime?.settings?.['public.home.mid_banner_enabled'] ?? 'true') === 'true';

  return <article className={`preview-shell ${full ? 'full' : ''}`}>
    <div className="preview-label"><strong>PREVIEW CLIENTE</strong><div><span>{device.toUpperCase()} · {full ? 'FULL' : `${width}px`}</span>{!full ? <button className="preview-popout" onClick={onOpenFull}>⛶ Pantalla completa</button> : null}</div></div>
    <div className={`store-preview device-${device} fx-${get('client', 'visual_fx', 'none')}`} style={{ ...style, maxWidth: width }}>
      {bgId ? <AuthenticatedMediaPreview mediaId={bgId} className="store-background" alt="Fondo de la tienda" /> : null}
      <div className="store-overlay" style={{ opacity: Number(get('client', 'background_overlay', '.38')) }} />

      {!heroOnly ? <header className={`store-header ${get('client', 'header_style', 'floating')}`}>
        <div className="store-brand"><b>{get('client', 'logo_text', 'G')}</b><strong>{get('client', 'brand_name', brandText("GMX"))}</strong></div>
        <div className="store-search">🔎 Buscar cartas, productos, sets...</div>
        <nav><span>Magic</span><span>Yu-Gi-Oh!</span><span>Pokémon</span><span>One Piece</span><span>Más</span><span>👤</span><span>🛒 3</span></nav>
      </header> : null}

      {!heroOnly && promos.length && String(runtime?.settings?.['public.promo_bar.enabled'] ?? 'true') === 'true' ?
      <div className="promo-strip">🏷 {promos[0].nombre} {promos[0].codigo ? `· Código ${promos[0].codigo}` : ''}</div> : null}

      <main className="store-main-flow">
        <PreviewCarousel
          device={device}
          banners={zones.HOME_HERO || []}
          runtime={runtime}
          variant="hero"
          fallbackTitle="Tu tienda geek y TCG"
          fallbackSubtitle="Explora singles, productos sellados, accesorios y promociones." />


        {!heroOnly && showFeatured ? <PreviewCarousel
          device={device}
          banners={zones.HOME_FEATURED_BANNER || []}
          runtime={runtime}
          variant="wide"
          fallbackTitle=""
          fallbackSubtitle=""
          hideWhenEmpty /> :
        null}

        {!heroOnly ? <section className="store-section compact-section">
          <div className="store-title"><h2>Best Sellers</h2><span>Ver todos →</span></div>
          <div className="product-row">{[1, 2, 3, 4].map((x) => <div className="product-mock" key={x}><div className="card-art">TCG</div><b>Carta destacada</b><small>Near Mint</small><strong>$299.00</strong></div>)}</div>
        </section> : null}

        {!heroOnly && showMid ? <PreviewCarousel
          device={device}
          banners={zones.HOME_MID_BANNER || []}
          runtime={runtime}
          variant="wide"
          hideWhenEmpty /> :
        null}

        {!heroOnly ? <section className="store-section compact-section">
          <div className="store-title"><h2>Explora por TCG</h2><span>Catálogo completo →</span></div>
          <div className="category-row"><div>⚡ Pokémon</div><div>🔥 Magic</div><div>🐉 Yu-Gi-Oh!</div><div>🏴‍☠️ One Piece</div></div>
        </section> : null}
      </main>
    </div>
  </article>;
}

function PreviewCarousel({ device, banners = [], runtime, variant = 'hero', fallbackTitle = '', fallbackSubtitle = '', hideWhenEmpty = false }) {
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = banners.length ? banners[Math.min(slide, banners.length - 1)] : null;

  useEffect(() => {if (slide >= banners.length && banners.length) setSlide(0);}, [banners.length, slide]);

  const globalAutoplay = String(runtime?.settings?.['public.carousel.autoplay'] ?? 'true') === 'true';
  const seconds = Math.max(2, Number(current?.intervalo_segundos || runtime?.settings?.['public.carousel.interval_seconds'] || 6));
  useEffect(() => {
    if (banners.length < 2 || !globalAutoplay || current?.autoplay === false || paused) return;
    const id = setInterval(() => setSlide((x) => (x + 1) % banners.length), seconds * 1000);
    return () => clearInterval(id);
  }, [banners.length, globalAutoplay, current?.autoplay, paused, seconds]);

  if (hideWhenEmpty && !banners.length) return null;

  const defaultHeight = variant === 'hero' ?
  Number(device === 'mobile' ? runtime?.settings?.['public.hero.height_mobile'] || 320 : device === 'tablet' ? runtime?.settings?.['public.hero.height_tablet'] || 360 : runtime?.settings?.['public.hero.height_desktop'] || 430) :
  Number(device === 'mobile' ? runtime?.settings?.['public.home.featured_banner_height_mobile'] || 180 : device === 'tablet' ? runtime?.settings?.['public.home.featured_banner_height_tablet'] || 230 : runtime?.settings?.['public.home.featured_banner_height_desktop'] || 270);

  const ownHeight = Number(device === 'mobile' ? current?.altura_mobile || 0 : device === 'tablet' ? current?.altura_tablet || 0 : current?.altura_desktop || 0);
  const height = ownHeight || defaultHeight;
  const next = () => banners.length && setSlide((x) => (x + 1) % banners.length);
  const prev = () => banners.length && setSlide((x) => (x - 1 + banners.length) % banners.length);

  return <section className={`preview-carousel preview-carousel-${variant}`} style={{ height }} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
    <BannerVisual banner={current} device={device} />
    <div className="hero-dark" style={{ opacity: Number(current?.overlay_opacity ?? (variant === 'hero' ? .28 : .12)) }} />
    {variant === 'hero' || current?.titulo || current?.subtitulo ? <div className={`hero-copy ${variant === 'wide' ? 'wide-copy' : ''} align-${String(current?.text_align || 'LEFT').toLowerCase()}`}>
      {variant === 'hero' ? <small>COLECCIONA · JUEGA · DISFRUTA</small> : null}
      {current?.titulo || fallbackTitle ? <h1>{current?.titulo || fallbackTitle}</h1> : null}
      {current?.subtitulo || fallbackSubtitle ? <p>{current?.subtitulo || fallbackSubtitle}</p> : null}
      {current?.texto_cta || variant === 'hero' ? <div className="hero-actions"><button>{current?.texto_cta || 'Explorar catálogo'}</button>{variant === 'hero' ? <button className="ghost">Buscar cartas TCG</button> : null}</div> : null}
    </div> : null}

    {banners.length > 1 && current?.mostrar_flechas !== false ? <>
      <button className="carousel-arrow prev" onClick={prev}>‹</button>
      <button className="carousel-arrow next" onClick={next}>›</button>
    </> : null}

    {banners.length > 1 && current?.mostrar_indicadores !== false ? <div className="carousel-dots">
      {banners.map((_, idx) => <button key={idx} className={idx === slide ? 'active' : ''} onClick={() => setSlide(idx)} />)}
    </div> : null}
  </section>;
}

function BannerVisual({ banner, device }) {
  return <SlideshowMedia banner={banner} device={device} />;
}

function AdminPreview({ device, get }) {
  const width = device === 'desktop' ? 1100 : device === 'tablet' ? 760 : 390;
  const bgId = get('admin', 'background_media_id', '');
  return <article className="preview-shell"><div className="preview-label"><strong>PREVIEW ADMIN</strong><span>{device.toUpperCase()}</span></div>
    <div className={`admin-preview device-${device}`} style={{ maxWidth: width, background: get('admin', 'background', '#f2f4f7'), borderRadius: Number(get('admin', 'radius', '14')) }}>
      {bgId ? <AuthenticatedMediaPreview mediaId={bgId} className="admin-preview-background" alt="Fondo del administrador" /> : null}
      <div className="admin-preview-overlay" style={{ opacity: Number(get('admin', 'background_overlay', '.30')) }} />
      <aside style={{ background: get('admin', 'primary', '#101828') }}><div className="preview-dynamic-brand"><strong>{get('admin', 'brand_name', brandText("GMX"))}</strong><small>{get('admin', 'brand_descriptor', 'LOCAL')}</small></div><span>Dashboard</span><span>Productos</span><span>Pedidos</span><span>TCG</span></aside>
      <main><small>{brandText("GMX ADMIN")}</small><h2>Dashboard</h2><div className="admin-metrics"><div>Productos<br /><b>128</b></div><div>Pedidos<br /><b>37</b></div></div><div className="admin-table-mock">Vista del servidor / backoffice</div></main>
    </div>
  </article>;
}
