import { brandText } from "../config/brand.js";import { useRef, useState } from 'react';
import { api } from '../services/api.js';

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

async function fileToWebpDataUrl(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('La imagen original no debe superar 12 MB.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No fue posible leer la imagen.'));
      img.src = objectUrl;
    });

    const max = 1200;
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);

    return canvas.toDataURL('image/webp', 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function ProductLocalImageManager({ sku = '', image = '', onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [message, setMessage] = useState('');

  async function uploadFile(file) {
    if (!file) return;
    setBusy(true);
    setMessage('');

    try {
      const dataUrl = await fileToWebpDataUrl(file);
      const result = await api('/api/v1/products/media/local', {
        method: 'POST',
        body: JSON.stringify({ sku, dataUrl, sourceName: file.name })
      });

      const localPath = String(result?.data?.localPath || '');
      if (!localPath) throw new Error('El servidor no devolvió la ruta local.');

      onChange?.(localPath);
      setMessage('Imagen guardada localmente.');
    } catch (e) {
      setMessage(e?.message || 'No fue posible guardar la imagen.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function importUrl() {
    const url = String(sourceUrl || '').trim();

    if (!/^https?:\/\//i.test(url)) {
      setMessage('Captura una URL http/https válida.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const result = await api('/api/v1/products/media/local', {
        method: 'POST',
        body: JSON.stringify({ sku, sourceUrl: url })
      });

      const localPath = String(result?.data?.localPath || '');
      if (!localPath) throw new Error('El servidor no devolvió la ruta local.');

      onChange?.(localPath);
      setMessage('Imagen descargada y guardada localmente.');
    } catch (e) {
      setMessage(e?.message || 'No fue posible importar la URL.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="wide" style={{ border: '1px solid rgba(148,163,184,.28)', borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
    <div>
      <strong>Imagen local</strong>
      <div style={{ fontSize: 12, opacity: .72, marginTop: 2 }}>{brandText("Se guarda en el servidor GMX para funcionar sin Internet.")}</div>
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className="secondary compact" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Procesando…' : 'Seleccionar imagen'}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        onChange={(e) => uploadFile(e.target.files?.[0])} />
      

      {image ?
      <button type="button" className="secondary compact" disabled={busy} onClick={() => onChange?.('')}>
          Quitar imagen
        </button> :
      null}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
      <input
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder="URL externa opcional para copiarla al servidor" />
      
      <button type="button" className="secondary compact" disabled={busy || !sourceUrl.trim()} onClick={importUrl}>
        Guardar URL en local
      </button>
    </div>

    {message ? <small style={{ opacity: .8 }}>{message}</small> : null}
  </div>;
}
