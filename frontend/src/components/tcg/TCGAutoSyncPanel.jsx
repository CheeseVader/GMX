import { brandText } from "../../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api.js';
import SecureMedia from '../SecureMedia.jsx';
import '../../tcg_autosync_approved_r42.css';
function when(value) {
  if (!value) return 'Nunca';
  try {return new Date(value).toLocaleString('es-MX');} catch {return String(value);}
}
function money(value, currency) {
  if (value == null || value === '') return '—';
  try {return Number(value).toLocaleString('es-MX', { style: 'currency', currency: currency || 'USD' });}
  catch {return `${value} ${currency || ''}`;}
}

export default function TCGAutoSyncPanel() {
  const [providers, setProviders] = useState([]);
  const [gameCode, setGameCode] = useState('');
  const [sets, setSets] = useState([]);
  const [selected, setSelected] = useState([]);
  const [syncPrices, setSyncPrices] = useState(true);
  const [downloadImages, setDownloadImages] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [frequency, setFrequency] = useState('WEEKLY');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState([]);
  const [priceCard, setPriceCard] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [priceProvider, setPriceProvider] = useState('');
  const [lastCardSyncResult, setLastCardSyncResult] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [tcgIcons, setTcgIcons] = useState({});
  const [iconBusy, setIconBusy] = useState('');
  const [setSort, setSetSort] = useState('AZ');
  const [selectedGames, setSelectedGames] = useState(()=>{
    try{return JSON.parse(localStorage.getItem('SHINY_AUTO_SYNC_SELECTED_GAMES')||'[]');}
    catch{return [];}
  });
  const [syncMode,setSyncMode] = useState('INCREMENTAL');
  const [multiSyncResults,setMultiSyncResults] = useState([]);


  const tcgIconSettingKey=(code)=>`tcg.icon.${String(code||'').replace(/[^a-zA-Z0-9_.-]/g,'_')}`;

  async function loadTcgIcons() {
    try {
      const r=await api('/api/v1/content/settings?prefix=tcg.icon.');
      const next={};
      for(const row of (r.data||[])){
        const key=String(row.parametro||'');
        if(!key.startsWith('tcg.icon.'))continue;
        next[key.slice('tcg.icon.'.length)]=String(row.valor||'');
      }
      setTcgIcons(next);
      try{localStorage.setItem('SHINY_TCG_ICONS_CACHE',JSON.stringify(next));}catch{}
    } catch {
      try{
        setTcgIcons(JSON.parse(localStorage.getItem('SHINY_TCG_ICONS_CACHE')||'{}'));
      }catch{setTcgIcons({});}
    }
  }

  function iconIdFor(code){
    const safe=String(code||'').replace(/[^a-zA-Z0-9_.-]/g,'_');
    return tcgIcons[safe]||'';
  }

  async function uploadTcgIcon(game,file){
    if(!game?.game_code||!file)return;
    if(!String(file.type||'').startsWith('image/')){
      setMessage('Selecciona un archivo de imagen válido.');
      return;
    }
    if(file.size>6*1024*1024){
      setMessage('El icono debe pesar máximo 6 MB.');
      return;
    }

    setIconBusy(game.game_code);
    setMessage('');
    try{
      const token=localStorage.getItem('SHINY_AUTH_TOKEN')||'';
      const resp=await fetch('/api/v1/content/media/upload',{
        method:'POST',
        headers:{
          'Content-Type':'application/octet-stream',
          Authorization:`Bearer ${token}`,
          'X-SHINY-File-Name':encodeURIComponent(file.name),
          'X-SHINY-File-Type':file.type||'application/octet-stream',
          'X-SHINY-Category':'TCG_ICON'
        },
        body:file
      });
      const body=await resp.json().catch(()=>({}));
      if(!resp.ok||body.success===false)throw new Error(body.message||body.error||`HTTP ${resp.status}`);

      const mediaId=
        body.data?.id_media||
        body.data?.media?.id_media||
        body.data?.row?.id_media||
        body.id_media;

      if(!mediaId)throw new Error('La Biblioteca multimedia no devolvió id_media.');

      const settingKey=tcgIconSettingKey(game.game_code);
      await api('/api/v1/content/settings',{
        method:'PUT',
        body:JSON.stringify({[settingKey]:String(mediaId)})
      });

      const safe=String(game.game_code).replace(/[^a-zA-Z0-9_.-]/g,'_');
      setTcgIcons((old)=>{
        const next={...old,[safe]:String(mediaId)};
        try{localStorage.setItem('SHINY_TCG_ICONS_CACHE',JSON.stringify(next));}catch{}
        return next;
      });
      setMessage(`Icono actualizado para ${game.game_name||game.game_code}.`);
    }catch(e){
      setMessage(`No fue posible guardar el icono: ${e.message}`);
    }finally{
      setIconBusy('');
    }
  }


  async function saveGameFx(code,rawRate){
    const rate=Number(rawRate);
    if(!Number.isFinite(rate)||rate<=0){
      setMessage('El TDC debe ser mayor a cero.');
      return;
    }
    try{
      await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/fx`,{
        method:'PUT',
        body:JSON.stringify({rate})
      });
      setProviders((old)=>old.map((p)=>p.game_code===code?{...p,usd_mxn_rate:rate}:p));
      setMessage(`TDC actualizado para ${code}: ${rate.toFixed(2)} MXN/USD.`);
    }catch(e){
      setMessage(`No fue posible guardar el TDC: ${e.message}`);
    }
  }
  function persistSelectedGames(next){
    setSelectedGames(next);
    try{localStorage.setItem('SHINY_AUTO_SYNC_SELECTED_GAMES',JSON.stringify(next));}catch{}
  }

  function toggleGame(code){
    const exists=selectedGames.includes(code);
    let next=exists?selectedGames.filter((x)=>x!==code):[...selectedGames,code];
    persistSelectedGames(next);

    if(!exists){
      setGameCode(code);
      return;
    }

    if(gameCode===code){
      const fallback=next[0]||'';
      setGameCode(fallback);
    }
  }

  const selectedProviderRows=providers.filter((p)=>selectedGames.includes(p.game_code));

  const sortedSets=useMemo(()=>{
    const list=[...sets];
    const text=(v)=>String(v||'').localeCompare;
    if(setSort==='ZA'){
      return list.sort((a,b)=>String(b.nombre||b.codigo||'').localeCompare(String(a.nombre||a.codigo||''),'es',{sensitivity:'base'}));
    }
    if(setSort==='NEW'){
      return list.sort((a,b)=>{
        const da=Date.parse(a.fecha_lanzamiento||0)||0;
        const db=Date.parse(b.fecha_lanzamiento||0)||0;
        return db-da;
      });
    }
    if(setSort==='OLD'){
      return list.sort((a,b)=>{
        const da=Date.parse(a.fecha_lanzamiento||0)||0;
        const db=Date.parse(b.fecha_lanzamiento||0)||0;
        return da-db;
      });
    }
    return list.sort((a,b)=>String(a.nombre||a.codigo||'').localeCompare(String(b.nombre||b.codigo||''),'es',{sensitivity:'base'}));
  },[sets,setSort]);


  const current = providers.find((x) => x.game_code === gameCode) || null;

  async function loadProviders(preferred = '') {
    const r = await api('/api/v1/tcg-sync/providers');
    const list = r.data || [];
    setProviders(list);
    const stored=(()=>{
      try{return JSON.parse(localStorage.getItem('SHINY_AUTO_SYNC_SELECTED_GAMES')||'[]');}
      catch{return [];}
    })().filter((code)=>list.some((p)=>p.game_code===code));

    if(stored.length){
      setSelectedGames(stored);
      const next=preferred || (stored.includes(gameCode)?gameCode:stored[0]);
      if(next)setGameCode(next);
    }else{
      const next=preferred || gameCode || '';
      if(next)setGameCode(next);
    }
    return list;
  }

  async function loadSets(code = gameCode) {
    if (!code) {setSets([]);return;}
    const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/sets`);
    const list = r.data || [];
    setSets(list);
    const cfg = providers.find((x) => x.game_code === code);
    const configured = Array.isArray(cfg?.selected_sets) ? cfg.selected_sets : [];
    if (configured.length) setSelected(configured.filter((x) => list.some((s) => s.codigo === x)));
  }

  /* SHINY_AUTO_SYNC_STEP2_AUTOLOAD_R44 */
  useEffect(()=>{
    if(wizardStep!==2||!gameCode)return;
    loadSets(gameCode).catch((e)=>setMessage(e.message));
  },[wizardStep,gameCode]);
  useEffect(() => {loadProviders().catch((e) => setMessage(e.message));loadTcgIcons();}, []);

  useEffect(() => {
    if (!gameCode) return;
    const p = providers.find((x) => x.game_code === gameCode);
    setSyncPrices(p?.sync_prices !== false);
    setDownloadImages(p?.download_images === true);
    setAutoSync(p?.auto_sync_enabled === true);
    setFrequency(p?.auto_sync_frequency || 'WEEKLY');
    setSelected(Array.isArray(p?.selected_sets) ? p.selected_sets : []);
    setCards([]);setPriceData(null);setPriceCard(null);setSearch('');setLastCardSyncResult(null);
    loadSets(gameCode).catch((e) => setMessage(e.message));
  }, [gameCode, providers.length]);

  function toggleSet(code) {
    setSelected((x) => x.includes(code) ? x.filter((v) => v !== code) : [...x, code]);
  }

  async function saveConfig() {
    if (!gameCode) return;
    setBusy('config');setMessage('');
    try {
      await api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true, region: 'NA_LATAM', language: 'en',
          syncCards: true, syncPrices, downloadImages,
          selectedSets: selected, autoSyncEnabled: autoSync, autoSyncFrequency: frequency
        })
      });
      setMessage('Configuración de sincronización guardada.');
      await loadProviders(gameCode);
    } catch (e) {setMessage(e.message);} finally {setBusy('');}
  }

  async function syncSets() {
    if (!gameCode) return;
    setBusy('sets');setMessage('');
    try {
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/sync-sets`, {
        method: 'POST', body: '{}'
      });
      setMessage(
        r.data.mode === 'REMOTE_API' ?
        `${r.data.sourceUsed || r.data.provider}: ${r.data.sets} expansiones actualizadas.${r.data.warning ? ` ${r.data.warning}` : ''}` :
        `${r.data.provider}: catálogo maestro disponible (${r.data.sets} expansiones).`
      );
      await loadProviders(gameCode);
      await loadSets(gameCode);
    } catch (e) {
      setMessage(`No fue posible sincronizar expansiones: ${e.message}`);
      try {await loadProviders(gameCode);} catch {}
    } finally {setBusy('');}
  }

  async function syncCards() {
    if (!selected.length) return;
    setBusy('cards');setMessage('');
    try {
      const ok = await window.shinyConfirm?.(
        `Se sincronizarán únicamente ${selected.length} expansión(es) de ${current?.game_name || gameCode}. ¿Continuar?`,
        { title: 'Sincronización selectiva', confirmText: 'Sincronizar' }
      );
      if (ok === false) return;
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/sync-cards`, {
        method: 'POST',
        body: JSON.stringify({ setCodes: selected, downloadImages, syncPrices })
      });
      setLastCardSyncResult(r.data || null);
      const warnings = (r.data.sets || []).filter((x) => x.warning).length;
      const errors = (r.data.errors || []).length;
      if (errors) {
        setMessage(`${r.data.cards} cartas y ${r.data.prices} precios sincronizados. ${errors} expansión(es) con error. Revisa el detalle debajo.`);
      } else if (warnings) {
        setMessage(`${r.data.cards} cartas y ${r.data.prices} precios sincronizados correctamente usando fallback en ${warnings} expansión(es).`);
      } else {
        setMessage(`${r.data.cards} cartas y ${r.data.prices} precios sincronizados correctamente.`);
      }
      await loadProviders(gameCode);
      await loadSets(gameCode);
    } catch (e) {
      setLastCardSyncResult(null);
      setMessage(`No fue posible sincronizar cartas: ${e.message}`);
    } finally {setBusy('');}
  }

  async function install() {
    if (!selected.length) return;
    setBusy('install');setMessage('');
    try {
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/install`, {
        method: 'POST', body: JSON.stringify({ setCodes: selected })
      });
      setMessage(brandText(`Instalado en Shiny: ${r.data.sets} expansiones, ${r.data.rarities} rarezas y ${r.data.cards} cartas sincronizadas.`));
    } catch (e) {setMessage(e.message);} finally {setBusy('');}
  }

  async function waitForSyncJob(jobId, token, onProgress) {
    let finalJob = null;
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusResponse = await fetch(`/api/v1/tcg-sync/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-TCG-Store-Template-Progress': 'manual' },
        cache: 'no-store'
      });
      const statusJson = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(statusJson.message || statusJson.error || `HTTP ${statusResponse.status}`);
      const job = statusJson.data || {};
      finalJob = job;
      onProgress?.(job);
      if (job.status === 'completed') return finalJob;
      if (job.status === 'failed') throw new Error(job.error || job.message || 'SYNC_JOB_FAILED');
    }
  }

  async function resolveSetsForGame(code, provider) {
    if (syncMode === 'FULL') {
      await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/sync-sets`, {
        method: 'POST',
        body: '{}'
      });
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/sets`);
      return (r.data || []).map((x) => x.codigo).filter(Boolean);
    }

    if (code === gameCode && selected.length) return [...selected];
    return Array.isArray(provider?.selected_sets) ? provider.selected_sets.filter(Boolean) : [];
  }

  async function waitForSyncJob(jobId, token, onProgress) {
    let finalJob = null;
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusResponse = await fetch(`/api/v1/tcg-sync/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-TCG-Store-Template-Progress': 'manual' },
        cache: 'no-store'
      });
      const statusJson = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(statusJson.message || statusJson.error || `HTTP ${statusResponse.status}`);
      const job = statusJson.data || {};
      finalJob = job;
      onProgress?.(job);
      if (job.status === 'completed') return finalJob;
      if (job.status === 'failed') throw new Error(job.error || job.message || 'SYNC_JOB_FAILED');
    }
  }

  async function resolveSetsForGame(code, provider) {
    if (syncMode === 'FULL') {
      await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/sync-sets`, {
        method: 'POST',
        body: '{}'
      });
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/sets`);
      return (r.data || []).map((x) => x.codigo).filter(Boolean);
    }

    if (code === gameCode && selected.length) return [...selected];
    return Array.isArray(provider?.selected_sets) ? provider.selected_sets.filter(Boolean) : [];
  }

  async function addSelectedToStore() {
    const targets = selectedProviderRows;
    if (!targets.length) {
      setMessage('Selecciona al menos un TCG.');
      return;
    }

    const plan = [];
    for (const provider of targets) {
      const setCodes = await resolveSetsForGame(provider.game_code, provider);
      if (!setCodes.length) {
        plan.push({
          gameCode: provider.game_code,
          gameName: provider.game_name || provider.game_code,
          provider,
          setCodes: [],
          skip: true,
          reason: syncMode === 'FULL' ? 'No se encontraron expansiones remotas.' : 'No tiene expansiones seleccionadas.'
        });
        continue;
      }
      plan.push({
        gameCode: provider.game_code,
        gameName: provider.game_name || provider.game_code,
        provider,
        setCodes,
        skip: false
      });
    }

    const executable = plan.filter((x) => !x.skip);
    if (!executable.length) {
      setMultiSyncResults(plan.map((x)=>({
        gameCode:x.gameCode,gameName:x.gameName,status:'SKIPPED',message:x.reason
      })));
      setMessage('No hay expansiones disponibles para sincronizar.');
      return;
    }

    const totalSets = executable.reduce((n,x)=>n+x.setCodes.length,0);
    const ok = await window.gmxConfirm?.(brandText(
      syncMode === 'FULL'
        ? `FULL SYNC: GMX procesará ${executable.length} TCG y ${totalSets} expansión(es). Descargará/actualizará el catálogo disponible sin tocar stock ni costos. ¿Continuar?`
        : `INCREMENTAL: GMX procesará ${executable.length} TCG y ${totalSets} expansión(es) seleccionadas. Solo actualizará cambios sin tocar stock ni costos. ¿Continuar?`
    ), {
      title: syncMode === 'FULL' ? 'Sincronización completa Multi-TCG' : 'Sincronización incremental Multi-TCG',
      confirmText: 'Sincronizar'
    });
    if (ok === false) return;

    const op = window.gmxOperation?.start({
      title: `${syncMode === 'FULL' ? 'FULL' : 'Incremental'} · ${executable.length} TCG`,
      detail: 'Preparando cola Multi-TCG…',
      progress: 1,
      etaSeconds: null,
      meta: { setsDone: 0, setsTotal: totalSets, cardsDone: 0, cardsTotal: 0, currentSet: '' }
    });

    setBusy('add');
    setMessage('');
    setLastCardSyncResult(null);
    setMultiSyncResults([]);

    const token = localStorage.getItem('GMX_AUTH_TOKEN') || '';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-TCG-Store-Template-Progress': 'manual'
    };

    const results = [];
    let completedSetsBefore = 0;
    let cardsBefore = 0;

    try {
      for (let index = 0; index < plan.length; index++) {
        const item = plan[index];

        if (item.skip) {
          results.push({
            gameCode:item.gameCode,
            gameName:item.gameName,
            status:'SKIPPED',
            sets:0,cards:0,prices:0,
            message:item.reason
          });
          setMultiSyncResults([...results]);
          continue;
        }

        window.gmxOperation?.update(op, {
          detail: `${item.gameName}: iniciando ${item.setCodes.length} expansión(es)…`,
          progress: Math.max(1, Math.round((completedSetsBefore / Math.max(1,totalSets))*100)),
          meta: {
            setsDone: completedSetsBefore,
            setsTotal: totalSets,
            cardsDone: cardsBefore,
            cardsTotal: 0,
            currentSet: item.gameName
          }
        });

        const itemDownloadImages =
          item.gameCode === gameCode ? downloadImages : item.provider?.download_images === true;
        const itemSyncPrices =
          item.gameCode === gameCode ? syncPrices : item.provider?.sync_prices !== false;

        const startResponse = await fetch(`/api/v1/tcg-sync/games/${encodeURIComponent(item.gameCode)}/add-job`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            setCodes: item.setCodes,
            downloadImages: itemDownloadImages,
            syncPrices: itemSyncPrices,
            incremental: syncMode !== 'FULL'
          })
        });
        const startJson = await startResponse.json().catch(() => ({}));
        if (!startResponse.ok) {
          throw new Error(`${item.gameName}: ${startJson.message || startJson.error || `HTTP ${startResponse.status}`}`);
        }

        const jobId = startJson.data?.id;
        if (!jobId) throw new Error(`${item.gameName}: SYNC_JOB_ID_MISSING`);

        const finalJob = await waitForSyncJob(jobId, token, (job) => {
          const localDone = Number(job.processedSets || 0);
          const localCards = Number(job.processedCards || 0);
          const totalDone = completedSetsBefore + localDone;
          window.gmxOperation?.update(op, {
            progress: Math.min(99, Math.max(1, Math.round((totalDone / Math.max(1,totalSets))*100))),
            detail: `${item.gameName}: ${job.message || 'Procesando…'}`,
            etaSeconds: job.etaSeconds,
            meta: {
              setsDone: totalDone,
              setsTotal: totalSets,
              cardsDone: cardsBefore + localCards,
              cardsTotal: Number(job.estimatedCards || 0),
              currentSet: `${item.gameName}${job.currentSet ? ` · ${job.currentSet}` : ''}`
            }
          });
        });

        const syncResult = finalJob?.result?.sync || {};
        const inc = finalJob?.result?.incrementalSummary || {};
        const cards = Number(syncResult.cards || inc.insertedCards || 0) + Number(inc.updatedCards || 0);
        const prices = Number(syncResult.prices || inc.updatedPrices || 0);

        results.push({
          gameCode:item.gameCode,
          gameName:item.gameName,
          status:'COMPLETED',
          sets:item.setCodes.length,
          cards,
          prices,
          inserted:Number(inc.insertedCards || 0),
          updated:Number(inc.updatedCards || 0),
          unchanged:Number(inc.unchangedCards || 0),
          message:'OK'
        });
        setMultiSyncResults([...results]);

        completedSetsBefore += item.setCodes.length;
        cardsBefore += Number(finalJob?.processedCards || cards || 0);
      }

      const done = results.filter((x)=>x.status==='COMPLETED');
      const skipped = results.filter((x)=>x.status==='SKIPPED');
      const cards = done.reduce((n,x)=>n+Number(x.cards||0),0);
      const prices = done.reduce((n,x)=>n+Number(x.prices||0),0);

      setMessage(
        `Multi-TCG listo: ${done.length} TCG completado(s), ${completedSetsBefore} expansión(es), ${cards} carta(s) procesadas y ${prices} precio(s) actualizados.${skipped.length ? ` ${skipped.length} TCG omitido(s).` : ''}`
      );

      await loadProviders(gameCode);
      if (gameCode) await loadSets(gameCode);

      window.gmxOperation?.complete(op, {
        title: 'Auto Sync Multi-TCG completado',
        detail: `${done.length} TCG procesado(s) correctamente.`,
        keepMs: 1800
      });
    } catch (e) {
      setMessage(`Auto Sync Multi-TCG detenido: ${e.message}`);
      window.gmxOperation?.fail(op, e);
      throw e;
    } finally {
      setBusy('');
    }
  }
  async function findCards(e) {
    e?.preventDefault();
    if (!gameCode) return;
    setBusy('search');
    try {
      const qs = new URLSearchParams({ gameCode, search, limit: '100' });
      const r = await api(`/api/v1/tcg-sync/cards?${qs}`);
      setCards(r.data || []);
    } catch (e2) {setMessage(e2.message);} finally {setBusy('');}
  }

  async function compare(card) {
    setPriceCard(card);setPriceData(null);setPriceProvider('');
    try {
      const r = await api(`/api/v1/tcg-sync/cards/${card.row_id}/prices`);
      setPriceData(r.data);
    } catch (e) {setMessage(e.message);}
  }

  const filteredPrices = useMemo(() => {
    const all = priceData?.prices || [];
    return priceProvider ? all.filter((x) => x.price_provider === priceProvider) : all;
  }, [priceData, priceProvider]);

  const priceProviders = useMemo(() => [...new Set((priceData?.prices || []).map((x) => x.price_provider))], [priceData]);

  return (
    <div className="shiny-approved-sync">
      <div className="gas-top">
        <div className="gas-title">
          <span className="gas-refresh">↻</span>
          <div>
            <h2>Auto Sync</h2>
            <p>Sincronización automática de catálogos TCG</p>
          </div>
        </div>
        <span className="gas-ok"><i /> Sincronizado</span>
      </div>

      <div className="gas-steps">
        {[
          ['1','Configuración','Selecciona los TCG a sincronizar'],
          ['2','Expansiones','Elige las expansiones'],
          ['3','Cartas','Selecciona el tipo de cartas'],
          ['4','Precios','Imágenes y precios']
        ].map(([n,title,sub]) => {
          const step = Number(n);
          return (
            <div
              key={n}
              className={`gas-step-link ${wizardStep===step?'active':wizardStep>step?'done':''}`}
              tabIndex={0}
              onClick={()=>setWizardStep(step)}
              onKeyDown={(e)=>{
                if(e.key==='Enter'||e.key===' '){
                  e.preventDefault();
                  setWizardStep(step);
                }
              }}
            >
              <span>{wizardStep>step?'✓':n}</span>
              <div><b>{title}</b><small>{sub}</small></div>
            </div>
          );
        })}
      </div>

      {message ? <div className="gas-message">{message}</div> : null}

      <section className="gas-panel">
        {wizardStep>1 && selectedProviderRows.length ? (
          <div className="gas-game-tabs">
            {selectedProviderRows.map((p)=>(
              <button
                type="button"
                key={p.game_code}
                className={gameCode===p.game_code?'active':''}
                onClick={()=>setGameCode(p.game_code)}
              >
                {p.game_name||p.game_code}
              </button>
            ))}
          </div>
        ) : null}

        {wizardStep===1 ? (
          <>
            <div className="gas-head">
              <div>
                <h3>TCG a sincronizar</h3>
                <p>Selecciona qué catálogos deseas mantener actualizados automáticamente.</p>
              </div>
            </div>

            <div className="gas-games">
              {providers.map((p) => {
                const active = selectedGames.includes(p.game_code);
                const text = `${p.game_name||''} ${p.game_code||''}`.toLowerCase();
                const visual =
                  text.includes('pokemon') || text.includes('pokémon') ? 'pokemon' :
                  text.includes('magic') || text.includes('mtg') ? 'magic' :
                  text.includes('yugi') || text.includes('yu-gi') ? 'yugioh' :
                  text.includes('one piece') ? 'onepiece' :
                  text.includes('rift') ? 'riftbound' :
                  text.includes('lorcana') ? 'lorcana' : 'generic';
                const abbr =
                  visual==='pokemon' ? 'PK' :
                  visual==='magic' ? 'M' :
                  visual==='yugioh' ? 'YG' :
                  visual==='onepiece' ? 'OP' :
                  visual==='riftbound' ? 'RB' :
                  visual==='lorcana' ? 'DL' : 'TCG';

                return (
                  <div
                    key={p.game_code}
                    className={`gas-game ${active?'selected':''}`}
                    role="button"
                    tabIndex={0}
                    onClick={()=>toggleGame(p.game_code)}
                    onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleGame(p.game_code);}}}
                  >
                    <span className={`gas-check ${active?'on':''}`}>{active?'✓':''}</span>
                    {iconIdFor(p.game_code) ? (
                      <span className="gas-logo uploaded">
                        <SecureMedia mediaId={iconIdFor(p.game_code)} alt={p.game_name||p.game_code} />
                      </span>
                    ) : (
                      <span className={`gas-logo ${visual}`}>{abbr}</span>
                    )}
                    <span className="gas-game-text">
                      <b>{p.game_name||p.game_code}</b>
                      <small>{p.provider_name||'Proveedor configurado'}</small>
                      <label className="gas-tcg-fx" onClick={(e)=>e.stopPropagation()}>
                        <span>TDC USD→MXN</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={p.usd_mxn_rate||''}
                          placeholder="Ej. 17"
                          onBlur={(e)=>saveGameFx(p.game_code,e.target.value)}
                        />
                      </label>
                      <em className={p.supports_cards?'full':'catalog'}>
                        {p.supports_cards?'API completa':'Catálogo'}
                      </em>
                    </span>
                    <span className="gas-info">i</span>
                    <label className="gas-icon-upload" onClick={(e)=>e.stopPropagation()}>
                      {iconBusy===p.game_code?'Subiendo…':'Cambiar icono'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={iconBusy===p.game_code}
                        onChange={(e)=>{
                          const file=e.target.files?.[0];
                          if(file)uploadTcgIcon(p,file);
                          e.target.value='';
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="gas-bottom gas-bottom-config">
              <div className="gas-counter">
                <span>♧</span>
                <span>{providers.length} catálogos disponibles</span>
                <i />
                <b>{selectedGames.length} seleccionados</b>
              </div>
            </div>
          </>
        ) : null}

        {wizardStep===2 && !selectedGames.length ? (<div className="gas-empty gas-empty-selection">Selecciona al menos un TCG en Configuración.</div>) : wizardStep===2 ? (
          <>
            <div className="gas-head">
              <div>
                <h3>Seleccionar expansiones</h3>
                <p>Elige las expansiones que deseas sincronizar para {current?.game_name||gameCode}.</p>
              </div>
            </div>

            <div className="gas-set-tools">
              <label className="gas-sort">
                <span>Ordenar por</span>
                <select value={setSort} onChange={(e)=>setSetSort(e.target.value)}>
                  <option value="AZ">A → Z</option>
                  <option value="ZA">Z → A</option>
                  <option value="NEW">Más recientes</option>
                  <option value="OLD">Más antiguas</option>
                </select>
              </label>
              <label className="gas-all">
                Seleccionar todas
                <input
                  type="checkbox"
                  checked={sets.length>0 && selected.length===sets.length}
                  onChange={(e)=>setSelected(e.target.checked?sets.map((x)=>x.codigo):[])}
                />
              </label>
            </div>

            <div className="gas-set-list">
              {sortedSets.map((set) => (
                <label key={set.row_id} className={selected.includes(set.codigo)?'selected':''}>
                  <input
                    type="checkbox"
                    checked={selected.includes(set.codigo)}
                    onChange={()=>toggleSet(set.codigo)}
                  />
                  <span className="gas-set-icon">{String(set.codigo||'?').slice(0,3).toUpperCase()}</span>
                  <span className="gas-set-name">
                    <b>{set.nombre}</b>
                    <small>{set.codigo} · {Number(set.total_cartas||0)} cartas</small>
                  </span>
                  <span className="gas-date">
                    {set.fecha_lanzamiento?String(set.fecha_lanzamiento).slice(0,10):'Sin fecha'}
                  </span>
                  <em className={Number(set.synced_cards||0)>0?'synced':'new'}>
                    {Number(set.synced_cards||0)>0?'Actualizada':'Nueva'}
                  </em>
                </label>
              ))}
              {!sets.length ? <div className="gas-empty">Actualiza primero las expansiones del TCG seleccionado.</div> : null}
            </div>

            <div className="gas-bottom">
              <div className="gas-counter">
                <b>{selected.length}</b>
                <span> de {sets.length} expansiones seleccionadas</span>
              </div>
              <div className="gas-actions">
                <button type="button" className="gas-outline" onClick={()=>setWizardStep(1)}>← Volver</button>
                <button type="button" className="gas-next" disabled={!selected.length} onClick={()=>setWizardStep(3)}>Continuar →</button>
              </div>
            </div>
          </>
        ) : null}

        {wizardStep===3 && !selectedGames.length ? (<div className="gas-empty gas-empty-selection">Selecciona al menos un TCG en Configuración.</div>) : wizardStep===3 ? (
          <>
            <div className="gas-head">
              <div>
                <h3>Cartas</h3>
                <p>Define qué información se descargará.</p>
              </div>
            </div>

            <div className="gas-option-grid">
              <label className={!current?.supports_prices?'disabled':''}>
                <input type="checkbox" checked={syncPrices} disabled={!current?.supports_prices} onChange={(e)=>setSyncPrices(e.target.checked)} />
                <span><b>Precios de mercado</b><small>Sincronizar referencias disponibles.</small></span>
              </label>

              <label className={!current?.supports_images?'disabled':''}>
                <input type="checkbox" checked={downloadImages} disabled={!current?.supports_images} onChange={(e)=>setDownloadImages(e.target.checked)} />
                <span><b>Imágenes</b><small>Guardar imágenes localmente.</small></span>
              </label>

              <label>
                <input type="checkbox" checked={autoSync} onChange={(e)=>setAutoSync(e.target.checked)} />
                <span><b>Actualización automática</b><small>Mantener el catálogo actualizado.</small></span>
              </label>

              <label className="gas-frequency">
                <span><b>Frecuencia</b><small>Periodicidad de actualización.</small></span>
                <select value={frequency} disabled={!autoSync} onChange={(e)=>setFrequency(e.target.value)}>
                  <option value="DAILY">Diaria</option>
                  <option value="WEEKLY">Semanal</option>
                  <option value="MONTHLY">Mensual</option>
                </select>
              </label>
            </div>

            <div className="gas-bottom">
              <button type="button" className="gas-outline" onClick={()=>setWizardStep(2)}>← Volver</button>
              <div className="gas-actions">
                <button type="button" className="gas-outline" onClick={saveConfig} disabled={!!busy}>
                  {busy==='config'?'Guardando…':'Guardar configuración'}
                </button>
                <button type="button" className="gas-next" onClick={()=>setWizardStep(4)}>Continuar →</button>
              </div>
            </div>
          </>
        ) : null}

        {wizardStep===4 && !selectedGames.length ? (<div className="gas-empty gas-empty-selection">Selecciona al menos un TCG en Configuración.</div>) : wizardStep===4 ? (
          <>
            <div className="gas-head">
              <div>
                <h3>Imágenes y precios</h3>
                <p>Revisa la selección antes de sincronizar.</p>
              </div>
            </div>

                        <div className="gas-r42-sync-mode">
              <button type="button" className={syncMode==='INCREMENTAL'?'active':''} onClick={()=>setSyncMode('INCREMENTAL')}>
                <b>Incremental</b>
                <small>Solo cambios y expansiones seleccionadas.</small>
              </button>
              <button type="button" className={syncMode==='FULL'?'active':''} onClick={()=>setSyncMode('FULL')}>
                <b>Full Sync</b>
                <small>Actualiza sets y procesa el catálogo completo disponible.</small>
              </button>
            </div>

            <div className="gas-r42-selected-summary">
              {selectedProviderRows.map((p)=>(
                <article key={p.game_code}>
                  <b>{p.game_name||p.game_code}</b>
                  <span>{p.game_code===gameCode ? selected.length : (Array.isArray(p.selected_sets)?p.selected_sets.length:0)} expansión(es) configuradas</span>
                </article>
              ))}
            </div>
<div className="gas-review">
              <div><span>TCG</span><b>{current?.game_name||'—'}</b></div>
              <div><span>Expansiones</span><b>{selected.length}</b></div>
              <div><span>Precios</span><b>{syncPrices?'Sí':'No'}</b></div>
              <div><span>Imágenes</span><b>{downloadImages?'Sí':'No'}</b></div>
            </div>

            {lastCardSyncResult ? (
              <div className="gas-results">
                {(lastCardSyncResult.sets||[]).map((x)=>(
                  <div key={x.setCode}>
                    <b>{x.setCode}</b>
                    <span>{x.cards} cartas · {x.prices} precios</span>
                  </div>
                ))}
              </div>
            ) : null}

                        {multiSyncResults.length ? (
              <div className="gas-r42-results">
                {multiSyncResults.map((r)=>(
                  <article key={r.gameCode} className={String(r.status||'').toLowerCase()}>
                    <div><b>{r.gameName}</b><small>{r.status}</small></div>
                    <span>{r.sets||0} sets · {r.cards||0} cartas · {r.prices||0} precios</span>
                    {r.message && r.message!=='OK' ? <p>{r.message}</p> : null}
                  </article>
                ))}
              </div>
            ) : null}
<div className="gas-bottom">
              <button type="button" className="gas-outline" onClick={()=>setWizardStep(3)}>← Volver</button>
              <button
                type="button"
                className="gas-next"
                onClick={addSelectedToStore}
                disabled={!!busy||!selectedGames.length}
              >
                {busy==='add'?'Sincronizando…':'Sincronizar ahora'}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
