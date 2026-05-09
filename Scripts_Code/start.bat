@echo off
cd /d "%~dp0"
echo Starting Basilisk Editor...
echo.

:: Check for Claude CLI (required)
where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Claude CLI not found. Install it from https://claude.ai/code
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo Installing server dependencies...
    cd server
    call npm install
    cd ..
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    call npm install
    cd ..
)

echo.
echo Starting server on http://localhost:3001
echo Starting client on http://localhost:5173
echo.

start "Basilisk Server" cmd /k "cd /d "%~dp0server" && npm run dev"
start "Basilisk Client" cmd /k "cd /d "%~dp0client" && npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5173

echo Browser opened. Close the server and client windows to stop.
