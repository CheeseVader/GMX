import { useEffect, useState } from 'react';
import '../system_access_urls_r1.css';

const EMPTY={
  admin:{local_127:'http://127.0.0.1/login',localhost:'http://localhost/login',mdns:'http://gmx.local/login',lan:'',cloudflare:''},
  store:{local:'http://127.0.0.1:8789/tienda',cloudflare:''},
  kiosk:'http://127.0.0.1/login',generated_at:''
};

function AccessRow({label,url,kind='admin'}){
  const [copied,setCopied]=useState(false);
  const value=String(url||'').trim();
  async function copy(){
    if(!value)return;
    try{await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1200);}catch{}
  }
  return <article className={`gmx-access-row ${kind}`}>
    <div className="gmx-access-row-copy"><span>{label}</span><strong>{value||'Pendiente'}</strong></div>
    <div className="gmx-access-actions">
      <button type="button" className="secondary" disabled={!value} onClick={copy}>{copied?'Copiado':'Copiar'}</button>
      <button type="button" disabled={!value} onClick={()=>value&&window.open(value,'_blank','noopener,noreferrer')}>Abrir</button>
    </div>
  </article>;
}

export default function SystemAccessUrlsPanel(){
  const [data,setData]=useState(EMPTY);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function refresh(){
    setBusy(true);
    try{
      const r=await fetch(`/gmx-runtime/access-urls.json?t=${Date.now()}`,{cache:'no-store'});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();
      setData({
        ...EMPTY,...j,
        admin:{...EMPTY.admin,...(j.admin||{})},
        store:{...EMPTY.store,...(j.store||{})}
      });
      setError('');
    }catch(e){setError(`No se pudieron leer las URLs del servidor (${e.message}).`);}finally{setBusy(false);}
  }

  useEffect(()=>{refresh();const id=setInterval(refresh,30000);return()=>clearInterval(id);},[]);

  return <section className="content-card gmx-access-panel">
    <div className="section-head gmx-access-head">
      <div><div className="eyebrow">ACCESOS Â· MISMA LÃ“GICA TCG-CORE</div><h2>URLs del sistema</h2>
      <p className="section-copy">ADMIN siempre entra por <b>/login</b>. TIENDA usa un acceso independiente. El kiosko nunca abre la tienda.</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={refresh}>{busy?'Actualizandoâ€¦':'Actualizar URLs'}</button>
    </div>
    {error?<div className="system-settings-note gmx-access-error">{error}</div>:null}
    <div className="gmx-access-columns">
      <div className="gmx-access-group">
        <div className="gmx-access-group-title"><b>ADMIN</b><span>Entrada administrativa</span></div>
        <AccessRow label="127.0.0.1" url={data.admin?.local_127}/>
        <AccessRow label="localhost" url={data.admin?.localhost}/>
        <AccessRow label="gmx.local" url={data.admin?.mdns}/>
        <AccessRow label="IP LAN" url={data.admin?.lan}/>
        <AccessRow label="Cloudflare ADMIN" url={data.admin?.cloudflare}/>
        <AccessRow label="Autostart / Kiosko" url={data.kiosk}/>
      </div>
      <div className="gmx-access-group store">
        <div className="gmx-access-group-title"><b>TIENDA</b><span>Entrada pÃºblica independiente</span></div>
        <AccessRow label="Tienda local" url={data.store?.local} kind="store"/>
        <AccessRow label="Cloudflare TIENDA" url={data.store?.cloudflare} kind="store"/>
        <div className="gmx-access-contract">
          <b>Contrato de acceso</b>
          <span>127.0.0.1 â†’ /login ADMIN</span>
          <span>localhost â†’ /login ADMIN</span>
          <span>gmx.local â†’ /login ADMIN</span>
          <span>Kiosko â†’ /login ADMIN</span>
          <span>Cloudflare ADMIN â†’ puerto 80 â†’ ADMIN</span>
          <span>Cloudflare TIENDA â†’ puerto 8789 â†’ /tienda</span>
        </div>
      </div>
    </div>
    <div className="gmx-access-foot">Actualizado: {data.generated_at?new Date(data.generated_at).toLocaleString():'â€”'}</div>
  </section>;
}