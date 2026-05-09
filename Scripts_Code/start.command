#!/bin/bash
# Mac launcher for Basilisk Editor — double-click in Finder to run.
# First-time setup: in Terminal, run `chmod +x start.command` once.

set -e
cd "$(cd "$(dirname "$0")" && pwd)"

echo "Starting Basilisk Editor..."
echo ""

# Check for Claude CLI (required)
if ! command -v claude &> /dev/null; then
    echo "ERROR: Claude CLI not found."
    echo "Install it from https://claude.ai/code"
    echo ""
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found."
    echo "Install it from https://nodejs.org/"
    echo ""
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

# Install dependencies if needed
if [ ! -d "server/node_modules" ]; then
    echo "Installing server dependencies..."
    (cd server && npm install)
fi

if [ ! -d "client/node_modules" ]; then
    echo "Installing client dependencies..."
    (cd client && npm install)
fi

echo ""
echo "Starting server on http://localhost:3001"
echo "Starting client on http://localhost:5173"
echo ""

# Start both processes in the background
(cd server && npm run dev) &
SERVER_PID=$!

(cd client && npm run dev) &
CLIENT_PID=$!

# Trap Ctrl+C and window close to kill both children
trap "echo ''; echo 'Shutting down...'; kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT TERM EXIT

# Wait briefly for client to bind, then open the browser
sleep 3
open http://localhost:5173

echo ""
echo "Browser opened. Press Ctrl+C in this window to stop both processes."
echo ""

wait
