import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../services/api.js';
import '../sales_history_r1.css';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const common = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true };
  switch (name) {
    case 'sales': return <svg {...common}><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/></svg>;
    case 'money': return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.7-.7-1.9-1.2-3.3-1.2-1.8 0-3.2.9-3.2 2.2 0 1.2 1 1.9 3.2 2.4 2.1.5 3.1 1.2 3.1 2.5 0 1.4-1.4 2.3-3.4 2.3-1.6 0-3-.6-3.9-1.5"/><path d="M12 5.5v13"/></svg>;
    case 'card': return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></svg>;
    case 'cancel': return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>;
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
    case 'list': return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case 'eye': return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case 'refresh': return <svg {...common}><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>;
    case 'excel': return <svg {...common}><path d="M4 3h10l6 6v12H4z"/><path d="M14 3v6h6"/><path d="m8 12 4 6M12 12l-4 6"/></svg>;
    case 'clear': return <svg {...common}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m9 11 6 6M15 11l-6 6"/></svg>;
    case 'close': return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
    case 'receipt': return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>;
    case 'chevron-left': return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
    case 'chevron-right': return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
    default: return null;
  }
}

function cleanText(value) {
  let text = String(value ?? '');
  const replacements = [
    ['MÃ©todo','Método'],['mÃ©todo','método'],['telÃ©fono','teléfono'],['TelÃ©fono','Teléfono'],
    ['operaciÃ³n','operación'],['OperaciÃ³n','Operación'],['pÃ¡gina','página'],['PÃ¡gina','Página'],
    ['artÃ­culo','artículo'],['ArtÃ­culo','Artículo'],['crÃ©dito','crédito'],['CrÃ©dito','Crédito'],
    ['dÃ©bito','débito'],['DÃ©bito','Débito'],['pÃºblico','público'],['PÃºblico','Público'],
    ['Ã¡','á'],['Ã©','é'],['Ã­','í'],['Ã³','ó'],['Ãº','ú'],['Ã','Á'],['Ã‰','É'],['Ã','Í'],['Ã“','Ó'],['Ãš','Ú'],
    ['Ã±','ñ'],['Ã‘','Ñ'],['Ã¼','ü'],['Ãœ','Ü'],['â€”','—'],['â€“','–'],['â€˜','‘'],['â€™','’'],['â€œ','“'],['â€','”'],['â€¦','…'],['Â·','·'],['Â','']
  ];
  for (const [bad, good] of replacements) text = text.split(bad).join(good);
  return text.trim();
}
function displayOrDash(v){ const t=cleanText(v); return (!t || ['-','—','â€”','â€“'].includes(t)) ? '—' : t; }
function money(v){ return Number(v||0).toLocaleString('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2}); }
function dateObj(v){ if(!v)return null; const d=new Date(v); return Number.isNaN(d.getTime())?null:d; }
function dateOnly(v){ const d=dateObj(v); return d?d.toLocaleDateString('es-MX'):displayOrDash(v); }
function timeOnly(v){ const d=dateObj(v); return d?d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):''; }
function dateTime(v){ const d=dateObj(v); return d?d.toLocaleString('es-MX'):displayOrDash(v); }
function methodLabel(v){ const x=cleanText(v).toUpperCase(); if(x==='EFECTIVO')return'Efectivo'; if(x==='TRANSFERENCIA')return'Transferencia'; if(x==='TARJETA')return'Tarjeta'; return x?cleanText(v):'—'; }
function statusClass(v){ return cleanText(v).toLowerCase().replace(/\s+/g,'-'); }
function parseProvider(v){ const raw=cleanText(v); const out={bank:'',brand:'',type:''}; for(const p of raw.split(';')){const [k,...r]=p.split('=');const val=r.join('=').trim();const key=String(k).toUpperCase();if(key==='BANK')out.bank=val;if(key==='BRAND')out.brand=val;if(key==='TYPE')out.type=val;} return out; }
function includesDate(v,from,to){ if(!from&&!to)return true; const d=dateObj(v); if(!d)return false; const day=new Date(d.getFullYear(),d.getMonth(),d.getDate()); if(from){const[y,m,dd]=from.split('-').map(Number);if(day<new Date(y,m-1,dd))return false;} if(to){const[y,m,dd]=to.split('-').map(Number);if(day>new Date(y,m-1,dd))return false;} return true; }
function unique(v){ return [...new Set(v.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')); }

export default function SalesHistoryPage(){
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState(''); const [method,setMethod]=useState(''); const [status,setStatus]=useState(''); const [branch,setBranch]=useState('');
  const [dateFrom,setDateFrom]=useState(''); const [dateTo,setDateTo]=useState('');
  const [busy,setBusy]=useState(true); const [error,setError]=useState('');
  const [selected,setSelected]=useState(null); const [detailBusy,setDetailBusy]=useState(false);
  const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(10);

  async function load(){ setBusy(true);setError('');try{const b=await api('/api/v1/orders?limit=500');setRows(Array.isArray(b.data)?b.data:[]);}catch(e){setError(cleanText(e?.message)||'No se pudo cargar el historial de ventas.');}finally{setBusy(false);} }
  async function openDetail(order){ setDetailBusy(true);setError('');try{const b=await api(`/api/v1/orders/${order.row_id}`);setSelected(b.data||null);}catch(e){setError(cleanText(e?.message)||'No se pudo cargar el detalle de la venta.');}finally{setDetailBusy(false);} }
  function clearFilters(){setSearch('');setMethod('');setStatus('');setBranch('');setDateFrom('');setDateTo('');setPage(1);}

  useEffect(()=>{load();},[]);
  useEffect(()=>{setPage(1);},[search,method,status,branch,dateFrom,dateTo,pageSize]);

  const branches=useMemo(()=>unique(rows.map(r=>cleanText(r.sucursal||r.id_sucursal))),[rows]);
  const filtered=useMemo(()=>{const q=cleanText(search).toLowerCase();return rows.filter(r=>{const h=[r.id_pedido,r.nombre_cliente,r.email,r.telefono,r.sucursal,r.id_sucursal,r.referencia_pago,r.estado_pedido,r.metodo_pago].map(cleanText).join(' ').toLowerCase();if(q&&!h.includes(q))return false;if(status&&cleanText(r.estado_pedido).toUpperCase()!==status)return false;if(method&&cleanText(r.metodo_pago).toUpperCase()!==method)return false;if(branch&&cleanText(r.sucursal||r.id_sucursal)!==branch)return false;if(!includesDate(r.fecha||r.fecha_pago,dateFrom,dateTo))return false;return true;});},[rows,search,method,status,branch,dateFrom,dateTo]);
  const kpis=useMemo(()=>{const valid=filtered.filter(r=>cleanText(r.estado_pedido).toUpperCase()!=='CANCELADO');return{sales:filtered.length,total:valid.reduce((s,r)=>s+Number(r.total||0),0),cards:filtered.filter(r=>cleanText(r.metodo_pago).toUpperCase()==='TARJETA').length,cancelled:filtered.filter(r=>cleanText(r.estado_pedido).toUpperCase()==='CANCELADO').length};},[filtered]);

  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize)); const safePage=Math.min(page,pageCount); const start=(safePage-1)*pageSize; const visibleRows=filtered.slice(start,start+pageSize);
  const payments=Array.isArray(selected?.pagos)?selected.pagos:[]; const details=Array.isArray(selected?.detalles)?selected.detalles:[]; const primaryPayment=payments[0]||null; const totalPayments=payments.reduce((s,p)=>s+Number(p.importe_aplicado||0),0);

  function exportExcel(){
    if(!filtered.length)return;
    const salesRows=filtered.map(r=>({Fecha:dateTime(r.fecha||r.fecha_pago),Venta:displayOrDash(r.id_pedido),Cliente:cleanText(r.nombre_cliente)||'Público general',Correo:displayOrDash(r.email),Teléfono:displayOrDash(r.telefono),Sucursal:displayOrDash(r.sucursal||r.id_sucursal),'Método de pago':methodLabel(r.metodo_pago),Referencia:displayOrDash(r.referencia_pago),Total:Number(r.total||0),Estado:displayOrDash(r.estado_pedido)}));
    const wb=XLSX.utils.book_new(); const ws=XLSX.utils.json_to_sheet(salesRows); ws['!cols']=[{wch:22},{wch:36},{wch:28},{wch:34},{wch:18},{wch:22},{wch:20},{wch:24},{wch:14},{wch:16}]; XLSX.utils.book_append_sheet(wb,ws,'Historial de ventas');
    const summary=XLSX.utils.json_to_sheet([{Indicador:'Ventas mostradas',Valor:kpis.sales},{Indicador:'Total facturado',Valor:kpis.total},{Indicador:'Ventas con tarjeta',Valor:kpis.cards},{Indicador:'Ventas canceladas',Valor:kpis.cancelled},{Indicador:'Fecha desde',Valor:dateFrom||'Todas'},{Indicador:'Fecha hasta',Valor:dateTo||'Todas'},{Indicador:'Sucursal',Valor:branch||'Todas'},{Indicador:'Método',Valor:method||'Todos'},{Indicador:'Estado',Valor:status||'Todos'}]); summary['!cols']=[{wch:26},{wch:30}]; XLSX.utils.book_append_sheet(wb,summary,'Resumen');
    XLSX.writeFile(wb,`GMX-Historial-Ventas-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return <section className={`shiny-sales-d2 ${selected?'with-detail':''}`}>
    <header className="shiny-sales-d2-head"><div><div className="shiny-sales-d2-eyebrow">VENTAS</div><h1>Historial de ventas</h1><p>Consulta y revisa todas tus ventas, pagos, tarjetas y referencias.</p></div><div className="shiny-sales-d2-head-actions"><button type="button" className="secondary with-icon" onClick={exportExcel} disabled={!filtered.length}><Icon name="excel" size={16}/><span>Exportar Excel</span></button><button type="button" className="secondary icon-only" onClick={load} disabled={busy} title="Actualizar"><Icon name="refresh" size={17}/></button></div></header>

    <div className="shiny-sales-d2-kpis">
      <article><div className="kpi-icon purple"><Icon name="sales" size={22}/></div><div><span>Ventas totales</span><strong>{kpis.sales}</strong></div></article>
      <article><div className="kpi-icon green"><Icon name="money" size={22}/></div><div><span>Total facturado</span><strong>{money(kpis.total)}</strong></div></article>
      <article><div className="kpi-icon blue"><Icon name="card" size={22}/></div><div><span>Ventas con tarjeta</span><strong>{kpis.cards}</strong></div></article>
      <article><div className="kpi-icon orange"><Icon name="cancel" size={22}/></div><div><span>Ventas canceladas</span><strong>{kpis.cancelled}</strong></div></article>
    </div>

    <div className="shiny-sales-d2-body"><main className="shiny-sales-d2-main">
      <section className="shiny-sales-d2-filter-card"><div className="filters-grid">
        <label className="search-field"><span>Buscar</span><div className="input-with-icon"><i><Icon name="search" size={15}/></i><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pedido, cliente, correo, teléfono, referencia..."/></div></label>
        <label><span>Fecha desde</span><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
        <label><span>Fecha hasta</span><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
        <label><span>Sucursal</span><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Todas</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
        <label><span>Método de pago</span><select value={method} onChange={e=>setMethod(e.target.value)}><option value="">Todos</option><option value="EFECTIVO">Efectivo</option><option value="TRANSFERENCIA">Transferencia</option><option value="TARJETA">Tarjeta</option></select></label>
        <label><span>Estado</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option><option value="PAGADO">Pagado</option><option value="COMPLETADO">Completado</option><option value="PENDIENTE">Pendiente</option><option value="CANCELADO">Cancelado</option></select></label>
      </div><div className="filter-actions"><button type="button" className="secondary compact with-icon" onClick={clearFilters}><Icon name="clear" size={14}/><span>Limpiar filtros</span></button></div></section>

      {error?<div className="shiny-sales-d2-error">{cleanText(error)}</div>:null}

      <section className="shiny-sales-d2-table-card"><div className="table-card-title"><div><Icon name="list" size={15}/><strong>LISTADO DE VENTAS</strong></div><small>{filtered.length} resultado(s)</small></div>
      <div className="table-scroll"><table><thead><tr><th>FECHA</th><th>VENTA</th><th>CLIENTE</th><th>SUCURSAL</th><th>MÉTODO</th><th>REFERENCIA</th><th>TOTAL</th><th>ESTADO</th><th>ACCIÓN</th></tr></thead><tbody>
      {!busy&&!visibleRows.length?<tr><td colSpan="9"><div className="shiny-sales-d2-empty">No hay ventas que coincidan con los filtros.</div></td></tr>:null}
      {visibleRows.map(r=><tr key={r.row_id||r.id_pedido} className={selected?.row_id===r.row_id?'selected-row':''}>
        <td className="date-cell"><strong>{dateOnly(r.fecha||r.fecha_pago)}</strong><small>{timeOnly(r.fecha||r.fecha_pago)}</small></td>
        <td className="sale-id"><strong>{displayOrDash(r.id_pedido)}</strong>{r.row_id?<small>ID: {r.row_id}</small>:null}</td>
        <td className="client-cell"><strong>{cleanText(r.nombre_cliente)||'Público general'}</strong>{r.email?<small>{cleanText(r.email)}</small>:null}</td>
        <td>{displayOrDash(r.sucursal||r.id_sucursal)}</td><td><span className={`method-pill ${cleanText(r.metodo_pago).toLowerCase()}`}>{methodLabel(r.metodo_pago)}</span></td><td className="ref-cell">{displayOrDash(r.referencia_pago)}</td><td className="total-cell">{money(r.total)}</td><td><span className={`status-pill ${statusClass(r.estado_pedido)}`}>{displayOrDash(r.estado_pedido)}</span></td><td><button type="button" className="view-button" onClick={()=>openDetail(r)} title="Ver detalle"><Icon name="eye" size={15}/></button></td>
      </tr>)}</tbody></table></div>
      <footer className="pagination-bar"><span>Mostrando {filtered.length?start+1:0} a {Math.min(start+pageSize,filtered.length)} de {filtered.length} resultados</span><div className="pagination-controls"><button type="button" className="page-btn" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><Icon name="chevron-left" size={14}/></button>{Array.from({length:Math.min(pageCount,5)},(_,i)=>{let p=i+1;if(pageCount>5&&safePage>3)p=Math.min(pageCount-4+i,safePage-2+i);return <button type="button" key={p} className={`page-btn ${p===safePage?'active':''}`} onClick={()=>setPage(p)}>{p}</button>})}<button type="button" className="page-btn" disabled={safePage>=pageCount} onClick={()=>setPage(p=>Math.min(pageCount,p+1))}><Icon name="chevron-right" size={14}/></button><select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{PAGE_SIZE_OPTIONS.map(n=><option key={n} value={n}>{n} por página</option>)}</select></div></footer>
      </section>
    </main>

    {selected?<aside className="shiny-sales-d2-detail"><div className="detail-head"><div className="detail-title"><Icon name="receipt" size={15}/><span>DETALLE DE LA VENTA</span></div><button type="button" className="detail-close" onClick={()=>setSelected(null)}><Icon name="close" size={15}/></button></div>
      <div className="detail-state-row"><span className={`status-pill ${statusClass(selected.estado_pedido)}`}>{displayOrDash(selected.estado_pedido)}</span></div>
      <div className="detail-sale-id"><strong>{displayOrDash(selected.id_pedido)}</strong><small>{dateTime(selected.fecha||selected.fecha_pago)}</small></div>
      <section className="detail-summary-grid"><div><span>Cliente</span><strong>{cleanText(selected.nombre_cliente)||'Público general'}</strong></div><div className="align-right"><span>Total</span><strong className="grand-total">{money(selected.total)}</strong></div><div><span>Sucursal</span><strong>{displayOrDash(selected.sucursal||selected.id_sucursal)}</strong></div><div className="align-right"><span>Método principal</span><strong>{methodLabel(primaryPayment?.metodo||selected.metodo_pago)}</strong></div><div><span>Operador</span><strong>{displayOrDash(primaryPayment?.administrador||primaryPayment?.id_admin)}</strong></div><div className="align-right"><span>Referencia</span><strong className="reference-box">{displayOrDash(primaryPayment?.referencia||selected.referencia_pago)}</strong></div></section>
      <section className="detail-section"><div className="detail-section-title">ARTÍCULOS <b>({details.length})</b></div><div className="detail-items-table"><div className="mini-head"><span>PRODUCTO</span><span>CANT.</span><span>PRECIO</span><span>TOTAL</span></div>{details.length?details.map(d=><div className="mini-row" key={d.row_id||d.id_detalle}><span>{cleanText(d.producto||d.detalle||d.sku)||'Artículo'}</span><span>{Number(d.cantidad||0)}</span><span>{money(d.precio_unitario||d.precio)}</span><strong>{money(d.subtotal)}</strong></div>):<div className="mini-empty">Sin artículos registrados.</div>}</div></section>
      <section className="detail-section"><div className="detail-section-title">PAGOS <b>({payments.length})</b></div><div className="detail-payments-table"><div className="payment-head"><span>MÉTODO</span><span>DETALLE</span><span>REFERENCIA</span><span>IMPORTE</span><span>ESTADO</span></div>{payments.length?payments.map(p=>{const card=parseProvider(p.proveedor);return <div className="payment-row" key={p.row_id||p.id_pago||p.linea}><span><span className={`method-pill ${cleanText(p.metodo).toLowerCase()}`}>{methodLabel(p.metodo)}</span></span><span className="payment-detail-text">{cleanText(p.metodo).toUpperCase()==='TARJETA'?<><b>Banco: {displayOrDash(card.bank)}</b><small>Marca: {displayOrDash(card.brand)}</small><small>Tipo: {displayOrDash(card.type)}</small></>:<small>{displayOrDash(p.proveedor)}</small>}</span><span>{displayOrDash(p.referencia)}</span><strong>{money(p.importe_aplicado)}</strong><span><span className={`status-pill ${statusClass(p.estado)}`}>{displayOrDash(p.estado)}</span></span></div>}):<div className="mini-empty">Sin pagos registrados.</div>}</div></section>
      <footer className="detail-total-payments"><span>TOTAL PAGOS</span><strong>{money(totalPayments)}</strong></footer>
    </aside>:null}
    </div>
    {detailBusy?<div className="shiny-sales-d2-loading">Cargando detalle…</div>:null}
  </section>;
}
