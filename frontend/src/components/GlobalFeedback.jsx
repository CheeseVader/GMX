import { brandText } from "../config/brand.js";import { useEffect, useMemo, useRef, useState } from 'react';

let notifyExternal = null;
let confirmExternal = null;

export function notify(message, options = {}) {
  if (notifyExternal) return notifyExternal(message, options);
  console.info(brandText("[GMX]"), message);
}
export function confirmAction(message, options = {}) {
  if (confirmExternal) return confirmExternal(message, options);
  return Promise.resolve(window.confirm(message));
}

function inferType(text) {
  const t = String(text || '').toLowerCase();
  if (/error|invalid|incorrect|fall|rechaz|no pud|no existe|deneg|agotad|sin stock|caduc|expir|bloquead/.test(t)) return 'error';
  if (/elimin|cancel|despublic|cerrar|advert|pendiente|requiere|debes/.test(t)) return 'warning';
  if (/actualiz|guardad|cread|confirmad|exitos|aplicad|recibid|enviado|publicad|sesión iniciada|sesion iniciada/.test(t)) return 'success';
  return 'info';
}

export default function GlobalFeedback() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const recent = useRef(new Map());

  function push(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) return;

    const now = Date.now();
    const type = options.type || inferType(text);
    const normalizedType = String(type || 'info').toLowerCase();

    /*
     * Shiny GLOBAL UX V5
     * Cuando GlobalOperationProgress ya representa un fallo en modal,
     * NO se admite ningún toast, sin importar cómo haya sido clasificado
     * (info/success/warning/error). Esto evita duplicados aun cuando
     * el mensaje automático haya sido inferido como "info".
     *
     * Cubre:
     *   1) window.shinyNotify(...)
     *   2) notify(...) exportado
     *   3) MutationObserver de .message/.alert.error/etc.
     */
    const suppressUntil = Number(window.__SHINY_SUPPRESS_ERROR_TOAST_UNTIL || 0);
    const operationSuppress =
    typeof window.shinyOperation?.shouldSuppressErrorToast === 'function' ?
    window.shinyOperation.shouldSuppressErrorToast() :

    typeof window.shinyOperation?.hasBlockingError === 'function' &&
    window.shinyOperation.hasBlockingError();


    if (operationSuppress || suppressUntil > now) {
      return false;
    }

    const last = recent.current.get(text) || 0;
    if (now - last < 1200) return false;
    recent.current.set(text, now);

    const id = `shiny-toast-${now}-${Math.random().toString(16).slice(2)}`;
    const ttl = Number(options.duration ?? (normalizedType === 'error' ? 7000 : 4500));
    setToasts((current) => [...current.slice(-4), { id, text, type: normalizedType, title: options.title || '' }]);
    if (ttl > 0) setTimeout(() => setToasts((current) => current.filter((x) => x.id !== id)), ttl);
    return true;
  }

  function ask(message, options = {}) {
    return new Promise((resolve) => {
      setDialog({
        message: String(message || '¿Deseas continuar?'),
        title: options.title || 'Confirmar acción',
        confirmText: options.confirmText || 'Confirmar',
        cancelText: options.cancelText || 'Cancelar',
        type: options.type || 'warning',
        resolve
      });
    });
  }

  useEffect(() => {
    notifyExternal = push;
    confirmExternal = ask;
    window.shinyNotify = push;
    window.shinyConfirm = ask;

    const clearOperationErrorToasts = () => {
      setToasts([]);
      recent.current.clear();
    };
    window.addEventListener('shiny:operation-error-modal', clearOperationErrorToasts);

    return () => {
      window.removeEventListener('shiny:operation-error-modal', clearOperationErrorToasts);
      notifyExternal = null;
      confirmExternal = null;
      delete window.shinyNotify;
      delete window.shinyConfirm;
    };
  }, []);

  useEffect(() => {
    const selectors = [
    '.message',
    '.checkout-message',
    '.alert.error',
    '.commercial-alert',
    '.commercial-errors',
    '.public-system-message.error'].
    join(',');

    function inspect(root) {
      if (!(root instanceof Element)) return;
      const nodes = [];
      if (root.matches?.(selectors)) nodes.push(root);
      root.querySelectorAll?.(selectors).forEach((x) => nodes.push(x));
      for (const node of nodes) {
        const text = node.textContent?.trim();
        if (text && node.offsetParent !== null) push(text);
      }
    }

    document.querySelectorAll(selectors).forEach(inspect);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          inspect(record.target.parentElement);
        } else {
          record.addedNodes.forEach((n) => {if (n instanceof Element) inspect(n);});
          if (record.target instanceof Element) inspect(record.target);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  function closeDialog(answer) {
    const d = dialog;
    setDialog(null);
    d?.resolve?.(answer);
  }

  const icons = useMemo(() => ({ success: '✓', error: '!', warning: '!', info: 'i' }), []);

  return <>
    <div className="shiny-toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => <div key={t.id} className={`shiny-toast ${t.type}`}>
        <span className="shiny-toast-icon">{icons[t.type] || 'i'}</span>
        <div className="shiny-toast-copy">
          {t.title ? <b>{t.title}</b> : null}
          <span>{t.text}</span>
        </div>
        <button aria-label="Cerrar mensaje" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
      </div>)}
    </div>

    {dialog ? <div className="shiny-confirm-backdrop" role="presentation" onMouseDown={() => closeDialog(false)}>
      <div className={`shiny-confirm-dialog ${dialog.type}`} role="dialog" aria-modal="true" aria-labelledby="shiny-confirm-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="shiny-confirm-symbol">{icons[dialog.type] || '!'}</div>
        <div className="shiny-confirm-body">
          <h2 id="shiny-confirm-title">{dialog.title}</h2>
          <p>{dialog.message}</p>
        </div>
        <div className="shiny-confirm-actions">
          <button className="secondary" autoFocus onClick={() => closeDialog(false)}>{dialog.cancelText}</button>
          <button className={dialog.type === 'error' ? 'danger' : ''} onClick={() => closeDialog(true)}>{dialog.confirmText}</button>
        </div>
      </div>
    </div> : null}
  </>;
}
