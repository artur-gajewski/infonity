#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
PYTHON=${PYTHON:-python3.12}
"$PYTHON" -c 'import sys; assert sys.version_info >= (3,12), "Python 3.12+ required"'
"$PYTHON" -m venv .venv
.venv/bin/python -m pip install -e './backend[test]'
npm ci --prefix frontend
npm run build --prefix frontend
if [ ! -f .env ]; then cp .env.example .env; fi
printf '\nInstalled. Start Ollama, pull your configured models, then run ./scripts/start.sh\n'
