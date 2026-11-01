"""Consistent local SQLite backup, including private history. No third-party dependencies."""

import argparse
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("destination", type=Path)
parser.add_argument("--database", type=Path, default=Path("data/personal-ai.sqlite3"))
args = parser.parse_args()
if not args.database.is_file():
    parser.error("Database does not exist")
if args.destination.exists():
    parser.error("Destination already exists; refusing to overwrite")
args.destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
fd = os.open(args.destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.close(fd)
try:
    with sqlite3.connect(f"file:{args.database.resolve()}?mode=ro", uri=True) as source:
        with sqlite3.connect(args.destination) as target:
            source.backup(target)
except BaseException:
    args.destination.unlink(missing_ok=True)
    raise
print(
    f"Backup written to {args.destination}. It includes personal data and retained conversation history."
)
