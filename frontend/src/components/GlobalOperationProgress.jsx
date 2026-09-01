import { brandText } from "../config/brand.js";import { useEffect, useRef, useState } from 'react';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

function estimateRemaining(job, elapsed) {
  if (job?.etaSeconds != null && Number.isFinite(Number(job.etaSeconds))) return Math.max(0, Number(job.etaSeconds));
  const progress = Math.max(1, Math.min(99, Number(job?.progress || 1)));
  if (elapsed < 2) return null;
  return Math.max(1, Math.round(elapsed * (100 - progress) / progress));
}

function inferTitle(url = '', method = 'POST') {
  const u = String(url).toLowerCase();
  if (u.includes('sync')) return 'Sincronizando información';
  if (u.includes('import')) return 'Importando información';
  if (u.includes('upload') || u.includes('media')) return 'Subiendo archivo';
  if (method === 'DELETE') return 'Eliminando información';
  if (method === 'PATCH' || method === 'PUT') return 'Actualizando información';
  return 'Guardando información';
}

function inferDetail(url = '') {
  const u = String(url).toLowerCase();
  if (u.includes('tcg')) return 'Procesando catálogo TCG…';
  if (u.includes('product')) return 'Procesando productos…';
  if (u.includes('client')) return 'Procesando cliente…';
  if (u.includes('order') || u.includes('pedido')) return 'Procesando pedido…';
  if (u.includes('inventory') || u.includes('inventario')) return 'Procesando inventario…';
  if (u.includes('content') || u.includes('media')) return 'Procesando contenido…';
  return brandText("GMX está procesando la operación…");
}

