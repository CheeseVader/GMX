import { brandText } from "../config/brand.js";import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createWorker } from 'tesseract.js';

import { identifyLocalVisualCard } from '../utils/localVisualMatch.js';
function unique(values = []) {
  return [...new Set(
    values.
    map((x) => String(x || '').trim()).
    filter(Boolean)
  )];
}

function makeCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function cropCanvas(
source,
x,
y,
w,
h,
{
  scale = 3,
  mode = 'gray'
} = {})
{
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.round(source.width * w));
  const sh = Math.max(1, Math.round(source.height * h));

  const out = makeCanvas(sw * scale, sh * scale);
  const ctx = out.getContext('2d', { willReadFrequently: true });

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    source,
    sx, sy, sw, sh,
    0, 0, out.width, out.height
  );

  const image = ctx.getImageData(0, 0, out.width, out.height);
  const d = image.data;

  for (let i = 0; i < d.length; i += 4) {

    const gray = Math.round(
      d[i] * 0.299 +
      d[i + 1] * 0.587 +
      d[i + 2] * 0.114
    );

    let v = gray;

    if (mode === 'contrast') {
      v = Math.max(
        0,
        Math.min(
          255,
          Math.round((gray - 128) * 2.2 + 128)
        )
      );
    }

    if (mode === 'threshold') {
      v = gray > 145 ? 255 : 0;
    }

    if (mode === 'threshold-dark') {
      v = gray > 115 ? 255 : 0;
    }

    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }

  ctx.putImageData(image, 0, 0);

  return out;
}


function grayAt(data, width, x, y) {
  const i = (y * width + x) * 4;
  return (
    data[i] * 0.299 +
    data[i + 1] * 0.587 +
    data[i + 2] * 0.114);

}

