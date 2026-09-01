import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import './MembershipCredentialModal.css';

const dateMx=(v)=>{
  if(!v)return '—';
  try{return new Date(v).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});}
  catch{return String(v);}
};
const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const memberCode=(m)=>String(m?.codigo_membresia||`GMX-M-${String(m?.id||'').padStart(8,'0')}`).trim();
const visual=(m)=>String(m?.imagen||m?.tcg_imagen||'').trim();

function PrintIcon(){
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="18" cy="11" r="1" fill="currentColor"/></svg>;
}

export default function MembershipCredentialModal({membership,client,onClose}){
  const [qrData,setQrData]=useState('');
  const barcodeRef=useRef(null);
  const [barcodeSvg,setBarcodeSvg]=useState('');
  const code=memberCode(membership);
  const qrPayload=String(membership?.qr_codigo||code).trim();
  const background=visual(membership);

  const state=useMemo(()=>{
    if(membership?.fin&&new Date(membership.fin)<=new Date())return 'CADUCADA';
    if(membership?.inicio&&new Date(membership.inicio)>new Date())return 'PROGRAMADA';
    return String(membership?.estado_efectivo||membership?.estado||'ACTIVA').toUpperCase();
  },[membership]);

  useEffect(()=>{
    let live=true;
    QRCode.toDataURL(qrPayload,{width:480,margin:1,errorCorrectionLevel:'M'})
      .then(v=>{if(live)setQrData(v)})
      .catch(()=>{if(live)setQrData('')});
    return()=>{live=false};
  },[qrPayload]);

  useEffect(()=>{
    if(!barcodeRef.current||!code)return;
    try{
      JsBarcode(barcodeRef.current,code,{format:'CODE128',displayValue:false,height:58,width:1.7,margin:0});
      setBarcodeSvg(barcodeRef.current.outerHTML);
    }catch{setBarcodeSvg('');}
  },[code]);

  if(!membership)return null;

  const holder=client?.nombre||membership?.cliente_nombre||membership?.cliente||membership?.id_cliente||'—';
  const plan=membership?.nombre||membership?.membresia_nombre||'—';
  const tcg=membership?.tcg_nombre||membership?.id_juego||'—';
  const active=state==='ACTIVA';
  const bgStyle=background?{backgroundImage:`linear-gradient(90deg,rgba(7,31,71,.84),rgba(13,77,145,.63)),url("${background}")`}:undefined;
  const miniBg=background?{backgroundImage:`linear-gradient(180deg,rgba(7,31,71,.56),rgba(7,31,71,.18)),url("${background}")`}:undefined;

  function printCard(){
    const qrHtml=qrData?`<img src="${qrData}" alt="QR">`:'';
    const barcodeHtml=barcodeSvg||'';
    const bgHtml=background?`<img class="art-bg" src="${esc(background)}" alt="">`:'';
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Credencial digital</title>
<style>
@page{size:A5 portrait;margin:8mm}
*{box-sizing:border-box}
body{margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#111827}
.sheet{position:relative;max-width:620px;margin:0 auto;background:#fff;border-radius:22px;overflow:hidden;border:1px solid #d7e0ec;box-shadow:0 16px 45px rgba(16,35,65,.13)}
.art-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:.18}
.head,.body,.foot{position:relative;z-index:1}
.head{height:104px;padding:27px 30px;background:linear-gradient(120deg,rgba(10,42,92,.96),rgba(7,84,166,.88));color:#fff;border-bottom:4px solid #d4a640;display:flex;align-items:center;justify-content:space-between}
.head h1{margin:0;font-size:31px;letter-spacing:.02em}.badge{padding:8px 15px;border-radius:999px;background:#dff8e7;color:#08743c;font-weight:900;font-size:14px}
.body{display:grid;grid-template-columns:1fr 1.08fr;gap:25px;padding:30px;background:rgba(255,255,255,.90)}
.meta{display:grid;gap:19px;align-content:start}.meta small{display:block;margin-bottom:5px;color:#758299;font-size:11px;font-weight:900;letter-spacing:.05em}.meta strong{font-size:18px}
.id strong{font-size:20px;color:#0a326f}
.codes{display:grid;gap:16px;align-content:start}.qrbox{padding:18px;border:1px solid #dce3ed;border-radius:18px;text-align:center;background:rgba(255,255,255,.94)}.qrbox img{width:245px;height:245px;max-width:100%}.qrbox p{margin:10px 0 0;font-weight:700}.barcode{text-align:center;background:rgba(255,255,255,.92);padding:10px;border-radius:12px}.barcode svg{width:100%;height:82px}.barcode b{display:block;margin-top:7px;font-size:18px;color:#0a326f;letter-spacing:.02em}
.foot{height:92px;padding:22px 30px;background:linear-gradient(120deg,rgba(7,40,100,.96),rgba(7,87,181,.91));color:#fff;display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center}.logo{font-size:28px;font-weight:1000;color:#efb73f}.tag{font-size:14px;line-height:1.5}.web{font-size:13px;font-weight:700}
@media print{body{background:#fff}.sheet{box-shadow:none;max-width:none}}
</style></head><body><article class="sheet">${bgHtml}
<header class="head"><h1>GMX MEMBER</h1><span class="badge">${esc(state)}</span></header>
<section class="body"><div class="meta">
<div><small>TITULAR</small><strong>${esc(holder)}</strong></div>
<div><small>MEMBRESÍA</small><strong>${esc(plan)}</strong></div>
<div><small>TCG</small><strong>${esc(tcg)}</strong></div>
<div><small>ESTADO</small><strong>${esc(state)}</strong></div>
<div><small>INICIO</small><strong>${esc(dateMx(membership.inicio))}</strong></div>
<div><small>VIGENCIA</small><strong>${esc(dateMx(membership.fin))}</strong></div>
<div class="id"><small>ID DE MEMBRESÍA</small><strong>${esc(code)}</strong></div>
</div><div class="codes">
<div class="qrbox">${qrHtml}<p>Escanea para validar</p></div>
<div class="barcode">${barcodeHtml}<b>${esc(code)}</b></div>
</div></section>
<footer class="foot"><div class="logo">GMX</div><div class="tag">Tu comunidad TCG<br>Tu pasión, tu lugar.</div><div class="web">www.gmx.com.mx</div></footer>
</article><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
    const w=window.open('','_blank','width=1000,height=820');
    if(!w)return;
    w.document.open();w.document.write(html);w.document.close();
  }

  return <div className="gmx-cd-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}>
    <section className={`gmx-cd-modal ${background?'has-membership-art':''}`}>
      {background?<img className="gmx-cd-modal-art" src={background} alt=""/>:null}
      <header className="gmx-cd-modal-head" style={bgStyle}>
        <div><small>GMX MEMBER</small><h2>Credencial digital</h2></div>
        <div className="gmx-cd-head-actions"><span className={`gmx-cd-state ${active?'active':''}`}>{state}</span><button type="button" onClick={onClose} aria-label="Cerrar">×</button></div>
      </header>

      <div className="gmx-cd-modal-body">
        <section className="gmx-cd-left">
          <div className="gmx-cd-data">
            <div><small>TITULAR</small><strong>{holder}</strong></div>
            <div><small>MEMBRESÍA</small><strong>{plan}</strong></div>
            <div><small>TCG</small><strong>{tcg}</strong></div>
            <div className="gmx-cd-date-row"><span><small>INICIO</small><b>{dateMx(membership.inicio)}</b></span><span><small>VIGENCIA</small><b>{dateMx(membership.fin)}</b></span></div>
            <div><small>ID DE MEMBRESÍA</small><strong className="gmx-cd-id">{code}</strong></div>
          </div>
        </section>

        <aside className="gmx-cd-preview-wrap">
          <small className="gmx-cd-preview-label">CREDENCIAL DIGITAL</small>
          <article className={`gmx-cd-mini-card ${background?'has-art':''}`} style={miniBg}>
            <header><b>GMX MEMBER</b><span className={`gmx-cd-mini-state ${active?'active':''}`}>{state}</span></header>
            <div className="gmx-cd-gold-line"/>
            <div className="gmx-cd-mini-body">
              <div className="gmx-cd-mini-qr">{qrData?<img src={qrData} alt="QR de membresía"/>:<span>QR no disponible</span>}</div>
              <b>{code}</b>
              <div className="gmx-cd-mini-barcode"><svg ref={barcodeRef}/></div>
            </div>
          </article>
          <span className="gmx-cd-scan-note">Escanea para validar</span>
        </aside>

        <section className="gmx-cd-info">
          <b>ⓘ Información</b>
          <p>Presenta esta credencial en caja o en torneos para obtener tus beneficios.</p>
          <p>El QR y el código de barras son únicos e intransferibles.</p>
        </section>
      </div>

      <footer className="gmx-cd-actions">
        <button className="gmx-cd-print" type="button" onClick={printCard}><PrintIcon/><span>Imprimir / Guardar PDF</span></button>
        <button className="gmx-cd-close" type="button" onClick={onClose}>Cerrar</button>
      </footer>
    </section>
  </div>;
}
