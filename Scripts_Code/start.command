#!/bin/bash
# All-in-one Mac launcher for Basilisk Editor.
# Bootstraps Homebrew, Node.js, Claude CLI, and project dependencies on first run.
# Double-click in Finder to launch.
# First-time only: in Terminal, run `chmod +x start.command` once.

cd "$(cd "$(dirname "$0")" && pwd)"

# Pause-on-exit so a Finder double-click leaves the error visible
error_pause() {
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  Setup did not complete. Read the message above."
  echo "════════════════════════════════════════════════════════════"
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
}
trap 'error_pause' ERR

clear
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              BASILISK EDITOR — MAC LAUNCHER                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Homebrew ─────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
    echo "[1/5] Homebrew not found — installing now."
    echo "      You will be prompted for your Mac password."
    echo ""
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for this session (Apple Silicon → /opt/homebrew, Intel → /usr/local)
    if [ -x /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    echo ""
    echo "  ✓ Homebrew installed."
else
    echo "[1/5] ✓ Homebrew already installed."
fi
echo ""

# ── 2. Node.js ──────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "[2/5] Node.js not found — installing via Homebrew."
    brew install node
    echo "  ✓ Node.js installed."
else
    echo "[2/5] ✓ Node.js already installed ($(node -v))."
fi
echo ""

# ── 3. Claude CLI ───────────────────────────────────────────────────────────
if ! command -v claude &>/dev/null; then
    echo "[3/5] Claude CLI not found — installing globally via npm."
    npm install -g @anthropic-ai/claude-code
    echo "  ✓ Claude CLI installed."
else
    echo "[3/5] ✓ Claude CLI already installed."
fi
echo ""

# ── 4. Claude login (only on first run, ~/.claude doesn't exist yet) ────────
if [ ! -d "$HOME/.claude" ]; then
    echo "[4/5] Claude needs to be logged in (first-time setup)."
    echo ""
    echo "      A browser window will open for Anthropic login."
    echo "      After logging in, return to this Terminal,"
    echo "      type  /exit  and press Enter to continue."
    echo ""
    read -n 1 -s -r -p "      Press any key to start the login flow..."
    echo ""
    echo ""
    claude
    echo ""
    echo "  ✓ Claude login complete."
else
    echo "[4/5] ✓ Claude already configured."
fi
echo ""

# ── 5. Project dependencies ─────────────────────────────────────────────────
if [ ! -d "server/node_modules" ]; then
    echo "[5/5] Installing server dependencies (first run only)..."
    (cd server && npm install)
fi
if [ ! -d "client/node_modules" ]; then
    echo "      Installing client dependencies (first run only)..."
    (cd client && npm install)
fi
echo "[5/5] ✓ Project dependencies ready."
echo ""

# Disable error trap — server/client dev servers can exit non-zero on shutdown
trap - ERR

# ── Launch ──────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════"
echo "  Starting Basilisk Editor"
echo "    server:  http://localhost:3001"
echo "    client:  http://localhost:5173"
echo ""
echo "  Press Ctrl+C in this window to stop."
echo "════════════════════════════════════════════════════════════"
echo ""

(cd server && npm run dev) &
SERVER_PID=$!

(cd client && npm run dev) &
CLIENT_PID=$!

trap "echo ''; echo 'Shutting down...'; kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit 0" INT TERM

sleep 4
open http://localhost:5173

wait
