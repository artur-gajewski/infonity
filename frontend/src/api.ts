export type Memory = {
  title?: string;
  completed?: boolean;
  task_status?: string;
  category?: "general" | "documents" | "todo" | "reminders" | "links";
  id: string;
  subject: string;
  predicate: string;
  value: string;
  type: string;
  scope: string;
  state: string;
  confidence: number;
  importance: number;
  evidence: string;
  sensitivity: string;
  valid_from: string | null;
  valid_until: string | null;
  version: number;
  origin: string;
  created_at: string;
};
export type Conversation = { id: string; title: string };
export type Message = {
  role: "user" | "assistant";
  content: string;
  memories?: Memory[];
};
export type Candidate = {
  id: string;
  payload: Memory;
  source_evidence: string;
  conflicts: string[];
};
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Server returned an invalid response (${response.status}).`,
    );
  }
  if (!response.ok) {
    const message =
      data?.error?.message ?? data?.detail?.[0]?.msg ?? data?.detail;
    throw new Error(
      typeof message === "string" && message
        ? message
        : `Request failed (${response.status}).`,
    );
  }
  return data;
}
export type StreamEvent = { type: string; [key: string]: any };
export async function streamChat(
  message: string,
  conversation_id: string | null,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_id }),
    signal,
  });
  if (!response.ok) throw new Error("Unable to start conversation");
  if (!response.body) throw new Error("Streaming is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (!event || typeof event.type !== "string")
          throw new Error("Server returned an invalid chat event.");
        if (event.type === "done" || event.type === "error") terminal = true;
        onEvent(event);
      }
      if (done) break;
    }
    if (!terminal)
      throw new Error(
        "The response was interrupted. Your message remains saved.",
      );
  } finally {
    reader.releaseLock();
  }
}
export function memoryInput(m: Memory) {
  return {
    task_status: m.task_status,
    completed: m.completed,
    title: m.title,
    category: m.category,
    subject: m.subject,
    predicate: m.predicate,
    value: m.value,
    type: m.type,
    scope: m.scope,
    confidence: m.confidence,
    importance: m.importance,
    evidence: m.evidence,
    sensitivity: m.sensitivity,
    valid_from: m.valid_from,
    valid_until: m.valid_until,
  };
}
