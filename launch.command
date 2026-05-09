#!/bin/bash
# AI Book Editor — Mac launcher (top-level).
# Mirrors launch.bat for Mac users. Double-click in Finder to run.
# First-time only: in Terminal, run `chmod +x launch.command` once.

cd "$(cd "$(dirname "$0")" && pwd)"

clear
echo "============================================"
echo "   AI Book Editor"
echo "============================================"
echo ""

# Pause-on-exit so a Finder double-click leaves errors visible
abort() {
    echo ""
    echo "[ABORT] Setup did not complete. Read the message above."
    echo ""
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
}

# ── Homebrew (only if Node is missing — Homebrew is the easiest Node installer) ──
if ! command -v node &>/dev/null; then
    if ! command -v brew &>/dev/null; then
        echo "[INSTALL] Homebrew not found. Installing (you'll be asked for your password)..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || abort
        if [ -x /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -x /usr/local/bin/brew ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
        echo "[OK] Homebrew installed."
    fi
fi

# ── Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "[INSTALL] Node.js not found. Installing via Homebrew..."
    brew install node || abort
    echo "[OK] Node.js installed."
else
    echo "[OK] Node.js $(node --version) found."
fi

# ── npm ────────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    echo "[ERROR] npm is not installed."
    abort
fi
echo "[OK] npm found."

# ── Claude Code CLI ────────────────────────────────────────────────────────
if ! command -v claude &>/dev/null; then
    echo "[INSTALL] Claude Code CLI not found. Installing globally..."
    npm install -g @anthropic-ai/claude-code || abort
    echo "[OK] Claude Code CLI installed."
else
    CLAUDE_VER=$(claude --version 2>/dev/null || echo "unknown")
    echo "[OK] Claude Code CLI found ($CLAUDE_VER)."
fi

# Auth is handled by the app itself: the homepage shows a Sign In button if
# Claude Code is installed but not authenticated.

echo ""

# ── Paths ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(pwd)/Scripts_Code"
SERVER_DIR="$SCRIPT_DIR/server"
CLIENT_DIR="$SCRIPT_DIR/client"

# ── Server deps ────────────────────────────────────────────────────────────
if [ ! -d "$SERVER_DIR/node_modules" ]; then
    echo "[INSTALL] Installing server dependencies..."
    (cd "$SERVER_DIR" && npm install) || abort
    echo "[OK] Server dependencies installed."
else
    echo "[OK] Server dependencies already installed."
fi

# ── Client deps ────────────────────────────────────────────────────────────
if [ ! -d "$CLIENT_DIR/node_modules" ]; then
    echo "[INSTALL] Installing client dependencies..."
    (cd "$CLIENT_DIR" && npm install) || abort
    echo "[OK] Client dependencies installed."
else
    echo "[OK] Client dependencies already installed."
fi

echo ""
echo "[START] Launching server on http://localhost:3001"
echo "[START] Launching client on http://localhost:5173"
echo ""

# Run both in background of this Terminal window. Closing the window kills both.
(cd "$SERVER_DIR" && npm run dev) &
SERVER_PID=$!

(cd "$CLIENT_DIR" && npm run dev) &
CLIENT_PID=$!

cleanup() {
    echo ""
    echo "[STOP] Shutting down server and client..."
    kill $SERVER_PID $CLIENT_PID 2>/dev/null
    exit 0
}
trap cleanup INT TERM EXIT

# Poll Vite until it responds, then open the browser
echo "[WAIT]  Waiting for Vite to be ready..."
for i in {1..60}; do
    if curl -s --max-time 1 http://127.0.0.1:5173 >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

echo "[READY] Vite is up — opening browser..."
open http://127.0.0.1:5173

echo ""
echo "        App running at: http://127.0.0.1:5173"
echo "        Press Ctrl+C in this window to stop both processes."
echo "        If Claude Code is not signed in, click \"Sign In\" on the homepage."
echo ""

wait
