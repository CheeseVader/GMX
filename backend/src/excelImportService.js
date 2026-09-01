import { brandText } from "./config/brand.js";import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { pool, query } from './db.js';

const txt = (v) => String(v ?? '').trim();
const bool = (v) => {
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'si', 'sí', 'yes', 'activo', 'active'].includes(txt(v).toLowerCase());
};
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

function validProductImageReference(value) {
  const v = txt(value);
  if (!v) return true;
  if (v.startsWith('/')) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function workbookFromPayload(file) {
  const raw = String(file?.data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('EMPTY_IMPORT_FILE');
  if (buf.length > 25 * 1024 * 1024) throw new Error('IMPORT_FILE_TOO_LARGE');
  return XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
}

function payloadBuffer(file) {
  const raw = String(file?.data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('EMPTY_IMPORT_FILE');
  if (buf.length > 25 * 1024 * 1024) throw new Error('IMPORT_FILE_TOO_LARGE');
  return buf;
}

function rowsFromSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addXlsxDataValidations(buffer, sheetNumber, validations = []) {
  if (!validations.length) return buffer;
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const entry = XLSX.CFB.find(cfb, `Root Entry/xl/worksheets/sheet${sheetNumber}.xml`);
  if (!entry?.content) return buffer;
  let xml = Buffer.from(entry.content).toString('utf8');
  const rules = validations.map((rule) =>
    `<dataValidation type="list" allowBlank="1" showErrorMessage="1" showInputMessage="1" ` +
    `errorTitle="Valor no válido" error="Selecciona un valor incluido en la lista." ` +
    `promptTitle="Selecciona de la lista" prompt="También puedes pegar un código existente." ` +
    `sqref="${xmlEscape(rule.range)}"><formula1>${xmlEscape(rule.formula)}</formula1></dataValidation>`
  ).join('');
  const block = `<dataValidations count="${validations.length}">${rules}</dataValidations>`;
  xml = xml.replace('</worksheet>', `${block}</worksheet>`);
  entry.content = Buffer.from(xml, 'utf8');
  entry.size = entry.content.length;
  return XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip', compression: true });
}

async function logImport(client, { type, fileName, read = 0, created = 0, updated = 0, errors = [], meta = {} }, user = '') {
  const id = uid('IMP');
  await client.query(`INSERT INTO gmx.importaciones(
    id_importacion,tipo,archivo,filas_leidas,filas_creadas,filas_actualizadas,filas_error,detalle,usuario)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [
  id, type, txt(fileName) || null, read, created, updated, errors.length, JSON.stringify({ ...meta, errors: errors.slice(0, 200) }), txt(user) || null]
  );
  return id;
}

export async function buildProductsTemplate({ includeCost = false } = {}) {
  const categoriesR = await query(`SELECT TRIM(nombre) nombre FROM gmx.categorias
    WHERE LOWER(TRIM(COALESCE(estado,'Activo')))='activo'
    ORDER BY TRIM(nombre)`);
  const wb = XLSX.utils.book_new();
  const instructions = [
    [brandText('Plantilla de productos')],
    ['Esta plantilla sólo crea o actualiza datos maestros. No modifica existencias.'],
    ['El ID es automático. SKU es obligatorio y puede ser el código de barras.'],
    ['Las existencias nuevas se cargan desde Inventario > Entrada masiva.'],
    ['categoria debe coincidir con una categoría activa de la hoja Categorias.'],
    [includeCost ? 'costo es confidencial y sólo puede importarlo SUPERADMIN.' : 'El costo no está disponible para este usuario.']
  ];
  const wi = XLSX.utils.aoa_to_sheet(instructions);
  wi['!cols'] = [{ wch: 95 }];
  XLSX.utils.book_append_sheet(wb, wi, 'Instrucciones');

  const headers = ['sku', 'codigo_barras', 'nombre', 'descripcion', 'categoria', 'precio'];
  if (includeCost) headers.push('costo');
  headers.push('stock_minimo', 'estado', 'imagen_url');
  const sample = ['7501234567890', '7501234567890', 'Producto de ejemplo', '', categoriesR.rows[0]?.nombre || '', 100];
  if (includeCost) sample.push(60);
  sample.push(2, 'Activo', '');
  const wp = XLSX.utils.aoa_to_sheet([headers, sample]);
  wp['!cols'] = autoWidths([headers, sample], 14, 42);
  XLSX.utils.book_append_sheet(wb, wp, 'Productos');

  const categoryRows = [['categoria'], ...categoriesR.rows.map((x) => [x.nombre])];
  const wc = XLSX.utils.aoa_to_sheet(categoryRows);
  wc['!cols'] = [{ wch: 38 }];
  XLSX.utils.book_append_sheet(wb, wc, 'Categorias');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

export async function buildInventoryEntryTemplate({ includeCost = false } = {}) {
  const [branchesR, productsR] = await Promise.all([
    query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales
      WHERE COALESCE(activa,true)=true ORDER BY nombre_sucursal`),
    query(`SELECT sku,nombre FROM gmx.productos
      WHERE LOWER(COALESCE(estado,'Activo'))='activo' ORDER BY nombre`)
  ]);
  const wb = XLSX.utils.book_new();
  const guide = [
    [brandText('Entrada masiva de inventario')],
    ['Cada fila SUMA cantidad al stock actual; nunca lo reemplaza.'],
    ['El SKU debe existir en Productos. La sucursal puede capturarse por ID o por nombre exacto.'],
    ['cantidad debe ser un entero mayor a cero. referencia identifica factura, remisión o lote.'],
    [includeCost ? 'costo_unitario es opcional, confidencial y exclusivo de SUPERADMIN.' : 'El costo no se incluye para este usuario.'],
    ['precio_venta es opcional. Si se captura, actualiza el precio utilizado por el POS y el portal.'],
    ['No vuelvas a cargar el mismo archivo: el sistema detecta su huella y lo rechaza.']
  ];
  const wg = XLSX.utils.aoa_to_sheet(guide);
  wg['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wg, 'Instrucciones');
  const headers = ['sku', 'sucursal', 'cantidad'];
  if (includeCost) headers.push('costo_unitario');
  headers.push('precio_venta', 'proveedor', 'referencia', 'lote', 'fecha_recepcion', 'observaciones');
  const sample = [productsR.rows[0]?.sku || '', branchesR.rows[0]?.nombre_sucursal || '', 1];
  if (includeCost) sample.push('');
  sample.push('', '', 'FACTURA-001', '', new Date().toISOString().slice(0, 10), '');
  const we = XLSX.utils.aoa_to_sheet([headers, sample]);
  we['!cols'] = autoWidths([headers, sample], 14, 34);
  XLSX.utils.book_append_sheet(wb, we, 'Entradas_Inventario');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchesR.rows), 'Sucursales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productsR.rows), 'Productos_Existentes');
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Names = [
    { Name: 'ListaSucursales', Ref: `Sucursales!$B$2:$B$${Math.max(2, branchesR.rows.length + 1)}` },
    { Name: 'ListaSKU', Ref: `Productos_Existentes!$A$2:$A$${Math.max(2, productsR.rows.length + 1)}` }
  ];
  const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  return addXlsxDataValidations(raw, 2, [
    { range: 'A2:A5000', formula: 'ListaSKU' },
    { range: 'B2:B5000', formula: 'ListaSucursales' }
  ]);
}

export async function importInventoryEntriesWorkbook(file, user = {}, { includeCost = false } = {}) {
  const buffer = payloadBuffer(file);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const rows = rowsFromSheet(wb, 'Entradas_Inventario');
  if (!rows.length) throw new Error('INVENTORY_ENTRIES_SHEET_EMPTY');
  const client = await pool.connect();
  const errors = [];
  let updated = 0;
  try {
    await client.query('BEGIN');
    const duplicate = await client.query(`SELECT id_importacion FROM gmx.importaciones
      WHERE tipo='INVENTARIO_ENTRADAS_EXCEL' AND detalle->>'sha256'=$1 LIMIT 1`, [sha256]);
    if (duplicate.rowCount) throw new Error('IMPORT_FILE_ALREADY_PROCESSED');
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx] || {};
      const sku = txt(r.sku);
      const branchValue = txt(r.sucursal || r.id_sucursal);
      const quantity = Math.trunc(num(r.cantidad));
      const savepoint = `inventory_entry_${idx}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        if (!sku) throw new Error('SKU_REQUIRED');
        if (!branchValue) throw new Error('BRANCH_REQUIRED');
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('QUANTITY_MUST_BE_POSITIVE');
        const productR = await client.query(`SELECT id,sku,nombre,costo,stock_minimo FROM gmx.productos
          WHERE UPPER(TRIM(COALESCE(sku,'')))=UPPER(TRIM($1)) LIMIT 1`, [sku]);
        if (!productR.rowCount) throw new Error('PRODUCT_SKU_NOT_FOUND');
        const branchR = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales
          WHERE COALESCE(activa,true)=true AND (id_sucursal=$1 OR LOWER(TRIM(nombre_sucursal))=LOWER(TRIM($1))) LIMIT 1`, [branchValue]);
        if (!branchR.rowCount) throw new Error('BRANCH_NOT_FOUND');
        const product = productR.rows[0], branch = branchR.rows[0];
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [branch.id_sucursal, product.id]);
        let locked = await client.query(`SELECT row_id,stock FROM gmx.inventario_sucursales
          WHERE id_sucursal=$1 AND id_producto=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`, [branch.id_sucursal, product.id]);
        if (!locked.rowCount) {
          locked = await client.query(`INSERT INTO gmx.inventario_sucursales(
              id_registro,id_sucursal,sucursal,id_producto,sku,producto,stock,stock_minimo,fecha_actualizacion)
            VALUES('INV-BULK-'||$1||'-'||$2,$2,$3,$1,$4,$5,0,$6,NOW())
            RETURNING row_id,stock`, [product.id, branch.id_sucursal, branch.nombre_sucursal, product.sku, product.nombre, Number(product.stock_minimo || 0)]);
        }
        if (!locked.rowCount) throw new Error('INVENTORY_ROW_NOT_AVAILABLE');
        const before = Number(locked.rows[0].stock || 0), after = before + quantity;
        await client.query(`UPDATE gmx.inventario_sucursales SET stock=$1,fecha_actualizacion=NOW() WHERE row_id=$2`, [after, locked.rows[0].row_id]);
        const costText = txt(r.costo_unitario);
        if (includeCost && costText !== '') {
          const cost = Number(costText);
          if (!Number.isFinite(cost) || cost < 0) throw new Error('COST_INVALID');
          await client.query(`UPDATE gmx.productos SET costo=$1,fecha_actualizacion=NOW() WHERE id=$2`, [cost, product.id]);
        }
        const priceText = txt(r.precio_venta);
        if (priceText !== '') {
          const price = Number(priceText);
          if (!Number.isFinite(price) || price < 0) throw new Error('SALE_PRICE_INVALID');
          await client.query(`UPDATE gmx.productos SET precio=$1,fecha_actualizacion=NOW() WHERE id=$2`, [price, product.id]);
        }
        const reference = [txt(r.referencia), txt(r.lote)].filter(Boolean).join(' · ') || `IMPORT:${sha256.slice(0, 12)}`;
        await client.query(`INSERT INTO gmx.movimientos_inventario_sucursales(
          id_movimiento,fecha,id_sucursal,sucursal,id_producto,sku,producto,tipo,cantidad,
          stock_anterior,stock_nuevo,motivo,id_admin,nombre_usuario,usuario,referencia)
          VALUES('MOV-BULK-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||$1,NOW(),
          $2,$3,$4,$5,$6,'ENTRADA_MASIVA',$7,$8,$9,$10,NULLIF($11,''),$12,NULLIF($13,''),NULLIF($14,''))`, [
          idx, branch.id_sucursal, branch.nombre_sucursal, product.id, product.sku, product.nombre,
          quantity, before, after, txt(r.observaciones) || 'Entrada masiva de inventario',
          txt(user?.id_admin || user?.id), txt(user?.nombre || user?.name || user?.email || 'SUPERADMIN'),
          txt(user?.email || user?.usuario), reference]);
        updated++;
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        errors.push({ row: idx + 2, sku, error: String(e.message || e).slice(0, 220) });
      }
    }
    const importId = await logImport(client, {
      type: 'INVENTARIO_ENTRADAS_EXCEL', fileName: file?.name, read: rows.length,
      updated, errors, meta: { sha256, operation: 'ADD_STOCK', costIncluded: includeCost }
    }, txt(user?.email || user?.usuario));
    await client.query('COMMIT');
    return { importId, read: rows.length, updated, errors, sha256: sha256.slice(0, 12) };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally { client.release(); }
}

