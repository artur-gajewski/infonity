# REST and chat API

Base URL: `http://127.0.0.1:18473` in Docker, or `http://127.0.0.1:8000` for native setup. OpenAPI UI: `/docs`; schema: `/openapi.json`. Requests require an accepted local Host and same-origin/development Origin. There is no account authentication or wildcard CORS.

Collections and records generally return `{"data": ...}`. Settings, health, and action outcomes return their own objects. Errors use `{"error":{"code":"...","message":"..."}}`. Invalid bodies return 422; missing records/requests 404; stale versions or expired/changed confirmations 409; origin violations 403. Streaming failures use SSE error events after headers have been sent.

## Endpoints

| Method    | Path                                                   | Behavior                                                                                            |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| POST      | `/api/speech/transcribe`                               | Transcribe raw local audio; return `{"text": "..."}` without sending chat                           |
| POST      | `/api/chat`                                            | Persist message; interpret and execute an action or run ordinary chat                               |
| GET       | `/api/conversations`                                   | Ten most recent discussions, newest first; older records remain stored                              |
| DELETE    | `/api/conversations`                                   | Delete all conversations, including older history; keep saved memories; return `{"deleted": count}` |
| GET       | `/api/conversations/{id}`                              | Stored messages and provided-memory associations                                                    |
| DELETE    | `/api/conversations/{id}`                              | Delete chat; memories remain and source-message references become null                              |
| POST      | `/api/actions/{id}/confirm`                            | Confirm or cancel a pending chat deletion                                                           |
| POST      | `/api/memories`                                        | Create a memory; 201                                                                                |
| GET       | `/api/memories?q=&category=&type=&scope=&state=active` | Browse/filter; empty `state` includes history                                                       |
| GET       | `/api/memories/{id}`                                   | Record, sources, and correction/edit links                                                          |
| PATCH     | `/api/memories/{id}`                                   | Version-checked complete memory edit or retraction                                                  |
| DELETE    | `/api/memories/{id}`                                   | Immediately delete record and linked versions; exclude prior context                                |
| POST      | `/api/memories/forget`                                 | Immediately delete by topic/all; optional conversation-history deletion                             |
| GET       | `/api/memories/{id}/history`                           | Record, content-free events, and version links                                                      |
| POST      | `/api/memories/consolidate`                            | Merge exact duplicates; return related/expired-record review data                                   |
| POST      | `/api/memories/rebuild`                                | Reset vectors and attempt an embedding batch                                                        |
| GET       | `/api/memories/export`                                 | Format version 1, active memories with evidence                                                     |
| POST      | `/api/memories/import`                                 | Atomic validated import                                                                             |
| GET/PATCH | `/api/settings`                                        | Model and extraction/retrieval settings                                                             |
| GET       | `/api/health`                                          | Local Ollama availability, installed models, pending embedding count                                |

Legacy `/api/memory-candidates` GET and `/{id}/approve` / `/{id}/reject` POST endpoints remain for compatibility. Automatic saving is the default, and the UI does not expose Suggestions.

## Memory inputs

Example Todo input:

```json
{
  "category": "todo",
  "title": "",
  "value": "Buy groceries.",
  "predicate": "item",
  "subject": "user",
  "type": "fact",
  "scope": "general",
  "task_status": "in progress",
  "completed": false,
  "confidence": 1,
  "importance": 0.5,
  "evidence": "Add todo Buy groceries.",
  "sensitivity": "ordinary",
  "valid_from": null,
  "valid_until": null
}
```

- `category`: `general` (default), `documents`, `todo`, `reminders`, or `links`.
- `title`: optional metadata, up to 300 characters, stored separately from `value`.
- `value`: required field, up to 20,000 characters. Content must be nonempty except for a `documents` record with a nonempty title. `predicate` is also required; category actions normally use `item`.
- `task_status`: free-text label, 1–100 characters, default `todo`. Task status is distinct from lifecycle `state`.
- When `task_status` is supplied, `completed` is derived: `done`, `complete`, `completed`, and `finished` are true, case-insensitively. Other labels are false. Legacy inputs with only `completed` map to `done` or `todo`.
- Types: `fact`, `preference`, `episodic`, `instruction`.
- Sensitivity: `ordinary`, `sensitive`, `secret`. Secrets are rejected. Direct sensitive creation requires `?confirm_sensitive=true`.
- Temporal bounds require timezone-aware ISO 8601 timestamps and normalise to UTC.
- IDs, origin, record versions, and creation/modification timestamps are server-managed.

`q` uses normalised word-token overlap over subject, predicate, value, scope, category, and title. Category/type/scope/lifecycle-state filters are exact. The REST collection endpoint does not expose a separate task-status query parameter; the chat action layer applies that filter.

The UI/action layer treats completion and free-text status as Todo/Reminder fields. A title change preserves a link URL; a task-status change preserves its content/title.

Edits supply the full editable record and its current version:

```json
{
  "memory": {
    "category": "todo",
    "predicate": "item",
    "value": "Buy groceries.",
    "task_status": "waiting for delivery"
  },
  "version": 1,
  "state": "active"
}
```

Omitted editable fields take schema defaults: callers should preserve the current fields they do not intend to change. Edits create a new record and supersede the old one; use the returned ID for subsequent operations. `state="retracted"` disables retrieval while retaining history. Reload after 409.

Import expects `{"memories":[...Memory inputs...],"confirm_sensitive":false}`. Remove server-managed fields from exported records before posting; the frontend does this. A conflict aborts the import transaction. JSON export/import preserves active fields, including title and task status, but is not a full provenance/history backup.

