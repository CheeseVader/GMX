import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import '../memberships_admin_tabs_r6.css';

import MembershipCredentialModal from '../components/MembershipCredentialModal.jsx';
const money=v=>Number(v||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
const dateMx=v=>v?new Date(v).toLocaleDateString('es-MX'):'—';
const timeMx=v=>v?new Date(v).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}):'';
const initials=n=>String(n||'C').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
const blank={id:null,nombre:'',id_juego:'',precio:499,vigencia_dias:30,descuento_pct:10,entradas_incluidas:4,limite_semanal:1,activo:true,notas_publicas:'',imagen:''};

export default function MembershipsPage(){
  const [credential,setCredential]=useState(null);
  const [tab,setTab]=useState('resumen');
  const [plans,setPlans]=useState([]),[games,setGames]=useState([]),[clients,setClients]=useState([]),[holders,setHolders]=useState([]);
  const [message,setMessage]=useState(''),[loading,setLoading]=useState(true);
  const [clientSearch,setClientSearch]=useState(''),[historySearch,setHistorySearch]=useState(''),[historyTcg,setHistoryTcg]=useState('');
  const [selectedClient,setSelectedClient]=useState(null),[historyRows,setHistoryRows]=useState([]),[historyLoading,setHistoryLoading]=useState(false);
  const [typeModal,setTypeModal]=useState(false),[assignModal,setAssignModal]=useState(false),[form,setForm]=useState(blank),[saving,setSaving]=useState(false);
  const [assignClientId,setAssignClientId]=useState(''),[assignPlanId,setAssignPlanId]=useState(''),[duplicatePopup,setDuplicatePopup]=useState(null);

  const load=async()=>{
    setLoading(true);
    try{
      const rs=await Promise.allSettled([
        api('/api/v1/memberships/types'),
        api('/api/v1/memberships/tcg-options'),
        api('/api/v1/memberships/client-options'),
        api('/api/v1/memberships/clients')
      ]);
      if(rs[0].status==='fulfilled')setPlans(rs[0].value.data||[]);
      if(rs[1].status==='fulfilled')setGames(rs[1].value.data||[]);
      if(rs[2].status==='fulfilled')setClients(rs[2].value.data||[]);
      if(rs[3].status==='fulfilled')setHolders(rs[3].value.data||[]);
      const fail=rs.find(x=>x.status==='rejected'); if(fail)setMessage(fail.reason?.message||'No se pudo cargar toda la información de membresías.');
    }finally{setLoading(false)}
  };
  useEffect(()=>{load().catch(e=>{setMessage(e.message);setLoading(false)})},[]);

  const clientAgg=useMemo(()=>{
    const now=new Date(),map=new Map();
    for(const c of clients)map.set(String(c.id_cliente),{...c,memberships:[],active:0});
    for(const m of holders){
      const k=String(m.id_cliente); if(!map.has(k))map.set(k,{id_cliente:m.id_cliente,nombre:m.cliente_nombre,email:m.cliente_email,telefono:m.cliente_telefono,memberships:[],active:0});
      const x=map.get(k); x.memberships.push(m);
      if(['ACTIVA','PROGRAMADA'].includes(String(m.estado||'').toUpperCase())&&(!m.fin||new Date(m.fin)>now))x.active++;
    }
    return [...map.values()];
  },[clients,holders]);
  const filteredClients=useMemo(()=>{const q=clientSearch.trim().toLowerCase();return clientAgg.filter(c=>!q||[c.nombre,c.email,c.telefono,c.id_cliente].filter(Boolean).some(v=>String(v).toLowerCase().includes(q)))},[clientAgg,clientSearch]);
  const activePlans=plans.filter(x=>x.activo).length;
  const activeMemberships=holders.filter(x=>['ACTIVA','PROGRAMADA'].includes(String(x.estado||'').toUpperCase())&&(!x.fin||new Date(x.fin)>new Date())).length;
  const totalMemberships=holders.length;
  const clientsWithMembership=clientAgg.filter(x=>x.memberships.length>0).length;
  const byTcg=useMemo(()=>{const m=new Map();for(const h of holders){const n=h.tcg_nombre||h.id_juego||'Otros TCG';m.set(n,(m.get(n)||0)+1)}return [...m.entries()].sort((a,b)=>b[1]-a[1])},[holders]);
  const recent=useMemo(()=>[...holders].sort((a,b)=>new Date(b.inicio||0)-new Date(a.inicio||0)).slice(0,5),[holders]);

  async function openHistory(c){
    setSelectedClient(c);setTab('historial');setHistoryLoading(true);setHistoryRows([]);
    try{const r=await api(`/api/v1/memberships/clients/${encodeURIComponent(c.id_cliente)}/detail`);setHistoryRows(r.data||[])}catch(e){setMessage(e.message)}finally{setHistoryLoading(false)}
  }
  const historyFiltered=useMemo(()=>historyRows.filter(m=>!historyTcg||String(m.id_juego)===String(historyTcg)),[historyRows,historyTcg]);
  const historyClientOptions=useMemo(()=>{const q=historySearch.trim().toLowerCase();return clientAgg.filter(c=>c.memberships.length>0&&(!q||[c.nombre,c.email,c.telefono,c.id_cliente].filter(Boolean).some(v=>String(v).toLowerCase().includes(q)))).slice(0,20)},[clientAgg,historySearch]);

  function editType(p){setForm({id:p.id,nombre:p.nombre||'',id_juego:p.id_juego||'',precio:Number(p.precio||0),vigencia_dias:Number(p.vigencia_dias||30),descuento_pct:Number(p.descuento_pct||0),entradas_incluidas:Number(p.entradas_incluidas||4),limite_semanal:Number(p.limite_semanal||1),activo:p.activo!==false,notas_publicas:p.notas_publicas||'',imagen:p.imagen||''});setTypeModal(true)}
  
  // GMX_MEMBERSHIP_ADMIN_IMAGE_R6
  async function handleMembershipImage(file){
    if(!file)return;
    if(!/^image\/(png|jpe?g|webp)$/i.test(file.type||'')){
      setMessage('Formato no compatible. Usa JPG, PNG o WEBP.');
      return;
    }
    if(file.size>10*1024*1024){
      setMessage('La imagen supera 10 MB.');
      return;
    }
    try{
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error('No fue posible leer la imagen.'));
        reader.readAsDataURL(file);
      });
      const img=await new Promise((resolve,reject)=>{
        const image=new Image();
        image.onload=()=>resolve(image);
        image.onerror=()=>reject(new Error('No fue posible procesar la imagen.'));
        image.src=data;
      });

      const maxW=1600,maxH=1000;
      const scale=Math.min(1,maxW/img.width,maxH/img.height);
      const w=Math.max(1,Math.round(img.width*scale));
      const h=Math.max(1,Math.round(img.height*scale));

      const canvas=document.createElement('canvas');
      canvas.width=w;
      canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);

      let quality=.88;
      let out=canvas.toDataURL('image/webp',quality);
      while(out.length>900000&&quality>.52){
        quality-=.08;
        out=canvas.toDataURL('image/webp',quality);
      }

      setForm(prev=>({...prev,imagen:out}));
      setMessage('Imagen de membresía cargada. Se autoajustará en tienda, credencial y PDF.');
    }catch(e){
      setMessage(e?.message||'No fue posible cargar la imagen.');
    }
  }

  async function saveType(){if(!form.nombre.trim()||!form.id_juego){setMessage('Captura nombre del tipo de membresía y TCG.');return}setSaving(true);try{const edit=Boolean(form.id);await api(edit?`/api/v1/memberships/types/${form.id}`:'/api/v1/memberships/types',{method:edit?'PUT':'POST',body:JSON.stringify(form)});setTypeModal(false);setForm(blank);setMessage(edit?'Tipo de membresía actualizado.':'Tipo de membresía creado.');await load()}catch(e){setMessage(e.message)}finally{setSaving(false)}}
  async function toggleType(p){try{await api(`/api/v1/memberships/types/${p.id}`,{method:'PUT',body:JSON.stringify({...p,activo:!p.activo})});await load()}catch(e){setMessage(e.message)}}
  async function goPos(){const c=clients.find(x=>String(x.id_cliente)===String(assignClientId)),p=plans.find(x=>String(x.id)===String(assignPlanId));if(!c||!p){setMessage('Selecciona cliente y tipo de membresía.');return}try{const check=await api(`/api/v1/memberships/eligibility/${encodeURIComponent(c.id_cliente)}/${encodeURIComponent(p.id)}`);if(check.data?.eligible===false){setDuplicatePopup({client:c,plan:p,existing:check.data.existing});return}window.location.href=`/admin/pos?client=${encodeURIComponent(c.id_cliente)}&membershipSku=${encodeURIComponent(p.sku)}`}catch(e){setMessage(e.message)}}

  const tabs=[['resumen','▣','Resumen'],['tipos','◇','Tipos de membresía'],['clientes','▢','Clientes'],['historial','◴','Historial / Registros']];
  return <div className="gmx-r6-page">
    <div className="gmx-r6-head"><div><h1>Membresías</h1><p>Administra tipos, clientes y registros de membresías</p></div><button className="gmx-r6-primary" onClick={()=>{setAssignClientId('');setAssignPlanId('');setAssignModal(true)}}>＋ Nueva membresía</button></div>
    <nav className="gmx-r6-tabs">{tabs.map(([id,ico,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><span>{ico}</span>{label}</button>)}</nav>
    {message?<div className="gmx-r6-message"><span>{message}</span><button onClick={()=>setMessage('')}>×</button></div>:null}

    {tab==='resumen'&&<>
      <section className="gmx-r6-kpis">
        <article><i>▢</i><div><small>TIPOS DE MEMBRESÍA</small><strong>{activePlans}</strong><span>Activos</span></div></article>
        <article><i>◉</i><div><small>MEMBRESÍAS ACTIVAS</small><strong>{activeMemberships}</strong><span>Vigentes</span></div></article>
        <article><i>♙</i><div><small>CLIENTES CON MEMBRESÍA</small><strong>{clientsWithMembership}</strong><span>Con membresía</span></div></article>
        <article><i>▤</i><div><small>TOTAL DE MEMBRESÍAS</small><strong>{totalMemberships}</strong><span>Registradas</span></div></article>
      </section>
      <section className="gmx-r6-summary-grid">
        <article className="gmx-r6-card"><h2>Membresías por tipo</h2><div className="gmx-r6-donut-wrap"><div className="gmx-r6-donut"><b>{totalMemberships}</b><span>Total</span></div><div className="gmx-r6-legend">{byTcg.length?byTcg.slice(0,6).map(([n,v],i)=><div key={n}><i className={`c${i%6}`}/><span>{n}</span><b>{v} {totalMemberships?`(${((v/totalMemberships)*100).toFixed(1)}%)`:''}</b></div>):<p>Sin membresías registradas.</p>}</div></div></article>
        <article className="gmx-r6-card"><div className="gmx-r6-card-title"><h2>Membresías recientes</h2><button onClick={()=>setTab('historial')}>Ver todas</button></div><div className="gmx-r6-recent">{recent.length?recent.map(r=><button key={r.id} onClick={()=>{const c=clientAgg.find(x=>String(x.id_cliente)===String(r.id_cliente));if(c)openHistory(c)}}><i>{initials(r.cliente_nombre)}</i><span><b>{r.cliente_nombre||r.id_cliente}</b><small>{r.tcg_nombre||r.membresia_nombre}</small></span><time>{dateMx(r.inicio)}</time><em>{r.estado}</em></button>):<p>Sin registros recientes.</p>}</div></article>
        <article className="gmx-r6-card"><h2>Membresías por estado</h2><div className="gmx-r6-state-list"><div><span><i className="ok"/>Activas / programadas</span><b>{activeMemberships}</b></div><div><span><i className="off"/>Finalizadas / vencidas</span><b>{Math.max(0,totalMemberships-activeMemberships)}</b></div><div><span><i className="all"/>Total</span><b>{totalMemberships}</b></div></div></article>
      </section>
    </>}

    {tab==='tipos'&&<section className="gmx-r6-card gmx-r6-module"><div className="gmx-r6-card-title"><div><h2>Tipos de membresía</h2><p>Gestiona los tipos de membresía disponibles</p></div><button className="gmx-r6-primary small" onClick={()=>{setForm(blank);setTypeModal(true)}}>＋ Nuevo tipo</button></div><div className="gmx-r6-table-wrap"><table><thead><tr><th>NOMBRE</th><th>TCG</th><th>PRECIO</th><th>ENTRADAS</th><th>DURACIÓN</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>{plans.map(p=><tr key={p.id}><td><b>{p.nombre}</b></td><td>{p.tcg_nombre||p.id_juego}</td><td>{money(p.precio)}</td><td>{p.entradas_incluidas}</td><td>{p.vigencia_dias} días</td><td><span className={`gmx-r6-pill ${p.activo?'green':'gray'}`}>{p.activo?'Activa':'Inactiva'}</span></td><td><div className="gmx-r6-actions"><button title="Editar" onClick={()=>editType(p)}>✎</button><button className="danger" title={p.activo?'Desactivar':'Activar'} onClick={()=>toggleType(p)}>{p.activo?'⊘':'✓'}</button></div></td></tr>)}</tbody></table></div><div className="gmx-r6-info"><b>ⓘ Información</b><span>Las “Entradas” se refieren al número de accesos que incluye la membresía.</span><span>Ejemplo: 4 entradas = el cliente puede entrar 4 veces en el periodo de vigencia.</span></div></section>}

    {tab==='clientes'&&<section className="gmx-r6-card gmx-r6-module"><div className="gmx-r6-card-title"><div><h2>Clientes</h2><p>Gestiona la información de tus clientes</p></div><button className="gmx-r6-primary small" onClick={()=>window.location.href='/admin/clientes'}>＋ Nuevo cliente</button></div><div className="gmx-r6-search"><input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Buscar cliente..."/><span>⌕</span></div><div className="gmx-r6-table-wrap"><table><thead><tr><th>CLIENTE</th><th>TELÉFONO</th><th>MEMBRESÍAS ACTIVAS</th><th>REGISTRO</th><th>ACCIONES</th></tr></thead><tbody>{filteredClients.map(c=><tr key={c.row_id||c.id_cliente}><td><div className="gmx-r6-person"><i>{initials(c.nombre)}</i><b>{c.nombre||c.id_cliente}</b></div></td><td>{c.telefono||'—'}</td><td>{c.active}</td><td>{c.memberships[0]?.inicio?dateMx(c.memberships[0].inicio):'—'}</td><td><div className="gmx-r6-actions"><button title="Ver membresías" onClick={()=>openHistory(c)}>◉</button><button title="Editar cliente" onClick={()=>window.location.href='/admin/clientes'}>✎</button></div></td></tr>)}</tbody></table></div><div className="gmx-r6-tip"><b>ⓘ Tip</b><span>Haz clic en el ícono ◉ para ver el detalle de las membresías del cliente.</span></div></section>}

    {tab==='historial'&&<section className="gmx-r6-history">
      <div className="gmx-r6-card gmx-r6-history-head"><div><h2>Historial / Registros</h2><p>Consulta el historial y entradas restantes por cliente</p></div><div className="gmx-r6-history-tools"><select value={historyTcg} onChange={e=>setHistoryTcg(e.target.value)}><option value="">Todos los TCG</option>{games.map(g=><option key={g.id_juego} value={g.id_juego}>{g.nombre}</option>)}</select></div></div>
      <div className="gmx-r6-history-layout"><aside className="gmx-r6-card gmx-r6-client-picker"><div className="gmx-r6-search"><input value={historySearch} onChange={e=>setHistorySearch(e.target.value)} placeholder="Buscar cliente..."/><span>⌕</span></div>{historyClientOptions.map(c=><button key={c.id_cliente} className={selectedClient&&String(selectedClient.id_cliente)===String(c.id_cliente)?'active':''} onClick={()=>openHistory(c)}><i>{initials(c.nombre)}</i><span><b>{c.nombre||c.id_cliente}</b><small>{c.telefono||c.email||c.id_cliente}</small></span><em>{c.active}</em></button>)}</aside>
      <main className="gmx-r6-history-main">{!selectedClient?<div className="gmx-r6-card gmx-r6-empty"><b>Selecciona un cliente</b><span>Elige un cliente para ver todas sus membresías y sus entradas restantes.</span></div>:<><div className="gmx-r6-card gmx-r6-selected"><div className="gmx-r6-person"><i>{initials(selectedClient.nombre)}</i><span><b>{selectedClient.nombre||selectedClient.id_cliente}</b><small>{[selectedClient.telefono,selectedClient.email].filter(Boolean).join(' · ')||selectedClient.id_cliente}</small></span></div><div><strong>{historyRows.filter(m=>['ACTIVA','PROGRAMADA'].includes(String(m.estado||'').toUpperCase())&&(!m.fin||new Date(m.fin)>new Date())).length}</strong><span>Membresías activas</span></div></div>{historyLoading?<div className="gmx-r6-card gmx-r6-empty">Cargando historial...</div>:historyFiltered.length?historyFiltered.map(m=>{const total=Number(m.entradas_incluidas||0),used=Number(m.entradas_usadas||0),remaining=Math.max(0,total-used),pct=total?Math.min(100,Math.max(0,(remaining/total)*100)):0;return <article className="gmx-r6-card gmx-r6-membership" key={m.id}><div className="gmx-r6-mem-info"><div className="gmx-r6-mem-title"><i>✦</i><span><h3>{m.nombre}</h3><small>{m.tcg_nombre||m.id_juego}</small></span><em className={`gmx-r6-pill ${['ACTIVA','PROGRAMADA'].includes(String(m.estado||'').toUpperCase())?'green':'gray'}`}>{m.estado}</em></div><div className="gmx-r6-mem-dates"><span><small>INICIO</small><b>{dateMx(m.inicio)}</b></span><span><small>VENCIMIENTO</small><b>{dateMx(m.fin)}</b></span><span><small>DURACIÓN</small><b>{m.vigencia_dias||'—'} días</b></span></div></div><div className="gmx-r6-remaining"><small>ENTRADAS RESTANTES</small><strong>{remaining} <span>/ {total}</span></strong><em>{remaining===1?'1 entrada restante':`${remaining} entradas restantes`}</em><div><i style={{width:`${pct}%`}}/></div></div><div className="gmx-r6-card-tools"><button type="button" className="gmx-r6-credential-button" onClick={()=>setCredential({membership:m,client:selectedClient})}>[ID] Credencial digital</button></div><div className="gmx-r6-moves"><h4>Historial de entradas</h4>{(m.movimientos||[]).length?(m.movimientos||[]).map(x=><div key={x.id}><span>{dateMx(x.fecha)}</span><time>{timeMx(x.fecha)}</time></div>):<p>Sin entradas registradas.</p>}</div></article>}):<div className="gmx-r6-card gmx-r6-empty">No hay membresías para el filtro seleccionado.</div>}<div className="gmx-r6-info orange"><b>ⓘ Información</b><span>Las entradas se descuentan de la membresía específica utilizada por el cliente.</span></div></>}</main></div>{credential?<MembershipCredentialModal membership={credential.membership} client={credential.client} onClose={()=>setCredential(null)}/>:null}
    </section>}

    {typeModal&&<div className="gmx-r6-modal-back" onMouseDown={()=>setTypeModal(false)}><div className="gmx-r6-modal" onMouseDown={e=>e.stopPropagation()}><button className="x" onClick={()=>setTypeModal(false)}>×</button><h2>{form.id?'Editar tipo de membresía':'Nuevo tipo de membresía'}</h2><div className="gmx-r6-form"><label>Nombre<input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></label><label>TCG<select value={form.id_juego} onChange={e=>setForm({...form,id_juego:e.target.value})}><option value="">Seleccionar...</option>{games.map(g=><option key={g.id_juego} value={g.id_juego}>{g.nombre}</option>)}</select></label><label>Precio<input type="number" value={form.precio} onChange={e=>setForm({...form,precio:e.target.value})}/></label><label>Vigencia (días)<input type="number" value={form.vigencia_dias} onChange={e=>setForm({...form,vigencia_dias:e.target.value})}/></label><label>Entradas incluidas<input type="number" value={form.entradas_incluidas} onChange={e=>setForm({...form,entradas_incluidas:e.target.value})}/></label><label>Límite semanal<input type="number" value={form.limite_semanal} onChange={e=>setForm({...form,limite_semanal:e.target.value})}/></label>

<div className="gmx-r6-membership-image-editor">
  <div className="gmx-r6-membership-image-head">
    <div>
      <b>Imagen de membresía</b>
      <span>La misma imagen se utilizará en la tienda, credencial digital y PDF.</span>
    </div>
    {form.imagen?<button type="button" onClick={()=>setForm(prev=>({...prev,imagen:''}))}>Quitar</button>:null}
  </div>

  <label className="gmx-r6-membership-image-drop">
    {form.imagen?
      <img src={form.imagen} alt="Vista previa de membresía"/>:
      <div className="gmx-r6-membership-image-empty">
        <strong>Seleccionar imagen</strong>
        <span>JPG, PNG o WEBP · máximo 10 MB</span>
        <small>La imagen se autoajusta sin deformarse.</small>
      </div>}

    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onChange={e=>handleMembershipImage(e.target.files?.[0])}
    />
  </label>
</div>
</div><div className="gmx-r6-modal-actions"><button onClick={()=>setTypeModal(false)}>Cancelar</button><button className="gmx-r6-primary" disabled={saving} onClick={saveType}>{saving?'Guardando...':'Guardar'}</button></div></div></div>}
    {assignModal&&<div className="gmx-r6-modal-back" onMouseDown={()=>setAssignModal(false)}><div className="gmx-r6-modal" onMouseDown={e=>e.stopPropagation()}><button className="x" onClick={()=>setAssignModal(false)}>×</button><h2>Asignar membresía a cliente</h2><p>Selecciona cliente y tipo. La activación se completa después del pago en POS.</p><div className="gmx-r6-form one"><label>Cliente existente<select value={assignClientId} onChange={e=>setAssignClientId(e.target.value)}><option value="">Seleccionar cliente...</option>{clients.map(c=><option key={c.row_id||c.id_cliente} value={c.id_cliente}>{c.nombre||c.id_cliente}{c.telefono?` · ${c.telefono}`:''}</option>)}</select></label><label>Tipo de membresía<select value={assignPlanId} onChange={e=>setAssignPlanId(e.target.value)}><option value="">Seleccionar tipo...</option>{plans.filter(p=>p.activo).map(p=><option key={p.id} value={p.id}>{p.nombre} · {p.tcg_nombre||p.id_juego} · {money(p.precio)}</option>)}</select></label></div><div className="gmx-r6-modal-actions"><button onClick={()=>setAssignModal(false)}>Cancelar</button><button className="gmx-r6-primary" onClick={goPos}>Finalizar en POS</button></div></div></div>}
    {duplicatePopup&&<div className="gmx-r6-modal-back" onMouseDown={()=>setDuplicatePopup(null)}><div className="gmx-r6-modal compact" onMouseDown={e=>e.stopPropagation()}><button className="x" onClick={()=>setDuplicatePopup(null)}>×</button><h2>Ya cuenta con membresía activa</h2><p><b>{duplicatePopup.client?.nombre}</b> ya tiene una membresía para <b>{duplicatePopup.plan?.tcg_nombre||duplicatePopup.plan?.id_juego}</b> con vigencia hasta {dateMx(duplicatePopup.existing?.fin)}.</p><div className="gmx-r6-modal-actions"><button className="gmx-r6-primary" onClick={()=>setDuplicatePopup(null)}>Entendido</button></div></div></div>}
    {loading?<div className="gmx-r6-loading">Cargando...</div>:null}
  </div>
}
