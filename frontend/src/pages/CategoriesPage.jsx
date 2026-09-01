import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { R23BarList, R23Donut } from '../components/VisualKitR23.jsx';
import '../phase_shiny_exact_views_r23.css';
import '../categories_icons_r75.css';

const EMPTY = { id: '', nombre: '', estado: 'Activo' };

function CategoryR75Icon({ name = '' }) {
  const n = String(name || '').toLowerCase();
  let kind = 'box';
  if (n.includes('carta')) kind = 'card';
  else if (n.includes('acces')) kind = 'bag';
  else if (n.includes('comic')) kind = 'book';
  else if (n.includes('coleccion')) kind = 'gem';
  else if (n.includes('figura') || n.includes('funko')) kind = 'figure';
  else if (n.includes('juego')) kind = 'dice';
  else if (n.includes('manga')) kind = 'books';
  else if (n.includes('peluche')) kind = 'bear';
  else if (n.includes('sellad')) kind = 'box';
  const paths = {
    card: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h5M8 15h7"/></>,
    bag: <><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
    book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 4H11v16H7.5A3.5 3.5 0 0 0 4 21V5.5Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 4H13v16h3.5A3.5 3.5 0 0 1 20 21V5.5Z"/></>,
    gem: <><path d="M4 9l4-5h8l4 5-8 11L4 9Z"/><path d="M4 9h16M8 4l4 5 4-5M12 9v11"/></>,
    figure: <><circle cx="12" cy="7" r="3"/><path d="M7 21v-5a5 5 0 0 1 10 0v5M8 13l-3 3M16 13l3 3"/></>,
    dice: <><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></>,
    books: <><rect x="4" y="5" width="5" height="15" rx="1"/><rect x="10" y="3" width="5" height="17" rx="1"/><path d="M16 6l4-1 2 14-4 1-2-14Z"/></>,
    bear: <><circle cx="7" cy="7" r="2"/><circle cx="17" cy="7" r="2"/><circle cx="12" cy="12" r="7"/><circle cx="10" cy="11" r=".7"/><circle cx="14" cy="11" r=".7"/><path d="M10 15c1.3 1 2.7 1 4 0"/></>,
    box: <><path d="M4 8l8-4 8 4-8 4-8-4Z"/><path d="M4 8v9l8 4 8-4V8M12 12v9"/></>
  };
  return <span className={`shiny-r75-cat-icon ${kind}`}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg></span>;
}


