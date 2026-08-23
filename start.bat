@echo off
setlocal
title The Baruch Cafe POS

REM ---------------------------------------------------------------------------
REM  Double-click this file to open the billing counter.
REM
REM  Opening index.html directly does not work: browsers block a page loaded
REM  from file:// from using JavaScript modules and from saving data. This
REM  starts a small local address (http://localhost:8000) instead.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"
set PORT=8000

echo.
echo   The Baruch Cafe - Billing Counter
echo   ---------------------------------
echo.

REM --- Try Python first (usually already on the machine) ----------------------
where py >nul 2>nul
if %errorlevel%==0 (
  echo   Starting on http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  py -m http.server %PORT%
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo   Starting on http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  python -m http.server %PORT%
  goto :end
)

REM --- Then Node -------------------------------------------------------------
where node >nul 2>nul
if %errorlevel%==0 (
  echo   Starting on http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  node serve.js %PORT%
  goto :end
)

REM --- Neither is installed --------------------------------------------------
echo   Neither Python nor Node.js was found on this computer.
echo.
echo   You have two options:
echo.
echo     1. Install Python from https://python.org/downloads
echo        (tick "Add python.exe to PATH" during setup),
echo        then double-click this file again.
echo.
echo     2. Better for a real cafe: put the app on GitHub Pages and
echo        open it as a normal website. See README.md.
echo.
pause

:end
endlocal
