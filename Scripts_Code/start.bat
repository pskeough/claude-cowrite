@echo off
echo Starting Basilisk Editor...
echo.

:: Check for Gemini CLI
where gemini >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Gemini CLI not found. Installing globally...
    call npm install -g @google/gemini-cli
    echo Opening Gemini authentication...
    call gemini login
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

start "Basilisk Server" cmd /c "cd server && npm run dev"
start "Basilisk Client" cmd /c "cd client && npm run dev"

echo Both processes started. Close the terminal windows to stop.
