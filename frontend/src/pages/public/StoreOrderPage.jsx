import { useEffect,useState } from 'react';
import { Link,useParams } from 'react-router';
import { publicApi,money } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';

export default function StoreOrderPage(){
  const {token}=useParams();
  const {store}=usePublicStore();
  const [order,setOrder]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{publicApi(`/api/public/orders/${token}`).then(r=>setOrder(r.data)).catch(e=>setError(e.message));},[token]);
  const currency=store?.settings?.['public.store.currency']||'MXN';
  if(error)return <main className="public-page"><div className="public-empty">{error}</div></main>;
  if(!order)return <main className="public-page"><div className="public-empty">Consultando pedido…</div></main>;
  return <main className="public-page">
    <div className="order-success">
      <div className="success-icon">✓</div><small>PEDIDO RECIBIDO</small><h1>{order.id_pedido}</h1>
      <p>{'Guardamos tu solicitud. El estado actual es '}<b>{order.estado_pedido}</b>{' y el pago est'+String.fromCharCode(225)+' '}<b>{order.estado_pago||'PENDIENTE'}</b>.</p>
      {order.email_confirmacion_estado?<p className="order-email-state">{'Confirmaci'+String.fromCharCode(243)+'n por correo: '}<b>{order.email_confirmacion_estado}</b></p>:null}
      <div className="order-data"><span>Cliente <b>{order.nombre_cliente}</b></span><span>Sucursal <b>{order.sucursal}</b></span><span>Total <b>{money(order.total,currency)}</b></span></div>
    </div>
    <section className="order-detail-public"><h2>Detalle</h2>{(order.detalles||[]).map((x,i)=><div className="checkout-line" key={i}><span>{x.cantidad} × {x.producto}<small>{x.detalle||x.sku}</small></span><b>{money(x.subtotal,currency)}</b></div>)}</section>
    <div className="order-actions"><Link className="public-cta" to={`/tienda/comprobante/${token}`} target="_blank">Abrir comprobante</Link><Link className="secondary-public" to="/tienda">Volver a inicio</Link><Link className="secondary-public" to="/tienda/catalogo">Seguir comprando</Link></div>
  </main>;
}