## Chat and structured actions

Request:

```json
{ "message": "mark groceries as in progress", "conversation_id": null }
```

A null conversation ID creates a discussion. Use the returned ID for references and clarification replies in the same conversation.

The local interpreter selects `chat`, `add`, `list`, `update`, `delete`, or `clarify`. Action fields include category, content, title, task_status, the compatibility completed flag, target handles, query, clarification question, and a bulk flag. These are internal validated intents, not arbitrary endpoint/URL specifications.

Target selection uses bounded current-item previews and request-local handles. The backend maps exact handles to records and checks their state/version. Names may be resolved through exact title/value matching; ambiguous names do not authorise deletion. Invalid output or unknown handles gets one local interpretation retry.

Lists return at most 50 items with supplied-record associations. Text and exact custom-status filters are distinct. A text search miss with an existing collection explains the mismatch and shows a clearly labelled fallback list.

The response is `text/event-stream`. Each event is `data: {JSON}` followed by a blank line.

| Event            | Fields / meaning                                                              |
| ---------------- | ----------------------------------------------------------------------------- |
| `conversation`   | `id`                                                                          |
| `memory`         | `saved` IDs, legacy `suggested` count, optional `warning`; `pending=true` means automatic extraction will run after the reply, not that a save succeeded |
| `retrieved`      | `memories` records, optional search `warning`                                 |
| `document_draft` | Proposed `title` and `body`; open the creation dialog without saving a record |
| `confirmation`   | Pending deletion `id` and human-readable `text`                               |
| `delta`          | Answer/result `text`                                                          |
| `error`          | User-facing `message`; no successful completion is implied                    |
| `done`           | Normal response completion                                                    |

Document-add chat actions return a `document_draft` event and an instruction to review the dialog. The client submits the completed draft separately to `POST /api/memories`; cancelling does not save a document. The current browser form requires both title and body, even though the memory API also accepts a titled document with an empty value. Document lists use titles (or the first body line, up to 120 characters, then `Untitled document`), with supplied-memory associations enabling links to the full record.

The transport supports text deltas, but local generation is buffered and thinking content removed before a reply is shown. The UI displays a spinner while waiting. Empty generation becomes an error rather than a blank saved answer. The user message persists when inference fails.

Application action results are persisted independently of model generation. Supplied-memory associations indicate exposure, not proven causal use. Memory IDs remain in expandable details rather than being required in reply text.

## Deletion confirmation

A chat request such as “Remove link Example” returns a confirmation event and keeps records intact:

```json
{
  "type": "confirmation",
  "id": "<pending-request-id>",
  "text": "Delete 1 item?\n..."
}
```

After the user chooses, send:

```text
POST /api/actions/<pending-request-id>/confirm
Content-Type: application/json
```

```json
{ "confirmed": true }
```

The boolean is strict. `false` cancels. Responses contain `answer` and `deleted`; successful deletion also includes `history_deleted`. The UI appends that result to chat and refreshes the library.

Pending requests expire after ten minutes. A new request in the same conversation supersedes its previous pending selection. Tokens are single-use; missing/consumed tokens return 404. Expired requests, a changed privacy epoch, or changed target state/version return 409. Bulk confirmation deletes the captured selection, not items added later.

`DELETE /api/conversations` removes all discussions under the privacy lock and changes the privacy epoch. Saved memories remain; source-message references become null. The Settings UI confirms this separately from memory deletion.

**Direct REST DELETE and `/api/memories/forget` calls execute immediately.** They are low-level service endpoints; API clients must provide their own confirmation. The library/settings UI already asks before invoking them.

Topic deletion body: `{"topic":"programming language","delete_history":false}`. All-memory deletion: `{"all":true,"delete_history":true}`. The latter history option deletes all conversations, not a guessed subset of sentences.

## Settings and health

Editable Settings fields are `model`, `embedding_model`, `memory_limit`, `memory_tokens`, `extraction_enabled`, `sensitive_retrieval`, and the legacy `implicit_suggestions` field. The normal UI hides suggestion controls; automatic saving is enabled by default. A Settings PATCH expects the complete Settings input.

- `memory_limit` (UI: **Memory limit per response**, default `8`, range `1–50`) is the maximum number of relevant memories included as context for one generated response. It limits selected results after retrieval and ranking, not the number of stored memories searched or the storage capacity.
- `memory_tokens` (default `1200`, range `100–8000`) budgets the selected memory context using a character-based approximation. Fewer than `memory_limit` memories may fit.

These settings do not cap direct collection lists such as “Show documents”; those return up to 50 items.

Timezone is configured by `LOCAL_AI_TIMEZONE`, not the Settings PATCH schema. Docker forwards it through Compose. Stored editable settings override their environment defaults on later starts. Health does not require the embedding queue to be empty; a missing embedding model can leave semantic indexing pending while lexical retrieval remains available.

## Local speech input

`POST /api/speech/transcribe` accepts raw audio with Content-Type `audio/mp4`, `audio/webm`, `audio/ogg`, `audio/wav`, or `audio/x-wav` (codec parameters permitted). Returns `{ "text": "..." }` without sending a chat message. Maximum upload: 8 MiB; maximum decoded duration: 65 seconds (UI stops at 60 seconds). Empty or undecodable audio returns 422, unsupported media 415, oversize input 413, concurrent transcription 429, unavailable local model/dependencies 503. Audio is processed in memory and not persisted.
