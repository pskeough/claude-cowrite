@echo off
echo Starting AI Book Editor...
echo.

:: Check for Claude Code CLI
where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Claude Code CLI not found. Installing globally...
    call npm install -g @anthropic-ai/claude-code
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to install Claude Code. Please install manually:
        echo   npm install -g @anthropic-ai/claude-code
        pause
        exit /b 1
    )
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
echo If Claude Code is not signed in, click "Sign In" on the homepage.
echo.

start "Book Editor Server" cmd /c "cd server && npm run dev"
start "Book Editor Client" cmd /c "cd client && npm run dev"

echo Both processes started. Close the terminal windows to stop.
