#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
.venv/bin/python -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000 --reload --no-access-log &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT INT TERM
npm run dev --prefix frontend
