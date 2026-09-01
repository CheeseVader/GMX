import { brandText } from "../config/brand.js";import 'dotenv/config';
import { query, pool } from '../db.js';

try {

  console.log('============================================================');
  console.log(brandText("GMX DEV TEST RESIDUE DETAIL"));
  console.log('NO MUTATION');
  console.log('============================================================');

  const r = await query(`
    SELECT
      row_id,
      id,
      fecha,
      tipo,
      referencia,
      motivo,
      importe,
      resolucion,
      estado,
      reintegra_stock,
      notas
    FROM gmx.devoluciones
    WHERE id LIKE 'DEV-%'
      AND (
        notas ILIKE '%TEST%'
        OR motivo ILIKE '%TEST%'
      )
    ORDER BY row_id
  `);

  console.table(r.rows);

  console.log('');
  console.log(`DEV_TEST_ROWS=${r.rowCount}`);
  console.log('NO_MUTATION=TRUE');
  console.log('DEV-RESIDUE-DETAIL=PASS');

} catch (e) {

  console.error(e.message);
  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}
}
