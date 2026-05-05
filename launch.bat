@echo off
setlocal EnableDelayedExpansion

title Basilisk Editor — Launcher

echo ============================================
echo   AI Book Editor — Basilisk Editor
echo ============================================
echo.

:: Check for Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% found.

:: Check for npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)

echo [OK] npm found.

:: Check for Gemini CLI
where gemini >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INSTALL] Gemini CLI is not installed. Installing globally...
    call npm install -g @google/gemini-cli
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install Gemini CLI.
        pause
        exit /b 1
    )
    echo [INFO] Please sign in to authorize Gemini CLI...
    call gemini login
    echo [OK] Gemini CLI is ready.
) else (
    echo [OK] Gemini CLI found.
)

echo.

:: Set paths
set SCRIPT_DIR=%~dp0Scripts_Code
set SERVER_DIR=%SCRIPT_DIR%\server
set CLIENT_DIR=%SCRIPT_DIR%\client

:: Install server dependencies
if not exist "%SERVER_DIR%\node_modules" (
    echo [INSTALL] Installing server dependencies...
    pushd "%SERVER_DIR%"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Server npm install failed.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] Server dependencies installed.
) else (
    echo [OK] Server dependencies already installed.
)

:: Install client dependencies
if not exist "%CLIENT_DIR%\node_modules" (
    echo [INSTALL] Installing client dependencies...
    pushd "%CLIENT_DIR%"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Client npm install failed.
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] Client dependencies installed.
) else (
    echo [OK] Client dependencies already installed.
)

echo.
echo [START] Launching server on http://localhost:3001
echo [START] Launching client on http://localhost:5173
echo.

:: Start server in its own window
start "Basilisk — Server" cmd /k "cd /d "%SERVER_DIR%" && npm run dev"

:: Brief pause so server can begin initializing
timeout /t 2 /nobreak >nul

:: Start client in its own window
start "Basilisk — Client" cmd /k "cd /d "%CLIENT_DIR%" && npm run dev"

:: Poll until Vite HTTP server is actually responding
echo [WAIT]  Waiting for Vite to be ready...
:poll_vite
curl -s --max-time 1 http://127.0.0.1:5173 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    timeout /t 1 /nobreak >nul
    goto poll_vite
)

echo [READY] Vite is up — opening browser...
start "" "http://127.0.0.1:5173"

echo.
echo         App running at: http://127.0.0.1:5173
echo         Close the Server and Client terminal windows to stop.
echo.
pause
