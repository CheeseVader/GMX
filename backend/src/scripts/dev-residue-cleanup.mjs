import { brandText } from "../config/brand.js";import 'dotenv/config';
import { pool, query } from '../db.js';

const IDS = [
'DEV-1786984185387-GRBWY',
'DEV-1786985585910-2SJU1',
'DEV-1787167175343-H3LZF'];


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

  section(brandText("GMX DEV TEST RESIDUE CLEANUP"));

  console.log('TARGETS=' + IDS.join(','));
  console.log('NO INVENTORY MUTATION');
  console.log('NO PROVIDER CALL');

  /* ========================================================
     1. PRECHECK
     ======================================================== */

  section('1. PRECHECK');

  const targets = await query(
    `SELECT
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
    String(row.motivo || '').toUpperCase() === 'TEST' ||

    String(row.notas || '').toUpperCase().includes('TEST');

    if (!testMarker) {
      throw new Error(
        `NON_TEST_TARGET_${row.id}`
      );
    }
  }

  console.log('TARGETS_VERIFIED_AS_TEST=PASS');

  /* ========================================================
     2. RELATIONAL BASELINE
     ======================================================== */

  section('2. RELATED ROWS BASELINE');

  const client = await pool.connect();

  let committed = false;

  try {

    await client.query('BEGIN');

    const tables = [
    'devoluciones_detalle',
    'devoluciones_eventos',
    'devoluciones_reembolsos'];


    const baseline = {};

    for (const table of tables) {

      if (
      await columnExists(
        client,
        table,
        'id_devolucion'
      ))
      {

        const r = await client.query(
          `SELECT COUNT(*)::int AS total
           FROM gmx.${table}
           WHERE id_devolucion = ANY($1::text[])`,
          [IDS]
        );

        baseline[table] =
        r.rows[0].total;

        console.log(
          `${table.toUpperCase()}=${r.rows[0].total}`
        );

      } else {

        baseline[table] = 0;

        console.log(
          `${table.toUpperCase()}=NO_ID_DEVOLUCION_COLUMN`
        );
      }
    }

    /* ======================================================
       3. DELETE CHILDREN
       ====================================================== */

    section('3. DELETE CHILD TEST ROWS');

    for (const table of [
    'devoluciones_eventos',
    'devoluciones_reembolsos',
    'devoluciones_detalle'])
    {

      if (
      await columnExists(
        client,
        table,
        'id_devolucion'
      ))
      {

        const deleted =
        await client.query(
          `DELETE
             FROM gmx.${table}
             WHERE id_devolucion = ANY($1::text[])
             RETURNING *`,
          [IDS]
        );

        console.log(
          `CLEANUP_${table.toUpperCase()}=${deleted.rowCount}`
        );
      }
    }

    /* ======================================================
       4. DELETE DEVOLUCIONES
       ====================================================== */

    section('4. DELETE TEST DEVOLUCIONES');

    const deletedDev =
    await client.query(
      `DELETE
         FROM gmx.devoluciones
         WHERE id = ANY($1::text[])
         RETURNING id`,
      [IDS]
    );

    console.table(
      deletedDev.rows
    );

    if (deletedDev.rowCount !== IDS.length) {
      throw new Error(
        `DELETE_TARGET_COUNT_${deletedDev.rowCount}`
      );
    }

    /*
     * IMPORTANT:
     * No pedidos update.
     * No stock update.
     * No provider call.
     */

    await client.query('COMMIT');

    committed = true;

    console.log(
      'TRANSACTION_COMMIT=PASS'
    );

  } catch (e) {

    try {
      await client.query('ROLLBACK');
    } catch {}

    console.log(
      'TRANSACTION_ROLLBACK=PASS'
    );

    throw e;

  } finally {

    client.release();
  }

  /* ========================================================
     5. VERIFY
     ======================================================== */

  section('5. CLEANUP VERIFY');

  const remaining =
  await query(
    `SELECT COUNT(*)::int AS total
       FROM gmx.devoluciones
       WHERE id = ANY($1::text[])`,
    [IDS]
  );

  if (remaining.rows[0].total !== 0) {
    throw new Error(
      'TARGET_DEVOLUCIONES_STILL_EXIST'
    );
  }

  const smokeResidue =
  await query(`
      SELECT COUNT(*)::int AS total
      FROM gmx.devoluciones
      WHERE id LIKE 'DEV-%'
        AND (
          notas ILIKE '%TEST%'
          OR motivo ILIKE '%TEST%'
        )
    `);

  console.log(
    `DEV_TEST_ROWS_AFTER=${smokeResidue.rows[0].total}`
  );

  if (smokeResidue.rows[0].total !== 0) {
    throw new Error(
      'OTHER_DEV_TEST_RESIDUE_REMAINS'
    );
  }

  console.log('TARGET_ROWS_REMOVED=PASS');
  console.log('DEV_TEST_RESIDUE=0 PASS');

  /* ========================================================
     RESULT
     ======================================================== */

  section('DEV TEST RESIDUE CLEANUP RESULTADO');

  console.log('TEST_DEVOLUCIONES_REMOVED=3');
  console.log('RELATED_TEST_ROWS_REMOVED=PASS');
  console.log('INVENTORY_CHANGED=FALSE');
  console.log('ORDERS_CHANGED=FALSE');
  console.log('PROVIDER_CALL=FALSE');
  console.log('DEV_TEST_RESIDUE=0');
  console.log('');
  console.log('DEV-RESIDUE-CLEANUP=PASS');

} catch (e) {

  section('DEV TEST RESIDUE CLEANUP FAIL');

  console.error(e.message);

  process.exitCode = 1;

} finally {

  try {
    await pool.end();
  } catch {}
}
