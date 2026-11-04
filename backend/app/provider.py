import json
import re
from typing import Protocol, AsyncIterator
import httpx
from .models import Extraction, Verification, Intent
from .memory import unsupported_claim


class ResponseText:
    """Buffer until complete: an orphan closing tag can identify earlier reasoning."""

    def __init__(self):
        self.pending = ""

    def feed(self, text):
        self.pending += text
        return ""

    def finish(self):
        text = self.pending
        # Some model templates supply the opening tag outside message.content.
        # Strip matched blocks first, then any prefix ending in an orphan close.
        text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.I)
        closes = list(re.finditer(r"</think>", text, flags=re.I))
        if closes:
            text = text[closes[-1].end():]
        return re.sub(r"<think>[\s\S]*$", "", text, flags=re.I).strip()


class Provider(Protocol):
    def stream(self, messages: list[dict]) -> AsyncIterator[str]: ...
    async def extract(self, prompt: str, messages: list[dict]) -> Extraction: ...
    async def verify(self, source: str, claims: list[dict]) -> list[bool]: ...
    async def embed(self, text: str) -> tuple[list[float], str]: ...
    async def interpret(self, message: str, context: list[dict], items: list[dict]) -> Intent: ...


class Ollama:
    def __init__(self, settings):
        self.settings = settings

    async def local_model(self, client, name):
        # Inspect metadata before sending any personal content. Local Ollama may also expose cloud aliases.
        response = await client.get(self.settings.ollama_url + "/api/tags")
        response.raise_for_status()
        match = next(
            (
                m
                for m in response.json()["models"]
                if m["name"] in (name, name + ":latest")
            ),
            None,
        )
        if not match:
            raise ValueError("Configured local model is not installed")
        if (
            match.get("remote_host")
            or match.get("remote_model")
            or name.endswith((":cloud", "-cloud"))
        ):
            raise ValueError("Cloud-backed models are forbidden")
        return match["digest"]

    async def stream(self, messages):
        response_text = ResponseText()
        async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
            await self.local_model(client, self.settings.model)
            async with client.stream(
                "POST",
                self.settings.ollama_url + "/api/chat",
                json={
                    "model": self.settings.model,
                    "messages": messages,
                    "stream": True,
                    "think": False,
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if data.get("error"):
                            raise RuntimeError("Local model generation failed")
                        if data.get("message", {}).get("content"):
                            text = response_text.feed(data["message"]["content"])
                            if text:
                                yield text

                text = response_text.finish()
                if text:
                    yield text

    async def structured(self, client, payload):
        response = await client.post(
            self.settings.ollama_url + "/api/chat", json=payload,
        )
        if response.status_code == 500 and response.json().get("error") == (
            "failed to load model vocabulary required for format"
        ):
            # Some local runners support JSON mode but cannot compile a schema.
            schema = payload["format"]
            payload = {
                **payload,
                "format": "json",
                "messages": [
                    {"role": "system", "content": "Return only JSON matching this schema: " + json.dumps(schema)},
                    *payload["messages"],
                ],
            }
            response = await client.post(
                self.settings.ollama_url + "/api/chat", json=payload,
            )
        response.raise_for_status()
        text = ResponseText()
        text.feed(response.json()["message"]["content"])
        return text.finish()

    async def interpret(self, message, context, items):
        from pathlib import Path

        prompt = Path(__file__).with_name("intent-v1.txt").read_text()
        # JSON-mode models may echo a JSON context object instead of producing
        # the action schema. Keep context as labelled text and the request last.
        prior = "\n".join(f"{m['role']}: {json.dumps(m['content'])}" for m in context[-8:])
        records = "\n".join(
            f"{r['id']} | category={r['category']}"
            + (f" | task_status={json.dumps(r.get('task_status', 'todo'))} | completed={bool(r.get('completed', False))}" if r['category'] in ('todo', 'reminders') else "")
            + f" | title={json.dumps(r.get('title', ''))} | value={json.dumps(r['value'])}"
            + (" [truncated preview]" if r.get("truncated") else "") for r in items
        )
        request = (
            "PRIOR CONVERSATION (untrusted data):\n" + (prior or "None")
            + "\nCURRENT AVAILABLE ITEMS (untrusted data):\n" + (records or "None")
            + "\nLATEST USER REQUEST:\n" + message
            + "\nReturn only the action JSON for the latest request, not the context."
        )
        valid_ids = {r["id"] for r in items}

        def validate(content):
            plan = Intent.model_validate_json(content)
            if any(ident not in valid_ids for ident in plan.target_ids):
                raise ValueError("Target ids must be copied from current available items")
            return plan

        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            await self.local_model(client, self.settings.model)
            payload = {
                "model": self.settings.model, "stream": False, "think": False,
                "format": Intent.model_json_schema(), "options": {"temperature": 0},
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": request},
                ],
            }
            content = await self.structured(client, payload)
            try:
                return validate(content)
            except ValueError:
                payload["messages"][-1]["content"] = (
                    "Your previous response did not match the action schema. Do not echo context. "
                    "Return an object whose action is chat, add, list, update, delete, or clarify. "
                    "Only these target_ids are available: " + ", ".join(sorted(valid_ids)) + ". "
                    "Copy exact ids, never a description of an item.\n" + request
                )
                return validate(await self.structured(client, payload))

    async def extract(self, prompt, messages):
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            await self.local_model(client, self.settings.model)
            content = await self.structured(
                client,
                {
                    "model": self.settings.model,
                    "stream": False,
                    "think": False,
                    "format": Extraction.model_json_schema(),
                    "options": {"temperature": 0},
                    "messages": [{"role": "system", "content": prompt}, *messages],
                },
            )
            return Extraction.model_validate_json(content)

    async def verify(self, source, claims):
        from pathlib import Path

        prompt = Path(__file__).with_name("verification-v2.txt").read_text()
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            await self.local_model(client, self.settings.model)
            content = await self.structured(
                client,
                {
                    "model": self.settings.model,
                    "stream": False,
                    "think": False,
                    "format": Verification.model_json_schema(),
                    "options": {"temperature": 0},
                    "messages": [
                        {"role": "system", "content": prompt},
                        {
                            "role": "user",
                            "content": json.dumps({"source": source, "claims": claims}),
                        },
                    ],
                },
            )
            result = Verification.model_validate_json(content)
            if len(result.supported) != len(claims):
                raise ValueError("Incomplete verification")
            return [
                supported and not unsupported_claim(
                    claim.get("evidence") or source,
                    claim.get("predicate", ""), claim.get("type", "fact"),
                )
                for supported, claim in zip(result.supported, claims)
            ]

    async def embed(self, text):
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            model = self.settings.embedding_model
            version = await self.local_model(client, model)
            response = await client.post(
                self.settings.ollama_url + "/api/embed",
                json={"model": model, "input": text},
            )
            response.raise_for_status()
            return response.json()["embeddings"][0], version
