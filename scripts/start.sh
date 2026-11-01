#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then printf 'Run ./scripts/setup.sh first.\n' >&2; exit 1; fi
if [ ! -d frontend/dist ]; then npm run build --prefix frontend; fi
exec .venv/bin/python -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
