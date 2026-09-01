import {useEffect,useMemo,useState} from 'react';
import {api} from '../services/api.js';
import './transferPaymentsAdmin.css';

const TXT={
  phone:'Tel\u00e9fono',
  deliveryHome:'Env\u00edo a domicilio',
  address:'Direcci\u00f3n de entrega',
  willBe:' ser\u00e1 cancelado y su inventario reservado se liberar\u00e1.',
  close:'\u00d7'
};

const money=v=>new Intl.NumberFormat('es-MX',{
  style:'currency',
  currency:'MXN'
}).format(Number(v||0));

const meta=x=>
  x?.metadata_json&&typeof x.metadata_json==='object'
    ? x.metadata_json
    : {};

const paymentLabel=x=>{
  if(x.estado==='REJECTED')return 'RECHAZADO';
  if(x.estado==='PAID')return 'PAGADO';
  if(x.estado==='PROOF_RECEIVED')return 'POR VERIFICAR';
  if(x.estado==='AWAITING_TRANSFER')return 'ESPERANDO TRANSFERENCIA';
  return x.estado||'-';
};

const orderLabel=x=>{
  if(x.estado==='REJECTED')return 'CANCELADO';
  if(x.estado==='PAID')return 'COMPLETADO';

  const orderState=String(x.estado_pedido||'').toUpperCase();

  if(orderState.includes('CANCEL'))return 'CANCELADO';
  if(orderState==='PAGADO')return 'COMPLETADO';

  return x.estado_pedido||'-';
};

