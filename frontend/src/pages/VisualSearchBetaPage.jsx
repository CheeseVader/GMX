import { brandText } from "../config/brand.js";import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import '../visualSearchBeta.css';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No fue posible leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('La imagen no es válida.'));
      img.onload = () => {
        const max = 1400;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}
function mxn(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN'
  }).format(Number(value || 0));
}


export default function VisualSearchBetaPage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [image, setImage] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [health, setHealth] = useState(null);
  const [result, setResult] = useState(null);
  const [betaCart, setBetaCart] = useState([]);
  const [shinyVisualImageError, setVisualImageError] = useState({});

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [facingMode, setFacingMode] = useState('environment');

  const matches = useMemo(() => Array.isArray(result?.matches) ? result.matches : [], [result]);

  async function checkHealth() {
    try {
      const r = await api('/api/v1/visual-beta/health');
      setHealth(r?.data || null);
    } catch (e) {
      setHealth({ ok: false, message: e?.message || 'Servicio visual fuera de línea.' });
    }
  }

  useEffect(() => {checkHealth();}, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  async function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  async function startCamera(mode = facingMode) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador no permite acceso directo a la cámara.');
      return;
    }

    setCameraBusy(true);
    setCameraError('');
    setMessage('');

    try {
      await stopCamera();

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });
      } catch (_e) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true
        });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setFacingMode(mode);
      setCameraActive(true);
    } catch (e) {
      console.error(brandText("[GMX Visual Beta] camera error"), e);
      const name = String(e?.name || '');
      let msg = 'No fue posible abrir la cámara.';
      if (name === 'NotAllowedError') msg = 'Permiso de cámara denegado. Autoriza la cámara para este sitio en el navegador.';
      if (name === 'NotFoundError') msg = 'No se encontró una cámara disponible.';
      if (name === 'NotReadableError') msg = 'La cámara está siendo utilizada por otra aplicación.';
      if (name === 'SecurityError') msg = 'El navegador bloqueó la cámara por seguridad.';
      setCameraError(msg);
      setCameraActive(false);
    } finally {
      setCameraBusy(false);
    }
  }

  async function switchCamera() {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    await startCamera(next);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('La cámara todavía no está lista para capturar.');
      return;
    }

    // Shiny R5: capture only the centered TCG-card viewport (63:88).
    // The CSS viewport uses the same aspect ratio, so what the operator sees
    // is the same region that is sent to OpenCV/OpenCLIP.
    const cardRatio = 63 / 88;
    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;

    let cropH = sourceH * 0.90;
    let cropW = cropH * cardRatio;

    if (cropW > sourceW * 0.90) {
      cropW = sourceW * 0.90;
      cropH = cropW / cardRatio;
    }

    const sx = Math.max(0, (sourceW - cropW) / 2);
    const sy = Math.max(0, (sourceH - cropH) / 2);

    const maxH = 1400;
    const scale = Math.min(1, maxH / cropH);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropW * scale));
    canvas.height = Math.max(1, Math.round(cropH * scale));

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);

    const data = canvas.toDataURL('image/jpeg', 0.9);
    setImage(data);
    setFileName(`camara-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
    setResult(null);
    setMessage('');
    setCameraError('');
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage('');
    setResult(null);
    setFileName(file.name || 'captura.jpg');
    try {
      setImage(await fileToDataUrl(file));
    } catch (e) {
      setImage('');
      setMessage(e?.message || 'No fue posible preparar la imagen.');
    }
  }

  async function search() {
    if (!image) {
      setMessage('Primero toma o selecciona una fotografía.');
      return;
    }
    setBusy(true);
    setMessage('');
    setResult(null);
    try {
      const r = await api('/api/v1/visual-beta/search', {
        method: 'POST',
        body: JSON.stringify({ image_base64: image, limit: 5 })
      });
      setResult(r?.data || {});
      if (!(r?.data?.matches || []).length) {
        setMessage(r?.message || 'No se encontraron coincidencias visuales.');
      }
      await checkHealth();
    } catch (e) {
      setMessage(e?.message || 'No fue posible realizar la búsqueda visual.');
      await checkHealth();
    } finally {
      setBusy(false);
    }
  }

  async function addAndScanNext(item) {
    addToBetaCart(item);

    setImage('');
    setFileName('');
    setResult(null);
    setMessage('Producto agregado al carrito Beta. Listo para escanear el siguiente.');

    try {
      await startCamera();
    } catch {

      // startCamera already handles user-facing camera errors.
    }}
  function addToBetaCart(item) {
    const key = String(item.row_id || item.id || item.sku || '');
    if (!key) return;

    setBetaCart((current) => {
      const found = current.find((x) => String(x.key) === key);

      if (found) {
        const nextQty = Math.min(
          Number(found.qty || 1) + 1,
          Math.max(1, Number(item.stock || 0))
        );

        return current.map((x) =>
        String(x.key) === key ?
        { ...x, qty: nextQty } :
        x
        );
      }

      return [...current, {
        key,
        row_id: item.row_id,
        id: item.id,
        sku: item.sku,
        nombre: item.nombre,
        imagen: item.imagen,
        precio: Number(item.precio || 0),
        stock: Number(item.stock || 0),
        qty: 1
      }];
    });
  }

  function changeBetaQty(key, delta) {
    setBetaCart((current) => current.
    map((item) => {
      if (String(item.key) !== String(key)) return item;

      const max = Math.max(1, Number(item.stock || 0));
      const qty = Math.max(0, Math.min(max, Number(item.qty || 1) + delta));

      return { ...item, qty };
    }).
    filter((item) => Number(item.qty) > 0)
    );
  }

  const betaSubtotal = betaCart.reduce(
    (sum, item) => sum + Number(item.precio || 0) * Number(item.qty || 0),
    0
  );
  return <div className="shiny-visual-beta-page">
    <section className="content-card shiny-visual-beta-hero">
      <div>
        <div className="eyebrow">LABORATORIO · FUNCIÓN EXPERIMENTAL</div>
        <h2>Búsqueda Visual Beta</h2>
        <p>
          Prueba aislada de reconocimiento por imagen con OpenCV + OpenCLIP.
          Puedes usar cámara en vivo o seleccionar una imagen.
        </p>
      </div>
      <div className={`shiny-visual-health ${health?.ok ? 'ok' : 'off'}`}>
        <strong>{health?.ok ? 'Servicio visual activo' : 'Servicio visual sin conexión'}</strong>
        <span>{health?.ok ?
          `${health.openclip_model || 'OpenCLIP'} · ${health.device || 'CPU'}` :
          'Inicia services/visual-search-beta/start-visual-beta.ps1'}</span>
      </div>
    </section>

    <section className="content-card shiny-visual-camera-panel">
      <div className="shiny-visual-camera-head">
        <div>
          <h3>Cámara en vivo</h3>
          <p>Coloca la carta dentro del encuadre y toma la fotografía.</p>
        </div>
        <div className="shiny-visual-camera-actions">
          {!cameraActive ?
          <button type="button" onClick={() => startCamera()} disabled={cameraBusy}>
              {cameraBusy ? 'Abriendo cámara…' : 'Abrir cámara'}
            </button> :

          <>
              <button type="button" onClick={capturePhoto}>Capturar foto</button>
              <button type="button" className="secondary" onClick={switchCamera}>Cambiar cámara</button>
              <button type="button" className="secondary" onClick={stopCamera}>Cerrar cámara</button>
            </>
          }
        </div>
      </div>

      <div className={`shiny-visual-camera-stage ${cameraActive ? 'active' : ''}`}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted />
        
        {!cameraActive ? <div className="shiny-visual-camera-placeholder">
          <strong>Cámara apagada</strong>
          <span>Presiona “Abrir cámara” para comenzar.</span>
        </div> : null}
      </div>

      {cameraError ? <div className="message warning">{cameraError}</div> : null}
    </section>

    <section className="content-card shiny-visual-beta-workbench">
      <div className="shiny-visual-capture">
        <h3>1. Imagen capturada</h3>

        <div className="shiny-visual-preview">
          {image ?
          <img src={image} alt="Imagen para búsqueda visual" /> :
          <div>
              <strong>Sin fotografía todavía</strong>
              <span>Usa la cámara de arriba o selecciona una imagen.</span>
            </div>}
        </div>

        <div className="shiny-visual-file-row">
          <label className="secondary shiny-visual-file-button">
            Seleccionar archivo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={chooseFile} />
            
          </label>
          {fileName ? <small>{fileName}</small> : null}
        </div>

        <div className="shiny-visual-actions">
          <button type="button" onClick={search} disabled={busy || !image || health?.ok === false}>
            {busy ? 'Analizando…' : 'Buscar coincidencias'}
          </button>
          {image ? <button type="button" className="secondary" onClick={() => {
            setImage('');setFileName('');setResult(null);setMessage('');
          }}>Limpiar captura</button> : null}
          <button type="button" className="secondary" onClick={checkHealth}>Verificar servicio</button>
        </div>

        {message ? <div className="message">{message}</div> : null}
      </div>

      <div className="shiny-visual-results">
        <div className="shiny-visual-results-head">
          <div>
            <h3>2. Coincidencias</h3>
            <p>Top 5 por similitud visual.</p>
          </div>
          {result ? <div className="shiny-visual-metrics">
            <span>Catálogo local <strong>{result.catalog_count || 0}</strong></span>
            <span>Comparadas <strong>{result.indexed_count || 0}</strong></span>
            <span>Recorte OpenCV <strong>{result.card_detected ? 'Sí' : 'No'}</strong></span>
          </div> : null}
        </div>

        {!result && !busy ? <div className="shiny-visual-empty">
          Los resultados aparecerán aquí después de analizar una imagen.
        </div> : null}

        {busy ? <div className="shiny-visual-empty">Generando embedding y comparando imágenes…</div> : null}

        {matches.length ? <div className="shiny-visual-match-list">
          {matches.map((item, index) => <article className="shiny-visual-match" key={item.row_id || item.id || `${item.sku}-${index}`}>
            <div className="shiny-visual-rank">#{index + 1}</div>
            <div className="shiny-visual-thumb">
              {item.imagen && !shinyVisualImageError[item.row_id || item.id || item.sku] ? <img src={item.imagen} alt={item.nombre || item.sku || 'Producto'} onError={() => setVisualImageError((x) => ({ ...x, [item.row_id || item.id || item.sku]: true }))} /> : <span>{brandText("GMX")}</span>}
            </div>
            <div className="shiny-visual-match-info">
              <strong>{item.nombre || 'Producto sin nombre'}</strong>
              <span>{item.sku || 'Sin SKU'} · {item.categoria || 'Sin categoría'}</span>
              <div className="shiny-visual-pos-meta">
                <strong>{mxn(item.precio)}</strong>
                <span className={Number(item.stock || 0) > 0 ? 'ok' : 'out'}>
                  {Number(item.stock || 0) > 0 ? `${item.stock} en stock` : 'Sin stock'}
                </span>
              </div>
            </div>
            <div className="shiny-visual-pos-actions">
              <div className="shiny-visual-score">
                <strong>{pct(item.similarity)}</strong>
                <span>similitud</span>
              </div>
              <button
                type="button"
                onClick={() => addAndScanNext(item)}
                disabled={Number(item.stock || 0) <= 0}>
                
                {Number(item.stock || 0) > 0 ? 'Agregar y escanear siguiente' : 'Sin stock'}
              </button>
            </div>
          </article>)}
        </div> : null}
      </div>
    </section>

    <section className="content-card shiny-visual-pos-beta">
      <div className="shiny-visual-pos-head">
        <div>
          <div className="eyebrow">PRUEBA AISLADA · NO GENERA VENTA</div>
          <h3>POS Visual Beta</h3>
          <p>
            Agrega productos reconocidos por cámara para simular un checkout.
            El carrito no descuenta inventario ni crea pedidos.
          </p>
        </div>

                <div className="shiny-visual-pos-count">
          <span>Productos en carrito</span>
          <strong>{betaCart.reduce((sum, item) => sum + Number(item.qty || 0), 0)}</strong>
        </div>
<div className="shiny-visual-pos-total">
          <span>Subtotal Beta</span>
          <strong>{mxn(betaSubtotal)}</strong>
        </div>
      </div>

      {!betaCart.length ?
      <div className="shiny-visual-pos-empty">
          Escanea un producto y agrégalo desde las coincidencias.
        </div> :

      <div className="shiny-visual-pos-cart">
          {betaCart.map((item) => <article className="shiny-visual-pos-line" key={item.key}>
            <div className="shiny-visual-pos-cart-thumb">
              {item.imagen ? <img src={item.imagen} alt={item.nombre || 'Producto'} /> : <span>{brandText("GMX")}</span>}
            </div>

            <div className="shiny-visual-pos-cart-info">
              <strong>{item.nombre || 'Producto'}</strong>
              <span>{item.sku || 'Sin SKU'}</span>
              <small>{mxn(item.precio)} c/u</small>
            </div>

            <div className="shiny-visual-pos-qty">
              <button type="button" className="secondary" onClick={() => changeBetaQty(item.key, -1)}>−</button>
              <strong>{item.qty}</strong>
              <button
              type="button"
              className="secondary"
              onClick={() => changeBetaQty(item.key, 1)}
              disabled={Number(item.qty) >= Number(item.stock || 0)}>
              +</button>
            </div>

            <div className="shiny-visual-pos-line-total">
              <strong>{mxn(Number(item.precio || 0) * Number(item.qty || 0))}</strong>
              <span>Máx. stock: {item.stock}</span>
            </div>
          </article>)}

          <div className="shiny-visual-pos-footer">
            <button type="button" className="secondary" onClick={() => setBetaCart([])}>
              Vaciar carrito Beta
            </button>

            <div>
              <span>Total de prueba</span>
              <strong>{mxn(betaSubtotal)}</strong>
            </div>

            <button type="button" disabled title="Beta segura: checkout real deshabilitado">
              Cobrar (deshabilitado)
            </button>
          </div>
        </div>}
    </section>
    <section className="content-card shiny-visual-beta-note">
      <strong>Alcance de esta Beta</strong>
      <p>
        Solo compara productos que ya tengan una imagen guardada localmente en /uploads/products.
        No usa APIs pagadas y no escribe cambios en la base de datos.
      </p>
    </section>
  </div>;
}