function detectCardRectangle(source) {
  /*
    Local/offline card border detector:
    - downscale image
    - compute edge energy
    - find likely vertical/horizontal border lines
    - score rectangles close to Yu-Gi-Oh!/TCG aspect ratio 59:86
  */

  const maxW = 720;
  const scale = Math.min(1, maxW / source.width);

  const w = Math.max(180, Math.round(source.width * scale));
  const h = Math.max(180, Math.round(source.height * scale));

  const small = makeCanvas(w, h);
  const ctx = small.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(
    source,
    0, 0,
    w, h
  );

  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  const colScore = new Float64Array(w);
  const rowScore = new Float64Array(h);

  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {

      const gx =
      grayAt(data, w, x + 1, y) -
      grayAt(data, w, x - 1, y);

      const gy =
      grayAt(data, w, x, y + 1) -
      grayAt(data, w, x, y - 1);

      const mag =
      Math.abs(gx) +
      Math.abs(gy);

      if (mag > 38) {
        colScore[x] += mag;
        rowScore[y] += mag;
      }
    }
  }

  function peaks(scores, count, minDistance) {
    const candidates = [];

    for (let i = 4; i < scores.length - 4; i++) {
      const v = scores[i];
      if (v <= 0) continue;

      let isLocal = true;

      for (let j = -3; j <= 3; j++) {
        if (j !== 0 && scores[i + j] > v) {
          isLocal = false;
          break;
        }
      }

      if (isLocal) {
        candidates.push({ i, v });
      }
    }

    candidates.sort((a, b) => b.v - a.v);

    const selected = [];

    for (const p of candidates) {
      if (
      selected.every(
        (x) => Math.abs(x.i - p.i) >= minDistance
      ))
      {
        selected.push(p);
        if (selected.length >= count) break;
      }
    }

    return selected.
    map((x) => x.i).
    sort((a, b) => a - b);
  }

  const xs = peaks(
    colScore,
    20,
    Math.max(12, Math.round(w * .03))
  );

  const ys = peaks(
    rowScore,
    20,
    Math.max(12, Math.round(h * .03))
  );

  const targetRatio = 59 / 86;
  const frameCx = w / 2;
  const frameCy = h / 2;

  let best = null;

  for (let a = 0; a < xs.length; a++) {
    for (let b = a + 1; b < xs.length; b++) {

      const left = xs[a];
      const right = xs[b];
      const rw = right - left;

      if (rw < w * .18 || rw > w * .90) {
        continue;
      }

      for (let c = 0; c < ys.length; c++) {
        for (let d = c + 1; d < ys.length; d++) {

          const top = ys[c];
          const bottom = ys[d];
          const rh = bottom - top;

          if (rh < h * .25 || rh > h * .96) {
            continue;
          }

          const ratio = rw / rh;

          const ratioError =
          Math.abs(ratio - targetRatio) /
          targetRatio;

          if (ratioError > .38) {
            continue;
          }

          const area = rw * rh / (w * h);

          const cx = (left + right) / 2;
          const cy = (top + bottom) / 2;

          const centerPenalty =
          Math.hypot(
            (cx - frameCx) / w,
            (cy - frameCy) / h
          );

          const borderStrength =
          (
          colScore[left] +
          colScore[right] +
          rowScore[top] +
          rowScore[bottom]) /
          4;

          const score =
          area * 5 +
          Math.min(borderStrength / 2800, 2.7) -
          ratioError * 2.2 -
          centerPenalty * .8;

          if (!best || score > best.score) {
            best = {
              left, right, top, bottom,
              width: rw,
              height: rh,
              ratio,
              ratioError,
              score
            };
          }
        }
      }
    }
  }

  if (!best) {
    return null;
  }

  const marginX = best.width * .025;
  const marginY = best.height * .018;

  const left = Math.max(0, best.left - marginX);
  const right = Math.min(w, best.right + marginX);
  const top = Math.max(0, best.top - marginY);
  const bottom = Math.min(h, best.bottom + marginY);

  return {
    x: left / w,
    y: top / h,
    w: (right - left) / w,
    h: (bottom - top) / h,
    confidence: Math.max(
      0,
      Math.min(
        1,
        .48 +
        Math.min(best.score / 5, .47)
      )
    ),
    debug: {
      ratio: best.ratio,
      ratioError: best.ratioError,
      score: best.score
    }
  };
}

function normalizeDetectedCard(source, rect) {
  if (!rect) {
    return source;
  }

  const sx = Math.max(
    0,
    Math.round(source.width * rect.x)
  );

  const sy = Math.max(
    0,
    Math.round(source.height * rect.y)
  );

  const sw = Math.max(
    1,
    Math.min(
      source.width - sx,
      Math.round(source.width * rect.w)
    )
  );

  const sh = Math.max(
    1,
    Math.min(
      source.height - sy,
      Math.round(source.height * rect.h)
    )
  );

  /*
    Normalize every detected card to a predictable portrait image.
    More pixels in the lower edge = better passcode OCR.
  */
  const targetH = 2000;
  const targetW = Math.round(
    targetH * (59 / 86)
  );

  const out = makeCanvas(
    targetW,
    targetH
  );

  const ctx = out.getContext(
    '2d',
    { willReadFrequently: true }
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    source,
    sx, sy, sw, sh,
    0, 0,
    targetW, targetH
  );

  return out;
}
function cleanLine(v = '') {
  return String(v || '').
  replace(/[|_]/g, ' ').
  replace(/\s+/g, ' ').
  trim();
}

