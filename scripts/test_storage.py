"""Dependency-free tests of the actual SQL migrations; complements backend pytest."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "backend/app/migrations"


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "test.db")
        self.db = sqlite3.connect(self.path)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            self.db.executescript(migration.read_text())
        self.db.execute("INSERT INTO conversations(id,title) VALUES('c','Test')")
        self.db.execute(
            "INSERT INTO messages(id,conversation_id,role,content) VALUES('s','c','user','I like Clojure')"
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def memory(self, ident="m", value="Clojure"):
        self.db.execute(
            """INSERT INTO memories(id,subject,predicate,value,type,scope,confidence,importance,evidence,sensitivity,origin) VALUES(?,'user','language',?,'preference','general',1,.5,'I like Clojure','ordinary','explicit')""",
            (ident, value),
        )
        self.db.execute("INSERT INTO memory_sources VALUES(?,'s')", (ident,))

    def test_required_tables_and_wal(self):
        tables = {
            r[0]
            for r in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertTrue(
            {
                "conversations",
                "messages",
                "memories",
                "memory_sources",
                "memory_candidates",
                "memory_events",
                "memory_links",
                "memory_outbox",
            }
            <= tables
        )
        self.assertEqual("wal", self.db.execute("PRAGMA journal_mode").fetchone()[0])

    def test_memory_fts_and_outbox_atomic(self):
        self.memory()
        self.assertEqual(
            "m",
            self.db.execute(
                "SELECT id FROM memory_fts WHERE memory_fts MATCH 'Clojure'"
            ).fetchone()[0],
        )
        self.assertEqual(
            1,
            self.db.execute(
                "SELECT version FROM memory_outbox WHERE memory_id='m'"
            ).fetchone()[0],
        )
        self.db.rollback()
        self.assertEqual(
            0, self.db.execute("SELECT count(*) FROM memory_fts").fetchone()[0]
        )
        self.assertEqual(
            0, self.db.execute("SELECT count(*) FROM memory_outbox").fetchone()[0]
        )

    def test_supersession_removes_active_search(self):
        self.memory()
        self.db.execute("UPDATE memories SET state='superseded',version=2 WHERE id='m'")
        self.assertEqual(
            0,
            self.db.execute(
                "SELECT count(*) FROM memory_fts WHERE memory_fts MATCH 'Clojure'"
            ).fetchone()[0],
        )
        self.assertEqual(
            2,
            self.db.execute(
                "SELECT version FROM memory_outbox WHERE memory_id='m'"
            ).fetchone()[0],
        )
        self.assertEqual(
            "Clojure",
            self.db.execute("SELECT value FROM memories WHERE id='m'").fetchone()[0],
        )

    def test_delete_cascades_without_audit_content(self):
        self.memory()
        self.memory("n", "Scala")
        self.db.execute("INSERT INTO memory_links VALUES('m','n','superseded_by')")
        self.db.execute(
            "INSERT INTO memory_events(memory_id,kind,version) VALUES('m','created',1)"
        )
        self.db.execute(
            "INSERT INTO memory_embeddings VALUES('m',x'00000000','test','v1',1)"
        )
        self.db.execute("INSERT INTO message_memories VALUES('s','m')")
        self.db.execute("DELETE FROM memories WHERE id='m'")
        for table in ("memory_sources", "memory_outbox"):
            self.assertEqual(
                0,
                self.db.execute(
                    f"SELECT count(*) FROM {table} WHERE memory_id='m'"
                ).fetchone()[0],
            )
        for table in (
            "memory_events",
            "memory_links",
            "memory_embeddings",
            "message_memories",
        ):
            self.assertEqual(
                0, self.db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            )
        self.assertEqual(
            0,
            self.db.execute(
                "SELECT count(*) FROM memory_fts WHERE memory_fts MATCH 'Clojure'"
            ).fetchone()[0],
        )

    def test_conversation_delete_preserves_memory(self):
        self.memory()
        self.db.execute("DELETE FROM conversations WHERE id='c'")
        self.assertEqual(
            "Clojure",
            self.db.execute("SELECT value FROM memories WHERE id='m'").fetchone()[0],
        )
        self.assertIsNone(
            self.db.execute("SELECT message_id FROM memory_sources").fetchone()[0]
        )

    def test_constraints(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO messages(id,conversation_id,role,content) VALUES('bad','missing','user','test')"
            )
        self.memory()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE memories SET state='deleted' WHERE id='m'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE memories SET confidence=2 WHERE id='m'")

    def test_restart_and_content_free_exclusion(self):
        self.memory()
        self.db.execute("UPDATE messages SET excluded=1")
        self.db.commit()
        other = sqlite3.connect(self.path)
        try:
            self.assertEqual(
                "Clojure", other.execute("SELECT value FROM memories").fetchone()[0]
            )
            self.assertEqual(
                0,
                other.execute(
                    "SELECT count(*) FROM messages WHERE excluded=0"
                ).fetchone()[0],
            )
        finally:
            other.close()

    def test_optimistic_update_rowcount(self):
        self.memory()
        self.db.commit()
        first = self.db.execute(
            "UPDATE memories SET version=version+1 WHERE id='m' AND version=1"
        )
        self.assertEqual(1, first.rowcount)
        second = self.db.execute(
            "UPDATE memories SET version=version+1 WHERE id='m' AND version=1"
        )
        self.assertEqual(0, second.rowcount)


if __name__ == "__main__":
    unittest.main(verbosity=2)