export function parseBuylistWorkbook(file) {
  const wb = workbookFromPayload(file);

  if (!wb.SheetNames?.length) {
    throw new Error('BUYLIST_WORKBOOK_EMPTY');
  }

  const preferredNames = [
  'Buylist',
  'BUYLIST',
  'Cartas',
  'CARTAS'];


  const candidates = [
  ...preferredNames.filter((name) => wb.Sheets[name]),
  ...wb.SheetNames.filter((name) => !preferredNames.includes(name))];


  let sheetName = '';
  let rows = [];

  for (const candidate of candidates) {
    const candidateRows = rowsFromSheet(wb, candidate);

    if (candidateRows.length) {
      sheetName = candidate;
      rows = candidateRows;
      break;
    }
  }

  if (!sheetName || !rows.length) {
    throw new Error('BUYLIST_SHEET_EMPTY');
  }

  const normalized = rows.map((row, index) => {
    const get = (...names) => {
      for (const name of names) {
        if (
        Object.prototype.hasOwnProperty.call(row, name) &&
        txt(row[name]) !== '')
        {
          return txt(row[name]);
        }
      }
      return '';
    };

    return {
      row_number: index + 2,

      codigo: get(
        'codigo', 'Codigo', 'CODIGO',
        'código', 'Código', 'CÓDIGO',
        'id_carta', 'ID_CARTA'
      ),

      nombre: get(
        'nombre', 'Nombre', 'NOMBRE'
      ),

      cantidad: get(
        'cantidad', 'Cantidad', 'CANTIDAD'
      ) || '1',

      condicion: get(
        'condicion', 'Condicion', 'CONDICION',
        'condición', 'Condición', 'CONDICIÓN'
      ) || 'NM',

      idioma: get(
        'idioma', 'Idioma', 'IDIOMA'
      ) || 'ES',

      edicion: get(
        'edicion', 'Edicion', 'EDICION',
        'edición', 'Edición', 'EDICIÓN'
      ),

      rareza: get(
        'rareza', 'Rareza', 'RAREZA'
      ),

      graded: get(
        'graded', 'Graded', 'GRADED'
      ),

      empresa_grading: get(
        'empresa_grading',
        'Empresa_Grading',
        'EMPRESA_GRADING'
      ),

      grado: get(
        'grado', 'Grado', 'GRADO'
      ),

      certificado: get(
        'certificado', 'Certificado', 'CERTIFICADO'
      )
    };
  });

  return {
    sheet: sheetName,
    rows: normalized,
    total: normalized.length
  };
}
/*
 * BUY-003
 * Genera una plantilla Buylist XLSX nativa.
 *
 * No es HTML renombrado como .xls.
 * XLSX.write() produce un workbook real compatible con
 * el mismo parser utilizado durante la importación.
 */
