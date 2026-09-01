export const money=value=>Number(value||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
export const dateTimeMx=value=>value?new Date(value).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}):'—';
export const initials=name=>String(name||'TCG').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();

export function tournamentStatus(row){
  const raw=String(row?.estado||'').toUpperCase();
  if(['FINALIZADO','CERRADO','CANCELADO'].includes(raw)) return 'FINALIZADO';
  const d=row?.fecha_inicio?new Date(row.fecha_inicio):null;
  if(d && !Number.isNaN(d.getTime())){
    const now=new Date();
    const same=d.toDateString()===now.toDateString();
    if(same) return 'HOY';
    if(d<now) return 'FINALIZADO';
  }
  return 'PROXIMO';
}

export function tcgImage(tournament,games=[]){
  if(tournament?.tcg_imagen) return tournament.tcg_imagen;
  const game=games.find(g=>String(g.id_juego)===String(tournament?.id_juego));
  return game?.imagen||game?.image||game?.logo||'';
}
