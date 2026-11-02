"""Check benchmark isolation and failure reporting without requiring Ollama."""

import importlib.util
import json
from pathlib import Path

from app.config import Settings
from app.models import Extraction, Extracted
from conftest import FakeProvider

spec = importlib.util.spec_from_file_location(
    "memory_benchmark", Path(__file__).resolve().parents[2] / "scripts/benchmark_memory.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


async def test_benchmark_isolated_and_content_free(tmp_path):
    live = tmp_path / "live.db"
    live.write_bytes(b"must not open this database")
    provider = FakeProvider()
    provider.result = Extraction(memories=[Extracted(
        predicate="favorite_language", value="Clojure",
        evidence="my favorite language is Clojure",
    )])
    reports = await module.benchmark(Settings(database=str(live)), provider, runs=2, size=3)
    assert live.read_bytes() == b"must not open this database"
    assert len(reports) == 8
    assert all(report["ok"] for report in reports)
    assert {report["stage"] for report in reports} == {"save", "index", "retrieve", "answer"}
    assert reports[0]["saved_count"] == 1
    assert reports[1]["processed"] == 4
    assert reports[0]["extract_ms"] >= 0
    assert reports[0]["verify_ms"] >= 0
    assert reports[2]["embed_ms"] >= 0
    assert reports[2]["sqlite_ms"] > 0
    assert "Clojure" not in json.dumps(reports)


async def test_benchmark_marks_swallowed_provider_failures(tmp_path):
    provider = FakeProvider()
    provider.fail = True
    # Avoid generation raising so we can inspect errors swallowed by services.
    async def stream(messages):
        yield "Synthetic response"
    provider.stream = stream
    reports = await module.benchmark(Settings(), provider, runs=1, size=1)
    assert not reports[0]["ok"]
    assert not reports[1]["ok"]
    assert reports[1]["failed"] == 1
    assert not reports[2]["ok"]
