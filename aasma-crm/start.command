#!/bin/bash
# Aasma Buildcon CRM - start the desktop application (macOS / Linux)
cd "$(dirname "$0")" || exit 1

if [ ! -d node_modules ]; then
  echo "Components are not installed yet. Running npm install..."
  npm install || exit 1
  npm run db:push || exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "Building the application for the first time..."
  npm run build || exit 1
fi

npm start
