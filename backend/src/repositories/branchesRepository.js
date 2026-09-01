import { query } from '../db.js';

const COLUMNS = `
  row_id, id_sucursal, nombre_sucursal, codigo, direccion,
  ciudad, municipio, estado, cp, colonia, pais, telefono, email, activa,
  fecha_registro, fecha_actualizacion
`;

export async function listBranches({ includeInactive = true } = {}) {
  return query(`
    SELECT ${COLUMNS}
    FROM gmx.sucursales
    ${includeInactive ? '' : 'WHERE COALESCE(activa, true) = true'}
    ORDER BY COALESCE(activa, true) DESC, COALESCE(nombre_sucursal,''), row_id
  `);
}

export async function getBranch(rowId) {
  const result = await query(`
    SELECT ${COLUMNS}
    FROM gmx.sucursales
    WHERE row_id = $1
  `, [rowId]);
  return result.rows[0] || null;
}

export async function createBranch(input) {
  const result = await query(`
    INSERT INTO gmx.sucursales (
      nombre_sucursal, codigo, direccion,
      ciudad, municipio, estado, cp, colonia, pais, telefono, email, activa,
      fecha_registro, fecha_actualizacion
    )
    VALUES (
      NULLIF($1,''), NULLIF($2,''), NULLIF($3,''),
      NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
      NULLIF($8,''), COALESCE(NULLIF($9,''),'México'),
      NULLIF($10,''), NULLIF($11,''), $12, NOW(), NOW()
    )
    RETURNING row_id
  `, [
    input.nombre_sucursal, input.codigo, input.direccion,
    input.ciudad, input.municipio, input.estado, input.cp, input.colonia, input.pais,
    input.telefono, input.email, input.activa
  ]);
  return getBranch(result.rows[0].row_id);
}

export async function updateBranch(rowId, input) {
  const result = await query(`
    UPDATE gmx.sucursales
    SET
      nombre_sucursal = NULLIF($1,''),
      codigo = NULLIF($2,''),
      direccion = NULLIF($3,''),
      ciudad = NULLIF($4,''),
      municipio = NULLIF($5,''),
      estado = NULLIF($6,''),
      cp = NULLIF($7,''),
      colonia = NULLIF($8,''),
      pais = COALESCE(NULLIF($9,''),pais,'México'),
      telefono = NULLIF($10,''),
      email = NULLIF($11,''),
      activa = $12,
      fecha_actualizacion = NOW()
    WHERE row_id = $13
    RETURNING row_id
  `, [
    input.nombre_sucursal, input.codigo, input.direccion,
    input.ciudad, input.municipio, input.estado, input.cp, input.colonia, input.pais,
    input.telefono, input.email, input.activa, rowId
  ]);
  if (!result.rowCount) return null;
  return getBranch(rowId);
}


export async function deleteBranch(rowId) {
  const result = await query(`
    UPDATE gmx.sucursales
    SET activa = false,
        fecha_actualizacion = NOW()
    WHERE row_id = $1
    RETURNING row_id
  `, [rowId]);
  if (!result.rowCount) return null;
  return getBranch(rowId);
}

export async function reactivateBranch(rowId) {
  const result = await query(`
    UPDATE gmx.sucursales
    SET activa = true,
        fecha_actualizacion = NOW()
    WHERE row_id = $1
    RETURNING row_id
  `, [rowId]);

  if (!result.rowCount) return null;
  return getBranch(rowId);
}
