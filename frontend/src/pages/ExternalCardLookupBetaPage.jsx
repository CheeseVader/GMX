import { brandText } from '../config/brand.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import '../externalCardLookupBeta.css';
import '../externalCardVisualR3.css';

const GAMES = [
  { id: 'POKEMON', label: 'Pokémon', source: 'Pokémon TCG API / TCGdex' },
  { id: 'YUGIOH', label: 'Yu-Gi-Oh!', source: 'YGOPRODeck' },
  { id: 'MAGIC', label: 'Magic: The Gathering', source: 'Scryfall' }
];
const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const FINISHES = ['NORMAL', 'HOLO', 'REVERSE_HOLO', 'FOIL'];
const CHUNK_RESOLVE = 500;
const CHUNK_INSTALL = 200;
const CHUNK_RECEIVE = 500;

function clean(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function identityKey(item) {
  return [item.game, item.source, item.external_id, item.set_code || item.set_name,
    item.collector_number, normalized(item.name), item.language || 'EN'].map(clean).join('|');
}

function money(value, currency = 'USD') {
  const number = Number(value);
  return Number.isFinite(number) ? `${currency === 'USD' ? '$' : ''}${number.toFixed(2)} ${currency}` : '—';
}

function imageSrc(value) {
  const url = clean(value);
  if (url.includes('assets.tcgdex.net') && !/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(url)) return `${url}/high.webp`;
  return url;
}

/* SHINY_OCR_IDENTITY_R14C */
function extractStrongIdentifiers(text) {
  const raw=String(text||'').toUpperCase();
  const found=new Set();
  const patterns=[
    /\b[A-Z]{1,8}\d{0,4}-\d{1,5}[A-Z]?\b/g,
    /\b\d{1,4}\s*\/\s*\d{1,4}\b/g,
    /\b[A-Z]{2,8}\d{2,8}\b/g
  ];
  for(const re of patterns) for(const m of raw.matchAll(re)) found.add(String(m[0]).replace(/\s+/g,''));
  return [...found];
}
function extractOcrQuery(text) {
  const ignored = /^(basic|stage|trainer|energy|pokemon|pokémon|spell|trap|monster|effect|atk|def|illustrator|illus|hp|first edition|1st edition)$/i;
  const lines = String(text || '').split(/\r?\n/)
    .map((line) => line.replace(/[^A-Za-z0-9À-ÿ'’:\- ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 3 && line.length <= 60);
  return lines.find((line) => !ignored.test(line)) || lines[0] || '';
}

function chunks(list, size) {
  const output = [];
  for (let index = 0; index < list.length; index += size) output.push(list.slice(index, index + size));
  return output;
}

function statusLabel(status) {
  if (status === 'INTERNET_IDENTIFIED') return 'Identificada en Internet';
  if (status === 'MATCHED') return 'Relacionado localmente';
  if (status === 'AMBIGUOUS') return 'Revisar identidad';
  if (status === 'NOT_FOUND') return 'Fuera del catálogo GMX';
  if (status === 'ERROR') return 'Error de enriquecimiento';
  return 'En cola';
}

function candidateIdentity(item) {
  return {
    key: identityKey(item), game: item.game, source: item.source, external_id: item.external_id,
    name: item.name, set_name: item.set_name, set_code: item.set_code,
    collector_number: item.collector_number, language: item.language || 'EN', rarity: item.rarity,
    type: item.type, description: item.description, image: item.image,
    source_url: item.raw_hint?.source_url || '', internet_prices: item.internet_prices || []
  };
}

function PricePanel({ resolution }) {
  if (!resolution) return <div className="visual-r2-empty">Selecciona una coincidencia del catálogo de Internet.</div>;
  if (resolution.status !== 'INTERNET_IDENTIFIED') return <div className={`visual-r2-resolution ${resolution.status?.toLowerCase()}`}>
    <strong>{statusLabel(resolution.status)}</strong>
    <span>{resolution.status === 'AMBIGUOUS' ? 'Hay más de una carta posible. No se creará producto automáticamente.' :
      'Sin coincidencia segura en el catálogo maestro actual. Sincroniza el set con el módulo TCG existente.'}</span>
  </div>;
  const price = resolution.preferred_price;
  const cache = resolution.price_cache || {};
  return <div className="visual-r2-enrichment">
    <div className="visual-r2-price-head">
      <div><span>Precio preferente desde Internet</span><strong>{money(price?.market, price?.currency)}</strong></div>
      <span className={cache.fresh ? 'fresh' : 'stale'}>{cache.fresh ? 'Vigente' : 'Pendiente de actualización'}</span>
    </div>
    <div className="visual-r2-price-grid">
      <div><span>Low</span><strong>{money(price?.low, price?.currency)}</strong></div>
      <div><span>Mid</span><strong>{money(price?.mid, price?.currency)}</strong></div>
      <div><span>High</span><strong>{money(price?.high, price?.currency)}</strong></div>
      <div><span>Market</span><strong>{money(price?.market, price?.currency)}</strong></div>
    </div>
    <p className="visual-r2-cache-note">
      {resolution.tcgplayer_prices?.length ? `TCGplayer por proveedor de Internet · ${resolution.tcgplayer_prices.length} variante(s)` :
        'El proveedor de Internet no entregó precio TCGplayer; se muestra otra fuente cuando existe.'}
      {' · '}Origen {cache.origin === 'INTERNET' ? 'Internet consultado ahora' : 'caché GMX'}.
    </p>
    <div className="visual-r2-id-grid">
      <div><span>Master Card ID local</span><strong>{resolution.master?.row_id || 'No existe localmente'}</strong></div>
      <div><span>TCGplayer productId</span><strong>{resolution.tcgplayer?.product_id || 'No guardado'}</strong></div>
      <div><span>TCGplayer SKU</span><strong>{resolution.tcgplayer?.sku || 'No guardado'}</strong></div>
      <div><span>Producto GMX</span><strong>{resolution.operational?.card?.id_carta || 'Aún no creado'}</strong></div>
    </div>
  </div>;
}

/* SHINY_EXTERNAL_REFERENCE_R13E */
function shinyExternalMarketplaceUrls(item,query){
  const name=String(item?.name||query||'').trim();
  const set=String(item?.set_code||item?.set_name||'').trim();
  const number=String(item?.collector_number||'').trim();
  const full=[name,set,number].filter(Boolean).join(' ').trim();
  const encoded=encodeURIComponent(full||name);

  return {
    tcgplayer:`https://www.tcgplayer.com/search/all/product?q=${encoded}&view=grid`,
    collectr:`https://www.collectr.com/search?query=${encoded}`
  };
}
export default function ExternalCardLookupBetaPage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  /* SHINY_YUGIOH_SET_CODE_R25 */
  const latestOcrIdentifiersR25 = useRef([]);
  const [mode, setMode] = useState('individual');
  const [game, setGame] = useState('YUGIOH');
  const [image, setImage] = useState('');
  const [query, setQuery] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [shinyRefOpen,setGmxRefOpen]=useState(false);
  const [shinyRefSource,setGmxRefSource]=useState('TCGplayer');
  const [shinyRefUrl,setGmxRefUrl]=useState('');
  const [shinyRefPrice,setGmxRefPrice]=useState('');
  const [shinyRefCondition,setGmxRefCondition]=useState('Near Mint');
  const [shinyRefVariant,setGmxRefVariant]=useState('');
  const [shinyRefSaved,setGmxRefSaved]=useState(null);
  const [resolution, setResolution] = useState(null);
  const [branches, setBranches] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [imageErrors, setImageErrors] = useState({});
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkResolveBusy, setBulkResolveBusy] = useState(false);
  const [entry, setEntry] = useState({
    id_sucursal: '', cantidad: 1, idioma: 'EN', condicion: 'NM', acabado: 'NORMAL', edicion: '',
    costo_unitario: 0, precio_venta: 0, precio_oferta: 0, origen_nombre: 'Búsqueda Visual',
    origen_referencia: '', notas: ''
  });
  const source = useMemo(() => GAMES.find((item) => item.id === game)?.source || '', [game]);
  const physicalCount = useMemo(() => bulkItems.reduce((sum, item) => sum + Number(item.count || 0), 0), [bulkItems]);

  useEffect(() => {
    api('/api/v1/branches?includeInactive=false').then((response) => {
      const list = response?.data || [];
      setBranches(list);
      setEntry((current) => ({ ...current, id_sucursal: current.id_sucursal || list[0]?.id_sucursal || '' }));
    }).catch(() => {});
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (mode !== 'bulk' || bulkResolveBusy) return undefined;
    const pending = bulkItems.filter((item) => item.resolve_status === 'PENDING').slice(0, CHUNK_RESOLVE);
    if (!pending.length) return undefined;
    const timer = window.setTimeout(() => resolveBulk(pending), 120);
    return () => window.clearTimeout(timer);
  }, [bulkItems, bulkResolveBusy, mode]);

  async function stopCamera() {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return setMessage('Este navegador no permite acceso directo a la cámara.');
    setCameraBusy(true);
    setMessage('');
    try {
      await stopCamera();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }
        } });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('CAMERA_NOT_READY');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
    } catch (error) {
      console.error(brandText('[GMX Visual TCG Camera]'), error);
      setMessage(error?.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : 'No fue posible abrir la cámara.');
    } finally {
      setCameraBusy(false);
    }
  }

  /* SHINY_CARD_FRAME_R15 */
  function prepareImage(img) {
    const ratio = 63 / 88;
    const sw = img.videoWidth || img.width;
    const sh = img.videoHeight || img.height;

    const maxHeight = sh * (img.videoWidth ? 0.68 : 0.86);
    const maxWidth = sw * (img.videoWidth ? 0.72 : 0.82);

    let ch = maxHeight;
    let cw = ch * ratio;

    if (cw > maxWidth) {
      cw = maxWidth;
      ch = cw / ratio;
    }

    const sx = Math.max(0, (sw - cw) / 2);
    const sy = Math.max(0, (sh - ch) / 2);

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / ch);
    canvas.width = Math.max(1, Math.round(cw * scale));
    canvas.height = Math.max(1, Math.round(ch * scale));

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.94);
  }

  /* SHINY_YUGIOH_ORIGINAL_UPLOAD_R26H2 */
  
  function cropDataUrlRegion(dataUrl, topRatio, heightRatio) {
    return new Promise((resolve, reject) => {
      const source = new Image();
      source.onload = () => {
        try {
          const sy = Math.max(0, Math.round(source.height * topRatio));
          const sh = Math.max(1, Math.round(source.height * heightRatio));
          const canvas = document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = Math.min(sh, source.height - sy);
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.drawImage(
            source,
            0, sy, source.width, canvas.height,
            0, 0, canvas.width, canvas.height
          );
          resolve(canvas.toDataURL('image/jpeg', 0.96));
        } catch (error) {
          reject(error);
        }
      };
      source.onerror = reject;
      source.src = dataUrl;
    });
  }

  /* SHINY_TITLE_PREPROCESS_R15B */
  function preprocessTitleZone(dataUrl) {
    return new Promise((resolve, reject) => {
      const source = new Image();

      source.onload = () => {
        try {
          const scale = 3;
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, source.width * scale);
          canvas.height = Math.max(1, source.height * scale);

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = frame.data;

          for (let i = 0; i < d.length; i += 4) {
            const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);

            // Moderate contrast expansion. It improves faded card titles
            // without applying OCR interpretation/autocorrection.
            let adjusted = (gray - 128) * 1.65 + 128;
            adjusted = Math.max(0, Math.min(255, adjusted));

            // Light threshold bias toward readable dark lettering.
            const value = adjusted < 150 ? Math.max(0, adjusted - 22) : Math.min(255, adjusted + 12);

            d[i] = value;
            d[i + 1] = value;
            d[i + 2] = value;
          }

          ctx.putImageData(frame, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };

      source.onerror = reject;
      source.src = dataUrl;
    });
  }

  /* SHINY_TITLE_FOCUS_R21 */
  function preprocessTitleFocusR21(dataUrl) {
    return new Promise((resolve, reject) => {
      const source = new Image();

      source.onload = () => {
        try {
          const scale = 4;
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, source.width * scale);
          canvas.height = Math.max(1, source.height * scale);

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = frame.data;

          for (let i = 0; i < d.length; i += 4) {
            const gray = Math.round(
              d[i] * 0.299 +
              d[i + 1] * 0.587 +
              d[i + 2] * 0.114
            );

            // Moderate local contrast only. No character interpretation.
            let adjusted = (gray - 128) * 1.85 + 128;
            adjusted = Math.max(0, Math.min(255, adjusted));

            const value =
              adjusted < 148
                ? Math.max(0, adjusted - 26)
                : Math.min(255, adjusted + 10);

            d[i] = value;
            d[i + 1] = value;
            d[i + 2] = value;
          }

          ctx.putImageData(frame, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };

      source.onerror = reject;
      source.src = dataUrl;
    });
  }

  /* SHINY_POKEMON_OCR_PROFILE_R22 */
  function cropDataUrlBoxR22(dataUrl, x1, y1, x2, y2) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        try {
          const sx = Math.max(0, Math.floor(img.width * x1));
          const sy = Math.max(0, Math.floor(img.height * y1));
          const sw = Math.max(1, Math.floor(img.width * (x2 - x1)));
          const sh = Math.max(1, Math.floor(img.height * (y2 - y1)));

          const canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = sh;

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function preprocessPokemonTitleR22(dataUrl) {
    return new Promise((resolve, reject) => {
      const source = new Image();

      source.onload = () => {
        try {
          const scale = 4;
          const canvas = document.createElement('canvas');

          canvas.width = Math.max(1, source.width * scale);
          canvas.height = Math.max(1, source.height * scale);

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(
            source,
            0, 0,
            canvas.width,
            canvas.height
          );

          const frame = ctx.getImageData(
            0, 0,
            canvas.width,
            canvas.height
          );

          const d = frame.data;

          for (let i = 0; i < d.length; i += 4) {
            const gray = Math.round(
              d[i] * 0.299 +
              d[i + 1] * 0.587 +
              d[i + 2] * 0.114
            );

            let adjusted = (gray - 128) * 1.75 + 128;
            adjusted = Math.max(0, Math.min(255, adjusted));

            d[i] = adjusted;
            d[i + 1] = adjusted;
            d[i + 2] = adjusted;
          }

          ctx.putImageData(frame, 0, 0);

          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };

      source.onerror = reject;
      source.src = dataUrl;
    });
  }

  /* SHINY_YUGIOH_SET_HINT_R26B */
  const latestYugiohSetHintR26B = useRef('');

  /* SHINY_YUGIOH_DEDICATED_CODE_OCR_R26E */
  async function preprocessYugiohCodeStripR26E(sourceDataUrl, scale=8, mode='contrast') {
    const img = await loadImage(sourceDataUrl);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));

    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;

    for(let i=0;i<d.length;i+=4){
      const gray = Math.round(
        d[i] * 0.299 +
        d[i+1] * 0.587 +
        d[i+2] * 0.114
      );

      let v = gray;

      if(mode === 'binary'){
        v = gray > 145 ? 255 : 0;
      }
      else if(mode === 'binary2'){
        v = gray > 175 ? 255 : 0;
      }
      else if(mode === 'invert'){
        v = 255 - gray;
      }
      else {
        // High contrast grayscale.
        v = Math.max(
          0,
          Math.min(
            255,
            Math.round((gray - 128) * 2.1 + 128)
          )
        );
      }

      d[i]=v;
      d[i+1]=v;
      d[i+2]=v;
      d[i+3]=255;
    }

    ctx.putImageData(image,0,0);
    return canvas.toDataURL('image/png');
  }

  function extractYugiohCodeCandidatesR26E(value) {
    const raw = String(value || '')
      .toUpperCase()
      .replace(/[‐‑‒–—−_]/g,'-');

    const exact = raw.match(
      /\b[A-Z0-9]{2,8}-[A-Z0-9]{2,10}\b/g
    ) || [];

    const compact = raw.match(
      /\b[A-Z0-9]{4,12}\b/g
    ) || [];

    return {
      exact:[...new Set(exact)],
      compact:[...new Set(
        compact.filter(v =>
          /[A-Z]/.test(v) &&
          /\d/.test(v)
        )
      )]
    };
  }

  /* SHINY_YUGIOH_LOWER_CODE_ZONE_R26F3 */
/* SHINY_YUGIOH_FULL_IMAGE_CODE_OCR_R26G */
async function readYugiohDedicatedCodeR26E(worker, sourceImage) {
  /*
   * R26G intentionally stops depending on one fixed card coordinate.
   * The uploaded image may contain borders/background, so normalized
   * coordinates of the source image are not necessarily normalized
   * coordinates of the physical card.
   *
   * Strategy:
   *   1) OCR the complete image.
   *   2) OCR broad lower areas only as additional evidence.
   *   3) Return exact codes if Tesseract really sees the hyphenated code.
   *   4) Return noisy/compact tokens only as provider hints.
   *
   * It never modifies the already-working card-name OCR.
   */

  const sources = [
    {name:'FULL', image:sourceImage, scale:4},
    {
      name:'LOWER_70',
      image:await cropDataUrlBoxR22(sourceImage,0.00,0.30,1.00,1.00),
      scale:5
    },
    {
      name:'LOWER_55',
      image:await cropDataUrlBoxR22(sourceImage,0.00,0.45,1.00,1.00),
      scale:6
    },
    {
      name:'RIGHT_LOWER',
      image:await cropDataUrlBoxR22(sourceImage,0.35,0.35,1.00,0.90),
      scale:7
    }
  ];

  const modes=['contrast','binary','binary2','invert'];
  const exact=[];
  const compact=[];
  const logs=[];

  try{
    await worker.setParameters({
      tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
      preserve_interword_spaces:'1',
      tessedit_pageseg_mode:'11'
    });

    for(const src of sources){
      for(const mode of modes){
        try{
          const prepared=await preprocessYugiohCodeStripR26E(
            src.image,
            src.scale,
            mode
          );

          const result=await worker.recognize(prepared);

          const txt=String(result?.data?.text || '')
            .toUpperCase()
            .replace(/\s+/g,' ')
            .trim();

          const parsed=extractYugiohCodeCandidatesR26E(txt);

          exact.push(...parsed.exact);
          compact.push(...parsed.compact);

          /*
           * Additional compact extraction is intentionally permissive,
           * but these values are HINTS ONLY. They are not accepted as
           * final collector numbers.
           */
          const extra=(txt.match(/\b[A-Z0-9]{4,14}\b/g) || [])
            .filter(t => /[A-Z]/.test(t) && /\d/.test(t));

          compact.push(...extra);

          logs.push(
            `[${src.name}/${mode}] ${txt || '(sin lectura)'}`,
            `EXACT=${parsed.exact.join(', ') || '—'}`,
            `HINT=${[...new Set([...parsed.compact,...extra])].join(', ') || '—'}`
          );
        }catch(err){
          logs.push(
            `[${src.name}/${mode}] ERROR=${String(err?.message || err)}`
          );
        }
      }
    }
  }finally{
    try{
      await worker.setParameters({
        tessedit_char_whitelist:'',
        preserve_interword_spaces:'0'
      });
    }catch{}
  }

  const cleanExact=[...new Set(
    exact.filter(code =>
      /^[A-Z0-9]{2,8}-[A-Z0-9]{2,10}$/.test(code)
    )
  )];

  const cleanCompact=[...new Set(
    compact
      .map(t => String(t || '').replace(/[^A-Z0-9]/g,''))
      .filter(t =>
        t.length >= 4 &&
        t.length <= 14 &&
        /[A-Z]/.test(t) &&
        /\d/.test(t)
      )
  )];

  return {
    exact:cleanExact,
    compact:cleanCompact,
    diagnostic:[
      '[R26G · YU-GI-OH! · OCR CODIGO SIN ZONA FIJA]',
      `EXACTOS=${cleanExact.join(', ') || '—'}`,
      `PISTAS=${cleanCompact.join(', ') || '—'}`,
      '',
      ...logs
    ].join('\n')
  };
}
  /* SHINY_YUGIOH_SET_CODE_MULTI_ZONE_R26C */
  function extractYugiohLooseTokensR26C(value) {
    const text = String(value || '').toUpperCase().replace(/[‐‑‒–—−]/g, '-');
    const tokens = text.match(/\b[A-Z0-9]{3,10}\b/g) || [];
    return [...new Set(tokens.filter(t =>
      /[A-Z]/.test(t) && /\d/.test(t) && !/^\d+$/.test(t)
    ))];
  }

  async function readYugiohSetCodeMultiZoneR26C(worker, sourceImage) {
    const zones = [
      { name:'Z1', x1:0.42, y1:0.48, x2:0.98, y2:0.60 },
      { name:'Z2', x1:0.42, y1:0.55, x2:0.98, y2:0.67 },
      { name:'Z3', x1:0.42, y1:0.62, x2:0.98, y2:0.74 }
    ];
    const strict=[], loose=[], diagnostics=[];
    for(const z of zones){
      const crop=await cropDataUrlBoxR22(sourceImage,z.x1,z.y1,z.x2,z.y2);
      const prep=await preprocessYugiohSetCodeR26(crop);
      const result=await worker.recognize(prep);
      const txt=String(result?.data?.text||'').trim();
      const s=extractYugiohSetCodesR26(txt);
      const l=extractYugiohLooseTokensR26C(txt);
      strict.push(...s); loose.push(...l);
      diagnostics.push(`[${z.name}]`,txt||'(sin lectura)',`STRICT=${s.join(', ')||'—'}`,`LOOSE=${l.join(', ')||'—'}`);
    }
    return {
      strict:[...new Set(strict)],
      loose:[...new Set(loose)],
      diagnostic:diagnostics.join('\n')
    };
  }
  /* SHINY_YUGIOH_SET_CODE_ZONE_R26 */
  function extractYugiohSetCodesR26(value) {
    const text = String(value || '')
      .toUpperCase()
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    const matches = text.match(
      /\b[A-Z0-9]{2,8}-[A-Z0-9]{2,8}\b/g
    ) || [];

    return [
      ...new Set(
        matches.filter((code) =>
          /[A-Z]/.test(code) &&
          /\d/.test(code)
        )
      )
    ];
  }

  function preprocessYugiohSetCodeR26(dataUrl) {
    return new Promise((resolve, reject) => {
      const source = new Image();

      source.onload = () => {
        try {
          const scale = 5;

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, source.width * scale);
          canvas.height = Math.max(1, source.height * scale);

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(
            source,
            0,
            0,
            canvas.width,
            canvas.height
          );

          const frame = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );

          const d = frame.data;

          for (let i = 0; i < d.length; i += 4) {
            const gray = Math.round(
              d[i] * 0.299 +
              d[i + 1] * 0.587 +
              d[i + 2] * 0.114
            );

            let adjusted = (gray - 128) * 2.1 + 128;
            adjusted = Math.max(0, Math.min(255, adjusted));

            const out =
              adjusted < 155
                ? Math.max(0, adjusted - 34)
                : Math.min(255, adjusted + 14);

            d[i] = out;
            d[i + 1] = out;
            d[i + 2] = out;
          }

          ctx.putImageData(frame, 0, 0);

          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };

      source.onerror = reject;
      source.src = dataUrl;
    });
  }

  
  /* SHINY_OFFICIAL_NAME_CLEANUP_R21 */
  function normalizeOfficialNameR21(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function confirmedOfficialNameR21(ocrValue, officialValue) {
    const ocr = normalizeOfficialNameR21(ocrValue);
    const official = normalizeOfficialNameR21(officialValue);

    if (!ocr || !official) return false;
    if (official.replace(/\s/g, '').length < 4) return false;

    // Safe rule: the complete normalized official name must occur
    // literally as a contiguous phrase inside the OCR clue.
    return (` ${ocr} `).includes(` ${official} `);
  }

  function titleCandidateScoreR15B(value) {
    const text = String(value || '').trim();
    if (!text) return -999;

    let score = 0;
    if (/[A-Za-zÀ-ÿ]/.test(text)) score += 20;
    if (text.length >= 3 && text.length <= 34) score += 20;
    if (/^[A-Za-zÀ-ÿ0-9.'’:\- ]+$/.test(text)) score += 10;
    if (/[.'’:\-]/.test(text)) score += 3;
    if (/^[0-9\s/+\-.:]+$/.test(text)) score -= 60;
    if (/\b(ATK|DEF|HP|SPELL|TRAP|WARRIOR|DRAGON|MACHINE|EFFECT)\b/i.test(text)) score -= 20;

    return score;
  }

  /* SHINY_TITLE_CLEANUP_R15C */
  /* SHINY_MINIMUM_READABLE_AREA_R16 */
  /* SHINY_OCR_CONSENSUS_R17 */
  function preprocessTitleZoneBinaryR17(dataUrl) {
    return new Promise((resolve, reject) => {
      const source = new Image();

      source.onload = () => {
        try {
          const scale = 3;
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, source.width * scale);
          canvas.height = Math.max(1, source.height * scale);

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = frame.data;

          for (let i = 0; i < d.length; i += 4) {
            const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);

            // Adaptive-like fixed split suitable for faded beige/yellow title bars.
            // This is image preprocessing only; it does not correct text.
            const value = gray < 158 ? 24 : 242;

            d[i] = value;
            d[i + 1] = value;
            d[i + 2] = value;
          }

          ctx.putImageData(frame, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };

      source.onerror = reject;
      source.src = dataUrl;
    });
  }

  function consensusTokenKeyR17(token) {
    return String(token || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function consensusTokensR17(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((literal) => ({ literal, key: consensusTokenKeyR17(literal) }))
      .filter((item) => item.key);
  }

  function longestSharedRunR17(aValue, bValue) {
    const a = consensusTokensR17(aValue);
    const b = consensusTokensR17(bValue);

    let best = { count: 0, chars: 0, literals: [] };

    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        let k = 0;

        while (
          i + k < a.length &&
          j + k < b.length &&
          a[i + k].key === b[j + k].key
        ) {
          k++;
        }

        if (!k) continue;

        const literals = a.slice(i, i + k).map((item) => item.literal);
        const chars = literals.join(' ').replace(/\s+/g, '').length;

        if (
          k > best.count ||
          (k === best.count && chars > best.chars)
        ) {
          best = { count: k, chars, literals };
        }
      }
    }

    return {
      ...best,
      value: best.literals.join(' ').trim()
    };
  }

  function titleConsensusR17(values) {
    const candidates = values
      .map((value) => cleanPrimaryTitleR15C(value))
      .filter(Boolean);

    if (!candidates.length) {
      return { ok: false, value: '', votes: 0, reason: 'NO_CANDIDATES' };
    }

    // Exact literal agreement always wins.
    for (let i = 0; i < candidates.length; i++) {
      const key = consensusTokensR17(candidates[i]).map((item) => item.key).join(' ');
      if (!key) continue;

      let votes = 0;
      for (const other of candidates) {
        const otherKey = consensusTokensR17(other).map((item) => item.key).join(' ');
        if (otherKey === key) votes++;
      }

      if (votes >= 2) {
        return { ok: true, value: candidates[i], votes, reason: 'EXACT_AGREEMENT' };
      }
    }

    // Otherwise find the longest literal token sequence shared by any pair.
    let best = { count: 0, chars: 0, value: '', votes: 0 };

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const shared = longestSharedRunR17(candidates[i], candidates[j]);
        if (!shared.value) continue;

        const sharedKey = consensusTokensR17(shared.value).map((item) => item.key).join(' ');
        let votes = 0;

        for (const candidate of candidates) {
          const tokenKeys = consensusTokensR17(candidate).map((item) => item.key);
          const target = sharedKey.split(' ').filter(Boolean);

          for (let start = 0; start <= tokenKeys.length - target.length; start++) {
            const slice = tokenKeys.slice(start, start + target.length).join(' ');
            if (slice === sharedKey) {
              votes++;
              break;
            }
          }
        }

        if (
          votes >= 2 &&
          (
            shared.count > best.count ||
            (shared.count === best.count && shared.chars > best.chars)
          )
        ) {
          best = { ...shared, votes };
        }
      }
    }

    const clean = cleanPrimaryTitleR15C(best.value);

    // A one-token consensus is acceptable only when it has enough characters.
    const enoughSubstance =
      best.count >= 2 ||
      (best.count === 1 && clean.replace(/[^A-Za-z0-9À-ÿ]/g, '').length >= 4);

    return {
      ok: Boolean(clean) && best.votes >= 2 && enoughSubstance,
      value: clean,
      votes: best.votes,
      reason: enoughSubstance ? 'SHARED_LITERAL_SEQUENCE' : 'CONSENSUS_TOO_SHORT'
    };
  }
  function titleReadabilityR16(result, candidate, imageWidth, imageHeight) {
    const data = result?.data || {};
    const words = Array.isArray(data.words) ? data.words : [];
    const useful = words.filter((word) => {
      const text = String(word?.text || '').trim();
      const confidence = Number(word?.confidence ?? word?.conf ?? 0);
      return text.length >= 1 && confidence >= 20 && word?.bbox;
    });

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const word of useful) {
      const box = word.bbox || {};
      const x0 = Number(box.x0 ?? box.left ?? 0);
      const y0 = Number(box.y0 ?? box.top ?? 0);
      const x1 = Number(box.x1 ?? box.right ?? x0);
      const y1 = Number(box.y1 ?? box.bottom ?? y0);
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }

    const hasBox = Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX && maxY > minY;
    const widthRatio = hasBox && imageWidth > 0 ? (maxX - minX) / imageWidth : 0;
    const heightRatio = hasBox && imageHeight > 0 ? (maxY - minY) / imageHeight : 0;

    const confidence = Number(data.confidence ?? 0);
    const cleanCandidate = String(candidate || '').trim();

    // Minimum readable area:
    // - title should span at least 18% of title-strip width
    // - detected glyph height at least 7% of title-strip height
    // - OCR confidence >= 35
    // If bbox data is unavailable, use conservative confidence + title length fallback.
    const geometryOk = hasBox ? (widthRatio >= 0.18 && heightRatio >= 0.07) : cleanCandidate.length >= 4;
    const confidenceOk = confidence >= 35;
    const lengthOk = cleanCandidate.length >= 3;

    return {
      ok: geometryOk && confidenceOk && lengthOk,
      widthRatio,
      heightRatio,
      confidence,
      hasBox,
      candidate: cleanCandidate
    };
  }
  function cleanPrimaryTitleR15C(value) {
    let text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return '';

    // Preserve the literal title and only trim obvious OCR tail noise.
    // Examples:
    // "D. HUMAN bt I" -> "D. HUMAN"
    // "D. HUMAN bt1"  -> "D. HUMAN"
    // "D. HUMAN BI I" -> "D. HUMAN"
    //
    // Do NOT autocorrect the actual title characters.
    const tokens = text.split(' ').filter(Boolean);

    const isNoiseToken = (token) => {
      const t = String(token || '').trim();

      if (!t) return true;

      // Typical short OCR debris produced near icons/levels.
      if (/^(bt|bti|bt1|bi|b1|i|l|1)$/i.test(t)) return true;

      // Isolated 1-character alphanumeric debris.
      if (/^[A-Za-z0-9]$/.test(t)) return true;

      return false;
    };

    // Only remove noise from the END. Never remove words inside the title.
    while (tokens.length >= 2 && isNoiseToken(tokens[tokens.length - 1])) {
      tokens.pop();
    }

    // Special paired suffixes like "bt I", "bt 1", "bi I".
    while (
      tokens.length >= 3 &&
      /^(bt|bi|b1)$/i.test(tokens[tokens.length - 2]) &&
      /^(i|l|1)$/i.test(tokens[tokens.length - 1])
    ) {
      tokens.splice(tokens.length - 2, 2);
    }

    text = tokens.join(' ').trim();

    // Final conservative suffix cleanup, end-only.
    text = text
      .replace(/\s+(?:bt|bi|b1)\s*(?:i|l|1)?$/i, '')
      .trim();

    return text;
  }
  function bestLiteralTitleR15B(text) {
    const ignored = /^(basic|stage|trainer|energy|pokemon|pokémon|spell|trap|monster|effect|atk|def|illustrator|illus|hp|first edition|1st edition)$/i;

    const candidates = String(text || '')
      .split(/\r?\n/)
      .map((line) => line
        .replace(/[|[\]{}<>]/g, ' ')
        .replace(/[^A-Za-z0-9À-ÿ.'’:\- ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim())
      .filter((line) => line.length >= 2 && line.length <= 60)
      .filter((line) => !ignored.test(line))
      .map((line) => ({ line, score: titleCandidateScoreR15B(line) }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.score > 0 ? candidates[0].line : '';
  }
  function extractLiteralCardNameR15(text) {
    const ignored = /^(basic|stage|trainer|energy|pokemon|pokémon|spell|trap|monster|effect|atk|def|illustrator|illus|hp|first edition|1st edition)$/i;

    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line
        .replace(/[|[\]{}<>]/g, ' ')
        .replace(/[^A-Za-z0-9À-ÿ.'’:\- ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim())
      .filter((line) => line.length >= 2 && line.length <= 60);

    for (const line of lines) {
      if (ignored.test(line)) continue;
      if (/^[0-9\s/+\-.:]+$/.test(line)) continue;
      if (!/[A-Za-zÀ-ÿ]/.test(line)) continue;
      return line;
    }

    return '';
  }

  /* SHINY_AUTO_IDENTIFY_R20 */
  /* SHINY_CAMERA_ONLY_R28B */
  async function capturePhoto() {
    if (!videoRef.current?.videoWidth) return setMessage('La cámara todavía no está lista.');

    const preparedImage = prepareImage(videoRef.current);

    setImage(preparedImage);
    setQuery('');
    clearIdentification();
    setMessage('Foto capturada. Analizando automáticamente…');

    await stopCamera();
    await search('photo', preparedImage, 'camera');
  }

  
  function clearIdentification() {
    setRows([]); setSelected(null); setResolution(null); setOcrText(''); setImageErrors({});
  }

  /* SHINY_OCR_CATALOG_CLUE_R19B */
  function bestCatalogClueR19B(values) {
    const usable = values
      .map((value)=>cleanPrimaryTitleR15C(String(value||'').trim()))
      .filter((value)=>
        value.replace(/[^A-Za-z0-9À-ÿ]/g,'').length>=4
      );

    if(!usable.length)return '';

    // Prefer readings with more letters, then shorter total text.
    usable.sort((a,b)=>{
      const aLetters=(a.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
      const bLetters=(b.match(/[A-Za-zÀ-ÿ]/g)||[]).length;

      if(aLetters!==bLetters)return bLetters-aLetters;
      return a.length-b.length;
    });

    return usable[0];
  }
  async function runOcr(
    silent = false,
    imageOverride = null,
    sourceMode = 'camera'
  ) {
    const sourceImage = imageOverride || image;
    if (!sourceImage) return '';
    setOcrBusy(true);
    if (!silent) setMessage('Validando encuadre y buscando consenso entre lecturas OCR…');

    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');


      const rawNameZone = await cropDataUrlRegion(sourceImage, 0.01, 0.20);
      const enhancedNameZone = await preprocessTitleZone(rawNameZone);
      const binaryNameZone = await preprocessTitleZoneBinaryR17(rawNameZone);

      // R21: narrower title strip, digitally enlarged.
      // The user can keep the entire card inside the normal frame.
      const focusRawNameZone = await cropDataUrlRegion(sourceImage, 0.015, 0.115);
      const focusNameZone = await preprocessTitleFocusR21(focusRawNameZone);

      let pokemonNameZoneR22 = null;

      if (game === 'POKEMON') {
        const pokemonRawNameZoneR22 = await cropDataUrlBoxR22(
          sourceImage,
          0.04,
          0.012,
          0.78,
          0.135
        );

        pokemonNameZoneR22 = await preprocessPokemonTitleR22(
          pokemonRawNameZoneR22
        );
      }

      const enhancedResult = await worker.recognize(enhancedNameZone);
      const enhancedText = String(enhancedResult?.data?.text || '').trim();

      const rawNameResult = await worker.recognize(rawNameZone);
      const rawNameText = String(rawNameResult?.data?.text || '').trim();

      const binaryResult = await worker.recognize(binaryNameZone);
      const binaryText = String(binaryResult?.data?.text || '').trim();

      const focusResult = await worker.recognize(focusNameZone);
      const focusText = String(focusResult?.data?.text || '').trim();

      let pokemonResultR22 = null;
      let pokemonTextR22 = '';

      if (game === 'POKEMON' && pokemonNameZoneR22) {
        pokemonResultR22 = await worker.recognize(pokemonNameZoneR22);
        pokemonTextR22 = String(
          pokemonResultR22?.data?.text || ''
        ).trim();
      }

      const fullResult = await worker.recognize(sourceImage);
      const fullText = String(fullResult?.data?.text || '').trim();

      if (game === 'YUGIOH') {
        /* R26B: preserve full OCR as noisy set-code clue */
        latestYugiohSetHintR26B.current = String(fullText || '');

        const cameraDedicatedR26E =
          await readYugiohDedicatedCodeR26E(
            worker,
            sourceImage
          );

        const cameraMultiSetR26C =
          await readYugiohSetCodeMultiZoneR26C(
            worker,
            sourceImage
          );

        latestOcrIdentifiersR25.current =
          cameraDedicatedR26E.exact.length
            ? cameraDedicatedR26E.exact
            : cameraMultiSetR26C.strict;

        latestYugiohSetHintR26B.current = [
          String(fullText || ''),
          ...cameraDedicatedR26E.compact,
          ...cameraMultiSetR26C.loose
        ].filter(Boolean).join('\n');
      } else {
        latestOcrIdentifiersR25.current = [];
      }

      await worker.terminate();

      const enhancedCandidate = cleanPrimaryTitleR15C(bestLiteralTitleR15B(enhancedText));
      const rawCandidate = cleanPrimaryTitleR15C(bestLiteralTitleR15B(rawNameText));
      const binaryCandidate = cleanPrimaryTitleR15C(bestLiteralTitleR15B(binaryText));
      const focusCandidate = cleanPrimaryTitleR15C(bestLiteralTitleR15B(focusText));

      const pokemonCandidateR22 =
        game === 'POKEMON'
          ? cleanPrimaryTitleR15C(
              bestLiteralTitleR15B(pokemonTextR22)
            )
          : '';

      const dimensions = async (dataUrl) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = reject;
        img.src = dataUrl;
      });

      const enhancedSize = await dimensions(enhancedNameZone);
      const rawSize = await dimensions(rawNameZone);
      const binarySize = await dimensions(binaryNameZone);
      const focusSize = await dimensions(focusNameZone);

      const pokemonSizeR22 =
        game === 'POKEMON' && pokemonNameZoneR22
          ? await dimensions(pokemonNameZoneR22)
          : { width: 0, height: 0 };

      const enhancedQuality = titleReadabilityR16(
        enhancedResult,
        enhancedCandidate,
        enhancedSize.width,
        enhancedSize.height
      );

      const rawQuality = titleReadabilityR16(
        rawNameResult,
        rawCandidate,
        rawSize.width,
        rawSize.height
      );

      const binaryQuality = titleReadabilityR16(
        binaryResult,
        binaryCandidate,
        binarySize.width,
        binarySize.height
      );

      const focusQuality = titleReadabilityR16(
        focusResult,
        focusCandidate,
        focusSize.width,
        focusSize.height
      );

      const pokemonQualityR22 =
        game === 'POKEMON' && pokemonResultR22
          ? titleReadabilityR16(
              pokemonResultR22,
              pokemonCandidateR22,
              pokemonSizeR22.width,
              pokemonSizeR22.height
            )
          : {
              ok: false,
              confidence: 0
            };

      // Keep only candidates that individually passed R16 readability.
      const readableCandidates = [
        enhancedQuality.ok ? enhancedCandidate : '',
        rawQuality.ok ? rawCandidate : '',
        binaryQuality.ok ? binaryCandidate : '',
        focusQuality.ok ? focusCandidate : '',
        (
          game === 'POKEMON' &&
          pokemonQualityR22.ok
        )
          ? pokemonCandidateR22
          : ''
      ].filter(Boolean);

      const consensus = titleConsensusR17(readableCandidates);

      setOcrText([
        '[LECTURA 1 · CONTRASTE 3X]',
        enhancedText || '(sin lectura)',
        `Candidato: ${enhancedCandidate || '—'}`,
        `Confianza: ${Math.round(enhancedQuality.confidence || 0)}%`,
        `Calidad mínima R16: ${enhancedQuality.ok ? 'OK' : 'NO'}`,
        '',
        '[LECTURA 2 · ORIGINAL]',
        rawNameText || '(sin lectura)',
        `Candidato: ${rawCandidate || '—'}`,
        `Confianza: ${Math.round(rawQuality.confidence || 0)}%`,
        `Calidad mínima R16: ${rawQuality.ok ? 'OK' : 'NO'}`,
        '',
        '[LECTURA 3 · BINARIA 3X]',
        binaryText || '(sin lectura)',
        `Candidato: ${binaryCandidate || '—'}`,
        `Confianza: ${Math.round(binaryQuality.confidence || 0)}%`,
        `Calidad mínima R16: ${binaryQuality.ok ? 'OK' : 'NO'}`,
        '',
        '[LECTURA 4 · NOMBRE ENFOCADO 4X · R21]',
        focusText || '(sin lectura)',
        `Candidato: ${focusCandidate || '—'}`,
        `Confianza: ${Math.round(focusQuality.confidence || 0)}%`,
        `Calidad mínima R16: ${focusQuality.ok ? 'OK' : 'NO'}`,
        '',
        ...(game === 'POKEMON'
          ? [
              '[LECTURA 5 · POKÉMON NOMBRE 4X · R22]',
              pokemonTextR22 || '(sin lectura)',
              `Candidato: ${pokemonCandidateR22 || '—'}`,
              `Confianza: ${Math.round(
                pokemonQualityR22.confidence || 0
              )}%`,
              `Calidad mínima R16: ${
                pokemonQualityR22.ok ? 'OK' : 'NO'
              }`,
              ''
            ]
          : []),
        '[CONSENSO]',
        `Resultado: ${consensus.value || '—'}`,
        `Votos: ${consensus.votes || 0}/${readableCandidates.length || 4}`,
        `Estado: ${consensus.ok ? 'OK' : 'NO'}`,
        `Método: ${consensus.reason}`,
        '',
        '[OCR COMPLETO · IDENTIFICADORES]',
        fullText || '(sin lectura)'
      ].join('\n'));

      if (!consensus.ok) {
        const catalogClue = bestCatalogClueR19B([
          enhancedCandidate,
          rawCandidate,
          binaryCandidate,
          focusQuality.ok ? focusCandidate : '',
          (
            game === 'POKEMON' &&
            pokemonQualityR22.ok
          )
            ? pokemonCandidateR22
            : ''
        ]);

        if (catalogClue) {
          setQuery(catalogClue);
          setMessage(`OCR sin consenso exacto. "${catalogClue}" se usará únicamente como pista para comparar contra nombres oficiales.`);
          return catalogClue;
        }

        setQuery('');
        setMessage('No hay una pista OCR suficientemente legible. Acerca, centra o enfoca mejor la carta.');
        return '';
      }

      const candidate = cleanPrimaryTitleR15C(consensus.value);
      setQuery(candidate);

      if (!silent) {
        setMessage(`Nombre confirmado por consenso OCR (${consensus.votes}/3): ${candidate}`);
      }

      return candidate;
    } catch (error) {
      console.error(brandText('[GMX Visual TCG OCR R17]'), error);
      if (!silent) setMessage('No fue posible obtener consenso OCR. Vuelve a encuadrar la carta.');
      return '';
    } finally {
      setOcrBusy(false);
    }
  }

  async function resolveOne(item) {
    setResolveBusy(true);
    setResolution(null);
    try {
      const response = await api('/api/v1/external-card-beta/resolve-shiny', {
        method: 'POST', body: JSON.stringify({ identity: candidateIdentity(item) })
      });
      setResolution(response?.data || null);
      return response?.data || null;
    } catch (error) {
      setMessage(error?.message || 'La carta fue encontrada en Internet, pero no fue posible comprobar su existencia en Shiny.');
      return null;
    } finally {
      setResolveBusy(false);
    }
  }

  async function choose(item) {
    setSelected(item);
    await resolveOne(item);
  }

  async function search(
    kind = 'photo',
    imageOverride = null,
    sourceMode = 'camera'
  ) {
    const sourceImage = imageOverride || image;
    let effectiveQuery = clean(query);
    if (kind === 'photo' && !sourceImage) return setMessage('Primero captura o selecciona una carta.');
    setSearchBusy(true); clearIdentification();
    try {
      if (effectiveQuery.length < 2 && kind === 'photo') {
        effectiveQuery = clean(
          await runOcr(
            true,
            sourceImage,
            sourceMode
          )
        );
      }
      if (effectiveQuery.length < 2) return setMessage('Escribe el nombre de la carta o usa OCR.');
      setMessage(kind === 'photo' ? 'Identificando y comparando candidatos…' : 'Buscando candidatos…');
      const photoIdentifiers =
      kind === 'photo'
        ? [
            ...new Set([
              ...extractStrongIdentifiers(ocrText),
              ...(latestOcrIdentifiersR25.current || [])
            ])
          ]
        : [];
      const response = kind === 'photo' ? await api('/api/v1/external-card-beta/visual-search', {
        method: 'POST', body: JSON.stringify({
          game,
          q: effectiveQuery,
          name_hint: effectiveQuery,
          identifiers: photoIdentifiers,
        set_code_ocr_hint: game === 'YUGIOH' ? String(latestYugiohSetHintR26B.current || '') : '',
          image_base64: sourceImage
        })
      }) : await api(`/api/v1/external-card-beta/search?${new URLSearchParams({ game, q: effectiveQuery })}`);
      const found = kind === 'photo' ? response?.data?.matches || [] : response?.data?.rows || [];
      setRows(found);
      if (!found.length) return setMessage('La fuente externa no encontró una identidad candidata.');

      const officialNameR21 = clean(found[0]?.name);

      if (
        sourceMode === 'upload' &&
        officialNameR21
      ) {
        // R24: uploaded scans use the official catalog name
        // as the final visible value. OCR remains only a clue.
        setQuery(officialNameR21);
      } else if (
        kind === 'photo' &&
        officialNameR21 &&
        confirmedOfficialNameR21(
          effectiveQuery,
          officialNameR21
        )
      ) {
        // Camera keeps the previously validated R21 behavior.
        setQuery(officialNameR21);
      }

      setMessage(`Identidad encontrada en Internet mediante ${source}. Comprobando después si ya existe en Shiny…`);
      await choose(found[0]);
    } catch (error) {
      setMessage(error?.message || 'No fue posible identificar la carta.');
    } finally {
      setSearchBusy(false);
    }
  }

  async function createOperationalProduct() {
    if (resolution?.status !== 'INTERNET_IDENTIFIED' || !selected) return;
    setMutationBusy(true);
    try {
      const response = await api('/api/v1/external-card-beta/ensure-operational', {
        method: 'POST', body: JSON.stringify({ identity: candidateIdentity(selected) })
      });
      setResolution((current) => ({ ...current, operational: {
        ...current.operational, card: response.data, variants: current.operational?.variants || []
      } }));
      setMessage(`Producto TCG actual listo: ${response.data.id_carta}.`);
    } catch (error) {
      setMessage(error?.message || 'No fue posible crear el producto TCG.');
    } finally {
      setMutationBusy(false);
    }
  }

  async function receiveIndividual() {
    const cardId = resolution?.operational?.card?.id_carta;
    if (!cardId) return setMessage('Primero crea o relaciona el producto TCG actual.');
    if (!entry.id_sucursal) return setMessage('Selecciona una sucursal.');
    setMutationBusy(true);
    try {
      const response = await api('/api/v1/tcg/inventory/receive', {
        method: 'POST', body: JSON.stringify({ ...entry, id_carta: cardId })
      });
      setMessage(`Existencia agregada. SKU ${response.data?.sku || 'creado'} · stock sucursal ${response.data?.stock_sucursal ?? '—'}.`);
    } catch (error) {
      setMessage(error?.message || 'No fue posible agregar existencia.');
    } finally {
      setMutationBusy(false);
    }
  }

  function addToBulk() {
    if (!selected) return setMessage('Selecciona la identidad exacta antes de contarla.');
    const identity = candidateIdentity(selected);
    setBulkItems((current) => {
      const index = current.findIndex((item) => item.key === identity.key);
      if (index >= 0) return current.map((item, position) => position === index ? { ...item, count: item.count + 1 } : item);
      return [...current, { key: identity.key, identity, preview: selected, count: 1, resolve_status: 'PENDING', resolution: null }];
    });
    setImage(''); setQuery(''); clearIdentification();
    setMessage('Carta contada. La resolución de catálogo y precios continúa en segundo plano. Captura la siguiente.');
  }

  async function resolveBulk(items) {
    setBulkResolveBusy(true);
    const keys = new Set(items.map((item) => item.key));
    setBulkItems((current) => current.map((item) => keys.has(item.key) && item.resolve_status === 'PENDING' ? { ...item, resolve_status: 'RESOLVING' } : item));
    try {
      const response = await api('/api/v1/external-card-beta/bulk-resolve-shiny', {
        method: 'POST', body: JSON.stringify({ identities: items.map((item) => item.identity) })
      });
      const results = new Map((response?.data?.rows || []).map((row) => [row.key, row]));
      setBulkItems((current) => current.map((item) => keys.has(item.key) ? {
        ...item, resolution: results.get(item.key) || null,
        resolve_status: results.get(item.key)?.status || 'NOT_FOUND'
      } : item));
    } catch (error) {
      setBulkItems((current) => current.map((item) => keys.has(item.key) ? { ...item, resolve_status: 'ERROR' } : item));
      setMessage(error?.message || 'Falló un bloque de enriquecimiento; la captura puede continuar.');
    } finally {
      setBulkResolveBusy(false);
    }
  }

  function changeBulkCount(key, delta) {
    setBulkItems((current) => current.map((item) => item.key === key ? { ...item, count: Math.max(0, item.count + delta) } : item).filter((item) => item.count > 0));
  }

  async function receiveBulk() {
    if (!entry.id_sucursal) return setMessage('Selecciona una sucursal para recibir el lote.');
    if (bulkItems.some((item) => ['PENDING', 'RESOLVING'].includes(item.resolve_status))) return setMessage('El enriquecimiento del lote sigue en proceso. La captura puede continuar mientras termina.');
    const matched = bulkItems.filter((item) => item.resolution?.status === 'INTERNET_IDENTIFIED');
    if (!matched.length) return setMessage('No hay identidades confirmadas mediante los proveedores de Internet.');
    setMutationBusy(true);
    try {
      const missing = matched.filter((item) => !item.resolution.operational?.card?.id_carta);
      const installed = new Map();
      for (const block of chunks(missing, CHUNK_INSTALL)) {
        const response = await api('/api/v1/external-card-beta/bulk-ensure-operational', {
          method: 'POST', body: JSON.stringify({ identities: block.map((item) => item.identity) })
        });
        for (const card of response?.data?.cards || []) installed.set(card.key, card.id_carta);
      }
      const receiptRows = matched.map((item) => ({
        ...entry,
        id_carta: item.resolution.operational?.card?.id_carta || installed.get(item.key),
        cantidad: item.count,
        origen_referencia: entry.origen_referencia || `VISUAL-${new Date().toISOString().slice(0, 10)}`
      })).filter((item) => item.id_carta);
      let ok = 0; let failed = 0;
      for (const block of chunks(receiptRows, CHUNK_RECEIVE)) {
        const response = await api('/api/v1/tcg/inventory/receive-bulk', {
          method: 'POST', body: JSON.stringify({ rows: block, sourceType: 'ADQUISICION' })
        });
        ok += Number(response?.data?.ok || 0); failed += Number(response?.data?.failed || 0);
      }
      setMessage(`Lote recibido: ${ok} identidad(es) única(s) correctas, ${failed} con error; ${matched.reduce((sum, item) => sum + item.count, 0)} carta(s) físicas procesadas.`);
    } catch (error) {
      setMessage(error?.message || 'No fue posible recibir el lote.');
    } finally {
      setMutationBusy(false);
    }
  }

  const entryFields = <div className="visual-r2-entry-grid">
    <label>Sucursal<select value={entry.id_sucursal} onChange={(event) => setEntry((current) => ({ ...current, id_sucursal: event.target.value }))}>
      <option value="">Selecciona</option>{branches.map((branch) => <option key={branch.row_id} value={branch.id_sucursal}>{branch.nombre_sucursal}</option>)}
    </select></label>
    {mode === 'individual' ? <label>Cantidad<input type="number" min="1" value={entry.cantidad} onChange={(event) => setEntry((current) => ({ ...current, cantidad: Math.max(1, Number(event.target.value) || 1) }))}/></label> : null}
    <label>Idioma<input value={entry.idioma} onChange={(event) => setEntry((current) => ({ ...current, idioma: event.target.value.toUpperCase() }))}/></label>
    <label>Condición<select value={entry.condicion} onChange={(event) => setEntry((current) => ({ ...current, condicion: event.target.value }))}>{CONDITIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Acabado<select value={entry.acabado} onChange={(event) => setEntry((current) => ({ ...current, acabado: event.target.value }))}>{FINISHES.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Edición<input value={entry.edicion} onChange={(event) => setEntry((current) => ({ ...current, edicion: event.target.value }))}/></label>
    <label>Costo unitario<input type="number" min="0" step="0.01" value={entry.costo_unitario} onChange={(event) => setEntry((current) => ({ ...current, costo_unitario: Number(event.target.value) || 0 }))}/></label>
    <label>Precio venta<input type="number" min="0" step="0.01" value={entry.precio_venta} onChange={(event) => setEntry((current) => ({ ...current, precio_venta: Number(event.target.value) || 0 }))}/></label>
    <label>Precio oferta<input type="number" min="0" step="0.01" value={entry.precio_oferta} onChange={(event) => setEntry((current) => ({ ...current, precio_oferta: Number(event.target.value) || 0 }))}/></label>
  </div>;
  function shinyOpenMarketplace(kind){
    if(!selected){
      setMessage?.('Selecciona primero una coincidencia.');
      return;
    }
    const urls=shinyExternalMarketplaceUrls(selected,query);
    const url=kind==='collectr'?urls.collectr:urls.tcgplayer;
    window.open(url,'_blank','noopener,noreferrer');
  }

  function shinyStartReference(sourceName='TCGplayer'){
    if(!selected){
      setMessage?.('Selecciona primero una coincidencia.');
      return;
    }
    const urls=shinyExternalMarketplaceUrls(selected,query);
    setGmxRefSource(sourceName);
    setGmxRefUrl(sourceName==='Collectr'?urls.collectr:urls.tcgplayer);
    setGmxRefPrice(Number(selected?.market_price_usd)>0?Number(selected.market_price_usd).toFixed(2):'');
    setGmxRefCondition('Near Mint');
    setGmxRefVariant('');
    setGmxRefSaved(null);
    setGmxRefOpen(true);
  }

  async function shinyPaste(setter){
    try{
      const text=await navigator.clipboard.readText();
      setter(String(text||'').trim());
    }catch{
      if(typeof setMessage==='function'){
        setMessage('El navegador no permitió leer el portapapeles. Usa Ctrl+V.');
      }
    }
  }

  /* SHINY_TCGPLAYER_SESSION_PRICE_R27B */
  function shinyApplyTcgplayerSessionPriceR27B(payload, parsedPrice){
    if(
      !payload ||
      payload?.reference?.marketplace !== 'TCGplayer' ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice <= 0
    ){
      return false;
    }

    const selectedExternalId = String(selected?.external_id || '');
    const selectedCollector = String(selected?.collector_number || '');
    const selectedSetCode = String(selected?.set_code || '');
    const selectedName = String(selected?.name || '');

    const isSamePrinting = (item) => {
      if(!item) return false;

      const itemExternalId = String(item?.external_id || '');
      const itemCollector = String(item?.collector_number || '');
      const itemSetCode = String(item?.set_code || '');
      const itemName = String(item?.name || '');

      if(
        selectedCollector &&
        itemCollector
      ){
        return (
          itemCollector.toUpperCase() === selectedCollector.toUpperCase() &&
          itemName.toUpperCase() === selectedName.toUpperCase()
        );
      }

      if(
        selectedExternalId &&
        itemExternalId
      ){
        return itemExternalId === selectedExternalId;
      }

      return (
        itemName.toUpperCase() === selectedName.toUpperCase() &&
        itemSetCode.toUpperCase() === selectedSetCode.toUpperCase()
      );
    };

    const applyToItem = (item) => ({
      ...item,
      market_price_usd: parsedPrice,
      market_price_source: 'TCGplayer · confirmación manual',
      tcgplayer_price_applied_r27b: true,
      tcgplayer_reference_r27b: {
        marketplace: 'TCGplayer',
        price_usd: parsedPrice,
        condition: payload?.reference?.condition || '',
        variant: payload?.reference?.variant || '',
        url: payload?.reference?.url || '',
        captured_at: payload?.reference?.captured_at || ''
      }
    });

    setSelected((current) =>
      isSamePrinting(current)
        ? applyToItem(current)
        : current
    );

    setRows((current) =>
      Array.isArray(current)
        ? current.map((item) =>
            isSamePrinting(item)
              ? applyToItem(item)
              : item
          )
        : current
    );

    return true;
  }

  function shinySaveReferenceTest(){
    if(!selected)return;

    const cleaned=String(shinyRefPrice||'')
      .replace(/[^0-9.,]/g,'')
      .replace(',','.');
    const parsed=cleaned?Number(cleaned):null;

    const payload={
      id:`shiny-ref-${Date.now()}`,
      card:{
        source:selected.source||source||'',
        game:selected.game||game||'',
        external_id:selected.external_id||'',
        name:selected.name||'',
        set_name:selected.set_name||'',
        set_code:selected.set_code||'',
        collector_number:selected.collector_number||'',
        rarity:selected.rarity||'',
        type:selected.type||'',
        language:selected.language||'',
        image:selected.image||''
      },
      reference:{
        marketplace:shinyRefSource,
        url:String(shinyRefUrl||'').trim(),
        condition:shinyRefCondition,
        variant:String(shinyRefVariant||'').trim(),
        price_usd:Number.isFinite(parsed)?parsed:null,
        captured_at:new Date().toISOString(),
        capture_method:'manual_user_confirmed'
      }
    };

    const key='gmx.externalReferenceTests.v1';
    let current=[];
    try{
      current=JSON.parse(localStorage.getItem(key)||'[]');
      if(!Array.isArray(current))current=[];
    }catch{
      current=[];
    }

    current.unshift(payload);
    localStorage.setItem(key,JSON.stringify(current.slice(0,50)));
    setGmxRefSaved(payload);

    const tcgplayerAppliedR27B =
      shinyApplyTcgplayerSessionPriceR27B(
        payload,
        parsed
      );

    if(typeof setMessage==='function'){
      setMessage(
        tcgplayerAppliedR27B
          ? `Referencia TCGplayer guardada. Precio $${parsed.toFixed(2)} USD aplicado a esta impresión durante la sesión. Inventario sin cambios.`
          : `Referencia de prueba guardada desde ${shinyRefSource}. Inventario sin cambios.`
      );
    }
  }

  return <div className="shiny-external-parity visual-r2">
    <section className="content-card visual-r2-hero">
      <div><div className="eyebrow">BÚSQUEDA VISUAL · INTERNET PRIMERO</div><h2>Alta Externa Beta R3</h2>
        <p>Identifica la carta en Internet aunque no exista en GMX; después comprueba producto, precio e inventario local.</p></div>
      <div className="visual-r2-mode"><button className={mode === 'individual' ? 'active' : ''} onClick={() => setMode('individual')}>Individual</button>
        <button className={mode === 'bulk' ? 'active' : ''} onClick={() => setMode('bulk')}>Bulk</button></div>
    </section>

    <section className="content-card visual-r2-capture">
      <div className="visual-r2-toolbar"><div className="external-game-tabs">{GAMES.map((item) => <button key={item.id} className={game === item.id ? 'active' : ''} onClick={() => { setGame(item.id); clearIdentification(); }}>{item.label}</button>)}</div>
        {mode === 'bulk' ? <div className="visual-r2-counters"><strong>{physicalCount}</strong><span>físicas</span><strong>{bulkItems.length}</strong><span>únicas</span></div> : null}</div>
      <div className="visual-r2-capture-grid">
        <div><div className={`external-parity-camera ${cameraActive ? 'active' : ''}`}><video ref={videoRef} autoPlay playsInline muted/><div className="shiny-card-frame-r15" aria-hidden="true">
  <div className="shiny-card-frame-r15-label">COLOCA LA CARTA AQUÍ</div><div className="shiny-card-frame-r16-hint">La carta debe llenar el marco</div>
  <div className="shiny-card-frame-r15-name">NOMBRE</div>
</div>{!cameraActive ? <div className="external-parity-camera-placeholder"><strong>Cámara apagada</strong><span>Abre la cámara o selecciona un archivo.</span></div> : null}</div>
          <div className="external-parity-camera-actions">{cameraActive ? <><button onClick={capturePhoto}>Capturar foto</button><button className="secondary" onClick={stopCamera}>Cerrar</button></> : <button onClick={startCamera} disabled={cameraBusy}>{cameraBusy ? 'Abriendo…' : 'Abrir cámara'}</button>}
            </div></div>
        <div className="external-parity-preview">{image ? <img src={image} alt="Carta capturada"/> : <div><strong>Siguiente carta</strong><span>Encuádrela completa.</span></div>}</div>
      </div>
      <div className="visual-r2-search-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchBusy || ocrBusy ? 'Analizando carta automáticamente…' : 'Nombre detectado automáticamente'}
        />
      </div>
      {message ? <div className="message visual-r2-message">{message}</div> : null}
      {ocrText ? <details className="external-parity-ocr"><summary>Texto OCR</summary><pre>{ocrText}</pre></details> : null}
    </section>

    <section className="content-card visual-r2-results">
      <div className="visual-r2-section-head"><div><h3>Identidad desde Internet</h3><p>{rows.length ? `${rows.length} candidato(s) en ${source}` : 'Sin candidatos todavía.'}</p></div>{resolveBusy ? <span className="visual-r2-working">Comprobando existencia en GMX…</span> : null}</div>
      <div className="visual-r2-result-grid"><div className="external-parity-match-list">{rows.slice(0, 10).map((item, index) => {
        const key = `${identityKey(item)}|${index}`; const src = imageSrc(item.image);
        return <article key={key} className={`external-parity-match ${selected === item ? 'selected' : ''}`} onClick={() => choose(item)}>
          <div className="external-parity-rank">#{index + 1}</div><div className="external-parity-thumb">{src && !imageErrors[key] ? <img src={src} alt="" onError={() => setImageErrors((current) => ({ ...current, [key]: true }))}/> : <span>TCG</span>}</div>
          <div className="external-parity-match-info"><strong>{item.name}</strong><span>{[item.set_name, item.set_code, item.collector_number].filter(Boolean).join(' · ')}</span><small>{item.rarity || '—'}</small></div>
          <div className="external-parity-score"><strong>{item.internet_match_score == null ? 'WEB' : `${Math.round(Number(item.internet_match_score))}%`}</strong><span>Internet</span></div>
        </article>;
      })}{!rows.length ? <div className="visual-r2-empty">La captura no espera precios: primero identifica la carta.</div> : null}</div>
        <PricePanel resolution={resolution}/></div>
      {mode === 'bulk' && selected ? <button className="visual-r2-next" onClick={addToBulk}>Contar esta carta y seguir inmediatamente</button> : null}
    </section>

    {mode === 'individual' ? <section className="content-card visual-r2-operation"><div className="visual-r2-section-head"><div><h3>Producto y existencia</h3><p>Usa exactamente el modelo TCG actual: carta → variante/SKU → stock por sucursal.</p></div></div>
      {entryFields}<div className="visual-r2-operation-actions">{resolution?.status === 'INTERNET_IDENTIFIED' && !resolution.operational?.card ? <button onClick={createOperationalProduct} disabled={mutationBusy}>Crear producto desde identidad de Internet</button> : null}
        <button onClick={receiveIndividual} disabled={mutationBusy || !resolution?.operational?.card}>{mutationBusy ? 'Procesando…' : 'Agregar existencia'}</button>
        {resolution?.preferred_price?.market != null ? <button className="secondary" onClick={() => setEntry((current) => ({ ...current, precio_venta: Number(resolution.preferred_price.market) }))}>Usar Market como precio</button> : null}</div></section> :
      <section className="content-card visual-r2-bulk"><div className="visual-r2-section-head"><div><h3>Lote deduplicado</h3><p>{physicalCount} carta(s) físicas → {bulkItems.length} identidad(es) única(s). El precio nunca bloquea la captura.</p></div><span>{bulkResolveBusy ? 'Enriqueciendo…' : 'Cola al día'}</span></div>
        <div className="visual-r2-bulk-list">{bulkItems.map((item) => <article key={item.key}><div><strong>{item.identity.name}</strong><span>{[item.identity.set_code, item.identity.collector_number].filter(Boolean).join(' · ') || 'Sin numeración'}</span></div>
          <span className={`visual-r2-status ${String(item.resolve_status).toLowerCase()}`}>{statusLabel(item.resolve_status)}</span><div className="visual-r2-stepper"><button onClick={() => changeBulkCount(item.key, -1)}>−</button><strong>{item.count}</strong><button onClick={() => changeBulkCount(item.key, 1)}>+</button></div></article>)}
          {!bulkItems.length ? <div className="visual-r2-empty">Cada identidad se consulta una sola vez aunque aparezca miles de veces.</div> : null}</div>
        <h4>Valores comunes para recepción</h4>{entryFields}<div className="visual-r2-operation-actions"><button onClick={receiveBulk} disabled={mutationBusy || !bulkItems.length}>{mutationBusy ? 'Procesando lote…' : 'Crear faltantes y recibir lote'}</button></div>
      </section>}
  
    {selected?<section className="content-card shiny-ref-r13e">
      <div className="shiny-ref-r13e-head">
        <div>
          <div className="eyebrow">PRUEBA · REFERENCIA EXTERNA</div>
          <h3>Usar selección desde marketplace</h3>
          <p>
            Abre la búsqueda en el marketplace, selecciona visualmente la impresión correcta
            y vuelve a Shiny para confirmar precio, condición, variante y URL.
          </p>
        </div>
        <div className="shiny-ref-r13e-badge">NO MODIFICA INVENTARIO</div>
      </div>

      <div className="shiny-ref-r13e-card">
        <strong>{selected?.name||'Carta seleccionada'}</strong>
        <span>
          {[selected?.set_name,selected?.set_code,selected?.collector_number]
            .filter(Boolean).join(' · ')||'Sin set / número'}
        </span>
      </div>

      <div className="shiny-ref-r13e-actions">
        <button type="button" onClick={()=>shinyOpenMarketplace('tcgplayer')}>Abrir en TCGplayer</button>
        <button type="button" className="secondary" onClick={()=>shinyOpenMarketplace('collectr')}>Abrir en Collectr</button>
        <button type="button" className="secondary" onClick={()=>shinyStartReference('TCGplayer')}>Capturar referencia</button>
      </div>

      {shinyRefOpen?<div className="shiny-ref-r13e-form">
        <div className="shiny-ref-r13e-form-head">
          <strong>Confirmar datos observados</strong>
          <button type="button" className="secondary" onClick={()=>setGmxRefOpen(false)}>Cerrar</button>
        </div>

        <div className="shiny-ref-r13e-grid">
          <label>
            <span>Marketplace</span>
            <select value={shinyRefSource} onChange={e=>{
              const next=e.target.value;
              setGmxRefSource(next);
              const urls=shinyExternalMarketplaceUrls(selected,query);
              if(next==='TCGplayer')setGmxRefUrl(urls.tcgplayer);
              if(next==='Collectr')setGmxRefUrl(urls.collectr);
            }}>
              <option>TCGplayer</option>
              <option>Collectr</option>
              <option>Otro</option>
            </select>
          </label>

          <label>
            <span>Condición</span>
            <select value={shinyRefCondition} onChange={e=>setGmxRefCondition(e.target.value)}>
              <option>Near Mint</option>
              <option>Lightly Played</option>
              <option>Moderately Played</option>
              <option>Heavily Played</option>
              <option>Damaged</option>
              <option>Sin especificar</option>
            </select>
          </label>

          <label>
            <span>Precio observado (USD)</span>
            <div className="shiny-ref-r13e-input-action">
              <input value={shinyRefPrice} onChange={e=>setGmxRefPrice(e.target.value)} placeholder="Ej. 2.49"/>
              <button type="button" className="secondary" onClick={()=>shinyPaste(setGmxRefPrice)}>Pegar</button>
            </div>
          </label>

          <label>
            <span>Variante / impresión</span>
            <div className="shiny-ref-r13e-input-action">
              <input value={shinyRefVariant} onChange={e=>setGmxRefVariant(e.target.value)} placeholder="Ej. Foil / Alt Art"/>
              <button type="button" className="secondary" onClick={()=>shinyPaste(setGmxRefVariant)}>Pegar</button>
            </div>
          </label>

          <label className="shiny-ref-r13e-url">
            <span>URL exacta</span>
            <div className="shiny-ref-r13e-input-action">
              <input value={shinyRefUrl} onChange={e=>setGmxRefUrl(e.target.value)} placeholder="Pega la URL exacta del producto"/>
              <button type="button" className="secondary" onClick={()=>shinyPaste(setGmxRefUrl)}>Pegar</button>
            </div>
          </label>
        </div>

        <div className="shiny-ref-r13e-save">
          <button type="button" onClick={shinySaveReferenceTest}>Guardar prueba en GMX</button>
          <span>Se guarda sólo en localStorage de este navegador. No toca BD, producto ni stock.</span>
        </div>

        {shinyRefSaved?<div className="shiny-ref-r13e-success">
          <strong>✓ Referencia guardada</strong>
          <span>
            {shinyRefSaved.card.name} · {shinyRefSaved.reference.marketplace}
            {shinyRefSaved.reference.price_usd!==null?` · $${shinyRefSaved.reference.price_usd.toFixed(2)} USD`:''}
            {shinyRefSaved.reference.condition?` · ${shinyRefSaved.reference.condition}`:''}
          </span>

          {selected?.tcgplayer_price_applied_r27b ? (
            <span>
              Precio TCGplayer aplicado a esta impresión: $
              {Number(selected.market_price_usd || 0).toFixed(2)} USD
              {selected?.collector_number ? ` · ${selected.collector_number}` : ''}
            </span>
          ) : null}
        </div>:null}
      </div>:null}
    </section>:null}
</div>;
}















