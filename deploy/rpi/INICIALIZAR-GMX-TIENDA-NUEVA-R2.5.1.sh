#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/gmx/app"
BACKEND="${APP_ROOT}/backend"
ENV_FILE="/etc/gmx/gmx.env"
STATE_DIR="/var/lib/gmx-updater"
MARKER="${STATE_DIR}/store-init-r2.5.1.done"
BACKUP_ROOT="/opt/gmx/backups"

mkdir -p "$STATE_DIR" "$BACKUP_ROOT"

if [ -f "$MARKER" ]; then
  echo "[GMX] Store initialization R2.5.1 already completed; skipping."
  exit 0
fi

if [ ! -d "$BACKEND" ]; then
  echo "[GMX] Missing backend: $BACKEND" >&2
  exit 20
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[GMX] Missing runtime env: $ENV_FILE" >&2
  exit 21
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[GMX] pg_dump not found; reset cancelled before touching data." >&2
  exit 22
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DB_NAME="${PGDATABASE:-gmx_db}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/STORE-INIT-R2.5.1-${STAMP}"
DUMP_FILE="${BACKUP_DIR}/${DB_NAME}-PRE-STORE-INIT.dump"
NODE_REPORT="${BACKUP_DIR}/node-reset.log"
REPORT_FILE="${BACKUP_DIR}/report.txt"

mkdir -p "$BACKUP_DIR"

echo "[GMX] Creating mandatory PostgreSQL backup: $DUMP_FILE"

if command -v runuser >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  runuser -u postgres -- pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$DUMP_FILE" \
    "$DB_NAME"
else
  PGPASSWORD="${PGPASSWORD:-}" pg_dump \
    --host="${PGHOST:-127.0.0.1}" \
    --port="${PGPORT:-5432}" \
    --username="${PGUSER:-gmx_app}" \
    --dbname="$DB_NAME" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$DUMP_FILE"
fi

test -s "$DUMP_FILE"

WAS_ACTIVE=0
if systemctl is-active --quiet gmx-app.service; then
  WAS_ACTIVE=1
  systemctl stop gmx-app.service
fi

restore_app() {
  if [ "$WAS_ACTIVE" -eq 1 ]; then
    systemctl start gmx-app.service || true
  fi
}
trap restore_app EXIT

cd "$BACKEND"

set +e
node --input-type=module >"$NODE_REPORT" 2>&1 <<'NODE'
import { pool } from './src/db.js';
import { hashPassword, verifyPassword } from './src/security.js';

const clearTables = [
  'admin_password_reset_tokens',
  'admin_sessions',
  'auditoria',
  'autorizaciones_operacion',
  'caja_movimientos',
  'caja_sesiones',
  'cliente_email_tokens',
  'cliente_password_reset_tokens',
  'cliente_sessions',
  'cliente_direcciones',
  'cliente_identidad_conflictos',
  'cliente_identidad_unica',
  'cliente_cuentas',
  'fidelidad_movimientos',
  'fidelidad_cuentas',
  'clientes',
  'devoluciones_reembolsos',
  'devoluciones_eventos',
  'devoluciones_detalle',
  'devoluciones',
  'pedido_pagos',
  'detalle_pedidos',
  'payment_transactions',
  'pedidos',
  'compras_detalle',
  'compras',
  'cuentas_por_pagar_pagos',
  'cuentas_por_pagar',
  'cotizaciones_admin',
  'gastos',
  'inventario_transferencias_detalle',
  'inventario_transferencias',
  'movimientos_inventario_sucursales',
  'movimientos_inventario',
  'inventario_sucursales',
  'tcg_buylist_auditoria',
  'tcg_buylist_pagos',
  'tcg_buylist_detalle',
  'tcg_buylist',
  'tcg_conteo_detalle',
  'tcg_conteos',
  'tcg_escaneos',
  'tcg_adquisiciones',
  'tcg_movimientos_sucursales',
  'tcg_inventario_sucursales',
  'tcg_inventario',
  'promociones_redenciones',
  'notificaciones_admin',
  'email_outbox',
  'importaciones',
  'migration_import_log',
  'migration_rejects',
  'gmx_idempotencia',
  'test_data_cleanup_audit',
  'appearance_revisions',
  'permisos_admin',
  'usuarios'
];

const preserveCritical = [
  'configuracion',
  'catalogo_ciudades',
  'catalogo_ciudades_us',
  'catalogo_colonias',
  'catalogo_cp',
  'catalogo_cp_index',
  'catalogo_cp_index_us',
  'catalogo_cp_us'
];

function qi(v) {
  return '"' + String(v).replaceAll('"','""') + '"';
}

const c = await pool.connect();

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

