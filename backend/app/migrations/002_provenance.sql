CREATE TABLE message_memories(message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,PRIMARY KEY(message_id,memory_id));
