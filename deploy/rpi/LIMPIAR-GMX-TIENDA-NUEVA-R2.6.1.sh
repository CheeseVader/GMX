#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/gmx/app"
BACKEND="${APP_ROOT}/backend"
STATE_DIR="/var/lib/gmx-updater"
MARKER="${STATE_DIR}/clean-store-r2.6.1.done"

mkdir -p "$STATE_DIR"

if [ -f "$MARKER" ]; then
  echo "[GMX] Clean store R2.6.1 already completed; skipping."
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
  return String(r.rows[0].n);
}

async function rowsJson(schema, name) {
  if (!(await tableExists(schema, name))) return null;
  const r = await c.query(
    `SELECT row_to_json(t)::text AS j
       FROM ${qi(schema)}.${qi(name)} t
      ORDER BY row_to_json(t)::text`
  );
  return r.rows.map(x => x.j);
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

  /*
   * TABLAS PROTEGIDAS.
   * No se truncan ni se actualizan.
   */
  const protectedTables = new Set([
    'schema_migrations',

    // Configuracion y catalogos geograficos/postales.
    'configuracion',
    'catalogo_ciudades',
    'catalogo_ciudades_us',
    'catalogo_colonias',
    'catalogo_cp',
    'catalogo_cp_index',
    'catalogo_cp_index_us',
    'catalogo_cp_us',
    'fx_rates',

    // ADMINISTRADORES / USUARIOS / PERMISOS:
    // preservar masterivangt y cualquier configuracion de acceso existente.
    'administradores',
    'usuarios',
    'permisos_admin',

    // Catalogos estructurales.
    'categorias',
    'proveedores',
    'sucursales',

    // Datos maestros/referencia TCG.
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

    // Configuracion/UI.
    'cms_banners',
    'multimedia',
    'dashboard_legacy'
  ]);

  /*
   * DATOS OPERATIVOS/PRUEBA A LIMPIAR.
   * Incluye productos capturados manualmente y todo historial transaccional.
   */
  const targets = [
    // Sesiones/tokens temporales: no modifican el usuario ni su password.
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

    // Catalogo de producto ingresado durante pruebas.
    'productos'
  ];

  /*
   * Fotografia de seguridad: se guardan filas completas de tablas protegidas
   * especialmente administradores/usuarios/permisos_admin.
   */
  const protectedBefore = {};
  for (const name of protectedTables) {
    if (await tableExists(schema, name)) {
      protectedBefore[name] = {
        count: await count(schema, name),
        rows: ['administradores','usuarios','permisos_admin'].includes(name)
          ? await rowsJson(schema, name)
          : null
      };
    }
  }

  if (!(await tableExists(schema, 'administradores'))) {
    throw new Error(`${schema}.administradores missing`);
  }

  // Confirmar que masterivangt existe ANTES de limpiar.
  const adminCols = await c.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema=$1
        AND table_name='administradores'`,
    [schema]
  );
  const adminColumnNames = new Set(adminCols.rows.map(r => r.column_name));

  let loginColumn = null;
  for (const candidate of ['username','usuario','login','email']) {
    if (adminColumnNames.has(candidate)) {
      loginColumn = candidate;
      break;
    }
  }

  if (!loginColumn) {
    throw new Error('ADMIN_LOGIN_COLUMN_NOT_FOUND');
  }

  const masterBefore = await c.query(
    `SELECT row_to_json(a)::text AS j
       FROM ${qi(schema)}.${qi('administradores')} a
      WHERE lower(COALESCE(${qi(loginColumn)}::text,'')) = lower($1)`,
    ['masterivangt']
  );

  if (masterBefore.rowCount !== 1) {
    throw new Error(`MASTERIVANGT_EXPECTED_1_FOUND_${masterBefore.rowCount}`);
  }

  const masterSnapshot = masterBefore.rows[0].j;

  await c.query('BEGIN');

  const existingTargets = [];
  for (const name of targets) {
    if (protectedTables.has(name)) {
      throw new Error(`SAFETY_TARGET_IS_PROTECTED_${name}`);
    }
    if (await tableExists(schema, name)) {
      existingTargets.push(name);
    }
  }

  if (existingTargets.length) {
    const qualified = existingTargets
      .map(name => `${qi(schema)}.${qi(name)}`)
      .join(', ');

    /*
     * Todos juntos con CASCADE para resolver FK entre tablas operativas.
     * Las verificaciones posteriores detectan inmediatamente si PostgreSQL
     * llegara a afectar una tabla protegida por una FK inesperada.
     */
    await c.query(
      `TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`
    );
  }

  // Todos los targets deben quedar vacios.
  const residual = [];
  for (const name of targets) {
    if (await tableExists(schema, name)) {
      const n = await count(schema, name);
      if (n !== '0') residual.push(`${name}=${n}`);
    }
  }
  if (residual.length) {
    throw new Error(`RESIDUAL_DATA_${residual.join(',')}`);
  }

  // Las tablas protegidas deben conservar su cantidad.
  for (const [name, before] of Object.entries(protectedBefore)) {
    const afterCount = await count(schema, name);
    if (afterCount !== before.count) {
      throw new Error(
        `PROTECTED_DATA_CHANGED_${name}_${before.count}_TO_${afterCount}`
      );
    }

    // Para seguridad/autenticacion exigimos identidad byte-a-byte del JSON.
    if (before.rows !== null) {
      const afterRows = await rowsJson(schema, name);
      if (JSON.stringify(afterRows) !== JSON.stringify(before.rows)) {
        throw new Error(`PROTECTED_ROWS_CHANGED_${name}`);
      }
    }
  }

  // masterivangt tiene que ser exactamente la misma fila.
  const masterAfter = await c.query(
    `SELECT row_to_json(a)::text AS j
       FROM ${qi(schema)}.${qi('administradores')} a
      WHERE lower(COALESCE(${qi(loginColumn)}::text,'')) = lower($1)`,
    ['masterivangt']
  );

  if (masterAfter.rowCount !== 1) {
    throw new Error(`MASTERIVANGT_AFTER_EXPECTED_1_FOUND_${masterAfter.rowCount}`);
  }

  if (masterAfter.rows[0].j !== masterSnapshot) {
    throw new Error('MASTERIVANGT_CHANGED_ABORTING');
  }

  await c.query('COMMIT');

  console.log('GMX_CLEAN_STORE_R2_6_1=OK');
  console.log(`SCHEMA=${schema}`);
  console.log('MASTERIVANGT_PRESERVED=true');
  console.log('ADMIN_PASSWORD_HASH_UNCHANGED=true');
  console.log('USERS_AND_PERMISSIONS_PRESERVED=true');
  console.log('POSTAL_CATALOGS_PRESERVED=true');
  console.log('CONFIGURATION_PRESERVED=true');
  console.log('TCG_MASTER_DATA_PRESERVED=true');
  console.log('PRODUCTS=0');
  console.log('SALES_PURCHASES_HISTORY=0');
  console.log('INVENTORY_OPERATIONAL_DATA=0');
  console.log('CUSTOMERS=0');

} catch (error) {
  try { await c.query('ROLLBACK'); } catch {}
  console.error('GMX_CLEAN_STORE_R2_6_1=ERROR');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
NODE

touch "$MARKER"
chmod 0600 "$MARKER"

echo "[GMX] Clean store R2.6.1 completed."
echo "[GMX] masterivangt and existing credentials were preserved."
echo "[GMX] Configuration and postal catalogs were preserved."
