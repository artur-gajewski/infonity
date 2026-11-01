const modifiers = new Set(["Shift", "Control", "Alt", "Meta", "Fn", "FnLock"]);
export function isVoiceModifier(key: string) {
  return modifiers.has(key);
}
export function voiceKeyCode(event: KeyboardEvent) {
  return event.code || (isVoiceModifier(event.key) ? event.key : "");
}
export function voiceKeyLabel(event: KeyboardEvent) {
  const name = (
    {
      Meta: "Command",
      Alt: "Option",
      Control: "Control",
      Shift: "Shift",
      Fn: "Fn",
      FnLock: "Fn Lock",
    } as Record<string, string>
  )[event.key];
  if (name) {
    const code = voiceKeyCode(event);
    return (
      name +
      (code.endsWith("Left")
        ? " (left)"
        : code.endsWith("Right")
          ? " (right)"
          : "")
    );
  }
  return event.key === " "
    ? "Space"
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key;
}
