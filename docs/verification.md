# Verification and known limits

## Latest frontend results — 2026-10-30

After extracting eight typed UI components and centralizing categories, the Settings type, and document-title formatting:

| Check                                                                  | Recorded result                             |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| `NODE_OPTIONS=--no-experimental-webstorage npm test --prefix frontend` | 66 passed across 7 test files               |
| `npm run build --prefix frontend`                                      | TypeScript and Vite production build passed |

These checks ran against the refactored frontend. Coverage includes document creation/cancellation/viewing/editing, Stop/Escape cancellation, conversation and memory deletion confirmation, theme persistence, clickable links, learned voice keys, recording cancellation, dictation in modal fields, and optional chat auto-send. Tests use jsdom and mocked APIs/media devices; they do not verify actual microphone hardware, transcription accuracy, or real-browser layout. Backend, storage, Docker, and real-Ollama suites were not rerun for this refactor.

## Earlier recorded results — 2026-10-28

| Check                                                                 | Recorded result                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Deterministic backend suite in Docker, using current mounted source   | 127 passed; 12 opt-in cases skipped                                         |
| Frontend Vitest suite                                                 | 25 passed                                                                   |
| TypeScript + Vite production build                                    | Passed                                                                      |
| Dependency-free SQLite migration/storage suite                        | 8 passed                                                                    |
| Selected real-Ollama integration cases after free-text status changes | 6 passed                                                                    |
| Runtime smoke checks                                                  | UI, favicon, OpenAPI fields, and database migrations responded successfully |

The latest real-model selection exercised ordinary add/list/update/delete execution, all three `mark`/`set`/`update` done/not-done flows, custom task-status labels, and the exact “mark karate as unsure” request. Earlier implementation checks also exercised filtered links with prior conversation, titles preserving URLs, deletion confirmation/cancellation, general knowledge, and relative-date answers.

This is a record of checks actually run, not a claim that the entire opt-in real-model suite passed against the final tree. The long restart/correction/forget acceptance test and provider acceptance test are available but were not included in the latest six-case selection. No automated real-browser visual/layout or accessibility audit was recorded.

React tests use a mocked API and jsdom. Deterministic backend tests inject a provider or mock HTTP. Storage tests exercise actual migrations and SQLite independently. Real-model tests use local Ollama and isolated temporary databases. These layers test different boundaries and are not interchangeable.

## Reproduce deterministic checks

Native dependencies installed:

```sh
./scripts/test.sh
```

Or individually:

```sh
python3 scripts/test_storage.py
(cd backend && ../.venv/bin/python -m pytest -q)
npm test --prefix frontend
# For newer Node runtimes with incompatible global localStorage:
NODE_OPTIONS=--no-experimental-webstorage npm test --prefix frontend
npm run build --prefix frontend
```

Docker:

```sh
docker build --target backend-test -t infonity-backend-tests .
docker compose up --build -d
```

The backend-test image runs pytest during construction. Runtime image construction runs frontend tests/build and checks that sqlite-vec can actually load. It does not run real-model tests.

## Reproduce local-model checks

Install and run local Ollama with the configured chat and embedding models. Native:

```sh
cd backend
LOCAL_AI_INTEGRATION=1 ../.venv/bin/python -m pytest tests/test_ollama_integration.py -v
```

Docker, with host networking available:

```sh
docker run --rm --network host \
  -e LOCAL_AI_INTEGRATION=1 \
  -e LOCAL_AI_MODEL=qwen3:4b \
  -e LOCAL_AI_EMBEDDING_MODEL=nomic-embed-text \
  infonity-backend-tests python -m pytest -v tests/test_ollama_integration.py
```

To reproduce the latest six-case status/action selection, append these test names to `python -m pytest -v` instead of the full file:

```text
tests/test_ollama_integration.py::test_plain_english_action_lifecycle
tests/test_ollama_integration.py::test_complete_and_reopen_todo_preserves_content
tests/test_ollama_integration.py::test_user_defined_todo_statuses
tests/test_ollama_integration.py::test_mark_karate_as_unsure_preserves_task
```

The completion test is parameterised over three verbs, making this four-name selection six test cases. Override model variables explicitly when using non-default names. Changing the working directory changes which `.env` file is read. Real-model tests can be slow, nondeterministic, and model-dependent; do not loosen assertions merely to label a failure as a pass.

## Covered regression cases

- Automatic verified personal-memory saving, source grounding, unsupported claims, corrections, and historical retrieval.
- Plain-English action dispatch; follow-up context; invalid JSON/schema retry and exact handle validation.
- Unknown/ambiguous deletion targets, quoted commands, negated requests, and explanation questions.
- Confirmation, cancellation, expiry, replay rejection, changed records, and fixed bulk selections.
- Link titles preserving URLs, exact-name preference over longer containing values, and duplicate-title ambiguity.
- Filtered lists with prior conversation, purpose wording, real search misses, and appropriate fallback lists.
- Free-text statuses preserving item text, status suffixes, done/reopen compatibility, content edits preserving status, and status-filtered lists.
- Empty model responses and visible chat failures; Stop/Escape cancellation and chat scrolling above the composer.
- Document drafts requiring explicit save, cancel/Escape without saving, and linked document viewing/versioned editing.
- Browser voice-key learning/persistence, modifier-key shortcuts, recording cleanup/cancellation, dictation insertion, and optional full-draft chat auto-send.
- Safe clickable URLs, theme persistence, and conversation deletion confirmation.
- Clock/timezone boundaries, leap dates, local dates, and relative-date context.
- Index/outbox consistency, model-digest changes, deletion races, provenance, local-origin checks, imports/exports, and cloud-model rejection.

## Current limits

- Single local user and one server process; no multi-tenant authentication or distributed locking.
- Local model interpretation can still be wrong. Schema validation, exact source/name checks, bounded retries, and deletion confirmation reduce risk, not eliminate it.
- One structured operation is interpreted per request. Multiple independent actions may require clarification or separate messages.
- Preview selection is bounded to at most 100 relevant/recent records, a character budget, and 2,000-character item previews. Chat lists show up to 50 entries. Large libraries need library filtering; there is no paginated chat navigation.
- Task statuses are arbitrary labels up to 100 characters. The legacy completion flag recognises only `done`/`complete`/`completed`/`finished`; other labels remain distinct custom statuses.
- Reminders do not schedule notifications. Documents are saved text/references, not an uploaded-file processing pipeline.
- The single-line composer cannot author multiline messages; the library editor, JSON import, and REST API accept larger/multiline content within schema limits.
- General answers use model knowledge, not live web search. Calendar context uses the configured timezone and current application clock.
- Thinking is disabled where supported and filtered, but model formatting/behavior remains provider-dependent.
- Keyword/structured retrieval survives semantic indexing failure, but synonyms and model-dependent extraction/retrieval may still miss relevant facts.
- Sensitive retrieval is opt-in; plaintext SQLite, source history, exports, and backups remain sensitive. Detection of secrets is heuristic.
- Deletion conservatively excludes all previous chat context and removes linked versions. It cannot recall an in-flight model prompt or guarantee physical erasure from storage, snapshots, or backups.
- JSON export covers active memory fields, not the full history/provenance database.
- Backend dependency ranges are not a resolved lockfile. Rebuilds can pick up newer compatible dependencies; repeat relevant verification after dependency/model changes.
