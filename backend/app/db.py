import sqlite3
from pathlib import Path
from contextlib import contextmanager
import sqlite_vec


class Database:
    def __init__(self, path):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("BEGIN IMMEDIATE")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            for migration in sorted(
                (Path(__file__).parent / "migrations").glob("*.sql")
            ):
                target = int(migration.name.split("_")[0])
                if target > version:
                    statement = ""
                    for line in migration.read_text().splitlines(keepends=True):
                        statement += line
                        if sqlite3.complete_statement(statement):
                            db.execute(statement)
                            statement = ""
                    if statement.strip():
                        raise ValueError("Incomplete migration SQL")
                    db.execute(f"PRAGMA user_version={target}")
                    version = target

        Path(path).chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA secure_delete=ON")
        db.enable_load_extension(True)
        sqlite_vec.load(db)
        db.enable_load_extension(False)
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()
