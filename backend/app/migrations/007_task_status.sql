ALTER TABLE memories ADD COLUMN task_status TEXT NOT NULL DEFAULT 'todo';
UPDATE memories SET task_status=CASE WHEN completed=1 THEN 'done' ELSE 'todo' END;