function normalizeName(v = '') {
  return cleanLine(v).
  replace(/[^\p{L}\p{N} .,'/&:+\-]/gu, ' ').
  replace(/\s+/g, ' ').
  trim();
}

function extractEightDigitCandidates(text = '') {
  const raw = String(text || '');

  const direct = [
  ...raw.matchAll(
    /(?:^|\D)(\d{8})(?:\D|$)/g
  )].
  map((m) => m[1]);

  /*
    OCR sometimes inserts spaces or punctuation between digits:
      8105 7959
      8105-7959
      8 1 0 5 7 9 5 9
  */
  const normalized = raw.
  replace(/[Oo]/g, '0').
  replace(/[Il|]/g, '1');

  const groups = [
  ...normalized.matchAll(
    /(?:^|\D)((?:\d[\s.\-:]*){8})(?:\D|$)/g
  )].

  map((m) => m[1].replace(/\D/g, '')).
  filter((x) => x.length === 8);

  return unique([...direct, ...groups]);
}

function cleanEssentialName(v = '') {
  let s = normalizeName(v).
  replace(/\s+(EARTH|DARK|LIGHT|FIRE|WATER|WIND|DIVINE)\s*$/i, '').
  trim();

  // Typical OCR garbage after a valid card title:
  // "D. HUMAN - be" -> "D. HUMAN"
  s = s.replace(/\s+[-|:]\s+[A-Za-z0-9]{1,3}\s*$/, '').trim();

  // Remove a tiny trailing OCR fragment only when title is already meaningful.
  if (s.length >= 5) {
    s = s.replace(/\s+[A-Za-z]{1,2}\s*$/, '').trim();
  }

  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters < 2) return '';

  return s;
}

function parseHints({
  nameText = '',
  setText = '',
  passText = '',
  fullText = ''
}) {
  // VISION004D_R2_ESSENTIAL_ONLY
  // Valid search identifiers:
  // 1) 8-digit passcode
  // 2) printed set code (SDK-030)
  // 3) cleaned card title

  const all = [
  nameText,
  setText,
  passText,
  fullText].
  join('\n');

  const passcodes = extractEightDigitCandidates(all);

  const setCodes = [
  ...all.
  toUpperCase().
  matchAll(
    /\b([A-Z0-9]{2,8}-[A-Z0-9]{2,5})\b/g
  )].
  map((m) => m[1]);

  const blocked =
  /^(EARTH|DARK|LIGHT|FIRE|WATER|WIND|DIVINE|SPELL|TRAP|WARRIOR|DRAGON|MACHINE|FAIRY|ZOMBIE|BEAST|ATK|DEF)$/i;

  const titleLines =
  String(nameText || '').
  split(/\r?\n/).
  map(cleanEssentialName).
  filter((x) => x.length >= 2 && x.length <= 55).
  filter((x) => /[A-Za-z]/.test(x)).
  filter((x) => !blocked.test(x));

  const name = titleLines[0] || '';

  return {
    name,
    setCode: unique(setCodes)[0] || '',
    passcode: passcodes[0] || '',
    passcodes: unique(passcodes),
    setCodes: unique(setCodes)
  };
}

async function detectBarcode(canvas) {
  if (!('BarcodeDetector' in window)) return '';

  try {
    const formats =
    await window.BarcodeDetector.
    getSupportedFormats?.();

    const detector =
    new window.BarcodeDetector({
      formats:
      Array.isArray(formats) && formats.length ?
      formats :
      undefined
    });

    const hits = await detector.detect(canvas);

    return String(
      hits?.[0]?.rawValue || ''
    ).trim();

  } catch {
    return '';
  }
}

async function recognizeDigits(
worker,
canvas,
onStatus,
label)
{
  onStatus?.(label);

  await worker.setParameters({
    tessedit_pageseg_mode: '7',
    tessedit_char_whitelist: '0123456789'
  });

  const r = await worker.recognize(canvas);

  return String(
    r?.data?.text || ''
  ).trim();
}

async function scanPasscodeFirst(
worker,
canvas,
onStatus)
{
  /*
    Yu-Gi-Oh passcode normalmente esta en la franja inferior.
    Probamos varias regiones y preprocesamientos para tolerar:
    - carta descentrada
    - reflexion
    - fondo oscuro
    - resolucion baja
  */

  const regions = [
  {
    name: 'bottom-left-wide',
    x: 0.00, y: 0.86, w: 0.68, h: 0.14
  },
  {
    name: 'bottom-full',
    x: 0.00, y: 0.83, w: 1.00, h: 0.17
  },
  {
    name: 'bottom-left-tight',
    x: 0.00, y: 0.89, w: 0.50, h: 0.10
  },
  {
    name: 'bottom-lower-wide',
    x: 0.00, y: 0.91, w: 0.72, h: 0.09
  }];


  const modes = [
  'gray',
  'contrast',
  'threshold',
  'threshold-dark'];


  const rawTexts = [];

  for (const region of regions) {

    for (const mode of modes) {

      const crop = cropCanvas(
        canvas,
        region.x,
        region.y,
        region.w,
        region.h,
        {
          scale: 6,
          mode
        }
      );

      const text = await recognizeDigits(
        worker,
        crop,
        onStatus,
        `Buscando passcode (${region.name} / ${mode})...`
      );

      rawTexts.push(text);

      const hits = extractEightDigitCandidates(text);

      if (hits.length) {

        return {
          passcode: hits[0],
          passcodes: hits,
          rawTexts,
          region: region.name,
          mode
        };
      }
    }
  }

  return {
    passcode: '',
    passcodes: [],
    rawTexts,
    region: '',
    mode: ''
  };
}

async function ocrCard(canvas, onStatus) {

  const worker = await createWorker('eng');

  try {

    /*
      PRIORIDAD ABSOLUTA:
      1) PASSCODE 8 digitos
      2) SET CODE
      3) NOMBRE
      4) OCR completo
    */

    const pass =
    await scanPasscodeFirst(
      worker,
      canvas,
      onStatus
    );

    /*
      Si encontramos un passcode valido, regresamos de inmediato.
      OrdersPage / VISION-002 ya enviara ese identificador al backend.
      No desperdiciamos tiempo con OCR del nombre.
    */
    if (pass.passcode) {

      return {
        text: pass.passcode,
        lines: [pass.passcode],
        queries: [pass.passcode],
        identificationMethod: 'PASSCODE',
        confidence: 1,
        tcgHints: {
          name: '',
          setCode: '',
          passcode: pass.passcode,
          passcodes: pass.passcodes,
          setCodes: []
        },
        regions: {
          passText: pass.rawTexts.join('\n'),
          passRegion: pass.region,
          passMode: pass.mode,
          nameText: '',
          setText: '',
          fullText: ''
        }
      };
    }

    const top =
    cropCanvas(
      canvas,
      0.025, 0.025, 0.95, 0.17,
      { scale: 5, mode: 'contrast' }
    );

    const setBand =
    cropCanvas(
      canvas,
      0.48, 0.60, 0.50, 0.22,
      { scale: 5, mode: 'contrast' }
    );

    const bottom =
    cropCanvas(
      canvas,
      0.00, 0.83, 1.00, 0.17,
      { scale: 5, mode: 'contrast' }
    );

    const full =
    cropCanvas(
      canvas,
      0.01, 0.01, 0.98, 0.98,
      { scale: 2, mode: 'gray' }
    );

    onStatus?.('Leyendo codigo de set...');

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- '
    });

    const setResult =
    await worker.recognize(setBand);

    const setText =
    String(
      setResult?.data?.text || ''
    ).trim();

    /*
      Intentamos extraer un set code antes de OCR general.
    */
    const preliminary =
    parseHints({
      nameText: '',
      setText,
      passText: '',
      fullText: ''
    });

    if (preliminary.setCode) {

      return {
        text: preliminary.setCode,
        lines: [preliminary.setCode],
        queries: [preliminary.setCode],
        identificationMethod: 'SET_CODE',
        confidence: 0.995,
        tcgHints: {
          ...preliminary
        },
        regions: {
          passText: pass.rawTexts.join('\n'),
          nameText: '',
          setText,
          fullText: ''
        }
      };
    }

    onStatus?.('Leyendo nombre...');

    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: ''
    });

    const nameResult =
    await worker.recognize(top);

    const nameText =
    String(
      nameResult?.data?.text || ''
    ).trim();

    onStatus?.('Leyendo franja inferior...');

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- '
    });

    const passResult =
    await worker.recognize(bottom);

    const passText =
    String(
      passResult?.data?.text || ''
    ).trim();

    /*
      Segunda oportunidad de passcode:
      el OCR libre de la franja inferior a veces funciona mejor
      que digits-only si hay ruido.
    */
    const bottomPass =
    extractEightDigitCandidates(passText);

    if (bottomPass.length) {

      return {
        text: bottomPass[0],
        lines: [bottomPass[0]],
        queries: [bottomPass[0]],
        identificationMethod: 'PASSCODE',
        confidence: 1,
        tcgHints: {
          name: '',
          setCode: '',
          passcode: bottomPass[0],
          passcodes: bottomPass,
          setCodes: []
        },
        regions: {
          passText: [
          ...pass.rawTexts,
          passText].
          join('\n'),
          nameText,
          setText,
          fullText: ''
        }
      };
    }

    onStatus?.('Leyendo carta completa...');

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: ''
    });

    const fullResult =
    await worker.recognize(full);

    const fullText =
    String(
      fullResult?.data?.text || ''
    ).trim();

    const tcgHints =
    parseHints({
      nameText,
      setText,
      passText: [
      ...pass.rawTexts,
      passText].
      join('\n'),
      fullText
    });

    /*
      Incluso despues del OCR completo:
      si aparece un passcode, pasa primero.
    */
    if (tcgHints.passcode) {

      return {
        text: tcgHints.passcode,
        lines: [tcgHints.passcode],
        queries: [tcgHints.passcode],
        identificationMethod: 'PASSCODE',
        confidence: 1,
        tcgHints,
        regions: {
          nameText,
          setText,
          passText: [
          ...pass.rawTexts,
          passText].
          join('\n'),
          fullText
        }
      };
    }
    const lines =
    unique([
    tcgHints.passcode,
    tcgHints.setCode,
    tcgHints.name]
    );

    // VISION004D_R2_QUERY_GATE:
    // Never send full OCR noise to external discovery.
    // VISION004D_R2_IDENTIFIER_GATE: PASSCODE > SET_CODE > NAME
    const queries =
    unique([
    tcgHints.passcode,
    tcgHints.setCode,
    tcgHints.name]
    ).
    filter(Boolean).
    slice(0, 3);

    return {
      text: queries.join('\n'),
      lines,
      queries,
      identificationMethod:
      tcgHints.setCode ?
      'SET_CODE' :
      tcgHints.name ?
      'NAME' :
      'OCR_GENERAL',
      confidence:
      tcgHints.setCode ?
      0.995 :
      tcgHints.name ?
      0.80 :
      0.30,
      tcgHints,
      regions: {
        nameText,
        setText,
        passText: [
        ...pass.rawTexts,
        passText].
        join('\n'),
        fullText
      }
    };

  } finally {

    await worker.terminate();

  }
}

