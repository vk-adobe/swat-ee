#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

# Start backend only
if [ "$#" -eq 0 ] || [ "$1" = "backend" ]; then
  echo "Starting backend (logs -> /tmp/backend.log)"
  pkill -f "node .*index.js" || true
  sleep 0.5
  nohup node "$ROOT_DIR/backend/index.js" > /tmp/backend.log 2>&1 &
  echo "backend pid: $!"
fi

# Start frontend only
if [ "$#" -eq 0 ] || [ "$1" = "frontend" ]; then
  echo "Starting frontend (logs -> /tmp/frontend.log)"
  pkill -f "node .*vite" || true
  sleep 0.5
  nohup npm run dev --prefix "$ROOT_DIR/frontend" -- --host 127.0.0.1 --port 5173 --strictPort > /tmp/frontend.log 2>&1 &
  echo "frontend pid: $!"
fi

echo "Done. Use 'tail -f /tmp/frontend.log /tmp/backend.log' to watch logs."
