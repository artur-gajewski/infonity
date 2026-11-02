"""Synthetic local-Ollama latency benchmark; never opens the application database."""

import argparse
import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
import sys
import tempfile
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import Settings
from app.db import Database
from app.memory import MemoryService, uid
from app.models import Memory
from app.provider import Ollama
from app.retrieval import Retrieval, SYSTEM


class Timings:
    def __init__(self):
        self.values = {}

    @contextmanager
    def measure(self, stage):
        start = perf_counter()
        try:
            yield
        finally:
            self.values[stage] = self.values.get(stage, 0) + (perf_counter() - start) * 1000


class TimedDatabase:
    def __init__(self, database, timings):
        self.database, self.timings = database, timings

    @contextmanager
    def connect(self):
        # Includes connection setup, row iteration, transactions and commit.
        with self.timings.measure("sqlite_ms"):
            with self.database.connect() as connection:
                yield connection


class TimedProvider:
    def __init__(self, provider, timings):
        self.provider, self.timings = provider, timings

    def __getattr__(self, name):
        async def call(*args, **kwargs):
            with self.timings.measure(name + "_ms"):
                return await getattr(self.provider, name)(*args, **kwargs)
        return call


async def benchmark(settings, provider, runs=3, size=100):
    timings = Timings()
    reports = []
    with tempfile.TemporaryDirectory(prefix="memory-benchmark-") as directory:
        database = TimedDatabase(Database(str(Path(directory) / "benchmark.db")), timings)
        timed_provider = TimedProvider(provider, timings)
        memory = MemoryService(database, timed_provider, settings)
        retrieval = Retrieval(database, timed_provider, settings)
        # Seed unrelated synthetic records to exercise filtering and ranking.
        for index in range(size):
            memory.create(Memory(subject="user", predicate=f"benchmark_note_{index}",
                                 value=f"Synthetic notebook number {index}"))

        async def record(run, stage, operation):
            timings.values.clear()
            start = perf_counter()
            result = await operation()
            elapsed = (perf_counter() - start) * 1000
            report = {"run": run, "stage": stage, "total_ms": round(elapsed, 3),
                      **{key: round(value, 3) for key, value in timings.values.items()}}
            report["other_ms"] = round(max(0, elapsed - sum(timings.values.values())), 3)
            reports.append(report)
            return result

        for run in range(1, runs + 1):
            conversation, message = uid(), uid()
            with database.connect() as connection:
                connection.execute("INSERT INTO conversations(id,title) VALUES(?,?)",
                                   (conversation, "Synthetic benchmark"))
                connection.execute(
                    "INSERT INTO messages(id,conversation_id,role,content) VALUES(?,?,'user',?)",
                    (message, conversation, "Remember that my favorite language is Clojure."))
            saved = await record(run, "save", lambda: memory.extract(message, []))
            reports[-1]["saved_count"] = len(saved["saved"])
            reports[-1]["ok"] = bool(saved["saved"]) and not saved["warning"]
            indexed = await record(run, "index", lambda: retrieval.process_outbox(limit=size + runs))
            reports[-1].update(indexed)
            reports[-1]["ok"] = indexed["failed"] == 0
            selected, warning = await record(
                run, "retrieve", lambda: retrieval.search("What is my favorite language?"))
            reports[-1]["selected_count"] = len(selected)
            reports[-1]["ok"] = bool(selected) and warning is None

            async def generate():
                start = perf_counter()
                first = None
                async for chunk in provider.stream([
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": "UNTRUSTED MEMORY DATA: " + json.dumps(selected)},
                    {"role": "user", "content": "What is my favorite language? Answer briefly."},
                ]):
                    if chunk and first is None:
                        first = (perf_counter() - start) * 1000
                return first

            first = await record(run, "answer", generate)
            reports[-1]["first_visible_chunk_ms"] = round(first, 3) if first is not None else None
            reports[-1]["ok"] = first is not None
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--size", type=int, default=100, help="Synthetic background memories")
    args = parser.parse_args()
    if args.runs < 1 or args.size < 0:
        parser.error("runs must be positive and size nonnegative")
    settings = Settings(auto_save_memories=True, extraction_enabled=True)
    try:
        reports = asyncio.run(benchmark(settings, Ollama(settings), args.runs, args.size))
    except Exception as error:
        # Exception messages can contain request/response bodies; emit only the type.
        print(json.dumps({"error_type": type(error).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(reports, indent=2))
    return 0 if all(report["ok"] for report in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
