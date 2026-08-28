@echo off
REM  Aasma Buildcon CRM - start the desktop application (Windows)
title Aasma Buildcon CRM
cd /d "%~dp0"

if not exist "node_modules" (
  echo   Components are not installed yet. Run setup.bat first.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo   Building the application for the first time...
  call npm run build
)

call npm start
