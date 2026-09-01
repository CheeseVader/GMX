import { brandText } from "../config/brand.js";import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';

const router = express.Router();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_UPLOAD_ROOT = path.resolve(HERE, '../../uploads/products');
const SERVICE_URL = String(process.env.SHINY_VISUAL_BETA_URL || 'http://127.0.0.1:8011').replace(/\/$/, '');

function localProductPath(image = '') {
  const value = String(image || '').trim();
  if (!value.startsWith('/uploads/products/')) return null;
  const filename = decodeURIComponent(value.slice('/uploads/products/'.length)).replaceAll('\\', '/');
  if (!filename || filename.includes('..') || filename.includes('/')) return null;
  const full = path.resolve(PRODUCT_UPLOAD_ROOT, filename);
  if (!full.startsWith(PRODUCT_UPLOAD_ROOT + path.sep)) return null;
  return full;
}

router.get('/health', async (_req, res) => {
  try {
    const r = await fetch(`${SERVICE_URL}/health`, { signal: AbortSignal.timeout(3500) });
    const data = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : 503).json({ success: r.ok, data });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'VISUAL_BETA_SERVICE_OFFLINE',
      message: 'El servicio local OpenCV/OpenCLIP no está iniciado.',
      detail: String(error?.message || error)
    });
  }
});

router.post('/search', async (req, res) => {
  try {
    const imageBase64 = String(req.body?.image_base64 || '');
    if (!imageBase64) return res.status(400).json({
      success: false, error: 'IMAGE_REQUIRED', message: 'Selecciona o toma una fotografía.'
    });
    if (imageBase64.length > 10_000_000) return res.status(413).json({
      success: false, error: 'IMAGE_TOO_LARGE', message: 'La imagen es demasiado grande.'
    });

    const rows = await query(`
      SELECT row_id,id,sku,nombre,categoria,imagen,precio,stock
      FROM gmx.productos
      WHERE imagen IS NOT NULL
        AND BTRIM(imagen)<>''
        AND imagen LIKE '/uploads/products/%'
        AND COALESCE(estado,'Activo')<>'Inactivo'
      ORDER BY row_id
      LIMIT 5000
    `);

    const catalog = (rows.rows || []).
    map((x) => ({ ...x, local_path: localProductPath(x.imagen) })).
    filter((x) => x.local_path);

    if (!catalog.length) {
      return res.json({
        success: true,
        data: { matches: [], catalog_count: 0, indexed_count: 0, card_detected: false },
        message: 'No hay imágenes locales de productos disponibles para comparar.'
      });
    }

    const response = await fetch(`${SERVICE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        catalog,
        limit: Math.max(1, Math.min(Number(req.body?.limit || 5), 10))
      }),
      signal: AbortSignal.timeout(120000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: 'VISUAL_BETA_SERVICE_ERROR',
        message: payload?.detail || 'El servicio visual devolvió un error.'
      });
    }

    /* SHINY_VISUAL_POS_BETA_R13
     * OpenCLIP identifies the product; Shiny remains the source of truth
     * for current selling price and stock.
     */
    const productByRow = new Map(
      (rows.rows || []).map((x) => [String(x.row_id), x])
    );

    const enrichedMatches = (payload?.matches || []).map((match) => {
      const product = productByRow.get(String(match.row_id)) || {};
      return {
        ...match,
        precio: Number(product.precio || 0),
        stock: Number(product.stock || 0)
      };
    });

    res.json({
      success: true,
      data: {
        ...payload,
        matches: enrichedMatches
      }
    });
  } catch (error) {
    console.error(brandText("[GMX][VISUAL_BETA_SEARCH]"), error);
    const offline = /fetch failed|ECONNREFUSED|aborted|timeout/i.test(String(error?.message || error));
    res.status(offline ? 503 : 500).json({
      success: false,
      error: offline ? 'VISUAL_BETA_SERVICE_OFFLINE' : 'VISUAL_BETA_SEARCH_FAILED',
      message: offline ?
      'El servicio local OpenCV/OpenCLIP no está iniciado.' :
      'No fue posible completar la búsqueda visual.'
    });
  }
});

export default router;
