ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('general','documents','todo','reminders','links'));
CREATE INDEX memory_category ON memories(category,state);
