#!/bin/bash
# Start both server and client for the Basilisk Editor
# Run from Scripts_Code/ directory

echo "Starting Basilisk Editor..."
echo ""

# Check for Gemini CLI
if ! command -v gemini &> /dev/null; then
    echo "Gemini CLI not found. Installing globally..."
    npm install -g @google/gemini-cli
    echo "Opening Gemini authentication..."
    gemini login
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

# Start both in parallel
(cd server && npm run dev) &
SERVER_PID=$!

(cd client && npm run dev) &
CLIENT_PID=$!

# Trap Ctrl+C to kill both
trap "kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT TERM

wait
