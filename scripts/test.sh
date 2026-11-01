#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 scripts/test_storage.py
(cd backend && ../.venv/bin/python -m pytest -q)
npm test --prefix frontend
npm run build --prefix frontend
