import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import VisionScannerModal from '../components/VisionScannerModal.jsx';
import VisionCandidatePicker from '../components/VisionCandidatePicker.jsx';
import { visionQueries, scoreVisionCandidate } from '../utils/vision.js';
import ProductModal from '../components/ProductModal.jsx';
import { R23BarList, R23Donut } from '../components/VisualKitR23.jsx';
import '../phase_shiny_exact_views_r23.css';

const PAGE_SIZE = 25;
function money(v) {return Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });}

function validImageReference(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (v.startsWith('/')) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function ProductThumb({ src, name }) {
  const [failed, setFailed] = useState(false);
  const value = String(src || '').trim();

  if (!value || failed) {
    return <div className="admin-product-thumb"><span>{brandText("GMX")}</span></div>;
  }

  return <div className="admin-product-thumb">
    <img
      src={value}
      alt={name ? `Imagen de ${name}` : 'Imagen de producto'}
      onError={() => setFailed(true)} />
    
  </div>;
}

function importErrorLabel(code) {
  const key = String(code || '').trim();
  const labels = {
    SKU_AND_NAME_REQUIRED: 'SKU y nombre son obligatorios.',
    DUPLICATE_SKU_IN_FILE: 'El SKU está repetido dentro del mismo archivo.',
    PRODUCT_CATEGORY_REQUIRED: 'La categoría es obligatoria.',
    PRODUCT_CATEGORY_INVALID: 'La categoría no existe o no está activa.',
    PRODUCT_IMAGE_URL_INVALID: 'La imagen debe ser una URL http/https válida, una ruta pública que inicie con /, o quedar vacía.',
    PRODUCT_BRANCH_REQUIRED_FOR_STOCK: 'No fue posible determinar la sucursal para asignar el stock inicial.',
    PRODUCT_SKU_EXISTS: 'El SKU ya existe.',
    PRODUCT_SKU_DUPLICATE: 'El SKU ya existe.'
  };
  return labels[key] || key || 'Error no especificado.';
}

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState({});
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [visionOpen, setVisionOpen] = useState(false);
  const [visionCandidates, setVisionCandidates] = useState([]);
  const [visionPickerOpen, setVisionPickerOpen] = useState(false);
  const [visionDraft, setVisionDraft] = useState(null);
  const [visionLastResult, setVisionLastResult] = useState(null);
  const [message, setMessage] = useState('');
  /* Shiny_PRODUCT_IMAGE_BULK_R11 */
  const [imageBulkBusy, setImageBulkBusy] = useState(false);
  const [imageBulkProgress, setImageBulkProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [access, setAccess] = useState(null);

  const permissions = access?.permissions || {};
  const canCreate = permissions.create === true;
  const canEdit = permissions.edit === true;
  const canDelete = permissions.delete === true;
  const canImport = canCreate && canEdit;

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), search, category, status
      });
      const [p, s, c] = await Promise.all([
      api(`/api/v1/products?${qs}`),
      api('/api/v1/products/meta/stats'),
      api('/api/v1/products/meta/categories')]
      );
      setProducts(p.data || []);setTotal(Number(p.total || 0));setStats(s.data || {});setCategories(c.data || []);
    } catch (e) {setMessage(e.message);} finally {setLoading(false);}
  }
  useEffect(() => {load();}, [page, category, status]);
  useEffect(() => {
    // PRODUCTS_GRAY_FIX_R1_MOUNT_RESET
    setModalOpen(false);
    setVisionOpen(false);
    setVisionPickerOpen(false);

    // VisionScannerModal renders through a portal into document.body.
    // If navigation was interrupted, remove only stale vision backdrops.
    document.
    querySelectorAll('body > .tcg_store_template-vision-backdrop').
    forEach((el) => el.remove());

    return () => {
      document.
      querySelectorAll('body > .tcg_store_template-vision-backdrop').
      forEach((el) => el.remove());
    };
  }, []);

  useEffect(() => {
    let active = true;
    api('/api/v1/products/meta/access').
    then(async (r) => {
      if (!active) return;
      const next = r.data || { permissions: {} };
      setAccess(next);

      // Las sucursales sólo son necesarias al crear stock inicial.
      if (next.permissions?.create === true) {
        try {
          const b = await api('/api/v1/branches?includeInactive=true');
          if (active) setBranches(b.data || []);
        } catch (e) {
          // Un usuario puede tener PRODUCTOS.create sin SUCURSALES.read
          // mediante permisos personalizados. No bloquear todo Productos.
          if (active) setBranches([]);
        }
      } else {
        setBranches([]);
      }
    }).
    catch((e) => {if (active) setMessage(e.message);});
    return () => {active = false;};
  }, []);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const productCategoryChart = useMemo(() => categories.map((item) => ({
    key: item.id || item.nombre,
    label: item.nombre || 'Sin categoría',
    value: Number(item.total || item.total_productos || 0)
  })).filter((item) => item.value > 0), [categories]);
  const activeProducts = Number(stats.activos || 0);
  const lowProducts = Number(stats.stock_bajo || 0);
  const outProducts = Math.max(0, Number(stats.agotados || 0));
  const inactiveProducts = Math.max(0, Number(stats.total || 0) - activeProducts);
  const catalogHealth = [
    { label: 'Activos', value: Math.max(0, activeProducts - lowProducts), color: '#12a866' },
    { label: 'Stock bajo', value: lowProducts, color: '#f59e0b' },
    { label: 'Agotados', value: outProducts, color: '#ef4444' },
    { label: 'Inactivos', value: inactiveProducts, color: '#8b5cf6' }
  ].filter((item) => item.value > 0);
  const visibleMaxStock = useMemo(() => Math.max(1, ...products.map((item) => Number(item.stock || 0))), [products]);

  function applyStockFilter(nextStatus) {
    setStatus(nextStatus);
    setPage(0);
  }

  async function openEdit(rowId) {
    if (!canEdit) return;
    try {
      const r = await api(`/api/v1/products/${rowId}`);
      setSelected(r.data);
      setModalOpen(true);
    } catch (e) {setMessage(e.message);}
  }
  function openNew() {
    async function handleVisionProductResult(result) {
      setVisionLastResult(result);
      const queries = visionQueries(result, { max: 6 });
      const found = new Map();

      for (const q of queries) {
        try {
          const r = await api(`/api/v1/products?limit=80&search=${encodeURIComponent(q)}`);
          for (const product of r.data || []) {
            const score = scoreVisionCandidate(product, result);
            const key = String(product.id || product.row_id || product.sku);
            const previous = found.get(key);
            if (!previous || score > previous.score) found.set(key, { ...product, key, score });
          }
        } catch {}
      }

      const candidates = [...found.values()].
      filter((x) => x.score >= 0.20).
      sort((a, b) => b.score - a.score).
      slice(0, 8);

      setVisionCandidates(candidates);
      setVisionOpen(false);
      setVisionPickerOpen(true);
    }

    function openVisionExisting(product) {
      setVisionPickerOpen(false);
      setVisionDraft(null);
      setSelected(product);
      setModalOpen(true);
    }

    function openVisionNew() {
      if (!canCreate) return;
      const result = visionLastResult || {};
      const lines = (result.lines || []).filter(Boolean);
      const guessedName = lines.find((x) => String(x).trim().length >= 4) || '';
      setVisionPickerOpen(false);
      setSelected(null);
      setVisionDraft({
        nombre: guessedName,
        codigo_barras: result.barcode || '',
        precio: '1',
        estado: 'Activo'
      });
      setModalOpen(true);
    }

    if (!canCreate) return;
    setSelected(null);
    setModalOpen(true);
  }
  async function completeMissingImages() {
    if (imageBulkBusy) return;

    const list = Array.isArray(products) ? products : [];
    const pending = list.filter((x) => !String(x.imagen || '').trim()).slice(0, 25);

    if (!pending.length) {
      setMessage('No hay productos visibles sin imagen.');
      return;
    }

    setImageBulkBusy(true);
    setImageBulkProgress({ done: 0, total: pending.length, updated: 0, review: 0 });

    let updated = 0;
    let review = 0;

    try {
      for (let i = 0; i < pending.length; i++) {
        const product = pending[i];

        try {
          const qs = new URLSearchParams({
            name: String(product.nombre || ''),
            category: String(product.categoria || ''),
            sku: String(product.sku || '')
          });

          const result = await api(`/api/v1/products/image-search?${qs.toString()}`);
          const best = (result?.data?.candidates || [])[0];

          // Bulk mode only applies very high-confidence results.
          // Everything else is left for manual review in Editar producto.
          if (best && Number(best.confidence || 0) >= 90) {
            const detail = await api(`/api/v1/products/${product.row_id}`);
            const source = detail?.data || product;
            await api(`/api/v1/products/${product.row_id}`, {
              method: 'PUT',
              body: JSON.stringify({ ...source, imagen: best.image })
            });
            updated++;
          } else {
            review++;
          }
        } catch {
          review++;
        }

        setImageBulkProgress({
          done: i + 1,
          total: pending.length,
          updated,
          review
        });
      }

      setMessage(`Imágenes: ${updated} asignada(s) automáticamente; ${review} pendiente(s) de revisión.`);
      await load();
    } finally {
      setImageBulkBusy(false);
    }
  }
  async function saveProduct(form) {
    try {
      if (selected && !canEdit) throw new Error('No tienes permiso para editar productos.');
      if (!selected && !canCreate) throw new Error('No tienes permiso para crear productos.');
      const imageValue = String(form?.imagen || '').trim();
      if (!validImageReference(imageValue)) {
        throw new Error('La imagen debe ser una URL http/https válida, una ruta pública que inicie con /, o dejarse vacía.');
      }
      const cleanForm = { ...form, imagen: imageValue };

      if (selected) await api(`/api/v1/products/${selected.row_id}`, { method: 'PUT', body: JSON.stringify(cleanForm) });else
      await api('/api/v1/products', { method: 'POST', body: JSON.stringify(cleanForm) });
      setMessage(selected ? 'Producto actualizado.' : 'Producto creado.');setModalOpen(false);await load();
    } catch (e) {setMessage(e.message);throw e;}
  }
  async function deleteProduct(product) {
    if (!canDelete) {
      setMessage('No tienes permiso para dar de baja productos.');
      return;
    }
    const confirmed = await window.tcg_store_templateConfirm(brandText(
      `Shiny validará stock e historial antes de procesar la baja de ${product.nombre || product.id}. Un producto con historial será desactivado, no eliminado.`),
    {
      title: 'Baja segura de producto',
      confirmText: 'Procesar baja',
      type: 'warning'
    }
    );
    if (!confirmed) return;

    try {
      const result = await api(`/api/v1/products/${product.row_id}`, { method: 'DELETE' });
      const action = result?.data?.action;

      setModalOpen(false);

      if (action === 'deactivated') {
        setMessage('Producto desactivado. Se conservó su historial.');
        window.tcg_store_templateNotify?.('Producto desactivado; el historial se conserva.', { type: 'success' });
      } else if (action === 'deleted') {
        setMessage('Producto eliminado. No tenía stock ni historial.');
        window.tcg_store_templateNotify?.('Producto eliminado definitivamente.', { type: 'success' });
      } else {
        setMessage(result?.message || 'Baja procesada.');
      }

      await load();
    } catch (e) {
      setMessage(e.message);
      window.tcg_store_templateNotify?.(e.message, { type: 'warning' });
    }
  }
  async function downloadDynamicTemplate() {
    try {
      const token = localStorage.getItem('Shiny_AUTH_TOKEN') || '';
      const response = await fetch('/api/v1/tcg/template.xlsx', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('No fue posible generar la plantilla.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;a.download = 'Shiny_Plantillas_Importacion_Dinamica.xlsx';
      document.body.appendChild(a);a.click();a.remove();
      URL.revokeObjectURL(url);
      window.tcg_store_templateNotify?.(brandText("Plantilla generada con el catálogo actual de GMX."), { type: 'success' });
    } catch (e) {setMessage(e.message);}
  }

  function filePayload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, mime: file.type, data: reader.result });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function importProducts(file) {
    if (!file) return;
    if (!canImport) {
      setMessage('La importación Excel requiere permisos para crear y editar productos.');
      return;
    }
    setImporting(true);setMessage('');setImportResult(null);
    try {
      const payload = await filePayload(file);
      const r = await api('/api/v1/products/import-excel', { method: 'POST', body: JSON.stringify({ file: payload }) });
      const result = {
        fileName: file.name,
        read: Number(r.data.read || 0),
        created: Number(r.data.created || 0),
        updated: Number(r.data.updated || 0),
        errors: Array.isArray(r.data.errors) ? r.data.errors : []
      };
      setImportResult(result);
      setMessage(`Importación: ${result.created} creados, ${result.updated} actualizados, ${result.errors.length} errores.`);
      await load();
    } catch (e) {
      setImportResult(null);
      setMessage(e.message);
    } finally {
      setImporting(false);
    }
  }

  function submit(e) {e.preventDefault();setPage(0);load();}

  return <div className="products-admin-page r23-view r23-products">
    <section className="products-admin-kpis r23-icon-kpis">
      <article><i aria-hidden="true">▦</i><div><span>Productos</span><strong>{Number(stats.total || 0).toLocaleString('es-MX')}</strong><small>Catálogo registrado</small></div></article>
      <article><i aria-hidden="true">✓</i><div><span>Activos</span><strong>{Number(stats.activos || 0).toLocaleString('es-MX')}</strong><small>Disponibles para operar</small></div></article>
      <article className={Number(stats.stock_bajo || 0) > 0 ? 'warn' : ''}><i aria-hidden="true">△</i><div><span>Stock bajo</span><strong>{Number(stats.stock_bajo || 0).toLocaleString('es-MX')}</strong><small>Requieren atención</small></div></article>
      <article><i aria-hidden="true">◇</i><div><span>Unidades</span><strong>{Number(stats.unidades || 0).toLocaleString('es-MX')}</strong><small>Existencia total</small></div></article>
      <article><i aria-hidden="true">$</i><div><span>Valor inventario</span><strong
  title={money(stats.valor_costo)}
  style={{
    fontSize:`${Math.max(11.5,25-Math.max(0,String(money(stats.valor_costo)).length-7)*1.65)}px`,
    lineHeight:1.05,
    letterSpacing:'-.05em',
    whiteSpace:'nowrap',
    overflow:'visible',
    textOverflow:'clip'
  }}