export function buildBuylistTemplate() {
  const wb = XLSX.utils.book_new();

  const rows = [
  [
  'codigo',
  'nombre',
  'cantidad',
  'condicion',
  'idioma',
  'edicion',
  'rareza',
  'graded',
  'empresa_grading',
  'grado',
  'certificado'],

  [
  'RA01-EN001',
  'Lava Golem',
  1,
  'NM',
  'EN',
  'UNLIMITED',
  "Collector's Rare",
  false,
  '',
  '',
  '']];



  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [
  { wch: 22 },
  { wch: 34 },
  { wch: 12 },
  { wch: 14 },
  { wch: 12 },
  { wch: 18 },
  { wch: 26 },
  { wch: 12 },
  { wch: 22 },
  { wch: 12 },
  { wch: 24 }];


  XLSX.utils.book_append_sheet(
    wb,
    ws,
    'Buylist'
  );

  return XLSX.write(
    wb,
    {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true
    }
  );
}
export async function importProductsWorkbook(file, user = '', { includeCost = false } = {}) {
  const wb = workbookFromPayload(file);
  const rows = rowsFromSheet(wb, 'Productos');
  if (!rows.length) throw new Error('PRODUCTS_SHEET_EMPTY');

  /*
   * PRODUCTOS-AUD-010
   * Validar duplicados dentro del archivo antes de escribir.
   */
  const skuRows = new Map();
  for (let idx = 0; idx < rows.length; idx++) {
    const sku = txt(rows[idx]?.sku).toUpperCase();
    if (!sku) continue;
    if (!skuRows.has(sku)) skuRows.set(sku, []);
    skuRows.get(sku).push(idx);
  }

  const duplicateIndexes = new Set();
  for (const indexes of skuRows.values()) {
    if (indexes.length > 1) for (const idx of indexes) duplicateIndexes.add(idx);
  }

  const client = await pool.connect();
  const errors = [];let created = 0,updated = 0;

  try {
    await client.query('BEGIN');

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx] || {};
      const sku = txt(r.sku);
      const nombre = txt(r.nombre);

      if (!sku || !nombre) {
        errors.push({ row: idx + 2, sku, error: 'SKU_AND_NAME_REQUIRED' });
        continue;
      }

      if (duplicateIndexes.has(idx)) {
        errors.push({ row: idx + 2, sku, error: 'DUPLICATE_SKU_IN_FILE' });
        continue;
      }

      const savepoint = `product_import_${idx}`;

      await client.query(`SAVEPOINT ${savepoint}`);

      try {
        const category = txt(r.categoria);
        if (!category) throw new Error('PRODUCT_CATEGORY_REQUIRED');

        const imageReference = txt(r.imagen_url);
        if (!validProductImageReference(imageReference)) {
          throw new Error('PRODUCT_IMAGE_URL_INVALID');
        }

        const categoryR = await client.query(`
          SELECT TRIM(nombre) AS nombre
          FROM gmx.categorias
          WHERE LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM($1::text))
            AND LOWER(TRIM(COALESCE(estado,'Activo')))= 'activo'
          LIMIT 1
        `, [category]);

        if (!categoryR.rowCount) throw new Error('PRODUCT_CATEGORY_INVALID');

        const canonicalCategory = categoryR.rows[0].nombre;

        const existing = await client.query(`
          SELECT row_id,id,stock,costo
          FROM gmx.productos
          WHERE UPPER(TRIM(COALESCE(sku,'')))=
                UPPER(TRIM($1::text))
          ORDER BY row_id
          LIMIT 1
        `, [sku]);

        if (existing.rowCount) {
          /*
           * SKU existente:
           * - actualiza �nicamente datos maestros;
           * - nunca modifica el stock global;
           * - garantiza inventario_sucursales con stock 0 si no existe.
           */
          const existingProduct = existing.rows[0];

          const productParams = [
          Number(existingProduct.row_id),
          nombre,
          txt(r.descripcion),
          canonicalCategory,
          num(r.precio),
          includeCost && txt(r.costo) !== '' ? num(r.costo) : Number(existingProduct.costo || 0),
          Math.max(0, Math.trunc(num(r.stock_minimo))),
          txt(r.estado) || 'Activo',
          imageReference];


          await client.query(`
            UPDATE gmx.productos SET
              nombre=$2::text,
              descripcion=NULLIF($3::text,''),
              categoria=NULLIF($4::text,''),
              precio=$5::numeric,
              costo=$6::numeric,
              stock_minimo=$7::numeric,
              estado=COALESCE(NULLIF($8::text,''),estado),
              imagen=NULLIF($9::text,''),
              fecha_actualizacion=NOW()
            WHERE row_id=$1::bigint
          `, productParams);

          const branchId = txt(r.id_sucursal);
          let branches = [];

          if (branchId) {
            const branchR = await client.query(`
              SELECT id_sucursal,nombre_sucursal
              FROM gmx.sucursales
              WHERE id_sucursal=$1::text
                AND COALESCE(activa,true)=true
              LIMIT 1
            `, [branchId]);

            if (!branchR.rowCount) throw new Error('INITIAL_BRANCH_NOT_FOUND');
            branches = branchR.rows;
          } else {
            const existingInventory = await client.query(`
              SELECT id_sucursal
              FROM gmx.inventario_sucursales
              WHERE id_producto=$1::text
              LIMIT 1
            `, [existingProduct.id]);

            /*
             * Si ya existe cualquier snapshot, no se crean sucursales
             * adicionales durante una actualizaci�n de cat�logo.
             */
            if (!existingInventory.rowCount) {
              const activeBranches = await client.query(`
                SELECT id_sucursal,nombre_sucursal
                FROM gmx.sucursales
                WHERE COALESCE(activa,true)=true
                ORDER BY id_sucursal
              `);

              branches = activeBranches.rows;
            }
          }

          for (const branch of branches) {
            await client.query(`
              INSERT INTO gmx.inventario_sucursales(
                id_registro,id_sucursal,sucursal,id_producto,sku,producto,
                stock,stock_minimo,fecha_actualizacion
              )
              SELECT
                CONCAT('INV-',$1::text,'-',$2::text),
                $2::text,
                $3::text,
                $4::text,
                $5::text,
                $6::text,
                0,
                $7::numeric,
                NOW()
              WHERE NOT EXISTS (
                SELECT 1
                FROM gmx.inventario_sucursales x
                WHERE x.id_sucursal=$2::text
                  AND x.id_producto=$4::text
              )
            `, [
            String(existingProduct.row_id),
            String(branch.id_sucursal),
            String(branch.nombre_sucursal || ''),
            String(existingProduct.id),
            sku,
            nombre,
            Math.max(0, Math.trunc(num(r.stock_minimo)))]
            );
          }

          updated++;
        } else {
          /*
           * SKU nuevo.
           * El maestro siempre nace con stock global 0.
           */
          const initialStock = Math.max(0, Math.trunc(num(r.stock)));

          const inserted = await client.query(`
            INSERT INTO gmx.productos(
              sku,nombre,descripcion,categoria,precio,costo,
              stock,stock_minimo,estado,imagen,fecha_creacion,fecha_actualizacion
            )
            VALUES(
              $1::text,
              $2::text,
              NULLIF($3::text,''),
              NULLIF($4::text,''),
              $5::numeric,
              $6::numeric,
              0,
              $7::numeric,
              $8::text,
              NULLIF($9::text,''),
              NOW(),
              NOW()
            )
            RETURNING row_id,id,sku,nombre
          `, [
          sku,
          nombre,
          txt(r.descripcion),
          canonicalCategory,
          num(r.precio),
          includeCost && txt(r.costo) !== '' ? num(r.costo) : 0,
          Math.max(0, Math.trunc(num(r.stock_minimo))),
          txt(r.estado) || 'Activo',
          imageReference]
          );

          const product = inserted.rows[0];

          /*
           * Alta nueva con stock > 0:
           * requiere sucursal expl�cita cuando hay m�s de una activa.
           */
          if (initialStock > 0) {
            const branchId = txt(r.id_sucursal);
            let branch;

            if (branchId) {
              const branchR = await client.query(`
                SELECT id_sucursal,nombre_sucursal
                FROM gmx.sucursales
                WHERE id_sucursal=$1::text
                  AND COALESCE(activa,true)=true
                LIMIT 1
              `, [branchId]);

              if (!branchR.rowCount) throw new Error('INITIAL_BRANCH_NOT_FOUND');
              branch = branchR.rows[0];
            } else {
              const branches = await client.query(`
                SELECT id_sucursal,nombre_sucursal
                FROM gmx.sucursales
                WHERE COALESCE(activa,true)=true
                ORDER BY id_sucursal
                LIMIT 2
              `);

              if (branches.rowCount !== 1) throw new Error('INITIAL_BRANCH_REQUIRED');
              branch = branches.rows[0];
            }

            await client.query(`
              INSERT INTO gmx.inventario_sucursales(
                id_registro,id_sucursal,sucursal,id_producto,sku,producto,
                stock,stock_minimo,fecha_actualizacion
              )
              VALUES(
                'INV-NEW-'||$1::text,
                $2::text,
                $3::text,
                $4::text,
                $5::text,
                $6::text,
                $7::numeric,
                $8::numeric,
                NOW()
              )
            `, [
            String(product.row_id),
            String(branch.id_sucursal),
            String(branch.nombre_sucursal || ''),
            String(product.id),
            String(product.sku),
            String(product.nombre),
            initialStock,
            Math.max(0, Math.trunc(num(r.stock_minimo)))]
            );

            await client.query(`
              INSERT INTO gmx.movimientos_inventario_sucursales(
                id_movimiento,fecha,id_sucursal,sucursal,id_producto,sku,producto,
                tipo,cantidad,stock_anterior,stock_nuevo,motivo,nombre_usuario,usuario,referencia
              )
              VALUES(
                'MOV-STOCK-INIT-'||$1::text||
                  '-'||TO_CHAR(clock_timestamp(),'YYYYMMDDHH24MISSMS'),
                NOW(),
                $2::text,
                $3::text,
                $4::text,
                $5::text,
                $6::text,
                'STOCK_INICIAL',
                $7::numeric,
                0,
                $7::numeric,
                'Alta de producto con stock inicial',
                COALESCE(NULLIF($8::text,''),'APP Local'),
                NULLIF($8::text,''),
                'PRODUCTOS_EXCEL'
              )
            `, [
            String(product.row_id),
            String(branch.id_sucursal),
            String(branch.nombre_sucursal || ''),
            String(product.id),
            String(product.sku),
            String(product.nombre),
            initialStock,
            txt(user)]
            );
          }

          /*
           * Alta nueva con stock 0:
           * crea snapshot por sucursal activa, sin STOCK_INICIAL.
           */
          if (initialStock === 0) {
            const branchId = txt(r.id_sucursal);
            let branches = [];

            if (branchId) {
              const branchR = await client.query(`
                SELECT id_sucursal,nombre_sucursal
                FROM gmx.sucursales
                WHERE id_sucursal=$1::text
                  AND COALESCE(activa,true)=true
                LIMIT 1
              `, [branchId]);

              if (!branchR.rowCount) throw new Error('INITIAL_BRANCH_NOT_FOUND');
              branches = branchR.rows;
            } else {
              const activeBranches = await client.query(`
                SELECT id_sucursal,nombre_sucursal
                FROM gmx.sucursales
                WHERE COALESCE(activa,true)=true
                ORDER BY id_sucursal
              `);

              branches = activeBranches.rows;
            }

            for (const branch of branches) {
              await client.query(`
                INSERT INTO gmx.inventario_sucursales(
                  id_registro,id_sucursal,sucursal,id_producto,sku,producto,
                  stock,stock_minimo,fecha_actualizacion
                )
                SELECT
                  CONCAT('INV-', $1::text, '-', $2::text),
                  $2::text,
                  $3::text,
                  $4::text,
                  $5::text,
                  $6::text,
                  0,
                  COALESCE($7::numeric,0),
                  NOW()
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM gmx.inventario_sucursales x
                  WHERE x.id_sucursal=$2::text
                    AND x.id_producto=$4::text
                )
              `, [
              String(product.row_id),
              String(branch.id_sucursal),
              String(branch.nombre_sucursal || ''),
              String(product.id),
              String(product.sku),
              String(product.nombre),
              Math.max(0, Math.trunc(num(r.stock_minimo)))]
              );
            }
          }

          created++;
        }

        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        errors.push({
          row: idx + 2,
          sku,
          error: String(e.message || e).slice(0, 220)
        });
      }
    }

    const importId = await logImport(client, {
      type: 'PRODUCTOS_EXCEL',
      fileName: file?.name,
      read: rows.length,
      created,
      updated,
      errors
    }, user);

    await client.query('COMMIT');

    return {
      importId,
      read: rows.length,
      created,
      updated,
      errors
    };
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function importCardsWorkbook(file, user = '') {
  const wb = workbookFromPayload(file);
  const rows = rowsFromSheet(wb, 'Cartas_TCG');
  if (!rows.length) throw new Error('TCG_CARDS_SHEET_EMPTY');

  const client = await pool.connect();
  const errors = [];let created = 0,updated = 0;
  try {
    await client.query('BEGIN');
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const game = txt(r.id_juego).toUpperCase();
      const setCode = txt(r.id_set);
      const number = txt(r.numero_completo);
      const name = txt(r.nombre);
      if (!game || !setCode || !number || !name) {errors.push({ row: idx + 2, error: 'GAME_SET_NUMBER_NAME_REQUIRED' });continue;}
      try {
        const gj = await client.query(`SELECT id_juego FROM gmx.tcg_juegos
          WHERE UPPER(COALESCE(catalogo_codigo,codigo,id_juego))=$1 OR UPPER(id_juego)=$1
          ORDER BY row_id LIMIT 1`, [game]);
        if (!gj.rowCount) throw new Error('GAME_NOT_ENABLED');
        const gameId = gj.rows[0].id_juego;

        const st = await client.query(`SELECT id_set FROM gmx.tcg_sets
          WHERE id_juego=$1 AND (UPPER(COALESCE(codigo,''))=UPPER($2) OR id_set=$2)
          ORDER BY row_id LIMIT 1`, [gameId, setCode]);
        if (!st.rowCount) throw new Error('SET_NOT_ENABLED');
        const setId = st.rows[0].id_set;

        const existing = await client.query(`SELECT row_id FROM gmx.tcg_cartas
          WHERE id_juego=$1 AND id_set=$2 AND UPPER(COALESCE(numero_completo,''))=UPPER($3)
          ORDER BY row_id LIMIT 1`, [gameId, setId, number]);

        const vals = [
        gameId, setId, name, txt(r.numero_carta) || number, txt(r.numero_set), number, txt(r.rareza),
        txt(r.tipo_carta), txt(r.subtipo), txt(r.artista), txt(r.descripcion), txt(r.imagen_url), txt(r.estado_catalogo) || 'ACTIVA'];

        if (existing.rowCount) {
          await client.query(`UPDATE gmx.tcg_cartas SET id_juego=$2,id_set=$3,nombre=$4,numero_carta=$5,numero_set=$6,
            numero_completo=$7,rareza=$8,tipo_carta=$9,subtipo=$10,artista=$11,descripcion=$12,imagen_principal=$13,
            estado_catalogo=$14,fecha_actualizacion=NOW() WHERE row_id=$1`, [existing.rows[0].row_id, ...vals]);
          updated++;
        } else {
          const id = txt(r.id_carta) || `TCGC-${Date.now()}-${idx}-${crypto.randomBytes(2).toString('hex')}`;
          await client.query(`INSERT INTO gmx.tcg_cartas(
            id_carta,id_juego,id_set,nombre,numero_carta,numero_set,numero_completo,rareza,tipo_carta,subtipo,
            artista,descripcion,imagen_principal,estado_catalogo,fecha_creacion,fecha_actualizacion)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())`, [id, ...vals]);
          created++;
        }
      } catch (e) {errors.push({ row: idx + 2, number, error: String(e.message || e).slice(0, 220) });}
    }
    const importId = await logImport(client, { type: 'TCG_CARTAS_EXCEL', fileName: file?.name, read: rows.length, created, updated, errors }, user);
    await client.query('COMMIT');
    return { importId, read: rows.length, created, updated, errors };
  } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
}

