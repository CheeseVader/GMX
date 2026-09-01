import { brandText } from "../config/brand.js";import 'dotenv/config';
import { pool, query } from '../db.js';

const IDS = [
'PROD-000014',
'PROD-000015',
'PROD-000016'];


function section(title) {
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

async function columnExists(client, table, column) {
  const r = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema='gmx'
       AND table_name=$1
       AND column_name=$2
     LIMIT 1`,
    [table, column]
  );
  return r.rowCount === 1;
}

try {

  section(brandText("GMX PRODUCT TEST RESIDUE CLEANUP"));

  console.log('TARGETS=' + IDS.join(','));
  console.log('NO INVENTORY ADJUSTMENT');
  console.log('NO PURCHASE CREATED');
  console.log('NO ORDER CREATED');

  /* ========================================================
     1. PRECHECK
     ======================================================== */

  section('1. PRECHECK');

  const targets = await query(
    `SELECT
       row_id,
       id,
       sku,
       nombre,
       descripcion,
       precio,
       costo,
       stock,
       categoria,
       estado
     FROM gmx.productos
     WHERE id = ANY($1::text[])
     ORDER BY row_id`,
    [IDS]
  );

  console.table(targets.rows);

  if (targets.rowCount !== IDS.length) {
    throw new Error(
      `TARGET_COUNT_EXPECTED_${IDS.length}_FOUND_${targets.rowCount}`
    );
  }

  for (const row of targets.rows) {

    const testMarker =
    String(row.sku || '').toUpperCase().startsWith('TEST-') ||

    String(row.nombre || '').toUpperCase().includes('TEST PRODUCTOS') ||

    String(row.descripcion || '').toUpperCase().includes('PRODUCTO DE PRUEBA');

    if (!testMarker) {
      throw new Error(
        `NON_TEST_PRODUCT_${row.id}`
      );
    }
  }

  console.log('TARGETS_VERIFIED_AS_TEST=PASS');

  /* ========================================================
     2. RELATED DATA DISCOVERY
     ======================================================== */

  section('2. RELATED DATA DISCOVERY');

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    const relations = [
    ['inventario_sucursales', 'id_producto'],
    ['movimientos_inventario_sucursales', 'id_producto'],
    ['movimientos_inventario', 'id_producto'],
    ['compras_detalle', 'id_producto'],
    ['detalle_pedidos', 'id_producto']];


    const found = {};

    for (const [table, column] of relations) {

      if (
      await columnExists(
        client,
        table,
        column
      ))
      {

        const r = await client.query(
          `SELECT COUNT(*)::int AS total
           FROM gmx.${table}
           WHERE ${column} = ANY($1::text[])`,
          [IDS]
        );

        found[table] = r.rows[0].total;

        console.log(
          `${table.toUpperCase()}=${r.rows[0].total}`
        );

      } else {

        found[table] = 0;

        console.log(
          `${table.toUpperCase()}=NO_${column.toUpperCase()}`
        );
      }
    }

    /* ======================================================
       3. DELETE SAFE CHILD ROWS
       ====================================================== */

    section('3. DELETE TEST CHILD ROWS');

    /*
     * We remove only rows directly tied to these test products.
     * No stock compensation is performed because these are
     * historical test records being purged, not business events.
     */

    for (const [table, column] of [
    ['movimientos_inventario_sucursales', 'id_producto'],
    ['movimientos_inventario', 'id_producto'],
    ['inventario_sucursales', 'id_producto']])
    {

      if (
      await columnExists(
        client,
        table,
        column
      ))
      {

        const d = await client.query(
          `DELETE
           FROM gmx.${table}
           WHERE ${column} = ANY($1::text[])
           RETURNING *`,
          [IDS]
        );

        console.log(
          `CLEANUP_${table.toUpperCase()}=${d.rowCount}`
        );
      }
    }

    /*
     * Do NOT silently delete business history.
     * If these products are referenced by purchases or orders,
     * fail closed so we can inspect those rows first.
     */

    for (const [table, column] of [
    ['compras_detalle', 'id_producto'],
    ['detalle_pedidos', 'id_producto']])
    {

      if (
      await columnExists(
        client,
        table,
        column
      ))
      {

        const r = await client.query(
          `SELECT COUNT(*)::int AS total
           FROM gmx.${table}
           WHERE ${column} = ANY($1::text[])`,
          [IDS]
        );

        if (r.rows[0].total > 0) {
          throw new Error(
            `BUSINESS_HISTORY_REFERENCE_${table}_${r.rows[0].total}`
          );
        }
      }
    }

    /* ======================================================
       4. DELETE PRODUCTS
       ====================================================== */

    section('4. DELETE TEST PRODUCTS');

    const deleted = await client.query(
      `DELETE
       FROM gmx.productos
       WHERE id = ANY($1::text[])
       RETURNING id,sku,nombre`,
      [IDS]
    );

    console.table(deleted.rows);

    if (deleted.rowCount !== IDS.length) {
      throw new Error(
        `DELETE_TARGET_COUNT_${deleted.rowCount}`
      );
    }

    await client.query('COMMIT');

    console.log('TRANSACTION_COMMIT=PASS');

  } catch (e) {

    try {
      await client.query('ROLLBACK');
    } catch {}

    console.log('TRANSACTION_ROLLBACK=PASS');

    throw e;

  } finally {

    client.release();
  }

  /* ========================================================
     5. VERIFY
     ======================================================== */

  section('5. CLEANUP VERIFY');

  const remaining = await query(
    `SELECT COUNT(*)::int AS total
     FROM gmx.productos
     WHERE id = ANY($1::text[])`,
    [IDS]
  );

  if (remaining.rows[0].total !== 0) {
    throw new Error(
      'TEST_PRODUCTS_STILL_EXIST'
    );
  }

  const residue = await query(`
    SELECT COUNT(*)::int AS total
    FROM gmx.productos
    WHERE
         UPPER(COALESCE(nombre,'')) LIKE '%POS-003 TEST%'
      OR UPPER(COALESCE(nombre,'')) LIKE '%PRODUCT TEST%'
      OR UPPER(COALESCE(sku,'')) LIKE 'TEST-%'
  `);

  console.log(
    `PRODUCT_TEST_ROWS_AFTER=${residue.rows[0].total}`
  );

  if (residue.rows[0].total !== 0) {
    throw new Error(
      'OTHER_PRODUCT_TEST_RESIDUE_REMAINS'
    );
  }

  console.log('TARGET_PRODUCTS_REMOVED=PASS');
  console.log('PRODUCT_TEST_RESIDUE=0 PASS');

  /* ========================================================
     RESULT
     ======================================================== */

  section('PRODUCT TEST RESIDUE CLEANUP RESULTADO');

  console.log('TEST_PRODUCTS_REMOVED=3');
  console.log('RELATED_TEST_ROWS_REMOVED=PASS');
  console.log('BUSINESS_HISTORY_PRESERVED=PASS');
  console.log('NO_STOCK_COMPENSATION=TRUE');
  console.log('NO_PURCHASE_CREATED=TRUE');
  console.log('NO_ORDER_CREATED=TRUE');
  console.log('PRODUCT_TEST_RESIDUE=0');
  console.log('');
  console.log('PRODUCT-RESIDUE-CLEANUP=PASS');

} catch (e) {

  section('PRODUCT TEST RESIDUE CLEANUP FAIL');

  console.error(e.message);

  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}
}
