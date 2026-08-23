#!/bin/sh
# Double-click (macOS) or run (Linux) to open the billing counter.
# Opening index.html directly does not work — browsers block JavaScript modules
# and data storage on file:// pages. This serves it from http://localhost:8000.

cd "$(dirname "$0")" || exit 1
PORT=8000

echo ""
echo "  The Baruch Cafe - Billing Counter"
echo "  ---------------------------------"
echo ""

open_browser() {
  sleep 1
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"
  fi
}

if command -v python3 >/dev/null 2>&1; then
  echo "  Starting on http://localhost:$PORT"
  open_browser &
  python3 -m http.server "$PORT"
elif command -v node >/dev/null 2>&1; then
  echo "  Starting on http://localhost:$PORT"
  open_browser &
  node serve.js "$PORT"
else
  echo "  Neither Python 3 nor Node.js was found."
  echo "  Install one of them, or host the app on GitHub Pages (see README.md)."
  echo ""
  read -r _
fi
