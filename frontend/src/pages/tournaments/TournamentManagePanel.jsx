import {useEffect,useState} from 'react';
import {api} from '../../services/api.js';
import SecureMedia from '../../components/SecureMedia.jsx';
import {dateTimeMx,money,tcgImage,initials} from './utils.js';
import ParticipantList from './ParticipantList.jsx';
import RegistrationPanel from './RegistrationPanel.jsx';
import TournamentImagePanel from './TournamentImagePanel.jsx';

export default function TournamentManagePanel({tournament,games,onBack,mediaId='',imagePosition='center',onImageChanged}){
  const [tab,setTab]=useState('general');
  const [registrations,setRegistrations]=useState([]);
  const [loading,setLoading]=useState(false);

  async function loadRegistrations(){
    if(!tournament?.id)return;
    setLoading(true);
    try{
      const r=await api(`/api/v1/memberships/tournaments/${encodeURIComponent(tournament.id)}/registrations`);
      setRegistrations(r.data||[]);
    }finally{setLoading(false)}
  }
  useEffect(()=>{loadRegistrations().catch(()=>setRegistrations([]));},[tournament?.id]);

  const image=tcgImage(tournament,games);

  return <section className="gmx-d3-manage">
    <button type="button" className="gmx-d3-back" onClick={onBack}>← Torneos</button>
    <div className="gmx-d3-manage-hero">
      <div className="gmx-d3-manage-art">
        {mediaId?<SecureMedia mediaId={mediaId} alt="" style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:imagePosition||'center'}}/>
          :image?<img src={image} alt="" style={{objectPosition:imagePosition||'center'}}/>
          :<b>{initials(tournament.tcg_nombre||tournament.id_juego)}</b>}
      </div>
      <div><span>{tournament.tcg_nombre||tournament.id_juego}</span><h2>{tournament.nombre}</h2><p>{dateTimeMx(tournament.fecha_inicio)} · {tournament.categoria||'LOCAL'}</p></div>
      <div className="gmx-d3-manage-stats"><small>Costo</small><b>{money(tournament.costo)}</b><small>Cupo</small><b>{tournament.cupo||'Sin límite'}</b></div>
    </div>

    <nav className="gmx-d3-subnav">
      {[
        ['general','General'],
        ['participants','Participantes'],
        ['register','Inscribir'],
        ['memberships','Membresías'],
        ['image','Imagen']
      ].map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>

    {tab==='general'?<div className="gmx-d3-general-grid">
      <article><span>Estado</span><b>{tournament.estado||'PROGRAMADO'}</b></article>
      <article><span>Participantes</span><b>{registrations.length} / {tournament.cupo||'∞'}</b></article>
      <article><span>Membresía</span><b>{tournament.acepta_membresia?'Acepta entrada incluida':'No aplica'}</b></article>
      <article><span>TCG</span><b>{tournament.tcg_nombre||tournament.id_juego}</b></article>
      <div className="gmx-d3-rule">{tournament.acepta_membresia?'Los clientes con membresía activa del mismo TCG pueden utilizar una entrada incluida, sujeto a disponibilidad y reglas vigentes.':'Este torneo no utiliza beneficios de membresía.'}</div>
    </div>:null}

    {tab==='participants'?<ParticipantList rows={registrations} loading={loading}/>:null}
    {tab==='register'?<RegistrationPanel tournament={tournament} onRegistered={loadRegistrations}/>:null}
    {tab==='memberships'?<div className="gmx-d3-membership-info"><h3>Membresías</h3><p>{tournament.acepta_membresia?'Este torneo acepta entradas incluidas de membresías compatibles con el mismo TCG. La validación se realiza al momento de inscribir al jugador.':'Este torneo está configurado sin beneficios de membresía.'}</p><div><b>{registrations.filter(x=>String(x.tipo_pago||'').toUpperCase()==='MEMBRESIA').length}</b><span>inscripciones con membresía</span></div></div>:null}
    {tab==='image'?<TournamentImagePanel tournament={tournament} games={games} mediaId={mediaId} imagePosition={imagePosition} onChanged={onImageChanged}/>:null}
  </section>
}
