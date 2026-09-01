import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';

const LIST_COLUMNS = `
  row_id,id,sku,codigo_barras,nombre,descripcion,precio,costo,stock,stock_minimo,categoria,estado,imagen,moneda_precio,precio_origen,tcg_game_code,tdc_aplicado,precio_mxn_calculado,
  fecha_creacion,fecha_actualizacion,
  CASE WHEN imagen IS NULL OR imagen='' THEN false ELSE true END AS tiene_imagen
`;

export async function listProducts({ search = '', category = '', status = '', limit = 50, offset = 0 }) {
  const values = [],where = [];

  /*
   * PRODUCTOS-AUD-011
   * Búsqueda tolerante a espacios/whitespace y case-insensitive.
   * Se tokeniza el texto para que "Producto Bulk Nuevo" encuentre el
   * registro aunque Excel haya introducido whitespace distinto.
   */
  const normalizedSearch = String(search || '').trim().replace(/\s+/g, ' ');
  if (normalizedSearch) {
    const tokens = normalizedSearch.split(' ').filter(Boolean);

    for (const token of tokens) {
      values.push(`%${token}%`);
      const p = `$${values.length}`;

      where.push(`(
        regexp_replace(COALESCE(nombre,''),'[[:space:]]+',' ','g') ILIKE ${p}
        OR regexp_replace(COALESCE(descripcion,''),'[[:space:]]+',' ','g') ILIKE ${p}
        OR regexp_replace(COALESCE(sku,''),'[[:space:]]+',' ','g') ILIKE ${p}
        OR regexp_replace(COALESCE(id,''),'[[:space:]]+',' ','g') ILIKE ${p}
        OR regexp_replace(COALESCE(codigo_barras,''),'[[:space:]]+',' ','g') ILIKE ${p}
        OR regexp_replace(COALESCE(categoria,''),'[[:space:]]+',' ','g') ILIKE ${p}
      )`);
    }
  }

  if (category) {
    values.push(category);
    where.push(`LOWER(TRIM(COALESCE(categoria,'')))=LOWER(TRIM($${values.length}))`);
  }

  if (status) {
    values.push(status);
    where.push(`LOWER(TRIM(COALESCE(estado,'')))=LOWER(TRIM($${values.length}))`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await query(`SELECT COUNT(*)::bigint total FROM gmx.productos ${whereSql}`, values);

  values.push(limit, offset);
  const li = values.length - 1,oi = values.length;

  const rows = await query(`
    SELECT ${LIST_COLUMNS}
    FROM gmx.productos
    ${whereSql}
    ORDER BY COALESCE(nombre,''),row_id
    LIMIT $${li} OFFSET $${oi}
  `, values);

  rows.total = Number(count.rows[0]?.total || 0);
  return rows;
}
export async function productStats() {
  return query(`
    WITH inv AS (
      SELECT id_producto,
        COALESCE(SUM(stock),0)::bigint stock_total,
        COALESCE(SUM(stock_minimo),0)::bigint minimum_total
      FROM gmx.inventario_sucursales
      GROUP BY id_producto
    )
    SELECT
      COUNT(*)::bigint total,
      COUNT(*) FILTER(WHERE LOWER(COALESCE(p.estado,''))='activo')::bigint activos,
      COUNT(*) FILTER(
        WHERE COALESCE(inv.stock_total,0)<=COALESCE(p.stock_minimo,0)
      )::bigint stock_bajo,
      COALESCE(SUM(COALESCE(inv.stock_total,0)),0)::bigint unidades,
      COALESCE(SUM(COALESCE(inv.stock_total,0)*COALESCE(p.costo,0)),0)::numeric valor_costo,
      COALESCE(SUM(COALESCE(inv.stock_total,0)*COALESCE(p.precio,0)),0)::numeric valor_venta
    FROM gmx.productos p
    LEFT JOIN inv ON inv.id_producto=p.id
  `);
}
export async function productCategories() {
  return query(`
    SELECT
      c.id,
      TRIM(c.nombre) AS nombre,
      c.estado,
      COUNT(p.row_id)::bigint AS total
    FROM gmx.categorias c
    LEFT JOIN gmx.productos p
      ON LOWER(TRIM(COALESCE(p.categoria,'')))=LOWER(TRIM(COALESCE(c.nombre,'')))
    WHERE NULLIF(TRIM(COALESCE(c.nombre,'')),'') IS NOT NULL
      AND LOWER(TRIM(COALESCE(c.estado,'Activo')))='activo'
    GROUP BY c.id,c.nombre,c.estado
    ORDER BY TRIM(c.nombre)
  `);
}

async function canonicalActiveCategory(client, category) {
  const requested = String(category || '').trim();
  if (!requested) throw new Error('PRODUCT_CATEGORY_REQUIRED');

  const found = await client.query(`
    SELECT id,TRIM(nombre) nombre,estado
    FROM gmx.categorias
    WHERE LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM($1))
      AND LOWER(TRIM(COALESCE(estado,'Activo')))='activo'
    LIMIT 1
  `, [requested]);

  if (!found.rowCount) throw new Error('PRODUCT_CATEGORY_INVALID');
  return found.rows[0].nombre;
}
export async function getProduct(identifier) {
  const value = String(identifier ?? '').trim();
  if (!value) return null;

  const r = await query(`
    SELECT ${LIST_COLUMNS}
    FROM gmx.productos
    WHERE row_id = CASE
      WHEN $1 ~ '^[0-9]+$' THEN $1::bigint
      ELSE NULL
    END
    OR id = $1
    LIMIT 1
  `, [value]);

  return r.rows[0] || null;
}

export async function productIntegrity() {
  const duplicates = await query(`
    SELECT UPPER(TRIM(sku)) sku_normalizado,
           COUNT(*)::bigint total,
           ARRAY_AGG(row_id ORDER BY row_id) row_ids,
           ARRAY_AGG(COALESCE(id,'') ORDER BY row_id) ids,
           ARRAY_AGG(COALESCE(nombre,'') ORDER BY row_id) nombres
    FROM gmx.productos
    WHERE NULLIF(TRIM(COALESCE(sku,'')),'') IS NOT NULL
    GROUP BY UPPER(TRIM(sku))
    HAVING COUNT(*)>1
    ORDER BY UPPER(TRIM(sku))
  `);
  return { duplicate_skus: duplicates.rows, duplicate_count: duplicates.rowCount };
}

async function assertSkuAvailable(client, sku, excludeRowId = null) {
  const normalized = String(sku || '').trim();
  if (!normalized) throw new Error('PRODUCT_SKU_REQUIRED');
  const values = [normalized];
  let sql = `SELECT row_id,id,sku,nombre FROM gmx.productos
           WHERE UPPER(TRIM(COALESCE(sku,'')))=UPPER(TRIM($1))`;
  if (excludeRowId !== null) {values.push(excludeRowId);sql += ` AND row_id<>$2`;}
  sql += ` LIMIT 1`;
  const found = await client.query(sql, values);
  if (found.rowCount) {
    const error = new Error('PRODUCT_SKU_DUPLICATE');
    error.existing = found.rows[0];
    throw error;
  }
}
export async function createProduct(input, context = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertSkuAvailable(client, input.sku);
    const canonicalCategory = await canonicalActiveCategory(client, input.categoria);

    const created = await client.query(`
      INSERT INTO gmx.productos(
        sku,codigo_barras,nombre,descripcion,precio,costo,
        stock,stock_minimo,categoria,imagen,estado,fecha_creacion,fecha_actualizacion,
        moneda_precio,precio_origen,tcg_game_code
      )
      VALUES(
        NULLIF($1,''),NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),
        $5,$6,0,$7,NULLIF($8,''),NULLIF($9,''),
        COALESCE(NULLIF($10,''),'Activo'),NOW(),NOW(),
        COALESCE(NULLIF($11,''),'MXN'),$12,NULLIF($13,'')
      )
      RETURNING row_id,id,sku,nombre
    `, [
    input.sku, input.codigo_barras, input.nombre, input.descripcion,
    input.precio, input.costo, input.stock_minimo, canonicalCategory, input.imagen ?? '', input.estado, input.moneda_precio ?? 'MXN', input.precio_origen ?? input.precio, input.tcg_game_code ?? '']
    );

    const product = created.rows[0];
    const initialStock = Math.max(0, Number(input.initial_stock || 0));

    if (initialStock > 0) {
      if (!input.initial_branch_id) throw new Error('INITIAL_BRANCH_REQUIRED');

      const branch = await client.query(`
        SELECT id_sucursal,nombre_sucursal
        FROM gmx.sucursales
        WHERE id_sucursal=$1 AND COALESCE(activa,true)=true
        LIMIT 1
      `, [input.initial_branch_id]);

      if (!branch.rowCount) throw new Error('INITIAL_BRANCH_NOT_FOUND');
      const b = branch.rows[0];

      await client.query(`
        INSERT INTO gmx.inventario_sucursales(
          id_registro,id_sucursal,sucursal,
          id_producto,sku,producto,
          stock,stock_minimo,fecha_actualizacion
        )
        VALUES(
          'INV-NEW-'||$1::text,
          $2,$3,$4,$5,$6,$7,$8,NOW()
        )
      `, [
      product.row_id, b.id_sucursal, b.nombre_sucursal,
      product.id, product.sku, product.nombre,
      initialStock, Number(input.stock_minimo || 0)]
      );

      /*
       * PRODUCTOS-AUD-006/007
       * El stock inicial debe tener trazabilidad en la MISMA transacción
       * que crea producto e inventario por sucursal.
       */
      await client.query(`
        INSERT INTO gmx.movimientos_inventario_sucursales(
          id_movimiento,
          fecha,
          id_sucursal,
          sucursal,
          id_producto,
          sku,
          producto,
          tipo,
          cantidad,
          stock_anterior,
          stock_nuevo,
          motivo,
          nombre_usuario,
          usuario,
          referencia
        )
        VALUES(
          'MOV-STOCK-INIT-'||$1::text||'-'||TO_CHAR(clock_timestamp(),'YYYYMMDDHH24MISSMS'),
          NOW(),
          $2,$3,$4,$5,$6,
          'STOCK_INICIAL',
          $7,
          0,
          $7,
          'Alta de producto con stock inicial',
          COALESCE(NULLIF($8,''),'APP Local'),
          NULLIF($8,''),
          'PRODUCTOS'
        )
      `, [
      product.row_id,
      b.id_sucursal,
      b.nombre_sucursal,
      product.id,
      product.sku,
      product.nombre,
      initialStock,
      String(context.usuario || '').trim()]
      );
    }

    await client.query('COMMIT');
    return getProduct(product.row_id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateProduct(identifier, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const key = String(identifier ?? '').trim();
    if (!key) {
      await client.query('ROLLBACK');
      return null;
    }

    const target = await client.query(`
      SELECT row_id
      FROM gmx.productos
      WHERE row_id = CASE
        WHEN $1 ~ '^[0-9]+$' THEN $1::bigint
        ELSE NULL
      END
      OR id = $1
      LIMIT 1
      FOR UPDATE
    `, [key]);

    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }

    const rowId = target.rows[0].row_id;

    await assertSkuAvailable(client, input.sku, rowId);
    const canonicalCategory = await canonicalActiveCategory(client, input.categoria);
    const r = await client.query(`
      UPDATE gmx.productos SET
        sku=NULLIF($1,''),
        codigo_barras=NULLIF($2,''),
        nombre=NULLIF($3,''),
        descripcion=NULLIF($4,''),
        precio=$5,
        costo=$6,
        stock_minimo=$7,
        categoria=NULLIF($8,''),
        imagen=NULLIF($9,''),
        estado=COALESCE(NULLIF($10,''),estado),
        moneda_precio=COALESCE(NULLIF($11,''),'MXN'),
        precio_origen=$12,
        tcg_game_code=NULLIF($13,''),
        fecha_actualizacion=NOW()
      WHERE row_id=$14
      RETURNING row_id,id,sku,nombre
    `, [
    input.sku, input.codigo_barras, input.nombre, input.descripcion,
    input.precio, input.costo, input.stock_minimo, canonicalCategory,
    input.imagen ?? '', input.estado, input.moneda_precio ?? 'MXN',
    input.precio_origen ?? input.precio, input.tcg_game_code ?? '', rowId]
    );

    if (r.rowCount) {
      const updated = r.rows[0];

      /*
       * inventario_sucursales conserva SKU y nombre como datos
       * denormalizados para consultas operativas. Mantenerlos sincronizados
       * dentro de la MISMA transaccion evita snapshots obsoletos cuando se
       * edita el maestro de productos.
       *
       * stock_minimo NO se sincroniza aqui: puede ser especifico por sucursal
       * y sera auditado por separado.
       */
      await client.query(`
        UPDATE gmx.inventario_sucursales
        SET sku=$1,
            producto=$2,
            fecha_actualizacion=NOW()
        WHERE id_producto=$3
      `, [updated.sku, updated.nombre, updated.id]);
    }

    await client.query('COMMIT');
    return r.rowCount ? getProduct(rowId) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function productHistoryReferences(client, idProducto) {
  /*
   * Se detectan referencias históricas de forma conservadora.
   * Cualquier tabla de shiny con columna id_producto cuenta como historia,
   * excepto el maestro y el snapshot actual de inventario.
   */
  const catalog = await client.query(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema='gmx'
      AND column_name='id_producto'
      AND table_name NOT IN ('productos','inventario_sucursales')
    ORDER BY table_name
  `);

  const references = [];
  let total = 0;

  for (const row of catalog.rows) {
    const table = String(row.table_name || '');
    if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;

    const count = await client.query(
      `SELECT COUNT(*)::bigint total FROM gmx."${table}" WHERE id_producto=$1`,
      [idProducto]
    );
    const n = Number(count.rows[0]?.total || 0);

    if (n > 0) {
      references.push({ table, total: n });
      total += n;
    }
  }

  return { total, references };
}

export async function deleteProduct(identifier, context = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const key = String(identifier ?? '').trim();
    if (!key) {
      await client.query('ROLLBACK');
      return null;
    }

    const productResult = await client.query(`
      SELECT row_id,id,sku,nombre,estado
      FROM gmx.productos
      WHERE row_id = CASE
        WHEN $1 ~ '^[0-9]+$' THEN $1::bigint
        ELSE NULL
      END
      OR id = $1
      LIMIT 1
      FOR UPDATE
    `, [key]);

    if (!productResult.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }

    const product = productResult.rows[0];

    const inventory = await client.query(`
      SELECT row_id,id_sucursal,sucursal,COALESCE(stock,0)::bigint stock
      FROM gmx.inventario_sucursales
      WHERE id_producto=$1
      FOR UPDATE
    `, [product.id]);

    const stock = inventory.rows.reduce(
      (total, row) => total + Number(row.stock || 0),
      0
    );

    const history = await productHistoryReferences(client, product.id);

    /*
     * Con cualquier existencia distinta de cero no se permite ni borrar
     * ni desactivar implícitamente mediante la acción de baja.
     * El stock debe resolverse primero desde Inventario.
     */
    if (stock !== 0) {
      await client.query('ROLLBACK');
      return {
        action: 'blocked',
        reason: 'PRODUCT_HAS_STOCK',
        product,
        stock,
        history
      };
    }

    /*
     * Si existe historia, jamás DELETE físico: conservar identidad y
     * relaciones y marcar el catálogo como Inactivo.
     */
    if (history.total > 0) {
      const deactivated = await client.query(`
        UPDATE gmx.productos
        SET estado='Inactivo',
            fecha_actualizacion=NOW()
        WHERE row_id=$1
        RETURNING row_id,id,sku,nombre,estado
      `, [product.row_id]);

      await client.query('COMMIT');

      return {
        action: 'deactivated',
        product: deactivated.rows[0],
        stock,
        history,
        usuario: String(context.usuario || '').trim()
      };
    }

    /*
     * Sin stock y sin historia es seguro eliminar. Se limpian solamente
     * snapshots de inventario en cero antes del maestro.
     */
    await client.query(`
      DELETE FROM gmx.inventario_sucursales
      WHERE id_producto=$1
        AND COALESCE(stock,0)=0
    `, [product.id]);

    const deleted = await client.query(`
      DELETE FROM gmx.productos
      WHERE row_id=$1
      RETURNING row_id,id,sku,nombre,estado
    `, [product.row_id]);

    await client.query('COMMIT');

    return {
      action: 'deleted',
      product: deleted.rows[0],
      stock,
      history,
      usuario: String(context.usuario || '').trim()
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
