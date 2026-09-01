import { query } from '../db.js';

export async function publicCountries(){
  return [{code:'MX',name:'México'}];
}

export async function publicStates(){
  const r=await query(`
    SELECT estado FROM (
      SELECT DISTINCT TRIM(estado) AS estado FROM gmx.catalogo_cp
      UNION
      SELECT DISTINCT TRIM(estado) AS estado FROM gmx.catalogo_ciudades
      UNION
      SELECT DISTINCT TRIM(estado) AS estado FROM gmx.catalogo_colonias
    ) x
    WHERE NULLIF(estado,'') IS NOT NULL
    ORDER BY estado
  `);
  return r.rows.map(x=>x.estado);
}

export async function publicCities(state){
  const r=await query(`
    SELECT ciudad FROM (
      SELECT DISTINCT COALESCE(NULLIF(TRIM(ciudad),''),NULLIF(TRIM(municipio),'')) AS ciudad
      FROM gmx.catalogo_cp
      WHERE LOWER(TRIM(estado))=LOWER(TRIM($1))
      UNION
      SELECT DISTINCT COALESCE(NULLIF(TRIM(ciudad),''),NULLIF(TRIM(municipio),''),NULLIF(TRIM(valor),'')) AS ciudad
      FROM gmx.catalogo_ciudades
      WHERE LOWER(TRIM(estado))=LOWER(TRIM($1))
      UNION
      SELECT DISTINCT COALESCE(NULLIF(TRIM(ciudad),''),NULLIF(TRIM(municipio),'')) AS ciudad
      FROM gmx.catalogo_colonias
      WHERE LOWER(TRIM(estado))=LOWER(TRIM($1))
    ) x
    WHERE NULLIF(ciudad,'') IS NOT NULL
    ORDER BY ciudad
  `,[state]);
  return r.rows.map(x=>x.ciudad);
}

export async function publicPostalCodes(state,city){
  const r=await query(`
    SELECT cp FROM (
      SELECT DISTINCT TRIM(cp) AS cp
      FROM gmx.catalogo_cp
      WHERE LOWER(TRIM(estado))=LOWER(TRIM($1))
        AND LOWER(TRIM(COALESCE(NULLIF(ciudad,''),municipio,'')))=LOWER(TRIM($2))
      UNION
      SELECT DISTINCT TRIM(cp) AS cp
      FROM gmx.catalogo_cp_index
      WHERE LOWER(TRIM(estado))=LOWER(TRIM($1))
        AND LOWER(TRIM(ciudad))=LOWER(TRIM($2))
      UNION
      SELECT DISTINCT TRIM(cp) AS cp
      FROM gmx.catalogo_colonias
      WHERE LOWER(TRIM(estado))=LOWER(TRIM($1))
        AND LOWER(TRIM(COALESCE(NULLIF(ciudad,''),municipio,'')))=LOWER(TRIM($2))
    ) x
    WHERE cp ~ '^[0-9]{5}$'
    ORDER BY cp
  `,[state,city]);
  return r.rows.map(x=>x.cp);
}

export async function publicSettlements(cp){
  const r=await query(`
    SELECT DISTINCT colonia,tipo_asentamiento,municipio,ciudad,estado
    FROM (
      SELECT colonia,tipo_asentamiento,municipio,ciudad,estado
      FROM gmx.catalogo_cp WHERE TRIM(cp)=$1
      UNION ALL
      SELECT colonia,tipo_asentamiento,municipio,ciudad,estado
      FROM gmx.catalogo_colonias WHERE TRIM(cp)=$1
    ) x
    WHERE NULLIF(TRIM(COALESCE(colonia,'')),'') IS NOT NULL
    ORDER BY colonia
    LIMIT 1000
  `,[cp]);
  return r.rows;
}
