import SecureMedia from '../../components/SecureMedia.jsx';
import {dateTimeMx,money,tcgImage,tournamentStatus,initials} from './utils.js';

export default function TournamentCard({tournament,games,onOpen,mediaId='',imagePosition='center'}){
  const image=tcgImage(tournament,games);
  const status=tournamentStatus(tournament);
  const registered=Number(tournament.inscritos||tournament.registration_count||0);
  const capacity=Number(tournament.cupo||0);
  const pct=capacity?Math.min(100,Math.round((registered/capacity)*100)):0;

  return <article className="gmx-d3-card">
    <div className="gmx-d3-card-media">
      {mediaId?
        <SecureMedia mediaId={mediaId} className="gmx-d3-card-secure-image" alt={tournament.nombre||'Torneo'} style={{objectPosition:imagePosition||'center'}}/>
        :image?<img src={image} alt={tournament.tcg_nombre||tournament.nombre||'TCG'} style={{objectPosition:imagePosition||'center'}}/>
        :<div className="gmx-d3-card-fallback">{initials(tournament.tcg_nombre||tournament.id_juego)}</div>}
      <span className={`gmx-d3-status ${status.toLowerCase()}`}>{status==='PROXIMO'?'PRÓXIMO':status}</span>
    </div>
    <div className="gmx-d3-card-body">
      <h3>{tournament.nombre}</h3>
      <p>{tournament.tcg_nombre||tournament.id_juego||'TCG'} · {tournament.categoria||'LOCAL'}</p>
      <div className="gmx-d3-card-meta"><span>{dateTimeMx(tournament.fecha_inicio)}</span><b>{money(tournament.costo)}</b></div>
      <div className="gmx-d3-capacity">
        <div><span>{registered} / {capacity||'∞'} inscritos</span><strong>{capacity?`${pct}%`:''}</strong></div>
        <div className="gmx-d3-progress"><i style={{width:`${pct}%`}}/></div>
      </div>
      <button type="button" className="gmx-d3-primary" onClick={()=>onOpen(tournament)}>Administrar torneo</button>
    </div>
  </article>
}
