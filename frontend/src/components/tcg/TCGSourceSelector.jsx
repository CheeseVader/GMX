import { brandText } from "../../config/brand.js";import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

export default function TCGSourceSelector({ gameCode, onSaved }) {
  const [available, setAvailable] = useState({ catalog: [], images: [], prices: [] });
  const [prefs, setPrefs] = useState({ catalogSource: 'AUTO', imageSource: 'AUTO', priceSources: [], allowFallback: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    if (!gameCode) return;
    setBusy(true);setMsg('');
    try {
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/sources`);
      setAvailable(r.data?.available || { catalog: [], images: [], prices: [] });
      setPrefs(r.data?.preferences || { catalogSource: 'AUTO', imageSource: 'AUTO', priceSources: [], allowFallback: true });
    } catch (e) {setMsg(e.message);} finally
    {setBusy(false);}
  }
  useEffect(() => {load();}, [gameCode]);

  function togglePrice(code) {
    setPrefs((p) => ({ ...p, priceSources: p.priceSources.includes(code) ? p.priceSources.filter((x) => x !== code) : [...p.priceSources, code] }));
  }

  async function save() {
    setBusy(true);setMsg('');
    try {
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/sources`, {
        method: 'PUT', body: JSON.stringify(prefs)
      });
      setPrefs(r.data);
      setMsg('Fuentes guardadas. Las próximas sincronizaciones usarán esta configuración.');
      onSaved?.(r.data);
    } catch (e) {setMsg(e.message);} finally
    {setBusy(false);}
  }

  return <section className="tcg-source-selector">
    <div>
      <span className="eyebrow">FUENTES DE SINCRONIZACIÓN</span>
      <h3>Elegir de dónde descargar</h3>
      <p>Configura el origen para <b>{gameCode}</b>. Los precios son referencias exclusivas del Admin.</p>
    </div>

    {msg ? <div className="source-selector-message">{msg}</div> : null}

    <div className="source-selector-grid">
      <label>Catálogo
        <select disabled={busy} value={prefs.catalogSource || ''} onChange={(e) => setPrefs((p) => ({ ...p, catalogSource: e.target.value }))}>
          {available.catalog.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
        <small>Sets, cartas, rarezas y metadatos.</small>
      </label>

      <label>Imágenes
        <select disabled={busy} value={prefs.imageSource || ''} onChange={(e) => setPrefs((p) => ({ ...p, imageSource: e.target.value }))}>
          {available.images.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
        <small>Actualmente se conserva la imagen asociada al catálogo elegido.</small>
      </label>

      <label className="source-fallback">
        <span>Respaldo automático</span>
        <div><input type="checkbox" checked={prefs.allowFallback !== false} onChange={(e) => setPrefs((p) => ({ ...p, allowFallback: e.target.checked }))} /><b>Usar otra fuente si la elegida falla</b></div>
        <small>{brandText("Si se desactiva, GMX reportará el error sin cambiar de proveedor.")}</small>
      </label>
    </div>

    <div className="source-price-box">
      <b>Fuentes de precio</b>
      <p>{brandText("Puedes seleccionar varias. GMX guarda cada proveedor por separado para comparación.")}</p>
      <div className="source-price-options">
        {available.prices.map((x) => <label key={x.code} className={x.enabled === false ? 'source-disabled' : ''}>
          <input
            type="checkbox"
            disabled={busy || x.enabled === false}
            checked={(prefs.priceSources || []).includes(x.code)}
            onChange={() => togglePrice(x.code)} />
          
          <span>{x.name}{x.requiresCredential && x.enabled === false ? ' · Requiere API oficial' : ''}</span>
        </label>)}
        {!available.prices.length ? <span>Este proveedor todavía no expone fuentes de precio configurables.</span> : null}
      </div>
    </div>

    <button className="source-save" disabled={busy} onClick={save}>{busy ? 'Procesando…' : 'Guardar fuentes'}</button>
  </section>;
}