export async function importTcgMasterWorkbook(file, user = '') {
  const wb = workbookFromPayload(file);
  const games = rowsFromSheet(wb, 'TCG_Juegos');
  const sets = rowsFromSheet(wb, 'TCG_Sets');
  const rarities = rowsFromSheet(wb, 'TCG_Rarezas');
  if (!games.length && !sets.length && !rarities.length) throw new Error('TCG_MASTER_SHEETS_EMPTY');

  const client = await pool.connect();
  const errors = [];let created = 0,updated = 0,read = games.length + sets.length + rarities.length;
  try {
    await client.query('BEGIN');

    for (const [idx, r] of games.entries()) {
      const code = txt(r.codigo).toUpperCase(),name = txt(r.nombre);
      if (!code || !name) {errors.push({ sheet: 'TCG_Juegos', row: idx + 2, error: 'CODE_NAME_REQUIRED' });continue;}
      const ex = await client.query(`SELECT row_id FROM gmx.tcg_master_juegos WHERE codigo=$1`, [code]);
      await client.query(`INSERT INTO gmx.tcg_master_juegos(codigo,nombre,publisher,sitio_oficial,activo,orden)
        VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6)
        ON CONFLICT(codigo) DO UPDATE SET nombre=EXCLUDED.nombre,publisher=EXCLUDED.publisher,
        sitio_oficial=EXCLUDED.sitio_oficial,activo=EXCLUDED.activo,orden=EXCLUDED.orden,fecha_actualizacion=NOW()`, [
      code, name, txt(r.publisher), txt(r.sitio_oficial), r.activo === '' ? true : bool(r.activo), num(r.orden)]
      );
      ex.rowCount ? updated++ : created++;
    }

    for (const [idx, r] of sets.entries()) {
      const game = txt(r.id_juego).toUpperCase(),code = txt(r.codigo),name = txt(r.nombre);
      if (!game || !code || !name) {errors.push({ sheet: 'TCG_Sets', row: idx + 2, error: 'GAME_CODE_NAME_REQUIRED' });continue;}
      const ex = await client.query(`SELECT row_id FROM gmx.tcg_master_sets WHERE id_juego=$1 AND codigo=$2`, [game, code]);
      await client.query(`INSERT INTO gmx.tcg_master_sets(id_juego,codigo,nombre,fecha_lanzamiento,total_cartas,activo,fuente_oficial)
        VALUES($1,$2,$3,NULLIF($4,'')::date,$5,$6,NULLIF($7,''))
        ON CONFLICT(id_juego,codigo) DO UPDATE SET nombre=EXCLUDED.nombre,fecha_lanzamiento=EXCLUDED.fecha_lanzamiento,
        total_cartas=EXCLUDED.total_cartas,activo=EXCLUDED.activo,fuente_oficial=EXCLUDED.fuente_oficial,fecha_actualizacion=NOW()`, [
      game, code, name, txt(r.fecha_lanzamiento), Math.max(0, Math.trunc(num(r.total_cartas))), r.activo === '' ? true : bool(r.activo), txt(r.fuente_oficial)]
      );
      ex.rowCount ? updated++ : created++;
    }

    for (const [idx, r] of rarities.entries()) {
      const game = txt(r.id_juego).toUpperCase(),code = txt(r.codigo),name = txt(r.nombre);
      if (!game || !code || !name) {errors.push({ sheet: 'TCG_Rarezas', row: idx + 2, error: 'GAME_CODE_NAME_REQUIRED' });continue;}
      const ex = await client.query(`SELECT row_id FROM gmx.tcg_master_rarezas WHERE id_juego=$1 AND codigo=$2`, [game, code]);
      await client.query(`INSERT INTO gmx.tcg_master_rarezas(id_juego,codigo,nombre,activo,orden)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id_juego,codigo) DO UPDATE SET nombre=EXCLUDED.nombre,activo=EXCLUDED.activo,
        orden=EXCLUDED.orden,fecha_actualizacion=NOW()`, [
      game, code, name, r.activo === '' ? true : bool(r.activo), num(r.orden)]
      );
      ex.rowCount ? updated++ : created++;
    }

    const importId = await logImport(client, { type: 'TCG_MASTER_EXCEL', fileName: file?.name, read, created, updated, errors }, user);
    await client.query('COMMIT');
    return { importId, read, created, updated, errors };
  } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}
}


