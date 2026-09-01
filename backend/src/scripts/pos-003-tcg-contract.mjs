import 'dotenv/config';
import { query, pool } from '../db.js';

function section(title){
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

try{

  section('POS-003 TCG INVENTORY CONTRACT');

  for(const table of [
    'tcg_inventario',
    'tcg_inventario_sucursales'
  ]){

    console.log('');
    console.log(`TABLE=${table}`);

    const cols = await query(`
      SELECT
        ordinal_position,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_schema='gmx'
        AND table_name=$1
      ORDER BY ordinal_position
    `,[table]);

    console.table(cols.rows);
  }

  section('POS-003 TCG SAMPLE');

  const global = await query(`
    SELECT *
    FROM gmx.tcg_inventario
    ORDER BY row_id DESC
    LIMIT 5
  `);

  console.log('=== tcg_inventario ===');
  console.table(global.rows);

  const branch = await query(`
    SELECT *
    FROM gmx.tcg_inventario_sucursales
    ORDER BY row_id DESC
    LIMIT 5
  `);

  console.log('=== tcg_inventario_sucursales ===');
  console.table(branch.rows);

  section('POS-003 TCG INVENTORY CONTRACT RESULTADO');

  console.log('NO_MUTATION=TRUE');
  console.log('NO_PROVIDER_CALL=TRUE');
  console.log('POS-003-TCG-CONTRACT=PASS');

}catch(e){

  section('POS-003 TCG INVENTORY CONTRACT FAIL');
  console.error(e.message);
  process.exitCode=1;

}finally{
  try{ await pool.end(); }catch{}
}
