import type { Conversation } from "../api";

type SidebarProps = {
  view: string;
  busy: boolean;
  conversations: Conversation[];
  conversation: string | null;
  connected: boolean;
  newChat: () => void;
  navigate: (view: string) => void;
  openConversation: (id: string) => Promise<void>;
  deleteConversation: (conversation: Conversation) => void;
};

export default function Sidebar({
  view,
  busy,
  conversations,
  conversation,
  connected,
  newChat,
  navigate,
  openConversation,
  deleteConversation,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={newChat}>
        <span className="brandmark">I</span>Infonity
      </button>
      <nav aria-label="Main navigation">
        {[
          ["chat", "◌", "New conversation"],
          ["memories", "▧", "Memory library"],
          ["settings", "⚙", "Settings"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            className={view === id ? "selected" : ""}
            disabled={id === "chat" && busy}
            onClick={() => {
              if (id === "chat") {
                newChat();
                return;
              }
              navigate(id);
            }}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <div className="history-label">RECENT CONVERSATIONS</div>
      <div className="history">
        {conversations.map((c) => (
          <div
            className={
              "history-row " + (c.id === conversation ? "current" : "")
            }
            key={c.id}
          >
            <button disabled={busy} onClick={() => void openConversation(c.id)}>
              {c.title}
            </button>
            <button
              aria-label={`Delete conversation ${c.title}`}
              className="delete-conversation"
              onClick={() => deleteConversation(c)}
            >
              ×
            </button>
          </div>
        ))}
        {!conversations.length && <p>Your conversations will appear here.</p>}
      </div>
      <div className="local-card">
        <span className={"status-dot " + (connected ? "online" : "")} />
        <div>
          <strong>
            {connected ? "Ollama connected" : "Ollama unavailable"}
          </strong>
        </div>
      </div>
    </aside>
  );
}
