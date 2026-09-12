#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/gmx/app"
BACKEND="${APP_ROOT}/backend"
STATE_DIR="/var/lib/gmx-updater"
MARKER="${STATE_DIR}/repair-admin-r2.6.1.done"

mkdir -p "$STATE_DIR"

if [ -f "$MARKER" ]; then
  echo "[GMX] Admin repair R2.6.1 already completed; skipping."
  exit 0
fi

if [ ! -d "$BACKEND" ]; then
  echo "[GMX] Missing backend: $BACKEND" >&2
  exit 20
fi

cd "$BACKEND"

node --input-type=module <<'NODE'
import { pool } from './src/db.js';
import { hashPassword, verifyPassword } from './src/security.js';

const c = await pool.connect();

function qi(v) {
  return '"' + String(v).replaceAll('"','""') + '"';
}

async function schemaExists(name) {
  const r = await c.query(
    'SELECT 1 FROM information_schema.schemata WHERE schema_name=$1',
    [name]
  );
  return r.rowCount === 1;
}

async function tableExists(schema, name) {
  const r = await c.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema=$1
        AND table_name=$2
        AND table_type='BASE TABLE'`,
    [schema, name]
  );
  return r.rowCount === 1;
}

try {
  let schema = null;
  for (const candidate of ['gmx','shiny']) {
    if (await schemaExists(candidate)) {
      schema = candidate;
      break;
    }
  }

  if (!schema) throw new Error('GMX_SCHEMA_NOT_FOUND');
  if (!(await tableExists(schema, 'administradores'))) {
    throw new Error(`${schema}.administradores missing`);
  }

  const cols = await c.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=$1
        AND table_name='administradores'`,
    [schema]
  );
  const names = new Set(cols.rows.map(x => x.column_name));

  const required = ['id_admin','nombre','email','password_hash','rol','activo'];
  const missing = required.filter(x => !names.has(x));
  if (missing.length) {
    throw new Error(`ADMIN_COLUMNS_MISSING_${missing.join('_')}`);
  }

  const hash = hashPassword('admin');
  if (!verifyPassword('admin', hash)) {
    throw new Error('ADMIN_HASH_VERIFY_FAILED');
  }

  await c.query('BEGIN');
  await c.query(`DELETE FROM ${qi(schema)}.${qi('administradores')}`);

  const values = {
    id_admin: 'ADM-GMX-ADMIN',
    username: 'admin',
    nombre: 'Admin',
    email: 'admin@gmx.local',
    password_hash: hash,
    rol: 'SUPERADMIN',
    activo: true,
    fecha_creacion: new Date(),
    fecha_actualizacion: new Date(),
    sucursal_principal: null,
    sucursales_permitidas: []
  };

  const desired = [
    'id_admin','username','nombre','email','password_hash','rol','activo',
    'fecha_creacion','fecha_actualizacion','sucursal_principal','sucursales_permitidas'
  ].filter(x => names.has(x));

  const params = desired.map((_, i) => `$${i+1}`);
  const vals = desired.map(x => values[x]);

  await c.query(
    `INSERT INTO ${qi(schema)}.${qi('administradores')}
      (${desired.map(qi).join(',')})
     VALUES (${params.join(',')})`,
    vals
  );

  const r = await c.query(
    `SELECT *
       FROM ${qi(schema)}.${qi('administradores')}`
  );

  if (r.rowCount !== 1) {
    throw new Error(`ADMIN_COUNT_${r.rowCount}`);
  }

  const a = r.rows[0];

  if (names.has('username') && String(a.username || '').toLowerCase() !== 'admin') {
    throw new Error('ADMIN_USERNAME_INVALID');
  }

  if (String(a.rol || '').toUpperCase() !== 'SUPERADMIN') {
    throw new Error('ADMIN_ROLE_INVALID');
  }

  if (a.activo !== true) {
    throw new Error('ADMIN_INACTIVE');
  }

  if (!verifyPassword('admin', a.password_hash)) {
    throw new Error('ADMIN_PASSWORD_INVALID');
  }

  await c.query('COMMIT');

  console.log('GMX_ADMIN_REPAIR_R2_6_1=OK');
  console.log(`SCHEMA=${schema}`);
  console.log('ADMIN_USER=admin');
  console.log('ADMIN_EMAIL=admin@gmx.local');
  console.log('ADMIN_ROLE=SUPERADMIN');
  console.log('ADMIN_PASSWORD_VERIFY=true');
} catch (error) {
  try { await c.query('ROLLBACK'); } catch {}
  console.error('GMX_ADMIN_REPAIR_R2_6_1=ERROR');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
NODE

touch "$MARKER"
chmod 0600 "$MARKER"

systemctl restart gmx-app.service || true

echo "[GMX] Admin repair completed."
echo "[GMX] Usuario: admin"
echo "[GMX] Password: admin"
echo "[GMX] Rol: SUPERADMIN"
