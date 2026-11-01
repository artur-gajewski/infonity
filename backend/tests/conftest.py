import hashlib
import pytest
from app.config import Settings
from app.db import Database
from app.memory import MemoryService, uid
from app.retrieval import Retrieval
from app.models import Extraction, Intent


class FakeProvider:
    def __init__(self):
        self.result = Extraction()
        self.intent = Intent(action="chat")
        self.intent_calls = []
        self.fail = False
        self.prompts = []
        self.version = "test-v1"

    async def interpret(self, message, context, items):
        self.intent_calls.append((message, context, items))
        return self.intent

    async def extract(self, prompt, messages):
        if self.fail:
            raise ValueError("Malformed or unavailable")
        return self.result

    async def verify(self, source, claims):
        return [True] * len(claims)

    async def embed(self, text):
        if self.fail:
            raise OSError("Ollama unavailable")
        # Stable nonzero vectors for deterministic ranking tests; never used by production.
        tokens = text.lower().split()
        vector = [0.01] * 8
        for token in tokens:
            vector[hashlib.sha256(token.encode()).digest()[0] % 8] += 1
        return vector, self.version

    async def stream(self, messages):
        self.prompts.append(messages)
        if self.fail:
            raise OSError("Ollama unavailable")
        yield "A local answer."


@pytest.fixture
def services(tmp_path):
    settings = Settings(database=str(tmp_path / "memory.db"), auto_save_memories=False)
    db = Database(settings.database)
    provider = FakeProvider()
    return (
        db,
        provider,
        MemoryService(db, provider, settings),
        Retrieval(db, provider, settings),
        settings,
    )


def source(db, content):
    conversation = uid()
    ident = uid()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO conversations(id,title) VALUES(?,?)", (conversation, "Test")
        )
        conn.execute(
            "INSERT INTO messages(id,conversation_id,role,content) VALUES(?,?,'user',?)",
            (ident, conversation, content),
        )
    return ident


def extracted(value="Clojure", **kwargs):
    return {
        "predicate": "preferred_programming_language",
        "value": value,
        "type": "preference",
        "evidence": f"Remember that my favorite language is {value}.",
        "origin": "explicit",
        **kwargs,
    }
