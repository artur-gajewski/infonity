import { isVoiceModifier, voiceKeyCode, voiceKeyLabel } from "./voiceKeys";
import React, { useEffect, useState } from "react";

export type VoiceKey = { code: string; label: string };
export function readVoiceKey(): VoiceKey | null {
  try {
    const value = JSON.parse(
      localStorage.getItem("sheldon-voice-key") || "null",
    );
    return value &&
      typeof value.code === "string" &&
      typeof value.label === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export default function VoiceKeySettings({
  binding,
  onChange,
  autoSend,
  onAutoSendChange,
}: {
  binding: VoiceKey | null;
  onChange: (binding: VoiceKey | null) => void;
  autoSend: boolean;
  onAutoSendChange: (enabled: boolean) => void;
}) {
  const [learning, setLearning] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!learning) return;
    let captured = "";
    const down = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === "Escape") {
        setLearning(false);
        setMessage("");
        return;
      }
      const code = voiceKeyCode(event);
      if (
        !code ||
        (!isVoiceModifier(event.key) &&
          (event.ctrlKey || event.metaKey || event.altKey)) ||
        ["Tab", "Enter", "CapsLock", "Dead", "Unidentified"].includes(event.key)
      ) {
        setMessage(
          "Choose a single key, such as Shift, Control, Option, Command, Space, or F8. Escape cancels.",
        );
        return;
      }
      captured = code;
      onChange({ code, label: voiceKeyLabel(event) });
      setMessage("Voice key saved for this browser.");
    };
    const up = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (voiceKeyCode(event) === captured) setLearning(false);
    };
    const blur = () => setLearning(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [learning, onChange]);
  return (
    <section className="settings-card" data-voice-learning={learning}>
      <h2>Voice commands</h2>
      <p>
        Recording key: <strong>{binding?.label || "Not assigned"}</strong>
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={autoSend}
          onChange={(event) => onAutoSendChange(event.target.checked)}
        />
        Automatically send voice messages
      </label>
      <p className="muted">
        Sends the chat draft after transcription. Other fields are filled
        without submitting their forms. Deletion still requires confirmation.
      </p>
      <p>
        Click Learn, then press and release a key. In any text field, hold it to
        record and release to transcribe. By default, review the text before
        sending.
      </p>
      <p className="muted">
        The key is reserved in text fields throughout Infonity. Choose a key you
        do not use for typing. This setting is saved in this browser.
      </p>
      <p className="muted">
        Shift, Control, Option, and Command are supported, with separate
        left/right keys. Fn works only if the browser receives its key events;
        macOS may handle it itself.
      </p>
      <button
        type="button"
        onClick={() => {
          setLearning(!learning);
          setMessage("");
        }}
      >
        {learning ? "Cancel learning" : "Learn"}
      </button>
      <button
        type="button"
        disabled={!binding}
        onClick={() => {
          setLearning(false);
          onChange(null);
          setMessage("Voice key cleared.");
        }}
      >
        Clear voice key
      </button>
      <p role="status">
        {learning ? message || "Press a key… Escape cancels." : message}
      </p>
    </section>
  );
}