function friendlyOperationError(error) {
  const raw = String(error?.message || error || '').trim();
  const code = raw.toUpperCase();
  const baseCode = code.split(':', 1)[0];

  const known = {
    INSUFFICIENT_STOCK: {
      title: 'Stock insuficiente',
      detail: 'No hay suficientes unidades disponibles para realizar esta operación.'
    },
    INVALID_QUANTITY: {
      title: 'Cantidad inválida',
      detail: 'Ingresa una cantidad válida mayor que cero.'
    },
    RETURN_NOTHING_AVAILABLE: {
      title: 'No se puede procesar la devolución',
      detail: 'Todos los artículos de este pedido ya fueron devueltos. No hay unidades disponibles para devolución.'
    },
    PRODUCT_NOT_FOUND: {
      title: 'Producto no encontrado',
      detail: 'El producto seleccionado ya no está disponible o no existe.'
    },
    INVENTORY_NOT_FOUND: {
      title: 'Inventario no encontrado',
      detail: 'No existe inventario del producto seleccionado en esta sucursal.'
    },
    BRANCH_NOT_FOUND: {
      title: 'Sucursal no encontrada',
      detail: 'La sucursal seleccionada no existe o ya no está disponible.'
    },
    BRANCH_FORBIDDEN: {
      title: 'No tienes acceso a este pedido',
      detail: 'El pedido pertenece a una sucursal fuera de tu alcance. Solo puedes procesar devoluciones de las sucursales que tienes asignadas.'
    },
    SAME_BRANCH_TRANSFER: {
      title: 'Transferencia no válida',
      detail: 'La sucursal de origen y la sucursal de destino deben ser diferentes.'
    },
    SAME_ORIGIN_DESTINATION: {
      title: 'Transferencia no válida',
      detail: 'La sucursal de origen y la sucursal de destino deben ser diferentes.'
    },
    INSUFFICIENT_CASH_BALANCE: {
      title: 'Efectivo insuficiente en caja',
      detail: 'El saldo disponible no alcanza para registrar esta salida.'
    },
    INVALID_MOVEMENT_CATEGORY: {
      title: 'Motivo de movimiento no válido',
      detail: 'El motivo seleccionado no corresponde al tipo de movimiento de caja.'
    },
    INVALID_AMOUNT: {
      title: 'Importe no válido',
      detail: 'Captura un importe mayor a cero.'
    },
    NO_OPEN_CASH: {
      title: 'No hay una caja abierta',
      detail: 'Debes abrir una caja para esta sucursal antes de registrar movimientos.'
    },
    CASH_ALREADY_OPEN: {
      title: 'La caja ya está abierta',
      detail: 'Ya existe una caja abierta para esta sucursal.'
    },
    INSUFFICIENT_CASH_BALANCE: {
      title: 'Efectivo insuficiente en caja',
      detail: 'El saldo disponible no alcanza para registrar esta salida.'
    },
    INVALID_MOVEMENT_CATEGORY: {
      title: 'Motivo de movimiento no válido',
      detail: 'El motivo seleccionado no corresponde al tipo de movimiento de caja.'
    },
    INVALID_AMOUNT: {
      title: 'Importe no válido',
      detail: 'Captura un importe mayor a cero.'
    },
    NO_OPEN_CASH: {
      title: 'No hay una caja abierta',
      detail: 'Debes abrir una caja para esta sucursal antes de registrar movimientos.'
    },
    CASH_ALREADY_OPEN: {
      title: 'La caja ya está abierta',
      detail: 'Ya existe una caja abierta para esta sucursal.'
    },
    NO_OPEN_CASH_FOR_RETURN_REFUND: {
      title: 'No se puede procesar el reembolso',
      detail: 'No hay una caja abierta en la sucursal actual. Para realizar un reembolso en efectivo, primero debes abrir una caja en esta sucursal e intentar nuevamente.'
    },
    RETURN_QTY_EXCEEDS_SOLD: {
      title: 'Cantidad de devolución no válida',
      detail: 'La cantidad solicitada supera las unidades disponibles para devolución de este artículo. Revisa la cantidad e intenta nuevamente.'
    },
    EMPTY_RETURN: {
      title: 'No hay artículos para devolver',
      detail: 'Selecciona al menos una partida y una cantidad mayor que cero para procesar la devolución.'
    },
    RETURN_REASON_REQUIRED: {
      title: 'Falta el motivo de la devolución',
      detail: 'Captura el motivo de la devolución antes de continuar.'
    },
    ORDER_NOT_FOUND: {
      title: 'Pedido no encontrado',
      detail: 'No se encontró el pedido solicitado. Verifica el número de pedido e intenta nuevamente.'
    },
    ORDER_NOT_PAID: {
      title: 'El pedido no admite devolución',
      detail: 'Solo se pueden procesar devoluciones de pedidos que se encuentren pagados.'
    },
    RETURN_ITEM_CONDITION_INVALID: {
      title: 'Condición del artículo no válida',
      detail: 'Selecciona una condición válida para el artículo que deseas devolver.'
    }
  };

    // GMX_TOURNAMENT_FRIENDLY_ERRORS_R7E2
  if(raw.startsWith('TOURNAMENT_ALREADY_REGISTERED|')){
    const tournament=raw.split('|').slice(1).join('|').trim();
    return {
      title:'Jugador ya inscrito',
      detail:tournament
        ? `Este jugador ya se encuentra inscrito en el torneo "${tournament}".`
        : 'Este jugador ya se encuentra inscrito en este torneo.',
      code:'TOURNAMENT_ALREADY_REGISTERED'
    };
  }

  if(
    baseCode==='TOURNAMENT_ALREADY_REGISTERED' ||
    baseCode==='PLAYER_ALREADY_REGISTERED' ||
    baseCode==='TOURNAMENT_REGISTRATION_EXISTS' ||
    /(?:TOURNAMENT|PLAYER).*ALREADY.*REGISTERED/.test(baseCode)
  ){
    return {
      title:'Jugador ya inscrito',
      detail:'Este jugador ya se encuentra inscrito en este torneo.',
      code:baseCode
    };
  }

  if(
    baseCode==='MEMBERSHIP_EXPIRED' ||
    baseCode==='MEMBERSHIP_INACTIVE' ||
    baseCode==='MEMBERSHIP_NOT_ACTIVE' ||
    baseCode==='MEMBERSHIP_NOT_VALID' ||
    /MEMBERSHIP.*(?:EXPIRED|INACTIVE|NOT_ACTIVE|NOT_VALID)/.test(baseCode)
  ){
    return {
      title:'Membresia no vigente',
      detail:'La membresia del jugador esta vencida o no se encuentra activa para este torneo.',
      code:baseCode
    };
  }

  if(
    baseCode==='MEMBERSHIP_NO_ENTRIES' ||
    baseCode==='MEMBERSHIP_ENTRIES_EXHAUSTED' ||
    baseCode==='MEMBERSHIP_INSUFFICIENT_ENTRIES' ||
    baseCode==='INSUFFICIENT_MEMBERSHIP_ENTRIES' ||
    /MEMBERSHIP.*(?:NO_ENTRIES|ENTRIES_EXHAUSTED|INSUFFICIENT_ENTRIES)/.test(baseCode)
  ){
    return {
      title:'Sin entradas suficientes',
      detail:'La membresia no cuenta con entradas suficientes para inscribir al jugador en este torneo.',
      code:baseCode
    };
  }

  if(
    baseCode==='MEMBERSHIP_WEEKLY_LIMIT' ||
    baseCode==='MEMBERSHIP_WEEKLY_LIMIT_REACHED' ||
    baseCode==='MEMBERSHIP_WEEKLY_ENTRY_ALREADY_USED' ||
    baseCode==='WEEKLY_MEMBERSHIP_LIMIT' ||
    /MEMBERSHIP.*WEEKLY.*(?:LIMIT|USED|REACHED)/.test(baseCode)
  ){
    return {
      title:'Entrada semanal ya utilizada',
      detail:'El jugador ya utilizo la entrada incluida de su membresia esta semana. No cuenta con otra entrada disponible para este periodo.',
      code:baseCode
    };
  }
  // GMX_TOURNAMENT_DUPLICATE_FRIENDLY_R7E4
  if(String(raw||'').startsWith('TOURNAMENT_ALREADY_REGISTERED|')){
    const tournament=String(raw||'').substring('TOURNAMENT_ALREADY_REGISTERED|'.length).trim();
    return {
      title:'Jugador ya inscrito',
      detail:tournament
        ? `Este jugador ya se encuentra inscrito en el torneo "${tournament}". No es necesario volver a registrarlo.`
        : 'Este jugador ya se encuentra inscrito en este torneo. No es necesario volver a registrarlo.',
      code:'TOURNAMENT_ALREADY_REGISTERED'
    };
  }
if (known[baseCode]) return { ...known[baseCode], code: baseCode };

  // No exponer códigos técnicos puros como mensaje principal.
  if (/^[A-Z][A-Z0-9_]+$/.test(raw)) {
    return {
      title: 'No se pudo completar la operación',
      detail: 'La operación fue rechazada. Revisa los datos e inténtalo nuevamente.',
      code: raw
    };
  }

  return {
    title: 'No se pudo completar la operación',
    detail: raw || 'No fue posible completar la operación.',
    code: ''
  };
}

