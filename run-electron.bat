@echo off
setlocal EnableExtensions

set "APP_NAME=GreyNOC Port Manager"
set "MIN_NODE_MAJOR=18"

cd /d "%~dp0" || (
  echo Could not switch to the launcher folder.
  echo.
  pause
  exit /b 1
)

title %APP_NAME% Launcher

echo.
echo ========================================
echo   GreyNOC Port Manager
echo   Desktop Launcher
echo ========================================
echo.
echo Project: %CD%
echo.

call :require_command node "Node.js was not found." "Install Node.js 18 or newer from https://nodejs.org/"
if errorlevel 1 exit /b 1

call :require_command npm "npm was not found." "Reinstall Node.js and make sure npm is included."
if errorlevel 1 exit /b 1

call :check_node_version
if errorlevel 1 exit /b 1

if not exist package.json (
  echo package.json was not found.
  echo Make sure this file is inside the GreyNOC Port Manager project folder.
  echo.
  pause
  exit /b 1
)

if not exist electron\main.js (
  echo electron\main.js was not found.
  echo This does not look like a complete GreyNOC Port Manager checkout.
  echo.
  pause
  exit /b 1
)

if not exist public\index.html (
  echo public\index.html was not found.
  echo This does not look like a complete GreyNOC Port Manager checkout.
  echo.
  pause
  exit /b 1
)

call :ensure_dependencies
if errorlevel 1 exit /b 1

call :ensure_cli_shim

echo Starting %APP_NAME%...
echo.
call npm run desktop
if errorlevel 1 goto run_failed

exit /b 0

:require_command
where %~1 >nul 2>nul
if errorlevel 1 (
  echo %~2
  echo %~3
  echo.
  pause
  exit /b 1
)
exit /b 0

:check_node_version
set "NODE_MAJOR="
set "NODE_VERSION="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VERSION=%%v"
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"

if not defined NODE_MAJOR (
  echo Could not read the installed Node.js version.
  echo.
  pause
  exit /b 1
)

if %NODE_MAJOR% LSS %MIN_NODE_MAJOR% (
  echo Node.js %NODE_VERSION% is installed, but %APP_NAME% requires Node.js %MIN_NODE_MAJOR% or newer.
  echo Install a newer Node.js version from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Node.js %NODE_VERSION% detected.
exit /b 0

:ensure_dependencies
if exist node_modules\.bin\electron.cmd exit /b 0

if exist node_modules\ (
  echo Electron was not found in node_modules.
  echo Repairing dependencies with npm install...
) else (
  echo Dependencies are not installed yet.
  echo Running npm install...
)
echo.

call npm install
if errorlevel 1 goto install_failed

if not exist node_modules\.bin\electron.cmd (
  echo.
  echo Electron is still missing after npm install.
  echo Try deleting node_modules and running npm install manually.
  echo.
  pause
  exit /b 1
)

exit /b 0

:ensure_cli_shim
where GNP >nul 2>nul
if not errorlevel 1 exit /b 0

echo Installing optional GNP terminal command for this checkout...
echo.
call npm run install-cli
if errorlevel 1 (
  echo.
  echo Optional GNP command install failed.
  echo The desktop app will still launch. You can retry later with:
  echo   npm run install-cli
  echo.
  exit /b 0
)

echo Optional GNP command installed.
echo Open a new terminal if GNP is still not recognized.
echo.
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
echo %APP_NAME% stopped or failed to launch.
echo Try running this manually from the project folder:
echo   npm run desktop
echo.
pause
exit /b 1