async function count(schema, name) {
  const r = await c.query(
    `SELECT COUNT(*)::bigint AS n FROM ${qi(schema)}.${qi(name)}`
  );
  return String(r.rows[0].n);
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

  const preservedBefore = {};
  for (const name of preserveCritical) {
    if (await tableExists(schema, name)) {
      preservedBefore[name] = await count(schema, name);
    }
  }

  if (!(await tableExists(schema, 'administradores'))) {
    throw new Error(`${schema}.administradores missing`);
  }

  await c.query('BEGIN');

  for (const name of clearTables) {
    if (await tableExists(schema, name)) {
      await c.query(`DELETE FROM ${qi(schema)}.${qi(name)}`);
    }
  }

  if (await tableExists(schema, 'productos')) {
    const cols = await c.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='productos'`,
      [schema]
    );
    const names = new Set(cols.rows.map(x => x.column_name));

    if (names.has('stock')) {
      if (names.has('fecha_actualizacion')) {
        await c.query(
          `UPDATE ${qi(schema)}.${qi('productos')}
              SET stock=0, fecha_actualizacion=NOW()
            WHERE COALESCE(stock,0)<>0`
        );
      } else {
        await c.query(
          `UPDATE ${qi(schema)}.${qi('productos')}
              SET stock=0
            WHERE COALESCE(stock,0)<>0`
        );
      }
    }
  }

  if (await tableExists(schema, 'promociones')) {
    const cols = await c.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='promociones'`,
      [schema]
    );
    const names = new Set(cols.rows.map(x => x.column_name));

    if (names.has('usos')) {
      const setClause = names.has('actualizacion')
        ? 'usos=0, actualizacion=NOW()'
        : 'usos=0';

      await c.query(
        `UPDATE ${qi(schema)}.${qi('promociones')}
            SET ${setClause}
          WHERE COALESCE(usos,0)<>0`
      );
    }
  }

  await c.query(`DELETE FROM ${qi(schema)}.${qi('administradores')}`);

  const columns = await c.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='administradores'`,
    [schema]
  );

  const names = new Set(columns.rows.map(x => x.column_name));
  const required = ['id_admin','nombre','email','password_hash','rol','activo'];
  const missing = required.filter(x => !names.has(x));

  if (missing.length) {
    throw new Error(`ADMIN_COLUMNS_MISSING_${missing.join('_')}`);
  }

  const hash = hashPassword('admin');
  if (!verifyPassword('admin', hash)) {
    throw new Error('ADMIN_HASH_VERIFY_FAILED');
  }

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
    'id_admin',
    'username',
    'nombre',
    'email',
    'password_hash',
    'rol',
    'activo',
    'fecha_creacion',
    'fecha_actualizacion',
    'sucursal_principal',
    'sucursales_permitidas'
  ].filter(x => names.has(x));

  const params = desired.map((_, i) => `$${i+1}`);
  const vals = desired.map(x => values[x]);

  await c.query(
    `INSERT INTO ${qi(schema)}.${qi('administradores')}
      (${desired.map(qi).join(',')})
     VALUES (${params.join(',')})`,
    vals
  );

  for (const name of clearTables) {
    if (await tableExists(schema, name)) {
      const n = Number(await count(schema, name));
      if (n !== 0) {
        throw new Error(`RESET_NOT_EMPTY_${name}_${n}`);
      }
    }
  }

  for (const [name, before] of Object.entries(preservedBefore)) {
    const after = await count(schema, name);
    if (after !== before) {
      throw new Error(`PRESERVE_CHANGED_${name}_${before}_TO_${after}`);
    }
  }

  const admin = await c.query(
    `SELECT *
       FROM ${qi(schema)}.${qi('administradores')}`
  );

  if (admin.rowCount !== 1) {
    throw new Error(`ADMIN_COUNT_${admin.rowCount}`);
  }

  const a = admin.rows[0];

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

  console.log('GMX_STORE_INIT_R2_5_1=OK');
  console.log(`SCHEMA=${schema}`);
  console.log('ADMIN_USER=admin');
  console.log('ADMIN_PASSWORD_VERIFY=true');
  console.log('ADMIN_ROLE=SUPERADMIN');
  console.log('POSTAL_AND_CONFIG_PRESERVED=true');
  console.log('OPERATIONAL_HISTORY_CLEARED=true');
  console.log('INVENTORY_RESET=true');
} catch (error) {
  try { await c.query('ROLLBACK'); } catch {}
  console.error('GMX_STORE_INIT_R2_5_1=ERROR');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
NODE

NODE_STATUS=$?
set -e

cat "$NODE_REPORT"

if [ "$NODE_STATUS" -ne 0 ]; then
  echo "[GMX] Store initialization failed. Backup remains at: $DUMP_FILE" >&2
  exit "$NODE_STATUS"
fi

cat > "$REPORT_FILE" <<EOF
GMX_STORE_INIT_R2_5_1=OK
DATE=$(date -Is)
DB=${DB_NAME}
BACKUP=${DUMP_FILE}
ADMIN_USER=admin
ADMIN_PASSWORD=admin
ADMIN_ROLE=SUPERADMIN
POSTAL_AND_CONFIG_PRESERVED=true
OPERATIONAL_HISTORY_CLEARED=true
INVENTORY_RESET=true
EOF

touch "$MARKER"
chmod 0600 "$MARKER"

echo "[GMX] Store initialization completed."
echo "[GMX] Backup: $DUMP_FILE"
echo "[GMX] Admin: admin / admin (SUPERADMIN)"
