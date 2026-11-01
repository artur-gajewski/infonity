// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const mocks = vi.hoisted(() => ({ api: vi.fn(), streamChat: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  ...mocks,
}));
const memory = {
  id: "memory-1",
  subject: "user",
  predicate: "preferred_programming_language",
  value: "Clojure",
  type: "preference",
  scope: "general",
  state: "active",
  confidence: 1,
  importance: 0.5,
  evidence: "I enjoy Clojure.",
  sensitivity: "ordinary",
  valid_from: null,
  valid_until: null,
  version: 1,
  origin: "explicit",
  created_at: "2026-10-28",
};
const defaults = {
  model: "qwen3:4b",
  embedding_model: "nomic-embed-text",
  memory_limit: 8,
  memory_tokens: 1200,
  implicit_suggestions: true,
  extraction_enabled: true,
  sensitive_retrieval: false,
};
let memories: any[], candidates: any[], calls: any[];
beforeEach(() => {
  localStorage.clear();
  memories = [];
  candidates = [];
  calls = [];
  mocks.api.mockReset();
  mocks.streamChat.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.api.mockImplementation(async (path, method = "GET", body) => {
    calls.push({ path, method, body });
    if (path.startsWith("/actions/") && method === "POST")
      return {
        deleted: body.confirmed ? 1 : 0,
        answer: body.confirmed ? "Deleted 1 item." : "Deletion cancelled.",
      };
    if (path === "/health")
      return {
        ollama_available: true,
        models: ["qwen3:4b"],
        pending_embeddings: 0,
      };
    if (path === "/settings") return defaults;
    if (path === "/conversations") return { data: [] };
    if (path === "/memory-candidates") return { data: [...candidates] };
    if (path.startsWith("/memory-candidates/") && method === "POST") {
      if (path.endsWith("/approve")) memories = [memory];
      candidates = [];
      return { approved: path.endsWith("/approve") };
    }
    if (path.startsWith("/memories?")) return { data: [...memories] };
    if (path === "/memories/memory-1" && method === "PATCH") {
      memories = [{ ...memory, ...body.memory, version: 2 }];
      return { data: memories[0] };
    }
    if (path === "/memories/memory-1" && method === "DELETE") {
      memories = [];
      return { deleted: 1 };
    }
    return { data: [] };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function loaded() {
  render(<App />);
  await screen.findByText("Ollama connected");
}

describe("local AI workflows", () => {
  it("defaults to dark and preserves the selected theme after remounting", async () => {
    await loaded();
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("still-theme")).toBe("light");
    cleanup();
    await loaded();
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("still-theme")).toBe("dark");
  });
  it("keeps theme switching usable when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("shows local status and a usable empty conversation", async () => {
    await loaded();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "New conversation" }),
    ).toBeTruthy();
  });
  it.each([false, true])(
    "shows a spinner while waiting and clears it on completion (failure: %s)",
    async (failure) => {
      let finish!: () => void;
      mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (failure) throw new Error("Connection failed");
        onEvent({ type: "delta", text: "You like pizza." });
        onEvent({ type: "done" });
      });
      await loaded();
      expect(
        screen.queryByRole("status", { name: "Waiting for response" }),
      ).toBeNull();
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: "What do I like?" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      expect(
        screen.getByRole("status", { name: "Waiting for response" }),
      ).toBeTruthy();
      finish();
      await screen.findByText(
        failure ? "Connection failed" : "You like pizza.",
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("status", { name: "Waiting for response" }),
        ).toBeNull(),
      );
    },
  );
  it.each(["Escape", "Stop button"])(
    "cancels an active request using %s",
    async (control) => {
      let signal!: AbortSignal;
      mocks.streamChat.mockImplementation(
        async (_message, _id, _onEvent, requestSignal) => {
          signal = requestSignal;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
      );
      await loaded();
      const field = screen.getByRole("textbox", { name: "Message" });
      fireEvent.change(field, { target: { value: "Tell me a story" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      expect(signal.aborted).toBe(false);
      if (control === "Escape") {
        field.focus();
        fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
      } else fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
      expect(signal.aborted).toBe(true);
      await waitFor(() =>
        expect(
          screen.queryByRole("status", { name: "Waiting for response" }),
        ).toBeNull(),
      );
      expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
    },
  );
  it("scrolls repeated long replies above the floating composer", async () => {
    let finish!: () => void;
    mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      onEvent({ type: "delta", text: "Buy groceries\n".repeat(100) });
      onEvent({ type: "done" });
    });
    await loaded();
    const input = screen.getByRole("textbox", { name: "Message" });
    const composer = input.closest(".composer-wrap")!;
    const pane = document.querySelector(".chat-scroll")!;
    Object.defineProperty(pane, "scrollHeight", {
      configurable: true,
      get: () =>
        pane.querySelectorAll(".message.assistant").length * 3000 + 100,
    });
    for (let i = 0; i < 4; i++) {
      fireEvent.change(input, { target: { value: "Show todo" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      expect(
        screen.getByRole("status", { name: "Waiting for response" }),
      ).toBeTruthy();
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
      await act(async () => {
        finish();
      });
      expect(
        screen.queryByRole("status", { name: "Waiting for response" }),
      ).toBeNull();
      expect(pane.scrollTop).toBe((i + 1) * 3000 + 100);
      expect(composer.contains(input)).toBe(true);
    }
  });
  it.each(["chat", "library"])(
    "opens document links from %s and edits the stored body",
    async (location) => {
      const document = {
        ...memory,
        category: "documents",
        title: "JEE",
        predicate: "item",
        value: "Original body",
      };
      memories = [document];
      const originalApi = mocks.api.getMockImplementation()!;
      mocks.api.mockImplementation(async (path, method = "GET", body) => {
        if (path === "/memories/memory-1" && method === "GET") {
          return { data: { ...document, value: "Current body from storage" } };
        }
        return originalApi(path, method, body);
      });
      mocks.streamChat.mockImplementation(async (_message, _id, onEvent) => {
        onEvent({ type: "retrieved", memories: [document] });
        onEvent({ type: "delta", text: "Here's what's in Documents:\n• JEE" });
      });
      await loaded();
      if (location === "chat") {
        fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
          target: { value: "Show documents" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      } else
        fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
      fireEvent.click(await screen.findByRole("link", { name: "JEE" }));
      const dialog = await screen.findByRole("dialog", { name: "Document" });
      expect(globalThis.document.activeElement).toBe(
        within(dialog).getByRole("heading", { name: "JEE" }),
      );
      expect(dialog.scrollTop).toBe(0);
      expect(
        within(dialog).getByText("Current body from storage"),
      ).toBeTruthy();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Edit memory" }),
      );
      const editor = screen.getByRole("dialog", { name: "Edit memory" });
      expect(
        (within(editor).getByLabelText("Title") as HTMLInputElement).value,
      ).toBe("JEE");
      fireEvent.change(within(editor).getByLabelText("Body"), {
        target: { value: "Updated document body" },
      });
      fireEvent.click(
        within(editor).getByRole("button", { name: "Save memory" }),
      );
      await waitFor(() =>
        expect(
          calls.find((call) => call.method === "PATCH")?.body.memory.value,
        ).toBe("Updated document body"),
      );
    },
  );
  it.each(["Create document", "Cancel", "Escape"])(
    "opens a document dialog and handles %s",
    async (choice) => {
      mocks.streamChat.mockImplementation(async (_message, _id, onEvent) => {
        onEvent({ type: "document_draft", title: "JEE", body: "" });
        onEvent({
          type: "delta",
          text: "Enter the document details in the dialog, then choose Create document.",
        });
      });
      await loaded();
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: 'Create a document called "JEE"' },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Create document",
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("status", { name: "Waiting for response" }),
        ).toBeNull(),
      );
      expect(
        (within(dialog).getByLabelText("Title") as HTMLInputElement).value,
      ).toBe("JEE");
      expect(
        calls.some(
          (call) => call.path === "/memories" && call.method === "POST",
        ),
      ).toBe(false);
      expect(
        (
          within(dialog).getByRole("button", {
            name: "Create document",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      fireEvent.change(within(dialog).getByLabelText("Body"), {
        target: { value: "These are my document notes." },
      });
      if (choice === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else
        fireEvent.click(within(dialog).getByRole("button", { name: choice }));
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Create document" }),
        ).toBeNull(),
      );
      const save = calls.find(
        (call) => call.path === "/memories" && call.method === "POST",
      );
      if (choice === "Create document") {
        expect(save.body).toEqual({
          category: "documents",
          predicate: "item",
          title: "JEE",
          value: "These are my document notes.",
        });
        await screen.findByText(/Created document: JEE/);
      } else expect(save).toBeUndefined();
    },
  );
  it("shows an interpretation error in chat instead of an empty assistant reply", async () => {
    mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
      onEvent({
        type: "error",
        message:
          "I couldn't interpret that request reliably. Please rephrase it.",
      });
    });
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Show links containing www" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(
      "I couldn't interpret that request reliably. Please rephrase it.",
    );
    expect(screen.queryByText("No response received.")).toBeNull();
  });
  it("shows only the response when an assistant message contains thinking", async () => {
    mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
      expect(screen.queryByText("Thinking…")).toBeNull();
      onEvent({ type: "delta", text: "Private reasoning</think>The answer." });
      onEvent({ type: "done" });
    });
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("The answer.");
    expect(screen.queryByText(/Private reasoning/)).toBeNull();
  });
  it("submits a message and displays streaming text and memory provenance", async () => {
    mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
      onEvent({ type: "conversation", id: "chat-1" });
      onEvent({ type: "retrieved", memories: [memory] });
      onEvent({ type: "delta", text: "Your favorite language is Clojure." });
      onEvent({ type: "done" });
    });
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "What language do I prefer?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Your favorite language is Clojure.");
    expect(screen.getByText("1 memories provided as context")).toBeTruthy();
    expect(mocks.streamChat.mock.calls[0][0]).toBe(
      "What language do I prefer?",
    );
  });
  it("uses a single New conversation navigation button to start a fresh chat", async () => {
    mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
      onEvent({ type: "delta", text: "You like pizza." });
      onEvent({ type: "done" });
    });
    await loaded();
    expect(
      screen.getAllByRole("button", { name: /New conversation/ }),
    ).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("You like pizza.");
    fireEvent.click(screen.getByRole("button", { name: /New conversation/ }));
    expect(screen.queryByText("You like pizza.")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "New conversation" }),
    ).toBeTruthy();
  });
  it.each(["Confirm", "Cancel", "Escape"])(
    "waits for deletion confirmation and handles %s",
    async (choice) => {
      mocks.streamChat.mockImplementation(async (message, id, onEvent) => {
        onEvent({
          type: "confirmation",
          id: "pending-1",
          text: "Delete Todo: Buy milk?",
        });
        onEvent({ type: "delta", text: "Please confirm the deletion." });
        onEvent({ type: "done" });
      });
      await loaded();
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: "Erase the milk task" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      await screen.findByRole("alertdialog");
      expect(screen.getByText("Delete Todo: Buy milk?")).toBeTruthy();
      expect(calls.some((c) => c.path.startsWith("/actions/"))).toBe(false);
      if (choice === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else fireEvent.click(screen.getByRole("button", { name: choice }));
      await screen.findByText(
        choice === "Confirm" ? "Deleted 1 item." : "Deletion cancelled.",
      );
      expect(
        calls.find((c) => c.path === "/actions/pending-1/confirm").body,
      ).toEqual({ confirmed: choice === "Confirm" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
    },
  );
  it("does not show suggestion approval controls", async () => {
    await loaded();
    expect(screen.queryByRole("button", { name: /Suggestions/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(
      screen.queryByLabelText("Suggest implicit memories for approval"),
    ).toBeNull();
  });
  it("opens categories and preserves the category when editing an item", async () => {
    memories = [{ ...memory, category: "todo" }];
    await loaded();
    expect(screen.queryByRole("navigation", { name: "Categories" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "todo" },
    });
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes("category=todo"))).toBe(true),
    );
    expect(screen.getByRole("heading", { name: "Todo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(
      within(
        screen.getByRole("dialog", { name: "Edit memory" }),
      ).getByLabelText("Category"),
      { target: { value: "documents" } },
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === "PATCH")?.body.memory.category,
      ).toBe("documents"),
    );
    expect(calls.find((c) => c.method === "PATCH").body.memory).toMatchObject({
      title: "Notes",
      value: memory.value,
    });
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Category") as HTMLSelectElement).value,
      ).toBe(""),
    );
  });
  it("edits task completion without rewriting the task", async () => {
    memories = [{ ...memory, category: "todo", completed: false }];
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Task status"), {
      target: { value: "done" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === "PATCH")?.body.memory.completed,
      ).toBe(true),
    );
    expect(calls.find((c) => c.method === "PATCH").body.memory.value).toBe(
      memory.value,
    );
    expect(
      calls.find((c) => c.method === "PATCH").body.memory.task_status,
    ).toBe("done");
  });
  it("edits a memory with its optimistic version", async () => {
    memories = [memory];
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "Scala" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await screen.findByText("Scala");
    const call = calls.find((c) => c.method === "PATCH");
    expect(call.body.version).toBe(1);
    expect(call.body.memory.value).toBe("Scala");
    expect(call.body.memory).not.toHaveProperty("id");
  });
  it("deletes only after a concrete confirmation", async () => {
    memories = [memory];
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText(/No memories here yet/);
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });
  it("saves a selected model and explicit sensitive-context control", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    fireEvent.change(screen.getByLabelText("Chat model"), {
      target: { value: "llama3.2" },
    });
    fireEvent.click(
      screen.getByLabelText("Allow sensitive memories in AI context"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    expect(
      calls.find((c) => c.path === "/settings" && c.method === "PATCH").body,
    ).toMatchObject({ model: "llama3.2", sensitive_retrieval: true });
  });
  it("confirms conversation deletion separately from saved memories", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete recent conversations" }),
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete recent conversations" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Recent conversations deleted.");
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([
      { path: "/conversations", method: "DELETE", body: undefined },
    ]);
  });
  it("learns, persists, and clears a voice recording key in settings", async () => {
    await loaded();
    expect(screen.queryByRole("button", { name: "Hold to talk" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByText("Not assigned")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));
    fireEvent.keyDown(window, { key: "F8", code: "F8" });
    fireEvent.keyUp(window, { key: "F8", code: "F8" });
    expect(screen.getByText("F8")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("sheldon-voice-key")!)).toEqual({
      code: "F8",
      label: "F8",
    });
    cleanup();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByText("F8")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(screen.getByText("F8")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear voice key" }));
    expect(screen.getByText("Not assigned")).toBeTruthy();
    expect(localStorage.getItem("sheldon-voice-key")).toBeNull();
  });
  it("renders saved URLs as clickable links in chat lists and the library", async () => {
    const link = {
      ...memory,
      category: "links",
      title: "YouTube",
      value: "https://youtube.com/watch?v=123",
    };
    memories = [link];
    mocks.streamChat.mockImplementation(async (_message, _id, onEvent) => {
      onEvent({ type: "retrieved", memories: [link] });
      onEvent({
        type: "delta",
        text: "Here's what's in Links:\n• YouTube: https://youtube.com/watch?v=123",
      });
    });
    await loaded();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Show links" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const chatLink = await screen.findByRole("link", {
      name: "https://youtube.com/watch?v=123",
    });
    expect(chatLink.getAttribute("href")).toBe(link.value);
    expect(chatLink.getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    const savedLink = screen.getByRole("link", { name: link.value });
    expect(savedLink.getAttribute("href")).toBe(link.value);
    expect(savedLink.getAttribute("target")).toBe("_blank");
  });
  it("renders personal content as text rather than executable HTML", async () => {
    memories = [
      { ...memory, value: '<img src=x onerror="window.pwned=true">' },
    ];
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Memory library/ }));
    expect(
      screen.getByText('<img src=x onerror="window.pwned=true">'),
    ).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