function autoWidths(rows, minimum = 10, maximum = 48) {
  if (!rows.length) return [];
  const widthCount = Math.max(...rows.map((r) => r.length));
  return Array.from({ length: widthCount }, (_, col) => {
    let max = minimum;
    for (const row of rows.slice(0, 300)) {
      const len = String(row[col] ?? '').length + 2;
      if (len > max) max = len;
    }
    return { wch: Math.min(max, maximum) };
  });
}

export async function buildDynamicImportTemplate() {
  const [gamesR, setsR, raritiesR, categoriesR] = await Promise.all([
  query(`SELECT
        m.codigo,m.nombre,m.publisher,m.sitio_oficial,
        COALESCE(j.visible_portal,false) AS visible_portal,
        m.activo,m.orden
      FROM gmx.tcg_master_juegos m
      LEFT JOIN gmx.tcg_juegos j ON j.catalogo_codigo=m.codigo
      ORDER BY COALESCE(m.orden,999999),m.nombre`),
  query(`SELECT id_juego,codigo,nombre,
        COALESCE(TO_CHAR(fecha_lanzamiento,'YYYY-MM-DD'),'') AS fecha_lanzamiento,
        total_cartas,activo,fuente_oficial
      FROM gmx.tcg_master_sets
      ORDER BY id_juego,COALESCE(fecha_lanzamiento,'1900-01-01'::date),codigo`),
  query(`SELECT id_juego,codigo,nombre,activo,orden
      FROM gmx.tcg_master_rarezas
      ORDER BY id_juego,COALESCE(orden,999999),nombre`),
  query(`SELECT DISTINCT categoria FROM gmx.productos
      WHERE NULLIF(TRIM(COALESCE(categoria,'')),'') IS NOT NULL
      ORDER BY categoria`)]
  );

  const wb = XLSX.utils.book_new();

  const instructions = [
  [brandText("GMX · Plantilla dinámica de importación")],
  [],
  ['Hoja', 'Uso', 'Clave / regla', 'Obligatorio', 'Notas', 'Ejemplo'],
  ['Productos', 'Alta/actualización masiva de productos', 'sku', 'Sí', 'SKU existente actualiza; SKU nuevo crea.', 'CAM001'],
  ['Cartas_TCG', 'Alta/actualización de cartas', 'id_juego + id_set + numero_completo', 'Sí', 'Juego, set y rareza deben pertenecer al mismo TCG.', 'OP01-003'],
  ['TCG_Juegos', 'Catálogo maestro actual', 'codigo', 'Sí', 'Se genera desde PostgreSQL en el momento de descargar.', 'POKEMON'],
  ['TCG_Sets', 'Expansiones actuales por TCG', 'id_juego + codigo', 'Sí', 'Solo expansiones del TCG indicado.', 'OP-01'],
  ['TCG_Rarezas', 'Rarezas actuales por TCG', 'id_juego + codigo', 'Sí', 'Las rarezas están aisladas por TCG.', 'SR'],
  [],
  ['Regla', 'No cambies los encabezados.', '', '', '', ''],
  ['Regla', 'Nuevos TCG, sets y rarezas aparecen automáticamente en una nueva descarga.', '', '', '', ''],
  ['Regla', 'Nombres de personas no admiten números.', '', 'Sí', 'Se permiten acentos, espacios, apóstrofe y guion.', 'José García-López'],
  ['Regla', 'CP México usa 5 dígitos. Teléfono se normaliza y valida.', '', 'Sí', '', ''],
  ['Regla', 'Campos de catálogo deben utilizar los valores incluidos en las hojas maestras.', '', 'Sí', '', '']];

  const wi = XLSX.utils.aoa_to_sheet(instructions);
  wi['!cols'] = autoWidths(instructions, 14, 55);
  XLSX.utils.book_append_sheet(wb, wi, 'Instrucciones');

  const productRows = [
  ['id', 'sku', 'nombre', 'descripcion', 'categoria', 'precio', 'costo', 'stock', 'stock_minimo', 'estado', 'imagen_url'],
  ['', 'CAM001', 'Camiseta Negra', 'Camiseta manga corta', 'Ropa', 299, 150, 25, 5, 'Activo', 'https://ejemplo.com/camiseta.jpg']];

  const wp = XLSX.utils.aoa_to_sheet(productRows);
  wp['!cols'] = autoWidths(productRows, 12, 42);
  XLSX.utils.book_append_sheet(wb, wp, 'Productos');

  const cardRows = [
  ['id_carta', 'id_juego', 'id_set', 'nombre', 'numero_carta', 'numero_set', 'numero_completo', 'rareza', 'tipo_carta', 'subtipo', 'artista', 'descripcion', 'imagen_url', 'estado_catalogo'],
  ['', 'ONEPIECE', 'OP-01', 'Monkey.D.Luffy', '003', '121', 'OP01-003', 'L', 'LEADER', '', '', 'Ejemplo', 'https://ejemplo.com/op01-003.jpg', 'ACTIVA']];

  const wc = XLSX.utils.aoa_to_sheet(cardRows);
  wc['!cols'] = autoWidths(cardRows, 12, 42);
  XLSX.utils.book_append_sheet(wb, wc, 'Cartas_TCG');

  const gameRows = [
  ['codigo', 'nombre', 'publisher', 'sitio_oficial', 'visible_portal', 'activo', 'orden'],
  ...gamesR.rows.map((x) => [x.codigo, x.nombre, x.publisher || '', x.sitio_oficial || '', !!x.visible_portal, !!x.activo, Number(x.orden || 0)])];

  const wg = XLSX.utils.aoa_to_sheet(gameRows);
  wg['!cols'] = autoWidths(gameRows, 12, 48);
  XLSX.utils.book_append_sheet(wb, wg, 'TCG_Juegos');

  const setRows = [
  ['id_juego', 'codigo', 'nombre', 'fecha_lanzamiento', 'total_cartas', 'activo', 'fuente_oficial'],
  ...setsR.rows.map((x) => [x.id_juego, x.codigo, x.nombre, x.fecha_lanzamiento || '', Number(x.total_cartas || 0), !!x.activo, x.fuente_oficial || ''])];

  const ws = XLSX.utils.aoa_to_sheet(setRows);
  ws['!cols'] = autoWidths(setRows, 12, 48);
  XLSX.utils.book_append_sheet(wb, ws, 'TCG_Sets');

  const rarityRows = [
  ['id_juego', 'codigo', 'nombre', 'activo', 'orden'],
  ...raritiesR.rows.map((x) => [x.id_juego, x.codigo, x.nombre, !!x.activo, Number(x.orden || 0)])];

  const wr = XLSX.utils.aoa_to_sheet(rarityRows);
  wr['!cols'] = autoWidths(rarityRows, 12, 36);
  XLSX.utils.book_append_sheet(wb, wr, 'TCG_Rarezas');

  const categoryRows = [['categorias_producto'], ...categoriesR.rows.map((x) => [x.categoria])];
  const wcat = XLSX.utils.aoa_to_sheet(categoryRows);
  wcat['!cols'] = [{ wch: 34 }];
  XLSX.utils.book_append_sheet(wb, wcat, 'Catalogos_Producto');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}


