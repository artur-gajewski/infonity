import type { Memory } from "./api";

export const categories = [
  ["documents", "Documents"],
  ["todo", "Todo"],
  ["reminders", "Reminders"],
  ["links", "Links"],
] as const;

export type Settings = {
  model: string;
  embedding_model: string;
  memory_limit: number;
  memory_tokens: number;
  implicit_suggestions: boolean;
  extraction_enabled: boolean;
  sensitive_retrieval: boolean;
};

export function documentTitle(document: Memory) {
  return (
    document.title ||
    document.value.split("\n", 1)[0].slice(0, 120) ||
    "Untitled document"
  );
}
