@echo off
REM ---------------------------------------------------------------
REM  Aasma Buildcon CRM - first-time setup (Windows)
REM  Run this once. It needs an internet connection only for this
REM  step; the application itself runs completely offline afterwards.
REM ---------------------------------------------------------------
title Aasma Buildcon CRM - Setup
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Install the LTS version from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Installing components. This takes a few minutes the first time...
echo.
call npm install
if errorlevel 1 goto failed

echo.
echo   Preparing the local database...
call npm run db:push
if errorlevel 1 goto failed

echo.
set /p SEED=  Load sample demo data so the screens are not empty? (y/n):
if /i "%SEED%"=="y" call npm run db:seed

echo.
echo   Building the application...
call npm run build
if errorlevel 1 goto failed

echo.
echo   ================================================
echo    Setup complete. Double-click start.bat to open
echo    Aasma Buildcon CRM.
echo.
echo    Username: admin
echo    Password: admin@123
echo   ================================================
echo.
pause
exit /b 0

:failed
echo.
echo   Setup did not finish. Check the messages above and try again.
echo.
pause
exit /b 1
