#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "Refreshing AI cache..."
npm --prefix backend run refresh-ai-cache
echo "Done."
