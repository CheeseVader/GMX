#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-full}"

say(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok(){ printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[AVISO]\033[0m %s\n' "$*"; }
die(){ printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Ejecuta con sudo/root."

APP_ROOT="/opt/gmx"
APP_DIR="$APP_ROOT/app"
APP_ENV="/etc/gmx/gmx.env"
APP_SERVICE="gmx-app.service"
STORE_PORT=8789
ACCESS_DIR="/var/lib/gmx-access"
CF_DIR="/etc/gmx-cloudflare"

[[ -d "$APP_DIR" ]] || die "GMX no estÃ¡ instalado en $APP_DIR."
[[ -f "$APP_ENV" ]] || die "Falta $APP_ENV."

APP_PORT="$(grep -E '^(PORT|APP_PORT)=' "$APP_ENV" | tail -n1 | cut -d= -f2- | tr -d '\r"' || true)"
APP_PORT="${APP_PORT:-8787}"

# Usuario grÃ¡fico: preferir sesiÃ³n real, luego SUDO_USER y finalmente primer usuario >=1000.
KIOSK_USER="$(loginctl list-users --no-legend 2>/dev/null | awk '$2!="root" && $2!="gmx"{print $2;exit}' || true)"
if [[ -z "$KIOSK_USER" && -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" && "$SUDO_USER" != "gmx" ]]; then
  KIOSK_USER="$SUDO_USER"
fi
if [[ -z "$KIOSK_USER" ]]; then
  KIOSK_USER="$(awk -F: '$3>=1000 && $3<60000 && $1!="gmx" && $7 !~ /(nologin|false)$/ {print $1;exit}' /etc/passwd)"
fi
[[ -n "$KIOSK_USER" ]] || die "No pude detectar el usuario grÃ¡fico de la Raspberry."
id "$KIOSK_USER" >/dev/null 2>&1 || die "Usuario grÃ¡fico invÃ¡lido: $KIOSK_USER"
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
[[ -d "$KIOSK_HOME" ]] || die "Home invÃ¡lido para $KIOSK_USER"

say "GMX modo TCG-CORE R2 - usuario grÃ¡fico: $KIOSK_USER"

# CorrecciÃ³n runtime ya descubierta.
chown root:gmx "$APP_ENV" 2>/dev/null || true
chmod 0640 "$APP_ENV" 2>/dev/null || true
chown root:gmx /etc/gmx 2>/dev/null || true
chmod 0750 /etc/gmx 2>/dev/null || true

if [[ "$MODE" != "--post-update" ]]; then
  say "Instalando dependencias de kiosko/red"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl jq nginx avahi-daemon avahi-utils util-linux network-manager xterm sudo
  if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    apt-get install -y chromium || apt-get install -y chromium-browser
  fi
fi

command -v nmcli >/dev/null 2>&1 || die "nmcli no estÃ¡ disponible."
systemctl enable NetworkManager >/dev/null 2>&1 || true
systemctl start NetworkManager >/dev/null 2>&1 || true
nmcli networking on >/dev/null 2>&1 || true
nmcli radio wifi on >/dev/null 2>&1 || true

# -------------------------------------------------------------------
# Wi-Fi bridge nativo: Node(gmx) -> sudo helper root -> NetworkManager
# La contraseÃ±a viaja por stdin, no como argumento de proceso.
# -------------------------------------------------------------------
say "Configurando bridge Wi-Fi nativo"
cat > /usr/local/bin/gmx-wifi-helper <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
ACTION="${1:-}"
case "$ACTION" in
  scan)
    command -v rfkill >/dev/null 2>&1 && rfkill unblock wifi >/dev/null 2>&1 || true
    nmcli radio wifi on >/dev/null 2>&1 || true

    WIFI_IF="$(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}')"
    if [ -z "$WIFI_IF" ] && command -v iw >/dev/null 2>&1; then
      WIFI_IF="$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2; exit}')"
    fi

    if [ -z "$WIFI_IF" ]; then
      echo "WIFI_INTERFACE_NOT_FOUND" >&2
      exit 41
    fi

    nmcli device set "$WIFI_IF" managed yes >/dev/null 2>&1 || true
    nmcli device wifi rescan ifname "$WIFI_IF" >/dev/null 2>&1 || true
    sleep 2

    OUT="$(nmcli -t --escape yes -f IN-USE,SSID,SIGNAL,SECURITY device wifi list ifname "$WIFI_IF" --rescan yes 2>&1 || true)"

    if [ -z "$OUT" ]; then
      OUT="$(nmcli -t --escape yes -f IN-USE,SSID,SIGNAL,SECURITY device wifi list --rescan yes 2>&1 || true)"
    fi

    if [ -z "$OUT" ]; then
      echo "WIFI_SCAN_EMPTY" >&2
      exit 42
    fi

    printf '%s\n' "$OUT"
    ;;
  active)
    exec nmcli -t --escape yes -f ACTIVE,SSID,DEVICE device wifi
    ;;
  connect)
    payload="$(cat)"
    ssid="$(printf '%s' "$payload" | jq -r '.ssid // empty')"
    password="$(printf '%s' "$payload" | jq -r '.password // empty')"
    secure="$(printf '%s' "$payload" | jq -r '.secure // false')"
    [[ -n "$ssid" ]] || { echo "invalid_ssid" >&2; exit 20; }
    if [[ "$secure" == "true" && -z "$password" ]]; then
      echo "password_required" >&2
      exit 21
    fi
    if [[ -n "$password" ]]; then
      nmcli device wifi connect "$ssid" password "$password"
    else
      nmcli device wifi connect "$ssid"
    fi
    ;;
  *)
    echo "Uso: gmx-wifi-helper {scan|active|connect}" >&2
    exit 2
    ;;
esac
EOF
chmod 0755 /usr/local/bin/gmx-wifi-helper

cat > /etc/sudoers.d/gmx-wifi-helper <<'EOF'
gmx ALL=(root) NOPASSWD: /usr/local/bin/gmx-wifi-helper
EOF
chmod 0440 /etc/sudoers.d/gmx-wifi-helper
visudo -cf /etc/sudoers.d/gmx-wifi-helper >/dev/null || die "sudoers Wi-Fi invÃ¡lido."
ok "Bridge Wi-Fi listo"

# -------------------------------------------------------------------
# Nginx: misma lÃ³gica TCG-CORE.
# :80 ADMIN /login, :8789 TIENDA /tienda
# -------------------------------------------------------------------
say "Configurando accesos ADMIN/TIENDA"
mkdir -p "$ACCESS_DIR" "$CF_DIR"

NGINX_SITE="/etc/nginx/sites-available/gmx"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name localhost 127.0.0.1 gmx.local _;
    absolute_redirect off;

    location = / {
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
        return 302 /login;
    }

    location = /gmx-runtime/access-urls.json {
        alias $ACCESS_DIR/access-urls.json;
        default_type application/json;
        add_header Cache-Control "no-store" always;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

server {
    listen ${STORE_PORT};
    listen [::]:${STORE_PORT};
    server_name _;
    absolute_redirect off;

    location = / {
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
        return 302 /tienda;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/gmx
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# -------------------------------------------------------------------
# Cloudflare ADMIN/TIENDA independientes
# -------------------------------------------------------------------
CLOUDFLARED_BIN="$(command -v cloudflared || true)"
if [[ -z "$CLOUDFLARED_BIN" && "$MODE" != "--post-update" ]]; then
  say "Instalando cloudflared"
  case "$(uname -m)" in
    aarch64|arm64) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
    armv7l|armv6l) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm" ;;
    x86_64|amd64)  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
    *) CF_URL="" ;;
  esac
  [[ -n "$CF_URL" ]] && curl -fL --retry 3 --connect-timeout 15 "$CF_URL" -o /usr/local/bin/cloudflared
  chmod 0755 /usr/local/bin/cloudflared 2>/dev/null || true
  CLOUDFLARED_BIN="$(command -v cloudflared || true)"
fi

if [[ -n "$CLOUDFLARED_BIN" ]]; then
cat > /etc/systemd/system/gmx-cloudflare-admin.service <<EOF
[Unit]
Description=GMX Cloudflare ADMIN
After=network-online.target nginx.service ${APP_SERVICE}
Wants=network-online.target
[Service]
Type=simple
ExecStart=${CLOUDFLARED_BIN} tunnel --no-autoupdate --url http://127.0.0.1:80
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/gmx-cloudflare-store.service <<EOF
[Unit]
Description=GMX Cloudflare TIENDA
After=network-online.target nginx.service ${APP_SERVICE}
Wants=network-online.target
[Service]
Type=simple
ExecStart=${CLOUDFLARED_BIN} tunnel --no-autoupdate --url http://127.0.0.1:${STORE_PORT}
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
else
  warn "cloudflared no disponible todavÃ­a."
fi

cat > /usr/local/bin/gmx-refresh-access-urls <<'EOF'
#!/usr/bin/env bash
set -u
ACCESS_DIR=/var/lib/gmx-access
CF_DIR=/etc/gmx-cloudflare
geturl(){
  journalctl -u "$1" --no-pager -n 240 2>/dev/null \
    | grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.com' \
    | tail -n1 || true
}
ADMIN="$(geturl gmx-cloudflare-admin.service)"
STORE="$(geturl gmx-cloudflare-store.service)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
mkdir -p "$ACCESS_DIR" "$CF_DIR"
cat > "$CF_DIR/urls.env" <<ENV
CLOUDFLARE_ADMIN_URL=$ADMIN
CLOUDFLARE_STORE_URL=$STORE
ENV
chmod 0644 "$CF_DIR/urls.env"
NOW="$(date --iso-8601=seconds)"
jq -n \
  --arg generated_at "$NOW" \
  --arg local127 "http://127.0.0.1/login" \
  --arg localhost "http://localhost/login" \
  --arg mdns "http://gmx.local/login" \
  --arg lan "${IP:+http://$IP/login}" \
  --arg cfadmin "$ADMIN" \
  --arg storelocal "http://127.0.0.1:8789/tienda" \
  --arg cfstore "$STORE" \
  --arg kiosk "http://127.0.0.1/login?kiosk=1" \
  '{generated_at:$generated_at,admin:{local_127:$local127,localhost:$localhost,mdns:$mdns,lan:$lan,cloudflare:$cfadmin},store:{local:$storelocal,cloudflare:$cfstore},kiosk:$kiosk}' \
  > "$ACCESS_DIR/access-urls.json.tmp"
mv "$ACCESS_DIR/access-urls.json.tmp" "$ACCESS_DIR/access-urls.json"
chmod 0644 "$ACCESS_DIR/access-urls.json"
EOF
chmod 0755 /usr/local/bin/gmx-refresh-access-urls

cat > /etc/systemd/system/gmx-access-urls-refresh.service <<'EOF'
[Unit]
Description=GMX refresh access URLs
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/gmx-refresh-access-urls
EOF
cat > /etc/systemd/system/gmx-access-urls-refresh.timer <<'EOF'
[Unit]
Description=GMX refresh access URLs timer
[Timer]
OnBootSec=20s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=gmx-access-urls-refresh.service
[Install]
WantedBy=timers.target
EOF

# -------------------------------------------------------------------
# Kiosko full screen + watchdog + icono/app
# -------------------------------------------------------------------
say "Configurando kiosko ADMIN full screen"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROMIUM" ]] || warn "Chromium todavÃ­a no estÃ¡ disponible; el launcher queda preparado."
CHROMIUM="${CHROMIUM:-/usr/bin/chromium}"

KIOSK_SCRIPT="/usr/local/bin/gmx-admin-kiosk-watchdog"
cat > "$KIOSK_SCRIPT" <<EOF
#!/usr/bin/env bash
set -u
URL="http://127.0.0.1/login?kiosk=1"
PROFILE="${KIOSK_HOME}/.config/gmx-admin-kiosk-profile"
LOCK="/tmp/gmx-admin-kiosk-\${UID}.lock"
exec 9>"\$LOCK"
flock -n 9 || exit 0
mkdir -p "\$PROFILE"
while :; do
  for _ in \$(seq 1 120); do
    curl -fsS --max-time 2 "http://127.0.0.1/login?kiosk=1" >/dev/null 2>&1 && break
    sleep 2
  done
  "$CHROMIUM" \
    --kiosk \
    --user-data-dir="\$PROFILE" \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --no-first-run \
    --start-maximized \
    "\$URL" || true
  sleep 2
done
EOF
chmod 0755 "$KIOSK_SCRIPT"

mkdir -p /usr/local/share/icons
cat > /usr/local/share/icons/gmx-admin.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="52" fill="#0b2d59"/>
<path d="M54 72h148v112H54z" fill="#fff" opacity=".1"/>
<text x="128" y="151" text-anchor="middle" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="#fff">GMX</text>
</svg>
EOF
chmod 0644 /usr/local/share/icons/gmx-admin.svg

mkdir -p "$KIOSK_HOME/.config/gmx-admin-kiosk-profile"
chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config/gmx-admin-kiosk-profile"

DESKTOP_DIR="$KIOSK_HOME/Desktop"
[[ -d "$DESKTOP_DIR" ]] || DESKTOP_DIR="$KIOSK_HOME/Escritorio"
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/GMX-Admin.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=GMX Admin
Comment=Abrir GMX ADMIN en modo kiosko
Exec=$KIOSK_SCRIPT
Icon=/usr/local/share/icons/gmx-admin.svg
Terminal=false
Categories=Network;WebBrowser;
StartupNotify=true
EOF
chmod 0755 "$DESKTOP_DIR/GMX-Admin.desktop"
chown "$KIOSK_USER:$KIOSK_USER" "$DESKTOP_DIR/GMX-Admin.desktop"
runuser -u "$KIOSK_USER" -- gio set "$DESKTOP_DIR/GMX-Admin.desktop" metadata::trusted true >/dev/null 2>&1 || true

install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.local/share/applications"
cp "$DESKTOP_DIR/GMX-Admin.desktop" "$KIOSK_HOME/.local/share/applications/GMX-Admin.desktop"
chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.local/share/applications/GMX-Admin.desktop"

install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config/autostart"
cat > "$KIOSK_HOME/.config/autostart/gmx-admin-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=GMX Admin Kiosk
Exec=$KIOSK_SCRIPT
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config/autostart/gmx-admin-kiosk.desktop"

# Raspberry Pi OS Bookworm/Trixie con labwc
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config/labwc"
LABWC="$KIOSK_HOME/.config/labwc/autostart"
touch "$LABWC"
sed -i '/gmx-admin-kiosk/d;/gmx-admin-kiosk-watchdog/d' "$LABWC"
printf '%s &\n' "$KIOSK_SCRIPT" >> "$LABWC"
chown "$KIOSK_USER:$KIOSK_USER" "$LABWC"

# Compatibilidad LXDE
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config/lxsession/LXDE-pi"
LXDE="$KIOSK_HOME/.config/lxsession/LXDE-pi/autostart"
touch "$LXDE"
sed -i '/gmx-admin-kiosk/d;/gmx-admin-kiosk-watchdog/d' "$LXDE"
printf '@%s\n' "$KIOSK_SCRIPT" >> "$LXDE"
chown "$KIOSK_USER:$KIOSK_USER" "$LXDE"

# -------------------------------------------------------------------
# Post-update root hook persistente.
# El updater GMX ya corre como root; este ExecStartPost re-aplica la
# configuraciÃ³n privilegiada despuÃ©s de futuras releases.
# -------------------------------------------------------------------
say "Instalando post-update automÃ¡tico para futuras releases"
cat > /usr/local/bin/gmx-post-update-dispatch <<'EOF'
#!/usr/bin/env bash
set -u
HOOK="/opt/gmx/app/deploy/rpi/POST-UPDATE-GMX-RPI.sh"
if [[ -x "$HOOK" ]]; then
  "$HOOK" >>/var/log/gmx-updater/post-update.log 2>&1 || true
fi
exit 0
EOF
chmod 0755 /usr/local/bin/gmx-post-update-dispatch

mkdir -p /etc/systemd/system/gmx-updater.service.d
cat > /etc/systemd/system/gmx-updater.service.d/post-update.conf <<'EOF'
[Service]
ExecStartPost=/usr/local/bin/gmx-post-update-dispatch
EOF

systemctl daemon-reload
if [[ -n "$CLOUDFLARED_BIN" ]]; then
  systemctl enable --now gmx-cloudflare-admin.service gmx-cloudflare-store.service
fi
systemctl enable --now gmx-access-urls-refresh.timer
systemctl restart gmx-access-urls-refresh.service || true
systemctl restart nginx
systemctl restart "$APP_SERVICE" || true

# Validaciones
say "Validando"
grep -Fq 'URL="http://127.0.0.1/login?kiosk=1"' "$KIOSK_SCRIPT" || die "Kiosko no apunta al login ADMIN."
grep -Fq -- '--kiosk' "$KIOSK_SCRIPT" || die "Chromium no quedÃ³ en modo --kiosk."
[[ -f "$DESKTOP_DIR/GMX-Admin.desktop" ]] || die "No quedÃ³ el icono GMX en escritorio."
[[ -f /etc/sudoers.d/gmx-wifi-helper ]] || die "No quedÃ³ bridge Wi-Fi."
nginx -t >/dev/null

/usr/local/bin/gmx-refresh-access-urls || true
ADMIN_LOC="$(curl -sSI --max-time 5 http://127.0.0.1/ | tr -d '\r' | awk 'tolower($1)=="location:"{print $2;exit}')"
STORE_LOC="$(curl -sSI --max-time 5 http://127.0.0.1:${STORE_PORT}/ | tr -d '\r' | awk 'tolower($1)=="location:"{print $2;exit}')"
[[ "$ADMIN_LOC" == "/login" ]] || warn "127.0.0.1 / Location=$ADMIN_LOC (esperado /login)"
[[ "$STORE_LOC" == "/tienda" ]] || warn "Tienda :$STORE_PORT / Location=$STORE_LOC (esperado /tienda)"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "============================================================"
echo " GMX - MECANICA TCG-CORE R2 APLICADA"
echo "============================================================"
echo "Kiosko full screen : http://127.0.0.1/login?kiosk=1"
echo "Icono escritorio   : $DESKTOP_DIR/GMX-Admin.desktop"
echo "127.0.0.1          : http://127.0.0.1/ -> /login"
echo "localhost          : http://localhost/ -> /login"
echo "gmx.local          : http://gmx.local/ -> /login"
echo "LAN                : http://${IP:-IP}/ -> /login"
echo "Tienda             : http://127.0.0.1:${STORE_PORT}/ -> /tienda"
echo "Wi-Fi login        : modal nativo disponible SOLO desde kiosk local"
echo "Post-update futuro : ACTIVO"
echo "============================================================"