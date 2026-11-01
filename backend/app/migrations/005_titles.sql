ALTER TABLE memories ADD COLUMN title TEXT NOT NULL DEFAULT '';
CREATE INDEX memory_title ON memories(category,title,state);
