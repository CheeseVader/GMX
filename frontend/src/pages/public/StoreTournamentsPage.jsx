import { useEffect, useState } from 'react';
import { publicApi, money } from '../../services/publicApi.js';
import '../../memberships_public_r4.css';

export default function StoreTournamentsPage(){
  const [rows,setRows]=useState([]),[error,setError]=useState('');
  useEffect(()=>{publicApi('/api/public/tournaments').then(r=>setRows(r.data||[])).catch(e=>setError(e.message))},[]);
  return <main className="gmx-public-r4">
    <header className="gmx-public-r4-hero"><span>GMX EVENTS</span><h1>Torneos</h1><p>Consulta próximos eventos y cuáles aceptan el beneficio de membresía.</p></header>
    {error?<div className="gmx-public-r4-error">{error}</div>:null}
    <section className="gmx-public-r4-grid tournaments">
      {rows.map(x=><article className="gmx-public-r4-card" key={x.id}>
        <div className="gmx-public-r4-media">{x.imagen?<img src={x.imagen} alt={x.nombre}/>:x.tcg_imagen?<img src={x.tcg_imagen} alt={x.tcg_nombre||''}/>:<div className="gmx-public-r4-placeholder">EVENT</div>}<span>{x.tcg_nombre||x.id_juego} · {x.categoria}</span></div>
        <div className="gmx-public-r4-body"><h2>{x.nombre}</h2><p>{new Date(x.fecha_inicio).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'})}</p><strong>{money(x.costo)}</strong><div className={x.acepta_membresia?'gmx-public-r4-eligible':'gmx-public-r4-blocked'}>{x.acepta_membresia?'✓ Incluido con membresía participante':'Membresía no aplicable'}</div>{x.descripcion?<p className="gmx-public-r4-note">{x.descripcion}</p>:null}</div>
      </article>)}
    </section>
  </main>
}
