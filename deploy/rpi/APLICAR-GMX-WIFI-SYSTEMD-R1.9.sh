#!/usr/bin/env bash
set -euo pipefail

DROPIN_DIR="/etc/systemd/system/gmx-app.service.d"
DROPIN="$DROPIN_DIR/zzzz-gmx-wifi.conf"
MARKER="/var/lib/gmx-updater/wifi-nonewprivileges-r1.9"

mkdir -p "$DROPIN_DIR"

cat > "$DROPIN" <<'EOF'
[Service]
NoNewPrivileges=false
EOF

chmod 0644 "$DROPIN"
systemctl daemon-reload

# Si el proceso actual todavia fue iniciado con NoNewPrivileges=yes,
# reiniciarlo una sola vez fuera de ExecStartPost.
CURRENT="$(systemctl show gmx-app.service -p NoNewPrivileges --value 2>/dev/null || true)"
if [[ "$CURRENT" == "yes" && ! -f "$MARKER" ]]; then
  mkdir -p "$(dirname "$MARKER")"
  touch "$MARKER"
  systemd-run --unit=gmx-wifi-privilege-restart-r19 \
    --on-active=3s /bin/systemctl restart gmx-app.service >/dev/null
fi

exit 0