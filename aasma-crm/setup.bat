@echo off
REM ---------------------------------------------------------------
REM  Aasma Buildcon CRM - first-time setup (Windows)
REM  Run this once. It needs an internet connection only for this
REM  step; the application itself runs completely offline afterwards.
REM ---------------------------------------------------------------
setlocal enabledelayedexpansion
title Aasma Buildcon CRM - Setup
cd /d "%~dp0"

call :find_node
if not defined NODE_DIR goto no_node

echo.
echo   Node.js found: %NODE_DIR%
for /f "delims=" %%v in ('node -v 2^>nul') do echo   Version:       %%v

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

REM ---------------------------------------------------------------
:find_node
REM Use whatever is on PATH first. If nothing is there, look in the
REM places the Windows installer actually puts Node - a Command Prompt
REM opened before Node was installed still carries the old PATH, which
REM is the usual reason "node" appears to be missing.
set "NODE_DIR="
for /f "delims=" %%p in ('where node 2^>nul') do (
  if not defined NODE_DIR set "NODE_DIR=%%~dpp"
)
if defined NODE_DIR goto :eof

for %%d in (
  "%ProgramFiles%\nodejs"
  "%ProgramFiles(x86)%\nodejs"
  "%LOCALAPPDATA%\Programs\nodejs"
  "%LOCALAPPDATA%\Volta\bin"
  "%APPDATA%\Local\Programs\nodejs"
) do (
  if exist "%%~d\node.exe" (
    set "NODE_DIR=%%~d"
    set "PATH=%%~d;!PATH!"
    goto :eof
  )
)
goto :eof

REM ---------------------------------------------------------------
:no_node
echo.
echo   ------------------------------------------------------------
echo    Node.js was not found on this computer.
echo   ------------------------------------------------------------
echo.
echo    If you have ALREADY installed Node.js:
echo      close this window completely and run setup.bat again.
echo      A window opened before the install still uses the old PATH.
echo.
echo    If you have NOT installed it yet, either:
echo      1. Download the LTS installer from  https://nodejs.org
echo         and accept every default, or
echo      2. Open Command Prompt and run:
echo         winget install OpenJS.NodeJS.LTS
echo.
echo    Then run setup.bat again.
echo.
echo    To check whether it worked, open a NEW Command Prompt
echo    and type:   node -v
echo    You should see something like  v22.11.0
echo.
pause
exit /b 1

REM ---------------------------------------------------------------
:failed
echo.
echo   Setup did not finish. Check the messages above and try again.
echo   If npm reported a network error, connect to the internet and
echo   run setup.bat once more.
echo.
pause
exit /b 1
