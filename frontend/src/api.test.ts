import { afterEach, describe, it, expect, vi } from "vitest";
import { api, streamChat, memoryInput, type Memory } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("API transport", () => {
  it("surfaces structured server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Memory changed" } }),
            { status: 409 },
          ),
        ),
    );
    await expect(api("/memories/x", "DELETE")).rejects.toThrow(
      "Memory changed",
    );
  });
  it("handles UTF-8 and SSE across network boundaries", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(
      'data: {"type":"delta","text":"héllo"}\n\ndata: {"type":"done"}\n\n',
    );
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const events: any[] = [];
    await streamChat("hi", null, (e) => events.push(e));
    expect(events).toEqual([
      { type: "delta", text: "héllo" },
      { type: "done" },
    ]);
  });
  it("rejects unsuccessful chat requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    await expect(streamChat("hi", null, () => {})).rejects.toThrow("Unable");
  });
  it("imports only validated memory fields", () => {
    const m = {
      id: "a",
      value: "Scala",
      predicate: "language",
      subject: "user",
      scope: "general",
      confidence: 1,
      importance: 0.5,
      evidence: "Scala",
      sensitivity: "ordinary",
      valid_from: null,
      valid_until: null,
      type: "preference",
      state: "active",
      version: 2,
      origin: "explicit",
      created_at: "today",
    } as Memory;
    const input = memoryInput(m);
    expect(input.value).toBe("Scala");
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("state");
  });
});

it("reports a truncated stream instead of silently accepting an incomplete answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response('data: {"type":"delta","text":"Partial"}\n\n'),
      ),
  );
  await expect(streamChat("hi", null, () => {})).rejects.toThrow("interrupted");
});
it("does not display an HTML error page as a server error", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response("<html>error</html>", { status: 502 })),
  );
  await expect(api("/settings")).rejects.toThrow("invalid response (502)");
});

for (const payload of [null, { detail: { reason: "failure" } }]) {
  it(`handles nonstandard error payloads: ${JSON.stringify(payload)}`, async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(payload), { status: 500 }),
        ),
    );
    await expect(api("/settings")).rejects.toThrow("Request failed (500).");
  });
}

it("supports CRLF, multiline data, and data without a space across chunks", async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n\r\ndata:{"type":"delta",\r\ndata: "text":"hello"}\r\n\r\ndata:{"type":"done"}\r\n\r\n',
  );
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const events: unknown[] = [];
  await streamChat("hi", null, (event) => events.push(event));
  expect(events).toEqual([{ type: "delta", text: "hello" }, { type: "done" }]);
});

it("rejects invalid chat event shapes with a useful error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("data: null\n\n")),
  );
  await expect(streamChat("hi", null, () => {})).rejects.toThrow(
    "invalid chat event",
  );
});