export function parseTcgReceiptWorkbook(file) {
  const wb = workbookFromPayload(file);
  const sheetName = ['TCG_Recepcion', 'TCG Recepcion', 'Recepcion_TCG', 'Recepcion TCG'].
  find((name) => wb.Sheets[name]);
  if (!sheetName) throw new Error('TCG_RECEIPT_SHEET_NOT_FOUND');

  const rows = rowsFromSheet(wb, sheetName);
  if (!rows.length) throw new Error('TCG_RECEIPT_SHEET_EMPTY');

  const normalized = [];
  const errors = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx] || {};
    const sourceType = txt(r.tipo_origen || r.TipoOrigen || r.tipo_entrada || 'ADQUISICION').toUpperCase();
    const idCarta = txt(r.id_carta || r.IDCarta);
    const branchId = txt(r.id_sucursal || r.IDSucursal);
    const quantity = Math.trunc(num(r.cantidad || r.Cantidad));
    const cost = num(r.costo_unitario || r.CostoUnitario);
    const price = num(r.precio_venta || r.PrecioVenta);
    const offer = num(r.precio_oferta || r.PrecioOferta);

    const problems = [];
    if (!['INVENTARIO_INICIAL', 'ADQUISICION'].includes(sourceType)) problems.push('TIPO_ORIGEN_INVALIDO');
    if (!idCarta) problems.push('ID_CARTA_REQUERIDO');
    if (!branchId) problems.push('ID_SUCURSAL_REQUERIDO');
    if (!Number.isFinite(quantity) || quantity <= 0) problems.push('CANTIDAD_INVALIDA');
    if (cost < 0 || price < 0 || offer < 0) problems.push('PRECIO_INVALIDO');

    const row = {
      source_row: idx + 2,
      tipo_entrada: sourceType,
      id_carta: idCarta,
      id_sucursal: branchId,
      idioma: txt(r.idioma || r.Idioma || 'ES').toUpperCase(),
      condicion: txt(r.condicion || r.Condicion || 'NM').toUpperCase(),
      acabado: txt(r.acabado || r.Acabado || 'NORMAL').toUpperCase(),
      edicion: txt(r.edicion || r.Edicion),
      graded: bool(r.graded || r.Graded),
      empresa_grading: txt(r.empresa_grading || r.EmpresaGrading),
      grado: txt(r.grado || r.Grado),
      certificado: txt(r.certificado || r.Certificado),
      cantidad: quantity,
      costo_unitario: cost,
      precio_venta: price,
      precio_oferta: offer,
      origen_nombre: txt(r.origen_nombre || r.OrigenNombre),
      origen_referencia: txt(r.origen_referencia || r.OrigenReferencia),
      documento: txt(r.documento || r.Documento),
      notas: txt(r.notas || r.Notas)
    };

    if (problems.length) errors.push({ row: idx + 2, error: problems.join(', ') });else
    normalized.push(row);
  }

  return {
    fileName: txt(file?.name),
    totalRows: rows.length,
    validRows: normalized.length,
    invalidRows: errors.length,
    rows: normalized,
    errors
  };
}

