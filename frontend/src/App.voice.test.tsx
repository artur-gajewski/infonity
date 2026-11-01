// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import App from "./App";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  streamChat: vi.fn(),
  voice: null as any,
}));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: mocks.api,
  streamChat: mocks.streamChat,
}));
vi.mock("./VoiceInput", () => ({
  default: (props: any) => {
    mocks.voice = props;
    return null;
  },
}));
beforeEach(() => {
  localStorage.clear();
  mocks.streamChat.mockReset();
  mocks.streamChat.mockResolvedValue(undefined);
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (path) => {
    if (path === "/health")
      return { ollama_available: true, models: [], pending_embeddings: 0 };
    if (path === "/settings")
      return {
        model: "qwen3:4b",
        embedding_model: "nomic-embed-text",
        memory_limit: 8,
        memory_tokens: 1200,
        implicit_suggestions: true,
        extraction_enabled: true,
        sensitive_retrieval: false,
      };
    return { data: [] };
  });
});
afterEach(cleanup);
async function loaded(enabled = false) {
  if (enabled) localStorage.setItem("sheldon-voice-auto-send", "true");
  render(<App />);
  await screen.findByText("Ollama connected");
}
async function dictate(field: HTMLElement, text: string) {
  field.focus();
  act(() => {
    expect(mocks.voice.beforeRecord()).toBe(true);
    mocks.voice.onActiveChange(true);
  });
  act(() => {
    mocks.voice.onTranscript(text);
  });
  expect(mocks.streamChat).not.toHaveBeenCalled();
  await act(async () => mocks.voice.onActiveChange(false));
}
it("defaults automatic sending to off and persists checkbox changes", async () => {
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  const checkbox = screen.getByLabelText(
    "Automatically send voice messages",
  ) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(localStorage.getItem("sheldon-voice-auto-send")).toBe("true");
  cleanup();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  expect(
    (
      screen.getByLabelText(
        "Automatically send voice messages",
      ) as HTMLInputElement
    ).checked,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText("Automatically send voice messages"));
  expect(localStorage.getItem("sheldon-voice-auto-send")).toBe("false");
});
it("keeps transcribed messages as drafts by default", async () => {
  await loaded();
  const field = screen.getByLabelText("Message") as HTMLInputElement;
  await dictate(field, "Buy milk");
  expect(field.value).toBe("Buy milk");
  expect(mocks.streamChat).not.toHaveBeenCalled();
});
it("sends the complete chat draft exactly once after transcription finishes", async () => {
  await loaded(true);
  const field = screen.getByLabelText("Message") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "Add todo " } });
  field.setSelectionRange(9, 9);
  await dictate(field, "buy milk");
  await waitFor(() => expect(mocks.streamChat).toHaveBeenCalledOnce());
  expect(mocks.streamChat.mock.calls[0][0]).toBe("Add todo buy milk");
  expect(field.value).toBe("");
});
it("fills a document dialog without submitting it when auto-send is enabled", async () => {
  await loaded(true);
  mocks.streamChat.mockImplementationOnce(async (_text, _id, onEvent) => {
    onEvent({ type: "document_draft", title: "Notes", body: "" });
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Create document" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const dialog = await screen.findByRole("dialog", { name: "Create document" });
  await waitFor(() => expect(mocks.voice.disabled).toBe(false));
  mocks.streamChat.mockClear();
  await dictate(within(dialog).getByLabelText("Body"), "Meeting notes");
  expect(
    (within(dialog).getByLabelText("Body") as HTMLTextAreaElement).value,
  ).toBe("Meeting notes");
  expect(mocks.streamChat).not.toHaveBeenCalled();
  expect(
    mocks.api.mock.calls.some(
      ([path, method]) => path === "/memories" && method === "POST",
    ),
  ).toBe(false);
});
