# Memory lifecycle and privacy

## Automatic saving

The normal application has no Suggestions section. With the default automatic-saving configuration:

1. Persist the user message before inference.
2. Interpret category actions separately from ordinary chat. Explicit saves go through validated action execution.
3. After an ordinary reply completes, background extraction analyses the latest user message with recent context using the versioned extraction prompt. Explicit `remember` requests wait for extraction before replying. Assistant claims alone cannot establish personal facts.
4. Validate output and verify proposed facts against the user's source with a second local model request. Evidence must be an exact source span and contain the proposed value.
5. Skip unsupported, secret-like, or ambiguous extracted claims. Save verified unambiguous facts automatically, including inferred preferences.
6. Recheck source exclusion before committing. Deletion during inference wins.

Personal-memory extraction can be disabled independently of explicit category actions.
Extraction/verification failures do not save that extraction. Explicit saves can
report a warning; automatic extraction runs after the reply stream and cannot send
a completion or failure event to that stream. The reply announces pending automatic
saving, not a confirmed save. Background tasks are serialized and cancelled on
shutdown, without replay after restart. A newly mentioned fact may therefore take
time to appear in the library or be available to the next reply.

Sensitive extracted facts can be saved automatically. They remain excluded from model retrieval unless `sensitive_retrieval` is enabled in Settings. Secret detection is heuristic, not a comprehensive credential detector. Direct low-level API creation of a sensitive record still requires `confirm_sensitive=true`.

Legacy candidate tables, endpoints, and configuration remain for compatibility and deterministic tests; they are not the normal UI workflow. Startup attempts to save eligible old pending candidates. Ambiguous or stale/conflicting candidates are not blindly applied. There is no automatic replay of source history.

## Categories, titles, and task status

Categories are `general`, `documents`, `todo`, `reminders`, and `links`. Existing personal memories default to General. Multiple category items can coexist without replacing one another.

`title` is metadata separate from `value`. A link title change preserves its URL. Named deletion uses exact quoted names before broader model matches; duplicate exact titles require clarification.

Todo/reminder `task_status` is free text, from 1 to 100 characters. Users may choose `in progress`, `unsure`, `waiting for delivery`, or another label through `mark`, `set`, or `update`. Status changes preserve item text/title and create version history. Lists show `Karate [unsure]`; the initial `todo` label is omitted.

The compatibility `completed` flag is true for case-insensitive `done`, `complete`, `completed`, and `finished`, and false for other labels. If the API receives `task_status`, it is authoritative. Older inputs supplying only `completed` map to `done` or `todo`.

Document-add requests from chat produce an unsaved title/body draft. Only submitting the creation dialog persists the record; Cancel or Escape discards it. Viewing a document fetches the full saved body; editing it preserves earlier versions. The memory API permits an empty body when the document has a title, while the creation dialog requires both fields.

Reminders are stored notes; status and date text do not schedule alerts.

## Corrections and versions

Subject, predicate, scope, and category identify contextual claims. Normalisation distinguishes contexts such as work and personal preferences. Automatically saved conflicting personal claims supersede the current claim while preserving its old record; model interpretation can still be wrong.

Manual/action edits create a new record, supersede the old one, and link versions with `edited_to`. Corrections use `superseded_by`. Source associations are preserved, and action edits associate the new user request. Optimistic version checks reject stale edits with 409.

Retracted records remain inspectable but do not enter current or historical retrieval. Superseded records are only retrieved for historical questions. Task status is independent of lifecycle `state`: a task may be active with status `done`, `blocked`, or any other label.

## Deletion confirmation

Chat removal/erase/delete/forget actions persist a pending selection and show its category, title/content preview, and affected count. No records are deleted while it is pending.

- Confirm executes the captured selection.
- Cancel or Escape consumes the request and keeps the records.
- Requests expire after ten minutes.
- Expiry, a changed privacy epoch, or changed target state/version rejects confirmation.
- New items added after a bulk request are not part of its snapshot.
- Tokens are single-use and bound to stored requests/conversations.

The UI also asks before direct library, topic, all-memory, and conversation deletion. Low-level REST delete/forget endpoints execute immediately; API clients are responsible for their own confirmation flow.

Settings → Recent conversations → **Delete recent conversations** deletes all discussions, including older history beyond the sidebar, after confirmation. Saved memories remain, their deleted source-message references become null, and the privacy epoch changes. This is separate from forgetting memories.

## Removal and exclusion

Confirmed memory deletion removes the selected records and linked correction/edit histories, source associations, events, vector/index entries, outbox jobs, and reply-provenance associations. It conservatively clears legacy candidates.

All retained messages are excluded from subsequent model/extraction context. Their raw text remains visible in history. The random privacy epoch cancels stale in-flight output. New messages after deletion can be used normally, but excluded old sources cannot be replayed for extraction.

An already submitted local-model prompt cannot be recalled from process memory. Deleting a memory does not promise removal of independently retained text with the same words. Use appropriate topic/all-memory deletion and the optional all-conversation-history deletion when broader removal is intended.

The legacy topic fallback matches normalised tokens rather than semantic aliases. Exact-name/ID actions are handled through the interpreter and backend checks. Deleting one version removes its linked chain so an old claim does not reappear as a historical answer.

## Consolidation, exports, and backups

Manual consolidation merges exact duplicates while respecting category, title, status, contextual, temporal, and sensitivity differences and preserving provenance. Related/expired-record review output is separate from the removed extraction Suggestions UI.

JSON export/import covers active records, including category, title, and task status. Full conversation history, version chains, exclusions, and pending requests require a SQLite backup. Importing or restoring older data can reintroduce forgotten information. A pending deletion restored from a backup is still subject to expiry and validation.

## Physical storage limits

SQLite is plaintext local storage. Database permissions and secure-delete do not guarantee forensic erasure: WAL frames, free pages, FTS shadow pages, backups, filesystem snapshots, swap, SSD remapping, and browser/model process memory may retain earlier bytes. Use encrypted OS storage and manage retained backups/exports.

The app disables HTTP access logging and does not intentionally log message bodies. User-facing validation errors omit submitted values. Dependency/model downloads contact registries during setup; runtime inference is restricted to local HTTP and installed non-cloud models.

## Browser preferences and voice audio

Only the theme, learned voice key, and voice auto-send preference are saved in browser localStorage. Conversation and memory records remain API-backed. Voice audio is sent to the local transcription endpoint, decoded in memory, and not stored as audio in SQLite. Transcribed text enters the selected field; when sent as chat or saved in a form, it follows the same persistence and memory rules as typed text. Optional voice auto-send applies only to chat and does not bypass deletion confirmation.
