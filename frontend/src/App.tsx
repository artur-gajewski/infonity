import FileUpload from "./components/FileUpload";
import AppHeader from "./components/AppHeader";
import DocumentViewer from "./components/DocumentViewer";
import ConfirmationDialog from "./components/ConfirmationDialog";
import MemoryEditor from "./components/MemoryEditor";
import ModelSettingsForm from "./components/ModelSettingsForm";
import MemoryCard from "./components/MemoryCard";
import Sidebar from "./components/Sidebar";
import ChatPanel from "./components/ChatPanel";
import { categories, type Settings } from "./ui";
import VoiceKeySettings, {
  readVoiceKey,
  type VoiceKey,
} from "./VoiceKeySettings";
import { isDictationField, insertDictation, type TextField } from "./dictation";
import VoiceInput from "./VoiceInput";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  streamChat,
  memoryInput,
  type Memory,
  type Conversation,
  type Message,
} from "./api";

export default function App() {
  const [voiceKey, setVoiceKey] = useState<VoiceKey | null>(readVoiceKey);
  const [voiceAutoSend, setVoiceAutoSend] = useState(() => {
    try {
      return localStorage.getItem("sheldon-voice-auto-send") === "true";
    } catch {
      return false;
    }
  });
  function saveVoiceAutoSend(enabled: boolean) {
    setVoiceAutoSend(enabled);
    try {
      localStorage.setItem("sheldon-voice-auto-send", String(enabled));
    } catch {
      /* Keep the setting usable for this session. */
    }
  }
  const saveVoiceKey = React.useCallback((binding: VoiceKey | null) => {
    setVoiceKey(binding);
    try {
      if (binding)
        localStorage.setItem("sheldon-voice-key", JSON.stringify(binding));
      else localStorage.removeItem("sheldon-voice-key");
    } catch {
      /* Binding remains usable for this session. */
    }
  }, []);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("still-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#181818" : "#f7f7f7");
    try {
      localStorage.setItem("still-theme", theme);
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }, [theme]);
  const [view, setView] = useState("chat"),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [conversation, setConversation] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [voiceActive, setVoiceActive] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [memories, setMemories] = useState<Memory[]>([]),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState("active"),
    [scope, setScope] = useState(""),
    [settings, setSettings] = useState<Settings | null>(null),
    [health, setHealth] = useState<{
      ollama_available: boolean;
      models: string[];
      pending_embeddings: number;
    } | null>(null),
    [inspected, setInspected] = useState<any>(null),
    [editing, setEditing] = useState<Memory | null>(null),
    [openedDocument, setOpenedDocument] = useState<Memory | null>(null),
    [documentDraft, setDocumentDraft] = useState<{
      title: string;
      body: string;
    } | null>(null),
    [savingDocument, setSavingDocument] = useState(false),
    [documentError, setDocumentError] = useState(""),
    [forgetTopic, setForgetTopic] = useState(""),
    [deleteHistory, setDeleteHistory] = useState(false),
    [confirm, setConfirm] = useState<{
      text: string;
      action: () => Promise<void>;
      cancel?: () => void;
    } | null>(null);
  const messageInput = useRef<HTMLInputElement>(null);
  const dictationTarget = useRef<TextField | null>(null);
  const autoSendPending = useRef(false);
  useEffect(() => {
    if (!autoSendPending.current || voiceActive) return;
    autoSendPending.current = false;
    if (
      voiceAutoSend &&
      view === "chat" &&
      !busy &&
      !document.querySelector('[aria-modal="true"]')
    )
      void send();
  }, [input, voiceActive, voiceAutoSend, view, busy]);
  const composer = useRef<HTMLDivElement>(null),
    chatContent = useRef<HTMLDivElement>(null),
    chatScroll = useRef<HTMLDivElement>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!busy) return;
    const stopOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        document.querySelector(
          '[data-voice-learning="true"], [aria-modal="true"]',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      controller.current?.abort();
    };
    window.addEventListener("keydown", stopOnEscape, true);
    return () => window.removeEventListener("keydown", stopOnEscape, true);
  }, [busy]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateHeight = () => {
      const root = document.documentElement;
      root.style.setProperty(
        "--app-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.style.setProperty(
        "--keyboard-inset",
        `${
          viewport
            ? Math.max(
                0,
                window.innerHeight - viewport.height - viewport.offsetTop,
              )
            : 0
        }px`,
      );
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    viewport?.addEventListener("resize", updateHeight);
    viewport?.addEventListener("scroll", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("scroll", updateHeight);
      document.documentElement.style.removeProperty("--keyboard-inset");
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
  useLayoutEffect(() => {
    const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"]',
        ),
      );
    const initialFocus =
      modal.querySelector<HTMLElement>(".document-dialog-title") ||
      controls()[0];
    initialFocus?.focus({ preventScroll: true });
    modal.scrollTop = 0;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInspected(null);
        setEditing(null);
        setOpenedDocument(null);
        if (!savingDocument) setDocumentDraft(null);
        confirm?.cancel?.();
        setConfirm(null);
      }
      if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === initialFocus)
        ) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [
    !!inspected,
    !!editing,
    !!documentDraft,
    !!openedDocument,
    savingDocument,
    confirm,
  ]);
  async function refresh() {
    const [c, m, s, h] = await Promise.all([
      api("/conversations"),
      api(
        `/memories?state=${status}&q=${encodeURIComponent(query)}&type=${kind}&scope=${encodeURIComponent(scope)}&category=${category}`,
      ),
      api("/settings"),
      api("/health"),
    ]);
    setConversations(c.data);
    setMemories(m.data);
    setSettings(s);
    setHealth(h);
  }
  async function act(fn: () => Promise<void>) {
    try {
      setError("");
      await fn();
      await refresh();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  useEffect(() => {
    void act(refresh);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    void api(
      `/memories?state=${status}&q=${encodeURIComponent(query)}&type=${kind}&scope=${encodeURIComponent(scope)}&category=${category}`,
    )
      .then((r) => setMemories(r.data))
      .catch((e) => setError(e.message));
  }, [query, kind, status, scope, category]);
  useLayoutEffect(() => {
    const pane = chatScroll.current;
    if (!pane) return;
    const scrollToLatest = () => {
      pane.scrollTop = pane.scrollHeight;
    };
    scrollToLatest();
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [messages, busy, notice, view]);
  useEffect(() => {
    const pane = chatScroll.current;
    const content = chatContent.current;
    if (!pane || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [view]);
  useLayoutEffect(() => {
    const inputBar = composer.current;
    const pane = chatScroll.current;
    if (!inputBar || !pane) return;
    const reserveSpace = () => {
      pane.style.setProperty(
        "--composer-height",
        `${inputBar.getBoundingClientRect().height}px`,
      );
      pane.scrollTop = pane.scrollHeight;
    };
    reserveSpace();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(inputBar);
    return () => observer.disconnect();
  }, [view]);
  async function openConversation(id: string) {
    if (busy) return;
    await act(async () => {
      const r = await api(`/conversations/${id}`);
      setConversation(id);
      setMessages(r.data.messages);
      setView("chat");
      setNotice("");
    });
  }
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || busy || voiceActive) return;
    const text = input;
    setInput("");
    setError("");
    setBusy(true);
    setNotice("Checking relevant memories…");
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    controller.current = new AbortController();
    const showFailure = (message: string) => {
      setMessages((m) =>
        m.map((x, i) =>
          i === m.length - 1 && x.role === "assistant"
            ? {
                ...x,
                content: x.content ? `${x.content}\n\n${message}` : message,
              }
            : x,
        ),
      );
    };
    try {
      await streamChat(
        text,
        conversation,
        (event) => {
          if (event.type === "conversation") setConversation(event.id);
          if (event.type === "delta")
            setMessages((m) =>
              m.map((x, i) =>
                i === m.length - 1
                  ? { ...x, content: x.content + event.text }
                  : x,
              ),
            );
          if (event.type === "document_draft") {
            setDocumentError("");
            setDocumentDraft({
              title: event.title || "",
              body: event.body || "",
            });
            setNotice("");
          }
          if (event.type === "confirmation") {
            setNotice("");
            askConfirm(
              event.text,
              async () => {
                const result = await api(
                  `/actions/${event.id}/confirm`,
                  "POST",
                  { confirmed: true },
                );
                setInspected(null);
                setMessages((m) => [
                  ...m,
                  { role: "assistant", content: result.answer },
                ]);
                setNotice("");
              },
              () => {
                void api(`/actions/${event.id}/confirm`, "POST", {
                  confirmed: false,
                })
                  .then((result) =>
                    setMessages((m) => [
                      ...m,
                      { role: "assistant", content: result.answer },
                    ]),
                  )
                  .catch((e) => setError(e.message));
              },
            );
          }
          if (event.type === "memory")
            setNotice(event.warning || `${event.saved.length} memories saved`);
          if (event.type === "retrieved") {
            setMessages((m) =>
              m.map((x, i) =>
                i === m.length - 1 ? { ...x, memories: event.memories } : x,
              ),
            );
            if (event.warning) setNotice(event.warning);
          }
          if (event.type === "forgotten") {
            setNotice(
              `Deleted ${event.deleted} memories. Earlier chat is excluded from AI context.`,
            );
            setInspected(null);
            setMessages([]);
            setConversation(null);
          }
          if (event.type === "action" && event.operation === "delete")
            setInspected(null);
          if (event.type === "error") showFailure(event.message);
        },
        controller.current.signal,
      );
      await refresh();
    } catch (e) {
      showFailure(
        (e as Error).name === "AbortError"
          ? "Generation stopped."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  function newChat() {
    if (busy) return;
    setConversation(null);
    setMessages([]);
    setView("chat");
    setNotice("");
  }
  function askConfirm(
    text: string,
    action: () => Promise<void>,
    cancel?: () => void,
  ) {
    setConfirm({ text, action, cancel });
  }
  async function openDocument(id: string) {
    await act(async () => {
      const result = await api(`/memories/${id}`);
      setOpenedDocument(result.data);
    });
  }
  async function inspect(m: Memory) {
    await act(async () =>
      setInspected((await api(`/memories/${m.id}/history`)).data),
    );
  }
  const titles: Record<string, string> = {
    chat: "Conversation",
    memories: "Memory library",
    settings: "Settings",
    upload: "Upload file",
  };
  return (
    <div className="shell">
      <Sidebar
        view={view}
        busy={busy}
        conversations={conversations}
        conversation={conversation}
        connected={!!health?.ollama_available}
        newChat={newChat}
        navigate={(id) => {
          if (id === "create-document") {
            setDocumentError("");
            setDocumentDraft({ title: "", body: "" });
            return;
          }
          setView(id);
          if (id === "memories") setCategory("");
        }}
        openConversation={openConversation}
        deleteConversation={(c) =>
          askConfirm(
            "Delete this conversation? Memories remain in your library.",
            async () => {
              await api(`/conversations/${c.id}`, "DELETE");
              if (c.id === conversation) newChat();
            },
          )
        }
      />
      <main>
        <AppHeader
          title={
            view === "memories" && category
              ? categories.find(([id]) => id === category)?.[1] || "General"
              : titles[view]
          }
          theme={theme}
          model={settings?.model}
          onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        />
        <section
          className={"workspace " + (view === "chat" ? "chat-workspace" : "")}
        >
          <div className="page-heading">
            {view === "chat" && (
              <select
                className="mobile-conversations"
                aria-label="Open conversation"
                value={conversation || ""}
                disabled={busy}
                onChange={(e) =>
                  e.target.value
                    ? void openConversation(e.target.value)
                    : newChat()
                }
              >
                <option value="">New conversation</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
            {view === "memories" && (
              <span className="total">{memories.length} memories</span>
            )}
          </div>
          {error && (
            <div role="alert" className="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {view === "chat" && (
            <ChatPanel
              messages={messages}
              busy={busy}
              notice={notice}
              input={input}
              voiceActive={voiceActive}
              setInput={setInput}
              send={send}
              chatScroll={chatScroll}
              chatContent={chatContent}
              composer={composer}
              messageInput={messageInput}
              openDocument={openDocument}
              inspect={inspect}
              stopResponse={() => controller.current?.abort()}
            />
          )}
          {view === "memories" && (
            <>
              <p className="intro">Search, edit, or delete saved memories.</p>
              <div className="toolbar">
                <select
                  aria-label="Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  <option value="general">General</option>
                  {categories.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Search memories"
                  placeholder="Search your memories…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Memory type"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="">All types</option>
                  {["fact", "preference", "episodic", "instruction"].map(
                    (k) => (
                      <option key={k}>{k}</option>
                    ),
                  )}
                </select>
                <select
                  aria-label="Memory status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {["active", "superseded", "retracted"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                  <option value="">All states</option>
                </select>
                <input
                  aria-label="Scope"
                  placeholder="Filter scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                />
              </div>
              <div className="memory-grid">
                {memories.map((m) => (
                  <MemoryCard
                    key={m.id}
                    m={m}
                    openDocument={openDocument}
                    inspect={inspect}
                    setEditing={setEditing}
                    onDelete={(m) =>
                      askConfirm(
                        "Permanently delete this memory? Earlier conversation context will be cleared.",
                        async () => {
                          await api(`/memories/${m.id}`, "DELETE");
                          setInspected(null);
                          setMessages([]);
                          setConversation(null);
                        },
                      )
                    }
                  />
                ))}
              </div>
              {!memories.length && (
                <div className="empty">
                  No memories here yet. Try “Remember that…” in a conversation.
                </div>
              )}
              <div className="section-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    void act(async () => {
                      const r = await api("/memories/consolidate", "POST");
                      setNotice(
                        `Merged ${r.merged} duplicates. ${r.suggestions.length} related pairs need review.`,
                      );
                      setInspected({ consolidation: r });
                    })
                  }
                >
                  ✧ Review & consolidate
                </button>
              </div>
            </>
          )}
          {view === "upload" && <FileUpload />}
          {view === "settings" && settings && (
            <div className="settings-grid">
              <div>
                <ModelSettingsForm
                  settings={settings}
                  setSettings={setSettings}
                  models={health?.models ?? []}
                  onSave={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      await api("/settings", "PATCH", settings);
                      setNotice("Settings saved.");
                    });
                  }}
                />
                <VoiceKeySettings
                  binding={voiceKey}
                  onChange={saveVoiceKey}
                  autoSend={voiceAutoSend}
                  onAutoSendChange={saveVoiceAutoSend}
                />
              </div>
              <div>
                <section className="settings-card">
                  <h2>Import and export</h2>
                  <p>
                    Export includes active memories and their personal evidence.
                    Store the file privately.
                  </p>
                  <button
                    className="secondary"
                    onClick={() =>
                      void act(async () => {
                        const data = await api("/memories/export");
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(data, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "infonity-memories.json";
                        a.click();
                        URL.revokeObjectURL(url);
                      })
                    }
                  >
                    Export memories ↓
                  </button>
                  <label className="import-label">
                    Import memories
                    <input
                      type="file"
                      accept="application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void act(async () => {
                            const data = JSON.parse(await file.text());
                            await api("/memories/import", "POST", {
                              memories: data.memories.map(memoryInput),
                            });
                            setNotice("Memories imported.");
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="secondary"
                    onClick={() =>
                      void act(async () => {
                        const r = await api("/memories/rebuild", "POST");
                        setNotice(
                          `Rebuilt ${r.processed} embeddings; ${r.failed} pending retries.`,
                        );
                      })
                    }
                  >
                    Rebuild vector index
                  </button>
                  <p className="muted">
                    {health?.pending_embeddings ?? 0} embeddings awaiting
                    indexing
                  </p>
                </section>
                <section className="settings-card danger">
                  <h2>Delete memories</h2>
                  <label>
                    Topic
                    <input
                      value={forgetTopic}
                      onChange={(e) => setForgetTopic(e.target.value)}
                      placeholder="e.g. programming language"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={deleteHistory}
                      onChange={(e) => setDeleteHistory(e.target.checked)}
                    />
                    Also delete all conversation history
                  </label>
                  <button
                    disabled={!forgetTopic.trim()}
                    onClick={() =>
                      askConfirm(
                        `Delete memories matching “${forgetTopic}”?`,
                        async () => {
                          await api("/memories/forget", "POST", {
                            topic: forgetTopic,
                            delete_history: deleteHistory,
                          });
                          setMessages([]);
                          setConversation(null);
                          setInspected(null);
                        },
                      )
                    }
                  >
                    Forget this topic
                  </button>
                  <button
                    className="danger-button"
                    onClick={() =>
                      askConfirm(
                        "Permanently delete ALL memories? This cannot be undone.",
                        async () => {
                          await api("/memories/forget", "POST", {
                            all: true,
                            delete_history: deleteHistory,
                          });
                          setMessages([]);
                          setConversation(null);
                          setInspected(null);
                        },
                      )
                    }
                  >
                    Delete all memories
                  </button>
                </section>
                <section className="settings-card danger">
                  <h2>Recent conversations</h2>
                  <p>
                    Delete all conversation history, including older chats.
                    Saved memories are kept.
                  </p>
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() =>
                      askConfirm(
                        "Permanently delete all conversation history? Saved memories will be kept. This cannot be undone.",
                        async () => {
                          await api("/conversations", "DELETE");
                          setConversations([]);
                          setConversation(null);
                          setMessages([]);
                          setNotice("Recent conversations deleted.");
                        },
                      )
                    }
                  >
                    Delete recent conversations
                  </button>
                </section>
              </div>
              {notice && <p role="status">{notice}</p>}
            </div>
          )}
        </section>
      </main>
      {inspected && (
        <div className="modal-backdrop" onClick={() => setInspected(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Memory details"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setInspected(null)}
              autoFocus
            >
              Close ×
            </button>
            <h2>Memory provenance</h2>
            {inspected.memory ? (
              <>
                <h3>{inspected.memory.value}</h3>
                <p>{inspected.memory.id}</p>
                <dl className="memory-metadata">
                  {[
                    "category",
                    "type",
                    "scope",
                    "state",
                    "origin",
                    "sensitivity",
                    "confidence",
                    "version",
                    "valid_from",
                    "valid_until",
                  ].map((field) => (
                    <React.Fragment key={field}>
                      <dt>{field.replaceAll("_", " ")}</dt>
                      <dd>
                        {String(inspected.memory[field] ?? "Not specified")}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
                <blockquote>{inspected.memory.evidence}</blockquote>
                <h4>Sources</h4>
                {inspected.memory.sources.map((s: any, i: number) => (
                  <p key={i}>{s.content || "Source conversation deleted"}</p>
                ))}
                <h4>History</h4>
                {inspected.events.map((e: any) => (
                  <p key={e.id}>
                    {e.kind} · version {e.version} · {e.created_at}
                  </p>
                ))}
                {inspected.memory.links.map((l: any, i: number) => (
                  <button
                    key={i}
                    onClick={() =>
                      void act(async () =>
                        setInspected(
                          (
                            await api(
                              `/memories/${l.source_id === inspected.memory.id ? l.target_id : l.source_id}/history`,
                            )
                          ).data,
                        ),
                      )
                    }
                  >
                    {l.kind} ↗
                  </button>
                ))}
              </>
            ) : (
              <pre>{JSON.stringify(inspected, null, 2)}</pre>
            )}
          </section>
        </div>
      )}
      {openedDocument && (
        <div className="modal-backdrop">
          <DocumentViewer
            document={openedDocument}
            onEdit={(memory) => {
              setEditing(memory);
              setOpenedDocument(null);
            }}
            onClose={() => setOpenedDocument(null)}
          />
        </div>
      )}
      {documentDraft && (
        <div className="modal-backdrop">
          <form
            className="modal document-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create document"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                savingDocument ||
                busy ||
                !documentDraft.title.trim() ||
                !documentDraft.body.trim()
              )
                return;
              setSavingDocument(true);
              setDocumentError("");
              try {
                await api("/memories", "POST", {
                  category: "documents",
                  predicate: "item",
                  title: documentDraft.title,
                  value: documentDraft.body,
                });
                setDocumentDraft(null);
                setNotice(`Created document: ${documentDraft.title.trim()}`);
                await refresh();
              } catch (error) {
                setDocumentError((error as Error).message);
              } finally {
                setSavingDocument(false);
              }
            }}
          >
            <h2>Create document</h2>
            <label>
              Title
              <input
                required
                maxLength={300}
                value={documentDraft.title}
                disabled={savingDocument}
                onChange={(event) =>
                  setDocumentDraft({
                    ...documentDraft,
                    title: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Body
              <textarea
                required
                rows={10}
                maxLength={20000}
                value={documentDraft.body}
                disabled={savingDocument}
                onChange={(event) =>
                  setDocumentDraft({
                    ...documentDraft,
                    body: event.target.value,
                  })
                }
              />
            </label>
            {documentError && <p role="alert">{documentError}</p>}
            <div className="card-actions">
              <button
                type="submit"
                className="primary"
                disabled={
                  busy ||
                  savingDocument ||
                  !documentDraft.title.trim() ||
                  !documentDraft.body.trim()
                }
              >
                {savingDocument ? "Creating…" : "Create document"}
              </button>
              <button
                type="button"
                disabled={savingDocument}
                onClick={() => setDocumentDraft(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {editing && (
        <div className="modal-backdrop">
          <MemoryEditor
            editing={editing}
            setEditing={setEditing}
            onSave={(event) => {
              event.preventDefault();
              void act(async () => {
                await api(`/memories/${editing.id}`, "PATCH", {
                  memory: memoryInput(editing),
                  version: editing.version,
                });
                setEditing(null);
              });
            }}
          />
        </div>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <ConfirmationDialog
            text={confirm.text}
            onConfirm={() => {
              const action = confirm.action;
              setConfirm(null);
              void act(action);
            }}
            onCancel={() => {
              confirm.cancel?.();
              setConfirm(null);
            }}
          />
        </div>
      )}
      <div className="global-voice-status">
        <VoiceInput
          disabled={busy || savingDocument}
          binding={voiceKey}
          onActiveChange={setVoiceActive}
          beforeRecord={() => {
            autoSendPending.current = false;
            const focused = document.activeElement;
            const field = isDictationField(focused)
              ? focused
              : view === "chat" &&
                  !document.querySelector('[aria-modal="true"]')
                ? messageInput.current
                : null;
            dictationTarget.current = field;
            return !!field;
          }}
          onTranscript={(text) => {
            const field = dictationTarget.current;
            if (field && field.isConnected && isDictationField(field)) {
              insertDictation(field, text);
              autoSendPending.current =
                voiceAutoSend && field === messageInput.current;
            }
          }}
        />
      </div>
    </div>
  );
}