>{money(stats.valor_costo)}</strong><small>Costo registrado</small></div></article>
      <article><i aria-hidden="true">↗</i><div><span>Venta potencial</span><strong
  title={money(stats.valor_venta)}
  style={{
    fontSize:`${Math.max(11.5,25-Math.max(0,String(money(stats.valor_venta)).length-7)*1.65)}px`,
    lineHeight:1.05,
    letterSpacing:'-.05em',
    whiteSpace:'nowrap',
    overflow:'visible',
    textOverflow:'clip'
  }}
>{money(stats.valor_venta)}</strong><small>Ingreso estimado</small></div></article>
    </section>

    <section className="r23-visual-grid r23-products-overview r25-products-overview" aria-label="Análisis visual del catálogo">
      <article className="r23-visual-card">
        <div className="r23-card-heading"><div><span>CATÁLOGO</span><h3>Distribución por categoría</h3></div><small>{Number(stats.total || 0)} productos</small></div>
        <R23Donut segments={productCategoryChart} center={Number(stats.total || 0)} caption="productos" />
      </article>
      <article className="r23-visual-card">
        <div className="r23-card-heading"><div><span>CLASIFICACIÓN</span><h3>Productos por categoría</h3></div><small>participación actual</small></div>
        <R23BarList items={productCategoryChart} />
      </article>
      <article className="r23-visual-card r23-health-card">
        <div className="r23-card-heading"><div><span>DISPONIBILIDAD</span><h3>Salud del catálogo</h3></div><small>{Number(stats.unidades || 0)} unidades</small></div>
        <div className="r23-product-health-list">
          {catalogHealth.map((item) => <div key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{item.value}</strong></div>)}
        </div>
        <div className="r23-product-value"><span>Margen potencial del inventario</span><strong>{money(Number(stats.valor_venta || 0) - Number(stats.valor_costo || 0))}</strong><small>Valor de venta menos costo registrado</small></div>
      </article>
    </section>

    <section className="content-card products-card r25-products-catalog">
      <div className="section-head product-tools">
        <div className="r25-products-title"><i aria-hidden="true">▦</i><div><div className="eyebrow">CATÁLOGO OPERATIVO</div><h2>Catálogo de productos</h2><p className="section-copy">{loading ? 'Consultando…' : `${total} registros disponibles para administrar`}</p></div></div>
        <div className="products-head-actions">
          <button type="button" className="secondary" onClick={downloadDynamicTemplate}>Descargar plantilla actualizada</button>
          {canImport ? <label className="secondary file-inline">
            {importing ? 'Importando…' : 'Importar Excel'}
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={importing}
              onChange={(e) => importProducts(e.target.files?.[0])} />
            
          </label> : null}
          {canEdit ?
          <button
            type="button"
            className="secondary"
            disabled={imageBulkBusy}
            onClick={completeMissingImages}>
            
    {imageBulkBusy ?
            `Imágenes ${imageBulkProgress?.done || 0}/${imageBulkProgress?.total || 0}` :
            'Completar imágenes faltantes'}
  </button> :
          null}{canCreate ? <><button type="button" onClick={openNew}>Nuevo producto</button></> : null}
        </div>
      </div>

      <form className="products-filter-bar r25-products-filter" onSubmit={submit}>
        <label className="r25-search-field"><span>Buscar producto</span><div><i aria-hidden="true">⌕</i><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, SKU, ID o categoría" /></div></label>
        <label><span>Categoría</span>
        <select value={category} onChange={(e) => {setCategory(e.target.value);setPage(0);}}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id || c.nombre} value={c.nombre}>{c.nombre} ({c.total})</option>)}
        </select></label>
        <label><span>Estado</span><select value={status} onChange={(e) => {setStatus(e.target.value);setPage(0);}}><option value="">Todos los estados</option><option>Activo</option><option>Inactivo</option><option>Agotado</option></select></label>
        <button className="secondary r25-filter-submit">Aplicar filtros</button>
      </form>

      <div className="r25-product-quickfilters" aria-label="Filtros rápidos de productos">
        <button type="button" className={!status ? 'active' : ''} onClick={() => applyStockFilter('')}>Todos <b>{Number(stats.total || 0)}</b></button>
        <button type="button" onClick={() => applyStockFilter('Activo')}><i className="ok" />Activos <b>{activeProducts}</b></button>
        <button type="button" onClick={() => applyStockFilter('Agotado')}><i className="warn" />Agotados <b>{outProducts}</b></button>
        <button type="button" onClick={() => applyStockFilter('Inactivo')}><i className="off" />Inactivos <b>{inactiveProducts}</b></button>
      </div>

      {message ? <div className="message">{message}</div> : null}

      {importResult?.errors?.length ? <div className="product-import-errors" style={{
        margin: '14px 0 18px',
        border: '1px solid var(--line,#d8dee8)',
        borderRadius: 14,
        background: 'var(--surface,#fff)',
        overflow: 'hidden'
      }}>
        <div className="product-import-errors-head" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '14px 16px',
          borderBottom: '1px solid var(--line,#e5e7eb)'
        }}>
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <strong style={{ fontSize: 16 }}>Detalle de errores de importación</strong>
            <small style={{
              color: 'var(--muted,#667085)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {importResult.fileName || 'Archivo Excel'} · {importResult.errors.length} fila(s) rechazadas
            </small>
          </div>
          <button
            type="button"
            className="secondary compact"
            onClick={() => setImportResult(null)}
            style={{ flex: '0 0 auto' }}>
            
            Cerrar
          </button>
        </div>
        <div className="table-wrap" style={{ margin: 0 }}>
          <table>
            <thead><tr><th>Fila</th><th>SKU</th><th>Motivo</th><th>Código</th></tr></thead>
            <tbody>
              {importResult.errors.map((err, index) => <tr key={`${err.row || 'x'}-${err.sku || 'sin-sku'}-${index}`}>
                <td>{err.row ?? '—'}</td>
                <td><b>{err.sku || '—'}</b></td>
                <td>{importErrorLabel(err.error)}</td>
                <td><code>{err.error || 'UNKNOWN_ERROR'}</code></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div> : null}

      <div className="table-wrap">
        <table><thead><tr><th>Imagen</th><th>ID / SKU</th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Costo</th><th>Stock total</th><th>Mín.</th><th>Estado</th><th></th></tr></thead>
        <tbody>{products.map((p) => {
              const low = Number(p.stock || 0) <= Number(p.stock_minimo || 0);
              return <tr key={p.row_id} className={low ? 'low-stock-row' : ''}>
            <td><ProductThumb src={p.imagen} name={p.nombre} /></td>
            <td><b>{p.id || '—'}</b><small>{p.sku || 'Sin SKU'}</small></td>
            <td><strong>{p.nombre || 'Sin nombre'}</strong><small>{p.descripcion || 'Sin descripción'}</small></td>
            <td>{p.categoria || '—'}</td><td>{money(p.precio)}</td><td>{money(p.costo)}</td>
            <td><div className="r25-stock-cell"><b>{p.stock ?? 0}</b><i><span style={{ width: `${Math.max(Number(p.stock || 0) > 0 ? 5 : 0, Number(p.stock || 0) / visibleMaxStock * 100)}%` }} /></i>{low ? <small className="low-stock-label">Stock bajo</small> : null}</div></td>
            <td>{p.stock_minimo ?? 0}</td>
            <td><span className={`state-chip ${String(p.estado || '').toLowerCase()}`}>{p.estado || '—'}</span></td>
            <td>{canEdit ? <button className="secondary compact r25-edit-product" onClick={() => openEdit(p.row_id)}>Editar</button> : null}</td>
          </tr>;
            })}
        {!loading && !products.length ? <tr><td colSpan="10" className="empty">No hay productos con estos filtros.</td></tr> : null}</tbody></table>
      </div>
      <div className="products-pagination">
        <span>Página {page + 1} de {pages}</span>
        <div><button className="secondary compact" disabled={page <= 0} onClick={() => setPage((x) => x - 1)}>Anterior</button><button className="secondary compact" disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>Siguiente</button></div>
      </div>
    </section>

    <ProductModal initialValues={visionDraft}
    open={modalOpen}
    product={selected}
    categories={categories}
    branches={branches}
    canSave={selected ? canEdit : canCreate}
    canDelete={canDelete}
    onClose={() => setModalOpen(false)}
    onSave={saveProduct}
    onDelete={deleteProduct} />
    
        {visionOpen ? <VisionScannerModal open={true} title="Reconocer producto" onClose={() => setVisionOpen(false)} onResult={handleVisionProductResult} /> : null}
      {visionPickerOpen ? <VisionCandidatePicker
      open={true}
      title="Resultado de reconocimiento"
      subtitle="Selecciona un producto existente o prepara un alta nueva."
      items={visionCandidates}
      onClose={() => setVisionPickerOpen(false)}
      onPick={openVisionExisting}
      emptyText="No encontramos un producto existente." /> :
    null}
      {visionPickerOpen && canCreate ? <div className="tcg_store_template-vision-create-floating"><button type="button" onClick={openVisionNew}>+ Crear producto con datos detectados</button></div> : null}
</div>;
}
