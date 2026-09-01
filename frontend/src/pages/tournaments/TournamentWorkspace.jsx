import {useEffect,useMemo,useState} from 'react';
import {api} from '../../services/api.js';
import TournamentCard from './TournamentCard.jsx';
import TournamentManagePanel from './TournamentManagePanel.jsx';
import CreateTournamentPanel from './CreateTournamentPanel.jsx';
import {tournamentStatus} from './utils.js';

const imageKey=id=>`tournament.image.${id}`;
const positionKey=id=>`tournament.image_position.${id}`;

export default function TournamentWorkspace(){
  const [rows,setRows]=useState([]);
  const [games,setGames]=useState([]);
  const [settings,setSettings]=useState({});
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [gameFilter,setGameFilter]=useState('');
  const [selected,setSelected]=useState(null);
  const [creating,setCreating]=useState(false);
  const [message,setMessage]=useState('');

  async function loadSettings(){
    try{
      const r=await api('/api/v1/content/settings');
      setSettings(Object.fromEntries((r.data||[]).map(x=>[x.parametro,String(x.valor??'')])));
    }catch{setSettings({})}
  }

  async function load(){
    const [a,g]=await Promise.all([
      api('/api/v1/memberships/tournaments'),
      api('/api/v1/tcg/games')
    ]);
    setRows(a.data||[]);
    setGames(g.data||[]);
    await loadSettings();
  }

  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);

  const filtered=useMemo(()=>rows.filter(x=>{
    const status=tournamentStatus(x);
    if(filter==='today'&&status!=='HOY')return false;
    if(filter==='upcoming'&&status!=='PROXIMO')return false;
    if(filter==='finished'&&status!=='FINALIZADO')return false;
    if(gameFilter&&String(x.id_juego)!==String(gameFilter))return false;
    const q=query.trim().toLowerCase();
    if(q&&!`${x.nombre||''} ${x.tcg_nombre||''} ${x.id_juego||''} ${x.categoria||''}`.toLowerCase().includes(q))return false;
    return true;
  }),[rows,filter,query,gameFilter]);

  if(selected){
    const fresh=rows.find(x=>String(x.id)===String(selected.id))||selected;
    return <TournamentManagePanel
      tournament={fresh}
      games={games}
      mediaId={settings[imageKey(fresh.id)]||''}
      imagePosition={settings[positionKey(fresh.id)]||'center'}
      onImageChanged={loadSettings}
      onBack={()=>setSelected(null)}
    />;
  }

  return <div className="admin-stack r23-view gmx-d3-page">
    <section className="gmx-d3-titlebar">
      <div><span>GESTIÓN · EVENTOS</span><h1>Torneos</h1><p>Administra eventos, participantes, membresías, inscripciones e imagen visual desde submódulos separados.</p></div>
      <button className="gmx-d3-primary compact" type="button" onClick={()=>setCreating(true)}>＋ Nuevo torneo</button>
    </section>

    {message?<div className="gmx-d3-inline-message">{message}</div>:null}

    <section className="gmx-d3-toolbar">
      <nav>
        {[['all','Todos'],['today','Hoy'],['upcoming','Próximos'],['finished','Finalizados']].map(([id,label])=><button key={id} type="button" className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label}</button>)}
      </nav>
      <div className="gmx-d3-filters">
        <label><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar torneo…"/></label>
        <select value={gameFilter} onChange={e=>setGameFilter(e.target.value)}><option value="">TCG: Todos</option>{games.map(g=><option key={g.id_juego} value={g.id_juego}>{g.nombre}</option>)}</select>
      </div>
    </section>

    <section className="gmx-d3-grid">
      {filtered.map(x=><TournamentCard
        key={x.id}
        tournament={x}
        games={games}
        mediaId={settings[imageKey(x.id)]||''}
        imagePosition={settings[positionKey(x.id)]||'center'}
        onOpen={setSelected}
      />)}
      {!filtered.length?<div className="gmx-d3-empty wide">No hay torneos para los filtros seleccionados.</div>:null}
    </section>

    {creating?<CreateTournamentPanel games={games} onClose={()=>setCreating(false)} onCreated={load}/>:null}
  </div>
}
