import {initials} from './utils.js';

export default function ParticipantList({rows=[],loading=false}){
  return <div className="gmx-d3-participants">
    <div className="gmx-d3-section-title"><div><span>PARTICIPANTES</span><h3>{rows.length} inscritos</h3></div>{loading?<small>Cargando…</small>:null}</div>
    {rows.length?<div className="gmx-d3-participant-list">
      {rows.map(x=><div className="gmx-d3-participant" key={x.id||`${x.id_torneo}-${x.id_cliente}`}>
        <i>{initials(x.nombre)}</i>
        <div><b>{x.nombre||x.id_cliente}</b><small>{[x.telefono,x.email].filter(Boolean).join(' · ')||x.id_cliente}</small></div>
        <span className={String(x.tipo_pago||'').toUpperCase()==='MEMBRESIA'?'membership':'normal'}>{String(x.tipo_pago||'').toUpperCase()==='MEMBRESIA'?'MEMBRESÍA':'NORMAL'}</span>
      </div>)}
    </div>:<div className="gmx-d3-empty">Aún no hay jugadores inscritos en este torneo.</div>}
  </div>
}
