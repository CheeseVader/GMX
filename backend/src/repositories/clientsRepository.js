import { query } from '../db.js';

const CLIENT_COLUMNS = `
  row_id, id_cliente, nombre, telefono, email, direccion,
  ciudad, estado, municipio, colonia, cp, pais,
  rfc, razon_social, regimen_fiscal, cp_fiscal, uso_cfdi,
  email_normalizado, telefono_normalizado, email_verificado, telefono_verificado,
  fecha_registro, fecha_actualizacion
`;

export async function listClients({ search = '', limit = 50, offset = 0 }) {
  const term = String(search || '').trim();
  const values = [];
  let where = '';
  let order = `COALESCE(c.nombre,''),c.row_id`;

  if (term) {
    values.push(`%${term}%`);
    const like = '$1';
    const digits = term.replace(/\D/g, '');
    values.push(digits ? `%${digits}%` : '__NO_PHONE_MATCH__');
    const phoneLike = '$2';

    where = `
      WHERE COALESCE(c.id_cliente,'') ILIKE ${like}
         OR COALESCE(c.nombre,'') ILIKE ${like}
         OR COALESCE(c.email,'') ILIKE ${like}
         OR COALESCE(c.cp,'') ILIKE ${like}
         OR COALESCE(c.ciudad,'') ILIKE ${like}
         OR COALESCE(c.estado,'') ILIKE ${like}
         OR COALESCE(c.telefono_normalizado,'') LIKE ${phoneLike}
    `;

    order = `
      CASE
        WHEN LOWER(COALESCE(c.id_cliente,''))=LOWER($3) THEN 0
        WHEN LOWER(COALESCE(c.email,''))=LOWER($3) THEN 1
        WHEN LOWER(COALESCE(c.nombre,''))=LOWER($3) THEN 2
        WHEN LOWER(COALESCE(c.nombre,'')) LIKE LOWER($4) THEN 3
        ELSE 4
      END,
      COALESCE(c.nombre,''),c.row_id
    `;
    values.push(term, `${term}%`);
  }

  values.push(limit, offset);
  const li = values.length - 1;
  const oi = values.length;

  return query(`
    SELECT
      c.row_id, c.id_cliente, c.nombre, c.telefono, c.email, c.direccion,
      c.ciudad, c.estado, c.municipio, c.colonia, c.cp, c.pais,
      c.rfc, c.razon_social, c.regimen_fiscal, c.cp_fiscal, c.uso_cfdi,
      c.email_normalizado, c.telefono_normalizado, c.email_verificado, c.telefono_verificado,
      c.fecha_registro, c.fecha_actualizacion,
      COALESCE(v.pedidos,0)::bigint AS pedidos,
      COALESCE(v.total_comprado,0)::numeric AS total_comprado,
      v.ultima_compra
    FROM gmx.clientes c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(p.venta_confirmada,false)=true
             OR UPPER(COALESCE(p.estado_pedido,''))='PAGADO'
        )::bigint AS pedidos,
        COALESCE(SUM(COALESCE(p.total,0)) FILTER (
          WHERE COALESCE(p.venta_confirmada,false)=true
             OR UPPER(COALESCE(p.estado_pedido,''))='PAGADO'
        ),0)::numeric AS total_comprado,
        MAX(p.fecha) FILTER (
          WHERE COALESCE(p.venta_confirmada,false)=true
             OR UPPER(COALESCE(p.estado_pedido,''))='PAGADO'
        ) AS ultima_compra
      FROM gmx.pedidos p
      WHERE p.id_cliente = c.id_cliente
        AND UPPER(COALESCE(p.estado_pedido,'')) <> 'CANCELADO'
    ) v ON true
    ${where}
    ORDER BY ${order}
    LIMIT $${li}
    OFFSET $${oi}
  `, values);
}
export async function getClient(rowId) {
  const result = await query(`
    SELECT ${CLIENT_COLUMNS}
    FROM gmx.clientes
    WHERE row_id = $1
  `, [rowId]);

  return result.rows[0] || null;
}

export async function createClient(input) {
  const result = await query(`
    INSERT INTO gmx.clientes (
      nombre, telefono, email, direccion,
      ciudad, estado, municipio, colonia, cp, pais,
      rfc, razon_social, regimen_fiscal, cp_fiscal, uso_cfdi,
      fecha_registro, fecha_actualizacion
    )
    VALUES (
      NULLIF($1,''), NULLIF($2,''), NULLIF($3,''), NULLIF($4,''),
      NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''),
      NULLIF($9,''), COALESCE(NULLIF($10,''), 'México'),
      gmx.normalize_rfc($11), NULLIF($12,''), NULLIF($13,''), NULLIF($14,''), NULLIF($15,''),
      NOW(), NOW()
    )
    RETURNING row_id
  `, [
    input.nombre, input.telefono, input.email, input.direccion,
    input.ciudad, input.estado, input.municipio, input.colonia, input.cp, input.pais,
    input.rfc, input.razon_social, input.regimen_fiscal, input.cp_fiscal, input.uso_cfdi
  ]);

  return getClient(result.rows[0].row_id);
}

export async function updateClient(rowId, input) {
  const result = await query(`
    UPDATE gmx.clientes
    SET
      nombre = NULLIF($1,''),
      telefono = gmx.normalize_phone_digits($2),
      email = NULLIF($3,''),
      direccion = NULLIF($4,''),
      ciudad = NULLIF($5,''),
      estado = NULLIF($6,''),
      municipio = NULLIF($7,''),
      colonia = NULLIF($8,''),
      cp = NULLIF($9,''),
      pais = COALESCE(NULLIF($10,''), pais),
      rfc = gmx.normalize_rfc($11),
      razon_social = NULLIF($12,''),
      regimen_fiscal = NULLIF($13,''),
      cp_fiscal = NULLIF($14,''),
      uso_cfdi = NULLIF($15,''),
      fecha_actualizacion = NOW()
    WHERE row_id = $16
    RETURNING row_id
  `, [
    input.nombre, input.telefono, input.email, input.direccion,
    input.ciudad, input.estado, input.municipio, input.colonia, input.cp, input.pais,
    input.rfc, input.razon_social, input.regimen_fiscal, input.cp_fiscal, input.uso_cfdi,
    rowId
  ]);

  if (!result.rowCount) return null;
  return getClient(rowId);
}

export async function deleteClient(rowId) {
  const result = await query(`
    DELETE FROM gmx.clientes
    WHERE row_id = $1
    RETURNING row_id, id_cliente, nombre, email
  `, [rowId]);

  return result.rows[0] || null;
}
