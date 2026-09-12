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
# GMX_R2_5_1_BEGIN
if [ -f /opt/gmx/app/deploy/rpi/ACTUALIZAR-GMX-WIFI-POLKIT-R2.5.1.sh ]; then
  chmod 0755 /opt/gmx/app/deploy/rpi/ACTUALIZAR-GMX-WIFI-POLKIT-R2.5.1.sh
  /opt/gmx/app/deploy/rpi/ACTUALIZAR-GMX-WIFI-POLKIT-R2.5.1.sh
fi

if [ -f /opt/gmx/app/deploy/rpi/INICIALIZAR-GMX-TIENDA-NUEVA-R2.5.1.sh ]; then
  chmod 0755 /opt/gmx/app/deploy/rpi/INICIALIZAR-GMX-TIENDA-NUEVA-R2.5.1.sh
  /opt/gmx/app/deploy/rpi/INICIALIZAR-GMX-TIENDA-NUEVA-R2.5.1.sh
fi
# GMX_R2_5_1_END
