import { brandText } from "../../config/brand.js";import { Link } from 'react-router';
import { useCart } from '../../contexts/CartContext.jsx';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import { money } from '../../services/publicApi.js';

export default function StoreCartPage() {
  const cart = useCart();
  const { store } = usePublicStore();
  const currency = store?.settings?.['public.store.currency'] || 'MXN';
  return <main className="public-page">
    <div className="public-page-head"><small>COMPRA</small><h1>Carrito</h1><p>{cart.count} artículo(s) seleccionados.</p></div>
    {!cart.items.length ? <div className="public-empty"><h2>Tu carrito está vacío</h2><Link className="public-cta" to="/tienda/catalogo">Explorar catálogo</Link></div> : <div className="cart-layout">
      <section className="public-cart-list">
        {cart.items.map((x) => <article className="public-cart-row" key={x.key}>
          <div className="cart-thumb">{x.image ? <img src={x.image} alt={x.name} /> : <div className="public-image-placeholder">{brandText("GMX")}</div>}</div>
          <div className="cart-copy"><small>{x.type}{x.detail ? ` · ${x.detail}` : ''}</small><h3>{x.name}</h3><span>{money(x.price, currency)} c/u</span></div>
          <input type="number" min="1" max={x.stock || 999} value={x.quantity} onChange={(e) => cart.setQuantity(x.key, e.target.value)} />
          <strong>{money(Number(x.price) * Number(x.quantity), currency)}</strong>
          <button className="remove-cart" onClick={() => cart.removeItem(x.key)}>Eliminar</button>
        </article>)}
      </section>
      <aside className="cart-summary"><h2>Resumen</h2><div><span>Subtotal</span><b>{money(cart.subtotal, currency)}</b></div><div><span>Envío</span><b>Por definir</b></div><div className="cart-total"><span>Total provisional</span><strong>{money(cart.subtotal, currency)}</strong></div><Link className="public-cta full" to="/tienda/checkout">Continuar al checkout</Link></aside>
    </div>}
  </main>;
}
