@echo off
setlocal EnableDelayedExpansion

title AI Book Editor — Launcher

echo ============================================
echo   AI Book Editor
echo ============================================
echo.

:: ---------- Node.js ----------
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% found.

:: ---------- npm ----------
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)
echo [OK] npm found.

:: ---------- Claude Code CLI ----------
where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INSTALL] Claude Code CLI is not installed. Installing globally...
    call npm install -g @anthropic-ai/claude-code
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] Failed to install Claude Code CLI.
        echo         Try running this script as administrator, or install manually:
        echo         npm install -g @anthropic-ai/claude-code
        pause
        exit /b 1
    )
    echo [OK] Claude Code CLI installed.
) else (
    for /f "tokens=*" %%v in ('claude --version 2^>nul') do set CLAUDE_VER=%%v
    echo [OK] Claude Code CLI found ^(!CLAUDE_VER!^).
)

:: Auth check is performed by the app itself once it starts; the homepage
:: shows a Sign In button if Claude Code is installed but not authenticated.

echo.

:: ---------- Paths ----------
set SCRIPT_DIR=%~dp0Scripts_Code
set SERVER_DIR=%SCRIPT_DIR%\server
set CLIENT_DIR=%SCRIPT_DIR%\client

:: ---------- Server deps ----------
if not exist "%SERVER_DIR%\node_modules" (
    echo [INSTALL] Installing server dependencies...
    pushd "%SERVER_DIR%"
    call npm install
    if !ERRORLEVEL! NEQ 0 (
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

:: ---------- Client deps ----------
if not exist "%CLIENT_DIR%\node_modules" (
    echo [INSTALL] Installing client dependencies...
    pushd "%CLIENT_DIR%"
    call npm install
    if !ERRORLEVEL! NEQ 0 (
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

start "Book Editor — Server" cmd /k "cd /d "%SERVER_DIR%" && npm run dev"
timeout /t 2 /nobreak >nul
start "Book Editor — Client" cmd /k "cd /d "%CLIENT_DIR%" && npm run dev"

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
echo         If Claude Code is not signed in, click "Sign In" on the homepage.
echo.
pause
