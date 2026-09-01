import { brandText } from "../config/brand.js";
import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';

const defaults={
  'loyalty.enabled':'true','loyalty.earn_percent':'1.00','loyalty.point_value_mxn':'0.10',
  'loyalty.max_redemption_percent':'30','loyalty.min_purchase_to_earn':'0','loyalty.expiration_months':'12',
  'loyalty.allow_with_promo':'true','loyalty.tcg_enabled':'true','loyalty.product_enabled':'true',
  'loyalty.earn_basis':'NET_AFTER_DISCOUNTS','loyalty.earn_rounding':'FLOOR','loyalty.show_points_on_receipt':'true'
};
const tabs=[['summary','Resumen'],['rules','Reglas'],['simulator','Simulador'],['clients','Clientes'],['movements','Movimientos'],['advanced','Configuración']];
const mxn=v=>Number(v||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});

export default function LoyaltyManager({clients=[]}){
  const [section,setSection]=useState('summary');
  const [clientId,setClientId]=useState(''); const [data,setData]=useState(null);
  const [points,setPoints]=useState(0); const [reason,setReason]=useState(''); const [message,setMessage]=useState('');
  const [rules,setRules]=useState({...defaults}); const [exampleSale,setExampleSale]=useState(1000);
  useEffect(()=>{api('/api/v1/content/settings?prefix=loyalty.').then(r=>setRules({...defaults,...Object.fromEntries((r.data||[]).map(x=>[x.parametro,x.valor]))})).catch(e=>setMessage(e.message));},[]);
  async function load(id=clientId){if(!id){setData(null);return;}try{const r=await api(`/api/v1/benefits/clients/${id}`);setData(r.data);setMessage('');}catch(e){setMessage(e.message)}}
  async function adjust(){try{const r=await api(`/api/v1/benefits/clients/${clientId}/adjust`,{method:'POST',body:JSON.stringify({points,reason})});setData(r.data);setPoints(0);setReason('');setMessage('Ajuste registrado en el ledger.');}catch(e){setMessage(e.message)}}
  function setRule(k,v){setRules(x=>({...x,[k]:String(v)}))}
  async function saveRules(){try{await api('/api/v1/content/settings',{method:'PUT',body:JSON.stringify(rules)});setMessage('Reglas de fidelidad guardadas. Las siguientes ventas usarán esta configuración.');}catch(e){setMessage(e.message)}}
  const calc=useMemo(()=>{const sale=Math.max(0,Number(exampleSale||0)),percent=Math.max(0,Number(rules['loyalty.earn_percent']||0)),pointValue=Math.max(.0001,Number(rules['loyalty.point_value_mxn']||.1)),rewardValue=sale*(percent/100),raw=rewardValue/pointValue,rounding=String(rules['loyalty.earn_rounding']||'FLOOR').toUpperCase(),earned=rounding==='ROUND'?Math.round(raw):rounding==='CEIL'?Math.ceil(raw):Math.floor(raw);return{sale,percent,pointValue,rewardValue,earned}},[rules,exampleSale]);
  const balance=Number(data?.account?.puntos_disponibles||0), movements=data?.movements||[];
  const positives=movements.filter(m=>Number(m.puntos)>0).reduce((a,m)=>a+Number(m.puntos),0), negatives=Math.abs(movements.filter(m=>Number(m.puntos)<0).reduce((a,m)=>a+Number(m.puntos),0));
  const go=s=>setSection(s);
  const ClientSelect=()=> <label className="span2">Cliente<select value={clientId} onChange={e=>{setClientId(e.target.value);load(e.target.value)}}><option value="">Selecciona...</option>{clients.map(c=><option key={c.row_id} value={c.id_cliente}>{c.nombre} · {c.email||c.telefono||c.id_cliente}</option>)}</select></label>;

  return <div className="loyalty-a">
    {message?<div className="message">{message}</div>:null}
    <nav className="loyalty-a-tabs" aria-label="Secciones de fidelidad">{tabs.map(([id,label])=><button key={id} className={section===id?'active':''} onClick={()=>go(id)}>{label}</button>)}</nav>

    {section==='summary'?<>
      <div className="loyalty-a-kpis">
        <article><span>Programa</span><strong>{rules['loyalty.enabled']==='true'?'Activo':'Inactivo'}</strong><small>{rules['loyalty.earn_percent']}% recompensa</small></article>
        <article><span>Valor de 1 punto</span><strong>{mxn(rules['loyalty.point_value_mxn'])}</strong><small>MXN por punto</small></article>
        <article><span>Cliente seleccionado</span><strong>{clientId?`${balance.toLocaleString('es-MX')} pts`:'—'}</strong><small>{clientId?`Nivel ${data?.account?.nivel||'BASE'}`:'Selecciona uno en Clientes'}</small></article>
        <article><span>Valor del saldo</span><strong>{clientId?mxn(balance*Number(rules['loyalty.point_value_mxn']||.1)):'—'}</strong><small>según valor actual</small></article>
      </div>
      <div className="loyalty-a-summary-grid">
        <article className="contentmk-card"><div className="loyalty-section-head"><div><h3>Estado del programa</h3><p>Configuración principal vigente.</p></div><span className={rules['loyalty.enabled']==='true'?'loyalty-status on':'loyalty-status'}>{rules['loyalty.enabled']==='true'?'ACTIVO':'INACTIVO'}</span></div><div className="loyalty-a-facts"><span>Recompensa <b>{rules['loyalty.earn_percent']}%</b></span><span>Máx. redención <b>{rules['loyalty.max_redemption_percent']}%</b></span><span>Compra mínima <b>{mxn(rules['loyalty.min_purchase_to_earn'])}</b></span><span>Caducidad <b>{rules['loyalty.expiration_months']==='0'?'Sin caducidad':`${rules['loyalty.expiration_months']} meses`}</b></span></div><button className="secondary" onClick={()=>go('rules')}>Ver reglas</button></article>
        <article className="contentmk-card"><div className="loyalty-section-head"><div><h3>Actividad del cliente</h3><p>{clientId?'Movimientos de la cuenta seleccionada.':'Selecciona un cliente para consultar actividad real.'}</p></div>{clientId?<button className="secondary compact" onClick={()=>go('movements')}>Ver movimientos</button>:null}</div>{clientId?<div className="loyalty-a-facts"><span>Generados <b className="points-plus">+{positives.toLocaleString('es-MX')}</b></span><span>Usados / ajustes <b className="points-minus">-{negatives.toLocaleString('es-MX')}</b></span><span>Movimientos <b>{movements.length}</b></span><span>Saldo <b>{balance.toLocaleString('es-MX')} pts</b></span></div>:<div className="loyalty-a-empty">Sin cliente seleccionado.</div>}<button className="secondary" onClick={()=>go('clients')}>Ir a clientes</button></article>
      </div>
      <div className="architecture-note"><b>¿Cómo funciona?</b><p>{brandText('Al confirmar una venta con cliente, GMX genera puntos según las reglas vigentes y registra cada movimiento en el ledger. Redenciones, cancelaciones y devoluciones conservan el historial para auditoría.')}</p></div>
      <div className="loyalty-quick"><button onClick={()=>go('clients')}><b>Buscar cliente</b><span>Saldo y ajustes</span></button><button onClick={()=>go('simulator')}><b>Simular venta</b><span>Calcula puntos</span></button><button onClick={()=>go('movements')}><b>Movimientos</b><span>Consulta el ledger</span></button><button onClick={()=>go('advanced')}><b>Configuración</b><span>POS y comprobante</span></button></div>
    </>:null}

    {section==='rules'?<article className="contentmk-card"><div className="loyalty-section-head"><div><h3>Reglas de fidelidad</h3><p>Define cómo se generan y utilizan los puntos.</p></div><button onClick={saveRules}>Guardar reglas</button></div><div className="contentmk-fields cols3">
      <label className="check-field"><input type="checkbox" checked={rules['loyalty.enabled']==='true'} onChange={e=>setRule('loyalty.enabled',e.target.checked)}/><span>Programa activo</span></label>
      <label>% de recompensa por venta<input type="number" min="0" max="100" step=".01" value={rules['loyalty.earn_percent']} onChange={e=>setRule('loyalty.earn_percent',e.target.value)}/><small>Porcentaje devuelto como valor en puntos.</small></label>
      <label>Valor de 1 punto (MXN)<input type="number" min=".01" step=".01" value={rules['loyalty.point_value_mxn']} onChange={e=>setRule('loyalty.point_value_mxn',e.target.value)}/><small>Equivalencia monetaria de cada punto.</small></label>
      <label>Máximo pagable con puntos (%)<input type="number" min="0" max="100" value={rules['loyalty.max_redemption_percent']} onChange={e=>setRule('loyalty.max_redemption_percent',e.target.value)}/></label>
      <label>Compra mínima para generar puntos<input type="number" min="0" step=".01" value={rules['loyalty.min_purchase_to_earn']} onChange={e=>setRule('loyalty.min_purchase_to_earn',e.target.value)}/></label>
      <label>Caducidad (meses)<input type="number" min="0" value={rules['loyalty.expiration_months']} onChange={e=>setRule('loyalty.expiration_months',e.target.value)}/><small>0 = sin caducidad automática.</small></label>
      <label>Base para recompensa<select value={rules['loyalty.earn_basis']} onChange={e=>setRule('loyalty.earn_basis',e.target.value)}><option value="NET_AFTER_DISCOUNTS">Total neto después de descuentos</option><option value="SUBTOTAL_BEFORE_DISCOUNTS">Subtotal antes de descuentos</option></select></label>
      <label>Redondeo<select value={rules['loyalty.earn_rounding']} onChange={e=>setRule('loyalty.earn_rounding',e.target.value)}><option value="FLOOR">Hacia abajo</option><option value="ROUND">Al más cercano</option><option value="CEIL">Hacia arriba</option></select></label>
      <label className="check-field"><input type="checkbox" checked={rules['loyalty.allow_with_promo']==='true'} onChange={e=>setRule('loyalty.allow_with_promo',e.target.checked)}/><span>Combinar puntos + promociones</span></label>
    </div></article>:null}

    {section==='simulator'?<article className="contentmk-card loyalty-simulator"><div className="loyalty-section-head"><div><h3>Simulador de puntos</h3><p>Prueba el resultado de las reglas sin registrar una venta.</p></div></div><div className="loyalty-sim-grid"><label>Venta de ejemplo<input type="number" min="0" step="100" value={exampleSale} onChange={e=>setExampleSale(Number(e.target.value||0))}/></label><div><span>Recompensa ({calc.percent}%)</span><strong>{mxn(calc.rewardValue)}</strong></div><div><span>Valor del punto</span><strong>{mxn(calc.pointValue)}</strong></div><div className="result"><span>Puntos que recibe</span><strong>{calc.earned.toLocaleString('es-MX')} <small>pts</small></strong></div></div></article>:null}

    {section==='clients'?<article className="contentmk-card"><div className="loyalty-section-head"><div><h3>Cuenta de cliente</h3><p>Consulta saldo y registra ajustes auditables.</p></div></div><div className="contentmk-fields cols2"><ClientSelect/><div className="loyalty-balance"><span>Saldo actual</span><strong>{balance.toLocaleString('es-MX')} pts</strong><small>Nivel {data?.account?.nivel||'BASE'}</small></div><div className="loyalty-balance"><span>Valor aproximado</span><strong>{mxn(balance*Number(rules['loyalty.point_value_mxn']||.1))}</strong><small>según valor actual por punto</small></div><label>Ajuste (+ / -)<input type="number" value={points} onChange={e=>setPoints(Number(e.target.value||0))}/></label><label>Motivo<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Obligatorio para auditoría"/></label></div><button disabled={!clientId||!points||!reason.trim()} onClick={adjust}>Registrar ajuste</button></article>:null}

    {section==='movements'?<article className="contentmk-card"><div className="loyalty-section-head"><div><h3>Movimientos de puntos</h3><p>Ledger auditable por cliente.</p></div></div><div className="contentmk-fields cols2 loyalty-movement-client"><ClientSelect/></div><div className="contentmk-table"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Puntos</th><th>Saldo</th><th>Pedido</th><th>Motivo</th></tr></thead><tbody>{movements.map(m=><tr key={m.row_id}><td>{new Date(m.fecha).toLocaleString('es-MX')}</td><td>{m.tipo}</td><td className={Number(m.puntos)>=0?'points-plus':'points-minus'}>{Number(m.puntos)>=0?'+':''}{m.puntos}</td><td>{m.saldo_nuevo}</td><td>{m.id_pedido||'—'}</td><td>{m.motivo||'—'}</td></tr>)}{!movements.length?<tr><td colSpan="6"><div className="empty-box">Selecciona un cliente para ver sus movimientos.</div></td></tr>:null}</tbody></table></div></article>:null}

    {section==='advanced'?<article className="contentmk-card"><div className="loyalty-section-head"><div><h3>Configuración avanzada</h3><p>Canales y comportamiento complementario del programa.</p></div><button onClick={saveRules}>Guardar configuración</button></div><div className="loyalty-advanced-grid"><label className="check-field"><input type="checkbox" checked={rules['loyalty.product_enabled']==='true'} onChange={e=>setRule('loyalty.product_enabled',e.target.checked)}/><span><b>POS Productos</b><small>Generar puntos en ventas de productos.</small></span></label><label className="check-field"><input type="checkbox" checked={rules['loyalty.tcg_enabled']==='true'} onChange={e=>setRule('loyalty.tcg_enabled',e.target.checked)}/><span><b>POS TCG</b><small>Generar puntos en ventas de cartas TCG.</small></span></label><label className="check-field"><input type="checkbox" checked={rules['loyalty.show_points_on_receipt']==='true'} onChange={e=>setRule('loyalty.show_points_on_receipt',e.target.checked)}/><span><b>Comprobante</b><small>Mostrar puntos generados en ticket o PDF.</small></span></label></div><div className="architecture-note"><b>Registro por venta</b><p>{brandText('GMX conserva generación, redención y movimientos inversos en el ledger para mantener trazabilidad y auditoría.')}</p></div></article>:null}
  </div>;
}
