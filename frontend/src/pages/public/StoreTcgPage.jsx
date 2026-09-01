import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { publicApi } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import StoreSlideshow from '../../components/public/StoreSlideshow.jsx';
import TcgCard from '../../components/public/TcgCard.jsx';
import ProductCard from '../../components/public/ProductCard.jsx';
import PublicIcon from '../../components/public/PublicIcon.jsx';
import { productMatchesQuery, tcgProducts } from '../../utils/publicCatalogClassification.js';

const PAGE_SIZE = 12;

function themeForGame(game = {}) {
  const key = `${game.catalogo_codigo || game.codigo || ''} ${game.nombre || ''}`.toLowerCase();
  if (key.includes('pokemon')) return 'pokemon';
  if (key.includes('magic') || key.includes('mtg')) return 'magic';
  if (key.includes('yugioh') || key.includes('yu-gi')) return 'yugioh';
  if (key.includes('riftbound')) return 'riftbound';
  return 'gmx';
}

export default function StoreTcgPage() {
  const { store, liveUpdate } = usePublicStore();
  const [params, setParams] = useSearchParams();
  const [games, setGames] = useState([]);
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState('all');
  const [setName, setSetName] = useState('');
  const [rarity, setRarity] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const gameId = params.get('gameId') || '';
  const q = params.get('q') || '';
  const view = params.get('view') || 'all';

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      publicApi('/api/public/tcg/games'),
      publicApi(`/api/public/tcg?limit=200&gameId=${encodeURIComponent(gameId)}&search=${encodeURIComponent(q)}`),
      publicApi('/api/public/products?limit=100')
    ]).then(([gameResponse, tcgResponse, productResponse]) => {
      if (!active) return;
      setGames(gameResponse.data || []);
      setRows(tcgResponse.data || []);
      setProducts(productResponse.data || []);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [gameId, q]);

  useEffect(() => {
    if (!liveUpdate?.version) return;
    const changes = liveUpdate.changes || [];
    setRows((current) => current.map((item) => {
      const hit = changes.find((change) => change.type === 'TCG' && String(change.id) === String(item.id_inventario));
      return hit ? { ...item, stock: Number(hit.stock), stock_disponible: Number(hit.stock) } : item;
    }));
    setProducts((current) => current.map((product) => {
      const hit = changes.find((change) => change.type === 'PRODUCT' && String(change.id) === String(product.id));
      return hit ? { ...product, stock_disponible: Number(hit.stock) } : product;
    }));
  }, [liveUpdate?.version]);

  useEffect(() => {
    setPage(1);
    setSetName('');
    setRarity('');
  }, [gameId]);

  useEffect(() => { setPage(1); }, [q, view, availability, setName, rarity, minPrice, maxPrice, sort]);

  const selectedGame = useMemo(() => games.find((game) => String(game.id_juego) === String(gameId)) || null, [games, gameId]);
  const sealed = useMemo(() => tcgProducts(products, games, selectedGame).filter((product) => productMatchesQuery(product, q)), [products, games, selectedGame, q]);
  const sets = useMemo(() => [...new Set(rows.map((item) => String(item.set_nombre || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
  const rarities = useMemo(() => [...new Set(rows.map((item) => String(item.rareza || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);

  const entries = useMemo(() => {
    const singles = rows.map((item) => ({
      kind: 'single',
      key: `single-${item.row_id}`,
      item,
      name: item.carta || '',
      price: Number(item.precio || 0),
      stock: Number(item.stock_disponible ?? item.stock ?? 0),
      set: String(item.set_nombre || ''),
      rarity: String(item.rareza || '')
    }));
    const sealedEntries = sealed.map((product) => ({
      kind: 'sealed',
      key: `product-${product.row_id}`,
      product,
      name: product.nombre || '',
      price: Number(product.precio || 0),
      stock: Number(product.stock_disponible ?? product.stock ?? 0),
      set: '',
      rarity: ''
    }));
    let result = [...(view === 'sealed' ? [] : singles), ...(view === 'singles' ? [] : sealedEntries)];
    const minimum = minPrice === '' ? null : Number(minPrice);
    const maximum = maxPrice === '' ? null : Number(maxPrice);
    result = result.filter((entry) =>
      (availability !== 'stock' || entry.stock > 0)
      && (availability !== 'out' || entry.stock <= 0)
      && (!setName || entry.set === setName)
      && (!rarity || entry.rarity === rarity)
      && (minimum === null || entry.price >= minimum)
      && (maximum === null || entry.price <= maximum)
    );
    if (sort === 'price-asc') result.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
    if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'stock') result.sort((a, b) => b.stock - a.stock);
    return result;
  }, [rows, sealed, view, availability, setName, rarity, minPrice, maxPrice, sort]);

  const title = selectedGame?.nombre || 'Trading Card Games';
  const theme = themeForGame(selectedGame || {});
  const currency = store?.settings?.['public.store.currency'] || 'MXN';
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageEntries = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateParam(name, value) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      value && value !== 'all' ? next.set(name, value) : next.delete(name);
      return next;
    });
  }

  function clearFilters() {
    updateParam('q', '');
    updateParam('view', 'all');
    setAvailability('all');
    setSetName('');
    setRarity('');
    setMinPrice('');
    setMaxPrice('');
    setSort('relevance');
  }

  return <main className="public-page shiny-catalog-page tcg-public-page">
    <section className="shiny-catalog-hero" data-game-theme={theme}>
      <div className="shiny-catalog-hero-copy">
        <span className="shiny-breadcrumb"><Link to="/tienda">Inicio</Link> / {title}</span>
        <h1>{title}</h1>
        <p>{selectedGame?.descripcion || 'Cartas individuales, producto sellado y accesorios para jugar y coleccionar.'}</p>
        <div className="shiny-catalog-stats"><span><PublicIcon name="package" size={18}/><b>{rows.length + sealed.length}</b> productos</span><span><PublicIcon name="check" size={18}/>Stock actualizado</span></div>
      </div>
      <div className="shiny-catalog-art shiny-tcg-art" aria-hidden="true"><div className="shiny-art-deck"/><div className="shiny-art-box"/><div className="shiny-art-card"/></div>
    </section>

    {store?.zones?.TCG_TOP?.length ? <div className="shiny-managed-banner"><StoreSlideshow slides={store.zones.TCG_TOP} settings={store?.settings || {}} variant="wide"/></div> : null}

    <div className="shiny-subcategory-tabs">
      <button className={view === 'all' ? 'active' : ''} onClick={() => updateParam('view', 'all')}>Todas</button>
      <button className={view === 'singles' ? 'active' : ''} onClick={() => updateParam('view', 'singles')}>Cartas individuales</button>
      <button className={view === 'sealed' ? 'active' : ''} onClick={() => updateParam('view', 'sealed')}>Sellado y accesorios</button>
      <button onClick={() => setAvailability('stock')}>En stock</button>
    </div>

    <div className="shiny-mobile-catalog-tools">
      <button onClick={() => setFiltersOpen((value) => !value)}><PublicIcon name="filter" size={17}/>Filtros</button>
      <span>{entries.length} resultados</span>
    </div>

    <div className="shiny-catalog-layout">
      <aside className={'shiny-filter-panel ' + (filtersOpen ? 'is-open' : '')}>
        <div className="shiny-filter-title"><b>Filtros</b><button onClick={() => setFiltersOpen(false)} aria-label="Cerrar filtros"><PublicIcon name="close" size={18}/></button></div>
        <section>
          <h3>Juego</h3>
          <select className="shiny-filter-select" value={gameId} onChange={(event) => updateParam('gameId', event.target.value)}>
            <option value="">Todos los TCG</option>
            {games.map((game) => <option key={game.id_juego} value={game.id_juego}>{game.nombre}</option>)}
          </select>
        </section>
        <section>
          <h3>Buscar</h3>
          <label className="shiny-filter-search"><PublicIcon name="search" size={16}/><input value={q} onChange={(event) => updateParam('q', event.target.value)} placeholder="Carta, SKU o número"/></label>
        </section>
        <section>
          <h3>Disponibilidad</h3>
          <label><input type="radio" name="tcg-stock" checked={availability === 'all'} onChange={() => setAvailability('all')}/>Todos <span>{rows.length + sealed.length}</span></label>
          <label><input type="radio" name="tcg-stock" checked={availability === 'stock'} onChange={() => setAvailability('stock')}/>En stock <span>{[...rows, ...sealed].filter((item) => Number(item.stock_disponible ?? item.stock ?? 0) > 0).length}</span></label>
          <label><input type="radio" name="tcg-stock" checked={availability === 'out'} onChange={() => setAvailability('out')}/>Agotado</label>
        </section>
        {sets.length ? <section>
          <h3>Expansión</h3>
          <label className="shiny-filter-search"><PublicIcon name="search" size={16}/><select value={setName} onChange={(event) => setSetName(event.target.value)}><option value="">Todas las expansiones</option>{sets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          {sets.slice(0, 5).map((item) => <label key={item}><input type="radio" name="tcg-set" checked={setName === item} onChange={() => setSetName(item)}/>{item}<span>{rows.filter((row) => String(row.set_nombre || '') === item).length}</span></label>)}
        </section> : null}
        {rarities.length ? <section>
          <h3>Rareza</h3>
          <select className="shiny-filter-select" value={rarity} onChange={(event) => setRarity(event.target.value)}><option value="">Todas las rarezas</option>{rarities.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </section> : null}
        <section>
          <h3>Precio</h3>
          <div className="shiny-price-inputs"><input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Mínimo"/><i>–</i><input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Máximo"/></div>
        </section>
        <button className="shiny-clear-filters" onClick={clearFilters}><PublicIcon name="refresh" size={17}/>Limpiar filtros</button>
      </aside>

      <section className="shiny-catalog-results">
        <div className="shiny-results-toolbar">
          <div><b>Mostrando {entries.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(currentPage * PAGE_SIZE, entries.length)}</b> de {entries.length} productos</div>
          <label>Ordenar por:
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="relevance">Relevancia</option><option value="price-asc">Precio: menor a mayor</option><option value="price-desc">Precio: mayor a menor</option><option value="name">Nombre A–Z</option><option value="stock">Mayor disponibilidad</option>
            </select>
          </label>
        </div>

        {loading
          ? <div className="shiny-catalog-loading"><span/><span/><span/><span/></div>
          : pageEntries.length
            ? <div className="public-products-grid shiny-catalog-grid">{pageEntries.map((entry) => entry.kind === 'single' ? <TcgCard key={entry.key} item={entry.item} currency={currency}/> : <ProductCard key={entry.key} product={entry.product} currency={currency}/>)}</div>
            : <div className="shiny-empty-state"><div className="shiny-empty-icon"><PublicIcon name="search" size={29}/></div><h2>No encontramos productos</h2><p>Prueba con otros filtros o selecciona otro TCG.</p><button onClick={clearFilters}>Limpiar filtros</button></div>}

        {pageCount > 1 ? <nav className="shiny-pagination" aria-label="Paginación">
          <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).filter((number) => number === 1 || number === pageCount || Math.abs(number - currentPage) <= 1).map((number, index, array) => <span key={number}>{index > 0 && number - array[index - 1] > 1 ? <i>…</i> : null}<button className={number === currentPage ? 'active' : ''} onClick={() => setPage(number)}>{number}</button></span>)}
          <button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>›</button>
        </nav> : null}
      </section>
    </div>
  </main>;
}