export default function CategoriesPage() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const result = await api('/api/v1/categories');
    setRows(Array.isArray(result?.data) ? result.data : []);
  }

  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('es');
    return rows.filter((row) => {
      const matchText = !q || String(row.nombre || '').toLocaleLowerCase('es').includes(q);
      const matchStatus = !status || String(row.estado || 'Activo') === status;
      return matchText && matchStatus;
    });
  }, [rows, search, status]);

  const totalActive = rows.filter((x) => String(x.estado || 'Activo') === 'Activo').length;
  const totalProducts = rows.reduce((sum, x) => sum + Number(x.total_productos || 0), 0);
  const maxProducts = Math.max(1, ...rows.map((x) => Number(x.total_productos || 0)));

  function openNew() {
    setForm(EMPTY);
    setEditing(true);
    setMessage('');
  }

  function openEdit(row) {
    setForm({
      id: String(row.id || ''),
      nombre: String(row.nombre || ''),
      estado: String(row.estado || 'Activo')
    });
    setEditing(true);
    setMessage('');
  }

  async function save(e) {
    e.preventDefault();
    const nombre = form.nombre.trim();
    if (!nombre) {
      setMessage('El nombre de la categoría es obligatorio.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      if (form.id) {
        await api(`/api/v1/categories/${encodeURIComponent(form.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ nombre, estado: form.estado })
        });
        setMessage('Categoría actualizada.');
      } else {
        await api('/api/v1/categories', {
          method: 'POST',
          body: JSON.stringify({ nombre, estado: form.estado })
        });
        setMessage('Categoría creada.');
      }

      setEditing(false);
      setForm(EMPTY);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="categories-page admin-stack r23-view r23-categories r29-categories-cata">
    <header className="categories-hero content-card">
      <div>
        <div className="eyebrow">CATÁLOGO MAESTRO</div>
        <h2>Categorías</h2>
        <p>Administra las categorías utilizadas por Productos, Inventario, Compras y la tienda pública.</p>
      </div>
      <button type="button" onClick={openNew}>+ Nueva categoría</button>
    </header>

    <div className="categories-kpis r29-categories-kpis">
      <article><i aria-hidden="true">▦</i><div><span>Total categorías</span><strong>{rows.length}</strong><small>Estructura actual del catálogo</small></div></article>
      <article><i aria-hidden="true">✓</i><div><span>Categorías activas</span><strong>{totalActive}</strong><small>Disponibles para clasificar</small></div></article>
      <article><i aria-hidden="true">◇</i><div><span>Productos clasificados</span><strong>{totalProducts}</strong><small>Asociaciones registradas</small></div></article>
    </div>

    <section className="r23-visual-grid r23-categories-overview r29-categories-overview" aria-label="Distribución del catálogo">
      <article className="r23-visual-card">
        <div className="r23-card-heading"><div><span>ANÁLISIS</span><h3>Distribución del catálogo</h3></div><small>{totalProducts} productos</small></div>
        <R23Donut segments={rows.map((row) => ({ label: row.nombre, value: Number(row.total_productos || 0) }))} center={totalProducts} caption="clasificados" />
      </article>
      <article className="r23-visual-card">
        <div className="r23-card-heading"><div><span>PARTICIPACIÓN</span><h3>Productos por categoría</h3></div></div>
        <R23BarList items={rows.map((row) => ({ key: row.id, label: row.nombre, value: Number(row.total_productos || 0) }))} />
      </article>
    </section>

    <section className="categories-panel content-card r29-categories-directory">
      <div className="section-head compact"><div><div className="eyebrow">ORGANIZACIÓN</div><h2>Catálogo de categorías</h2><p className="section-copy">Consulta el peso de cada categoría y administra su disponibilidad.</p></div><div className="r29-category-actions"><span className="phase-pill">{visible.length} visibles</span><button type="button" onClick={openNew}>+ Nueva categoría</button></div></div>
      <div className="categories-filters">
        <label>Buscar
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre de categoría" />
        </label>
        <label>Estado
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="Activo">Activas</option>
            <option value="Inactivo">Inactivas</option>
          </select>
        </label>
      </div>

      {message ? <div className="message">{message}</div> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Productos asociados</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.length ? visible.map((row) =>
            <tr key={row.id}>
                <td>
                  <div className="shiny-r75-category-name"><CategoryR75Icon name={row.nombre}/><div><strong>{row.nombre}</strong><div className="muted">{row.id}</div></div></div>
                </td>
                <td><div className="category-count-visual"><span><strong>{Number(row.total_productos || 0)}</strong> producto(s)</span><i><b style={{ width: `${Math.max(Number(row.total_productos || 0) ? 5 : 0, (Number(row.total_productos || 0) / maxProducts) * 100)}%` }} /></i></div></td>
                <td>
                  <span className={`status ${String(row.estado || 'Activo').toLowerCase() === 'activo' ? 'active' : 'inactive'}`}>
                    {row.estado || 'Activo'}
                  </span>
                </td>
                <td>
                  <button type="button" className="secondary compact" onClick={() => openEdit(row)}>Editar</button>
                </td>
              </tr>
            ) : <tr><td colSpan="4" className="empty">No se encontraron categorías.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    {editing ? <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card" onSubmit={save} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <div>
            <small>CATÁLOGO MAESTRO</small>
            <h2>{form.id ? 'Editar categoría' : 'Nueva categoría'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={() => setEditing(false)}>×</button>
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label>Nombre *
            <input
              autoFocus
              value={form.nombre}
              onChange={(e) => setForm((x) => ({ ...x, nombre: e.target.value }))}
              placeholder="Ej. Deck Boxes"
              maxLength="120" />
            
          </label>

          <label>Estado
            <select value={form.estado} onChange={(e) => setForm((x) => ({ ...x, estado: e.target.value }))}>
              <option value="Activo">Activa</option>
              <option value="Inactivo">Inactiva</option>
            </select>
          </label>

          {form.id ? <p className="muted" style={{ margin: 0 }}>{brandText("\n            Si cambias el nombre, GMX actualizará también los productos actualmente asociados a esta categoría.\n          ")}

          </p> : null}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar categoría'}</button>
        </div>
      </form>
    </div> : null}
  </div>;
}
