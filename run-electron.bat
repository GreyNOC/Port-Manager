@echo off
setlocal

cd /d "%~dp0"
title GreyNOC Port Manager

echo.
echo ========================================
echo   GreyNOC Port Manager - Electron
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 18 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  echo Reinstall Node.js and make sure npm is included.
  echo.
  pause
  exit /b 1
)

if not exist package.json (
  echo package.json was not found.
  echo Make sure this file is inside the GreyNOC Port Manager project folder.
  echo.
  pause
  exit /b 1
)

if not exist node_modules\ (
  echo Dependencies are not installed yet.
  echo Running npm install...
  echo.
  call npm install
  if errorlevel 1 goto install_failed
)

if not exist node_modules\.bin\electron.cmd (
  echo Electron was not found in node_modules.
  echo Repairing dependencies with npm install...
  echo.
  call npm install
  if errorlevel 1 goto install_failed
)

echo Starting GreyNOC Port Manager...
echo.
call npm start
if errorlevel 1 goto run_failed

exit /b 0

:install_failed
echo.
echo Dependency install failed.
echo Try running this manually from the project folder:
echo   npm install
echo.
pause
exit /b 1

:run_failed
echo.
echo GreyNOC Port Manager stopped or failed to launch.
echo Try running this manually from the project folder:
echo   npm start
echo.
pause
exit /b 1
