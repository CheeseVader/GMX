import { brandText } from "../config/brand.js";function clamp(v, a = 0, b = 1) {
  return Math.max(a, Math.min(b, v));
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function centeredCardFallback(source) {
  // Matches the visual guide used by GMX Vision when border detection is uncertain.
  const targetRatio = 59 / 86;
  const h = source.height * 0.88;
  const w = Math.min(source.width * 0.72, h * targetRatio);
  const hh = w / targetRatio;

  const out = makeCanvas(1180, 1720);
  const ctx = out.getContext('2d', { willReadFrequently: true });

  const sx = (source.width - w) / 2;
  const sy = (source.height - hh) / 2;

  ctx.drawImage(source, sx, sy, w, hh, 0, 0, out.width, out.height);
  return out;
}

async function imageUrlToCanvas(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`REFERENCE_IMAGE_LOAD_FAILED:${url}`));
    img.src = url;
  });

  const out = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  out.getContext('2d').drawImage(img, 0, 0, out.width, out.height);
  return out;
}

function cropNormalized(source, rect, outW, outH) {
  const out = makeCanvas(outW, outH);
  const ctx = out.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(
    source,
    source.width * rect.x,
    source.height * rect.y,
    source.width * rect.w,
    source.height * rect.h,
    0, 0, outW, outH
  );

  return out;
}

function grayVector(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const v = new Float64Array(canvas.width * canvas.height);

  let total = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    v[p] = g;
    total += g;
  }

  const mean = total / v.length;

  let ss = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] - mean;
    ss += x * x;
  }

  const std = Math.sqrt(ss / v.length) || 1;

  for (let i = 0; i < v.length; i++) {
    v[i] = (v[i] - mean) / std;
  }

  return v;
}

function normalizedCorrelation(a, b) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0,aa = 0,bb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }

  const denom = Math.sqrt(aa * bb) || 1;
  return clamp((dot / denom + 1) / 2);
}

function edgeVector(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const w = canvas.width,h = canvas.height;
  const gray = new Float64Array(w * h);

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const e = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      e.push(Math.min(255, Math.hypot(gx, gy)));
    }
  }

  const arr = Float64Array.from(e);
  let mean = 0;
  for (const x of arr) mean += x;
  mean /= arr.length || 1;

  let ss = 0;
  for (const x of arr) ss += (x - mean) * (x - mean);
  const std = Math.sqrt(ss / (arr.length || 1)) || 1;

  for (let i = 0; i < arr.length; i++) {
    arr[i] = (arr[i] - mean) / std;
  }

  return arr;
}

function colorHistogram(canvas, bins = 8) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const hist = new Float64Array(bins * 3);
  let count = 0;

  for (let i = 0; i < d.length; i += 4) {
    hist[Math.min(bins - 1, Math.floor(d[i] / 256 * bins))]++;
    hist[bins + Math.min(bins - 1, Math.floor(d[i + 1] / 256 * bins))]++;
    hist[bins * 2 + Math.min(bins - 1, Math.floor(d[i + 2] / 256 * bins))]++;
    count++;
  }

  if (count) {
    for (let i = 0; i < hist.length; i++) hist[i] /= count;
  }

  return hist;
}

function histogramIntersection(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    s += Math.min(a[i], b[i]);
  }
  // Three channel histograms each sum to 1.
  return clamp(s / 3);
}

function compareRegion(query, reference, rect) {
  const q = cropNormalized(query, rect, 48, 48);
  const r = cropNormalized(reference, rect, 48, 48);

  const gray = normalizedCorrelation(grayVector(q), grayVector(r));
  const edge = normalizedCorrelation(edgeVector(q), edgeVector(r));
  const color = histogramIntersection(colorHistogram(q), colorHistogram(r));

  return {
    gray,
    edge,
    color,
    score: clamp(gray * 0.48 + edge * 0.34 + color * 0.18)
  };
}

export async function compareCardToReference(
sourceCanvas,
referenceUrl,
{
  normalizedCardCanvas = null
} = {})
{
  const query = normalizedCardCanvas || centeredCardFallback(sourceCanvas);
  const reference = await imageUrlToCanvas(referenceUrl);

  // Artwork dominates identity; full-card structure is useful as a secondary check.
  const artwork = { x: 0.105, y: 0.205, w: 0.79, h: 0.435 };
  const full = { x: 0.045, y: 0.04, w: 0.91, h: 0.92 };
  const title = { x: 0.07, y: 0.045, w: 0.73, h: 0.11 };

  const art = compareRegion(query, reference, artwork);
  const all = compareRegion(query, reference, full);
  const name = compareRegion(query, reference, title);

  const score = clamp(
    art.score * 0.66 +
    all.score * 0.24 +
    name.score * 0.10
  );

  return {
    score,
    artwork: art.score,
    full: all.score,
    title: name.score,
    details: { art, all, name }
  };
}

export async function identifyLocalVisualCard(
sourceCanvas,
{
  normalizedCardCanvas = null,
  minScore = 0.76
} = {})
{
  const references = [
  {
    game: 'YUGIOH',
    id: '81057959',
    passcode: '81057959',
    name: 'D. Human',
    setCode: 'SDK-030',
    referenceUrl: '/api/public/tcg-images/YUGIOH/SDK/81057959.jpg'
  }];


  const results = [];

  for (const ref of references) {
    try {
      const match = await compareCardToReference(
        sourceCanvas,
        ref.referenceUrl,
        { normalizedCardCanvas }
      );

      results.push({
        ...ref,
        ...match
      });
    } catch (e) {
      console.warn(brandText("[GMX Vision Local Match]"), ref.id, e);
    }
  }

  results.sort((a, b) => b.score - a.score);

  const best = results[0] || null;

  return {
    matched: Boolean(best && best.score >= minScore),
    best,
    results
  };
}
