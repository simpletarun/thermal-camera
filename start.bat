@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required but was not found in PATH.
  pause
  exit /b 1
)

if not exist "node_modules\next\package.json" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting ThermalVision at http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.
call "node_modules\.bin\next.cmd" dev -p 3000

endlocal
