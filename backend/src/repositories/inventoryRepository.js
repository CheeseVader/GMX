import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';

export async function listInventory({
  branchId = '',
  search = '',
  category = '',
  stockStatus = 'all',
  productStatus = '',
  sort = 'name',
  direction = 'asc',
  limit = 50,
  offset = 0
}) {
  const values = [];
  const filters = [];

  if (branchId) {
    values.push(branchId);
    filters.push(`i.id_sucursal=$${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    const q = `$${values.length}`;
    filters.push(`(
      COALESCE(p.nombre,i.producto,'') ILIKE ${q}
      OR COALESCE(p.sku,i.sku,'') ILIKE ${q}
      OR COALESCE(p.id,i.id_producto,'') ILIKE ${q}
      OR COALESCE(p.codigo_barras,'') ILIKE ${q}
      OR COALESCE(p.categoria,'') ILIKE ${q}
      OR COALESCE(i.sucursal,'') ILIKE ${q}
    )`);
  }

  if (category) {
    values.push(category);
    filters.push(`LOWER(COALESCE(p.categoria,''))=LOWER($${values.length})`);
  }

  if (productStatus) {
    values.push(productStatus);
    filters.push(`LOWER(COALESCE(p.estado,''))=LOWER($${values.length})`);
  }

  if (stockStatus === 'low') {
    filters.push(`COALESCE(i.stock,0)<=COALESCE(i.stock_minimo,0) AND COALESCE(i.stock,0)>0`);
  } else if (stockStatus === 'out') {
    filters.push(`COALESCE(i.stock,0)=0`);
  } else if (stockStatus === 'available') {
    filters.push(`COALESCE(i.stock,0)>0`);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const sortColumns = {
    name: `COALESCE(p.nombre,i.producto,'')`,
    sku: `COALESCE(p.sku,i.sku,'')`,
    stock: `COALESCE(i.stock,0)`,
    price: `COALESCE(p.precio,0)`,
    updated: `i.fecha_actualizacion`,
    branch: `COALESCE(i.sucursal,'')`
  };
  const order = sortColumns[sort] || sortColumns.name;
  const dir = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const count = await query(`
    SELECT COUNT(*)::bigint total
    FROM gmx.inventario_sucursales i
    LEFT JOIN gmx.productos p ON p.id=i.id_producto
    ${whereSql}
  `, values);

  const summary = await query(`
    SELECT
      COUNT(*)::bigint records,
      COALESCE(SUM(COALESCE(i.stock,0)),0)::bigint units,
      COUNT(*) FILTER(WHERE COALESCE(i.stock,0)=0)::bigint out_of_stock,
      COUNT(*) FILTER(
        WHERE COALESCE(i.stock,0)>0
          AND COALESCE(i.stock,0)<=COALESCE(i.stock_minimo,0)
      )::bigint low_stock
    FROM gmx.inventario_sucursales i
    LEFT JOIN gmx.productos p ON p.id=i.id_producto
    ${whereSql}
  `, values);

  const rowValues = [...values, limit, offset];
  const li = rowValues.length - 1,oi = rowValues.length;
  const rows = await query(`
    SELECT
      i.row_id,i.id_registro,i.id_sucursal,i.sucursal,
      i.id_producto,
      COALESCE(p.sku,i.sku) AS sku,
      COALESCE(p.nombre,i.producto) AS producto,
      p.codigo_barras,p.categoria,
      i.stock,i.stock_minimo,i.fecha_actualizacion,
      p.precio,p.costo,p.estado AS estado_producto
    FROM gmx.inventario_sucursales i
    LEFT JOIN gmx.productos p ON p.id=i.id_producto
    ${whereSql}
    ORDER BY ${order} ${dir} NULLS LAST,i.row_id ASC
    LIMIT $${li} OFFSET $${oi}
  `, rowValues);

  rows.total = Number(count.rows[0]?.total || 0);
  rows.summary = summary.rows[0] || {};
  return rows;
}

export async function listMovements({ branchId = '', productId = '', limit = 100 }) {
  const values = [];
  const filters = [];

  if (branchId) {
    values.push(branchId);
    filters.push(`id_sucursal = $${values.length}`);
  }

  if (productId) {
    values.push(productId);
    filters.push(`id_producto = $${values.length}`);
  }

  values.push(limit);

  return query(`
    SELECT
      row_id, id_movimiento, fecha, id_sucursal, sucursal,
      id_producto, sku, producto, tipo, cantidad,
      stock_anterior, stock_nuevo, motivo, id_admin,
      nombre_usuario, usuario, referencia
    FROM gmx.movimientos_inventario_sucursales
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY fecha DESC NULLS LAST, row_id DESC
    LIMIT $${values.length}
  `, values);
}

async function lockInventory(client, branchId, productId) {
  const found = await client.query(`
    SELECT *
    FROM gmx.inventario_sucursales
    WHERE id_sucursal = $1 AND id_producto = $2
    ORDER BY row_id
    LIMIT 1
    FOR UPDATE
  `, [branchId, productId]);
  return found.rows[0] || null;
}

async function productInfo(client, productId) {
  const result = await client.query(`
    SELECT id, sku, nombre
    FROM gmx.productos
    WHERE id = $1
    ORDER BY row_id
    LIMIT 1
  `, [productId]);
  return result.rows[0] || null;
}

async function branchInfo(client, branchId) {
  const result = await client.query(`
    SELECT id_sucursal, nombre_sucursal
    FROM gmx.sucursales
    WHERE id_sucursal = $1
    ORDER BY row_id
    LIMIT 1
  `, [branchId]);
  return result.rows[0] || null;
}

async function ensureInventoryRow(client, branch, product) {
  let row = await lockInventory(client, branch.id_sucursal, product.id);
  if (row) return row;

  const inserted = await client.query(`
    INSERT INTO gmx.inventario_sucursales (
      id_registro, id_sucursal, sucursal,
      id_producto, sku, producto,
      stock, stock_minimo, fecha_actualizacion
    )
    VALUES (
      'INV-LOCAL-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text),1,6),
      $1, $2, $3, $4, $5, 0, 0, NOW()
    )
    RETURNING *
  `, [
  branch.id_sucursal, branch.nombre_sucursal,
  product.id, product.sku, product.nombre]
  );

  return inserted.rows[0];
}

function actorInfo(user = {}) {
  const email = String(user?.email || user?.usuario || '').trim();
  const name = String(user?.nombre || user?.name || email || brandText("GMX Local")).trim();
  const idAdmin = String(user?.id_admin || user?.id || '').trim();
  return { email, name, idAdmin };
}

async function logMovement(client, {
  branch, product, type, quantity, before, after, reason, reference, user = {}
}) {
  const actor = actorInfo(user);
  await client.query(`
    INSERT INTO gmx.movimientos_inventario_sucursales (
      id_movimiento, fecha, id_sucursal, sucursal,
      id_producto, sku, producto, tipo, cantidad,
      stock_anterior, stock_nuevo, motivo,
      id_admin, nombre_usuario, usuario, referencia
    )
    VALUES (
      'MOV-LOCAL-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text),1,6),
      NOW(), $1, $2, $3, $4, $5, $6, $7,
      $8, $9, NULLIF($10,''), NULLIF($11,''), $12, NULLIF($13,''), NULLIF($14,'')
    )
  `, [
  branch.id_sucursal, branch.nombre_sucursal,
  product.id, product.sku, product.nombre,
  type, quantity, before, after, reason,
  actor.idAdmin, actor.name, actor.email, reference]
  );
}

export async function adjustInventory({ branchId, productId, quantity, mode, reason = '', user = {} }) {
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) throw new Error('ADJUSTMENT_REASON_REQUIRED');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const branch = await branchInfo(client, branchId);
    const product = await productInfo(client, productId);
    if (!branch) throw new Error('BRANCH_NOT_FOUND');
    if (!product) throw new Error('PRODUCT_NOT_FOUND');

    const row = await ensureInventoryRow(client, branch, product);
    const before = Number(row.stock || 0);
    let after;

    if (mode === 'set') after = quantity;else
    if (mode === 'add') after = before + quantity;else
    if (mode === 'remove') after = before - quantity;else
    throw new Error('INVALID_ADJUSTMENT_MODE');

    if (after < 0) throw new Error('INSUFFICIENT_STOCK');

    await client.query(`
      UPDATE gmx.inventario_sucursales
      SET stock = $1, fecha_actualizacion = NOW()
      WHERE row_id = $2
    `, [after, row.row_id]);

    await logMovement(client, {
      branch, product,
      type: mode === 'set' ? 'AJUSTE' : mode === 'add' ? 'ENTRADA' : 'SALIDA',
      quantity: mode === 'set' ? after - before : quantity,
      before, after, reason: normalizedReason, reference: 'AJUSTE_LOCAL', user
    });

    await client.query('COMMIT');
    return { branch, product, before, after };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function transferInventory({ originId, destinationId, productId, quantity, reason = '', user = {} }) {
  if (originId === destinationId) throw new Error('SAME_BRANCH');
  if (quantity <= 0) throw new Error('INVALID_QUANTITY');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const origin = await branchInfo(client, originId);
    const destination = await branchInfo(client, destinationId);
    const product = await productInfo(client, productId);

    if (!origin || !destination) throw new Error('BRANCH_NOT_FOUND');
    if (!product) throw new Error('PRODUCT_NOT_FOUND');

    // Stable lock ordering lowers deadlock risk.
    const branchIds = [originId, destinationId].sort();
    const rows = {};
    for (const id of branchIds) {
      const branch = id === originId ? origin : destination;
      rows[id] = await ensureInventoryRow(client, branch, product);
    }

    const originRow = rows[originId];
    const destinationRow = rows[destinationId];
    const originBefore = Number(originRow.stock || 0);
    const destinationBefore = Number(destinationRow.stock || 0);

    if (originBefore < quantity) throw new Error('INSUFFICIENT_STOCK');

    const originAfter = originBefore - quantity;
    const destinationAfter = destinationBefore + quantity;
    const transferId =
    'TRF-LOCAL-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);

    await client.query(`
      UPDATE gmx.inventario_sucursales
      SET stock = $1, fecha_actualizacion = NOW()
      WHERE row_id = $2
    `, [originAfter, originRow.row_id]);

    await client.query(`
      UPDATE gmx.inventario_sucursales
      SET stock = $1, fecha_actualizacion = NOW()
      WHERE row_id = $2
    `, [destinationAfter, destinationRow.row_id]);

    const actor = actorInfo(user);

    await client.query(`
      INSERT INTO gmx.inventario_transferencias (
        id_transferencia, fecha, tipo,
        id_origen, origen, id_destino, destino,
        estado, total_unidades, motivo,
        id_admin, nombre_admin, email_admin, fecha_completada
      )
      VALUES (
        $1, NOW(), 'TRANSFERENCIA',
        $2, $3, $4, $5,
        'COMPLETADA', $6, NULLIF($7,''),
        NULLIF($8,''), $9, NULLIF($10,''), NOW()
      )
    `, [
    transferId,
    origin.id_sucursal, origin.nombre_sucursal,
    destination.id_sucursal, destination.nombre_sucursal,
    quantity, reason, actor.idAdmin, actor.name, actor.email]
    );

    await client.query(`
      INSERT INTO gmx.inventario_transferencias_detalle (
        id_detalle, id_transferencia, id_producto, sku, producto,
        cantidad, stock_origen_anterior, stock_origen_nuevo,
        stock_destino_anterior, stock_destino_nuevo
      )
      VALUES (
        'TRFD-LOCAL-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '-' || substr(md5(random()::text),1,6),
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
    `, [
    transferId, product.id, product.sku, product.nombre, quantity,
    originBefore, originAfter, destinationBefore, destinationAfter]
    );

    await logMovement(client, {
      branch: origin, product, type: 'TRANSFERENCIA_SALIDA', quantity,
      before: originBefore, after: originAfter, reason, reference: transferId, user
    });

    await logMovement(client, {
      branch: destination, product, type: 'TRANSFERENCIA_ENTRADA', quantity,
      before: destinationBefore, after: destinationAfter, reason, reference: transferId, user
    });

    await client.query('COMMIT');

    return {
      transferId, product, origin, destination, quantity,
      originBefore, originAfter, destinationBefore, destinationAfter
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listTransfers({ limit = 100 }) {
  return query(`
    SELECT
      row_id, id_transferencia, fecha, tipo,
      id_origen, origen, id_destino, destino,
      estado, total_unidades, proveedor,
      referencia_externa, motivo,
      id_admin, nombre_admin, email_admin, fecha_completada
    FROM gmx.inventario_transferencias
    ORDER BY fecha DESC NULLS LAST, row_id DESC
    LIMIT $1
  `, [limit]);
}
