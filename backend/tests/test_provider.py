"""Exercise the real Ollama HTTP adapter with deterministic HTTP responses."""

import json
import httpx
import pytest
from app.provider import Ollama, ResponseText
from app.models import Extraction
from app.config import Settings


@pytest.fixture
def provider(monkeypatch):
    requests = []
    response_data = {"chat": {"message": {"content": '{"memories":[]}'}}}

    def handler(request):
        requests.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {"name": "nomic-embed-text:latest", "digest": "sha256:test"},
                        {"name": "qwen3:4b", "digest": "sha256:chat"},
                        {
                            "name": "remote-alias",
                            "digest": "sha256:remote",
                            "remote_host": "https://example.com",
                            "remote_model": "remote",
                        },
                    ]
                },
            )
        body = json.loads(request.content)
        if request.url.path == "/api/embed":
            return httpx.Response(200, json={"embeddings": [[0.2, 0.3]]})
        if isinstance(body.get("format"), dict) and response_data.get("schema_error"):
            return httpx.Response(500, json={"error": response_data["schema_error"]})
        if body.get("stream"):
            return httpx.Response(
                200, content="\n".join(json.dumps(chunk) for chunk in response_data.get(
                    "stream", [{"message": {"content": "Hello"}}, {"done": True}]
                )) + "\n"
            )
        return httpx.Response(200, json=response_data["chat_sequence"].pop(0) if response_data.get("chat_sequence") else response_data["chat"])

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    return (
        Ollama(
            Settings(
                model="qwen3:4b", embedding_model="nomic-embed-text", _env_file=None
            )
        ),
        requests,
        response_data,
    )


async def test_structured_schema_and_embedding_digest(provider):
    p, requests, data = provider
    result = await p.extract("policy", [{"role": "user", "content": "Hello"}])
    assert isinstance(result, Extraction)
    request = json.loads(next(r for r in requests if r.url.path == "/api/chat").content)
    assert request["format"]["type"] == "object" and request["stream"] is False
    vector, digest = await p.embed("Hello")
    assert vector == [0.2, 0.3] and digest == "sha256:test"


async def test_stream_ndjson(provider):
    p, requests, data = provider
    assert [c async for c in p.stream([{"role": "user", "content": "Hello"}])] == [
        "Hello"
    ]


async def test_rejects_malformed_structured_output(provider):
    p, requests, data = provider
    data["chat"] = {"message": {"content": "not json"}}
    with pytest.raises(ValueError):
        await p.extract("policy", [])


async def test_verification_schema_and_length(provider):
    p, requests, data = provider
    data["chat"] = {"message": {"content": '{"supported":[false]}'}}
    assert await p.verify("I do not like Scala", [{"value": "Scala"}]) == [False]
    data["chat"] = {"message": {"content": '{"supported":[]}'}}
    with pytest.raises(ValueError):
        await p.verify("source", [{"value": "Scala"}])


async def test_cloud_backed_alias_rejected_before_content_is_sent(provider):
    p, requests, data = provider
    p.settings.model = "remote-alias"
    with pytest.raises(ValueError, match="Cloud-backed"):
        await p.extract(
            "private policy", [{"role": "user", "content": "private personal data"}]
        )
    assert not any(r.url.path == "/api/chat" for r in requests)


async def test_missing_model_fails_without_remote_fallback(provider):
    p, requests, data = provider
    p.settings.model = "missing-model"
    with pytest.raises(ValueError, match="not installed"):
        await p.extract("private policy", [])
    assert not any(r.url.path == "/api/chat" for r in requests)


