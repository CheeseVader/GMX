import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import VisionScannerModal from '../components/VisionScannerModal.jsx';
import VisionCandidatePicker from '../components/VisionCandidatePicker.jsx';
import { visionQueries, scoreVisionCandidate } from '../utils/vision.js';
import TCGAutoSyncPanel from '../components/tcg/TCGAutoSyncPanel.jsx';
import TCGMasterCatalogBrowser from '../components/tcg/TCGMasterCatalogBrowser.jsx';
import { strictTcgRuleR16, categoriesR16, categoryRuleR16, normalizeR16List, serializeClassificationR16 } from '../utils/tcgReceptionRulesR16.js';
import { tcgReceptionPreset, mergeReceptionOptions, SHINY_TCG_R12_COVERED_CODES } from '../utils/tcgReceptionPresetsR12.js';
import '../phase_shiny_exact_views_r23.css';
import '../phase10_6_2_3.css';
import './TCGDesign4Exact.css';
import '../tcgReceptionManualR4.css';
import '../tcgReceptionIndividualR1.css';
import '../shiny_tcg_inventory_final.css';
import '../tcg_nav_icons_r76.css';
const money = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });


/* Shiny_TCG_INVENTORY_FILTER_R1 */
function tcg_store_templateNorm(value = '') {
  return String(value ?? '').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  toUpperCase().
  replace(/[^A-Z0-9]+/g, '').
  trim();
}

function tcg_store_templateGameCode(game) {
  return tcg_store_templateNorm(
    game?.catalogo_codigo ||
    game?.codigo ||
    game?.code ||
    game?.game_code ||
    ''
  );
}

function tcg_store_templateInventoryRowGameCode(row) {
  const direct = tcg_store_templateNorm(
    row?.tcg_clasificado ||
    row?.tcg ||
    row?.game_code ||
    row?.codigo_juego ||
    row?.catalogo_codigo ||
    ''
  );
  if (direct) return direct;

  const sku = tcg_store_templateNorm(row?.sku || '');
  if (sku.includes('YGO')) return 'YUGIOH';
  if (sku.includes('POK')) return 'POKEMON';
  if (sku.includes('MTG')) return 'MAGIC';
  if (sku.includes('ONEPIECE') || sku.includes('ShinySEAOP')) return 'ONEPIECE';
  if (sku.includes('RIF')) return 'RIFTBOUND';

  const text = tcg_store_templateNorm([
  row?.nombre,
  row?.producto,
  row?.descripcion,
  row?.categoria,
  row?.subcategoria].
  filter(Boolean).join(' '));

  if (text.includes('YUGIOH')) return 'YUGIOH';
  if (text.includes('POKEMON')) return 'POKEMON';
  if (text.includes('MAGIC') || text.includes('MTG')) return 'MAGIC';
  if (text.includes('ONEPIECE')) return 'ONEPIECE';
  if (text.includes('RIFTBOUND')) return 'RIFTBOUND';

  return '';
}

function tcg_store_templateRowMatchesSelectedGame(row, selectedGameId, games) {
  if (!selectedGameId) return true;

  const selected = (games || []).find(
    (g) => String(g.id_juego) === String(selectedGameId)
  );
  if (!selected) return false;

  // Singles / native TCG inventory.
  if (row?.id_juego != null && String(row.id_juego) !== '') {
    return String(row.id_juego) === String(selectedGameId);
  }

  // Sealed products use catalog classification codes.
  const selectedCode = tcg_store_templateGameCode(selected);
  const rowCode = tcg_store_templateInventoryRowGameCode(row);

  if (selectedCode && rowCode) {
    return selectedCode === rowCode;
  }

  return false;
}

function tcg_store_templateInventorySearchText(row) {
  return [
  row?.carta,
  row?.nombre,
  row?.producto,
  row?.sku,
  row?.codigo_barras,
  row?.numero_completo,
  row?.categoria,
  row?.subcategoria,
  row?.rareza,
  row?.set_nombre,
  row?.expansion].

  filter(Boolean).
  join(' ').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  toUpperCase();
}

/* Shiny_TCG_FILTER_R2 */
function tcg_store_templateR2Norm(value = '') {
  return String(value ?? '').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  toUpperCase().
  replace(/[^A-Z0-9]+/g, '').
  trim();
}

function tcg_store_templateR2GameKeyFromText(value = '') {
  const t = tcg_store_templateR2Norm(value);

  if (!t) return '';
  if (t.includes('YUGIOH') || t.includes('YGO')) return 'YUGIOH';
  if (t.includes('POKEMON') || t.includes('PKMN')) return 'POKEMON';
  if (t.includes('MAGICTHEGATHERING') || t.includes('MAGIC') || t.includes('MTG')) return 'MAGIC';
  if (t.includes('ONEPIECE') || t.includes('OPCG')) return 'ONEPIECE';
  if (t.includes('RIFTBOUND')) return 'RIFTBOUND';
  if (t.includes('LORCANA')) return 'LORCANA';
  if (t.includes('DIGIMON')) return 'DIGIMON';
  if (t.includes('DRAGONBALL') || t.includes('DBSFW')) return 'DBSFW';
  if (t.includes('STARWARSUNLIMITED') || t.includes('SWU')) return 'SWU';
  if (t.includes('FLESHANDBLOOD') || t.includes('FAB')) return 'FAB';
  if (t.includes('UNIONARENA')) return 'UNIONARENA';
  if (t.includes('WEISSSCHWARZ') || t.includes('WEISS')) return 'WEISS';
  if (t.includes('VANGUARD')) return 'VANGUARD';

  return t;
}

function tcg_store_templateR2SelectedGameKey(selectedGameId, games = []) {
  if (!selectedGameId) return '';

  const game = (games || []).find(
    (g) => String(g.id_juego) === String(selectedGameId)
  );

  if (!game) {
    return tcg_store_templateR2GameKeyFromText(selectedGameId);
  }

  return tcg_store_templateR2GameKeyFromText(
    game.catalogo_codigo ||
    game.codigo ||
    game.game_code ||
    game.nombre ||
    selectedGameId
  );
}

function tcg_store_templateR2RowGameKey(row = {}) {
  const direct = [
  row.tcg_clasificado,
  row.tcg,
  row.game_code,
  row.codigo_juego,
  row.catalogo_codigo].
  find((v) => String(v || '').trim());

  if (direct) {
    return tcg_store_templateR2GameKeyFromText(direct);
  }

  const sku = tcg_store_templateR2Norm(row.sku || '');

  if (sku.includes('ShinySEAYGO') || sku.includes('YGO')) return 'YUGIOH';
  if (sku.includes('ShinySEAPOK') || sku.includes('POK')) return 'POKEMON';
  if (sku.includes('ShinySEAMTG') || sku.includes('MTG')) return 'MAGIC';
  if (sku.includes('ShinySEAOP')) return 'ONEPIECE';
  if (sku.includes('ShinySEARIF') || sku.includes('RIF')) return 'RIFTBOUND';

  return tcg_store_templateR2GameKeyFromText([
  row.juego,
  row.nombre_juego,
  row.nombre,
  row.producto,
  row.carta,
  row.descripcion,
  row.subcategoria,
  row.categoria].
  filter(Boolean).join(' '));
}

function tcg_store_templateR2MatchesGame(row, selectedGameId, games = []) {
  if (!selectedGameId) return true;

  const selectedKey = tcg_store_templateR2SelectedGameKey(selectedGameId, games);

  // Native singles: id_juego is authoritative when it really belongs to
  // the TCG inventory model.
  const rowType = tcg_store_templateR2Norm(row.tipo || row.item_type || row.type || '');
  const looksSingle =
  rowType.includes('SINGLE') ||
  rowType === 'TCG' ||
  !!row.id_carta ||
  !!row.carta;

  if (looksSingle && row.id_juego != null && String(row.id_juego) !== '') {
    return String(row.id_juego) === String(selectedGameId);
  }

  const rowKey = tcg_store_templateR2RowGameKey(row);
  return !!selectedKey && !!rowKey && selectedKey === rowKey;
}

function tcg_store_templateR2MatchesSearch(row, q = '') {
  const query = String(q || '').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  trim().
  toUpperCase();

  if (!query) return true;

  const haystack = [
  row.producto,
  row.nombre,
  row.carta,
  row.sku,
  row.codigo,
  row.codigo_barras,
  row.numero_completo,
  row.categoria,
  row.subcategoria,
  row.juego].

  filter(Boolean).
  join(' ').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  toUpperCase();

  return query.
  split(/\s+/).
  filter(Boolean).
  every((token) => haystack.includes(token));
}

