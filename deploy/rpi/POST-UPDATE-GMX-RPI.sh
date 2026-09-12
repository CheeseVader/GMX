#!/usr/bin/env bash
set -Eeuo pipefail
exec /opt/gmx/app/deploy/rpi/CONFIGURAR-GMX-TCGCORE-COMPLETO-R2.sh --post-update
# GMX_WIFI_POSTUPDATE_R1_5
WIFI_PATCH="/opt/gmx/app/deploy/rpi/ACTUALIZAR-GMX-WIFI-R1.5.sh"
if [ -f "$WIFI_PATCH" ]; then
  sed -i 's/\r$//' "$WIFI_PATCH" || true
  chmod +x "$WIFI_PATCH" || true
  "$WIFI_PATCH" || echo "[GMX][WARN] No se pudo actualizar gmx-wifi-helper R1.5" >&2
fi
# /GMX_WIFI_POSTUPDATE_R1_5

# GMX_WIFI_SYSTEMD_R1_9_BEGIN
if [ -x /opt/gmx/app/deploy/rpi/APLICAR-GMX-WIFI-SYSTEMD-R1.9.sh ]; then
  /opt/gmx/app/deploy/rpi/APLICAR-GMX-WIFI-SYSTEMD-R1.9.sh || true
fi
# GMX_WIFI_SYSTEMD_R1_9_END