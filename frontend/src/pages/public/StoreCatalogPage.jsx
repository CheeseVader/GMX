import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { publicApi } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import ProductCard from '../../components/public/ProductCard.jsx';
import PublicIcon from '../../components/public/PublicIcon.jsx';
import { genericProducts, productMatchesQuery } from '../../utils/publicCatalogClassification.js';

const PAGE_SIZE = 12;

export default function StoreCatalogPage() {
  const { store, liveUpdate } = usePublicStore();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get('q') || '';
  const category = params.get('category') || '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      publicApi('/api/public/products?limit=100'),
      publicApi('/api/public/tcg/games')
    ]).then(([productResponse, gameResponse]) => {
      if (!active) return;
      setRows(productResponse.data || []);
      setGames(gameResponse.data || []);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!liveUpdate?.version) return;
    const changes = liveUpdate.changes || [];
    setRows((current) => current.map((product) => {
      const hit = changes.find((change) => change.type === 'PRODUCT' && String(change.id) === String(product.id));
      return hit ? { ...product, stock_disponible: Number(hit.stock) } : product;
    }));
  }, [liveUpdate?.version]);

  useEffect(() => { setPage(1); }, [q, category, availability, minPrice, maxPrice, sort]);

  const generic = useMemo(() => genericProducts(rows, games), [rows, games]);
  const categories = useMemo(() => [...new Set(generic.map((product) => String(product.categoria || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [generic]);

  const visible = useMemo(() => {
    const minimum = minPrice === '' ? null : Number(minPrice);
    const maximum = maxPrice === '' ? null : Number(maxPrice);
    const filtered = generic.filter((product) => {
      const stock = Number(product.stock_disponible ?? product.stock ?? 0);
      const price = Number(product.precio || 0);
      return (!category || String(product.categoria || '') === category)
        && productMatchesQuery(product, q)
        && (availability !== 'stock' || stock > 0)
        && (availability !== 'out' || stock <= 0)
        && (minimum === null || price >= minimum)
        && (maximum === null || price <= maximum);
    });
    if (sort === 'price-asc') filtered.sort((a, b) => Number(a.precio || 0) - Number(b.precio || 0));
    if (sort === 'price-desc') filtered.sort((a, b) => Number(b.precio || 0) - Number(a.precio || 0));
    if (sort === 'name') filtered.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    if (sort === 'stock') filtered.sort((a, b) => Number(b.stock_disponible || 0) - Number(a.stock_disponible || 0));
    return filtered;
  }, [generic, category, q, availability, minPrice, maxPrice, sort]);

  const currency = store?.settings?.['public.store.currency'] || 'MXN';
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateParam(name, value) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      value ? next.set(name, value) : next.delete(name);
      return next;
    });
  }

  function clearFilters() {
    setParams(new URLSearchParams());
    setAvailability('all');
    setMinPrice('');
    setMaxPrice('');
    setSort('relevance');
  }

  return <main className="public-page shiny-catalog-page">
    <section className="shiny-catalog-hero" data-game-theme="gmx">
      <div className="shiny-catalog-hero-copy">
        <span className="shiny-breadcrumb"><Link to="/tienda">Inicio</Link> / Productos</span>
        <h1>Productos</h1>
        <p>Accesorios, protección y artículos para completar tu colección.</p>
        <div className="shiny-catalog-stats"><span><PublicIcon name="package" size={18}/><b>{generic.length}</b> productos</span><span><PublicIcon name="check" size={18}/>Stock actualizado</span></div>
      </div>
      <div className="shiny-catalog-art" aria-hidden="true"><div className="shiny-art-box"/><div className="shiny-art-sleeves"/><div className="shiny-art-card"/></div>
    </section>

    <div className="shiny-subcategory-tabs">
      <button className={!category ? 'active' : ''} onClick={() => updateParam('category', '')}>Todos</button>
      {categories.slice(0, 6).map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => updateParam('category', item)}>{item}</button>)}
    </div>

    <div className="shiny-mobile-catalog-tools">
      <button onClick={() => setFiltersOpen((value) => !value)}><PublicIcon name="filter" size={17}/>Filtros</button>
      <span>{visible.length} resultados</span>
    </div>

    <div className="shiny-catalog-layout">
      <aside className={'shiny-filter-panel ' + (filtersOpen ? 'is-open' : '')}>
        <div className="shiny-filter-title"><b>Filtros</b><button onClick={() => setFiltersOpen(false)} aria-label="Cerrar filtros"><PublicIcon name="close" size={18}/></button></div>
        <section>
          <h3>Buscar</h3>
          <label className="shiny-filter-search"><PublicIcon name="search" size={16}/><input value={q} onChange={(event) => updateParam('q', event.target.value)} placeholder="Producto o SKU"/></label>
        </section>
        <section>
          <h3>Disponibilidad</h3>
          <label><input type="radio" name="catalog-stock" checked={availability === 'all'} onChange={() => setAvailability('all')}/>Todos <span>{generic.length}</span></label>
          <label><input type="radio" name="catalog-stock" checked={availability === 'stock'} onChange={() => setAvailability('stock')}/>En stock <span>{generic.filter((product) => Number(product.stock_disponible || 0) > 0).length}</span></label>
          <label><input type="radio" name="catalog-stock" checked={availability === 'out'} onChange={() => setAvailability('out')}/>Agotado <span>{generic.filter((product) => Number(product.stock_disponible || 0) <= 0).length}</span></label>
        </section>
        <section>
          <h3>Categoría</h3>
          <label><input type="radio" name="catalog-category" checked={!category} onChange={() => updateParam('category', '')}/>Todas</label>
          {categories.map((item) => <label key={item}><input type="radio" name="catalog-category" checked={category === item} onChange={() => updateParam('category', item)}/>{item}<span>{generic.filter((product) => String(product.categoria || '') === item).length}</span></label>)}
        </section>
        <section>
          <h3>Precio</h3>
          <div className="shiny-price-inputs"><input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Mínimo"/><i>–</i><input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Máximo"/></div>
        </section>
        <button className="shiny-clear-filters" onClick={clearFilters}><PublicIcon name="refresh" size={17}/>Limpiar filtros</button>
      </aside>

      <section className="shiny-catalog-results">
        <div className="shiny-results-toolbar">
          <div><b>Mostrando {visible.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(currentPage * PAGE_SIZE, visible.length)}</b> de {visible.length} productos</div>
          <label>Ordenar por:
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="relevance">Relevancia</option>
              <option value="price-asc">Precio: menor a mayor</option>
              <option value="price-desc">Precio: mayor a menor</option>
              <option value="name">Nombre A–Z</option>
              <option value="stock">Mayor disponibilidad</option>
            </select>
          </label>
        </div>

        {loading
          ? <div className="shiny-catalog-loading"><span/><span/><span/><span/></div>
          : pageRows.length
            ? <div className="public-products-grid shiny-catalog-grid">{pageRows.map((product) => <ProductCard key={product.row_id} product={product} currency={currency}/>)}</div>
            : <div className="shiny-empty-state"><div className="shiny-empty-icon"><PublicIcon name="search" size={29}/></div><h2>No encontramos productos</h2><p>Prueba con otros filtros o limpia la búsqueda para ver todo el catálogo.</p><button onClick={clearFilters}>Limpiar filtros</button></div>}

        {pageCount > 1 ? <nav className="shiny-pagination" aria-label="Paginación">
          <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).filter((number) => number === 1 || number === pageCount || Math.abs(number - currentPage) <= 1).map((number, index, array) => <span key={number}>{index > 0 && number - array[index - 1] > 1 ? <i>…</i> : null}<button className={number === currentPage ? 'active' : ''} onClick={() => setPage(number)}>{number}</button></span>)}
          <button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>›</button>
        </nav> : null}
      </section>
    </div>
  </main>;
}
