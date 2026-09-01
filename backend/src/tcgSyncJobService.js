import { brandText } from "./config/brand.js";import { randomUUID } from 'node:crypto';
import { syncSelectedCards, installSelectedToOperational } from './tcgCatalogSyncService.js';

const jobs = new Map();
const TTL_MS = 60 * 60 * 1000;

function now() {return Date.now();}
function safeText(v, max = 300) {return String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, max);}

function computeEta(job) {
  if (!job || job.status !== 'running') return 0;
  const progress = Math.max(1, Math.min(99, Number(job.progress || 1)));
  const elapsed = (now() - job.startedAt) / 1000;
  if (elapsed < 2) return null;
  return Math.max(1, Math.round(elapsed * (100 - progress) / progress));
}

function setJob(id, patch = {}) {
  const current = jobs.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: now() };
  if (next.status === 'running') next.etaSeconds = computeEta(next);
  if (next.progress >= 100) next.etaSeconds = 0;
  jobs.set(id, next);
  return next;
}

function cleanup() {
  const cutoff = now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff && job.status !== 'running') jobs.delete(id);
  }
}

function progressFromPayload(payload = {}) {
  const setsTotal = Math.max(1, Number(payload.selectedSets || 1));
  const setsDone = Math.max(0, Number(payload.processedSets || 0));
  const estimatedCards = Math.max(1, Number(payload.estimatedCards || 1));
  const cardsDone = Math.max(0, Number(payload.processedCards || 0));

  // 5..84 belongs to card synchronization.
  const cardRatio = Math.min(1, cardsDone / estimatedCards);
  const setRatio = Math.min(1, setsDone / setsTotal);
  const blended = Math.max(cardRatio, setRatio * 0.92);
  return Math.max(5, Math.min(84, Math.round(5 + blended * 79)));
}

export function startTcgAddJob(gameCode, { setCodes = [], downloadImages = false, syncPrices = true } = {}) {
  cleanup();
  const id = randomUUID();
  const selected = [...new Set((setCodes || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const startedAt = now();

  jobs.set(id, {
    id, gameCode, status: 'running', progress: 1, phase: 'queued',
    message: 'Preparando trabajo…', startedAt, updatedAt: startedAt, etaSeconds: null,
    selectedSets: selected.length, processedSets: 0, processedCards: 0, estimatedCards: 0,
    currentSet: null, result: null, error: null
  });

  queueMicrotask(async () => {
    try {
      setJob(id, { progress: 3, phase: 'preparing', message: 'Validando expansiones seleccionadas…' });

      const syncResult = await syncSelectedCards(gameCode, {
        setCodes: selected,
        downloadImages,
        syncPrices,
        incremental: true,
        onProgress: async (payload) => {
          setJob(id, {
            progress: progressFromPayload(payload),
            phase: payload.phase || 'syncing',
            message: safeText(payload.message || 'Sincronizando cartas…'),
            selectedSets: Number(payload.selectedSets || selected.length),
            processedSets: Number(payload.processedSets || 0),
            processedCards: Number(payload.processedCards || 0),
            estimatedCards: Number(payload.estimatedCards || 0),
            currentSet: payload.setCode || null,
            setActualCards: Number(payload.setActualCards || 0),
            setProcessedCards: Number(payload.setProcessedCards || 0)
          });
        }
      });

      if ((syncResult.errors || []).length) {
        const detail = syncResult.errors.map((x) => `${x.setCode}: ${x.error}`).join(' | ');
        throw new Error(`SYNC_PARTIAL_ERROR:${detail}`);
      }

      setJob(id, {
        progress: 88, phase: 'installing',
        message: 'Instalando expansiones y cartas en el catálogo operativo…',
        processedCards: syncResult.cards
      });

      const installResult = await installSelectedToOperational(gameCode, selected);

      setJob(id, {
        progress: 97, phase: 'finalizing',
        message: 'Actualizando catálogo de la tienda…'
      });

      setJob(id, {
        progress: 100, status: 'completed', phase: 'completed',
        message: brandText("Las expansiones ya están disponibles en GMX."),
        etaSeconds: 0,
        result: {
          sync: syncResult,
          install: installResult,
          incrementalSummary: {
            insertedCards: syncResult.insertedCards || 0,
            updatedCards: syncResult.updatedCards || 0,
            unchangedCards: syncResult.unchangedCards || 0,
            updatedPrices: syncResult.updatedPrices || 0,
            unchangedPrices: syncResult.unchangedPrices || 0
          }
        }
      });
    } catch (e) {
      setJob(id, {
        status: 'failed',
        phase: 'failed',
        message: 'No fue posible completar la operación.',
        error: safeText(e?.message || e, 900),
        etaSeconds: null
      });
    }
  });

  return jobs.get(id);
}

export function getTcgAddJob(jobId) {
  cleanup();
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'running') {
    job.etaSeconds = computeEta(job);
    jobs.set(jobId, job);
  }
  return { ...job };
}
