#!/usr/bin/env bash

# Deliberately non-fatal emergency recovery.
set +e

echo "[GMX] Emergency app recovery R2.7 starting..."

# Runtime env permissions previously verified for GMX.
if [ -f /etc/gmx/gmx.env ]; then
  chown root:gmx /etc/gmx/gmx.env 2>/dev/null || true
  chmod 0640 /etc/gmx/gmx.env 2>/dev/null || true
fi

if [ -d /etc/gmx ]; then
  chown root:gmx /etc/gmx 2>/dev/null || true
  chmod 0750 /etc/gmx 2>/dev/null || true
fi

# Clear failed state and restart only the application.
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed gmx-app.service 2>/dev/null || true
systemctl stop gmx-app.service 2>/dev/null || true
sleep 2
systemctl start gmx-app.service 2>/dev/null || true
sleep 4

if systemctl is-active --quiet gmx-app.service; then
  echo "[GMX] gmx-app.service is ACTIVE."
else
  echo "[GMX] gmx-app.service is still not active."
  systemctl --no-pager --full status gmx-app.service 2>/dev/null || true
fi

# Never fail the updater because of this recovery step.
exit 0
