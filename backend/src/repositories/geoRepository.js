import { query } from '../db.js';

export async function lookupMexicanPostalCode(cp) {
  const result = await query(`
    SELECT DISTINCT
      cp,
      estado,
      municipio,
      ciudad,
      colonia,
      tipo_asentamiento
    FROM gmx.catalogo_cp
    WHERE cp = $1
    ORDER BY colonia NULLS LAST
    LIMIT 500
  `, [cp]);

  return result;
}
