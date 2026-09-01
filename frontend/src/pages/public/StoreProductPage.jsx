import { brandText } from "../../config/brand.js";import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { publicApi, money } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import { useCart } from '../../contexts/CartContext.jsx';

export default function StoreProductPage() {
  const { rowId } = useParams();
  const { store, liveUpdate } = usePublicStore();
  const cart = useCart();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {publicApi(`/api/public/products/${rowId}`).then((r) => setItem(r.data)).catch((e) => setError(e.message));}, [rowId]);

  useEffect(() => {
    if (!liveUpdate?.version || !item) return;
    const hit = (liveUpdate.changes || []).find((c) => c.type === 'PRODUCT' && String(c.id) === String(item.id));
    if (hit) setItem((x) => ({ ...x, stock_disponible: Number(hit.stock) }));
  }, [liveUpdate?.version]);

  const currency = store?.settings?.['public.store.currency'] || 'MXN';
  if (error) return <main className="public-page"><div className="public-empty">{error}</div></main>;
  if (!item) return <main className="public-page"><div className="public-empty">Cargando producto…</div></main>;
  const stock = Number(item.stock_disponible || 0);
  return <main className="public-page">
    <div className="product-detail">
      <div className="product-detail-image">{item.imagen ? <img src={item.imagen} alt={item.nombre} /> : <div className="public-image-placeholder">{brandText("GMX")}</div>}</div>
      <div className="product-detail-info">
        <Link to="/tienda/catalogo">← Volver al catálogo</Link>
        <small>{item.categoria || 'Producto'} · {item.sku || item.id}</small>
        <h1>{item.nombre}</h1>
        <div className="product-detail-price">{money(item.precio, currency)}</div>
        <p>{item.descripcion || brandText("Producto disponible en GMX.")}</p>
        <div className={`stock-pill ${stock > 0 ? 'ok' : 'out'}`}>{stock > 0 ? `${stock} disponibles` : 'Agotado'}</div>
        <button disabled={stock <= 0} onClick={() => cart.addItem({ type: 'PRODUCT', id: item.id, rowId: item.row_id, name: item.nombre, sku: item.sku, price: Number(item.precio), image: item.imagen || '', stock })}>Agregar al carrito</button>
      </div>
    </div>
  </main>;
}
