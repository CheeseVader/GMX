import {useState} from 'react';
import {api} from '../../services/api.js';

const blank={nombre:'',id_juego:'',categoria:'LOCAL',fecha_inicio:'',costo:0,cupo:32,acepta_membresia:true,confirmar_excepcion:false,descripcion:''};
const major=new Set(['OFICIAL','CLASIFICATORIO','REGIONAL','PREMIER','ESPECIAL']);

export default function CreateTournamentPanel({games,onClose,onCreated}){
  const [form,setForm]=useState(blank);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');

  async function save(){
    if(!form.nombre.trim()||!form.id_juego||!form.fecha_inicio){setMessage('Captura nombre, TCG y fecha/hora.');return}
    if(major.has(form.categoria)&&form.acepta_membresia&&!form.confirmar_excepcion){setMessage('Confirma la excepción GMX para permitir membresía en un evento mayor.');return}
    setSaving(true);
    try{
      await api('/api/v1/memberships/tournaments',{method:'POST',body:JSON.stringify(form)});
      if(onCreated)await onCreated();
      onClose();
    }catch(e){setMessage(e.message)}
    finally{setSaving(false)}
  }

  return <div className="gmx-d3-drawer-backdrop" onMouseDown={onClose}>
    <aside className="gmx-d3-drawer" onMouseDown={e=>e.stopPropagation()}>
      <div className="gmx-d3-drawer-head"><div><span>NUEVO EVENTO</span><h2>Crear torneo</h2></div><button type="button" onClick={onClose}>×</button></div>
      {message?<div className="gmx-d3-inline-message">{message}</div>:null}
      <div className="gmx-d3-form">
        <label>Nombre<input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></label>
        <label>TCG<select value={form.id_juego} onChange={e=>setForm({...form,id_juego:e.target.value})}><option value="">Seleccionar…</option>{games.map(g=><option key={g.id_juego} value={g.id_juego}>{g.nombre}</option>)}</select></label>
        <label>Categoría<select value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value,acepta_membresia:major.has(e.target.value)?false:form.acepta_membresia,confirmar_excepcion:false})}>{['LOCAL','REGULAR','ESPECIAL','CLASIFICATORIO','OFICIAL','REGIONAL','PREMIER'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Fecha / hora<input type="datetime-local" value={form.fecha_inicio} onChange={e=>setForm({...form,fecha_inicio:e.target.value})}/></label>
        <label>Costo<input type="number" min="0" step="0.01" value={form.costo} onChange={e=>setForm({...form,costo:e.target.value})}/></label>
        <label>Cupo<input type="number" min="1" value={form.cupo} onChange={e=>setForm({...form,cupo:e.target.value})}/></label>
      </div>
      <label className="gmx-d3-check"><input type="checkbox" checked={form.acepta_membresia} onChange={e=>setForm({...form,acepta_membresia:e.target.checked})}/> Acepta entrada incluida con membresía</label>
      {major.has(form.categoria)&&form.acepta_membresia?<label className="gmx-d3-check warning"><input type="checkbox" checked={form.confirmar_excepcion} onChange={e=>setForm({...form,confirmar_excepcion:e.target.checked})}/> Confirmo excepción GMX para este evento mayor.</label>:null}
      <button className="gmx-d3-primary" type="button" disabled={saving} onClick={save}>{saving?'Guardando…':'Crear torneo'}</button>
    </aside>
  </div>
}
