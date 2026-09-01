import {brandText} from '../../config/brand.js';
import {useEffect,useState} from 'react';
import {useParams} from 'react-router';
import {publicApi,money} from '../../services/publicApi.js';
import {usePublicStore} from '../../contexts/PublicStoreContext.jsx';

const ch=(n)=>String.fromCharCode(n);

export default function StoreReceiptPage(){
  const {token}=useParams();
  const {store}=usePublicStore();
  const [order,setOrder]=useState(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    publicApi(`/api/public/orders/${token}`)
      .then(r=>setOrder(r.data))
      .catch(e=>setError(e.message));
  },[token]);

  const currency=store?.settings?.['public.store.currency']||'MXN';

  if(error)return <main className="receipt-page">{error}</main>;
  if(!order)return <main className="receipt-page">{'Cargando comprobante'+ch(8230)}</main>;

  return <main className="receipt-page">
    <div className="receipt-actions no-print">
      <button type="button" onClick={()=>window.print()}>Imprimir / Guardar PDF</button>
    </div>

    <article className="receipt-paper">
      <header>
        <div className="receipt-logo">{brandText('GMX')}</div>
        <div>
          <h1>Comprobante de pedido</h1>
          <b>{order.numero_comprobante||order.id_pedido}</b>
        </div>
      </header>

      <div className="receipt-meta">
        <span>Pedido <b>{order.id_pedido}</b></span>
        <span>Fecha <b>{new Date(order.fecha).toLocaleString('es-MX')}</b></span>
        <span>Estado <b>{order.estado_pedido}</b></span>
        <span>
          Pago <b>{order.metodo_pago_publico||'PENDIENTE'}{' '+ch(183)+' '}{order.estado_pago||'PENDIENTE'}</b>
        </span>
      </div>

      <section>
        <h2>Cliente</h2>
        <p>
          {order.nombre_cliente}<br/>
          {order.email||''}<br/>
          {order.telefono||''}
        </p>
      </section>

      {String(order.tipo_entrega||'').toUpperCase()==='DELIVERY'
        ? <section>
            <h2>{'Direcci'+ch(243)+'n de entrega'}</h2>
            <p>
              {order.direccion||'-'}<br/>
              {[order.ciudad,order.estado,order.cp].filter(Boolean).join(', ')}
            </p>
          </section>
        : <section>
            <h2>Entrega</h2>
            <p>Recoger en sucursal<br/>{order.sucursal||'-'}</p>
          </section>}

      <section>
        <h2>Detalle</h2>
        {(order.detalles||[]).map((x,i)=>
          <div className="receipt-line" key={i}>
            <span>
              {x.cantidad}{' '+ch(215)+' '}{x.producto}
              <small>{x.detalle||x.sku||''}</small>
            </span>
            <b>{money(x.subtotal,currency)}</b>
          </div>
        )}
      </section>

      <div className="receipt-totals">
        <div><span>Subtotal</span><b>{money(order.subtotal,currency)}</b></div>
        {Number(order.descuento_promocion)>0
          ? <div><span>Descuento</span><b>-{money(order.descuento_promocion,currency)}</b></div>
          : null}
        <div className="grand"><span>Total</span><strong>{money(order.total,currency)}</strong></div>
      </div>

      <footer>
        {'Este comprobante confirma la recepci'+ch(243)+'n del pedido. El pago y la disponibilidad se confirman seg'+ch(250)+'n el estado mostrado.'}
      </footer>
    </article>
  </main>;
}