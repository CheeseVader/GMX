import { brandText } from "../../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCart } from '../../contexts/CartContext.jsx';
import { useClientAuth } from '../../contexts/ClientAuthContext.jsx';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import { publicApi, money } from '../../services/publicApi.js';
import GeoSelectFields from '../../components/public/GeoSelectFields.jsx';

export default function StoreCheckoutPage() {
  const cart = useCart();
  const clientAuth = useClientAuth();
  const { store } = usePublicStore();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [branches, setBranches] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [quote, setQuote] = useState(null);
  const [message, setMessage] = useState(searchParams.get('payment_cancelled') ? 'El pago con tarjeta fue cancelado. Tu carrito se conserva.' : '');
  const [saving, setSaving] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('TRANSFER');
  const [fulfillmentMethod, setFulfillmentMethod] = useState('DELIVERY');
  const [customer, setCustomer] = useState({
    name: '', email: '', phone: '', address: '', country: 'México', state: '', city: '', zip: '', settlement: ''
  });
  const currency = store?.settings?.['public.store.currency'] || 'MXN';

  useEffect(()=>{
    const items=cart.items.map(x=>({type:x.type,id:x.id,quantity:Number(x.quantity)}));
    if(!items.length){setBranches([]);setBranchId('');return;}
    publicApi('/api/public/branches/availability',{
      method:'POST',
      body:JSON.stringify({items})
    }).then(r=>{
      const rows=r.data||[];
      setBranches(rows);
      setBranchId(current=>rows.some(b=>b.id_sucursal===current)?current:(rows[0]?.id_sucursal||''));
      if(!rows.length)setMessage('No hay una sucursal con stock suficiente para todos los artÃ­culos del carrito.');
      else setMessage(current=>current.includes('No hay una sucursal con stock suficiente')?'':current);
    }).catch(e=>{setBranches([]);setBranchId('');setMessage(e.message);});
  },[cart.items]);

  useEffect(() => {
    if (!clientAuth.user) return;
    const u = clientAuth.user;
    setCustomer((x) => ({ ...x,
      name: u.nombre || x.name, email: u.email || x.email, phone: u.telefono || x.phone,
      address: u.direccion || x.address, country: u.pais || 'México', state: u.estado || x.state,
      city: u.ciudad || x.city, zip: u.cp || x.zip
    }));
    publicApi('/api/client/addresses').then((r) => {
      const rows = r.data || [];
      setAddresses(rows);
      const principal = rows.find((x) => x.principal) || rows[0];
      if (principal) {
        setSelectedAddressId(principal.id_direccion);
        setCustomer((x) => ({ ...x,
          address: principal.direccion || x.address, country: principal.pais || x.country,
          state: principal.estado || x.state, city: principal.ciudad || x.city, zip: principal.cp || x.zip
        }));
      }
    }).catch(() => {});
  }, [clientAuth.user?.id_cliente]);

  useEffect(() => {
    if (paymentMethod === 'CASH_STORE') setFulfillmentMethod('PICKUP');
    setQuote(null);
  }, [paymentMethod]);

  useEffect(() => {setQuote(null);}, [cart.subtotal, promoCode, branchId]);

  async function validatePromo() {
    try {
      const r = await publicApi('/api/public/benefits/quote', { method: 'POST', body: JSON.stringify({
          subtotal: cart.subtotal, promoCode, branchId,
          items: cart.items.map((x) => ({ type: x.type, id: x.id, quantity: x.quantity }))
        }) });
      setQuote(r.data);setMessage(r.data?.promotion ? 'Promoción aplicada.' : 'Código sin descuento aplicable.');
    } catch (e) {setQuote(null);setMessage(e.message);}
  }

  const effective = quote?.total ?? cart.subtotal;
  const loyalty = useMemo(() => {
    const percent = Number(store?.settings?.['loyalty.earn_percent'] || 1);
    const pointValue = Math.max(.0001, Number(store?.settings?.['loyalty.point_value_mxn'] || .1));
    return { percent, points: Math.max(0, Math.floor(effective * (percent / 100) / pointValue)) };
  }, [store, effective]);

  async function submit(e) {
    e.preventDefault();
    if (!cart.items.length || !branchId) {setMessage('No hay stock suficiente en una sola sucursal para completar el pedido.');return;}
    setSaving(true);setMessage('');
    try {
      const r = await publicApi('/api/public/checkout', { method: 'POST', body: JSON.stringify({
          branchId, promoCode, paymentMethod, fulfillmentMethod, customer,
          items: cart.items.map((x) => ({ type: x.type, id: x.id, quantity: x.quantity }))
        }) });
      const data = r.data;      cart.clear();

      if (paymentMethod === 'TRANSFER') {
        nav(`/tienda/pago/transferencia/${data.public_token}`, { replace: true });
        return;
      }

      const receiptWindow = window.open(`/tienda/comprobante/${data.public_token}`, 'shiny_receipt');
      if (!receiptWindow) setMessage('Tu navegador bloqueó la pestaña del comprobante. Puedes abrirlo desde la confirmación.');
      nav(`/tienda/pedido/${data.public_token}`, { replace: true, state: { checkoutResult: data } });
    } catch (e2) {
      const map = {
        CARD_GATEWAY_NOT_CONFIGURED: 'El pago con tarjeta todavía no tiene configurado el gateway Stripe en el servidor.',
        TRANSFER_ACCOUNT_NOT_CONFIGURED: 'Los datos bancarios para transferencia aún no están configurados.',
        DELIVERY_ADDRESS_REQUIRED: 'Selecciona una dirección completa para envío.',
        CUSTOMER_IDENTITY_CONFLICT: 'No podemos validar juntos ese correo y teléfono. Inicia sesión o contacta a soporte antes de continuar.',
        CUSTOMER_IDENTITY_INCONSISTENT: 'No pudimos validar la identidad del cliente. Inicia sesión o contacta a soporte.',
        PROMO_REQUIRES_IDENTIFIED_CLIENT: 'Esta promoción requiere iniciar sesión con una cuenta de cliente.',
        PROMO_CLIENT_USAGE_LIMIT_REACHED: 'Ya alcanzaste el límite de usos permitido para esta promoción.',
        PROMO_NOT_VALID_FOR_TCG: 'La promoción no aplica a las cartas TCG de este carrito.',
        PROMO_NOT_VALID_FOR_PRODUCTS: 'La promoción no aplica a los productos de este carrito.',
        PROMO_NOT_VALID_FOR_BRANCH: 'La promoción no está disponible en la sucursal seleccionada.',
        PROMO_NOT_VALID_FOR_CHANNEL: 'La promoción no está disponible en la tienda web.'
      };
      setMessage(map[e2.message] || e2.message);
    } finally {setSaving(false);}
  }

  if (!cart.items.length) return <main className="public-page"><div className="public-empty">Tu carrito está vacío.</div></main>;

  const pickup = fulfillmentMethod === 'PICKUP';
  return <main className="public-page">
    <div className="public-page-head"><small>FINALIZAR</small><h1>Checkout</h1><p>Revisa entrega, pago y datos de contacto antes de confirmar.</p>{!clientAuth.user ? <p className="checkout-account-hint">Puedes comprar como invitado o <a href="/tienda/cuenta">iniciar sesión / crear cuenta</a>.</p> : <p className="checkout-account-hint">Datos precargados desde <b>{clientAuth.user.email}</b>.</p>}</div>
    {message ? <div className="checkout-message">{message}</div> : null}
    <form className="checkout-layout" onSubmit={submit}>
      <section className="checkout-form-card">
        <h2>Datos del cliente</h2>
        <div className="checkout-fields">
          <label>Nombre completo<input required readOnly={Boolean(clientAuth.user)} value={customer.name} onChange={(e) => setCustomer((x) => ({ ...x, name: e.target.value }))} /></label>
          <label>Email<input required type="email" readOnly={Boolean(clientAuth.user)} value={customer.email} onChange={(e) => setCustomer((x) => ({ ...x, email: e.target.value }))} /></label>
          <label>Teléfono<input required inputMode="numeric" readOnly={Boolean(clientAuth.user)} value={customer.phone} onChange={(e) => setCustomer((x) => ({ ...x, phone: e.target.value.replace(/\D/g, '') }))} /></label>
        </div>

        <h2>Entrega</h2>
        <div className="fulfillment-grid">
          <label className={fulfillmentMethod === 'DELIVERY' ? 'selected' : ''}><input type="radio" name="fulfillment" value="DELIVERY" disabled={paymentMethod === 'CASH_STORE'} checked={fulfillmentMethod === 'DELIVERY'} onChange={(e) => setFulfillmentMethod(e.target.value)} /><span><b>🚚 Envío</b><small>Enviar a la dirección seleccionada.</small></span></label>
          <label className={fulfillmentMethod === 'PICKUP' ? 'selected' : ''}><input type="radio" name="fulfillment" value="PICKUP" checked={fulfillmentMethod === 'PICKUP'} onChange={(e) => setFulfillmentMethod(e.target.value)} /><span><b>🏪 Recoger en sucursal</b><small>Recoger en la sucursal seleccionada.</small></span></label>
        </div>

        {clientAuth.user ? <div className="checkout-master-lock">✓ Nombre, email y teléfono provienen del registro maestro de Clientes y no se modifican desde Checkout.</div> : null}

        {!pickup && clientAuth.user && addresses.length ? <label className="checkout-saved-address">Dirección guardada
          <select value={selectedAddressId} onChange={(e) => {
            setSelectedAddressId(e.target.value);
            const d = addresses.find((x) => x.id_direccion === e.target.value);
            if (d) setCustomer((x) => ({ ...x, address: d.direccion || '', country: d.pais || 'México', state: d.estado || '', city: d.ciudad || '', zip: d.cp || '' }));
          }}>
            {addresses.map((d) => <option key={d.id_direccion} value={d.id_direccion}>{d.alias || 'Dirección'}{d.principal ? ' · Principal' : ''} · {[d.ciudad, d.estado].filter(Boolean).join(', ')}</option>)}
          </select>
        </label> : null}

        {!pickup ? <GeoSelectFields value={customer} onChange={setCustomer} /> : null}

        <h2>{pickup ? 'Sucursal de recolección / pago' : 'Sucursal de surtido'}</h2>
        <select required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Selecciona sucursal</option>
          {branches.map((b) => <option key={b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal}{b.ciudad ? ` · ${b.ciudad}` : ''}</option>)}
        </select>
        {!branches.length?<div className="checkout-message">No hay una sucursal con stock suficiente para todo tu carrito. Ajusta cantidades o productos.</div>:null}

        <h2>Método de pago</h2>
        <div className="payment-method-grid">
          <label className={paymentMethod === 'TRANSFER' ? 'selected' : ''}><input type="radio" name="payment" value="TRANSFER" checked={paymentMethod === 'TRANSFER'} onChange={(e) => setPaymentMethod(e.target.value)} /><span><b>🏦 Transferencia</b><small>Después de confirmar mostraremos banco, cuenta, CLABE, referencia y carga de comprobante.</small></span></label>
          <label className={paymentMethod === 'CASH_STORE' ? 'selected' : ''}><input type="radio" name="payment" value="CASH_STORE" checked={paymentMethod === 'CASH_STORE'} onChange={(e) => setPaymentMethod(e.target.value)} /><span><b>🏪 Pago en sucursal</b><small>Selecciona dónde recoger y pagar. El pedido se confirma por correo.</small></span></label>
        </div>

        <h2>Promoción</h2>
        <div className="promo-entry"><input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Código promocional" /><button type="button" onClick={validatePromo}>Aplicar</button></div>
      </section>

      <aside className="checkout-summary">
        <h2>Tu pedido</h2>
        {cart.items.map((x) => <div className="checkout-line" key={x.key}><span>{x.quantity} × {x.name}</span><b>{money(Number(x.price) * Number(x.quantity), currency)}</b></div>)}
        <div className="checkout-line"><span>Subtotal</span><b>{money(cart.subtotal, currency)}</b></div>
        {quote?.discountPromo > 0 ? <div className="checkout-line discount"><span>Promoción</span><b>-{money(quote.discountPromo, currency)}</b></div> : null}
        <div className="checkout-line"><span>Entrega</span><b>{pickup ? 'Recoger en sucursal' : 'Envío'}</b></div>
        <div className="checkout-line"><span>Pago</span><b>{paymentMethod === 'TRANSFER' ? 'Transferencia' : 'En sucursal'}</b></div>
        <div className="checkout-grand"><span>Total</span><strong>{money(effective, currency)}</strong></div>
        {String(store?.settings?.['public.store.show_loyalty_estimate'] ?? 'true') === 'true' ? <div className="loyalty-estimate">⭐ Al confirmarse el pago, esta compra podría generar aproximadamente <b>{loyalty.points} puntos</b> con la regla actual de {loyalty.percent}%.</div> : null}
        <button disabled={saving || !branchId}>{saving ? 'Procesando…' : paymentMethod === 'TRANSFER' ? 'Generar instrucciones de transferencia' : 'Confirmar pedido en sucursal'}</button>
      </aside>
    </form>
  </main>;
}
