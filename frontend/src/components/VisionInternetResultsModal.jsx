import { brandText } from "../config/brand.js";import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api.js';

function price(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)} USD` : '';
}

function cleanQuery(v = '') {
  return String(v || '').
  replace(/\s+/g, ' ').
  trim();
}

export default function VisionInternetResultsModal({
  open,
  loading = false,
  items = [],
  queryText = '',
  error = '',
  onClose,
  onPick
}) {
  const [manualQuery, setManualQuery] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualItems, setManualItems] = useState(null);

  useEffect(() => {
    if (open) {
      setManualQuery(cleanQuery(queryText));
      setManualBusy(false);
      setManualError('');
      setManualItems(null);
    }
  }, [open, queryText]);

  async function searchInternet() {
    const q = cleanQuery(manualQuery);
    if (q.length < 2) {
      setManualError('Escribe nombre, set code o passcode.');
      return;
    }

    setManualBusy(true);
    setManualError('');

    try {
      const hints = {
        name: '',
        setCode: '',
        passcode: ''
      };

      if (/^\d{8}$/.test(q)) {
        hints.passcode = q;
      } else if (/^[A-Za-z0-9]{2,8}-[A-Za-z0-9]{2,5}$/.test(q)) {
        hints.setCode = q.toUpperCase();
      } else {
        hints.name = q;
      }

      const r = await api('/api/v1/tcg/vision/internet-discovery', {
        method: 'POST',
        body: JSON.stringify({
          text: q,
          queries: [q],
          hints,
          limit: 12
        })
      });

      const rows = r?.data?.results || [];
      setManualItems(rows);

      if (!rows.length) {
        setManualError(
          `No se encontro "${q}" en el proveedor externo. Prueba con nombre exacto, codigo de set o passcode.`
        );
      }
    } catch (e) {
      setManualItems([]);
      setManualError(e?.message || 'No se pudo completar la busqueda en Internet.');
    } finally {
      setManualBusy(false);
    }
  }

  if (!open) return null;

  const rows = manualItems === null ? items : manualItems;
  const busy = loading || manualBusy;
  const visibleError = manualError || (manualItems === null ? error : '');

  return createPortal(
    <div className="modal-backdrop shiny-vision-backdrop">
      <div className="modal shiny-vision-internet-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">{brandText("GMX VISION - INTERNET DISCOVERY")}</div>
            <h2>Buscar carta en Internet</h2>
            <p className="section-copy">{brandText("\n              GMX consulta el proveedor externo. Si OCR no leyo bien la carta,\n              puedes corregir la busqueda aqui.\n            ")}


            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>X</button>
        </div>

        <div className="shiny-vision-manual-search">
          <input
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                searchInternet();
              }
            }}
            placeholder="Ej. D. Human, SDK-030 o 81057959"
            autoComplete="off" />
          
          <button type="button" disabled={manualBusy} onClick={searchInternet}>
            {manualBusy ? 'Buscando...' : 'Buscar en Internet'}
          </button>
        </div>

        <div className="shiny-vision-search-help">
          Puedes buscar por <strong>nombre</strong>, <strong>set code</strong> o
          <strong> passcode</strong>. Para D. Human: SDK-030 / 81057959.
        </div>

        {busy ? <div className="message">Consultando proveedor externo...</div> : null}
        {visibleError ? <div className="shiny-pos-camera-error">{visibleError}</div> : null}

        {!busy && !visibleError && !rows.length ?
        <div className="public-empty">
            No hay una coincidencia suficientemente confiable.
          </div> : null}

        <div className="shiny-vision-external-grid">
          {rows.map((x, i) =>
          <article className="shiny-vision-external-card" key={`${x.externalId}-${i}`}>
              <div className="shiny-vision-external-image">
                {x.imageSmall || x.imageUrl ?
              <img src={x.imageSmall || x.imageUrl} alt={x.name} /> :
              <div className="shiny-vision-no-image">Sin imagen</div>}
              </div>

              <div className="shiny-vision-external-info">
                <small>{x.source || 'INTERNET'} - Yu-Gi-Oh!</small>
                <h3>{x.name}</h3>

                <div className="shiny-vision-external-meta">
                  {x.passcode ? <span>Passcode {x.passcode}</span> : null}
                  {x.setCode ? <span>{x.setCode}</span> : null}
                  {x.setName ? <span>{x.setName}</span> : null}
                  {x.rarity ? <span>{x.rarity}</span> : null}
                  {x.matchedBy ? <span>{x.matchedBy}</span> : null}
                  <span>Coincidencia {Math.round(Number(x.score || 0) * 100)}%</span>
                </div>

                <div className="shiny-vision-external-prices">
                  {price(x.prices?.tcgplayer) ?
                <span>TCGplayer {price(x.prices.tcgplayer)}</span> :
                null}
                  {price(x.prices?.cardmarket) ?
                <span>Cardmarket {price(x.prices.cardmarket)}</span> :
                null}
                </div>

                <button type="button" onClick={() => onPick?.(x)}>
                  Seleccionar carta
                </button>
              </div>
            </article>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
