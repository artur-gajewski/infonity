export type TextField = HTMLInputElement | HTMLTextAreaElement;

export function isDictationField(
  element: Element | null,
): element is TextField {
  return (
    (element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        ["text", "search", "email", "url", "tel"].includes(element.type))) &&
    !element.disabled &&
    !element.readOnly
  );
}

export function insertDictation(field: TextField, text: string) {
  if (!field.isConnected || !isDictationField(field)) return;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const available =
    field.maxLength < 0
      ? text.length
      : Math.max(0, field.maxLength - field.value.length + end - start);
  const insertion = text.slice(0, available);
  const value =
    field.value.slice(0, start) + insertion + field.value.slice(end);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  // Use the native setter so React's value tracker observes the subsequent input event.
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus({ preventScroll: true });
  // Email inputs do not expose the selection API.
  if (field.type !== "email")
    field.setSelectionRange(start + insertion.length, start + insertion.length);
  field.scrollLeft = field.scrollWidth;
}
