import { brandText } from "../../config/brand.js";import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { publicApi } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import ProductCard from '../../components/public/ProductCard.jsx';
import TcgCard from '../../components/public/TcgCard.jsx';

export default function StoreSearchPage() {
  const [params] = useSearchParams();
  const { store } = usePublicStore();
  const q = params.get('q') || '';
  const [data, setData] = useState({ products: [], tcg: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currency = store?.settings?.['public.store.currency'] || 'MXN';

  useEffect(() => {
    setLoading(true);setError('');
    publicApi(`/api/public/search?q=${encodeURIComponent(q)}&limit=30`).
    then((r) => setData(r.data || { products: [], tcg: [] })).
    catch((e) => setError(e.message)).
    finally(() => setLoading(false));
  }, [q]);

  return <main className="public-page">
    <div className="public-page-head"><small>{brandText("BÚSQUEDA GMX")}</small><h1>{q ? `Resultados para “${q}”` : 'Buscar'}</h1><p>Resultados unificados de productos y cartas TCG disponibles.</p></div>
    {loading ? <div className="public-empty">Buscando…</div> : error ? <div className="public-empty">{error}</div> : <>
      <section className="public-search-section">
        <div className="public-section-head"><div><small>PRODUCTOS</small><h2>{data.products?.length || 0} resultados</h2></div></div>
        {data.products?.length ? <div className="public-products-grid">{data.products.map((p) => <ProductCard key={p.row_id} product={p} currency={currency} />)}</div> : <div className="public-empty small">Sin productos coincidentes.</div>}
      </section>
      <section className="public-search-section">
        <div className="public-section-head"><div><small>TCG</small><h2>{data.tcg?.length || 0} variantes</h2></div></div>
        {data.tcg?.length ? <div className="public-products-grid">{data.tcg.map((x) => <TcgCard key={x.row_id} item={x} currency={currency} />)}</div> : <div className="public-empty small">Sin cartas coincidentes.</div>}
      </section>
    </>}
  </main>;
}
