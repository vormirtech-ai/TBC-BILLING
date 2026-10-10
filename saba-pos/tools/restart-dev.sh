#!/bin/sh
# Restart the development server on a fresh demonstration database.
#   tools/restart-dev.sh [port]
PORT="${1:-8431}"
PID=$(ss -lptnH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
[ -n "$PID" ] && kill "$PID" 2>/dev/null && sleep 1
rm -rf data
setsid env SABA_SEED_DEMO=1 SABA_SETUP_PIN=1379 SABA_PORT="$PORT" \
  node server/main.js > /tmp/saba-dev.log 2>&1 < /dev/null &
sleep 8
grep -E "earlier service|is running" /tmp/saba-dev.log
