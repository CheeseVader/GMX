import { brandText } from "../config/brand.js";import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

const blank = {
  nombre: '', zona: 'HOME_HERO', tipo: 'CAMPAIGN', titulo: '', subtitulo: '', texto_cta: '', ruta_cta: '',
  id_media_desktop: '', id_media_mobile: '', fecha_inicio: '', fecha_fin: '', prioridad: 100, exclusivo: false,
  activo: true, publicado: false, overlay_opacity: 0.20, text_align: 'LEFT', notas: '',
  media_source: 'LIBRARY', url_desktop: '', url_mobile: '', object_fit: 'cover', object_position: 'center center',
  altura_desktop: 430, altura_tablet: 360, altura_mobile: 320,
  mostrar_flechas: true, mostrar_indicadores: true, autoplay: true, intervalo_segundos: 6, pausa_hover: true, transicion: 'FADE', permanente: false, fallback_principal: false
};

const CTA_ACTION_OPTIONS = [
{ id: '', label: 'Sin botón', text: '', route: '' },
{ id: 'CATALOGO', label: 'Explorar catálogo', text: 'Explorar catálogo', route: '/catalogo' },
{ id: 'PRODUCTOS', label: 'Ver productos', text: 'Ver productos', route: '/productos' },
{ id: 'TCG', label: 'Ver cartas TCG', text: 'Ver cartas TCG', route: '/tcg' },
{ id: 'PROMOCIONES', label: 'Ver promociones', text: 'Ver promociones', route: '/promociones' },
{ id: 'NOVEDADES', label: 'Ver novedades', text: 'Ver novedades', route: '/novedades' },
{ id: 'PREVENTAS', label: 'Ver preventas', text: 'Ver preventas', route: '/preventas' },
{ id: 'BUYLIST', label: 'Vender cartas / Buylist', text: 'Vender cartas', route: '/buylist' },
{ id: 'CUENTA', label: 'Ir a mi cuenta', text: 'Mi cuenta', route: '/cuenta' },
{ id: 'CARRITO', label: 'Ver carrito', text: 'Ver carrito', route: '/carrito' }];


function ctaActionId(form) {
  const found = CTA_ACTION_OPTIONS.find((x) => x.text === (form.texto_cta || '') && x.route === (form.ruta_cta || ''));
  if (found) return found.id;
  const byRoute = CTA_ACTION_OPTIONS.find((x) => x.route === (form.ruta_cta || ''));
  return byRoute?.id || '';
}



function stateOf(b) {
  if (!b.activo) return 'INACTIVO';
  if (!b.publicado) return 'BORRADOR';
  const now = Date.now(),start = b.fecha_inicio ? new Date(b.fecha_inicio).getTime() : null,end = b.fecha_fin ? new Date(b.fecha_fin).getTime() : null;
  if (start && now < start) return 'PROGRAMADO';
  if (end && now > end) return 'VENCIDO';
  return 'PUBLICADO';
}

