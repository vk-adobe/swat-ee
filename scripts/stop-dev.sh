#!/usr/bin/env bash
set -euo pipefail
echo "Stopping frontend and backend processes (vite, index.js)"
pkill -f "node .*vite" || true
pkill -f "node .*index.js" || true
echo "Stopped."