export async function buildTcgReceiptTemplate() {
  const [cardsR, branchesR] = await Promise.all([
  query(`SELECT
      c.id_carta,
      COALESCE(j.nombre,c.id_juego) AS tcg,
      COALESCE(s.nombre,c.id_set) AS expansion,
      c.numero_completo,
      c.nombre AS carta,
      c.rareza
    FROM gmx.tcg_cartas c
    LEFT JOIN gmx.tcg_juegos j ON j.id_juego=c.id_juego
    LEFT JOIN gmx.tcg_sets s ON s.id_set=c.id_set
    ORDER BY tcg,expansion,c.numero_completo,c.nombre`),
  query(`SELECT id_sucursal,nombre_sucursal
      FROM gmx.sucursales
      WHERE COALESCE(activa,true)=true
      ORDER BY nombre_sucursal`)]
  );

  const wb = XLSX.utils.book_new();

  const guide = [
  [brandText("GMX · Recepción TCG masiva")],
  ['La plantilla se genera desde la DBA actual. No cambies los encabezados.'],
  [],
  ['tipo_origen', 'INVENTARIO_INICIAL = existencia física previa; ADQUISICION = mercancía que estás recibiendo.'],
  ['id_carta', 'Usa un ID existente de la hoja Catalogo_Cartas.'],
  ['id_sucursal', 'Usa una sucursal existente de la hoja Sucursales.'],
  ['cantidad', 'Entero mayor a 0.'],
  ['costo_unitario', 'Costo real por unidad.'],
  ['precio_venta', brandText("Precio tienda GMX.")],
  ['precio_oferta', 'Opcional. Precio promocional/oferta.'],
  [],
  ['Archivos grandes', brandText("No hay límite fijo de filas. GMX valida el archivo completo y procesa en bloques de 500.")]];

  const guideWs = XLSX.utils.aoa_to_sheet(guide);
  guideWs['!cols'] = [{ wch: 25 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guideWs, 'Instrucciones');

  const headers = [
  'tipo_origen', 'id_carta', 'id_sucursal', 'idioma', 'condicion', 'acabado', 'edicion',
  'graded', 'empresa_grading', 'grado', 'certificado', 'cantidad', 'costo_unitario',
  'precio_venta', 'precio_oferta', 'origen_nombre', 'origen_referencia', 'documento', 'notas'];

  const sample = [
  'ADQUISICION', cardsR.rows[0]?.id_carta || '', branchesR.rows[0]?.id_sucursal || '',
  'ES', 'NM', 'NORMAL', '', false, '', '', '', 1, 0, 0, 0, 'Proveedor / Cliente', 'LOTE-001', '', ''];

  const receiveWs = XLSX.utils.aoa_to_sheet([headers, sample]);
  receiveWs['!cols'] = headers.map((h) => ({ wch: Math.max(14, Math.min(28, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, receiveWs, 'TCG_Recepcion');

  const cardsWs = XLSX.utils.json_to_sheet(cardsR.rows);
  cardsWs['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 32 }, { wch: 16 }, { wch: 42 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, cardsWs, 'Catalogo_Cartas');

  const branchWs = XLSX.utils.json_to_sheet(branchesR.rows);
  branchWs['!cols'] = [{ wch: 24 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, branchWs, 'Sucursales');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
