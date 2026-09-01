import { api } from '../services/api.js';
import { brandText } from "../config/brand.js";import ProductLocalImageManager from './ProductLocalImageManager.jsx';
import { useEffect, useState } from 'react';
import './product_modal_design1_r1.css';

function isRetailBarcode(value) {
  const code = String(value || '').trim();
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code);
}

function normalizedProductIdentifier(form) {
  const code = String(form?.sku || '').trim();
  return {
    ...form,
    sku: code,
    codigo_barras: isRetailBarcode(code) ? code : ''
  };
}

function mergeTcgCatalogRows(gameResponse, providerResponse) {
  const map = new Map();
  const games = Array.isArray(gameResponse?.data) ? gameResponse.data : [];
  const providers = Array.isArray(providerResponse?.data) ? providerResponse.data : [];

  for (const g of games) {
    const code = String(g.codigo || g.catalogo_codigo || g.game_code || g.id_juego || '').trim().toUpperCase();
    if (!code) continue;
    map.set(code, {
      id_juego: g.id_juego || code,
      codigo: code,
      catalogo_codigo: code,
      game_code: code,
      nombre: g.nombre || g.game_name || code,
      activo: g.activo !== false
    });
  }

  for (const p of providers) {
    const code = String(p.game_code || p.codigo || p.catalogo_codigo || '').trim().toUpperCase();
    if (!code) continue;
    const existing = map.get(code);
    map.set(code, existing || {
      id_juego: code,
      codigo: code,
      catalogo_codigo: code,
      game_code: code,
      nombre: p.game_name || p.nombre_juego || p.display_name || code,
      activo: true
    });
  }

  return Array.from(map.values()).sort((a,b) =>
    String(a.nombre || a.codigo).localeCompare(String(b.nombre || b.codigo), 'es')
  );
}
const empty = { sku: '', codigo_barras: '', nombre: '', descripcion: '', precio: '', costo: '', stock: '', initial_stock: '', initial_branch_id: '', stock_minimo: '0', categoria: '', imagen: '', estado: 'Activo', moneda_precio: 'MXN', tcg_game_code: '' };
export default function ProductModal({ open, product, initialValues = null, categories = [], branches = [], canSave = true, canDelete = false, canViewCost = false, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(empty);
  const [productTcgGames, setProductTcgGames] = useState([]);
  const [productTcgFx, setProductTcgFx] = useState(null);

  useEffect(() => {
    let active = true;
    if (!open) return () => { active = false; };

    Promise.allSettled([
      api('/api/v1/tcg/games'),
      api('/api/v1/tcg-sync/providers')
    ]).then(([gameResult, providerResult]) => {
      if (!active) return;
      const gamesResponse = gameResult.status === 'fulfilled' ? gameResult.value : { data: [] };
      const providersResponse = providerResult.status === 'fulfilled' ? providerResult.value : { data: [] };
      setProductTcgGames(mergeTcgCatalogRows(gamesResponse, providersResponse));
    }).catch(() => {
      if (active) setProductTcgGames([]);
    });

    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    let active = true;
    const code = String(form.tcg_game_code || '').trim().toUpperCase();
    if (!open || String(form.moneda_precio || 'MXN').toUpperCase() !== 'USD' || !code) {
      setProductTcgFx(null);
      return () => { active = false; };
    }
    api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/fx`, { cache: 'no-store' })
      .then((r) => {
        if (!active) return;
        const data = r?.data || r || {};
        const rate = Number(data?.rate || 0);
        setProductTcgFx(Number.isFinite(rate) && rate > 0 ? { rate, source: data?.source || 'SHINY_TCG' } : null);
      })
      .catch(() => { if (active) setProductTcgFx(null); });
    return () => { active = false; };
  }, [open, form.moneda_precio, form.tcg_game_code]);
  useEffect(() => {setForm(product ? {
      sku: product.sku ?? '', codigo_barras: product.codigo_barras ?? '', nombre: product.nombre ?? '', descripcion: product.descripcion ?? '',
      precio: product.precio_origen ?? product.precio ?? '', costo: product.costo ?? '', stock: product.stock ?? '', initial_stock: '', initial_branch_id: '', stock_minimo: product.stock_minimo ?? '',

      categoria: product.categoria ?? '', imagen: product.imagen ?? '', estado: product.estado || 'Activo',

      moneda_precio: String(product.moneda_precio || 'MXN').toUpperCase(),

      tcg_game_code: String(product.tcg_game_code || '').toUpperCase()
    } : initialValues ? { ...empty, ...initialValues } : empty);}, [product, initialValues, open]);
  if (!open) return null;
  const change = (e) => setForm((x) => ({ ...x, [e.target.name]: e.target.value }));
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal product-modal-complete" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow">{brandText("GMX · PRODUCTOS")}</div><h2>{product ? `Editar ${product.nombre || product.id}` : 'Nuevo producto'}</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>
    <form onSubmit={(e) => {e.preventDefault();onSave(normalizedProductIdentifier(form));}}>
      <div className="form-grid">
        <label className="product-identifier-field">Código / SKU *<input required name="sku" value={form.sku} onChange={change} autoComplete="off"  placeholder="Escanear código o escribir SKU interno" /></label>
            
        <label className="wide">Nombre *<input required name="nombre" value={form.nombre} onChange={change} /></label>
        <label className="wide">Descripción<textarea name="descripcion" rows="3" value={form.descripcion} onChange={change} /></label>
        <label>Precio *<input required name="precio" type="number" min="0" step=".01" value={form.precio} onChange={change} /></label>
        <label>Moneda *<select name="moneda_precio" required value={form.moneda_precio || 'MXN'} onChange={change}><option value="MXN">MXN</option><option value="USD">USD</option></select></label>
        <label>TCG {String(form.moneda_precio || 'MXN').toUpperCase()==='USD' ? '*' : ''}
          <select name="tcg_game_code" required={String(form.moneda_precio || 'MXN').toUpperCase()==='USD'} value={form.tcg_game_code || ''} onChange={change}>
            <option value="">No aplica</option>
            {productTcgGames.filter((g)=>g.activo!==false).map((g)=><option key={g.id_juego || g.codigo} value={String(g.codigo || g.catalogo_codigo || g.game_code || '').toUpperCase()}>{g.nombre || g.codigo}</option>)}
          </select>
        </label>
        {String(form.moneda_precio || 'MXN').toUpperCase()==='USD' ? <div className="product-tcg-fx-preview">
          {productTcgFx
            ? <><b>TDC {Number(productTcgFx.rate).toFixed(2)} MXN/USD</b><span>{Number(form.precio || 0).toFixed(2)} USD = {(Number(form.precio || 0) * Number(productTcgFx.rate || 0)).toLocaleString('es-MX',{style:'currency',currency:'MXN'})}</span></>
            : <span>Selecciona un TCG con TDC configurado para calcular el precio operativo en MXN.</span>}
        </div> : null}
        {canViewCost ? <label>Costo administrativo<input name="costo" type="number" min="0" step=".01" value={form.costo} onChange={change} /></label> : null}
        <label>{product ? 'Stock total' : 'Stock inicial'}
          {product ?
            <input value={form.stock ?? 0} disabled readOnly title="Se calcula sumando todas las sucursales" /> :
            <input name="initial_stock" type="number" min="0" step="1" value={form.initial_stock} onChange={change} />
            }
        </label>
        {!product && Number(form.initial_stock || 0) > 0 ? <label>Sucursal receptora *
          <select name="initial_branch_id" required value={form.initial_branch_id} onChange={change}>
            <option value="">Selecciona sucursal</option>
            {branches.filter((b) => b.activa !== false).map((b) => <option key={b.row_id} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}
          </select>
        </label> : null}
        <div className="wide product-stock-source-note">
          El stock físico se administra por sucursal desde Inventario. El catálogo muestra el total consolidado.
        </div>
        <label>Stock mínimo<input name="stock_minimo" type="number" min="0" step="1" value={form.stock_minimo} onChange={change} /></label>
        <label>Categoría *
          <select name="categoria" required value={form.categoria} onChange={change}>
            <option value="">Selecciona categoría</option>
            {form.categoria && !categories.some((c) => c.nombre === form.categoria) ?
              <option value={form.categoria} disabled>{form.categoria} · no disponible</option> :
              null}
            {categories.map((c) => <option key={c.id || c.nombre} value={c.nombre}>{c.nombre}</option>)}
          </select>
          {!categories.length ? <small className="field-help warning-text">No hay categorías activas disponibles.</small> : null}
        </label>
        <label>Estado<select name="estado" value={form.estado} onChange={change}><option>Activo</option><option>Inactivo</option><option>Agotado</option></select></label>
        <ProductLocalImageManager sku={form.sku} image={form.imagen} onChange={(url) => setForm((x) => ({ ...x, imagen: String(url || '') }))} />
      <label className="wide">Imagen / URL<input name="imagen" value={form.imagen} onChange={change} placeholder="https://... o ruta pública" /></label>
        {form.imagen ? <div className="wide product-image-preview"><img src={form.imagen} alt="Vista previa" /></div> : null}
      </div>
      <div className="modal-actions">
        {product && canDelete ? <button type="button" className="danger" onClick={() => onDelete?.(product)}>Dar de baja</button> : null}
        <div className="spacer" />
        <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
        {canSave ? <button>Guardar</button> : null}
      </div>
    </form>
  </div></div>;
}
