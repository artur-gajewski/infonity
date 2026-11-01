# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm test && npm run build

FROM python:3.12-slim-bookworm AS backend-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/app /app/backend/app
RUN python -m pip install "/app/backend[speech]"
RUN python -c "from faster_whisper.utils import download_model; download_model('small.en', output_dir='/app/speech-model')"
# Verify the native extension matches the container architecture before shipping.
RUN python -c "import sqlite3, sqlite_vec; db = sqlite3.connect(':memory:'); db.enable_load_extension(True); sqlite_vec.load(db); db.execute('SELECT vec_version()').fetchone(); db.close()"

FROM backend-base AS backend-test
COPY backend/tests /app/backend/tests
RUN python -m pip install '/app/backend[test]'
WORKDIR /app/backend
RUN python -m pytest -q

FROM backend-base AS runtime
RUN groupadd --gid 10001 still && useradd --uid 10001 --gid still --no-create-home still \
    && mkdir -p /app/data && chown still:still /app/data && chmod 700 /app/data
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist
COPY scripts/backup.py /app/scripts/backup.py
ENV LOCAL_AI_DATABASE=/app/data/personal-ai.sqlite3 LOCAL_AI_SPEECH_MODEL=/app/speech-model HF_HUB_OFFLINE=1
USER still
EXPOSE 18473
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18473/api/conversations', timeout=3).close()"
CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", "--app-dir", "/app/backend", "--host", "127.0.0.1", "--port", "18473", "--no-access-log"]