export default function BannerManager({ media = [], onChanged = () => {}, onMediaChanged = () => {} }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ...blank });
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');

  async function load() {
    try {const r = await api('/api/v1/cms/banners');setRows(r.data || []);}
    catch (e) {setMessage(e.message);}
  }
  useEffect(() => {load();}, []);

  function edit(b) {
    setEditing(b.row_id);
    const selectedMedia = b.id_media_desktop || b.id_media_mobile || '';
    setForm({ ...blank, ...b,
      id_media_desktop: selectedMedia,
      id_media_mobile: selectedMedia,
      media_source: 'LIBRARY',
      url_desktop: '',
      url_mobile: '',
      permanente: b.permanente === true || !b.fecha_inicio && !b.fecha_fin,
      fecha_inicio: b.fecha_inicio ? String(b.fecha_inicio).slice(0, 16) : '',
      fecha_fin: b.fecha_fin ? String(b.fecha_fin).slice(0, 16) : ''
    });
  }


  function clearImage() {
    setForm((x) => ({ ...x, id_media_desktop: '', id_media_mobile: '', media_source: 'LIBRARY', url_desktop: '', url_mobile: '' }));
  }

  async function save() {
    try {
      const path = editing ? `/api/v1/cms/banners/${editing}` : '/api/v1/cms/banners';
      const selectedMedia = form.id_media_desktop || '';
      const payload = {
        ...form,
        media_source: 'LIBRARY',
        id_media_desktop: selectedMedia,
        id_media_mobile: selectedMedia,
        url_desktop: '',
        url_mobile: '',
        // Responsive técnico automático: Marketing no necesita modificarlo.
        object_fit: 'cover',
        altura_desktop: 430,
        altura_tablet: 360,
        altura_mobile: 320
      };
      await api(path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setMessage(editing ? 'Slide del slideshow actualizado.' : 'Slide creado y agregado al slideshow.');
      setEditing(null);setForm({ ...blank });await load();await onChanged();
    } catch (e) {setMessage(e.message);}
  }

  async function deleteSlide(item) {
    const label = item.nombre || item.titulo || item.id_banner || 'slide';
    const principal = item.fallback_principal === true || String(item.tipo || '').toUpperCase() === 'MAIN';
    const question = principal ?
    `¿Eliminar el slide PRINCIPAL "${label}"?\n\nSolo será posible si existe otro principal/fallback activo en la misma zona.` :
    `¿Eliminar definitivamente "${label}"?\n\nLa imagen de Multimedia no se eliminará.`;
    if (!window.confirm(question)) return;

    try {
      await api(`/api/v1/cms/banners/${item.row_id}`, { method: 'DELETE' });
      setMessage(`Slide eliminado: ${label}`);
      if (editing === item.row_id) {setEditing(null);setForm({ ...blank });}
      await load();
      await onChanged();
    } catch (e) {
      if (String(e.message || '') === 'CANNOT_DELETE_LAST_FALLBACK') {
        setMessage('No puedes eliminar el único principal/fallback de esta zona. Designa otro primero.');
      } else setMessage(e.message);
    }
  }

  async function quickToggle(b, key) {
    try {
      await api(`/api/v1/cms/banners/${b.row_id}`, { method: 'PUT', body: JSON.stringify({ ...b, [key]: !b[key] }) });
      await load();await onChanged();
    } catch (e) {setMessage(e.message);}
  }

  return <div className="cms-banner-stack">
    {message ? <div className="message">{message}</div> : null}
    <article className="contentmk-card hero-editor-card">
      <div className="hero-editor-title"><div><h3>{editing ? 'Editar slide' : 'Nuevo slide del Slideshow'}</h3><p>{brandText("Selecciona una imagen de Multimedia. GMX utilizará la misma imagen en web, desktop, tablet y móvil.")}</p></div>{editing ? <button className="secondary compact" onClick={() => {setEditing(null);setForm({ ...blank });}}>Nuevo</button> : null}</div>

      <div className="contentmk-fields cols2">
        <label className="span2">Nombre interno (opcional)<input placeholder="Se genera automáticamente si lo dejas vacío" value={form.nombre} onChange={(e) => setForm((x) => ({ ...x, nombre: e.target.value }))} /></label>
<div className="span2 shiny-simple-slide-image" data-patch="SLIDESHOW_SIMPLE_IMAGE_PICKER_R3">
  <label>Imagen del slide
    <select
              value={form.id_media_desktop || ''}
              onChange={(e) => setForm((x) => ({
                ...x,
                id_media_desktop: e.target.value,
                id_media_mobile: e.target.value,
                media_source: 'LIBRARY',
                url_desktop: '',
                url_mobile: ''
              }))}>
              
      <option value="">Selecciona una imagen</option>
      {media.
              filter((m) => m.activo !== false && (m.tipo === 'IMAGE' || String(m.mime_type || '').startsWith('image/'))).
              map((m) => <option key={m.id_media} value={m.id_media}>{m.nombre || m.nombre_archivo}</option>)}
    </select>
  </label>

  <div className="shiny-simple-slide-image-actions">
    <span>Selecciona una imagen de la Biblioteca Multimedia.</span>
    {form.id_media_desktop ?
            <button type="button" className="secondary compact" onClick={clearImage}>Quitar imagen</button> :
            null}
  </div>
</div>
        
        <div className="slideshow-auto-responsive-note">
          <b>Responsive automático</b>
          <span>{brandText("GMX adapta la altura y usa recorte tipo cover automáticamente en desktop, tablet y móvil.")}</span>
        </div>

        <label className="check-field"><input type="checkbox" checked={form.publicado} onChange={(e) => setForm((x) => ({ ...x, publicado: e.target.checked }))} /><span>Mostrar en tienda</span></label>
        
      </div>
      <div className="row-actions"><button onClick={save}>{editing ? 'Guardar cambios' : 'Agregar al carrusel'}</button></div>
    </article>

    <article className="contentmk-card">
      <div className="hero-editor-title"><div><h3>Slides del carrusel</h3><p>El orden menor se muestra primero. Si todas las campañas vencen, se usa MAIN.</p></div><span className="commercial-counter">{rows.length} slide(s)</span></div>
      <div className="banner-list">
        {rows.map((b, idx) => <div className="banner-row" key={b.row_id}>
          <div className="banner-order">{idx + 1}</div>
          <div className="banner-info"><strong>{b.nombre}</strong><span>{b.zona} · {b.tipo} · prioridad {b.prioridad}</span><small>{b.permanente ? 'Permanente' : `${b.fecha_inicio ? new Date(b.fecha_inicio).toLocaleString('es-MX') : 'Sin inicio'} → ${b.fecha_fin ? new Date(b.fecha_fin).toLocaleString('es-MX') : 'Sin fin'}`}</small></div>
          <div className="banner-status-stack">{b.fallback_principal ? <span className="fallback-badge">PRINCIPAL</span> : null}<span className={`cms-state ${stateOf(b).toLowerCase()}`}>{stateOf(b)}</span></div>
          <div className="row-actions"><button className="secondary compact" onClick={() => edit(b)}>Editar</button><button className="secondary compact" onClick={() => quickToggle(b, 'publicado')}>{b.publicado ? 'Despublicar' : 'Publicar'}</button><button className="danger compact" onClick={() => deleteSlide(b)}>Eliminar</button></div>
        </div>)}
        {!rows.length ? <div className="empty-box">Crea un slide MAIN del slideshow y después campañas programadas.</div> : null}
      </div>
    </article>
  </div>;
}
