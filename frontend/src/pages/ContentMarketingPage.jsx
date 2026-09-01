import { brandText } from "../config/brand.js";import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { authenticatedDownload } from '../utils/download.js';
import DualAppearanceDesigner from '../components/DualAppearanceDesigner.jsx';
import SecureMedia from '../components/SecureMedia.jsx';
import '../phase_shiny_exact_views_r23.css';
import '../content_marketing_option3.css';

import useAdminBrand from '../hooks/useAdminBrand.js';
const DEFAULT_APPEARANCE = {
  'appearance.brand_name': brandText("GMX"), 'appearance.logo_text': 'G', 'appearance.primary': '#101828',
  'appearance.surface': '#ffffff', 'appearance.background': '#f2f4f7', 'appearance.radius': '14',
  'appearance.density': 'comfortable', 'appearance.sidebar_compact': 'false'
};

function AuthenticatedMediaImage({ mediaId, className = '', alt = '' }) {
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

  if (failed) return <div className={`${className} authenticated-media-error`} aria-label={alt}>Vista no disponible</div>;
  if (!src) return <div className={`${className} authenticated-media-loading`} aria-label={alt}><span /></div>;
  return <img src={src} className={className} alt={alt} />;
}

export default function ContentMarketingPage() {
  // GMX_CONTENT_ADMIN_BRAND_R1
  const adminBrand = useAdminBrand();
  const [tab, setTab] = useState('appearance');
  const [settings, setSettings] = useState({ ...DEFAULT_APPEARANCE });
  const [media, setMedia] = useState([]);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [impact, setImpact] = useState(null);
  const [checkingImpact, setCheckingImpact] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [urlText, setUrlText] = useState('');
  const [importingUrls, setImportingUrls] = useState(false);
  const uploadInputRef = useRef(null);

  async function load() {
    const settled = await Promise.allSettled([
    api('/api/v1/content/settings'),
    api('/api/v1/content/media')]
    );
    if (settled[0].status === 'fulfilled') {
      const obj = Object.fromEntries((settled[0].value.data || []).map((x) => [x.parametro, x.valor]));
      const next = { ...DEFAULT_APPEARANCE, ...obj };
      setSettings(next);applyAppearance(next);
    }
    if (settled[1].status === 'fulfilled') setMedia(settled[1].value.data || []);
    const errors = settled.filter((x) => x.status === 'rejected').map((x) => x.reason?.message).filter(Boolean);
    if (errors.length) setMessage(errors.join(' · '));
  }
  useEffect(() => {load();}, []);

  function applyAppearance(v) {
    const root = document.documentElement;
    root.style.setProperty('--tcg_store_template-primary', v['appearance.primary'] || '#101828');
    root.style.setProperty('--tcg_store_template-surface', v['appearance.surface'] || '#ffffff');
    root.style.setProperty('--tcg_store_template-background', v['appearance.background'] || '#f2f4f7');
    root.style.setProperty('--tcg_store_template-radius', `${Number(v['appearance.radius'] || 14)}px`);
    document.body.dataset.tcg_store_templateDensity = v['appearance.density'] || 'comfortable';
  }

  async function uploadMedia(file, category = 'GENERAL') {
    if (!file) return;
    setUploading(true);
    try {
      const token = localStorage.getItem('SHINY_AUTH_TOKEN') || localStorage.getItem('Shiny_AUTH_TOKEN') || '';
      const r = await fetch('/api/v1/content/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${token}`,
          'X-SHINY-File-Name': encodeURIComponent(file.name),
          'X-SHINY-File-Type': file.type || 'application/octet-stream',
          'X-SHINY-Category': encodeURIComponent(category)
        }, body: file
      });
      const b = await r.json();
      if (!r.ok || b.success === false) throw new Error(b.message || b.error || `HTTP ${r.status}`);
      setMessage(b.data?.duplicate ? brandText(
        `"${file.name}" ya existía en Multimedia. Shiny evitó crear un duplicado.`) :
      `Multimedia cargada: ${file.name}`);
      await load();
      window.dispatchEvent(new CustomEvent('tcg_store_template-media-library-updated', { detail: { id_media: b.data?.id_media } }));
    } catch (e) {setMessage(e.message);} finally {setUploading(false);}
  }

  async function toggleMedia(m) {
    try {
      await api(`/api/v1/content/media/${m.id_media}/active`, { method: 'POST', body: JSON.stringify({ active: m.activo === false }) });
      await load();
    } catch (e) {setMessage(e.message);}
  }

  async function requestDelete(m) {
    setDeleteTarget(m);setImpact(null);setCheckingImpact(true);
    try {
      const r = await api(`/api/v1/content/media/${m.id_media}/impact`);
      setImpact(r.data || { references: [], totalReferences: 0 });
    } catch (e) {
      setImpact({ error: e.message, references: [], totalReferences: 0 });
    } finally {setCheckingImpact(false);}
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const label = deleteTarget.nombre || deleteTarget.nombre_archivo || deleteTarget.id_media;
    try {
      const r = await api(`/api/v1/content/media/${deleteTarget.id_media}?detach=true`, { method: 'DELETE' });
      const detached = Number(r.data?.detachedReferences || 0);
      setMessage(detached ?
      `Multimedia eliminada: ${label}. También se retiró de ${detached} configuración(es) donde estaba en uso.` :
      `Multimedia eliminada: ${label}.`);
      setDeleteTarget(null);setImpact(null);
      await load();
      window.dispatchEvent(new Event('tcg_store_template-content-changed'));
    } catch (e) {setMessage(e.message);} finally
    {setDeleting(false);}
  }

  async function openMedia(m) {
    try {await authenticatedDownload(`/api/v1/content/media/${m.id_media}/file`, m.nombre_archivo || m.nombre || 'archivo');}
    catch (e) {setMessage(e.message);}
  }

  const duplicateHashes = useMemo(() => {
    const count = {};
    media.forEach((m) => {if (m.hash) count[m.hash] = (count[m.hash] || 0) + 1;});
    return count;
  }, [media]);

  const contentOverview = useMemo(() => {
    const active = media.filter((item) => item.activo !== false).length;
    const images = media.filter((item) => item.tipo === 'IMAGE' || String(item.mime_type || '').startsWith('image/')).length;
    const hero = media.filter((item) => ['HERO', 'SLIDESHOW'].includes(String(item.categoria || '').toUpperCase())).length;
    return { active, images, hero };
  }, [media]);


  async function uploadMany(files) {
    const list = [...(files || [])];if (!list.length) return;
    setUploading(true);let ok = 0,failed = 0;const errors = [];
    for (const file of list) {
      try {
        const token = localStorage.getItem('SHINY_AUTH_TOKEN') || localStorage.getItem('Shiny_AUTH_TOKEN') || '';
        const r = await fetch('/api/v1/content/media/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Authorization': `Bearer ${token}`,
            'X-SHINY-File-Name': encodeURIComponent(file.name),
            'X-SHINY-File-Type': file.type || 'application/octet-stream', 'X-SHINY-Category': 'GENERAL' },
          body: file
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok || b.success === false) throw new Error(b.message || b.error || `HTTP ${r.status}`);
        ok++;
      } catch (e) {failed++;errors.push(`${file.name}: ${e.message}`);}
    }
    setUploading(false);await load();
    setMessage(failed ? `${ok} archivo(s) cargado(s) · ${failed} con error · ${errors[0] || 'Error de carga'}` : `${ok} archivo(s) cargado(s).`);
    window.dispatchEvent(new CustomEvent('tcg_store_template-media-library-updated'));
  }

  async function importUrls() {
    const urls = urlText.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
    if (!urls.length) return setMessage('Pega al menos una URL de imagen.');
    setImportingUrls(true);
    try {
      const r = await api('/api/v1/content/media/import-urls', {
        method: 'POST', body: JSON.stringify({ urls, category: 'GENERAL' })
      });
      const rows = r.data || [],ok = rows.filter((x) => x.success).length,fail = rows.length - ok;
      setMessage(`${ok} imagen(es) descargada(s) y guardada(s) localmente${fail ? ` · ${fail} con error` : ''}.`);
      setUrlText('');await load();
      window.dispatchEvent(new CustomEvent('tcg_store_template-media-library-updated'));
    } catch (e) {setMessage(e.message);} finally
    {setImportingUrls(false);}
  }

  return <div className="contentmk-page r23-view r23-content">
    <header className="contentmk-hero">
      <div>
        <div className="eyebrow">CONTENIDO · MARKETING</div>
        <h1>{adminBrand.name} Content Center</h1>
        <p>Apariencia de la tienda/backoffice y biblioteca multimedia. Hero y slideshow se administran dentro de Apariencia.</p>
      </div>
      <div className="contentmk-kpis"><span><b>{media.length}</b> multimedia</span></div>
    </header>

    <section className="contentmk-overview-kpis" aria-label="Resumen de contenido y marca">
      <article><span>Marca activa</span><strong>{adminBrand.name}</strong><small>Identidad de tienda y administración</small></article>
      <article><span>Recursos activos</span><strong>{contentOverview.active}</strong><small>de {media.length} archivos</small></article>
      <article><span>Imágenes</span><strong>{contentOverview.images}</strong><small>Biblioteca visual disponible</small></article>
      <article className={contentOverview.hero ? '' : 'attention'}><span>Hero / slideshow</span><strong>{contentOverview.hero}</strong><small>{contentOverview.hero ? 'Recursos listos' : 'Conviene agregar una portada'}</small></article>
    </section>

    {message ? <div className="message">{message}</div> : null}

    <nav className="contentmk-nav contentmk-nav-clean">
      {[
      ['appearance', '🎨', 'Apariencia'],
      ['media', '🖼', 'Multimedia']].
      map(([id, icon, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}
    </nav>

    {tab === 'appearance' ? <section className="contentmk-section">
      <div className="section-title">
        <div><h2>Apariencia</h2><p>Diseña la tienda del cliente y el backoffice. Slideshow / Hero está integrado en Cliente / Tienda.</p></div>
      </div>
      <DualAppearanceDesigner settings={settings} setSettings={setSettings} media={media} />
    </section> : null}

    {tab === 'media' ? <section className="contentmk-section">
      <div className="section-title">
        <div><h2>Biblioteca multimedia</h2><p>Repositorio único de imágenes, videos y archivos utilizados por la apariencia del portal.</p></div>
        <div className="media-upload-control">
          <input ref={uploadInputRef} className="contentmk-file-input" type="file" accept="image/*" multiple disabled={uploading}
            onChange={async (e) => { const files = e.target.files; await uploadMany(files); e.target.value = ''; }} />
          <button className="upload-button" type="button" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
            {uploading ? 'Subiendo...' : '＋ Subir imágenes'}
          </button>
        </div>
      </div>
      <div className="media-library-toolbar">
        <div><strong>Biblioteca</strong><span>{media.length} archivo(s)</span></div>
        <div className="media-library-hint">Selecciona una miniatura para abrirla · administra estado y eliminación desde cada tarjeta.</div>
      </div>
      <details className="media-import-panel media-import-collapsible">
        <summary><div><h3>Importar imágenes desde URL</h3><p>Descarga recursos externos y guárdalos localmente en la biblioteca.</p></div><span>＋ Importar URL</span></summary>
        <div className="media-import-body">
        <div><h3>Importar imágenes desde URL</h3>
          <p>{brandText("Pega una o varias URLs, una por línea. GMX las descarga y guarda localmente, por lo que el portal deja de depender del servidor externo.")}</p></div>
        <textarea rows="5" value={urlText} onChange={(e) => setUrlText(e.target.value)}
        placeholder={"https://sitio.com/imagen1.jpg\nhttps://sitio.com/imagen2.webp"} />
        <div className="media-import-actions">
          <span>Máximo 100 URLs · 20 MB por imagen.</span>
          <button disabled={importingUrls || !urlText.trim()} onClick={importUrls}>
            {importingUrls ? 'Descargando…' : 'Descargar y guardar localmente'}
          </button>
        </div>
        </div>
      </details>
      <div className="media-grid">{media.map((m) => {
          const duplicate = !!m.hash && duplicateHashes[m.hash] > 1;
          return <article className={`media-card media-card-preview ${m.activo === false ? 'inactive' : ''}`} key={m.row_id}>
          <button className="media-thumbnail" type="button" onClick={() => openMedia(m)} title={`Abrir ${m.nombre || m.nombre_archivo}`}>
            {m.tipo === 'IMAGE' || String(m.mime_type || '').startsWith('image/') ?
              <AuthenticatedMediaImage
                mediaId={m.id_media}
                className="media-thumbnail-image"
                alt={m.nombre || m.nombre_archivo || 'Imagen multimedia'} /> :

              <div className="media-thumbnail-fallback">{m.tipo === 'VIDEO' ? '🎬' : '📄'}</div>}
            <span className="media-thumbnail-hover">Vista previa</span>
          </button>
          <div className="media-card-info">
            <strong>{m.nombre || m.nombre_archivo}</strong>
            <span>{m.categoria || 'GENERAL'} · {formatBytes(m.tamano_bytes)}</span>
            <small>{m.mime_type}</small>
            {m.url_origen ? <small className="media-origin-note" title={m.url_origen}>Importada desde URL · guardada localmente</small> : null}
            {duplicate ? <small className="media-duplicate-note">Registro duplicado detectado · puedes eliminar el sobrante de forma segura</small> : null}
          </div>
          <div className="row-actions">
            <button className="secondary compact" onClick={() => openMedia(m)}>Abrir</button>
            <button className="secondary compact" onClick={() => toggleMedia(m)}>{m.activo === false ? 'Activar' : 'Desactivar'}</button>
            <button className="danger compact" onClick={() => requestDelete(m)}>Eliminar</button>
          </div>
        </article>;
        })}
      {!media.length ? <div className="empty-box">La biblioteca está vacía.</div> : null}</div>
    </section> : null}

    {deleteTarget ? <div className="tcg_store_template-confirm-backdrop" role="presentation">
      <div className="tcg_store_template-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-media-title">
        <div className="tcg_store_template-confirm-icon">!</div>
        <div>
          <div className="eyebrow danger-text">ELIMINACIÓN PERMANENTE</div>
          <h2 id="delete-media-title">¿Eliminar multimedia?</h2>
          <p><b>{deleteTarget.nombre || deleteTarget.nombre_archivo || deleteTarget.id_media}</b> se eliminará permanentemente.</p>

          {checkingImpact ? <div className="impact-loading"><span className="mini-spinner" /> Revisando dónde se utiliza…</div> : null}
          {!checkingImpact && impact?.error ? <div className="impact-warning">{impact.error}</div> : null}
          {!checkingImpact && !impact?.error && Number(impact?.totalReferences || 0) > 0 ? <div className="impact-warning">
            <strong>Actualmente está en uso en {impact.totalReferences} referencia(s):</strong>
            <ul>{(impact.references || []).map((x, i) => <li key={`${x.source}-${x.reference}-${i}`}>{x.label}</li>)}</ul>
            <p>{brandText("Si continúas, GMX retirará automáticamente el archivo de estas configuraciones y después lo eliminará.")}</p>
          </div> : null}
          {!checkingImpact && !impact?.error && Number(impact?.totalReferences || 0) === 0 ? <div className="impact-safe">No hay configuraciones activas que dependan de este archivo.</div> : null}

          <div className="tcg_store_template-confirm-actions">
            <button className="secondary" disabled={deleting} onClick={() => {setDeleteTarget(null);setImpact(null);}}>Cancelar</button>
            <button className="danger" disabled={checkingImpact || deleting || !!impact?.error} onClick={confirmDelete}>
              {deleting ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
        </div>
      </div>
    </div> : null}
  </div>;
}

function formatBytes(v) {
  const n = Number(v || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
