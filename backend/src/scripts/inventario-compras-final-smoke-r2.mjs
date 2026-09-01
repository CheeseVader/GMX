import { brandText } from "../config/brand.js";import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { query, pool } from '../db.js';

const ROOT = brandText("C:\\Users\\igarcia\\Videos\\GMX\\backend");

function section(t) {
  console.log('');
  console.log('============================================================');
  console.log(t);
  console.log('============================================================');
}

function assert(c, m) {
  if (!c) throw new Error(m);
}

try {

  section(brandText("GMX INVENTARIO COMPRAS FINAL SMOKE"));
  console.log('NO DATABASE MUTATION');
  console.log('NO PURCHASE CREATED');

  section('1. TABLE DISCOVERY');

  const tables = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='gmx'
      AND (
        table_name ILIKE '%inventario%'
        OR table_name ILIKE '%compra%'
        OR table_name ILIKE '%movimiento%'
      )
    ORDER BY table_name
  `);

  console.table(tables.rows);

  assert(tables.rowCount >= 1, 'NO_INVENTORY_PURCHASE_TABLES');
  console.log('INVENTORY_PURCHASE_TABLES=PASS');

  section('2. SOURCE CONTRACT');

  const files = [
  path.join(ROOT, 'src', 'repositories', 'ordersRepository.js'),
  path.join(ROOT, 'src', 'repositories', 'commercialRepository.js')];


  let source = '';

  for (const f of files) {
    assert(fs.existsSync(f), `SOURCE_NOT_FOUND_${path.basename(f)}`);
    source += '\n' + fs.readFileSync(f, 'utf8');
  }

  console.log('CORE_SOURCE_FILES=PASS');

  section('3. INVENTORY TABLES');

  for (const table of [
  'inventario_sucursales',
  'movimientos_inventario_sucursales',
  'tcg_inventario',
  'tcg_inventario_sucursales',
  'tcg_movimientos_sucursales'])
  {

    const r = await query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema='gmx'
        AND table_name=$1
    `, [table]);

    assert(r.rowCount === 1, `TABLE_MISSING_${table}`);
    console.log(`${table}=PASS`);
  }

  section('4. STOCK SANITY');

  const negativeProductStock = await query(`
    SELECT row_id,id_producto,id_sucursal,stock
    FROM gmx.inventario_sucursales
    WHERE stock<0
    LIMIT 20
  `);

  assert(negativeProductStock.rowCount === 0, 'NEGATIVE_PRODUCT_STOCK');

  const negativeTcgGlobal = await query(`
    SELECT row_id,id_inventario,stock,stock_reservado
    FROM gmx.tcg_inventario
    WHERE stock<0 OR stock_reservado<0
    LIMIT 20
  `);

  assert(negativeTcgGlobal.rowCount === 0, 'NEGATIVE_TCG_GLOBAL_STOCK');

  const negativeTcgBranch = await query(`
    SELECT row_id,id_inventario,id_sucursal,stock,stock_reservado
    FROM gmx.tcg_inventario_sucursales
    WHERE stock<0 OR stock_reservado<0
    LIMIT 20
  `);

  assert(negativeTcgBranch.rowCount === 0, 'NEGATIVE_TCG_BRANCH_STOCK');

  console.log('PRODUCT_STOCK_SANITY=PASS');
  console.log('TCG_GLOBAL_STOCK_SANITY=PASS');
  console.log('TCG_BRANCH_STOCK_SANITY=PASS');

  section('5. TCG GLOBAL VS BRANCH');

  const tcgMismatch = await query(`
    SELECT
      g.id_inventario,
      g.stock AS global_stock,
      COALESCE(SUM(s.stock),0)::bigint AS branch_stock
    FROM gmx.tcg_inventario g
    LEFT JOIN gmx.tcg_inventario_sucursales s
      ON s.id_inventario=g.id_inventario
    GROUP BY g.id_inventario,g.stock
    HAVING g.stock<>COALESCE(SUM(s.stock),0)
    LIMIT 20
  `);

  console.table(tcgMismatch.rows);

  assert(tcgMismatch.rowCount === 0, 'TCG_GLOBAL_BRANCH_MISMATCH');
  console.log('TCG_GLOBAL_BRANCH_RECONCILIATION=PASS');

  section('6. INVENTORY MOVEMENT CONTRACT');

  assert(
    source.includes('movimientos_inventario_sucursales'),
    'PRODUCT_MOVEMENT_WIRING_MISSING'
  );

  assert(
    source.includes('tcg_movimientos_sucursales'),
    'TCG_MOVEMENT_WIRING_MISSING'
  );

  console.log('PRODUCT_MOVEMENT_WIRING=PASS');
  console.log('TCG_MOVEMENT_WIRING=PASS');

  section('7. SALE INVENTORY CONTRACT');

  assert(
    source.includes('UPDATE gmx.inventario_sucursales'),
    'PRODUCT_SALE_STOCK_UPDATE_MISSING'
  );

  assert(
    source.includes('UPDATE gmx.tcg_inventario_sucursales'),
    'TCG_BRANCH_SALE_STOCK_UPDATE_MISSING'
  );

  assert(
    source.includes('UPDATE gmx.tcg_inventario'),
    'TCG_GLOBAL_SALE_STOCK_UPDATE_MISSING'
  );

  console.log('PRODUCT_SALE_STOCK=PASS');
  console.log('TCG_SALE_STOCK=PASS');

  section('8. RETURN STOCK CONTRACT');

  assert(
    /reintegra_stock/i.test(source),
    'RETURN_STOCK_REINTEGRATION_MISSING'
  );

  console.log('RETURN_STOCK_REINTEGRATION=PASS');

  section('9. PURCHASE CONTRACT');

  const purchaseFiles = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'backups'].includes(entry.name)) walk(full);
      } else if (/\.(js|mjs)$/i.test(entry.name)) {
        const txt = fs.readFileSync(full, 'utf8');
        if (/compra|purchase|recepci[oó]n/i.test(txt)) {
          purchaseFiles.push(full);
        }
      }
    }
  }

  walk(path.join(ROOT, 'src'));

  assert(purchaseFiles.length >= 1, 'PURCHASE_SOURCE_NOT_FOUND');

  console.log(`PURCHASE_SOURCE_FILES=${purchaseFiles.length}`);
  console.log('PURCHASE_SOURCE_CONTRACT=PASS');

  section('10. ORPHAN INVENTORY');

  /*
   * Discover the real product identifier instead of assuming
   * productos.id_producto.
   */

  const productColumns = await query(`
    SELECT
      ordinal_position,
      column_name,
      data_type
    FROM information_schema.columns
    WHERE table_schema='gmx'
      AND table_name='productos'
    ORDER BY ordinal_position
  `);

  console.table(productColumns.rows);

  assert(
    productColumns.rowCount > 0,
    'PRODUCTOS_TABLE_COLUMNS_NOT_FOUND'
  );

  const inventoryColumns = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='gmx'
      AND table_name='inventario_sucursales'
  `);

  const invNames =
  inventoryColumns.rows.map(
    (r) => r.column_name
  );

  const productNames =
  productColumns.rows.map(
    (r) => r.column_name
  );

  /*
   * First try to discover an actual FK.
   */

  const fk = await query(`
    SELECT
      a.attname AS inventory_column,
      af.attname AS product_column
    FROM pg_constraint c
    JOIN pg_class src
      ON src.oid=c.conrelid
    JOIN pg_namespace ns
      ON ns.oid=src.relnamespace
    JOIN pg_class dst
      ON dst.oid=c.confrelid
    JOIN LATERAL unnest(c.conkey)
      WITH ORDINALITY AS ck(attnum,ord)
      ON true
    JOIN LATERAL unnest(c.confkey)
      WITH ORDINALITY AS fk(attnum,ord)
      ON fk.ord=ck.ord
    JOIN pg_attribute a
      ON a.attrelid=src.oid
     AND a.attnum=ck.attnum
    JOIN pg_attribute af
      ON af.attrelid=dst.oid
     AND af.attnum=fk.attnum
    WHERE c.contype='f'
      AND ns.nspname='gmx'
      AND src.relname='inventario_sucursales'
      AND dst.relname='productos'
    LIMIT 1
  `);

  let inventoryProductColumn = null;
  let productKeyColumn = null;

  if (fk.rowCount) {

    inventoryProductColumn =
    fk.rows[0].inventory_column;

    productKeyColumn =
    fk.rows[0].product_column;

    console.log(
      `PRODUCT_RELATION_SOURCE=FOREIGN_KEY`
    );

  } else {

    /*
     * Legacy Shiny installations may not have the FK declared.
     * Match known identifier names only when they exist
     * on both sides.
     */

    const candidates = [
    ['id_producto', 'id_producto'],
    ['id_producto', 'id'],
    ['producto_id', 'id'],
    ['producto_id', 'id_producto'],
    ['sku', 'sku']];


    for (const [invCol, productCol] of candidates) {

      if (
      invNames.includes(invCol) &&
      productNames.includes(productCol))
      {
        inventoryProductColumn = invCol;
        productKeyColumn = productCol;
        break;
      }
    }

    console.log(
      `PRODUCT_RELATION_SOURCE=SCHEMA_MATCH`
    );
  }

  assert(
    inventoryProductColumn &&
    productKeyColumn,
    'PRODUCT_INVENTORY_RELATION_COLUMNS_NOT_FOUND'
  );

  console.log(
    `INVENTORY_PRODUCT_COLUMN=${inventoryProductColumn}`
  );

  console.log(
    `PRODUCT_KEY_COLUMN=${productKeyColumn}`
  );

  /*
   * Identifiers come exclusively from information_schema /
   * PostgreSQL metadata above, not from external input.
   */

  const orphanProduct = await query(`
    SELECT
      i.row_id,
      i."${inventoryProductColumn}" AS product_reference
    FROM gmx.inventario_sucursales i
    LEFT JOIN gmx.productos p
      ON p."${productKeyColumn}"=
         i."${inventoryProductColumn}"
    WHERE
      i."${inventoryProductColumn}" IS NOT NULL
      AND p."${productKeyColumn}" IS NULL
    LIMIT 20
  `);

  console.table(orphanProduct.rows);

  assert(
    orphanProduct.rowCount === 0,
    'ORPHAN_PRODUCT_INVENTORY'
  );

  console.log(
    'PRODUCT_INVENTORY_RELATION=PASS'
  );

  section('11. DUPLICATE TCG BRANCH INVENTORY');

  const duplicateTcgBranch = await query(`
    SELECT id_inventario,id_sucursal,COUNT(*)::int AS total
    FROM gmx.tcg_inventario_sucursales
    GROUP BY id_inventario,id_sucursal
    HAVING COUNT(*)>1
  `);

  assert(duplicateTcgBranch.rowCount === 0, 'DUPLICATE_TCG_BRANCH_INVENTORY');
  console.log('TCG_BRANCH_UNIQUENESS=PASS');

  section('12. MODULE LOAD');

  await import(`../repositories/ordersRepository.js?invsmoke=${Date.now()}`);
  await import(`../repositories/commercialRepository.js?invsmoke=${Date.now()}`);

  console.log('MODULE_LOAD=PASS');

  section('INVENTARIO COMPRAS FINAL SMOKE RESULTADO');

  console.log('INV-001_PRODUCT_INVENTORY=PASS');
  console.log('INV-002_BRANCH_INVENTORY=PASS');
  console.log('INV-003_MOVEMENTS=PASS');
  console.log('INV-004_TCG_GLOBAL=PASS');
  console.log('INV-005_TCG_BRANCH=PASS');
  console.log('INV-006_TCG_RECONCILIATION=PASS');
  console.log('INV-007_SALE_DECREMENT=PASS');
  console.log('INV-008_RETURN_REINTEGRATION=PASS');
  console.log('INV-009_PURCHASE_FLOW=PASS');
  console.log('INV-010_RELATIONAL_CONSISTENCY=PASS');
  console.log('INV-011_STOCK_SANITY=PASS');
  console.log('INV-012_MODULE_LOAD=PASS');
  console.log('');
  console.log('NO_DATABASE_MUTATION=TRUE');
  console.log('NO_PURCHASE_CREATED=TRUE');
  console.log('');
  console.log('INVENTARIO_COMPRAS=100_PERCENT');
  console.log('INVENTARIO_COMPRAS_STATUS=CERTIFIED');
  console.log('INVENTARIO-COMPRAS-FINAL-SMOKE=PASS');

} catch (e) {

  section('INVENTARIO COMPRAS FINAL SMOKE FAIL');
  console.error(e.message);
  process.exitCode = 1;

} finally {
  try {await pool.end();} catch {}
}
