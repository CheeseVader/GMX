#!/usr/bin/env bash
set -Eeuo pipefail

MARKER="/var/lib/gmx-updater/reset-store-r2.8.done"
LOG="/var/log/gmx-updater/reset-store-r2.8.log"
APP="/opt/gmx/app"

mkdir -p /var/lib/gmx-updater /var/log/gmx-updater
exec >>"$LOG" 2>&1

echo
echo "===================================================================="
echo " GMX RESET TIENDA NUEVA R2.8"
echo " $(date -Is)"
echo "===================================================================="

if [[ -f "$MARKER" ]]; then
  echo "[GMX-R2.8] Ya aplicado; no se repite."
  exit 0
fi

DB_NAME="gmx_db"

if ! command -v psql >/dev/null 2>&1; then
  echo "[ERROR] psql no existe."
  exit 20
fi

if ! id postgres >/dev/null 2>&1; then
  echo "[ERROR] usuario postgres no existe."
  exit 21
fi

SCHEMA="$(sudo -u postgres psql -d "$DB_NAME" -Atqc \
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('gmx','shiny') ORDER BY CASE schema_name WHEN 'gmx' THEN 0 ELSE 1 END LIMIT 1")"

if [[ -z "$SCHEMA" ]]; then
  echo "[ERROR] No encontre schema gmx/shiny en $DB_NAME."
  exit 22
fi

echo "DB=$DB_NAME"
echo "SCHEMA=$SCHEMA"

# Solo estas tablas sobreviven.
# Todo lo demas del schema corresponde a tienda/operacion/pruebas y se vacia.
read -r -d '' SQL <<'SQL_EOF' || true
\set ON_ERROR_STOP on
BEGIN;

DO $do$
DECLARE
    s text := :'schema_name';
    t record;
    protected text[] := ARRAY[
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
      'administradores',
      'usuarios',
      'permisos_admin',
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
      'tcg_sync_providers'
    ];
BEGIN
    -- Superusuario local: desactiva temporalmente triggers/FK durante DELETE.
    -- No altera estructura ni tablas protegidas.
    PERFORM set_config('session_replication_role','replica',true);

    FOR t IN
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema=s
        AND table_type='BASE TABLE'
        AND NOT (table_name = ANY(protected))
      ORDER BY table_name
    LOOP
      EXECUTE format('DELETE FROM %I.%I', s, t.table_name);
      RAISE NOTICE 'EMPTY %', t.table_name;
    END LOOP;

    PERFORM set_config('session_replication_role','origin',true);
END
$do$;

DO $verify$
DECLARE
    s text := :'schema_name';
    t record;
    n bigint;
    protected text[] := ARRAY[
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
      'administradores',
      'usuarios',
      'permisos_admin',
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
      'tcg_sync_providers'
    ];
BEGIN
    FOR t IN
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema=s
        AND table_type='BASE TABLE'
        AND NOT (table_name = ANY(protected))
      ORDER BY table_name
    LOOP
      EXECUTE format('SELECT count(*) FROM %I.%I',s,t.table_name) INTO n;
      IF n <> 0 THEN
        RAISE EXCEPTION 'TABLE_NOT_EMPTY %.% = %',s,t.table_name,n;
      END IF;
    END LOOP;
END
$verify$;

COMMIT;
SQL_EOF

echo "[GMX-R2.8] Vaciando datos comerciales/prueba..."
sudo -u postgres psql -v schema_name="$SCHEMA" -d "$DB_NAME" -f - <<<"$SQL"

# Verificacion visible de las tablas que importan para entrega.
echo
echo "=== VERIFICACION ENTREGA ==="
for T in productos inventario_sucursales movimientos_inventario clientes sucursales categorias proveedores pedidos compras caja_movimientos tcg_inventario tcg_inventario_sucursales; do
  EXISTS="$(sudo -u postgres psql -d "$DB_NAME" -Atqc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='$SCHEMA' AND table_name='$T' AND table_type='BASE TABLE'")"
  if [[ "$EXISTS" == "1" ]]; then
    N="$(sudo -u postgres psql -d "$DB_NAME" -Atqc "SELECT count(*) FROM \"$SCHEMA\".\"$T\"")"
    echo "$T=$N"
    [[ "$N" == "0" ]] || { echo "[ERROR] $T no quedo vacia"; exit 30; }
  fi
done

# masterivangt debe seguir existiendo. Detectar columna de login.
LOGIN_COL="$(sudo -u postgres psql -d "$DB_NAME" -Atqc "
SELECT column_name
FROM information_schema.columns
WHERE table_schema='$SCHEMA'
  AND table_name='administradores'
  AND column_name IN ('username','usuario','login','email')
ORDER BY CASE column_name WHEN 'username' THEN 1 WHEN 'usuario' THEN 2 WHEN 'login' THEN 3 ELSE 4 END
LIMIT 1")"

if [[ -z "$LOGIN_COL" ]]; then
  echo "[ERROR] No encontre columna login en administradores."
  exit 31
fi

MASTER_COUNT="$(sudo -u postgres psql -d "$DB_NAME" -Atqc \
  "SELECT count(*) FROM \"$SCHEMA\".administradores WHERE lower(\"$LOGIN_COL\"::text)=lower('masterivangt')")"

echo "masterivangt=$MASTER_COUNT"
[[ "$MASTER_COUNT" == "1" ]] || { echo "[ERROR] masterivangt no esta exactamente una vez"; exit 32; }

touch "$MARKER"
chmod 0600 "$MARKER"

systemctl restart gmx-app.service || true
sleep 3

echo
echo "GMX_RESET_R2_8=OK"
echo "ALL_STORE_DATA=0"
echo "MASTERIVANGT_PRESERVED=true"
echo "CONFIG_POSTAL_TCG_PRESERVED=true"
echo "===================================================================="
exit 0
