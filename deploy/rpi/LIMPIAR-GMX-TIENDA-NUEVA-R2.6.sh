#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/gmx/app"
BACKEND="${APP_ROOT}/backend"
STATE_DIR="/var/lib/gmx-updater"
MARKER="${STATE_DIR}/clean-store-r2.6.done"

mkdir -p "$STATE_DIR"

if [ -f "$MARKER" ]; then
  echo "[GMX] Clean store R2.6 already completed; skipping."
  exit 0
fi

if [ ! -d "$BACKEND" ]; then
  echo "[GMX] Missing backend: $BACKEND" >&2
  exit 20
fi

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

async function count(schema, name) {
  const r = await c.query(
    `SELECT COUNT(*)::bigint AS n FROM ${qi(schema)}.${qi(name)}`
  );
  return Number(r.rows[0].n);
}

try {
  let schema = null;

  for (const candidate of ['gmx','shiny']) {
    if (await schemaExists(candidate)) {
      schema = candidate;
      break;
    }
  }

  if (!schema) {
    throw new Error('GMX_SCHEMA_NOT_FOUND');
  }

  // These are system/base datasets that MUST remain untouched.
  const preserve = new Set([
    'schema_migrations',
    'configuracion',
    'catalogo_ciudades',
    'catalogo_ciudades_us',
    'catalogo_colonias',
    'catalogo_cp',
    'catalogo_cp_index',
    'catalogo_cp_index_us',
    'catalogo_cp_us',
    'fx_rates',

    // Base TCG reference/master data remains available.
    'tcg_cartas',
    'tcg_juegos',
    'tcg_master_cards',
    'tcg_master_juegos',
    'tcg_master_rarezas',
    'tcg_master_sets',
    'tcg_rarezas',
    'tcg_sets',
    'tcg_card_price_current',
    'tcg_card_price_history',
    'tcg_sync_game_config',
    'tcg_sync_providers',

    // UI/system configuration assets remain.
    'cms_banners',
    'multimedia',
    'dashboard_legacy'
  ]);

  // Store/test data to wipe for a genuinely new store.
  // Includes the manually entered product catalog.
  const targets = [
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
    'promociones',

    'notificaciones_admin',
    'email_outbox',
    'importaciones',
    'migration_import_log',
    'migration_rejects',
    'gmx_idempotencia',
    'test_data_cleanup_audit',
    'appearance_revisions',
    'permisos_admin',
    'usuarios',

    // Store-entered catalog.
    'productos'
  ];

  // Verify protected tables before touching anything.
  const protectedBefore = {};
  for (const name of preserve) {
    if (await tableExists(schema, name)) {
      protectedBefore[name] = await count(schema, name);
    }
  }

  await c.query('BEGIN');

  // Truncate all existing target tables in a single statement so FK order is irrelevant.
  const existingTargets = [];
  for (const name of targets) {
    if (preserve.has(name)) continue;
    if (await tableExists(schema, name)) {
      existingTargets.push(name);
    }
  }

  if (existingTargets.length) {
    const qualified = existingTargets
      .map(name => `${qi(schema)}.${qi(name)}`)
      .join(', ');

    await c.query(
      `TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`
    );
  }

  // Keep categories/providers because they can be structural setup.
  // Product rows themselves are intentionally zero.
  if (await tableExists(schema, 'administradores')) {
    await c.query(
      `TRUNCATE TABLE ${qi(schema)}.${qi('administradores')} RESTART IDENTITY CASCADE`
    );

    const cols = await c.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema=$1
          AND table_name='administradores'`,
      [schema]
    );

    const names = new Set(cols.rows.map(r => r.column_name));
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
  }

  // Validate every target is empty.
  const residual = [];

  for (const name of targets) {
    if (await tableExists(schema, name)) {
      const n = await count(schema, name);
      if (n !== 0) residual.push(`${name}=${n}`);
    }
  }

  if (residual.length) {
    throw new Error(`RESIDUAL_DATA_${residual.join(',')}`);
  }

  // Validate protected datasets did not change row count.
  for (const [name, before] of Object.entries(protectedBefore)) {
    const after = await count(schema, name);
    if (after !== before) {
      throw new Error(`PROTECTED_DATA_CHANGED_${name}_${before}_TO_${after}`);
    }
  }

  // Validate admin/admin.
  if (await tableExists(schema, 'administradores')) {
    const r = await c.query(
      `SELECT *
         FROM ${qi(schema)}.${qi('administradores')}`
    );

    if (r.rowCount !== 1) {
      throw new Error(`ADMIN_COUNT_${r.rowCount}`);
    }

    const a = r.rows[0];

    if ('username' in a && String(a.username || '').toLowerCase() !== 'admin') {
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
  }

  await c.query('COMMIT');

  console.log('GMX_CLEAN_STORE_R2_6=OK');
  console.log(`SCHEMA=${schema}`);
  console.log('PRODUCTS=0');
  console.log('SALES_PURCHASES_HISTORY=0');
  console.log('INVENTORY=0');
  console.log('CUSTOMERS=0');
  console.log('PROMOTIONS=0');
  console.log('POSTAL_CATALOGS_PRESERVED=true');
  console.log('CONFIGURATION_PRESERVED=true');
  console.log('TCG_MASTER_DATA_PRESERVED=true');
  console.log('ADMIN_USER=admin');
  console.log('ADMIN_PASSWORD_VERIFY=true');
  console.log('ADMIN_ROLE=SUPERADMIN');
} catch (error) {
  try { await c.query('ROLLBACK'); } catch {}
  console.error('GMX_CLEAN_STORE_R2_6=ERROR');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
NODE

touch "$MARKER"
chmod 0600 "$MARKER"

echo "[GMX] Clean store R2.6 completed."
echo "[GMX] No backup was created by design."
echo "[GMX] admin / admin / SUPERADMIN"