export default function TransferPaymentsAdminPage(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [rejectRow,setRejectRow]=useState(null);
  const [rejectReason,setRejectReason]=useState('');
  const [rejecting,setRejecting]=useState(false);
  const [customerRow,setCustomerRow]=useState(null);

  const load=async()=>{
    setLoading(true);
    try{
      const r=await api('/api/v1/transfer-payments');
      setRows(r.data||[]);
      setMessage('');
    }catch(e){
      setMessage(e.message);
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{load();},[]);

  const pending=useMemo(
    ()=>rows.filter(x=>x.estado==='PROOF_RECEIVED').length,
    [rows]
  );

  const approve=async(x)=>{
    const ok=window.confirm(
      `Aprobar transferencia del pedido ${x.id_pedido}?`
    );

    if(!ok)return;

    try{
      await api(`/api/v1/transfer-payments/${x.row_id}/approve`,{
        method:'POST',
        body:'{}'
      });

      await load();
    }catch(e){
      setMessage(e.message);
    }
  };

  const openReject=x=>{
    setRejectRow(x);
    setRejectReason('');
    setMessage('');
  };

  const closeReject=()=>{
    if(rejecting)return;
    setRejectRow(null);
    setRejectReason('');
  };

  const confirmReject=async()=>{
    if(!rejectRow)return;

    const reason=rejectReason.trim();

    if(!reason){
      setMessage('Escribe el motivo del rechazo.');
      return;
    }

    setRejecting(true);

    try{
      await api(`/api/v1/transfer-payments/${rejectRow.row_id}/reject`,{
        method:'POST',
        body:JSON.stringify({reason})
      });

      setRejectRow(null);
      setRejectReason('');
      await load();
    }catch(e){
      setMessage(e.message);
    }finally{
      setRejecting(false);
    }
  };

  return <div className="tr-admin">
    <div className="tr-head">
      <div>
        <small>PAGOS WEB</small>
        <h1>Transferencias</h1>
        <p>Valida los comprobantes recibidos desde la tienda.</p>
      </div>

      <div className="tr-count">
        {pending}
        <span>por verificar</span>
      </div>
    </div>

    {message?<div className="tr-msg">{message}</div>:null}

    <div className="tr-table">
      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Cliente</th>
            <th>Banco / referencia</th>
            <th>Importe</th>
            <th>Comprobante</th>
            <th>Estado pago</th>
            <th>Pedido</th>
            <th>Acciones</th>
          </tr>
        </thead>

        <tbody>
          {loading
            ? <tr><td colSpan="8">Cargando...</td></tr>
            : rows.map(x=>{
                const m=meta(x);

                return <tr key={x.row_id}>
                  <td>
                    <b>{x.id_pedido}</b>
                    <small>{x.numero_comprobante||''}</small>
                  </td>

                  <td>
                    <b>{x.nombre_cliente||'-'}</b>
                    <small>{x.email||''}</small>

                    <button
                      type="button"
                      className="tr-link-btn"
                      onClick={()=>setCustomerRow(x)}
                    >
                      Datos del cliente
                    </button>
                  </td>

                  <td>
                    {m.bank_origin||'-'}
                    <small>
                      {m.customer_reference||x.referencia||'-'}
                      {m.payment_date?` - ${m.payment_date}`:''}
                    </small>
                  </td>

                  <td>
                    {money(m.reported_amount||x.monto||x.total)}
                  </td>

                  <td>
                    {x.proof_path
                      ? <a
                          target="_blank"
                          rel="noreferrer"
                          href={`/api/v1/transfer-payments/${x.row_id}/proof`}
                        >
                          Ver comprobante
                        </a>
                      : 'Sin archivo'}
                  </td>

                  <td>
                    <b className={
                      x.estado==='REJECTED'
                        ? 'tr-red'
                        : x.estado==='PAID'
                          ? 'tr-green'
                          : ''
                    }>
                      {paymentLabel(x)}
                    </b>
                  </td>

                  <td>
                    <b className={
                      x.estado==='REJECTED'
                        ? 'tr-red'
                        : x.estado==='PAID'
                          ? 'tr-green'
                          : ''
                    }>
                      {orderLabel(x)}
                    </b>
                  </td>

                  <td>
                    <div className="tr-actions">
                      {x.estado==='PROOF_RECEIVED'
                        ? <>
                            <button
                              type="button"
                              onClick={()=>approve(x)}
                            >
                              Aprobar
                            </button>

                            <button
                              type="button"
                              className="danger"
                              onClick={()=>openReject(x)}
                            >
                              Rechazar
                            </button>
                          </>
                        : <span className="tr-done">
                            {x.estado==='PAID'
                              ? 'Validado'
                              : x.estado==='REJECTED'
                                ? 'Rechazado'
                                : x.estado==='AWAITING_TRANSFER'
                                  ? 'Pendiente'
                                  : '-'}
                          </span>}
                    </div>
                  </td>
                </tr>;
              })}
        </tbody>
      </table>
    </div>

    {rejectRow
      ? <div
          className="tr-modal-backdrop"
          onMouseDown={e=>{
            if(e.target===e.currentTarget)closeReject();
          }}
        >
          <div
            className="tr-modal tr-reject-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-reject-title"
          >
            <div className="tr-modal-head">
              <div>
                <small>RECHAZAR TRANSFERENCIA</small>
                <h2 id="transfer-reject-title">
                  Motivo del rechazo
                </h2>
              </div>

              <button
                type="button"
                className="tr-modal-x"
                aria-label="Cerrar"
                onClick={closeReject}
              >
                {TXT.close}
              </button>
            </div>

            <p>
              {'Al confirmar, el pedido '}
              <b>{rejectRow.id_pedido}</b>
              {TXT.willBe}
            </p>

            <label className="tr-reason-label">
              Motivo

              <textarea
                autoFocus
                rows="5"
                maxLength="500"
                value={rejectReason}
                onChange={e=>setRejectReason(e.target.value)}
                placeholder="Escribe el motivo del rechazo..."
              />

              <small>{rejectReason.length}/500</small>
            </label>

            <div className="tr-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={closeReject}
                disabled={rejecting}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="danger-solid"
                onClick={confirmReject}
                disabled={rejecting||!rejectReason.trim()}
              >
                {rejecting
                  ? 'Rechazando...'
                  : 'Rechazar transferencia'}
              </button>
            </div>
          </div>
        </div>
      : null}

    {customerRow
      ? <div
          className="tr-modal-backdrop"
          onMouseDown={e=>{
            if(e.target===e.currentTarget)setCustomerRow(null);
          }}
        >
          <div
            className="tr-modal tr-customer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-customer-title"
          >
            <div className="tr-modal-head">
              <div>
                <small>DATOS DEL CLIENTE</small>
                <h2 id="transfer-customer-title">
                  {customerRow.nombre_cliente||'Cliente'}
                </h2>
              </div>

              <button
                type="button"
                className="tr-modal-x"
                aria-label="Cerrar"
                onClick={()=>setCustomerRow(null)}
              >
                {TXT.close}
              </button>
            </div>

            <div className="tr-customer-grid">
              <div>
                <span>Correo</span>
                <b>{customerRow.email||'-'}</b>
              </div>

              <div>
                <span>{TXT.phone}</span>
                <b>{customerRow.telefono||'-'}</b>
              </div>

              <div>
                <span>Entrega</span>
                <b>
                  {String(customerRow.tipo_entrega||'').toUpperCase()==='DELIVERY'
                    ? TXT.deliveryHome
                    : 'Recoger en sucursal'}
                </b>
              </div>

              <div>
                <span>Sucursal</span>
                <b>{customerRow.sucursal||'-'}</b>
              </div>
            </div>

            <div className="tr-address">
              <span>{TXT.address}</span>
              <b>{customerRow.direccion||'-'}</b>
              <p>
                {[customerRow.ciudad,customerRow.estado_direccion,customerRow.cp]
                  .filter(Boolean)
                  .join(', ')||'-'}
              </p>
            </div>

            <div className="tr-modal-actions">
              <button
                type="button"
                onClick={()=>setCustomerRow(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      : null}
  </div>;
}