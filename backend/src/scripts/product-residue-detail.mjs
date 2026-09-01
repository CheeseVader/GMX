import { brandText } from "../config/brand.js";import 'dotenv/config';
import { query, pool } from '../db.js';

try {

  console.log('============================================================');
  console.log(brandText("GMX PRODUCT TEST RESIDUE DETAIL"));
  console.log('NO MUTATION');
  console.log('============================================================');

  const r = await query(`
    SELECT
      row_id,
      id,
      sku,
      nombre,
      descripcion,
      precio,
      costo,
      stock,
      stock_minimo,
      categoria,
      estado,
      codigo_barras,
      fecha_creacion,
      fecha_actualizacion
    FROM gmx.productos
    WHERE
         UPPER(COALESCE(nombre,'')) LIKE '%POS-003 TEST%'
      OR UPPER(COALESCE(nombre,'')) LIKE '%PRODUCT TEST%'
      OR UPPER(COALESCE(sku,'')) LIKE 'TEST-%'
    ORDER BY row_id
  `);

  console.table(r.rows);

  console.log('');
  console.log(`PRODUCT_TEST_ROWS=${r.rowCount}`);
  console.log('NO_MUTATION=TRUE');
  console.log('PRODUCT-RESIDUE-DETAIL=PASS');

} catch (e) {

  console.error(e.message);
  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}
}
