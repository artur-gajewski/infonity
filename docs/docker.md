# Docker on macOS / Apple Silicon

The image serves the Infonity UI and FastAPI together. SQLite uses a named volume. Ollama runs natively on the Mac; the application container connects to it through host networking.

## Start

1. Install Docker Desktop with host-network support (4.34+). Enable **Settings → Resources → Network → Enable host networking**, then apply/restart. Linux Docker Engine supports the same Compose networking without the Desktop opt-in.
2. Start native Ollama with cloud features disabled:

   ```sh
   ./scripts/start-ollama.sh
   ```

   Configure/restart an existing native service instead if it is already running.

3. Pull both models and start the app:

   ```sh
   ollama pull qwen3:4b
   ollama pull nomic-embed-text
   docker compose up --build -d
   ```

Open **http://127.0.0.1:18473**. No host Python or Node installation is needed. The container binds HTTP to loopback and connects to native Ollama at `127.0.0.1:11434`. There is no Compose `ports` mapping; `docker compose ps` may show an empty ports column. Port 18473 must be available.

The image installs the speech dependencies and downloads the faster-whisper `small.en` model to `/app/speech-model` during construction. Runtime uses `LOCAL_AI_SPEECH_MODEL=/app/speech-model` and `HF_HUB_OFFLINE=1`, so transcription runs locally on CPU without an Ollama speech model or Safari speech pack. Rebuild the image to pick up speech-model or dependency changes.

Builds download base images and dependencies; model pulls download weights. Once installed, runtime operation uses the local models and storage.

## Configuration and data

Compose forwards model names, memory limits, extraction settings/deadlines, sensitive-retrieval opt-in, and `LOCAL_AI_TIMEZONE`. The timezone defaults to `Europe/Helsinki` and supplies the current local date/calendar for questions such as “What date is next Friday?”

Editable settings saved in SQLite override their environment defaults on later starts. Timezone is environment configuration, not an editable Settings API field.

The existing `still-data` Compose volume and `still` runtime account (UID/GID 10001) retain their historical names for compatibility. The application is named Infonity; renaming its display name does not migrate or rename storage. Container data is separate from native `data/personal-ai.sqlite3`.

The runtime has a non-root user, read-only root filesystem, writable data volume, temporary `/tmp`, dropped capabilities, and one Uvicorn process. The healthcheck probes the local API independently of Ollama. Settings shows model availability.

Numbered migrations run on startup. Existing completed tasks migrate to status `done`; other tasks initially use `todo`. Categories, link titles, free-text status, and pending deletion requests persist in SQLite across container recreation.

The build context excludes installed dependencies, build outputs, databases, backups, `.env`, and Git metadata. The existing browser theme-storage key is retained; it does not store personal records.

## Manage and test

```sh
docker compose ps
docker compose logs --tail=50 app
docker compose down                # preserves the named data volume
docker compose up -d
docker compose up --build -d       # rebuild after source changes
docker build --target backend-test -t infonity-backend-tests .
```

Image construction runs frontend tests/build and loads sqlite-vec as a native-extension check. The backend-test target runs deterministic pytest tests. Actual Ollama behavior requires separate opt-in tests:

```sh
docker run --rm --network host \
  -e LOCAL_AI_INTEGRATION=1 \
  -e LOCAL_AI_MODEL=qwen3:4b \
  -e LOCAL_AI_EMBEDDING_MODEL=nomic-embed-text \
  infonity-backend-tests python -m pytest -v tests/test_ollama_integration.py
```

These integration tests use temporary databases; the production volume is not mounted into the test container. See [verification](verification.md) for recorded results and the latest tested selection.

## Troubleshooting

| Symptom                                                             | Check                                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Healthy container but UI cannot be reached                          | Confirm Desktop host networking is enabled; check port 18473 and application logs                                                                             |
| Container repeatedly restarts                                       | Read `docker compose logs --tail=50 app`; rebuild the current Dockerfile and inspect the startup failure                                                      |
| `wrong ELF class` from sqlite-vec                                   | Use the current `sqlite-vec==0.1.9` dependency and rebuild; the Dockerfile now checks extension loading during build                                          |
| Ollama unavailable                                                  | Check native Ollama is serving loopback port 11434 and Desktop host networking is enabled                                                                     |
| Memories saved but semantic search unavailable / pending embeddings | Pull `nomic-embed-text`, or select another installed embedding model and rebuild the vector index                                                             |
| `failed to load model vocabulary required for format`               | The provider falls back to JSON mode for this specific schema error and still validates the output                                                            |
| Interpretation fails                                                | The model gets one retry; the chat shows an error. Rephrase and check model availability                                                                      |
| Voice input unavailable                                             | Allow browser microphone access on localhost/127.0.0.1, learn a voice key in Settings, and rebuild if the API reports missing local speech dependencies/model |
| Updated UI/favicon not visible                                      | Refresh the page after a successful rebuild                                                                                                                   |

Do not use `docker compose down -v` unless you intend to delete the database volume.

## Backup and restore

Create a consistent snapshot inside the data volume, copy it out, and remove the extra in-volume copy:

```sh
docker compose exec app python scripts/backup.py /app/data/backup.sqlite3 --database /app/data/personal-ai.sqlite3
docker compose cp app:/app/data/backup.sqlite3 ./infonity-backup.sqlite3
docker compose exec app python -c "from pathlib import Path; Path('/app/data/backup.sqlite3').unlink()"
```

Use a new destination filename for each backup; the script refuses overwrites. Snapshots include private history and exclusions. For restore, stop the app, replace the database using a maintenance container with the same volume, remove obsolete WAL/SHM sidecars, and retain UID/GID 10001 ownership before restarting. An old backup can restore forgotten records.

Containerised Ollama for CPU inference is outside this Compose configuration. This deployment uses native inference and retains loopback-only model/API access.
