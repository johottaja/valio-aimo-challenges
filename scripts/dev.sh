#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
if [ ! -f data/catalog.db ]; then
  echo "Import the challenge catalog first. See README.md."
  exit 1
fi
if [ ! -x backend/.venv/bin/python ] || [ ! -d frontend/node_modules ]; then
  echo "Install backend and frontend dependencies first. See README.md."
  exit 1
fi
cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}
(cd backend && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000) &
API_PID=$!
(cd frontend && exec npm run dev) &
WEB_PID=$!
trap cleanup EXIT INT TERM
wait "$API_PID" "$WEB_PID"
