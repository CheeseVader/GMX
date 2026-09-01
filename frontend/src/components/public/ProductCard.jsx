import { brandText } from '../../config/brand.js';
import { Link } from 'react-router';
import { useState } from 'react';
import { money } from '../../services/publicApi.js';
import { useCart } from '../../contexts/CartContext.jsx';
import PublicIcon from './PublicIcon.jsx';

function imgSrc(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || /^data:/i.test(value) || value.startsWith('/')) return value;
  return value;
}
export default function ProductCard({ product, currency = 'MXN' }) {
  const cart = useCart();
  const [favorite, setFavorite] = useState(false);
  const [added, setAdded] = useState(false);
  const stock = Number(product.stock_disponible ?? product.stock ?? 0);
  const regularPrice = Number(product.precio_regular || 0);
  const currentPrice = Number(product.precio || 0);

  function addToCart() {
    cart.addItem({ type: 'PRODUCT', id: product.id, rowId: product.row_id, name: product.nombre, sku: product.sku, price: currentPrice, image: product.imagen || '', stock });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }

  return <article className="public-product-card shiny-product-card">
    <Link to={`/tienda/producto/${product.row_id}`} className="product-card-image">
      {product.imagen ? <img src={imgSrc(product.imagen)} alt={product.nombre || ''} loading="lazy" /> : <div className="public-image-placeholder shiny-image-fallback"><span>{brandText('GMX')}</span><small>Imagen próximamente</small></div>}
    </Link>
    <button type="button" className={`shiny-favorite ${favorite ? 'active' : ''}`} aria-label={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'} onClick={() => setFavorite((value) => !value)}><PublicIcon name="heart" size={18} /></button>
    <div className="public-product-body">
      <small>{product.categoria || 'Producto'}</small>
      <Link to={`/tienda/producto/${product.row_id}`}><h3>{product.nombre}</h3></Link>
      <div className="shiny-card-price-row">
        <div>{regularPrice > currentPrice ? <del>{money(regularPrice, currency)}</del> : null}<div className="public-product-price">{money(currentPrice, currency)}</div></div>
        <span className={`shiny-stock-badge ${stock > 0 ? 'ok' : 'out'}`}>{stock > 0 ? `${stock} disponible${stock === 1 ? '' : 's'}` : 'Agotado'}</span>
      </div>
      <button disabled={stock <= 0} onClick={addToCart}>
        {stock <= 0 ? 'Agotado' : added ? 'Agregado' : <>Agregar <PublicIcon name={added ? 'check' : 'cart'} size={16} /></>}
      </button>
    </div>
  </article>;
}
