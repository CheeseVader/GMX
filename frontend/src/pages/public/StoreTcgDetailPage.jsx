import { brandText } from "../../config/brand.js";import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { publicApi, money } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import { useCart } from '../../contexts/CartContext.jsx';

export default function StoreTcgDetailPage() {
  const { rowId } = useParams();
  const { store } = usePublicStore();
  const cart = useCart();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {publicApi(`/api/public/tcg/item/${rowId}`).then((r) => setItem(r.data)).catch((e) => setError(e.message));}, [rowId]);
  const currency = store?.settings?.['public.store.currency'] || 'MXN';

  if (error) return <main className="public-page"><div className="public-empty">{error}</div></main>;
  if (!item) return <main className="public-page"><div className="public-empty">Cargando carta…</div></main>;

  const stock = Number(item.stock_disponible || 0);
  return <main className="public-page">
    <div className="product-detail tcg-public-detail">
      <div className="product-detail-image">{item.imagen_principal ? <img src={item.imagen_principal} alt={item.carta} /> : <div className="public-image-placeholder">TCG</div>}</div>
      <div className="product-detail-info">
        <Link to={`/tienda/tcg?gameId=${encodeURIComponent(item.id_juego || '')}`}>← Volver a {item.juego || 'TCG'}</Link>
        <small>{[item.juego, item.set_nombre, item.numero_completo].filter(Boolean).join(' · ')}</small>
        <h1>{item.carta}{item.rareza ? ` (${item.rareza})` : ''}</h1>
        <div className="tcg-detail-badges">
          {[item.rareza, item.condicion, item.idioma, item.acabado, item.edicion].filter(Boolean).map((x) => <span key={x}>{x}</span>)}
        </div>
        <div className="product-detail-price">{money(item.precio, currency)}</div>
        {Number(item.precio_regular) > Number(item.precio) ? <div className="public-regular-price">Precio regular {money(item.precio_regular, currency)}</div> : null}
        <p>{item.descripcion || brandText("Variante física disponible en GMX.")}</p>
        <div className={`stock-pill ${stock > 0 ? 'ok' : 'out'}`}>{stock > 0 ? `${stock} disponibles` : 'Agotado'}</div>
        <button disabled={stock <= 0} onClick={() => cart.addItem({
          type: 'TCG', id: item.id_inventario, rowId: item.row_id, name: item.carta, sku: item.sku,
          price: Number(item.precio), image: item.imagen_principal || '', stock,
          detail: [item.numero_completo, item.rareza, item.condicion, item.idioma, item.acabado].filter(Boolean).join(' · ')
        })}>Agregar al carrito</button>
      </div>
    </div>
  </main>;
}
