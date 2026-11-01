import type { FormEvent } from "react";
import type { Memory } from "../api";
import { categories } from "../ui";

type MemoryEditorProps = {
  editing: Memory;
  setEditing: (memory: Memory | null) => void;
  onSave: (event: FormEvent) => void;
};

export default function MemoryEditor({
  editing,
  setEditing,
  onSave,
}: MemoryEditorProps) {
  return (
    <form
      className={
        "modal" +
        (editing.category === "documents"
          ? " document-modal document-edit-modal"
          : "")
      }
      role="dialog"
      aria-modal="true"
      aria-label="Edit memory"
      onSubmit={onSave}
    >
      <h2>Edit memory</h2>
      <p>Saving preserves the previous version in history.</p>
      {(editing.category === "todo" || editing.category === "reminders") && (
        <label>
          Task status
          <input
            required
            maxLength={100}
            value={editing.task_status || (editing.completed ? "done" : "todo")}
            onChange={(e) =>
              setEditing({
                ...editing,
                task_status: e.target.value,
                completed: [
                  "done",
                  "complete",
                  "completed",
                  "finished",
                ].includes(e.target.value.trim().toLowerCase()),
              })
            }
          />
        </label>
      )}
      <label>
        Title
        <input
          value={editing.title || ""}
          maxLength={300}
          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
        />
      </label>
      <label>
        {editing.category === "documents" ? "Body" : "Value"}
        <textarea
          rows={editing.category === "documents" ? 14 : undefined}
          className={
            editing.category === "documents"
              ? "document-editor-body"
              : undefined
          }
          value={editing.value}
          required={editing.category !== "documents" || !editing.title?.trim()}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
        />
      </label>
      <label>
        Category
        <select
          value={editing.category || "general"}
          onChange={(e) =>
            setEditing({
              ...editing,
              category: e.target.value as Memory["category"],
            })
          }
        >
          <option value="general">General</option>
          {categories.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Scope
        <input
          required
          value={editing.scope}
          onChange={(e) => setEditing({ ...editing, scope: e.target.value })}
        />
      </label>
      <label>
        Predicate
        <input
          required
          value={editing.predicate}
          onChange={(e) =>
            setEditing({ ...editing, predicate: e.target.value })
          }
        />
      </label>
      <div className="card-actions">
        <button className="primary">Save memory</button>
        <button type="button" onClick={() => setEditing(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
