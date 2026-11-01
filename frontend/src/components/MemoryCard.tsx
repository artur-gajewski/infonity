import type { Memory } from "../api";
import LinkifiedText from "../LinkifiedText";
import { categories, documentTitle } from "../ui";

type MemoryCardProps = {
  m: Memory;
  openDocument: (id: string) => Promise<void>;
  inspect: (memory: Memory) => Promise<void>;
  setEditing: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
};

export default function MemoryCard({
  m,
  openDocument,
  inspect,
  setEditing,
  onDelete,
}: MemoryCardProps) {
  return (
    <article className="memory-card">
      <div className="card-top">
        <span className={"type-tag " + m.type}>
          {m.category && m.category !== "general"
            ? categories.find(([id]) => id === m.category)?.[1]
            : m.type}
        </span>
        <span>
          {m.scope} · {m.state}
          {m.category === "todo" || m.category === "reminders"
            ? ` · ${m.task_status || (m.completed ? "done" : "todo")}`
            : ""}
        </span>
      </div>
      <h3>
        {m.category === "documents" ? (
          <a
            className="document-link"
            href={`#document/${m.id}`}
            onClick={(event) => {
              event.preventDefault();
              void openDocument(m.id);
            }}
          >
            {documentTitle(m)}
          </a>
        ) : (
          m.title || m.predicate.replaceAll("_", " ")
        )}
      </h3>
      <p>
        {m.category === "links" ? (
          <LinkifiedText text={m.value} />
        ) : m.value.length > 160 ? (
          `${m.value.slice(0, 160).trimEnd()}…`
        ) : (
          m.value
        )}
      </p>
      <blockquote>
        {m.evidence || "Added directly to your memory library."}
      </blockquote>
      <div className="card-actions">
        <button onClick={() => void inspect(m)}>Evidence & history ↗</button>
        <button onClick={() => setEditing(m)}>Edit</button>
        <button onClick={() => onDelete(m)}>Delete</button>
      </div>
    </article>
  );
}
