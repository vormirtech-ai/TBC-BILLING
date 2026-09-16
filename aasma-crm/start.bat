@echo off
REM  Aasma Buildcon CRM - start the desktop application (Windows)
setlocal enabledelayedexpansion
title Aasma Buildcon CRM
cd /d "%~dp0"

call :find_node
if not defined NODE_DIR goto no_node

if not exist "node_modules" (
  echo   Components are not installed yet. Run setup.bat first.
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo   Building the application for the first time...
  call npm run build
  if errorlevel 1 (
    echo   The build did not finish. Run setup.bat again.
    pause
    exit /b 1
  )
)

call npm start
exit /b 0

:find_node
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
) do (
  if exist "%%~d\node.exe" (
    set "NODE_DIR=%%~d"
    set "PATH=%%~d;!PATH!"
    goto :eof
  )
)
goto :eof

:no_node
echo.
echo   Node.js was not found. Run setup.bat - it explains what to install.
echo   If you just installed Node.js, close this window and try again.
echo.
pause
exit /b 1
