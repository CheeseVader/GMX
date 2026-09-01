import { brandText } from "../../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api.js';

function pct(a, b) {
  const x = Number(a || 0),y = Number(b || 0);
  if (!y) return 0;
  return Math.round(x / y * 100);
}
function when(v) {
  if (!v) return 'Nunca';
  try {return new Date(v).toLocaleString('es-MX');} catch {return String(v);}
}

export default function TCGMasterCatalogBrowser({ onNavigate }) {
  /* SHINY_TCGPLAYER_CATALOG_UI_R5 */
  const [catalogFxR5,setCatalogFxR5]=useState({
    rate:null,
    source:'',
    rate_date:null
  });

  

  const [summary, setSummary] = useState([]);
  const [gameCode, setGameCode] = useState('');

  useEffect(()=>{
    let active=true;
    if(!gameCode){
      setCatalogFxR5({rate:null,source:'',rate_date:null});
      return()=>{active=false;};
    }
    api(`/api/v1/tcg-sync/games/${encodeURIComponent(gameCode)}/fx`,{cache:'no-store'})
      .then((payload)=>{
        if(!active)return;
        const data=payload?.data||payload||{};
        const rate=Number(data?.rate||0);
        setCatalogFxR5({
          rate:Number.isFinite(rate)&&rate>0?rate:null,
          source:String(data?.source||'SHINY_TCG'),
          rate_date:data?.rate_date||null
        });
      })
      .catch(()=>{
        if(active)setCatalogFxR5({rate:null,source:'',rate_date:null});
      });
    return()=>{active=false;};
  },[gameCode]);
  const [sets, setSets] = useState([]);
  const [setCode, setSetCode] = useState('');
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(60);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState(null);
  const [prices, setPrices] = useState(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState('');
  const selectedPriceSources = ['TCGPLAYER'];
  const [addingToTemplate, setAddingToTemplate] = useState(false);

  const currentGame = summary.find((x) => x.game_code === gameCode) || null;

  async function loadSourcePreferences(code = gameCode) {
    if (!code) {
      setSelectedPriceSources([]);
      return;
    }
    try {
      const r = await api(`/api/v1/tcg-sync/games/${encodeURIComponent(code)}/sources`);
      setSelectedPriceSources(
        Array.isArray(r.data?.preferences?.priceSources) ?
        r.data.preferences.priceSources.map((x) => String(x || '').toUpperCase()) :
        []
      );
    } catch {
      // Catalog browsing must continue even if source preferences cannot be read.
      setSelectedPriceSources([]);
    }
  }

  async function loadSummary() {
    setSummaryLoading(true);
    setMessage('');
    try {
      const r = await api('/api/v1/tcg-sync/master-catalog/summary');
      const list = (Array.isArray(r.data) ? r.data : []).filter((x) => Number(x.cards_count || 0) > 0);
      setSummary(list);
      if (!gameCode && list.length) setGameCode(list[0].game_code);
      if (!list.length) {
        setMessage('No se encontraron cartas descargadas en el Catálogo Maestro. Sincroniza al menos una expansión desde Auto Sync.');
      }
    } catch (e) {
      setSummary([]);
      setMessage(`No fue posible cargar el Catálogo Maestro: ${e.message}`);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadSets(code, q = '') {
    if (!code) {setSets([]);return;}
    const qs = new URLSearchParams({ gameCode: code });
    if (q.trim()) qs.set('search', q.trim());
    const r = await api(`/api/v1/tcg-sync/master-catalog/sets?${qs}`);
    setSets((r.data || []).filter((x) => Number(x.synced_cards || 0) > 0));
  }

  async function loadCards({ targetPage = page, code = gameCode, set = setCode, q = search } = {}) {
    if (!code) {setCards([]);return;}
    setBusy(true);setMessage('');
    try {
      const qs = new URLSearchParams({
        gameCode: code,
        page: String(targetPage),
        pageSize: String(pageSize)
      });
      if (set) qs.set('setCode', set);
      if (q) qs.set('search', q);
      const r = await api(`/api/v1/tcg-sync/master-catalog/cards?${qs}`);
      setCards(r.data?.rows || []);
      setTotal(Number(r.data?.total || 0));
      setPages(Number(r.data?.pages || 1));
      setPage(Number(r.data?.page || 1));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {loadSummary();}, []);
  useEffect(() => {
    if (!gameCode) return;
    setSetCode('');setPage(1);setSelectedCard(null);setPrices(null);setPricesError('');setPricesLoading(false);
    Promise.all([
    loadSets(gameCode)]
    ).catch((e) => setMessage(e.message));
    loadCards({ targetPage: 1, code: gameCode, set: '', q: '' });
  }, [gameCode]);

  useEffect(() => {
    if (!gameCode) return;
    setPage(1);setSelectedCard(null);setPrices(null);setPricesError('');setPricesLoading(false);
    loadCards({ targetPage: 1, code: gameCode, set: setCode, q: search });
  }, [setCode]);

  useEffect(() => {
    if (!gameCode) return;
    setPage(1);setSelectedCard(null);setPrices(null);setPricesError('');setPricesLoading(false);
    loadCards({ targetPage: 1, code: gameCode, set: setCode, q: search });
  }, [pageSize]);

  useEffect(() => {
    if (!gameCode) return;
    const timer = setTimeout(async () => {
      try {
        const setResponse = await (async () => {
          const qs = new URLSearchParams({ gameCode });
          if (search.trim()) qs.set('search', search.trim());
          return api(`/api/v1/tcg-sync/master-catalog/sets?${qs}`);
        })();

        const compatibleSets = (setResponse.data || []).filter((x) => Number(x.synced_cards || 0) > 0);
        setSets(compatibleSets);

        if (setCode && !compatibleSets.some((x) => x.codigo === setCode)) {
          setSetCode('');
        }

        await loadCards({ targetPage: 1, code: gameCode, set: compatibleSets.some((x) => x.codigo === setCode) ? setCode : '', q: search });
      } catch (e) {
        setMessage(e.message);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  function openCard(card) {
    // First paint the modal. Price references are loaded afterwards.
    setSelectedCard(card);
    setPrices(null);
    setPricesError('');
    setPricesLoading(true);
  }

  const normalizePriceProvider = (value) => String(value || '').
  toUpperCase().
  replace(/[^A-Z0-9]+/g, '_').
  replace(/^_+|_+$/g, '');

  const visiblePrices = useMemo(() => {
    const rows = prices?.prices || [];
    return rows.filter((p) => normalizePriceProvider(p.price_provider) === 'TCGPLAYER');
  }, [prices]);

  const priceProviders = useMemo(
    () => [...new Set(visiblePrices.map((x) => x.price_provider))],
    [visiblePrices]
  );

  useEffect(() => {
    if (!selectedCard) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // Give React/Chrome one paint to display the modal before querying prices.
    const start = setTimeout(async () => {
      try {
        const r = await api(`/api/v1/tcg-sync/cards/${selectedCard.row_id}/prices`, {
          signal: controller.signal,
          cache: 'no-store'
        });
        if (!cancelled) setPrices(r.data);
      } catch (e) {
        if (!cancelled) {
          const msg = e?.name === 'AbortError' ?
          'La consulta de precios tardó demasiado. Puedes cerrar la ficha e intentarlo nuevamente.' :
          String(e?.message || e);
          setPricesError(msg);
        }
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(start);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [selectedCard?.row_id]);

  useEffect(() => {
    if (!selectedCard) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedCard(null);
        setPrices(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedCard]);


  async function addSelectedCardToTemplate() {
    if (!selectedCard || addingToTemplate) return;
    setAddingToTemplate(true);
    try {
      const games = await api('/api/v1/tcg/games');
      const operationalGames = games.data || [];
      const game = operationalGames.find((g) =>
      String(g.catalogo_codigo || g.codigo || '').toUpperCase() === String(selectedCard.game_code || '').toUpperCase()
      );
      if (!game) throw new Error(brandText("Primero agrega este TCG a GMX desde Publicación y mantenimiento."));

      const sets = await api('/api/v1/tcg/sets');
      const operationalSets = sets.data || [];
      const set = operationalSets.find((s) =>
      s.id_juego === game.id_juego &&
      [s.catalogo_codigo, s.codigo, s.id_set].some((v) => String(v || '').toUpperCase() === String(selectedCard.set_code || '').toUpperCase())
      );
      if (!set) throw new Error(brandText("La expansión todavía no está habilitada en GMX. Sincroniza el TCG desde Publicación y mantenimiento."));

      const existing = await api(`/api/v1/tcg/cards?limit=1000`);
      const already = (existing.data || []).find((c) =>
      c.id_juego === game.id_juego &&
      c.id_set === set.id_set &&
      String(c.numero_completo || c.numero_carta || '').toUpperCase() === String(selectedCard.collector_number || selectedCard.number || '').toUpperCase()
      );
      if (already) {
        setMessage(brandText(`"${selectedCard.name}" ya está habilitada en Shiny.`));
        window.shinyNotify?.(brandText("La carta ya estaba habilitada en GMX."), { type: 'info' });
        return;
      }

      await api('/api/v1/tcg/catalog/cards', {
        method: 'POST',
        body: JSON.stringify({
          id_juego: game.id_juego,
          id_set: set.id_set,
          nombre: selectedCard.name,
          numero_carta: selectedCard.collector_number || selectedCard.number || '',
          numero_completo: selectedCard.collector_number || selectedCard.number || '',
          rareza: selectedCard.rarity || '',
          tipo_carta: selectedCard.card_type || '',
          artista: selectedCard.artist || '',
          estado_catalogo: 'ACTIVA'
        })
      });
      setMessage(brandText(`"${selectedCard.name}" agregada a Shiny. Ya puede recibirse en inventario.`));
      window.shinyNotify?.(brandText("Carta habilitada en GMX."), { type: 'success' });
    } catch (e) {
      setMessage(e.message);
      window.shinyNotify?.(e.message, { type: 'error' });
    } finally {
      setAddingToTemplate(false);
    }
  }

  const totalSets = summary.reduce((n, g) => n + Number(g.synced_sets_count || 0), 0);
  const totalCards = summary.reduce((n, g) => n + Number(g.cards_count || 0), 0);
  const totalVariants = summary.reduce((n, g) => n + Number(g.cards_with_prices || 0), 0);

  return <div className="master-catalog-browser proposal-a-master design4-master">
    <section className="proposal-a-master-home design4-home">
      <div className="proposal-a-heading-row design4-heading">
        <div><span className="eyebrow">TRADING CARD GAME</span><h2>Catálogo TCG</h2><p>Consulta todo el catálogo de cartas ya descargado y guardado localmente</p></div>
        <span className="proposal-a-sync">● Catálogo descargado</span>
      </div>

      <div className="design4-kpis">
        <article><i>▱</i><div><span>TCG</span><strong>{summary.length.toLocaleString('es-MX')}</strong><small>Activos</small></div></article>
        <article><i className="green">◇</i><div><span>Expansiones</span><strong>{totalSets.toLocaleString('es-MX')}</strong><small>Descargadas</small></div></article>
        <article><i>▤</i><div><span>Cartas</span><strong>{totalCards.toLocaleString('es-MX')}</strong><small>Totales</small></div></article>
        <article><i className="violet">▧</i><div><span>Variantes</span><strong>{totalVariants.toLocaleString('es-MX')}</strong><small>Con referencia</small></div></article>
        <article><i className="green">$</i><div><span>Proveedores</span><strong>{summary.length.toLocaleString('es-MX')}</strong><small>Configurados</small></div></article>
      </div>

      <div className="design4-filterbar" style={{ gridTemplateColumns: 'minmax(320px,2fr) minmax(190px,1fr) minmax(240px,1fr)' }}>
        <div className="design4-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar carta por nombre, número o código..." /></div>
        <select value={gameCode} onChange={(e) => setGameCode(e.target.value)}>{summary.map((g) => <option key={g.game_code} value={g.game_code}>{g.game_name}</option>)}</select>
        <select value={setCode} onChange={(e) => setSetCode(e.target.value)}><option value="">Todas las expansiones guardadas</option>{sets.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}</select>
      </div>

      {message ? <div className="message proposal-a-message">{message}</div> : null}

      <section className="proposal-a-results design4-table-card">
        <div className="proposal-a-results-head"><div><strong>Cartas del catálogo</strong><span>{total.toLocaleString('es-MX')} cartas{currentGame?.game_name ? ` · ${currentGame.game_name}` : ''}{setCode ? ` · ${sets.find((x) => x.codigo === setCode)?.nombre || setCode}` : ''}</span></div><span className="shiny-catalog-fx-r5" style={{fontSize:11,opacity:.75}}>
          {Number(catalogFxR5.rate||0)>0
            ?`TDC ${Number(catalogFxR5.rate).toFixed(2)} MXN/USD · ${currentGame?.game_name||gameCode}`
            :'TC no disponible'}
        </span></div>
        <div className="table-wrap proposal-a-table"><table><thead><tr><th>Carta</th><th>Expansión</th><th>Nº</th><th>Rareza</th><th>Mercado USD</th><th>Mercado MXN</th><th>Precio tienda MXN</th><th>Proveedor precio</th><th>Actualizado</th><th></th></tr></thead><tbody>{cards.map((card) => <tr key={card.row_id}>
          <td><div className="proposal-a-card-name">{card.image_local_url || card.image_small_url || card.image_large_url ? <img src={card.image_local_url || card.image_small_url || card.image_large_url} alt="" /> : <span>TCG</span>}<div><strong>{card.name}</strong></div></div></td>
          <td>{card.set_name || card.set_code || '—'}</td><td>{card.collector_number || card.number || '—'}</td><td>{card.rarity || '—'}</td><td><strong>{Number(card.tcgplayer_market_usd||0)>0
            ?Number(card.tcgplayer_market_usd).toLocaleString('en-US',{style:'currency',currency:'USD'})
            :'\u2014'}</strong></td>
          <td><strong>{Number(card.tcgplayer_market_usd||0)>0&&Number(catalogFxR5.rate||0)>0
            ?(Number(card.tcgplayer_market_usd)*Number(catalogFxR5.rate)).toLocaleString('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2,maximumFractionDigits:2})
            :'\u2014'}</strong></td>
          <td>{Number(card.store_price_mxn||0)>0
            ?Number(card.store_price_mxn).toLocaleString('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2,maximumFractionDigits:2})
            :'No configurado'}</td>
          <td><strong>{Number(card.tcgplayer_market_usd||0)>0?'TCGplayer':'TCGplayer - sin precio'}</strong></td>
          <td>{when(card.tcgplayer_price_updated_at||card.last_synced_at)}</td><td><button type="button" className="secondary compact" onClick={() => openCard(card)}>Ver</button></td>
        </tr>)}</tbody></table></div>
        {!cards.length && !busy ? <div className="public-empty small">No hay cartas descargadas que coincidan con los filtros seleccionados.</div> : null}
        <div className="proposal-a-pagination"><button disabled={page <= 1 || busy} onClick={() => loadCards({ targetPage: page - 1 })}>‹</button><span>{page} / {pages}</span><button disabled={page >= pages || busy} onClick={() => loadCards({ targetPage: page + 1 })}>›</button></div>
      </section>


    </section>
    {selectedCard && typeof document !== 'undefined' ? createPortal(<div className="master-card-modal-backdrop" onClick={() => {setSelectedCard(null);setPrices(null);setPricesError('');setPricesLoading(false);}}>
      <section className="master-card-modal" role="dialog" aria-modal="true" aria-label={`Detalle de ${selectedCard.name}`} onClick={(e) => e.stopPropagation()}>
        <button className="master-card-close" onClick={() => {setSelectedCard(null);setPrices(null);setPricesError('');setPricesLoading(false);}}>×</button>
        <div className="master-card-modal-main">
          <div className="master-card-modal-image">{selectedCard.image_local_url || selectedCard.image_large_url || selectedCard.image_small_url ? <img src={selectedCard.image_local_url || selectedCard.image_large_url || selectedCard.image_small_url} alt={selectedCard.name} /> : <span>Sin imagen</span>}</div>
          <div>
            <span className="eyebrow">{selectedCard.game_code} · {selectedCard.set_name || selectedCard.set_code}</span>
            <h2>{selectedCard.name}</h2>
            <p>#{selectedCard.collector_number || selectedCard.number || '—'} · {selectedCard.rarity || 'Sin rareza'} · {selectedCard.card_type || '—'}</p>
            <div className="master-card-shiny-actions">
              <button type="button" onClick={addSelectedCardToTemplate} disabled={addingToTemplate}>
                {addingToTemplate ? 'Agregando…' : brandText("Agregar a GMX")}
              </button>
              <small>Habilita esta carta para recepción, inventario y operación local. No crea existencias.</small>
            </div>
            <dl className="master-card-details">
              <div><dt>Fuente de precio</dt><dd>TCGplayer</dd></div>
              <div><dt>Idioma</dt><dd>{selectedCard.language || '—'}</dd></div>
              <div><dt>Artista</dt><dd>{selectedCard.artist || '—'}</dd></div>
              <div><dt>Última sync</dt><dd>{when(selectedCard.last_synced_at)}</dd></div>
            </dl>
          </div>
        </div>

        <div className="master-price-admin-only">
          <div className="section-head compact"><div><span className="eyebrow">SOLO ADMIN</span><h3>Referencias de mercado · TCGplayer</h3><p>{brandText("Catálogo Maestro usa exclusivamente TCGplayer como fuente de precio. No se usan otras fuentes ni fallback para Low, Mid, High o Market.")}</p></div></div>
          {pricesLoading ? <div className="master-price-loading"><span className="master-price-spinner" />Cargando referencias de mercado…</div> : null}
          {!pricesLoading && pricesError ? <div className="master-price-error">{pricesError}</div> : null}
          {!pricesLoading && !pricesError && visiblePrices.length ? <div className="table-wrap"><table><thead><tr><th>Fuente</th><th>Variante</th><th>Moneda</th><th>Low</th><th>Mid</th><th>High</th><th>Market</th></tr></thead><tbody>{visiblePrices.map((p) => <tr key={p.row_id}><td><b>{p.price_provider}</b></td><td>{p.variant}</td><td>{p.currency}</td><td>{p.low ?? '—'}</td><td>{p.mid ?? '—'}</td><td>{p.high ?? '—'}</td><td><strong>{p.market ?? '—'}</strong></td></tr>)}</tbody></table></div> : null}
          {!pricesLoading && !pricesError && prices && !visiblePrices.length ? <div className="public-empty small">
            'Sin precio TCGplayer disponible para esta carta.'
          </div> : null}
        </div>
      </section>
    </div>, document.body) : null}
  </div>;
}