function TcgR76NavIcon({ name }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (name === 'catalog') return <svg {...common}>
    <rect x="4" y="5" width="12" height="15" rx="2" />
    <path d="M8 2h10a2 2 0 0 1 2 2v13" />
    <path d="M7.5 9h5M7.5 13h5" />
  </svg>;

  if (name === 'inventory') return <svg {...common}>
    <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
    <path d="M4.5 7.7 12 12l7.5-4.3M12 12v9" />
  </svg>;

  if (name === 'reception') return <svg {...common}>
    <path d="M12 3v11" />
    <path d="m8 10 4 4 4-4" />
    <path d="M4 17v3h16v-3" />
    <path d="M6 17h12" />
  </svg>;

  if (name === 'history') return <svg {...common}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>;

  return <svg {...common}>
    <path d="M20 7h-5V2" />
    <path d="M20 7a8 8 0 0 0-14-2" />
    <path d="M4 17h5v5" />
    <path d="M4 17a8 8 0 0 0 14 2" />
  </svg>;
}
export default function TCGPage() {
  const [tab, setTab] = useState('mastercatalog');
  const [entryMode, setEntryMode] = useState('individual');
  const [games, setGames] = useState([]);
  const [sets, setSets] = useState([]);
  const [rarities, setRarities] = useState([]);
  const [cards, setCards] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [acquisitions, setAcquisitions] = useState([]);
  const [branches, setBranches] = useState([]);
  const [generalProducts, setGeneralProducts] = useState([]);
  const [inventoryBranchFilter, setInventoryBranchFilter] = useState('');
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState('TODO');
  const [message, setMessage] = useState('');
  const [masterGames, setMasterGames] = useState([]);
  const [masterGameCode, setMasterGameCode] = useState('');
  const [masterSets, setMasterSets] = useState([]);
  const [masterRarities, setMasterRarities] = useState([]);
  const [importing, setImporting] = useState(false);
  const [receiptBulk, setReceiptBulk] = useState(null);
  const [receiptBulkBusy, setReceiptBulkBusy] = useState(false);
  const [receiptBulkProgress, setReceiptBulkProgress] = useState({ processed: 0, total: 0, ok: 0, failed: 0 });
  const [receiptBulkErrors, setReceiptBulkErrors] = useState([]);
  const [inventoryGameFilter, setInventoryGameFilter] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventorySetFilter, setInventorySetFilter] = useState('');
  const [inventoryRarityFilter, setInventoryRarityFilter] = useState('');
  const [inventoryCommercialEdit, setInventoryCommercialEdit] = useState(null);
  const [inventoryCommercialBusy, setInventoryCommercialBusy] = useState(false);
  const [entryGameFilter, setEntryGameFilter] = useState('');
  const [entrySetFilter, setEntrySetFilter] = useState('');
  const [visionOpen, setVisionOpen] = useState(false);
  /* SHINY_RECEPCION_INDIVIDUAL_R1 */
  const [entryReceptionName, setEntryReceptionName] = useState('');
  const [entryReceptionCode, setEntryReceptionCode] = useState('');
  const [entryReceptionRarity, setEntryReceptionRarity] = useState('');
  const [entryReceptionResults, setEntryReceptionResults] = useState([]);
  const [entryReceptionSelected, setEntryReceptionSelected] = useState(null);
  const [entryReceptionBusy, setEntryReceptionBusy] = useState(false);
  const [visionCandidates, setVisionCandidates] = useState([]);
  const [visionPickerOpen, setVisionPickerOpen] = useState(false);
  const [operationalMasterSets, setOperationalMasterSets] = useState([]);
  const [operationalMasterRarities, setOperationalMasterRarities] = useState([]);
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [gameFilter, setGameFilter] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [search, setSearch] = useState('');
  const [acqSearch, setAcqSearch] = useState('');
  const [acqStatus, setAcqStatus] = useState('');

  const [setForm, setSetForm] = useState({ id_juego: '', nombre: '', codigo: '', fecha_lanzamiento: '', total_cartas: 0, activo: true, orden: 0 });
  const [rarityForm, setRarityForm] = useState({ id_juego: '', codigo: '', nombre: '', orden: 0, activo: true });
  const [cardForm, setCardForm] = useState({ id_juego: '', id_set: '', nombre: '', numero_carta: '', numero_set: '', numero_completo: '', rareza: '', tipo_carta: '', subtipo: '', artista: '', descripcion: '', estado_catalogo: 'ACTIVA' });

  const [entry, setEntry] = useState({
    id_carta: '', id_sucursal: '', idioma: 'ES', condicion: 'NM', acabado: 'NORMAL', edicion: '',
    graded: false, empresa_grading: '', grado: '', certificado: '', cantidad: 1, costo_unitario: 0,
    precio_venta: 0, precio_oferta: 0, tipo_entrada: 'COMPRA', origen_nombre: '', origen_referencia: '', documento: '', notas: ''
  });

  /* SHINY_TCG_RECEPCION_MANUAL_R4 */
  const [manualReceptionR4, setManualReceptionR4] = useState({
    nombre: '',
    numero: '',
    rareza: '',
    tipo_carta: '',
    subtipo: '',
    artista: ''
  });

  /* SHINY_TCG_RECEPCION_EXPANSIONES_R8 */
  /* SHINY_TCG_RECEPCION_R9_FIX_PANTALLA_GRIS */
  const [manualSetNameR8, setManualSetNameR8] = useState('');
  const [manualSetModeR8, setManualSetModeR8] = useState(false);
  const [manualSetBusyR8, setManualSetBusyR8] = useState(false);

  /* SHINY_TCG_RECEPCION_BUSCADOR_EXPANSIONES_R13 */
  const [expansionSearchR13, setExpansionSearchR13] = useState('');
  const [expansionOpenR13, setExpansionOpenR13] = useState(false);
  const [masterExpansionSetsR13, setMasterExpansionSetsR13] = useState([]);
  const [masterExpansionLoadingR13, setMasterExpansionLoadingR13] = useState(false);
  const [expansionSelectBusyR13, setExpansionSelectBusyR13] = useState(false);

  /* SHINY_TCG_RECEPCION_REGLAS_ESTRICTAS_R16 */
  const [cardVariantR16, setCardVariantR16] = useState('');
  const [cardTypeR16, setCardTypeR16] = useState('');
  const [cardAttributeR16, setCardAttributeR16] = useState('');

  /* SHINY_TCG_RECEPCION_SINGLE_MANUAL_R10 */
  const [manualFieldModeR10, setManualFieldModeR10] = useState({
    rareza:false,
    tipo:false,
    subtipo:false,
    artista:false,
    edicion:false
  });



  /* SHINY_TCG_RECEPCION_MANUAL_R5 */
  const manualReceptionRaritiesR5 = useMemo(() => {
    if (!entryGameFilter) return [];
    const seen=new Set();
    return (Array.isArray(rarities) ? rarities : [])
      .filter((r) => String(r.id_juego || '') === String(entryGameFilter))
      .filter((r) => r.activo !== false)
      .sort((a,b) => Number(a.orden || 999999) - Number(b.orden || 999999) || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
      .filter((r)=>{
        const key=`${String(r.nombre||'').trim().toLowerCase()}|${String(r.codigo||'').trim().toLowerCase()}`;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [rarities, entryGameFilter]);

  /* SHINY_TCG_RECEPCION_CATALOGOS_DINAMICOS_R7 */
  const manualReceptionCardsR7 = useMemo(() => {
    if (!entryGameFilter) return [];
    return (Array.isArray(cards) ? cards : []).filter((c) => String(c.id_juego || '') === String(entryGameFilter));
  }, [cards, entryGameFilter]);


  const manualReceptionTypesR7 = useMemo(() => {
    return [...new Set(manualReceptionCardsR7.map((c)=>String(c.tipo_carta||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
  }, [manualReceptionCardsR7]);

  const manualReceptionSubtypesR7 = useMemo(() => {
    const selectedType=String(manualReceptionR4.tipo_carta||'').trim();
    return [...new Set(manualReceptionCardsR7
      .filter((c)=>!selectedType || String(c.tipo_carta||'').trim()===selectedType)
      .map((c)=>String(c.subtipo||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
  }, [manualReceptionCardsR7, manualReceptionR4.tipo_carta]);

  const manualReceptionArtistsR7 = useMemo(() => {
    return [...new Set(manualReceptionCardsR7.map((c)=>String(c.artista||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
  }, [manualReceptionCardsR7]);

  const manualReceptionEditionsR7 = useMemo(() => {
    const values=(Array.isArray(inventory)?inventory:[])
      .filter((i)=>String(i.id_juego||i.card_id_juego||'')===String(entryGameFilter))
      .map((i)=>String(i.edicion||'').trim()).filter(Boolean);
    const cardValues=manualReceptionCardsR7.map((c)=>String(c.edicion||'').trim()).filter(Boolean);
    return [...new Set([...values,...cardValues])]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
  }, [inventory, manualReceptionCardsR7, entryGameFilter]);
  /* SHINY_TCG_RECEPCION_CATALOGOS_TODOS_R12_FIX */
  const manualReceptionGameR11 = useMemo(
    ()=> (Array.isArray(games)?games:[]).find((g)=>String(g.id_juego||'')===String(entryGameFilter||'')) || null,
    [games,entryGameFilter]
  );

  const strictRuleR16 = useMemo(()=>strictTcgRuleR16(manualReceptionGameR11||{}),[manualReceptionGameR11]);
  const strictCategoriesR16 = useMemo(()=>categoriesR16(strictRuleR16),[strictRuleR16]);
  const strictCategoryR16 = useMemo(
    ()=>categoryRuleR16(strictRuleR16,manualReceptionR4.tipo_carta),
    [strictRuleR16,manualReceptionR4.tipo_carta]
  );
  const strictVariantsR16 = useMemo(()=>normalizeR16List(strictCategoryR16.variants),[strictCategoryR16]);
  const strictTypesR16 = useMemo(()=>normalizeR16List(strictCategoryR16.types),[strictCategoryR16]);
  const strictAttributesR16 = useMemo(()=>normalizeR16List(strictCategoryR16.attributes),[strictCategoryR16]);
  const strictEditionsR16 = useMemo(()=>normalizeR16List(strictRuleR16.editions),[strictRuleR16]);
  const manualReceptionPresetR11 = useMemo(
    ()=>tcgReceptionPreset(manualReceptionGameR11||{}),
    [manualReceptionGameR11]
  );
  const manualReceptionTypesR11 = useMemo(
    ()=>mergeReceptionOptions(manualReceptionPresetR11.types,manualReceptionTypesR7),
    [manualReceptionPresetR11,manualReceptionTypesR7]
  );
  const manualReceptionSubtypesR11 = useMemo(
    ()=>mergeReceptionOptions(manualReceptionPresetR11.subtypes,manualReceptionSubtypesR7),
    [manualReceptionPresetR11,manualReceptionSubtypesR7]
  );
  const manualReceptionEditionsR11 = useMemo(
    ()=>mergeReceptionOptions(manualReceptionPresetR11.editions,manualReceptionEditionsR7),
    [manualReceptionPresetR11,manualReceptionEditionsR7]
  );
  const manualReceptionCatalogCoverageR12 = useMemo(()=>{
    const all=(Array.isArray(games)?games:[]);
    const unknown=all.filter((g)=>!tcgReceptionPreset(g||{}).covered);
    return {total:all.length,covered:all.length-unknown.length,unknown,presetCodes:SHINY_TCG_R12_COVERED_CODES};
  },[games]);




  useEffect(()=>{
    let cancelled=false;

    async function loadMasterExpansionsR13(){
      setExpansionSearchR13('');
      setExpansionOpenR13(false);
      setMasterExpansionSetsR13([]);

      if(!entryGameFilter) return;

      const game=(Array.isArray(games)?games:[]).find(
        (g)=>String(g.id_juego||'')===String(entryGameFilter)
      );
      const gameCode=String(game?.catalogo_codigo||game?.codigo||'').trim();
      if(!gameCode) return;

      try{
        setMasterExpansionLoadingR13(true);
        const response=await api(
          `/api/v1/tcg-sync/master-catalog/sets?gameCode=${encodeURIComponent(gameCode)}`
        );
        if(cancelled) return;

        const rows=Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response?.data?.sets)
            ? response.data.sets
            : [];

        setMasterExpansionSetsR13(rows);
      }catch(e){
        if(!cancelled){
          /* El flujo manual sigue funcionando con expansiones operativas. */
          setMasterExpansionSetsR13([]);
          console.warn('R13 master expansions:',e);
        }
      }finally{
        if(!cancelled) setMasterExpansionLoadingR13(false);
      }
    }

    loadMasterExpansionsR13();
    return ()=>{cancelled=true;};
  },[entryGameFilter,games]);

  async function selectExpansionR13(setRow){
    if(!setRow || expansionSelectBusyR13) return;

    try{
      setExpansionSelectBusyR13(true);
      const gameId=String(entryGameFilter||'').trim();
      if(!gameId) throw new Error('Selecciona primero el TCG.');

      const nombre=String(setRow.nombre||'').trim();
      const codigo=String(setRow.codigo||setRow.set_code||'').trim();

      let local=(Array.isArray(entrySets)?entrySets:[]).find((s)=>{
        const sameCode=codigo && String(s.codigo||'').trim().toLowerCase()===codigo.toLowerCase();
        const sameName=String(s.nombre||'').trim().toLowerCase()===nombre.toLowerCase();
        return sameCode || sameName;
      });

      /* Si la expansión existe solo en Catálogo Maestro, se habilita
         automáticamente en catálogo operativo al seleccionarla. */
      if(!local?.id_set){
        const created=await api('/api/v1/tcg/catalog/sets',{
          method:'POST',
          body:JSON.stringify({
            id_juego:gameId,
            nombre,
            codigo,
            logo_imagen:setRow.logo_imagen||'',
            banner_imagen:setRow.banner_imagen||'',
            descripcion:setRow.descripcion||'',
            fecha_lanzamiento:setRow.fecha_lanzamiento||'',
            total_cartas:Number(setRow.total_cartas||0),
            activo:true,
            orden:Number(setRow.orden||0)
          })
        });

        const idSet=String(created?.data?.id_set||'').trim();
        if(!idSet) throw new Error('No fue posible habilitar la expansión seleccionada.');

        await loadAll();
        local={...setRow,id_set:idSet,nombre,codigo};
      }

      setExpansionSearchR13(nombre);
      setEntrySetFilter(String(local.id_set||''));
      setEntry((x)=>({...x,id_carta:''}));
      setManualSetModeR8(false);
      setManualSetNameR8('');
      setExpansionOpenR13(false);
    }catch(e){
      const msg=String(e?.message||e);
      setMessage(msg);
      window.tcg_store_templateNotify?.(msg,{type:'error',duration:6000});
    }finally{
      setExpansionSelectBusyR13(false);
    }
  }

  async function loadAll() {
    const [g, s, r, c, i, a, b, mg] = await Promise.all([
    api('/api/v1/tcg/games'),
    api('/api/v1/tcg/sets'),
    api('/api/v1/tcg/rarities'),
    api('/api/v1/tcg/cards?limit=1000'),
    api('/api/v1/tcg/inventory?limit=1000'),
    api('/api/v1/tcg/acquisitions?limit=300'),
    api('/api/v1/branches?includeInactive=false'),
    api('/api/v1/tcg/master/games')]
    );
    setGames(Array.isArray(g?.data) ? g.data : []);
    setMasterGames(Array.isArray(mg?.data) ? mg.data : []);
    setSets(Array.isArray(s?.data) ? s.data : []);
    setRarities(Array.isArray(r?.data) ? r.data : []);
    setCards(Array.isArray(c?.data) ? c.data : []);
    setInventory(Array.isArray(i?.data) ? i.data : []);
    setAcquisitions(Array.isArray(a?.data) ? a.data : []);
    setBranches(Array.isArray(b?.data) ? b.data : []);

    if (!setForm.id_juego && Array.isArray(g?.data) && g.data[0]) setSetForm((x) => ({ ...x, id_juego: g.data[0].id_juego }));
    if (!rarityForm.id_juego && Array.isArray(g?.data) && g.data[0]) setRarityForm((x) => ({ ...x, id_juego: g.data[0].id_juego }));
    if (!cardForm.id_juego && Array.isArray(g?.data) && g.data[0]) setCardForm((x) => ({ ...x, id_juego: g.data[0].id_juego }));
    if (!entry.id_sucursal && Array.isArray(b?.data) && b.data[0]) setEntry((x) => ({ ...x, id_sucursal: b.data[0].id_sucursal }));
if (!masterGameCode && mg.data?.[0]) setMasterGameCode(mg.data[0].codigo);
    const initialOperationalGame = setForm.id_juego || (Array.isArray(g?.data) ? g.data[0]?.id_juego : '') || '';
    if (initialOperationalGame && !setForm.id_juego) {
      setSetForm((x) => ({ ...x, id_juego: initialOperationalGame }));
      setRarityForm((x) => ({ ...x, id_juego: initialOperationalGame }));
    }
  }

  useEffect(() => {loadAll().catch((e) => setMessage(e.message));}, []);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => (!gameFilter || c.id_juego === gameFilter) && (!setFilter || c.id_set === setFilter) && (!q || [c.nombre, c.numero_completo, c.id_carta, c.rareza].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [cards, gameFilter, setFilter, search]);

  const visibleSets = useMemo(() => sets.filter((s) => !gameFilter || s.id_juego === gameFilter), [sets, gameFilter]);
  const inventorySets = useMemo(() => sets.filter((x) => !inventoryGameFilter || x.id_juego === inventoryGameFilter), [sets, inventoryGameFilter]);
  const inventoryRarities = useMemo(() => rarities.filter((x) => !inventoryGameFilter || x.id_juego === inventoryGameFilter), [rarities, inventoryGameFilter]);
  const filteredInventoryBase = useMemo(() => inventory.filter((x) =>
  (!inventoryBranchFilter || String(x.id_sucursal || '') === String(inventoryBranchFilter)) && (
  !inventoryGameFilter || x.id_juego === inventoryGameFilter) && (
  !inventorySetFilter || x.id_set === inventorySetFilter) && (
  !inventoryRarityFilter || String(x.rareza || '').toLowerCase() === String(inventoryRarityFilter).toLowerCase())
  ), [inventory, inventoryBranchFilter, inventoryGameFilter, inventorySetFilter, inventoryRarityFilter]);
  const filteredInventory = filteredInventoryBase.filter((x) => {
    if (!tcg_store_templateRowMatchesSelectedGame(x, inventoryGameFilter, games)) return false;
    const q = String(inventorySearch || '').
    normalize('NFD').
    replace(/[\u0300-\u036f]/g, '').
    trim().
    toUpperCase();
    return !q || tcg_store_templateInventorySearchText(x).includes(q);
  });

  const filteredGeneralProducts = useMemo(() => generalProducts.filter((x) => {
    const categoria = String(x.categoria || '').trim().toLowerCase();

    const isSellado = categoria === 'tcg sellado';
    const isAccesorio = categoria === 'accesorios';

    if (!isSellado && !isAccesorio) return false;

    if (inventoryBranchFilter) {
      const branchValue = String(
        x.id_sucursal ||
        x.branch_id ||
        x.branchId ||
        ''
      );

      if (branchValue && branchValue !== String(inventoryBranchFilter)) return false;
    }

    if (inventoryTypeFilter === 'SELLADO' && !isSellado) return false;
    if (inventoryTypeFilter === 'ACCESORIOS' && !isAccesorio) return false;

    return true;
  }), [generalProducts, inventoryBranchFilter, inventoryTypeFilter]);

  const visibleSingles = useMemo(() => {
    if (inventoryTypeFilter === 'SELLADO' || inventoryTypeFilter === 'ACCESORIOS') return [];
    return filteredInventory;
  }, [filteredInventory, inventoryTypeFilter]);

  const visibleGeneralProducts = useMemo(() => {
    if (inventoryTypeFilter === 'SINGLES') return [];
    return filteredGeneralProducts;
  }, [filteredGeneralProducts, inventoryTypeFilter]);

  const unifiedStock = useMemo(() => {
    const singles = visibleSingles.reduce((a, x) => a + Number(x.stock || 0), 0);
    const products = visibleGeneralProducts.reduce((a, x) => a + Number(x.stock || 0), 0);
    return singles + products;
  }, [visibleSingles, visibleGeneralProducts]);

  const selladoCount = useMemo(() =>
  filteredGeneralProducts.filter((x) =>
  String(x.categoria || '').trim().toLowerCase() === 'tcg sellado'
  ).length,
  [filteredGeneralProducts]);

  const accesoriosCount = useMemo(() =>
  filteredGeneralProducts.filter((x) =>
  String(x.categoria || '').trim().toLowerCase() === 'accesorios'
  ).length,
  [filteredGeneralProducts]);
  const entrySets = useMemo(
    () => (Array.isArray(sets) ? sets : []).filter((x) => !entryGameFilter || x.id_juego === entryGameFilter),
    [sets, entryGameFilter]
  );

  const expansionCatalogR13 = useMemo(()=>{
    const result=[];
    const seen=new Set();

    const push=(s,source)=>{
      const nombre=String(s?.nombre||s?.name||'').trim();
      const codigo=String(s?.codigo||s?.set_code||s?.code||'').trim();
      if(!nombre) return;

      const key=(codigo ? `code:${codigo}` : `name:${nombre}`)
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

      if(seen.has(key)) return;
      seen.add(key);
      result.push({
        ...s,
        nombre,
        codigo,
        _sourceR13:source,
        _operationalR13:source==='LOCAL'
      });
    };

    /* Operativas primero: si existe en ambos catálogos, conserva id_set real. */
    (Array.isArray(entrySets)?entrySets:[]).forEach((s)=>push(s,'LOCAL'));
    (Array.isArray(masterExpansionSetsR13)?masterExpansionSetsR13:[]).forEach((s)=>push(s,'MASTER'));

    return result.sort((a,b)=>
      String(a.nombre||'').localeCompare(String(b.nombre||''),'es',{sensitivity:'base'})
    );
  },[entrySets,masterExpansionSetsR13]);

  const expansionMatchesR13 = useMemo(()=>{
    const normalize=(v)=>String(v||'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLocaleLowerCase('es').trim();

    const q=normalize(expansionSearchR13);
    if(!q) return [];

    /* Como solicitó el usuario:
       L -> todas las que EMPIEZAN con L
       Lo -> todas las que EMPIEZAN con Lo
       Lord -> todas las que EMPIEZAN con Lord */
    return expansionCatalogR13.filter((s)=>normalize(s.nombre).startsWith(q));
  },[expansionCatalogR13,expansionSearchR13]);

  const entryCards = useMemo(
    () => (Array.isArray(cards) ? cards : []).filter((x) =>
    (!entryGameFilter || x.id_juego === entryGameFilter) && (
    !entrySetFilter || x.id_set === entrySetFilter)
    ),
    [cards, entryGameFilter, entrySetFilter]
  );

  useEffect(() => {
    if (entrySetFilter && !entrySets.some((x) => x.id_set === entrySetFilter)) {
      setEntrySetFilter('');
    }
  }, [entryGameFilter, entrySetFilter, entrySets]);



  async function create(kind, form, reset) {
    try {
      await api(`/api/v1/tcg/catalog/${kind}`, { method: 'POST', body: JSON.stringify(form) });
      setMessage('Registro TCG creado.');
      reset();
      await loadAll();
    } catch (e) {setMessage(e.message);}
  }

  async function loadMasterDetail(code) {
    setMasterGameCode(code);
    if (!code) {setMasterSets([]);setMasterRarities([]);return;}
    try {
      const [s, r] = await Promise.all([
      api(`/api/v1/tcg/master/sets?gameCode=${encodeURIComponent(code)}`),
      api(`/api/v1/tcg/master/rarities?gameCode=${encodeURIComponent(code)}`)]
      );
      setMasterSets(s.data || []);setMasterRarities(r.data || []);
    } catch (e) {setMessage(e.message);}
  }

  useEffect(() => {if (masterGameCode) loadMasterDetail(masterGameCode);}, [masterGameCode]);

  async function activateMaster(code, visiblePortal = false) {
    try {
      const r = await api(`/api/v1/tcg/master/games/${encodeURIComponent(code)}/activate`, {
        method: 'POST', body: JSON.stringify({ visiblePortal })
      });
      setMessage(brandText(`${r.data.game.nombre} agregado a Shiny con ${r.data.sets} sets y ${r.data.rarities} rarezas.`));
      await loadAll();
    } catch (e) {setMessage(e.message);}
  }

  async function setVisibility(game, value) {
    try {
      await api(`/api/v1/tcg/games/${game.row_id}/visibility`, {
        method: 'PUT', body: JSON.stringify({ visiblePortal: value })
      });
      setMessage(value ? `${game.nombre} visible en portal cliente.` : `${game.nombre} oculto del portal cliente.`);
      try {
        localStorage.setItem('Shiny_TCG_VISIBILITY_VERSION', String(Date.now()));
        window.dispatchEvent(new CustomEvent('tcg_store_template:tcg-visibility-changed'));
      } catch {}
      await loadAll();
    } catch (e) {setMessage(e.message);}
  }

  async function downloadDynamicTemplate() {
    try {
      const token = localStorage.getItem('SHINY_AUTH_TOKEN') || '';
      const response = await fetch('/api/v1/tcg/template.xlsx', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('No fue posible generar la plantilla.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;a.download = 'Shiny_Plantillas_Importacion_Dinamica.xlsx';
      document.body.appendChild(a);a.click();a.remove();
      URL.revokeObjectURL(url);
      setMessage('Plantilla generada con juegos, expansiones y rarezas actuales.');
    } catch (e) {setMessage(e.message);}
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, mime: file.type, data: reader.result });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function importExcel(kind, file) {
    if (!file) return;
    setImporting(true);setMessage('');
    try {
      const payload = await readFile(file);
      const path = kind === 'cards' ? '/api/v1/tcg/imports/cards' : '/api/v1/tcg/imports/master';
      const r = await api(path, { method: 'POST', body: JSON.stringify({ file: payload }) });
      setMessage(`Importación terminada: ${r.data.created} creados, ${r.data.updated} actualizados, ${r.data.errors.length} errores.`);
      if (r.data.errors.length) window.tcg_store_templateNotify?.(`Importación completada con ${r.data.errors.length} filas con error.`, { type: 'warning', duration: 7000 });
      await loadAll();
    } catch (e) {setMessage(e.message);} finally {setImporting(false);}
  }

  async function loadOperationalMaster(gameId) {
    const game = games.find((g) => g.id_juego === gameId);
    const code = String(game?.catalogo_codigo || game?.codigo || '').toUpperCase();
    if (!code) {
      setOperationalMasterSets([]);
      setOperationalMasterRarities([]);
      return;
    }
    try {
      const [s, r] = await Promise.all([
      api(`/api/v1/tcg/master/sets?gameCode=${encodeURIComponent(code)}`),
      api(`/api/v1/tcg/master/rarities?gameCode=${encodeURIComponent(code)}`)]
      );
      setOperationalMasterSets(s.data || []);
      setOperationalMasterRarities(r.data || []);
    } catch (e) {
      setOperationalMasterSets([]);
      setOperationalMasterRarities([]);
      setMessage(e.message);
    }
  }

  async function syncOperationalMaster(gameId) {
    const game = games.find((g) => g.id_juego === gameId);
    const code = String(game?.catalogo_codigo || game?.codigo || '').toUpperCase();
    if (!game || !code) {
      setMessage('Selecciona un TCG vinculado al catálogo maestro.');
      return;
    }
    setCatalogSyncing(true);
    try {
      const r = await api(`/api/v1/tcg/master/games/${encodeURIComponent(code)}/activate`, {
        method: 'POST',
        body: JSON.stringify({ visiblePortal: game.visible_portal !== false })
      });
      setMessage(
        `${game.nombre}: ${r.data.sets} expansiones y ${r.data.rarities} rarezas sincronizadas desde el catálogo maestro.`
      );
      window.tcg_store_templateNotify?.(
        `${game.nombre} actualizado desde el catálogo maestro.`,
        { type: 'success' }
      );
      await loadAll();
      await loadOperationalMaster(gameId);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setCatalogSyncing(false);
    }
  }


  async function downloadReceiptTemplate() {
    try {
      const token = localStorage.getItem('SHINY_AUTH_TOKEN') || '';
      const response = await fetch('/api/v1/tcg/inventory/receipt-template.xlsx', {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
      });
      if (!response.ok) throw new Error('No fue posible generar la plantilla de recepción.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;a.download = 'Shiny_TCG_Recepcion_Masiva.xlsx';
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
      setMessage('Plantilla de recepción generada desde la DBA actual.');
    } catch (e) {setMessage(e.message);}
  }

  async function prepareReceiptBulk(file) {
    if (!file) return;
    setReceiptBulkBusy(true);
    setReceiptBulk(null);
    setReceiptBulkErrors([]);
    setReceiptBulkProgress({ processed: 0, total: 0, ok: 0, failed: 0 });
    try {
      const payload = await readFile(file);
      const r = await api('/api/v1/tcg/inventory/receipt-parse', {
        method: 'POST', body: JSON.stringify({ file: payload })
      });
      setReceiptBulk(r.data);
      setReceiptBulkErrors(r.data.errors || []);
      setReceiptBulkProgress({
        processed: 0, total: Number(r.data.validRows || 0), ok: 0, failed: Number(r.data.invalidRows || 0)
      });
      setMessage(
        `Archivo validado: ${r.data.totalRows} fila(s), ${r.data.validRows} válida(s), ${r.data.invalidRows} con error.`
      );
    } catch (e) {setMessage(e.message);} finally
    {setReceiptBulkBusy(false);}
  }

  async function runReceiptBulk() {
    const rows = receiptBulk?.rows || [];
    if (!rows.length) return;
    setReceiptBulkBusy(true);
    const chunkSize = 500;
    let processed = 0,ok = 0,failed = Number(receiptBulk.invalidRows || 0);
    const runtimeErrors = [...(receiptBulk.errors || [])];

    try {
      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize);
        const r = await api('/api/v1/tcg/inventory/receive-bulk', {
          method: 'POST',
          body: JSON.stringify({ rows: chunk })
        });
        ok += Number(r.data.ok || 0);
        failed += Number(r.data.failed || 0);
        for (const error of (r.data.result || []).filter((x) => !x.ok)) {
          runtimeErrors.push({
            row: Number(chunk[error.index]?.source_row || start + error.index + 2),
            error: error.error
          });
        }
        processed += chunk.length;
        setReceiptBulkProgress({ processed, total: rows.length, ok, failed });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setReceiptBulkErrors(runtimeErrors);
      setMessage(`Recepción masiva terminada: ${ok} correcta(s), ${failed} con error.`);
      window.tcg_store_templateNotify?.(
        failed ? `Recepción completada con ${failed} error(es).` : `${ok} fila(s) recibidas correctamente.`,
        { type: failed ? 'warning' : 'success', duration: 7000 }
      );
      await loadAll();
    } catch (e) {
      setMessage(`Proceso detenido después de ${processed} fila(s): ${e.message}`);
    } finally {
      setReceiptBulkBusy(false);
    }
  }


  function editInventoryCommercial(row) {
    setInventoryCommercialEdit({
      id_inventario: row.id_inventario,
      sku: row.sku,
      carta: row.carta || row.id_carta,
      costo: Number(row.costo || 0),
      precio: Number(row.precio || 0),
      precio_oferta: Number(row.precio_oferta || 0),
      estado_venta: row.estado_venta || 'DISPONIBLE'
    });
  }

  async function saveInventoryCommercial() {
    if (!inventoryCommercialEdit) return;

    try {
      setInventoryCommercialBusy(true);

      const x = inventoryCommercialEdit;

      await api(
        `/api/v1/tcg/inventory/${encodeURIComponent(x.id_inventario)}/commercial`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            costo: Number(x.costo || 0),
            precio: Number(x.precio || 0),
            precio_oferta: Number(x.precio_oferta || 0),
            estado_venta: x.estado_venta || 'DISPONIBLE'
          })
        }
      );

      setMessage(`Datos comerciales actualizados: ${x.sku}`);

      window.tcg_store_templateNotify?.(
        `Precio actualizado: ${x.sku}`,
        { type: 'success', duration: 5000 }
      );

      setInventoryCommercialEdit(null);
      await loadAll();

    } catch (e) {
      setMessage(e.message);
    } finally {
      setInventoryCommercialBusy(false);
    }
  }

  async function handleVisionTcgResult(result) {
    const queries = visionQueries(result, { max: 7 });
    const found = new Map();

    for (const q of queries) {
      try {
        const r = await api(`/api/v1/tcg/cards?search=${encodeURIComponent(q)}&limit=40`);
        for (const card of r.data || []) {
          const score = scoreVisionCandidate(card, result);
          const key = String(card.id_carta || card.row_id);
          const previous = found.get(key);
          if (!previous || score > previous.score) found.set(key, { ...card, key, score });
        }
      } catch {}
    }

    const candidates = [...found.values()].
    filter((x) => x.score >= 0.18).
    sort((a, b) => b.score - a.score).
    slice(0, 10);

    setVisionCandidates(candidates);
    setVisionOpen(false);
    setVisionPickerOpen(true);
  }

  function pickVisionTcgCard(card) {
    if (card.id_juego) setEntryGameFilter(card.id_juego);
    if (card.id_set) setEntrySetFilter(card.id_set);
    setEntry((x) => ({ ...x, id_carta: card.id_carta }));
    setTab('entry');
    setVisionPickerOpen(false);
    setMessage(`Carta reconocida: ${card.nombre || card.id_carta}. Confirma idioma, condición, acabado, cantidad y precio antes de recibir.`);
  }

  /* SHINY_RECEPCION_INDIVIDUAL_R1_FUNCTIONS */
  function receptionImage(card = {}) {
    return card.image_local_url || card.image_large_url || card.image_small_url || card.image || card.imagen_url || card.imagen || '';
  }

  function receptionMarketPrice(card = {}) {
    const rows = Array.isArray(card.internet_prices) ? card.internet_prices : [];
    const preferred = rows.find((x) => Number.isFinite(Number(x.market))) || rows.find((x) => Number.isFinite(Number(x.mid)));
    const value = preferred?.market ?? preferred?.mid ?? card.market_price_usd ?? card.precio_mercado ?? null;
    return value == null || value === '' ? null : Number(value);
  }

  function receptionGameCode() {
    const game = (games || []).find((g) => String(g.id_juego) === String(entryGameFilter));
    return String(game?.catalogo_codigo || game?.codigo || game?.game_code || '').trim().toUpperCase();
  }

  async function searchReceptionCard() {
    const q = String(entryReceptionName || '').trim();
    const code = String(entryReceptionCode || '').trim();
    const effective = [q, code].filter(Boolean).join(' ').trim();
    if (effective.length < 2) {
      setMessage('Escribe el nombre exacto o el numero/codigo de la carta.');
      return;
    }

    setEntryReceptionBusy(true);
    setEntryReceptionSelected(null);
    try {
      const localResponse = await api(`/api/v1/tcg/cards?search=${encodeURIComponent(effective)}&limit=40`);
      let localRows = Array.isArray(localResponse?.data) ? localResponse.data : [];
      if (entryGameFilter) localRows = localRows.filter((x) => String(x.id_juego || '') === String(entryGameFilter));
      if (entrySetFilter) localRows = localRows.filter((x) => String(x.id_set || '') === String(entrySetFilter));
      if (entryReceptionRarity) localRows = localRows.filter((x) => String(x.rareza || '').toLowerCase() === String(entryReceptionRarity).toLowerCase());
      localRows = localRows.map((x) => ({ ...x, _shinySource: 'CATALOGO_Shiny' }));

      let internetRows = [];
      const gameCode = receptionGameCode();
      if (gameCode && q.length >= 2) {
        try {
          const external = await api(`/api/v1/external-card-beta/search?${new URLSearchParams({ game: gameCode, q })}`);
          internetRows = (Array.isArray(external?.data?.rows) ? external.data.rows : []).map((x) => ({ ...x, _shinySource: 'INTERNET' }));
          if (code) {
            const wanted = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const exactCode = internetRows.filter((x) => String(x.collector_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === wanted);
            if (exactCode.length) internetRows = exactCode;
          }
        } catch {
          // El formulario sigue funcionando con el catalogo Shiny aunque un proveedor externo no soporte el TCG.
        }
      }

      const seen = new Set();
      const merged = [...localRows, ...internetRows].filter((x) => {
        const key = x.id_carta ? `LOCAL:${x.id_carta}` : `EXT:${x.source || ''}:${x.external_id || ''}:${x.collector_number || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 24);

      setEntryReceptionResults(merged);
      setMessage(merged.length ? `Se encontraron ${merged.length} coincidencia(s). Selecciona la impresion correcta.` : `Sin coincidencias para "${effective}".`);
    } catch (error) {
      setEntryReceptionResults([]);
      setMessage(error?.message || 'No fue posible buscar la carta.');
    } finally {
      setEntryReceptionBusy(false);
    }
  }

  async function selectReceptionCard(card) {
    if (!card) return;
    setEntryReceptionBusy(true);
    try {
      let operational = card;
      if (!card.id_carta && card._shinySource === 'INTERNET') {
        const identity = {
          game: card.game, source: card.source, external_id: card.external_id,
          name: card.name, set_name: card.set_name, set_code: card.set_code,
          collector_number: card.collector_number, language: card.language || entry.idioma || 'EN',
          rarity: card.rarity, type: card.type, description: card.description,
          image: card.image, source_url: card.raw_hint?.source_url || '', internet_prices: card.internet_prices || []
        };
        const ensured = await api('/api/v1/external-card-beta/ensure-operational', {
          method: 'POST', body: JSON.stringify({ identity })
        });
        operational = { ...card, ...(ensured?.data || {}), _shinySource: 'INTERNET' };
      }

      if (!operational.id_carta) throw new Error('La carta no pudo relacionarse con un producto TCG de Shiny.');
      if (operational.id_juego) setEntryGameFilter(operational.id_juego);
      if (operational.id_set) setEntrySetFilter(operational.id_set);
      setEntry((current) => ({ ...current, id_carta: operational.id_carta }));
      setEntryReceptionSelected(operational);
      setEntryReceptionName(operational.nombre || operational.name || entryReceptionName);
      setEntryReceptionCode(operational.numero_completo || operational.collector_number || entryReceptionCode);
      setEntryReceptionRarity(operational.rareza || operational.rarity || entryReceptionRarity);
      setMessage(`Carta seleccionada: ${operational.nombre || operational.name || operational.id_carta}. Revisa los datos de recepcion antes de registrar.`);
    } catch (error) {
      setMessage(error?.message || 'No fue posible seleccionar esta carta.');
    } finally {
      setEntryReceptionBusy(false);
    }
  }
  /* SHINY_TCG_RECEPCION_EXPANSIONES_R8_FUNCTION */
  async function createManualSetR8() {
    try {
      const gameId=String(entryGameFilter||'').trim();
      const nombre=String(manualSetNameR8||'').trim();
      if(!gameId) throw new Error('Selecciona primero el TCG.');
      if(!nombre) throw new Error('Escribe el nombre de la expansión.');

      const duplicate=(Array.isArray(entrySets)?entrySets:[]).find(
        (s)=>String(s.nombre||'').trim().toLowerCase()===nombre.toLowerCase()
      );
      if(duplicate?.id_set){
        setEntrySetFilter(duplicate.id_set);
        setExpansionSearchR13(duplicate.nombre||nombre);
        setExpansionOpenR13(false);
        setManualSetModeR8(false);
        setManualSetNameR8('');
        setEntry((x)=>({...x,id_carta:''}));
        setMessage(`Expansión existente seleccionada: ${duplicate.nombre}`);
        return;
      }

      setManualSetBusyR8(true);
      const created=await api('/api/v1/tcg/catalog/sets',{
        method:'POST',
        body:JSON.stringify({
          id_juego:gameId,
          nombre,
          codigo:'',
          logo_imagen:'',
          banner_imagen:'',
          descripcion:'',
          fecha_lanzamiento:'',
          total_cartas:0,
          activo:true,
          orden:0
        })
      });

      const idSet=String(created?.data?.id_set||'').trim();
      if(!idSet) throw new Error('La expansión se creó pero no se recibió su ID.');

      await loadAll();
      setEntrySetFilter(idSet);
      setExpansionSearchR13(nombre);
      setExpansionOpenR13(false);
      setEntry((x)=>({...x,id_carta:''}));
      setManualSetModeR8(false);
      setManualSetNameR8('');
      setMessage(`Expansión agregada: ${nombre}`);
      window.tcg_store_templateNotify?.(`Expansión agregada: ${nombre}`,{type:'success',duration:4500});
    } catch(e) {
      const msg=String(e?.message||e);
      setMessage(msg);
      window.tcg_store_templateNotify?.(msg,{type:'error',duration:6000});
    } finally {
      setManualSetBusyR8(false);
    }
  }

  /* SHINY_TCG_RECEPCION_MANUAL_R4_FUNCTION */
  /* SHINY_TCG_RECEPCION_MANUAL_R5_FUNCTION */
  async function receiveManualR4() {
    try {
      const gameId=String(entryGameFilter||'').trim();
      const setId=String(entrySetFilter||'').trim();
      const typedName=String(manualReceptionR4.nombre||'').trim();
      const typedNumber=String(manualReceptionR4.numero||'').trim();

      if(!gameId) throw new Error('Selecciona el TCG.');
      if(!setId) throw new Error('Selecciona la expansión / set.');
      if(!entry.id_sucursal) throw new Error('Selecciona la sucursal.');
      if(Number(entry.cantidad||0)<1) throw new Error('La cantidad debe ser mayor a cero.');

      /* SHINY_TCG_RECEPCION_MANUAL_R6 */
      let cardId=String(entry.id_carta||'').trim();
      let createdNow=false;

      const allowedRarities=(Array.isArray(rarities)?rarities:[])
        .filter((r)=>String(r.id_juego||'')===gameId && r.activo!==false);
      const selectedRarity=String(manualReceptionR4.rareza||'').trim();
      const selectedType=String(manualReceptionR4.tipo_carta||'').trim();
      const selectedSubtype=String(manualReceptionR4.subtipo||'').trim();
      const selectedArtist=String(manualReceptionR4.artista||'').trim();
      const selectedEdition=String(entry.edicion||'').trim();

      /* R10: Tipo, subtipo, artista y edición pueden ser nuevos en recepción manual.
         Se guardan con la carta/inventario y aparecerán en futuras listas del mismo TCG. */

      if(!cardId && !selectedRarity){
        throw new Error('Selecciona o agrega la rareza de la carta.');
      }

      if(!cardId && selectedRarity && !allowedRarities.some((r)=>String(r.nombre||'').trim().toLowerCase()===selectedRarity.toLowerCase())){
        await api('/api/v1/tcg/catalog/rarities',{
          method:'POST',
          body:JSON.stringify({
            id_juego:gameId,
            codigo:selectedRarity,
            nombre:selectedRarity,
            orden:9999,
            activo:true
          })
        });
      }

      if(!cardId){
        if(!typedName) throw new Error('Captura el nombre exacto de la carta.');

        const localCards=Array.isArray(cards)?cards:[];
        const same=localCards.find((c)=>{
          if(String(c.id_juego||'')!==gameId) return false;
          if(String(c.id_set||'')!==setId) return false;
          const cName=String(c.nombre||'').trim().toUpperCase();
          const cNum=String(c.numero_completo||c.numero_carta||'').trim().toUpperCase();
          if(typedNumber) return cNum===typedNumber.toUpperCase();
          return cName===typedName.toUpperCase();
        });

        if(same?.id_carta){
          cardId=String(same.id_carta);
        }else{
          const created=await api('/api/v1/tcg/catalog/cards',{
            method:'POST',
            body:JSON.stringify({
              id_juego:gameId,
              id_set:setId,
              nombre:typedName,
              numero_carta:typedNumber,
              numero_set:'',
              numero_completo:typedNumber,
              rareza:String(manualReceptionR4.rareza||'').trim(),
              tipo_carta:String(manualReceptionR4.tipo_carta||'').trim(),
              subtipo:String(manualReceptionR4.subtipo||'').trim(),
              artista:String(manualReceptionR4.artista||'').trim(),
              descripcion:'',
              estado_catalogo:'ACTIVA'
            })
          });
          cardId=String(created?.data?.id_carta||'').trim();
          if(!cardId) throw new Error('No fue posible obtener el ID de la carta creada.');
          createdNow=true;
        }
      }

      const r=await api('/api/v1/tcg/inventory/receive',{
        method:'POST',
        body:JSON.stringify({...entry,id_carta:cardId})
      });

      setEntry((x)=>({...x,id_carta:'',cantidad:1,costo_unitario:0,origen_referencia:'',notas:''}));
      setManualReceptionR4({nombre:'',numero:'',rareza:'',tipo_carta:'',subtipo:'',artista:''});
      setCardVariantR16('');
      setCardTypeR16('');
      setCardAttributeR16('');
      setManualFieldModeR10({rareza:false,tipo:false,subtipo:false,artista:false,edicion:false});
      if(typeof setEntryReceptionName==='function') setEntryReceptionName('');
      if(typeof setEntryReceptionCode==='function') setEntryReceptionCode('');
      if(typeof setEntryReceptionRarity==='function') setEntryReceptionRarity('');
      if(typeof setEntryReceptionSelected==='function') setEntryReceptionSelected(null);
      if(typeof setEntryReceptionResults==='function') setEntryReceptionResults([]);

      setMessage(`${createdNow?'Carta creada localmente y recepción registrada':'Recepción registrada'}: ${r?.data?.id_adquisicion||'OK'} · ${r?.data?.sku||cardId}`);
      await loadAll();
    } catch(e) {
      const raw=String(e?.message||e||'No se pudo completar la recepción.');
      const friendly={
        INVALID_ENTRY:'Faltan datos requeridos para registrar la recepción.',
        INVALID_PRICE:'Revisa costo, precio y oferta; no pueden ser negativos.',
        CARD_NOT_FOUND:'La carta no existe en el catálogo local.',
        BRANCH_NOT_FOUND:'La sucursal seleccionada no existe o está inactiva.',
        SET_NOT_FOUND:'La expansión seleccionada no existe.',
        SET_GAME_MISMATCH:'La expansión no pertenece al TCG seleccionado.',
        RARITY_NOT_FOUND:'La rareza seleccionada no existe para este TCG.'
      }[raw] || raw;
      setMessage(friendly);
      window.tcg_store_templateNotify?.(friendly,{type:'error',duration:6500});
    }
  }

  async function receive() {
    try {
      const r = await api('/api/v1/tcg/inventory/receive', { method: 'POST', body: JSON.stringify(entry) });
      setMessage(`Entrada registrada: ${r.data.id_adquisicion} · ${r.data.sku}`);
      await loadAll();
    } catch (e) {setMessage(e.message);}
  }

  const tcg_store_templateVisibleInventory = (filteredInventory || []).filter((row) =>
  tcg_store_templateR2MatchesGame(row, inventoryGameFilter, games) &&
  tcg_store_templateR2MatchesSearch(row, inventorySearch)
  );

  /* Shiny_PRODUCT_TABLE_FILTER_R23 */
  const tcg_store_templateVisibleProducts = (visibleGeneralProducts || []).filter((row) =>
  tcg_store_templateR2MatchesGame(row, inventoryGameFilter, games) &&
  tcg_store_templateR2MatchesSearch(row, inventorySearch)
  );

  const shinyInventoryDashboard = useMemo(() => {
    const singles = tcg_store_templateVisibleInventory || [];
    const allRows = singles.map((x) => ({
      kind: 'SINGLE',
      name: x.carta || x.nombre || x.id_carta || 'Carta',
      sku: x.sku || x.id_inventario || '',
      category: x.rareza || 'Single TCG',
      stock: Number(x.stock || 0),
      price: Number(x.precio_oferta || x.precio || 0),
      gameId: x.id_juego || '',
      setName: x.set_nombre || x.expansion || x.edicion || '',
      status: x.estado_venta || 'DISPONIBLE',
      raw: x
    }));

    const units = allRows.reduce((sum, x) => sum + x.stock, 0);
    const value = allRows.reduce((sum, x) => sum + (x.stock * x.price), 0);
    const skuCount = new Set(allRows.map((x) => x.sku).filter(Boolean)).size;
    const lowStock = allRows.filter((x) => x.stock > 0 && x.stock <= 2).length;

    const byGame = (games || []).map((g) => {
      const rows = allRows.filter((x) => {
        if (x.raw?.id_juego != null && String(x.raw.id_juego) !== '') {
          return String(x.raw.id_juego) === String(g.id_juego);
        }
        return tcg_store_templateR2MatchesGame(x.raw, g.id_juego, games);
      });
      return {
        id: g.id_juego,
        name: g.nombre || g.codigo || g.id_juego,
        units: rows.reduce((sum, x) => sum + x.stock, 0),
        items: rows.length
      };
    }).filter((x) => x.units || x.items).sort((a, b) => b.units - a.units);

    const top = [...allRows]
      .sort((a, b) => (b.stock * b.price) - (a.stock * a.price))
      .slice(0, 5);

    return { allRows, units, value, skuCount, lowStock, byGame, top };
  }, [tcg_store_templateVisibleInventory, games]);
  const shinyInventoryFinal=useMemo(()=>{
    const rows=(tcg_store_templateVisibleInventory||[]).map(x=>({
      type:'SINGLE',
      name:x.carta||x.nombre||x.id_carta||'Carta',
      sku:x.sku||x.id_inventario||'',
      category:x.rareza||'Single TCG',
      stock:Number(x.stock||0),
      cost:Number(x.costo||0),
      price:Number(x.precio_oferta||x.precio||0),
      gameId:x.id_juego||'',
      raw:x
    }));
    const units=rows.reduce((n,x)=>n+x.stock,0);
    const value=rows.reduce((n,x)=>n+(x.stock*x.cost),0);
    const skuCount=new Set(rows.map(x=>x.sku).filter(Boolean)).size;
    const lowStock=rows.filter(x=>x.stock>0&&x.stock<=2).length;

    const byGame=(games||[]).map(g=>{
      const group=rows.filter(x=>{
        if(x.raw?.id_juego!=null&&String(x.raw.id_juego)!==''){
          return String(x.raw.id_juego)===String(g.id_juego);
        }
        return tcg_store_templateR2MatchesGame(x.raw,g.id_juego,games);
      });
      return {
        id:g.id_juego,
        name:g.nombre||g.codigo||g.id_juego,
        units:group.reduce((n,x)=>n+x.stock,0),
        items:group.length
      };
    }).filter(x=>x.units||x.items).sort((a,b)=>b.units-a.units);

    const top=[...rows]
      .sort((a,b)=>(b.stock*b.cost)-(a.stock*a.cost))
      .slice(0,5);

    return {rows,units,value,skuCount,lowStock,byGame,top};
  },[tcg_store_templateVisibleInventory,games]);
  const proposalAFilteredAcquisitions = useMemo(() => {
    const q = acqSearch.trim().toLowerCase();
    return (acquisitions || []).filter((a) => {
      const matchesStatus = !acqStatus || String(a.estado || '').toUpperCase() === acqStatus;
      const hay = [a.id_adquisicion, a.carta, a.sku, a.sucursal, a.origen_nombre, a.tipo_entrada].filter(Boolean).join(' ').toLowerCase();
      return matchesStatus && (!q || hay.includes(q));
    });
  }, [acquisitions, acqSearch, acqStatus]);

  return <div className="tcg-stack r23-view r23-tcg tcg-option-c proposal-a-tcg">
    <section className="content-card proposal-a-shell">
      {message ? <div className="message proposal-a-global-message">{message}</div> : null}
      <div className="tabs tcg-tabs-dedup proposal-a-tabs design4-tabs">
        <button className={tab === 'mastercatalog' ? 'tab active' : 'tab'} onClick={() => setTab('mastercatalog')}><TcgR76NavIcon name="catalog" /><span className="tcg-r76-nav-label">Catálogo Maestro</span></button>
        <button className={tab === 'inventory' ? 'tab active' : 'tab'} onClick={() => setTab('inventory')}><TcgR76NavIcon name="inventory" /><span className="tcg-r76-nav-label">Inventario</span></button>
        <button className={tab === 'entry' ? 'tab active' : 'tab'} onClick={() => { setVisionOpen(false); setVisionPickerOpen(false); setVisionCandidates([]); setTab('entry'); }}><TcgR76NavIcon name="reception" /><span className="tcg-r76-nav-label">Recepción</span></button>
        <button className={tab === 'acq' ? 'tab active' : 'tab'} onClick={() => setTab('acq')}><TcgR76NavIcon name="history" /><span className="tcg-r76-nav-label">Historial</span></button>
        <button className={tab === 'autosync' ? 'tab active' : 'tab'} onClick={() => setTab('autosync')}><TcgR76NavIcon name="sync" /><span className="tcg-r76-nav-label">Auto Sync</span></button>
      </div>

      {tab === 'inventory' ? <div className="tcg-body shiny-inventory-final">
  <div className="shiny-inv-final-head">
    <div>
      <span className="eyebrow">INVENTARIO</span>
      <h2>Inventario TCG</h2>
      <p>Consulta únicamente singles TCG disponibles, su valor y ubicación.</p>
    </div>
    <span className="shiny-inv-final-count">{shinyInventoryFinal.rows.length} artículos</span>
  </div>

  <div className="shiny-inv-final-filters">
    <label>TCG
      <select value={inventoryGameFilter} onChange={(e)=>{setInventoryGameFilter(e.target.value);setInventorySetFilter('');setInventoryRarityFilter('');}}>
        <option value="">Todos los TCG</option>
        {games.map(g=><option key={g.row_id||g.id_juego} value={g.id_juego}>{g.nombre}</option>)}
      </select>
    </label>

    <label>Expansión
      <select value={inventorySetFilter} onChange={(e)=>setInventorySetFilter(e.target.value)}>
        <option value="">Todas las expansiones</option>
        {inventorySets.map(x=><option key={x.row_id||x.id_set} value={x.id_set}>{x.nombre}</option>)}
      </select>
    </label>

    <label className="wide">Buscar
      <input
        type="search"
        value={inventorySearch}
        onChange={(e)=>setInventorySearch(e.target.value)}
        placeholder="Buscar carta, SKU o código..."
      />
    </label>

    <label>Sucursal
      <select value={inventoryBranchFilter} onChange={(e)=>setInventoryBranchFilter(e.target.value)}>
        <option value="">Todas las sucursales</option>
        {branches.map(b=><option key={b.row_id||b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal||b.codigo||b.id_sucursal}</option>)}
      </select>
    </label>


  </div>

  <div className="shiny-inv-final-kpis">
    <article><span>Valor de inventario</span><strong>{money(shinyInventoryFinal.value)}</strong><small>costo × existencias</small></article>
    <article><span>Unidades</span><strong>{shinyInventoryFinal.units.toLocaleString('es-MX')}</strong><small>en existencia</small></article>
    <article><span>SKUs únicos</span><strong>{shinyInventoryFinal.skuCount.toLocaleString('es-MX')}</strong><small>referencias</small></article>
    <article><span>Stock bajo</span><strong>{shinyInventoryFinal.lowStock}</strong><small>1–2 unidades</small></article>
  </div>

  <div className="shiny-inv-final-overview">
    <section className="shiny-inv-final-card">
      <div className="shiny-inv-final-title"><div><h3>Distribución por TCG</h3><p>Unidades disponibles por juego.</p></div></div>
      <div className="shiny-inv-final-bars">
        {shinyInventoryFinal.byGame.length ? shinyInventoryFinal.byGame.slice(0,6).map(item=>{
          const max=Math.max(1,...shinyInventoryFinal.byGame.map(x=>x.units));
          return <div key={item.id} className="shiny-inv-final-bar">
            <div><strong>{item.name}</strong><small>{item.items} referencias</small></div>
            <span><i style={{width:`${Math.max(4,(item.units/max)*100)}%`}} /></span>
            <b>{item.units.toLocaleString('es-MX')}</b>
          </div>;
        }) : <div className="shiny-inv-final-empty">Sin datos para mostrar.</div>}
      </div>
    </section>

    <section className="shiny-inv-final-card">
      <div className="shiny-inv-final-title"><div><h3>Top 5 singles por valor</h3><p>Valor de inventario calculado por costo × existencias.</p></div></div>
      <div className="shiny-inv-final-top">
        {shinyInventoryFinal.top.length ? shinyInventoryFinal.top.map((item,i)=>
          <div key={`${item.sku}-${i}`}>
            <span>{String(i+1).padStart(2,'0')}</span>
            <div><strong>{item.name}</strong><small>{item.sku||item.category}</small></div>
            <b>{money(item.stock*item.cost)}</b>
          </div>
        ) : <div className="shiny-inv-final-empty">Sin singles para mostrar.</div>}
      </div>
    </section>
  </div>

  {inventoryCommercialEdit ? <section className="proposal-a-edit-card">
    <div className="proposal-a-section-title"><strong>Editar {inventoryCommercialEdit.carta}</strong><button type="button" className="secondary compact" onClick={()=>setInventoryCommercialEdit(null)}>Cerrar</button></div>
    <div className="proposal-a-edit-grid">
      <label>Costo<input type="number" min="0" step=".01" value={inventoryCommercialEdit.costo} onChange={(e)=>setInventoryCommercialEdit(x=>({...x,costo:e.target.value}))}/></label>
      <label>Precio<input type="number" min="0" step=".01" value={inventoryCommercialEdit.precio} onChange={(e)=>setInventoryCommercialEdit(x=>({...x,precio:e.target.value}))}/></label>
      <label>Oferta<input type="number" min="0" step=".01" value={inventoryCommercialEdit.precio_oferta} onChange={(e)=>setInventoryCommercialEdit(x=>({...x,precio_oferta:e.target.value}))}/></label>
      <label>Estado<select value={inventoryCommercialEdit.estado_venta} onChange={(e)=>setInventoryCommercialEdit(x=>({...x,estado_venta:e.target.value}))}><option value="DISPONIBLE">DISPONIBLE</option><option value="NO_DISPONIBLE">NO DISPONIBLE</option><option value="PAUSADO">PAUSADO</option></select></label>
      <button type="button" disabled={inventoryCommercialBusy} onClick={saveInventoryCommercial}>{inventoryCommercialBusy?'Guardando...':'Guardar'}</button>
    </div>
  </section> : null}

  <section className="shiny-inv-final-card shiny-inv-final-list">
    <div className="shiny-inv-final-title">
      <div><h3>Listado de inventario</h3><p>Existencias filtradas.</p></div>
      <span>{shinyInventoryFinal.rows.length} singles</span>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Tipo</th><th>Carta</th><th>SKU</th><th>Rareza</th><th>Stock</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {tcg_store_templateVisibleInventory.map((x,i)=><tr key={`${x.row_id}-${x.id_sucursal||i}`}><td>SINGLE</td><td><strong>{x.carta||x.id_carta}</strong></td><td>{x.sku}</td><td>{x.rareza||'Single TCG'}</td><td><strong>{x.stock??0}</strong></td><td>{money(x.precio)}</td><td>{x.estado_venta||'DISPONIBLE'}</td><td><button type="button" className="secondary compact" onClick={()=>editInventoryCommercial(x)}>Editar</button></td></tr>)}
        </tbody>
      </table>
    </div>
    {!tcg_store_templateVisibleInventory.length?<div className="public-empty">No hay singles para estos filtros.</div>:null}
  </section>
</div> : null}
{tab === 'entry' ? <div className="tcg-body proposal-a-reception">
        <div className="proposal-a-module-head"><div><span className="eyebrow">RECEPCIÓN</span><h2>Recepción TCG</h2></div></div>
        <div className="proposal-a-switch"><button type="button" className={entryMode==='individual'?'active':''} onClick={()=>setEntryMode('individual')}>Individual</button><button type="button" className={entryMode==='bulk'?'active':''} onClick={()=>setEntryMode('bulk')}>Masiva</button></div>

        {entryMode === 'individual' ? <section className="proposal-a-reception-card shiny-manual-r4-card">
          <div className="proposal-a-section-title">
            <div>
              <span className="eyebrow">RECEPCIÓN</span>
              <strong>Recepción individual</strong>
              <span>Registra una carta manualmente. Buscar en internet es opcional.</span>
            </div>

          </div>

          <div className="shiny-manual-r4-note">
            <b>CAPTURA MANUAL</b>
            <span>No necesitas buscar la carta en internet. Si no existe en GMX, se crea en el catálogo local al registrar la recepción.</span>
          </div>

          <div className="shiny-manual-r4-section shiny-r14-identify-section">
            <div className="shiny-r14-section-head">
              <div>
                <h3>1. Identificar carta</h3>
                <p>Selecciona el TCG y escribe el nombre de la expansión para encontrarla rápidamente.</p>
              </div>
            </div>

            <div className="shiny-r14-expansion-help">
              <b>BUSCADOR DE EXPANSIONES</b>
              <span>El catálogo permanece oculto hasta que escribas. Ejemplo: <strong>L</strong> muestra las expansiones que empiezan con L; <strong>Lo</strong> reduce a las que empiezan con Lo; y así sucesivamente.</span>
            </div>

            <div className="proposal-a-form-grid shiny-manual-r4-grid shiny-r14-identify-grid">
              <label className="shiny-r14-tcg-field">TCG *
                <select value={entryGameFilter} onChange={(e)=>{setEntryGameFilter(e.target.value);setExpansionSearchR13('');setExpansionOpenR13(false);setEntrySetFilter('');setEntry((x)=>({...x,id_carta:''}));setManualReceptionR4((x)=>({...x,nombre:'',numero:'',rareza:'',tipo_carta:'',subtipo:'',artista:''}));setEntry((x)=>({...x,id_carta:'',edicion:''}));setCardVariantR16('');setCardTypeR16('');setCardAttributeR16('');setManualFieldModeR10({rareza:false,tipo:false,subtipo:false,artista:false,edicion:false});}}>
                  <option value="">Selecciona TCG</option>
                  {(Array.isArray(games)?games:[]).map((g)=><option key={g.row_id||g.id_juego} value={g.id_juego}>{g.nombre}</option>)}
                </select>
              </label>

              <label className="shiny-r14-expansion-field">Expansión / Set *
                <div className="shiny-r13-expansion-search">
                  <input
                    value={expansionSearchR13}
                    disabled={!entryGameFilter || expansionSelectBusyR13}
                    autoComplete="off"
                    placeholder={
                      !entryGameFilter
                        ? 'Selecciona TCG primero'
                        : masterExpansionLoadingR13
                          ? 'Cargando expansiones...'
                          : 'Escribe para buscar expansión'
                    }
                    onFocus={()=>{
                      if(String(expansionSearchR13||'').trim()) setExpansionOpenR13(true);
                    }}
                    onChange={(e)=>{
                      const value=e.target.value;
                      setExpansionSearchR13(value);
                      setExpansionOpenR13(Boolean(String(value||'').trim()));

                      /* Al modificar la búsqueda, la expansión anterior
                         deja de considerarse seleccionada hasta elegir
                         una coincidencia del catálogo. */
                      setEntrySetFilter('');
                      setEntry((x)=>({...x,id_carta:''}));
                      setManualSetModeR8(false);
                      setManualSetNameR8('');
                    }}
                    onKeyDown={(e)=>{
                      if(e.key==='Escape'){
                        setExpansionOpenR13(false);
                        e.currentTarget.blur();
                      }
                      if(e.key==='Enter' && expansionMatchesR13.length===1){
                        e.preventDefault();
                        selectExpansionR13(expansionMatchesR13[0]);
                      }
                    }}
                  />

                  {expansionOpenR13 && String(expansionSearchR13||'').trim() ? (
                    <div className="shiny-r13-expansion-results">
                      {masterExpansionLoadingR13 ? (
                        <div className="shiny-r13-expansion-status">Cargando catálogo de expansiones...</div>
                      ) : expansionMatchesR13.length ? (
                        expansionMatchesR13.map((s)=>(
                          <button
                            type="button"
                            key={`${s._sourceR13||''}-${s.id_set||s.row_id||s.codigo||s.nombre}`}
                            onMouseDown={(e)=>e.preventDefault()}
                            onClick={()=>selectExpansionR13(s)}
                            disabled={expansionSelectBusyR13}
                          >
                            <span>{s.nombre}</span>
                            {s.codigo ? <small>{s.codigo}</small> : null}
                          </button>
                        ))
                      ) : (
                        <div className="shiny-r13-expansion-status">
                          No hay expansiones que comiencen con “{expansionSearchR13}”.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>


              </label>
              <label className="wide shiny-r14-card-name">Nombre exacto de la carta *
                <input value={manualReceptionR4.nombre} onChange={(e)=>{setManualReceptionR4((x)=>({...x,nombre:e.target.value}));setEntry((x)=>({...x,id_carta:''}));}} placeholder="Ej. D.Human"/>
                <small>Se guarda exactamente como lo escribes. GMX no cambia ni interpreta el nombre.</small>
              </label>

              <label>Número / código
                <input value={manualReceptionR4.numero} onChange={(e)=>{setManualReceptionR4((x)=>({...x,numero:e.target.value}));setEntry((x)=>({...x,id_carta:''}));}} placeholder="Ej. OP07-093"/>
              </label>

              <label>Rareza *
                <select
                  value={manualFieldModeR10.rareza?'__ADD_MANUAL__':manualReceptionR4.rareza}
                  disabled={!entryGameFilter}
                  onChange={(e)=>{
                    const v=e.target.value;
                    if(v==='__ADD_MANUAL__'){
                      setManualFieldModeR10((x)=>({...x,rareza:true}));
                      setManualReceptionR4((x)=>({...x,rareza:''}));
                    }else{
                      setManualFieldModeR10((x)=>({...x,rareza:false}));
                      setManualReceptionR4((x)=>({...x,rareza:v}));
                    }
                  }}
                >
                  <option value="">{!entryGameFilter?'Selecciona TCG primero':'Selecciona rareza'}</option>
                  {manualReceptionRaritiesR5.map((r)=><option key={r.row_id||r.id_rareza||r.nombre} value={r.nombre}>{r.nombre}{r.codigo && String(r.codigo)!==String(r.nombre)?` · ${r.codigo}`:''}</option>)}
                  <option value="__ADD_MANUAL__">+ Agregar rareza manualmente</option>
                </select>
                {manualFieldModeR10.rareza ? <input
                  autoFocus
                  value={manualReceptionR4.rareza}
                  onChange={(e)=>setManualReceptionR4((x)=>({...x,rareza:e.target.value}))}
                  placeholder="Nombre exacto de la rareza"
                /> : null}
                <small>Si no existe, agrégala manualmente. Quedará asociada a este TCG.</small>
              </label>


              {/* SHINY_TCG_RECEPCION_REGLAS_ESTRICTAS_R16 */}
              <label>Tipo de carta
                <select value={manualReceptionR4.tipo_carta} disabled={!entryGameFilter}
                  onChange={(e)=>{
                    const category=e.target.value;
                    setCardVariantR16('');
                    setCardTypeR16('');
                    setCardAttributeR16('');
                    setManualReceptionR4((x)=>({...x,tipo_carta:category,subtipo:''}));
                  }}>
                  <option value="">{!entryGameFilter?'Selecciona TCG primero':'Selecciona tipo de carta'}</option>
                  {strictCategoriesR16.map((v)=><option key={v} value={v}>{v}</option>)}
                </select>
                <small>Solo categorías válidas para {manualReceptionGameR11?.nombre||'el TCG seleccionado'}.</small>
              </label>

              <label>Variante
                <select
                  value={cardVariantR16}
                  disabled={!manualReceptionR4.tipo_carta || !strictVariantsR16.length}
                  onChange={(e)=>{
                    const v=e.target.value;
                    setCardVariantR16(v);
                    setManualReceptionR4((x)=>({...x,subtipo:serializeClassificationR16({variant:v,type:cardTypeR16,attribute:cardAttributeR16})}));
                  }}>
                  <option value="">{!manualReceptionR4.tipo_carta?'Selecciona tipo de carta primero':'Selecciona variante'}</option>
                  {strictVariantsR16.map((v)=><option key={v} value={v}>{v}</option>)}
                </select>
                <small>Ej.: Effect Monster, Fusion Monster, Stage 1, Ground Unit, etc.</small>
              </label>

              <label>Tipo
                <select
                  value={cardTypeR16}
                  disabled={!manualReceptionR4.tipo_carta || !strictTypesR16.length}
                  onChange={(e)=>{
                    const v=e.target.value;
                    setCardTypeR16(v);
                    setManualReceptionR4((x)=>({...x,subtipo:serializeClassificationR16({variant:cardVariantR16,type:v,attribute:cardAttributeR16})}));
                  }}>
                  <option value="">{strictTypesR16.length?'Selecciona tipo':'No aplica para esta categoría'}</option>
                  {strictTypesR16.map((v)=><option key={v} value={v}>{v}</option>)}
                </select>
                <small>Relacionado estrictamente con el tipo de carta seleccionado.</small>
              </label>

              <label>Atributo
                <select
                  value={cardAttributeR16}
                  disabled={!manualReceptionR4.tipo_carta || !strictAttributesR16.length}
                  onChange={(e)=>{
                    const v=e.target.value;
                    setCardAttributeR16(v);
                    setManualReceptionR4((x)=>({...x,subtipo:serializeClassificationR16({variant:cardVariantR16,type:cardTypeR16,attribute:v})}));
                  }}>
                  <option value="">{strictAttributesR16.length?'Selecciona atributo':'No aplica para esta categoría'}</option>
                  {strictAttributesR16.map((v)=><option key={v} value={v}>{v}</option>)}
                </select>
                <small>Atributos válidos únicamente para esa categoría del TCG.</small>
              </label>

              <label>Edición
                <select value={entry.edicion} disabled={!entryGameFilter}
                  onChange={(e)=>setEntry((x)=>({...x,edicion:e.target.value}))}>
                  <option value="">{!entryGameFilter?'Selecciona TCG primero':'Selecciona edición'}</option>
                  {strictEditionsR16.map((v)=><option key={v} value={v}>{v}</option>)}
                </select>
                <small>Ediciones válidas para el TCG seleccionado.</small>
              </label>

            </div>
          </div>

          <div className="shiny-manual-r4-section shiny-r15-inventory-section">
            <div className="shiny-r15-section-head">
              <div>
                <h3>2. Datos del ejemplar / inventario</h3>
                <p>Captura el estado físico, cantidades, costos y datos comerciales del ejemplar que entra a inventario.</p>
              </div>
            </div>

            <div className="proposal-a-form-grid shiny-manual-r4-grid shiny-r15-inventory-grid">
              <label>Idioma
                <select value={entry.idioma} onChange={(e)=>setEntry((x)=>({...x,idioma:e.target.value}))}>
                  <option>ES</option><option>EN</option><option>JP</option>
                </select>
              </label>
              <label>Condición
                <select value={entry.condicion} onChange={(e)=>setEntry((x)=>({...x,condicion:e.target.value}))}>
                  <option>NM</option><option>LP</option><option>MP</option><option>HP</option><option>DMG</option>
                </select>
              </label>
              <label>Acabado / variante
                <select value={entry.acabado} onChange={(e)=>setEntry((x)=>({...x,acabado:e.target.value}))}>
                  <option>NORMAL</option><option>HOLO</option><option>REVERSE_HOLO</option><option>FOIL</option>
                </select>
              </label>
              <label>Cantidad *<input type="number" min="1" value={entry.cantidad} onChange={(e)=>setEntry((x)=>({...x,cantidad:Number(e.target.value)}))}/></label>
              <label>Costo unitario (MXN) *<input type="number" min="0" step=".01" value={entry.costo_unitario} onChange={(e)=>setEntry((x)=>({...x,costo_unitario:Number(e.target.value)}))}/></label>
              <label>Precio tienda<input type="number" min="0" step=".01" value={entry.precio_venta} onChange={(e)=>setEntry((x)=>({...x,precio_venta:Number(e.target.value)}))}/></label>
              <label>Precio oferta<input type="number" min="0" step=".01" value={entry.precio_oferta} onChange={(e)=>setEntry((x)=>({...x,precio_oferta:Number(e.target.value)}))}/></label>
              <label>Sucursal
                <select value={entry.id_sucursal} onChange={(e)=>setEntry((x)=>({...x,id_sucursal:e.target.value}))}>
                  {(Array.isArray(branches)?branches:[]).map((b)=><option key={b.row_id||b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}
                </select>
              </label>
              <label>Proveedor / origen<input value={entry.origen_nombre} onChange={(e)=>setEntry((x)=>({...x,origen_nombre:e.target.value}))} placeholder="Proveedor / cliente"/></label>
              <label>Referencia / lote<input value={entry.origen_referencia} onChange={(e)=>setEntry((x)=>({...x,origen_referencia:e.target.value}))} placeholder="Factura, lote, compra..."/></label>

              <label className="check-label shiny-r15-graded-check">
                <input type="checkbox" checked={entry.graded} onChange={(e)=>setEntry((x)=>({...x,graded:e.target.checked}))}/> Graded
              </label>

              {entry.graded ? <>
                <label>Empresa grading<input value={entry.empresa_grading} onChange={(e)=>setEntry((x)=>({...x,empresa_grading:e.target.value}))}/></label>
                <label>Grado<input type="number" min="0" max="10" step=".1" value={entry.grado} onChange={(e)=>setEntry((x)=>({...x,grado:e.target.value}))}/></label>
                <label>Certificado<input value={entry.certificado} onChange={(e)=>setEntry((x)=>({...x,certificado:e.target.value}))}/></label>
              </> : null}

              <label className="wide shiny-r15-notes">Notas
                <textarea rows="3" maxLength="250" value={entry.notas} onChange={(e)=>setEntry((x)=>({...x,notas:e.target.value}))} placeholder="Notas adicionales"/>
              </label>
            </div>

            <button className="proposal-a-primary-wide shiny-manual-r4-register" onClick={receiveManualR4}>Registrar recepción manual</button>
          </div>

        </section> : <section className="proposal-a-reception-card">
          <div className="proposal-a-section-title"><div><strong>Recepción masiva</strong><span>Importa inventario desde Excel.</span></div></div>
          <div className="proposal-a-bulk-steps"><article><b>1</b><span>Descargar plantilla</span></article><article><b>2</b><span>Completar filas</span></article><article><b>3</b><span>Validar</span></article><article><b>4</b><span>Procesar</span></article></div>
          <div className="proposal-a-bulk-actions"><button className="secondary" onClick={downloadReceiptTemplate}>Descargar plantilla</button><label className="file-btn">{receiptBulkBusy&&!receiptBulk?'Validando':'Seleccionar archivo'}<input type="file" accept=".xlsx,.xls" disabled={receiptBulkBusy} onChange={(e)=>e.target.files?.[0]&&prepareReceiptBulk(e.target.files[0])}/></label></div>
          {receiptBulk?<div className="proposal-a-bulk-validation"><div><span>Filas</span><strong>{receiptBulk.totalRows}</strong></div><div><span>Válidas</span><strong>{receiptBulk.validRows}</strong></div><div><span>Errores</span><strong>{receiptBulk.invalidRows}</strong></div><button onClick={runReceiptBulk} disabled={receiptBulkBusy||!receiptBulk.validRows}>{receiptBulkBusy?'Procesando':`Procesar ${receiptBulk.validRows} fila(s)`}</button></div>:null}
          {receiptBulkErrors.length?<details className="proposal-a-more"><summary>{receiptBulkErrors.length} fila(s) con observaciones</summary><div className="table-wrap"><table><thead><tr><th>Fila</th><th>Error</th></tr></thead><tbody>{receiptBulkErrors.slice(0,300).map((e,i)=><tr key={`${e.row}-${i}`}><td>{e.row}</td><td>{e.error}</td></tr>)}</tbody></table></div></details>:null}
        </section>}
        {visionOpen ? <VisionScannerModal open={true} title="Reconocer carta TCG" onClose={()=>setVisionOpen(false)} onResult={handleVisionTcgResult}/> : null}
        {visionPickerOpen ? <VisionCandidatePicker open={true} title="Selecciona la carta" subtitle="La foto identifica la carta; confirma después la variante física." items={Array.isArray(visionCandidates) ? visionCandidates : []} onClose={()=>setVisionPickerOpen(false)} onPick={pickVisionTcgCard}/> : null}
      </div> : null}

      {tab === 'mastercatalog' ? <div className="tcg-master-unified proposal-a-master-wrap">
        <TCGMasterCatalogBrowser onNavigate={setTab} />
        <details className="proposal-a-admin-details"><summary>Administración avanzada</summary><div className="proposal-a-admin-inner">
          <div className="tcg-master-admin-grid"><article><h4>{brandText("Agregar TCG a GMX")}</h4><label>TCG<select value={masterGameCode} onChange={(e)=>setMasterGameCode(e.target.value)}><option value="">Selecciona</option>{masterGames.map((g)=><option key={g.codigo} value={g.codigo}>{g.nombre}{g.agregado_tienda?' · ya agregado':''}</option>)}</select></label>{masterGameCode?<div className="tcg-master-summary"><span>{masterSets.length} expansiones</span><span>{masterRarities.length} rarezas</span></div>:null}<div className="tcg-master-actions"><button onClick={()=>activateMaster(masterGameCode,false)} disabled={!masterGameCode}>Agregar oculto</button><button onClick={()=>activateMaster(masterGameCode,true)} disabled={!masterGameCode}>Agregar y mostrar</button></div></article><article><h4>TCG publicados</h4><div className="tcg-game-toggle-grid tcg-game-toggle-compact">{games.map((g)=><div key={g.row_id} className="tcg-store-game-row"><span><strong>{g.nombre}</strong><small>{g.codigo||g.catalogo_codigo||g.id_juego}</small></span><label className="tcg-visible-toggle"><input type="checkbox" checked={g.visible_portal!==false} onChange={(e)=>setVisibility(g,e.target.checked)}/><span>{g.visible_portal!==false?'Visible':'Oculto'}</span></label></div>)}</div></article></div>
          <details className="proposal-a-more"><summary>Importación manual / mantenimiento</summary><div className="tcg-import-center tcg-import-center-inline"><section className="tcg-import-card"><h4>{brandText("Plantilla GMX")}</h4><button type="button" onClick={downloadDynamicTemplate}>Descargar plantilla</button></section><section className="tcg-import-card"><h4>Importar cartas</h4><label className="file-action">{importing?'Importando':'Seleccionar Excel'}<input type="file" accept=".xlsx,.xls" disabled={importing} onChange={(e)=>importExcel('cards',e.target.files?.[0])}/></label></section><section className="tcg-import-card"><h4>Actualizar estructura</h4><label className="file-action">{importing?'Importando':'Seleccionar Excel maestro'}<input type="file" accept=".xlsx,.xls" disabled={importing} onChange={(e)=>importExcel('master',e.target.files?.[0])}/></label></section></div></details>
        </div></details>
      </div> : null}

      {tab === 'autosync' ? <TCGAutoSyncPanel /> : null}

      {tab === 'acq' ? <div className="tcg-body proposal-a-history">
        <div className="proposal-a-module-head"><div><span className="eyebrow">HISTORIAL</span><h2>Historial de adquisiciones</h2></div><span>{proposalAFilteredAcquisitions.length} registros</span></div>
        <div className="proposal-a-history-filters"><div className="proposal-a-search-field"><span>?</span><input value={acqSearch} onChange={(e)=>setAcqSearch(e.target.value)} placeholder="Buscar ID, carta, SKU, sucursal..."/></div><select value={acqStatus} onChange={(e)=>setAcqStatus(e.target.value)}><option value="">Todos los estados</option><option value="COMPLETADA">Completada</option><option value="EN_PROCESO">En proceso</option><option value="CANCELADA">Cancelada</option></select></div>
        <div className="table-wrap proposal-a-table"><table><thead><tr><th>Fecha</th><th>ID</th><th>TCG</th><th>Proveedor</th><th>Carta</th><th>SKU</th><th>Sucursal</th><th>Cantidad</th><th>Estado</th><th>Total</th></tr></thead><tbody>{proposalAFilteredAcquisitions.map((a)=><tr key={a.row_id}><td>{a.fecha?new Date(a.fecha).toLocaleString('es-MX'):''}</td><td>{a.id_adquisicion}</td><td>{games.find((g)=>g.id_juego===a.id_juego)?.nombre||a.id_juego||''}</td><td>{a.origen_nombre||''}</td><td><strong>{a.carta}</strong></td><td>{a.sku}</td><td>{a.sucursal}</td><td>{a.cantidad}</td><td><span className="status active">{a.estado}</span></td><td>{money(a.costo_total)}</td></tr>)}</tbody></table></div>
      </div> : null}
    </section>
  </div>;
}