export default function GlobalOperationProgress() {
  const [job, setJob] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const activeRef = useRef(new Map());
  const originalFetchRef = useRef(null);
  const timersRef = useRef(new Map());

  useEffect(() => {
    function emit(next) {
      setJob(next);
      if (!next) setElapsed(0);
    }

    /*
     * Shiny GLOBAL UX
     * Si ya existe un modal central de error/advertencia, no mostrar
     * un toast de error/warning encima con el mismo propósito.
     *
     * Se usa un accessor para cubrir también componentes que asignen
     * window.shinyNotify DESPUÉS de montar GlobalOperationProgress.
     */
    let notifyImpl = typeof window.shinyNotify === 'function' ? window.shinyNotify : null;
    const notifyDescriptor = Object.getOwnPropertyDescriptor(window, 'shinyNotify');
    let notifyAccessorInstalled = false;

    function hasBlockingErrorModal() {
      const current = [...activeRef.current.values()].at(-1);
      return Boolean(current && current.status === 'error');
    }

    function shouldSuppressNotify(args) {
      if (!hasBlockingErrorModal()) return false;

      const options = args && typeof args[1] === 'object' && args[1] || {};
      const type = String(
        options.type ||
        options.variant ||
        options.status ||
        options.level ||
        ''
      ).toLowerCase();

      // Con modal de error activo, suprimir cualquier toast que sea
      // también error/advertencia. Éxitos/info siguen permitidos.
      return ['error', 'warning', 'warn', 'danger', 'alert'].includes(type);
    }

    function notifyProxy(...args) {
      if (shouldSuppressNotify(args)) return false;
      if (typeof notifyImpl === 'function') return notifyImpl(...args);
      return false;
    }

    try {
      Object.defineProperty(window, 'shinyNotify', {
        configurable: true,
        enumerable: true,
        get() {
          return notifyProxy;
        },
        set(fn) {
          if (fn !== notifyProxy) notifyImpl = fn;
        }
      });
      notifyAccessorInstalled = true;
    } catch {
      // Fallback seguro si otro código creó una propiedad no configurable.
      if (typeof window.shinyNotify === 'function') {
        notifyImpl = window.shinyNotify;
        window.shinyNotify = notifyProxy;
      }
    }

    function stopTimer(id) {
      const timer = timersRef.current.get(id);
      if (timer) clearInterval(timer);
      timersRef.current.delete(id);
    }

    function startEstimated(id, title, detail) {
      const startedAt = Date.now();
      const state = { id, title, detail, progress: 3, mode: 'estimated', startedAt, status: 'working', closable: false };
      activeRef.current.set(id, state);
      emit(state);

      const timer = setInterval(() => {
        const current = activeRef.current.get(id);
        if (!current || current.mode !== 'estimated') return;
        const age = (Date.now() - current.startedAt) / 1000;
        const target = Math.min(92,
        age < 2 ? 10 + age * 9 :
        age < 8 ? 28 + (age - 2) * 5 :
        age < 30 ? 58 + (age - 8) * 1.15 :
        84 + (age - 30) * 0.12
        );
        current.progress = Math.max(current.progress, Math.round(target));
        activeRef.current.set(id, { ...current });
        emit({ ...current });
      }, 450);
      timersRef.current.set(id, timer);
      return state;
    }

    function manualStart(options = {}) {
      const id = options.id || `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const state = {
        id,
        title: options.title || 'Procesando',
        detail: options.detail || brandText("GMX está trabajando…"),
        progress: Number(options.progress ?? 0),
        mode: 'manual',
        startedAt: Date.now(),
        status: 'working',
        closable: false,
        etaSeconds: options.etaSeconds ?? null,
        meta: options.meta || null
      };
      activeRef.current.set(id, state);
      emit(state);
      return id;
    }

    function manualUpdate(id, patch = {}) {
      const current = activeRef.current.get(id);
      if (!current) return;
      const next = {
        ...current,
        ...patch,
        progress: Math.max(0, Math.min(100, Number(patch.progress ?? current.progress)))
      };
      activeRef.current.set(id, next);
      emit(next);
    }

    function finish(id, options = {}) {
      stopTimer(id);
      const current = activeRef.current.get(id);
      if (!current) return;
      const next = {
        ...current,
        progress: 100,
        title: options.title || current.title,
        detail: options.detail || 'Operación completada correctamente.',
        status: 'success',
        closable: true
      };
      activeRef.current.set(id, next);
      emit(next);
      setTimeout(() => {
        activeRef.current.delete(id);
        if (activeRef.current.size === 0) emit(null);
      }, options.keepMs ?? 900);
    }

    function fail(id, error) {
      stopTimer(id);
      const current = activeRef.current.get(id);
      if (!current) return;

      /*
       * Shiny GLOBAL UX V4
       * El código de la página recibe el error después de este punto y puede:
       * - llamar window.shinyNotify(...)
       * - pintar .message/.alert.error, que GlobalFeedback observa
       *
       * Mantener una ventana de supresión evita ambos duplicados incluso
       * si React/MutationObserver procesan el mensaje en otro microtask.
       */
      window.__SHINY_SUPPRESS_ERROR_TOAST_UNTIL = Date.now() + 2500;

      // Si un toast alcanzó a crearse en el mismo ciclo/microtask,
      // GlobalFeedback lo elimina inmediatamente.
      try {
        window.dispatchEvent(new CustomEvent('shiny:operation-error-modal'));
      } catch {}

      const friendly = friendlyOperationError(error);
      const next = {
        ...current,
        title: friendly.title,
        detail: friendly.detail,
        errorCode: friendly.code || '',
        status: 'error',
        closable: true
      };
      activeRef.current.set(id, next);
      emit(next);
    }

    window.shinyOperation = {
      start: manualStart,
      update: manualUpdate,
      complete: finish,
      fail,
      hasBlockingError: hasBlockingErrorModal,
      shouldSuppressErrorToast() {
        return hasBlockingErrorModal() ||
        Number(window.__SHINY_SUPPRESS_ERROR_TOAST_UNTIL || 0) > Date.now();
      },
      close(id) {
        const target = id || job?.id;
        if (!target) return;
        stopTimer(target);
        activeRef.current.delete(target);
        const remaining = [...activeRef.current.values()];
        emit(remaining.length ? remaining[remaining.length - 1] : null);
      }
    };

    const nativeFetch = window.fetch.bind(window);
    originalFetchRef.current = nativeFetch;

    window.fetch = async (input, init = {}) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});
      const manual = headers.get("X-TCG-Store-Template-Progress") === 'manual';
      if (manual) headers.delete("X-TCG-Store-Template-Progress");

      const url = typeof input === 'string' ? input : input?.url || '';
      const shouldTrack = MUTATING.has(method) && !manual && !String(url).includes('/api/auth/me');
      const id = shouldTrack ? `fetch-${Date.now()}-${Math.random().toString(16).slice(2)}` : null;

      if (shouldTrack) startEstimated(id, inferTitle(url, method), inferDetail(url));

      try {
        const response = await nativeFetch(input, { ...init, headers });
        if (shouldTrack) {
          if (response.ok) {
            finish(id, { detail: 'Operación completada correctamente.' });
          } else {
            let detail = `La operación terminó con HTTP ${response.status}.`;
            try {
              const body = await response.clone().json();
              detail = String(body?.message || body?.error || detail);
            } catch {}
            fail(id, detail);
          }
        }
        return response;
      } catch (error) {
        if (shouldTrack) fail(id, error);
        throw error;
      }
    };

    const elapsedTimer = setInterval(() => {
      const current = [...activeRef.current.values()].at(-1);
      setElapsed(current ? Math.max(0, (Date.now() - current.startedAt) / 1000) : 0);
    }, 250);

    return () => {
      clearInterval(elapsedTimer);
      timersRef.current.forEach(clearInterval);
      timersRef.current.clear();
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      delete window.shinyOperation;
      delete window.__SHINY_SUPPRESS_ERROR_TOAST_UNTIL;

      // Restaurar el notificador global original al desmontar.
      try {
        if (notifyAccessorInstalled) {
          if (notifyDescriptor) {
            Object.defineProperty(window, 'shinyNotify', notifyDescriptor);
          } else {
            delete window.shinyNotify;
            if (typeof notifyImpl === 'function') window.shinyNotify = notifyImpl;
          }
        } else if (window.shinyNotify === notifyProxy && typeof notifyImpl === 'function') {
          window.shinyNotify = notifyImpl;
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (job?.status !== 'error') return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') window.shinyOperation?.close(job.id);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [job?.id, job?.status]);

  if (!job) return null;

  const progress = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
  const isWorking = job.status === 'working';
  const isError = job.status === 'error';
  const remaining = isWorking ? estimateRemaining(job, elapsed) : 0;

  return <div className="shiny-operation-backdrop" role="dialog" aria-modal="true" aria-live="polite" onMouseDown={(event) => {if (isError && event.target === event.currentTarget) window.shinyOperation?.close(job.id);}}>
    <section className={`shiny-operation-modal ${job.status || 'working'}`}>
      <div className="shiny-operation-head">
        <div>
          <span className="shiny-operation-kicker">
            {job.status === 'success' ? 'COMPLETADO' : isError ? 'ATENCIÓN' : brandText("GMX PROCESANDO")}
          </span>
          <h3>{job.title}</h3>
        </div>
        {job.closable ? <button type="button" className="shiny-operation-close" aria-label="Cerrar" onClick={() => window.shinyOperation?.close(job.id)}>×</button> : null}
      </div>

      <p className="shiny-operation-detail">{job.detail}</p>

      {!isError ? <>
        <div className="shiny-operation-progress-meta">
          <span>{job.mode === 'estimated' ? 'Progreso estimado' : 'Progreso'}</span>
          <strong>{progress}%</strong>
        </div>

        <div className="shiny-operation-progress-track" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
          <div className="shiny-operation-progress-bar" style={{ width: `${progress}%` }} />
        </div>

        {job.meta ? <div className="shiny-operation-meta">
          {job.meta.setsTotal != null ? <span>Expansiones: <strong>{job.meta.setsDone || 0}/{job.meta.setsTotal}</strong></span> : null}
          {job.meta.cardsTotal != null ? <span>Cartas: <strong>{job.meta.cardsDone || 0}/{job.meta.cardsTotal}</strong></span> : null}
          {job.meta.currentSet ? <span>Actual: <strong>{job.meta.currentSet}</strong></span> : null}
        </div> : null}

        <div className="shiny-operation-foot">
          <span>Tiempo restante estimado: <strong>{isWorking ? remaining == null ? 'Calculando…' : formatElapsed(remaining) : '0s'}</strong></span>
          {isWorking ? <span>No cierres esta ventana.</span> : null}
        </div>
      </> : null}

      {isError ? <div className="shiny-operation-actions">
        <button type="button" className="secondary" onClick={() => window.shinyOperation?.close(job.id)}>Cerrar</button>
      </div> : null}
    </section>
  </div>;
}
