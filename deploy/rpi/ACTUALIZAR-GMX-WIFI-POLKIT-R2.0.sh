#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "[GMX][WIFI] Este post-update requiere root." >&2
  exit 1
fi

APP_USER="gmx"
APP_GROUP="gmx"
HELPER="/usr/local/bin/gmx-wifi-helper"
RULE_DIR="/etc/polkit-1/rules.d"
RULE="$RULE_DIR/49-gmx-networkmanager.rules"

install -d -m 0755 "$RULE_DIR"
install -d -m 0755 /usr/local/bin

cat >"$RULE" <<'EOF'
polkit.addRule(function(action, subject) {
    if (subject.isInGroup("gmx") &&
        action.id.indexOf("org.freedesktop.NetworkManager.") === 0) {
        return polkit.Result.YES;
    }
});
EOF
chmod 0644 "$RULE"

cat >"$HELPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

wifi_if() {
  nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null |
    awk -F: '$2=="wifi"{print $1; exit}'
}

case "$ACTION" in
  scan)
    nmcli radio wifi on >/dev/null 2>&1 || true
    WIFI_IF="$(wifi_if)"
    [[ -n "$WIFI_IF" ]] || { echo "WIFI_INTERFACE_NOT_FOUND" >&2; exit 41; }

    nmcli device set "$WIFI_IF" managed yes >/dev/null 2>&1 || true
    nmcli device wifi rescan ifname "$WIFI_IF" >/dev/null 2>&1 || true
    sleep 2

    exec nmcli -t --escape yes \
      -f IN-USE,SSID,SIGNAL,SECURITY \
      device wifi list ifname "$WIFI_IF" --rescan yes
    ;;

  connect)
    PAYLOAD="$(cat)"
    SSID="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).ssid||'')}catch{process.exit(2)}})")"
    PASSWORD="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).password||'')}catch{process.exit(2)}})")"

    [[ -n "$SSID" ]] || { echo "SSID_REQUIRED" >&2; exit 43; }

    nmcli radio wifi on >/dev/null 2>&1 || true
    WIFI_IF="$(wifi_if)"
    [[ -n "$WIFI_IF" ]] || { echo "WIFI_INTERFACE_NOT_FOUND" >&2; exit 41; }

    nmcli device set "$WIFI_IF" managed yes >/dev/null 2>&1 || true

    if [[ -n "$PASSWORD" ]]; then
      exec nmcli device wifi connect "$SSID" password "$PASSWORD" ifname "$WIFI_IF"
    else
      exec nmcli device wifi connect "$SSID" ifname "$WIFI_IF"
    fi
    ;;

  *)
    echo "Uso: gmx-wifi-helper scan|connect" >&2
    exit 64
    ;;
esac
EOF

chmod 0755 "$HELPER"
chown root:root "$HELPER"

# Ya no usamos sudo para Wi-Fi.
rm -f /etc/sudoers.d/gmx-wifi-helper || true

# Quitar el override anterior: NoNewPrivileges puede permanecer TRUE.
# Este diseÃ±o no necesita elevaciÃ³n de privilegios desde Node.
rm -f /etc/systemd/system/gmx-app.service.d/zzzz-gmx-wifi.conf || true

systemctl daemon-reload || true
systemctl try-restart polkit.service >/dev/null 2>&1 || true

# El usuario de la app debe pertenecer al grupo usado por la regla.
if id "$APP_USER" >/dev/null 2>&1; then
  usermod -a -G "$APP_GROUP" "$APP_USER" >/dev/null 2>&1 || true
fi

# Reinicio final para cargar el backend de la release y credenciales de grupo.
systemctl restart gmx-app.service || true

echo "[GMX][WIFI] R2.0 aplicado: helper directo + Polkit, SIN sudo."
exit 0