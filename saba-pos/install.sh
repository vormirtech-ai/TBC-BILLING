#!/bin/sh
# ---------------------------------------------------------------------------
# Saba POS — install on the till computer
# ---------------------------------------------------------------------------
# Run from the folder this script is in:
#
#     sudo ./install.sh
#
# It installs Saba as a system service that starts with the computer, creates
# a user for it to run as, and prints the address to open on the tablets.
#
# Nothing is downloaded. Saba has no dependencies; this only needs Node 22.5
# or newer already present on the machine.
# ---------------------------------------------------------------------------
set -eu

APP_USER=saba
APP_DIR=/opt/saba
DATA_DIR=/var/lib/saba
UNIT=/etc/systemd/system/saba.service
PORT="${SABA_PORT:-8080}"

say() { printf '\n  %s\n' "$*"; }
die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

command -v node >/dev/null 2>&1 || die \
  "Node is not installed. Install Node 22.5 or newer, then run this again."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  die "Node $(node -v) is too old. Saba needs 22.5 or newer."
fi

command -v systemctl >/dev/null 2>&1 || die \
  "This installer is for systemd machines. For anything else, see docs/DEPLOYMENT.md."

say "Installing Saba to $APP_DIR"

# --- a user that owns nothing else -----------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
  say "Created the $APP_USER system user"
fi

# --- the application -------------------------------------------------------
mkdir -p "$APP_DIR" "$DATA_DIR"
# Everything except the data directory is replaced on an upgrade; the
# database is never touched by this script.
for part in server app tools docs package.json README.md LICENSE.txt; do
  [ -e "$part" ] && cp -R "$part" "$APP_DIR/"
done
chown -R root:root "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# --- the service -----------------------------------------------------------
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Saba POS — billing and kitchen order management
Documentation=file://$APP_DIR/docs/DEPLOYMENT.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env node server/main.js
Environment=NODE_ENV=production
Environment=SABA_DATA_DIR=$DATA_DIR
Environment=SABA_PORT=$PORT
EnvironmentFile=-/etc/saba.env

# A restaurant does not restart its own till. If this falls over mid-service
# it comes straight back, and systemd keeps the journal of why.
Restart=always
RestartSec=2

# Give in-flight writes a moment to commit before SIGKILL.
KillSignal=SIGTERM
TimeoutStopSec=15

# A till is not a general-purpose computer.
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNITEOF

# --- a nightly backup ------------------------------------------------------
cat > /etc/systemd/system/saba-backup.service <<'BKEOF'
[Unit]
Description=Saba POS — nightly backup
[Service]
Type=oneshot
User=saba
WorkingDirectory=/opt/saba
Environment=SABA_DATA_DIR=/var/lib/saba
ExecStart=/usr/bin/env node tools/backup.mjs
BKEOF

cat > /etc/systemd/system/saba-backup.timer <<'TMEOF'
[Unit]
Description=Saba POS — nightly backup
[Timer]
# Half past four in the morning: after the latest a kitchen closes, before
# the business day rolls over at five.
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
TMEOF

systemctl daemon-reload
systemctl enable --now saba.service >/dev/null 2>&1
systemctl enable --now saba-backup.timer >/dev/null 2>&1

sleep 3

if ! systemctl is-active --quiet saba.service; then
  say "Saba did not start. The reason will be in:"
  say "    journalctl -u saba -n 50"
  exit 1
fi

ADDRESS=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$ADDRESS" ] && ADDRESS=localhost

cat <<DONE

  ────────────────────────────────────────────────────────────────
   Saba is installed and running.

   On this computer       http://localhost:$PORT
   On the tablets         http://$ADDRESS:$PORT

   The manager PIN for this install was printed once, at first start:

       journalctl -u saba | grep PIN

   Useful afterwards:
       systemctl status saba        is it running
       journalctl -u saba -f        watch it
       systemctl restart saba       restart it

   To add an off-site copy in Supabase, put SABA_SUPABASE_URL and
   SABA_SUPABASE_KEY in /etc/saba.env and restart. See docs/CLOUD-SYNC.md.

   The database is one file: $DATA_DIR/saba.db
   It is backed up nightly at 04:30 into $DATA_DIR/backups.
   Copy that directory somewhere that is not this computer.
  ────────────────────────────────────────────────────────────────

DONE
