import { brandText } from "../config/brand.js";import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  productStats,
  productCategories,
  productIntegrity } from
'../repositories/productsRepository.js';
import { importProductsWorkbook, buildProductsTemplate } from '../excelImportService.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

const isSuperadmin = (req) => String(req.access?.role || req.user?.rol || '').toUpperCase() === 'SUPERADMIN';
const withoutCost = (value) => {
  if (Array.isArray(value)) return value.map(withoutCost);
  if (!value || typeof value !== 'object') return value;
  const { costo, valor_costo, ...safe } = value;
  return safe;
};

/* SHINY_PRODUCT_LOCAL_MEDIA_R12 */
const localFileName = fileURLToPath(import.meta.url);
const localDirName = path.dirname(localFileName);
const localProductUploadsDir = path.join(localDirName, '..', '..', 'uploads', 'products');
const LOCAL_MEDIA_MAX_BYTES = 6 * 1024 * 1024;

function localMediaSafeBase(value = 'product') {
  const clean = String(value || 'product').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  replace(/[^A-Za-z0-9_-]+/g, '-').
  replace(/^-+|-+$/g, '').
  slice(0, 90);

  return clean || 'product';
}

async function saveLocalProductMedia({ sku = '', dataUrl = '', sourceUrl = '', sourceName = '' }) {
  await fs.mkdir(localProductUploadsDir, { recursive: true });

  const base = localMediaSafeBase(sku || sourceName || `product-${Date.now()}`);
  let buffer;
  let extension = 'webp';
  let mime = 'image/webp';

  if (dataUrl) {
    const match = String(dataUrl).match(/^data:(image\/(?:webp|png|jpeg));base64,(.+)$/i);
    if (!match) throw new Error('PRODUCT_IMAGE_DATA_INVALID');

    mime = match[1].toLowerCase();
    extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
    buffer = Buffer.from(match[2], 'base64');
  } else if (sourceUrl) {
    let parsed;
    try {
      parsed = new URL(String(sourceUrl));
    } catch {
      throw new Error('PRODUCT_IMAGE_URL_INVALID');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('PRODUCT_IMAGE_URL_INVALID');
    }

    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': "TCG-Store-LocalMedia/1.0",
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*'
      }
    });

    if (!response.ok) {
      throw new Error(`PRODUCT_IMAGE_DOWNLOAD_HTTP_${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error('PRODUCT_IMAGE_URL_NOT_IMAGE');
    }

    buffer = Buffer.from(await response.arrayBuffer());

    if (contentType.includes('png')) {
      extension = 'png';mime = 'image/png';
    } else if (contentType.includes('webp')) {
      extension = 'webp';mime = 'image/webp';
    } else {
      extension = 'jpg';mime = 'image/jpeg';
    }
  } else {
    throw new Error('PRODUCT_IMAGE_SOURCE_REQUIRED');
  }

  if (!buffer?.length) throw new Error('PRODUCT_IMAGE_EMPTY');
  if (buffer.length > LOCAL_MEDIA_MAX_BYTES) throw new Error('PRODUCT_IMAGE_TOO_LARGE');

  const fileName = `${base}-${Date.now()}.${extension}`;
  await fs.writeFile(path.join(localProductUploadsDir, fileName), buffer);

  const publicPath = `/uploads/products/${fileName}`;
  const metadata = {
    sku: String(sku || ''),
    localPath: publicPath,
    sourceUrl: String(sourceUrl || ''),
    sourceName: String(sourceName || ''),
    mime,
    bytes: buffer.length,
    savedAt: new Date().toISOString()
  };

  await fs.writeFile(
    path.join(localProductUploadsDir, `${fileName}.json`),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  return metadata;
}



function numberOrNull(value, integer = false) {
  if (value === '' || value === null || typeof value === 'undefined') return null;

  const n = Number(value);

  if (!Number.isFinite(n)) {
    throw new Error('INVALID_NUMBER');
  }

  return integer ? Math.trunc(n) : n;
}


function applyProductCurrencyFields(input, body = {}) {
  const currency = String(body?.moneda_precio || input?.moneda_precio || 'MXN').trim().toUpperCase();
  const gameCode = String(body?.tcg_game_code || input?.tcg_game_code || '').trim().toUpperCase();
  const originRaw = body?.precio_origen ?? body?.precio ?? input?.precio;
  const origin = originRaw === '' || originRaw == null ? null : Number(originRaw);

  if (!['MXN','USD'].includes(currency)) throw new Error('PRODUCT_CURRENCY_INVALID');
  if (currency === 'USD' && !gameCode) throw new Error('PRODUCT_TCG_REQUIRED_FOR_USD');
  if (origin === null || !Number.isFinite(origin) || origin < 0) throw new Error('PRODUCT_PRICE_INVALID');

  input.moneda_precio = currency;
  input.tcg_game_code = gameCode || null;
  input.precio_origen = origin;
  // Until PostgreSQL trigger converts it, input.precio is the source amount.
  input.precio = origin;
  return input;
}
function validateProduct(input) {
  if (!input.sku) throw new Error('PRODUCT_SKU_REQUIRED');
  if (!input.nombre) throw new Error('PRODUCT_NAME_REQUIRED');
  if (input.precio === null) throw new Error('PRODUCT_PRICE_REQUIRED');
  if (input.precio < 0) throw new Error('PRODUCT_PRICE_INVALID');
  if (input.costo !== null && input.costo < 0) throw new Error('PRODUCT_COST_INVALID');
  if (input.stock_minimo !== null && input.stock_minimo < 0) throw new Error('PRODUCT_MIN_STOCK_INVALID');
  if (input.initial_stock !== null && input.initial_stock < 0) throw new Error('PRODUCT_INITIAL_STOCK_INVALID');
  if (!input.categoria) throw new Error('PRODUCT_CATEGORY_REQUIRED');
  if (!['Activo', 'Inactivo', 'Agotado'].includes(input.estado)) throw new Error('PRODUCT_STATUS_INVALID');
}

function normalize(body = {}) {
  return {
    id: String(body.id ?? '').trim(),
    sku: String(body.sku ?? '').trim(),
    codigo_barras: String(body.codigo_barras ?? '').trim(),
    nombre: String(body.nombre ?? '').trim(),
    descripcion: String(body.descripcion ?? '').trim(),
    precio: numberOrNull(body.precio),
    costo: numberOrNull(body.costo),
    stock: numberOrNull(body.stock, true),
    initial_stock: numberOrNull(body.initial_stock ?? body.stock, true),
    initial_branch_id: String(body.initial_branch_id ?? '').trim(),
    stock_minimo: numberOrNull(body.stock_minimo, true),
    categoria: String(body.categoria ?? '').trim(),
    imagen: Object.prototype.hasOwnProperty.call(body, 'imagen') ?
    String(body.imagen ?? '') :
    '',
    estado: String(body.estado ?? 'Activo').trim()
  };
}

router.get('/', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const category = String(req.query.category || '').trim();
    const status = String(req.query.status || '').trim();

    const result = await listProducts({ search, category, status, limit, offset });

    res.json({
      success: true,
      data: isSuperadmin(req) ? result.rows : withoutCost(result.rows),
      count: result.rowCount,
      total: result.total,
      limit,
      offset,
      ms: result.ms
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'PRODUCT_LIST_FAILED',
      message: error.message
    });
  }
});



/*
 * PRODUCTOS-AUD-014
 * El Excel puede crear SKU nuevos Y actualizar SKU existentes.
 * server.js ya exige PRODUCTOS.create por ser POST; aquí exigimos
 * adicionalmente PRODUCTOS.edit para impedir que "crear" se use como
 * vía indirecta para modificar productos existentes.
 */
router.post(
  '/import-excel',
  requirePermission('PRODUCTOS', 'edit'),
  async (req, res) => {try {
      res.json({
        success: true,
        data: await importProductsWorkbook(
          req.body?.file || {},
          req.user?.email || '',
          { includeCost: isSuperadmin(req) }
        )
      });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }}
);

router.get('/template.xlsx', async (req, res) => {
  try {
    const buffer = await buildProductsTemplate({ includeCost: isSuperadmin(req) });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Productos.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ success: false, error: 'PRODUCT_TEMPLATE_FAILED', message: e.message });
  }
});

router.get('/meta/stats', async (req, res) => {try {
    const r = await productStats();res.json({ success: true, data: isSuperadmin(req) ? r.rows[0] : withoutCost(r.rows[0]) });
  } catch (_e) {res.status(500).json({ success: false, error: 'PRODUCT_STATS_FAILED' });}});
router.get('/meta/categories', async (_req, res) => {try {
    const r = await productCategories();res.json({ success: true, data: r.rows });
  } catch (_e) {res.status(500).json({ success: false, error: 'PRODUCT_CATEGORIES_FAILED' });}});

router.get('/meta/integrity', async (_req, res) => {try {
    res.json({ success: true, data: await productIntegrity() });
  } catch (_e) {res.status(500).json({ success: false, error: 'PRODUCT_INTEGRITY_FAILED' });}});

/*
 * Permisos efectivos del usuario autenticado para adaptar la interfaz.
 * La seguridad real permanece en backend; esto sólo evita mostrar
 * acciones que terminarían en 403.
 */
router.get('/meta/access', async (req, res) => {
  const permissions = req.access?.permissions?.PRODUCTOS || {
    read: false, create: false, edit: false, delete: false, authorize: false
  };
  res.json({
    success: true,
    data: {
      role: req.access?.role || req.user?.rol || 'CONSULTA',
      permissions
    }
  });
});

router.post('/media/local', async (req, res) => {
  try {
    const result = await saveLocalProductMedia({
      sku: req.body?.sku,
      dataUrl: req.body?.dataUrl,
      sourceUrl: req.body?.sourceUrl,
      sourceName: req.body?.sourceName
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const code = String(error?.message || 'PRODUCT_IMAGE_LOCAL_SAVE_FAILED');

    const status = [
    'PRODUCT_IMAGE_DATA_INVALID',
    'PRODUCT_IMAGE_URL_INVALID',
    'PRODUCT_IMAGE_URL_NOT_IMAGE',
    'PRODUCT_IMAGE_SOURCE_REQUIRED',
    'PRODUCT_IMAGE_EMPTY',
    'PRODUCT_IMAGE_TOO_LARGE'].
    includes(code) ? 400 : 502;

    res.status(status).json({
      success: false,
      error: code,
      message: code === 'PRODUCT_IMAGE_TOO_LARGE' ?
      'La imagen supera el máximo permitido de 6 MB.' :
      'No fue posible guardar la imagen localmente.'
    });
  }
});

router.get('/:rowId', async (req, res) => {
  try {
    const product = await getProduct(req.params.rowId);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'PRODUCT_NOT_FOUND'
      });
    }

    res.json({ success: true, data: isSuperadmin(req) ? product : withoutCost(product) });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'PRODUCT_GET_FAILED',
      message: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const input = normalize(req.body);
    applyProductCurrencyFields(input, req.body);
    if (!isSuperadmin(req)) input.costo = 0;

    validateProduct(input);
    const product = await createProduct(input, {
      usuario: String(
        req.user?.email ||
        req.user?.nombre ||
        req.user?.id_admin ||
        'SYSTEM'
      ).trim()
    });

    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    const code = String(error.message || '');
    const messages = {
      INVALID_NUMBER: 'Precio, costo y cantidades deben ser numéricos.',
      PRODUCT_SKU_REQUIRED: 'El SKU es obligatorio.',
      PRODUCT_SKU_DUPLICATE: 'El SKU ya existe. Usa un SKU diferente.',
      PRODUCT_NAME_REQUIRED: 'El nombre es obligatorio.',
      PRODUCT_PRICE_REQUIRED: 'El precio es obligatorio.',
      PRODUCT_PRICE_INVALID: 'El precio no puede ser negativo.',
      PRODUCT_COST_INVALID: 'El costo no puede ser negativo.',
      PRODUCT_MIN_STOCK_INVALID: 'El stock mínimo debe ser cero o mayor.',
      PRODUCT_INITIAL_STOCK_INVALID: 'El stock inicial debe ser cero o mayor.',
      PRODUCT_CATEGORY_REQUIRED: 'Selecciona una categoría.',
      PRODUCT_CATEGORY_INVALID: 'La categoría no existe o está inactiva.',
      PRODUCT_STATUS_INVALID: 'El estado del producto no es válido.',
      INITIAL_BRANCH_REQUIRED: 'Selecciona la sucursal que recibirá el stock inicial.',
      INITIAL_BRANCH_NOT_FOUND: 'La sucursal seleccionada no está disponible.'
    };
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'PRODUCT_SKU_DUPLICATE', message: 'El SKU ya existe. Usa un SKU diferente.' });
    if (messages[code]) return res.status(code === 'PRODUCT_SKU_DUPLICATE' ? 409 : 400).json({ success: false, error: code, message: messages[code], existing: error.existing || undefined });
    console.error(brandText("[GMX][PRODUCT_CREATE]"), error);
    res.status(500).json({ success: false, error: 'PRODUCT_CREATE_FAILED', message: 'No fue posible crear el producto.' });
  }
});


router.put('/:rowId', async (req, res) => {
  try {
    const input = normalize(req.body);
    applyProductCurrencyFields(input, req.body);
    if (!isSuperadmin(req)) {
      const current = await getProduct(req.params.rowId);
      if (!current) return res.status(404).json({ success: false, error: 'PRODUCT_NOT_FOUND' });
      input.costo = Number(current.costo || 0);
    }
    validateProduct(input);
    const product = await updateProduct(
      req.params.rowId,
      input
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'PRODUCT_NOT_FOUND'
      });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    const code = String(error.message || '');
    const messages = {
      INVALID_NUMBER: 'Precio, costo y cantidades deben ser numéricos.',
      PRODUCT_SKU_REQUIRED: 'El SKU es obligatorio.',
      PRODUCT_SKU_DUPLICATE: 'El SKU ya existe. Usa un SKU diferente.',
      PRODUCT_NAME_REQUIRED: 'El nombre es obligatorio.',
      PRODUCT_PRICE_REQUIRED: 'El precio es obligatorio.',
      PRODUCT_PRICE_INVALID: 'El precio no puede ser negativo.',
      PRODUCT_COST_INVALID: 'El costo no puede ser negativo.',
      PRODUCT_MIN_STOCK_INVALID: 'El stock mínimo debe ser cero o mayor.',
      PRODUCT_CATEGORY_REQUIRED: 'Selecciona una categoría.',
      PRODUCT_CATEGORY_INVALID: 'La categoría no existe o está inactiva.',
      PRODUCT_STATUS_INVALID: 'El estado del producto no es válido.'
    };
    if (error?.code === '23505') return res.status(409).json({ success: false, error: 'PRODUCT_SKU_DUPLICATE', message: 'El SKU ya existe. Usa un SKU diferente.' });
    res.status(code === 'PRODUCT_SKU_DUPLICATE' ? 409 : 400).json({
      success: false,
      error: messages[code] ? code : 'PRODUCT_UPDATE_FAILED',
      message: messages[code] || 'No fue posible actualizar el producto.',
      existing: error.existing || undefined
    });
  }
});

router.delete('/:rowId', async (req, res) => {
  try {
    const result = await deleteProduct(
      req.params.rowId,
      {
        usuario: String(
          req.user?.email ||
          req.user?.nombre ||
          req.user?.id_admin ||
          'SYSTEM'
        ).trim()
      }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'PRODUCT_NOT_FOUND',
        message: 'Producto no encontrado.'
      });
    }

    if (result.action === 'blocked') {
      return res.status(409).json({
        success: false,
        error: 'PRODUCT_HAS_STOCK',
        message: `El producto tiene ${result.stock} unidad(es) en inventario. Ajusta o transfiere el stock desde Inventario antes de darlo de baja.`,
        data: result
      });
    }

    if (result.action === 'deactivated') {
      return res.json({
        success: true,
        data: result,
        message: 'El producto tiene historial y fue desactivado; no se eliminó físicamente.'
      });
    }

    res.json({
      success: true,
      data: result,
      message: 'Producto eliminado definitivamente porque no tenía stock ni historial.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'PRODUCT_DELETE_FAILED',
      message: 'No fue posible procesar la baja segura del producto.'
    });
  }
});

export default router;
