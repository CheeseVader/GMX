#!/usr/bin/env bash
set -Eeuo pipefail

APP="/opt/gmx/app"
DB="gmx_db"
STATE="/var/lib/gmx-updater"
LOG="/var/log/gmx-updater/reset-store-r2.9.log"
MARKER="$STATE/reset-store-r2.9.done"

mkdir -p "$STATE" /var/log/gmx-updater
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

echo "===================================================================="
echo " GMX RESET TIENDA NUEVA R2.9"
echo " $(date -Is)"
echo "===================================================================="

if [[ -f "$MARKER" ]]; then
  echo "[GMX-R2.9] Ya aplicado. Verificando..."
fi

command -v psql >/dev/null 2>&1 || { echo "[ERROR] psql no existe"; exit 20; }
id postgres >/dev/null 2>&1 || { echo "[ERROR] usuario postgres no existe"; exit 21; }

SCHEMA="$(sudo -u postgres psql -d "$DB" -Atqc \
"SELECT schema_name
 FROM information_schema.schemata
 WHERE schema_name IN ('gmx','shiny')
 ORDER BY CASE schema_name WHEN 'gmx' THEN 0 ELSE 1 END
 LIMIT 1")"

[[ -n "$SCHEMA" ]] || { echo "[ERROR] No existe schema gmx/shiny en $DB"; exit 22; }

echo "DB=$DB"
echo "SCHEMA=$SCHEMA"

# Tablas que NO se borran.
PROTECTED_SQL="'schema_migrations',
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
'tcg_sync_providers'"

echo
echo "=== TABLAS A VACIAR ==="

mapfile -t TARGETS < <(
  sudo -u postgres psql -d "$DB" -Atqc "
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='$SCHEMA'
      AND table_type='BASE TABLE'
      AND table_name NOT IN ($PROTECTED_SQL)
    ORDER BY table_name"
)

printf '%s\n' "${TARGETS[@]}"

# Snapshot exacto de masterivangt antes.
LOGIN_COL="$(sudo -u postgres psql -d "$DB" -Atqc "
SELECT column_name
FROM information_schema.columns
WHERE table_schema='$SCHEMA'
  AND table_name='administradores'
  AND column_name IN ('username','usuario','login','email')
ORDER BY CASE column_name
  WHEN 'username' THEN 1
  WHEN 'usuario' THEN 2
  WHEN 'login' THEN 3
  ELSE 4 END
LIMIT 1")"

[[ -n "$LOGIN_COL" ]] || {
  echo "[ERROR] No encontre columna login en administradores"
  exit 23
}

MASTER_BEFORE="$(sudo -u postgres psql -d "$DB" -Atqc \
"SELECT row_to_json(a)::text
 FROM \"$SCHEMA\".administradores a
 WHERE lower(\"$LOGIN_COL\"::text)=lower('masterivangt')")"

MASTER_COUNT_BEFORE="$(printf '%s\n' "$MASTER_BEFORE" | sed '/^$/d' | wc -l)"
[[ "$MASTER_COUNT_BEFORE" == "1" ]] || {
  echo "[ERROR] masterivangt antes=$MASTER_COUNT_BEFORE"
  exit 24
}

# Construir UN SOLO SQL transaccional.
SQLFILE="$(mktemp)"
trap 'rm -f "$SQLFILE"' EXIT

{
  echo '\set ON_ERROR_STOP on'
  echo 'BEGIN;'
  echo "SET LOCAL session_replication_role = 'replica';"

  for T in "${TARGETS[@]}"; do
    # Nombres vienen de information_schema; doble comilla por seguridad.
    QT="${T//\"/\"\"}"
    QS="${SCHEMA//\"/\"\"}"
    echo "DELETE FROM \"$QS\".\"$QT\";"
  done

  echo "SET LOCAL session_replication_role = 'origin';"
  echo 'COMMIT;'
} > "$SQLFILE"

echo
echo "=== BORRANDO DATOS DE TIENDA ==="
systemctl stop gmx-app.service || true

if ! sudo -u postgres psql -d "$DB" -f "$SQLFILE"; then
  echo "[ERROR] PostgreSQL rechazo el reset. No se completo la entrega."
  systemctl start gmx-app.service || true
  exit 25
fi

echo
echo "=== VERIFICANDO TODAS LAS TABLAS OBJETIVO ==="
BAD=0
for T in "${TARGETS[@]}"; do
  N="$(sudo -u postgres psql -d "$DB" -Atqc "SELECT count(*) FROM \"$SCHEMA\".\"$T\"")"
  echo "$T=$N"
  if [[ "$N" != "0" ]]; then
    BAD=1
  fi
done

[[ "$BAD" == "0" ]] || {
  echo "[ERROR] Hay tablas que no quedaron en cero."
  systemctl start gmx-app.service || true
  exit 26
}

MASTER_AFTER="$(sudo -u postgres psql -d "$DB" -Atqc \
"SELECT row_to_json(a)::text
 FROM \"$SCHEMA\".administradores a
 WHERE lower(\"$LOGIN_COL\"::text)=lower('masterivangt')")"

[[ "$MASTER_AFTER" == "$MASTER_BEFORE" ]] || {
  echo "[ERROR] masterivangt cambio. ABORTAR ENTREGA."
  systemctl start gmx-app.service || true
  exit 27
}

# Verificaciones principales de entrega.
echo
echo "=== RESUMEN ENTREGA ==="
for T in productos categorias proveedores sucursales inventario_sucursales movimientos_inventario clientes pedidos compras caja_movimientos tcg_inventario tcg_inventario_sucursales cms_banners multimedia promociones; do
  E="$(sudo -u postgres psql -d "$DB" -Atqc \
  "SELECT 1 FROM information_schema.tables WHERE table_schema='$SCHEMA' AND table_name='$T' AND table_type='BASE TABLE'")"
  if [[ "$E" == "1" ]]; then
    N="$(sudo -u postgres psql -d "$DB" -Atqc "SELECT count(*) FROM \"$SCHEMA\".\"$T\"")"
    echo "$T=$N"
    [[ "$N" == "0" ]] || exit 28
  fi
done

echo "masterivangt=1"

touch "$MARKER"
chmod 0600 "$MARKER"

systemctl start gmx-app.service
sleep 4
systemctl is-active --quiet gmx-app.service || {
  echo "[ERROR] gmx-app.service no levanto"
  systemctl status gmx-app.service --no-pager || true
  exit 29
}

echo
echo "GMX_RESET_R2_9=OK"
echo "ALL_STORE_DATA=0"
echo "MASTERIVANGT_PRESERVED=true"
echo "CONFIG_POSTAL_TCG_PRESERVED=true"
echo "READY_FOR_DELIVERY=true"
echo "===================================================================="