export default function VisionScannerModal({
  open,
  title = 'Reconocer producto o carta',
  onClose,
  onResult
}) {

  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [snapshotCanvas, setSnapshotCanvas] = useState(null);
  const [snapshotReady, setSnapshotReady] = useState(false);

  async function stopCamera() {

    const stream = streamRef.current;

    if (stream) {

      for (const track of stream.getTracks()) {
        track.stop();
      }

    }

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraReady(false);
  }

  function clearSnapshot() {
    if (snapshotUrl) {
      try {URL.revokeObjectURL(snapshotUrl);} catch {}
    }
    setSnapshotUrl('');
    setSnapshotCanvas(null);
    setSnapshotReady(false);
  }
  async function startCamera() {

    clearSnapshot();
    setError('');
    setStatus('Abriendo camara...');

    try {

      await stopCamera();

      const stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {

        videoRef.current.srcObject = stream;

        await videoRef.current.play();

      }

      setCameraReady(true);

      setStatus(brandText("Centra la carta completa. GMX buscara primero el passcode.")

      );

    } catch (e) {

      setError(
        e?.message ||
        'No se pudo abrir la camara.'
      );

      setStatus('');

    }
  }

  useEffect(() => {

    if (!open) {

      stopCamera();

      setBusy(false);
      setStatus('');
      setError('');

    }

    return () => {
      if (!open) stopCamera();
    };

  }, [open]);

  async function analyzeCanvas(canvas) {

    setBusy(true);
    setError('');

    try {

      setStatus('Detectando bordes de la carta...');

      // VISION_R7_FIXED_CARD_DETECTION
      const cardRect =
      detectCardRectangle(canvas);

      const cardCanvas =
      cardRect ?
      normalizeDetectedCard(
        canvas,
        cardRect
      ) :
      canvas;

      console.log(brandText("[GMX Vision] card detection"),

      cardRect || {
        detected: false
      }
      );

      if (cardRect) {

        setStatus(
          `Carta detectada (${Math.round(cardRect.confidence * 100)}%). Buscando passcode...`
        );

      } else {

        setStatus(
          'No se detecto borde completo. Analizando cuadro completo...'
        );
      }


      // VISION004B_LOCAL_VISUAL_MATCH
      setStatus('Comparando visualmente con referencias locales...');

      try {
        const visual = await identifyLocalVisualCard(
          canvas,
          {
            normalizedCardCanvas: cardCanvas,
            minScore: 0.76
          }
        );

        console.log(brandText("[GMX Vision] local visual match"),

        visual
        );

        if (visual?.best) {
          setStatus(
            `Comparacion visual: ${visual.best.name} ${Math.round(visual.best.score * 100)}%`
          );
        }

        if (visual?.matched && visual?.best) {
          const hit = visual.best;

          await onResult?.({
            text: hit.passcode,
            lines: [hit.passcode, hit.setCode, hit.name],
            queries: [hit.passcode, hit.setCode, hit.name],
            identificationMethod: 'LOCAL_VISUAL',
            confidence: hit.score,
            visualMatch: hit,
            tcgHints: {
              name: hit.name,
              setCode: hit.setCode,
              passcode: hit.passcode,
              passcodes: [hit.passcode],
              setCodes: [hit.setCode]
            }
          });

          return;
        }
      } catch (e) {
        console.warn(brandText("[GMX Vision] visual match fallback"),

        e
        );
      }
      const barcode =
      await detectBarcode(cardCanvas);

      if (barcode) {

        await onResult?.({
          barcode,
          text: barcode,
          lines: [barcode],
          queries: [barcode],
          identificationMethod: 'BARCODE',
          confidence: 1,
          tcgHints: {
            passcode:
            /^\d{8}$/.test(barcode) ?
            barcode :
            ''
          }
        });

        return;
      }

      const result =
      await ocrCard(
        cardCanvas,
        setStatus
      );

      result.cardDetection =
      cardRect || null;

      await onResult?.(result);

    } catch (e) {

      console.error(brandText("[GMX Vision OCR]"),

      e
      );

      setError(
        e?.message ||
        'No se pudo analizar la imagen.'
      );

    } finally {

      setBusy(false);
      setStatus('');

    }
  }

  async function capture() {

    const video = videoRef.current;

    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('La camara todavia no esta lista.');
      return;
    }

    setError('');
    setStatus('Tomando foto...');

    const canvas = makeCanvas(video.videoWidth, video.videoHeight);
    canvas.getContext('2d').drawImage(
      video,
      0, 0,
      canvas.width,
      canvas.height
    );

    const blob = await new Promise(
      (resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95)
    );

    if (!blob) {
      setError('No se pudo generar la fotografia.');
      setStatus('');
      return;
    }

    if (snapshotUrl) {
      try {URL.revokeObjectURL(snapshotUrl);} catch {}
    }

    const url = URL.createObjectURL(blob);

    setSnapshotUrl(url);
    setSnapshotCanvas(canvas);
    setSnapshotReady(true);

    await stopCamera();

    setStatus(
      'Foto capturada. Revisa la imagen y presiona Analizar foto.'
    );
  }

  async function analyzeSnapshot() {
    if (!snapshotCanvas) {
      setError('No hay una foto capturada para analizar.');
      return;
    }

    setStatus('Analizando foto capturada...');
    await analyzeCanvas(snapshotCanvas);
  }

  async function retakeSnapshot() {
    clearSnapshot();
    setStatus('');
    await startCamera();
  }

  async function analyzeFile(file) {

    if (!file) return;

    setError('');

    const bitmap =
    await createImageBitmap(file);

    try {

      const canvas =
      makeCanvas(
        bitmap.width,
        bitmap.height
      );

      canvas.
      getContext('2d').
      drawImage(
        bitmap,
        0, 0
      );

      const blob = await new Promise(
        (resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95)
      );

      if (blob) {
        if (snapshotUrl) {
          try {URL.revokeObjectURL(snapshotUrl);} catch {}
        }
        setSnapshotUrl(URL.createObjectURL(blob));
      }

      setSnapshotCanvas(canvas);
      setSnapshotReady(true);

      await stopCamera();

      setStatus(
        'Foto cargada. Revisa la imagen y presiona Analizar foto.'
      );

    } finally {

      bitmap.close?.();

      if (fileRef.current) {
        fileRef.current.value = '';
      }

    }
  }

  if (!open) return null;

  return createPortal(

    <div className="modal-backdrop shiny-vision-backdrop">

      <div
        className="modal shiny-vision-modal"
        onMouseDown={(e) => e.stopPropagation()}>
        

        <div className="modal-head">

          <div>

            <div className="eyebrow">{brandText("\n              GMX VISION\n            ")}

            </div>

            <h2>{title}</h2>

            <p className="section-copy">
              Yu-Gi-Oh!: prioridad de reconocimiento
              PASSCODE → SET CODE → NOMBRE.
            </p>

          </div>

          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={onClose}>
            
            X
          </button>

        </div>

        <div className="shiny-vision-camera-stage">

          {!snapshotReady ?
          <>
              <video
              ref={videoRef}
              autoPlay
              playsInline
              muted />
            

              {!cameraReady ?
            <div className="shiny-vision-camera-placeholder">
                  Activa la camara o selecciona una fotografia.
                </div> :
            null}

              {cameraReady ?
            <div className="shiny-vision-card-guide" aria-hidden="true">
                  <div className="shiny-vision-card-guide-label">
                    Centra la carta aqui
                  </div>
                </div> :
            null}
            </> :

          <div className="shiny-vision-snapshot-preview">
              <img
              src={snapshotUrl}
              alt="Foto capturada para reconocimiento" />
            
              <div className="shiny-vision-snapshot-badge">
                FOTO CAPTURADA
              </div>
            </div>}

        </div>

        {status ?
        <div className="message">
            {status}
          </div> :
        null}

        {error ?
        <div className="shiny-pos-camera-error">
            {error}
          </div> :
        null}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={
          (e) => analyzeFile(
            e.target.files?.[0]
          )
          } />
        

        <div className="modal-actions">

          {!snapshotReady ?
          <>
              <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={startCamera}>
              
                Activar camara
              </button>

              <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}>
              
                Usar foto
              </button>

              <button
              type="button"
              disabled={busy || !cameraReady}
              onClick={capture}>
              
                Tomar foto
              </button>
            </> :

          <>
              <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={retakeSnapshot}>
              
                Volver a tomar
              </button>

              <button
              type="button"
              disabled={busy}
              onClick={analyzeSnapshot}>
              
                {busy ? 'Analizando...' : 'Analizar foto'}
              </button>
            </>}

          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}>
            
            Cancelar
          </button>

        </div>

      </div>

    </div>,
    document.body
  );
}
