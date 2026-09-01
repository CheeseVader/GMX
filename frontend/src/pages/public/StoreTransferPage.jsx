import { useEffect,useState } from 'react';
import { Link,useParams,useNavigate } from 'react-router';
import { publicApi,money } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import { useCart } from '../../contexts/CartContext.jsx';


/* GMX_BANK_OPTIONS_R15A */
const MEXICAN_BANKS=[
  'ABC CAPITAL','AFIRME','AMERICAN EXPRESS','BANBAJIO','BANCO AZTECA','BANCO BASE',
  'BANCO COVALTO','BANCO FINTERRA','BANCO INBURSA','BANCO INVEX','BANCO MONEX',
  'BANCO MULTIVA','BANCO SABADELL','BANCO VE POR MAS','BANCOPPEL','BANCREA',
  'BANJERCITO','BANK OF AMERICA','BANK OF CHINA','BANKAOOL','BANORTE','BANREGIO',
  'BANSI','BARCLAYS','BBVA','BIENESTAR','BNP PARIBAS','CIBANCO','CITIBANAMEX',
  'COMPARTAMOS BANCO','CONSUBANCO','CREDICLUB','CREDIT SUISSE','DEUTSCHE BANK',
  'FINAMEX','FINCOMUN','GBM','HSBC','ICBC','INTERCAM BANCO','JP MORGAN','KUSPIT',
  'MASARI','MIFEL','MIZUHO BANK','MUFG BANK','NU','OPENBANK','PAGATODO',
  'SANTANDER','SCOTIABANK','SHINHAN BANK','STP','UALA','VECTOR','VOLKSWAGEN BANK'
];
export default function StoreTransferPage(){
  const {token}=useParams();
  const nav=useNavigate();
  const cart=useCart();
  const {store}=usePublicStore();
  const [order,setOrder]=useState(null);
  const [bank,setBank]=useState(null);
  const [message,setMessage]=useState('');
  const [proofSuccess,setProofSuccess]=useState(null);
  const [bankOrigin,setBankOrigin]=useState('');
  const [reference,setReference]=useState('');
  const [paymentDate,setPaymentDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [amount,setAmount]=useState('');
  const [uploading,setUploading]=useState(false);
  const currency=store?.settings?.['public.store.currency']||'MXN';

  useEffect(()=>{
    Promise.all([publicApi(`/api/public/orders/${token}`),publicApi('/api/payments/transfer/settings')])
      .then(([o,b])=>{setOrder(o.data);setBank(b.data);})
      .catch(e=>setMessage(e.message));
  },[token]);

  async function upload(file){
    if(!bankOrigin){
      setMessage('Selecciona el banco de origen antes de subir el comprobante.');
      return;
    }
    if(!file)return;
    const reportedAmount=Number(amount||order?.total||0);
    if(!bankOrigin.trim()||!reference.trim()||!paymentDate||reportedAmount<=0){
      setMessage('Completa banco, referencia, fecha e importe antes de subir el comprobante.');
      return;
    }
    if(!file)return;
    setUploading(true);setMessage('');
    try{
      const data=await new Promise((resolve,reject)=>{
        const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);
      });
      await publicApi(`/api/payments/transfer/${token}/proof`,{method:'POST',body:JSON.stringify({file:{name:file.name,mime:file.type,data},transfer:{bankOrigin,reference,paymentDate,amount:Number(amount||order?.total||0)}})});
      if(typeof setBankOrigin==='function')setBankOrigin('');
      if(typeof setReference==='function')setReference('');
      if(typeof setPaymentDate==='function')setPaymentDate(new Date().toISOString().slice(0,10));
      if(typeof setAmount==='function')setAmount('');
      cart.clear();
      setOrder(x=>({...x,transfer_proof_status:'RECEIVED'}));
      setMessage('');
      setProofSuccess({
        orderId:order?.id_pedido||'',
        receipt:order?.numero_comprobante||order?.id_pedido||'',
        fileName:file?.name||'Comprobante',
        total:order?.total||0
      });
      setMessage('Comprobante recibido. Enviamos una confirmaci'+String.fromCharCode(243)+'n por correo.');
}catch(e){setMessage(e.message);}finally{setUploading(false);}
  }
  function finishTransfer(){
    setProofSuccess(null);
    cart.clear();
    nav('/tienda',{replace:true});
  }
if(!order||!bank)return <main className="public-page"><div className="public-empty">{message||'Cargando instrucciones…'}</div></main>;

  return <main className="public-page">
    <div className="public-page-head"><small>TRANSFERENCIA</small><h1>Realiza tu transferencia</h1><p>Usa exactamente la referencia indicada para identificar tu pedido.</p></div>
    {message?<div className="checkout-message">{message}</div>:null}
    <div className="transfer-layout">
      <section className="bank-card">
        <h2>Datos bancarios</h2>
        <div><span>Banco</span><b>{bank.bank_name||'Por configurar'}</b></div>
        <div><span>Titular</span><b>{bank.account_holder||'Por configurar'}</b></div>
        <div><span>Cuenta</span><b>{bank.account_number||'—'}</b></div>
        <div><span>CLABE</span><b>{bank.clabe||'—'}</b></div>
        <div className="bank-reference"><span>Referencia</span><strong>{order.numero_comprobante||order.id_pedido}</strong></div>
        <p>{bank.instructions}</p>
      </section>
      <aside className="transfer-order">
        <h2>{order.id_pedido}</h2><div className="checkout-grand"><span>Total a transferir</span><strong>{money(order.total,currency)}</strong></div>
                <div className="transfer-proof-fields">
          <label>
            <span>Banco de origen</span>
            <select required value={bankOrigin} onChange={e=>setBankOrigin(e.target.value)}>
              <option value="">Selecciona banco</option>
              {MEXICAN_BANKS.map(bankName=><option key={bankName} value={bankName}>{bankName}</option>)}
            </select>
          </label>
          <label>
            <span>Referencia / folio</span>
            <input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Referencia bancaria" />
          </label>
          <label>
            <span>Fecha de pago</span>
            <input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)} />
          </label>
          <label>
            <span>Importe transferido</span>
            <input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={String(order.total||'')} />
          </label>
        </div><label className="proof-upload">{uploading?'Subiendo…':order.transfer_proof_status==='RECEIVED'?'✓ Comprobante recibido':'Subir comprobante de transferencia'}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={uploading} onChange={e=>upload(e.target.files?.[0])}/></label>
        <small>{'Formatos: JPG, PNG, WebP o PDF. M'+String.fromCharCode(225)+'ximo 10 MB.'}</small>
        <Link className="secondary-public full" target="_blank" to={`/tienda/comprobante/${token}`}>Imprimir pedido / comprobante</Link>
      </aside>
    </div>
    {proofSuccess?<div className="gmx-transfer-success-backdrop" role="presentation">
      <div className="gmx-transfer-success-dialog" role="dialog" aria-modal="true" aria-labelledby="gmx-transfer-success-title">
        <div className="gmx-transfer-success-icon">{String.fromCharCode(10003)}</div>

        <div className="gmx-transfer-success-copy">
          <small>TRANSFERENCIA REGISTRADA</small>
          <h2 id="gmx-transfer-success-title">Comprobante recibido</h2>
          <p>{'Recibimos correctamente tu comprobante. El pago qued'+String.fromCharCode(243)+' '}<b>por verificar</b>{' y ser'+String.fromCharCode(225)+' validado por administraci'+String.fromCharCode(243)+'n.'}</p>
        </div>

        <div className="gmx-transfer-success-data">
          <div><span>Pedido</span><b>{proofSuccess.orderId||'â€”'}</b></div>
          <div><span>Referencia</span><b>{proofSuccess.receipt||'â€”'}</b></div>
          <div><span>Archivo</span><b>{proofSuccess.fileName||'â€”'}</b></div>
          <div><span>Importe del pedido</span><b>{money(proofSuccess.total,currency)}</b></div>
        </div>

        <div className="gmx-transfer-success-actions">
          <Link className="secondary-public" target="_blank" to={`/tienda/comprobante/${token}`}>Ver / imprimir pedido</Link>
          <button type="button" onClick={finishTransfer}>Volver a la tienda</button>
        </div>
      </div>
    </div>:null}
  </main>;
}