@pytest.mark.parametrize("chunks, expected", [
    (["<thi", "nk>private reasoning</th", "ink>Answer."], "Answer."),
    (["<think>unfinished reasoning"], ""),
    (["Private reasoning", "</thi", "nk>Answer."], "Answer."),
    (["Private reasoning</think>Answer."], "Answer."),
    (["First<think>hidden</think>Second<think>hidden</think>Third"], "FirstSecondThird"),
    (["A < B and ", "C > D."], "A < B and C > D."),
])
def test_response_text_filters_thinking_across_chunks(chunks, expected):
    text = ResponseText()
    for chunk in chunks:
        assert text.feed(chunk) == ""
    assert text.finish() == expected


async def test_thinking_field_is_not_streamed(provider):
    p, requests, data = provider
    data["stream"] = [
        {"message": {"thinking": "Private reasoning"}},
        {"message": {"content": "<thi"}},
        {"message": {"content": "nk>More reasoning</think>Answer."}},
        {"done": True},
    ]
    assert "".join([c async for c in p.stream([])]) == "Answer."
    request = json.loads(next(r for r in requests if r.url.path == "/api/chat").content)
    assert request["think"] is False


async def test_json_fallback_preserves_schema_validation_and_verification(provider):
    p, requests, data = provider
    data["schema_error"] = "failed to load model vocabulary required for format"
    result = await p.extract("policy", [{"role": "user", "content": "Hello"}])
    assert result.memories == []
    posts = [json.loads(r.content) for r in requests if r.url.path == "/api/chat"]
    assert len(posts) == 2
    assert posts[-1]["format"] == "json"
    assert "schema" in posts[-1]["messages"][0]["content"]
    data["chat"] = {"message": {"content": '{"memories":[{"value":"invalid"}]}'}}
    with pytest.raises(ValueError):
        await p.extract("policy", [])
    data["chat"] = {"message": {"content": '{"supported":[true]}'}}
    assert await p.verify("source", [{"value": "source"}]) == [True]


async def test_unrelated_schema_errors_are_not_retried(provider):
    p, requests, data = provider
    data["schema_error"] = "model failed"
    with pytest.raises(httpx.HTTPStatusError):
        await p.extract("policy", [])
    assert len([r for r in requests if r.url.path == "/api/chat"]) == 1


async def test_intent_uses_validated_schema_and_untrusted_context(provider):
    p, requests, data = provider
    data["chat"] = {"message": {"content": '{"action":"add","category":"todo","content":"buy milk"}'}}
    result = await p.interpret("Add todo buy milk", [], [])
    assert result.action == "add" and result.category == "todo"
    body = json.loads(next(r for r in requests if r.url.path == "/api/chat").content)
    assert body["think"] is False and body["stream"] is False
    assert "Add todo buy milk" in body["messages"][-1]["content"]
    assert "CURRENT AVAILABLE ITEMS" in body["messages"][-1]["content"]
    data["chat"] = {"message": {"content": '{"action":"execute","url":"https://example.com"}'}}
    with pytest.raises(ValueError):
        await p.interpret("Hello", [], [])


async def test_invalid_intent_is_retried_once_without_echoing_context(provider):
    p, requests, data = provider
    data["chat_sequence"] = [
        {"message": {"content": '{"available_items":[]}' }},
        {"message": {"content": '{"action":"list","category":"links","query":"www"}' }},
    ]
    result = await p.interpret("Show links containing www", [{"role": "assistant", "content": "Earlier list"}],
                               [{"id": "item_1", "category": "links", "value": "www.ag.com", "title": ""}])
    assert result.action == "list" and result.query == "www"
    posts = [json.loads(r.content) for r in requests if r.url.path == "/api/chat"]
    assert len(posts) == 2
    assert "previous response did not match" in posts[-1]["messages"][-1]["content"]
    assert "item_1 | category=links" in posts[0]["messages"][-1]["content"]


async def test_persistently_invalid_intent_does_not_retry_forever(provider):
    p, requests, data = provider
    data["chat"] = {"message": {"content": '{"available_items":[]}'}}
    with pytest.raises(ValueError):
        await p.interpret("Show links", [], [])
    assert len([r for r in requests if r.url.path == "/api/chat"]) == 2
