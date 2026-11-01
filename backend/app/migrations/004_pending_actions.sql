CREATE TABLE pending_deletions(
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 targets TEXT NOT NULL,
 privacy_epoch TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
