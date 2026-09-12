#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Este script requiere root." >&2
  exit 1
fi

install -d -m 0755 /usr/local/bin

cat >/usr/local/bin/gmx-wifi-helper <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

wifi_if() {
  local i=""
  i="$(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}')"
  if [[ -z "$i" ]] && command -v iw >/dev/null 2>&1; then
    i="$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2; exit}')"
  fi
  printf '%s' "$i"
}

case "$ACTION" in
  scan)
    command -v rfkill >/dev/null 2>&1 && rfkill unblock wifi >/dev/null 2>&1 || true
    nmcli radio wifi on >/dev/null 2>&1 || true

    WIFI_IF="$(wifi_if)"
    if [[ -z "$WIFI_IF" ]]; then
      echo "WIFI_INTERFACE_NOT_FOUND" >&2
      exit 41
    fi

    nmcli device set "$WIFI_IF" managed yes >/dev/null 2>&1 || true
    nmcli device wifi rescan ifname "$WIFI_IF" >/dev/null 2>&1 || true
    sleep 2

    if ! nmcli -t --escape yes -f IN-USE,SSID,SIGNAL,SECURITY device wifi list ifname "$WIFI_IF" --rescan yes; then
      nmcli -t --escape yes -f IN-USE,SSID,SIGNAL,SECURITY device wifi list --rescan yes
    fi
    ;;

  connect)
    PAYLOAD="$(cat)"
    SSID="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).ssid||'')}catch{process.exit(2)}})")"
    PASSWORD="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).password||'')}catch{process.exit(2)}})")"

    [[ -n "$SSID" ]] || { echo "SSID_REQUIRED" >&2; exit 43; }

    command -v rfkill >/dev/null 2>&1 && rfkill unblock wifi >/dev/null 2>&1 || true
    nmcli radio wifi on >/dev/null 2>&1 || true

    WIFI_IF="$(wifi_if)"
    [[ -n "$WIFI_IF" ]] || { echo "WIFI_INTERFACE_NOT_FOUND" >&2; exit 41; }

    nmcli device set "$WIFI_IF" managed yes >/dev/null 2>&1 || true

    if [[ -n "$PASSWORD" ]]; then
      nmcli device wifi connect "$SSID" password "$PASSWORD" ifname "$WIFI_IF"
    else
      nmcli device wifi connect "$SSID" ifname "$WIFI_IF"
    fi
    ;;

  *)
    echo "Uso: gmx-wifi-helper scan|connect" >&2
    exit 64
    ;;
esac
EOF

chmod 0755 /usr/local/bin/gmx-wifi-helper
chown root:root /usr/local/bin/gmx-wifi-helper

cat >/etc/sudoers.d/gmx-wifi-helper <<'EOF'
gmx ALL=(root) NOPASSWD: /usr/local/bin/gmx-wifi-helper
EOF
chmod 0440 /etc/sudoers.d/gmx-wifi-helper

if command -v visudo >/dev/null 2>&1; then
  visudo -cf /etc/sudoers.d/gmx-wifi-helper >/dev/null
fi

echo "[GMX] Wi-Fi helper R1.5 instalado/actualizado."