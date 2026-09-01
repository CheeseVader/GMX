import { brandText } from "../config/brand.js";import { Router } from 'express';
import { pool, query } from '../db.js';

const router = Router();

const clean = (v) => String(v ?? '').trim();

async function listCategories() {
  const result = await query(`
    SELECT
      c.id,
      TRIM(c.nombre) AS nombre,
      COALESCE(NULLIF(TRIM(c.estado),''),'Activo') AS estado,
      COUNT(p.row_id)::bigint AS total_productos
    FROM gmx.categorias c
    LEFT JOIN gmx.productos p
      ON LOWER(TRIM(COALESCE(p.categoria,'')))=LOWER(TRIM(COALESCE(c.nombre,'')))
    WHERE NULLIF(TRIM(COALESCE(c.nombre,'')),'') IS NOT NULL
    GROUP BY c.id,c.nombre,c.estado
    ORDER BY LOWER(TRIM(c.nombre)),c.id
  `);
  return result.rows;
}

router.get('/', async (_req, res) => {
  try {
    res.json({ success: true, data: await listCategories() });
  } catch (error) {
    console.error(brandText("[GMX][CATEGORIES][LIST]"), error);
    res.status(500).json({ success: false, error: 'CATEGORY_LIST_FAILED', message: 'No fue posible cargar las categorías.' });
  }
});

router.post('/', async (req, res) => {
  const nombre = clean(req.body?.nombre);
  const estado = clean(req.body?.estado) || 'Activo';

  if (!nombre) {
    return res.status(400).json({ success: false, error: 'CATEGORY_NAME_REQUIRED', message: 'El nombre es obligatorio.' });
  }
  if (!['Activo', 'Inactivo'].includes(estado)) {
    return res.status(400).json({ success: false, error: 'CATEGORY_STATUS_INVALID', message: 'Estado de categoría inválido.' });
  }

  try {
    const duplicate = await query(`
      SELECT id FROM gmx.categorias
      WHERE LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM($1))
      LIMIT 1
    `, [nombre]);

    if (duplicate.rowCount) {
      return res.status(409).json({ success: false, error: 'CATEGORY_DUPLICATE', message: 'Ya existe una categoría con ese nombre.' });
    }

    const id = `CAT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const created = await query(`
      INSERT INTO gmx.categorias(id,nombre,estado)
      VALUES($1,$2,$3)
      RETURNING id,TRIM(nombre) nombre,estado
    `, [id, nombre, estado]);

    res.status(201).json({ success: true, data: created.rows[0] });
  } catch (error) {
    console.error(brandText("[GMX][CATEGORIES][CREATE]"), error);
    res.status(500).json({ success: false, error: 'CATEGORY_CREATE_FAILED', message: 'No fue posible crear la categoría.' });
  }
});

router.put('/:id', async (req, res) => {
  const id = clean(req.params.id);
  const nombre = clean(req.body?.nombre);
  const estado = clean(req.body?.estado) || 'Activo';

  if (!id || !nombre) {
    return res.status(400).json({ success: false, error: 'CATEGORY_DATA_REQUIRED', message: 'Nombre e identificador son obligatorios.' });
  }
  if (!['Activo', 'Inactivo'].includes(estado)) {
    return res.status(400).json({ success: false, error: 'CATEGORY_STATUS_INVALID', message: 'Estado de categoría inválido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(`
      SELECT id,TRIM(nombre) nombre,COALESCE(NULLIF(TRIM(estado),''),'Activo') estado
      FROM gmx.categorias
      WHERE id=$1
      FOR UPDATE
    `, [id]);

    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'CATEGORY_NOT_FOUND', message: 'La categoría no existe.' });
    }

    const duplicate = await client.query(`
      SELECT id FROM gmx.categorias
      WHERE id<>$1
        AND LOWER(TRIM(COALESCE(nombre,'')))=LOWER(TRIM($2))
      LIMIT 1
    `, [id, nombre]);

    if (duplicate.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'CATEGORY_DUPLICATE', message: 'Ya existe otra categoría con ese nombre.' });
    }

    const oldName = current.rows[0].nombre;

    if (oldName !== nombre) {
      await client.query(`
        UPDATE gmx.productos
        SET categoria=$1,fecha_actualizacion=NOW()
        WHERE LOWER(TRIM(COALESCE(categoria,'')))=LOWER(TRIM($2))
      `, [nombre, oldName]);
    }

    const updated = await client.query(`
      UPDATE gmx.categorias
      SET nombre=$2,estado=$3
      WHERE id=$1
      RETURNING id,TRIM(nombre) nombre,estado
    `, [id, nombre, estado]);

    await client.query('COMMIT');
    res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(brandText("[GMX][CATEGORIES][UPDATE]"), error);
    res.status(500).json({ success: false, error: 'CATEGORY_UPDATE_FAILED', message: 'No fue posible actualizar la categoría.' });
  } finally {
    client.release();
  }
});

export default router;
