CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX messages_conversation ON messages(conversation_id,created_at);
CREATE TABLE memories(id TEXT PRIMARY KEY,subject TEXT NOT NULL,predicate TEXT NOT NULL,value TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('fact','preference','episodic','instruction')),scope TEXT NOT NULL,confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),importance REAL NOT NULL CHECK(importance BETWEEN 0 AND 1),evidence TEXT NOT NULL,sensitivity TEXT NOT NULL CHECK(sensitivity IN ('ordinary','sensitive','secret')),valid_from TEXT,valid_until TEXT,origin TEXT NOT NULL CHECK(origin IN ('explicit','inferred')),state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','superseded','retracted')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX memory_identity ON memories(subject,predicate,scope,state);
CREATE TABLE memory_sources(memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,PRIMARY KEY(memory_id,message_id));
CREATE TABLE memory_candidates(id TEXT PRIMARY KEY,message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),conflicts TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE memory_events(id INTEGER PRIMARY KEY,memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,kind TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE memory_links(source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,kind TEXT NOT NULL,PRIMARY KEY(source_id,target_id,kind));
CREATE TABLE memory_outbox(memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,version INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE memory_embeddings(memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,embedding BLOB NOT NULL,model TEXT NOT NULL,model_version TEXT NOT NULL,version INTEGER NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED,subject,predicate,value,scope);
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
 INSERT INTO memory_fts VALUES(new.id,new.subject,new.predicate,new.value,new.scope);
 INSERT INTO memory_outbox VALUES(new.id,new.version,0);
END;
CREATE TRIGGER memory_update AFTER UPDATE ON memories BEGIN
 DELETE FROM memory_fts WHERE id=old.id;
 INSERT INTO memory_fts SELECT new.id,new.subject,new.predicate,new.value,new.scope WHERE new.state='active';
 INSERT OR REPLACE INTO memory_outbox VALUES(new.id,new.version,0);
 DELETE FROM memory_embeddings WHERE memory_id=new.id;
END;
CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN DELETE FROM memory_fts WHERE id=old.id; END;
