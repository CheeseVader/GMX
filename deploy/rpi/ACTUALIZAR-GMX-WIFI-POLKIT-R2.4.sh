#!/usr/bin/env bash
set -euo pipefail

RULE_DIR="/etc/polkit-1/rules.d"
RULE_FILE="${RULE_DIR}/49-gmx-networkmanager.rules"

mkdir -p "$RULE_DIR"

cat > "$RULE_FILE" <<'EOF'
polkit.addRule(function(action, subject) {
    if (
        subject.user == "gmx" &&
        action.id.indexOf("org.freedesktop.NetworkManager.") === 0
    ) {
        return polkit.Result.YES;
    }
});
EOF

chown root:root "$RULE_FILE"
chmod 0644 "$RULE_FILE"

# Remove obsolete sudo-based Wi-Fi configuration.
rm -f /etc/sudoers.d/gmx-wifi-helper || true
rm -f /etc/systemd/system/gmx-app.service.d/zzzz-gmx-wifi.conf || true

# Reload authorization service if present.
systemctl try-restart polkit.service >/dev/null 2>&1 || true
systemctl daemon-reload

echo "[GMX] NetworkManager Polkit rule installed."
echo "[GMX] No sudo is required by the Node backend."
