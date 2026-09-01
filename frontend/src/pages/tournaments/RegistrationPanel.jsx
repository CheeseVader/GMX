import {useEffect,useMemo,useState} from 'react';
import {api} from '../../services/api.js';
import {initials} from './utils.js';

export default function RegistrationPanel({tournament,onRegistered}){
  const [search,setSearch]=useState('');
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState(null);
  const [memberships,setMemberships]=useState([]);
  const [useMembership,setUseMembership]=useState(Boolean(tournament?.acepta_membresia));
  const [registering,setRegistering]=useState(false);
  const [scanLoading,setScanLoading]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{setUseMembership(Boolean(tournament?.acepta_membresia));},[tournament?.id,tournament?.acepta_membresia]);

  useEffect(()=>{
    const timer=setTimeout(async()=>{
      setLoading(true);
      try{
        const r=await api(`/api/v1/clients?limit=100&search=${encodeURIComponent(search.trim())}`);
        setClients(r.data||[]);
      }catch(e){setMessage(e.message);setClients([])}
      finally{setLoading(false)}
    },search.trim()?180:0);
    return()=>clearTimeout(timer);
  },[search]);

  async function selectClient(c){
    setSelected(c);
    setSearch(c.nombre||c.id_cliente);
    try{
      const r=await api(`/api/v1/memberships/clients/${encodeURIComponent(c.id_cliente)}`);
      setMemberships(r.data||[]);
    }catch(e){setMemberships([]);setMessage(e.message)}
  }

  async function scanMembership(code){
    const raw=String(code||'').trim();
    if(!raw)return;
    setScanLoading(true);
    try{
      const r=await api('/api/v1/memberships/validate',{method:'POST',body:JSON.stringify({code:raw})});
      const m=r.data;
      if(!m?.id_cliente) throw new Error('El código no contiene una membresía válida.');
      const cr=await api(`/api/v1/clients?limit=20&search=${encodeURIComponent(m.id_cliente)}`);
      const c=(cr.data||[]).find(x=>String(x.id_cliente)===String(m.id_cliente))||(cr.data||[])[0];
      if(!c) throw new Error('La membresía existe, pero no se encontró el cliente.');
      await selectClient(c);
      setUseMembership(true);
      setMessage(`Membresía válida para ${c.nombre||c.id_cliente}.`);
    }catch(e){setMessage(e.message)}
    finally{setScanLoading(false)}
  }

  const compatible=useMemo(()=>selected&&tournament?memberships.find(m=>
    String(m.id_juego)===String(tournament.id_juego)&&
    String(m.estado||'').toUpperCase()==='ACTIVA'&&
    (!m.fin||new Date(m.fin)>new Date())
  ):null,[selected,tournament,memberships]);

  async function register(){
    if(!selected||!tournament)return;
    setRegistering(true);
    setMessage('');
    try{
      const r=await api(`/api/v1/memberships/tournaments/${encodeURIComponent(tournament.id)}/register-client`,{
        method:'POST',
        body:JSON.stringify({clientId:selected.id_cliente,useMembership:Boolean(useMembership)})
      });
      setMessage(r.message||'Jugador inscrito correctamente.');
      if(onRegistered) await onRegistered();
    }catch(e){
      const raw=String(e?.message||e||'');
      if(raw.startsWith('TOURNAMENT_ALREADY_REGISTERED|')){
        const name=raw.substring('TOURNAMENT_ALREADY_REGISTERED|'.length).trim();
        setMessage(`Este jugador ya se encuentra inscrito en ${name||'este torneo'}.`);
      }else setMessage(raw);
    }finally{setRegistering(false)}
  }

  return <div className="gmx-d3-registration">
    <div className="gmx-d3-section-title"><div><span>INSCRIBIR</span><h3>Registrar jugador</h3></div></div>
    {message?<div className="gmx-d3-inline-message">{message}</div>:null}
    <label className="gmx-d3-search">
      <span>⌕</span>
      <input value={search} onChange={e=>{setSearch(e.target.value);setSelected(null);setMemberships([])}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();scanMembership(search)}}} placeholder="Nombre, teléfono, email, ID o escanear QR/barras"/>
      <small>{loading||scanLoading?'…':''}</small>
    </label>
    {!selected&&clients.length?<div className="gmx-d3-client-results">
      {clients.slice(0,12).map(c=><button type="button" key={c.row_id||c.id_cliente} onClick={()=>selectClient(c)}>
        <i>{initials(c.nombre)}</i><span><b>{c.nombre||c.id_cliente}</b><small>{[c.telefono,c.email,c.id_cliente].filter(Boolean).join(' · ')}</small></span>
      </button>)}
    </div>:null}
    {selected?<div className="gmx-d3-selected-client"><i>{initials(selected.nombre)}</i><div><small>CLIENTE SELECCIONADO</small><b>{selected.nombre}</b><span>{selected.email||selected.telefono||selected.id_cliente}</span></div><em>REGISTRADO</em></div>:null}
    <div className={`gmx-d3-membership-box ${compatible?'ok':'neutral'}`}>
      <div><span>Membresía compatible</span><b>{compatible?`${compatible.nombre||'Membresía'} · ${compatible.tcg_nombre||tournament.tcg_nombre||tournament.id_juego}`:'No detectada para el TCG del torneo'}</b></div>
      {compatible?<em>ACTIVA</em>:null}
    </div>
    <label className="gmx-d3-check"><input type="checkbox" checked={useMembership} disabled={!tournament?.acepta_membresia} onChange={e=>setUseMembership(e.target.checked)}/> Usar entrada incluida de membresía si es válida</label>
    <button type="button" className="gmx-d3-primary" disabled={!selected||registering} onClick={register}>{registering?'Inscribiendo…':'Inscribir jugador'}</button>
  </div>
}
