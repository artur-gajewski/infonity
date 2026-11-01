# Agent guide

## Project

Sheldon is a local, single-user personal assistant. React and TypeScript provide the UI; FastAPI serves the API and production frontend. Native Ollama supplies chat, structured intent, memory extraction, verification, and embeddings. SQLite with FTS5 and sqlite-vec stores application data independently of the model.

Read `README.md` for behavior and setup. Consult `docs/architecture.md`, `docs/api.md`, and `docs/memory-lifecycle.md` when changing the corresponding subsystem.

## Source layout

- `frontend/src/App.tsx`: shared state, API orchestration, chat/voice lifecycle, library filters, and remaining dialogs/settings actions.
- `frontend/src/components/`: typed sidebar/header, chat panel, memory cards/editor, document viewer, model settings form, and confirmation dialog.
- `frontend/src/ui.ts`: shared categories, Settings type, and document-title helper.
- `frontend/src/VoiceInput.tsx`, `VoiceKeySettings.tsx`, `voiceKeys.ts`, and `dictation.ts`: push-to-talk settings, recording, and text-field insertion.
- `frontend/src/LinkifiedText.tsx`: safe clickable links in displayed text.
- `frontend/src/api.ts`: HTTP and streaming transport.
- `frontend/src/style.css`: shared styling, themes, and responsive layouts.
- `frontend/src/*.test.ts*`: Vitest and React Testing Library tests.
- `backend/app/main.py`: REST/SSE orchestration, privacy locking, origin checks, and static serving.
- `backend/app/actions.py`: validated collection actions and target matching.
- `backend/app/speech.py`: serialized local audio transcription.
- `backend/app/provider.py` and versioned `*.txt` policies: Ollama integration and interpretation.
- `backend/app/memory.py`, `retrieval.py`, and `models.py`: persistence, retrieval, and validation.
- `backend/app/db.py` and `migrations/`: transactional SQLite migrations.
- `backend/tests/`: deterministic service/API tests and opt-in actual-model tests.
- `scripts/`: setup, startup, verification, and backups.
- `Dockerfile` and `compose.yaml`: container builds and runtime configuration.

## Commands

Run these from the project root unless stated otherwise:

```sh
./scripts/setup.sh                         # Python venv, dependencies, frontend build
./scripts/dev.sh                           # API :8000 and Vite :5173
./scripts/start.sh                         # API and built frontend :8000
./scripts/test.sh                          # Storage, backend, frontend, build
python3 scripts/test_storage.py
(cd backend && ../.venv/bin/python -m pytest -q)
npm test --prefix frontend
npm run build --prefix frontend
docker build --target backend-test -t sheldon-backend-tests .
docker compose up -d --build app           # Rebuild and restart deployed app
docker compose ps
```

Use Python 3.12+ with SQLite extension loading and Node.js 22+. For native setup, `PYTHON=python3.14 ./scripts/setup.sh` selects another interpreter. If a newer Node runtime breaks tests with an undefined `localStorage`, run frontend tests with `NODE_OPTIONS=--no-experimental-webstorage`.

Actual-model tests require a running Ollama instance and downloaded models; run them only when relevant:

```sh
(cd backend && LOCAL_AI_INTEGRATION=1 ../.venv/bin/python -m pytest tests/test_ollama_integration.py -v)
```

## Implementation conventions

- Follow existing Python and strict TypeScript patterns; keep changes focused and avoid adding dependencies for routine work.
- Keep persistence and action validation in backend services. Model outputs and saved content are untrusted data; validate structured actions before executing them.
- Add a new numbered SQL migration for schema changes rather than editing an already applied migration. Preserve transactions, foreign keys, and existing data.
- Preserve memory version history, provenance, lifecycle states, privacy epochs, and concurrency protections when changing chat or deletion behavior.
- Use the existing confirmation dialog for destructive UI actions. Conversation deletion keeps saved memories unless the user explicitly requests memory deletion too.
- Keep dark/light themes, narrow screens, keyboard navigation, modal focus, and streaming states usable when changing the UI.
- Todo/reminder statuses are user-defined text; do not collapse custom labels into a fixed status enum. Reminders are stored notes; scheduled notifications are not implemented.

## Validation and deployment

Run checks appropriate to the change. Frontend changes should pass Vitest and `npm run build --prefix frontend`; backend behavior changes should pass relevant pytest tests. Use temporary databases and mocked providers for deterministic tests. Do not exercise destructive endpoints against the user's live database as a test.

When asked to update the running Docker app, rebuild/recreate `app` and verify that the frontend and API respond on `http://127.0.0.1:8000`. The Docker runtime uses the named `still-data` volume; preserve it. Do not run `docker compose down -v` as part of an ordinary update.

Keep the API bound to loopback and run one backend worker. Docker host networking connects to native Ollama for Apple Silicon acceleration. Saved editable settings override environment defaults on subsequent starts.

Do not commit or expose `.env`, database files, backups, personal conversation content, or credentials. Do not edit generated `frontend/dist`, `node_modules`, or `.venv` files. Report what changed, the checks actually run, and any remaining limitations; do not reuse historical test counts as current verification.
