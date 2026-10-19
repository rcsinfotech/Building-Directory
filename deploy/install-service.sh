#!/usr/bin/env bash
# One-time: run the app as a systemd service named directory-app (same name the existing signs use), so it
# starts on boot, restarts if it crashes, and deploy/update.sh can restart it.
# Run on the sign from the app folder:  ./deploy/install-service.sh
# Stop whatever started the app before (pm2, rc.local, crontab @reboot, an
# autostart entry) first, or the two copies will fight over ports 8080/8443.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_DIR="$(pwd)"
NODE_BIN="$(command -v node)"
RUN_USER="$(id -un)"

sudo tee /etc/systemd/system/directory-app.service >/dev/null <<EOF
[Unit]
Description=Directory Display App
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} server.js
User=${RUN_USER}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now directory-app
sleep 2
systemctl --no-pager status directory-app | head -12
