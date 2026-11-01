import { isVoiceModifier, voiceKeyCode } from "./voiceKeys";
import type { VoiceKey } from "./VoiceKeySettings";
import React, { useEffect, useRef, useState } from "react";

export default function VoiceInput({
  disabled,
  binding,
  beforeRecord,
  onTranscript,
  onActiveChange,
}: {
  disabled: boolean;
  binding: VoiceKey | null;
  beforeRecord?: () => boolean;
  onTranscript: (text: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [status, setStatus] = useState("");

  const held = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onTranscript, onActiveChange });
  callbacks.current = { onTranscript, onActiveChange };
  const supported =
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  function releaseMicrophone() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
  }
  function finish() {
    held.current = false;
    pending.current = false;
    if (!mounted.current) return;

    callbacks.current.onActiveChange(false);
  }
  function cancel() {
    generation.current++;
    held.current = false;
    request.current?.abort();
    request.current = null;
    const current = recorder.current;
    recorder.current = null;
    if (current && current.state !== "inactive") current.stop();
    releaseMicrophone();
    if (mounted.current) setStatus("");
    finish();
  }
  useEffect(() => {
    mounted.current = true;
    const blur = () => {
      if (held.current || recorder.current) cancel();
    };
    window.addEventListener("blur", blur);
    return () => {
      mounted.current = false;
      cancel();
      callbacks.current.onActiveChange(false);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);

  async function start() {
    if (disabled || !supported || pending.current || recorder.current) return;
    if (beforeRecord && !beforeRecord()) return;
    held.current = true;
    pending.current = true;
    const attempt = ++generation.current;
    setStatus("Preparing microphone…");

    callbacks.current.onActiveChange(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || !held.current || attempt !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        if (attempt === generation.current) {
          setStatus("Microphone ready. Hold to talk again.");
          finish();
        }
        return;
      }
      stream.current = media;
      const mimeType = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error("This browser cannot record a supported audio format.");
      const current = new MediaRecorder(media, { mimeType });
      recorder.current = current;
      const chunks: Blob[] = [];
      let size = 0;
      current.ondataavailable = (event) => {
        size += event.data.size;
        if (size > 8 * 1024 * 1024) {
          cancel();
          setStatus("Recording is too large. Try a shorter command.");
        } else if (event.data.size) chunks.push(event.data);
      };
      current.onerror = () => {
        cancel();
        setStatus("Microphone recording failed. Try again.");
      };
      current.onstop = async () => {
        if (attempt !== generation.current || !mounted.current) return;
        recorder.current = null;
        releaseMicrophone();
        setStatus("Transcribing locally…");
        const controller = new AbortController();
        request.current = controller;
        const deadline = setTimeout(() => controller.abort(), 120000);
        try {
          const response = await fetch("/api/speech/transcribe", {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: new Blob(chunks, { type: mimeType }),
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error?.message || "Local transcription failed.",
            );
          if (attempt !== generation.current || !mounted.current) return;
          const text = String(result.text || "").trim();
          if (text) callbacks.current.onTranscript(text);
          setStatus(
            text ? "Voice text transcribed." : "No speech detected. Try again.",
          );
        } catch (error) {
          if (attempt === generation.current && mounted.current)
            setStatus(
              error instanceof Error && error.name !== "AbortError"
                ? error.message
                : "Transcription timed out. Try a shorter recording.",
            );
        } finally {
          clearTimeout(deadline);
          if (attempt === generation.current) {
            request.current = null;
            finish();
          }
        }
      };
      current.start(1000);
      timer.current = setTimeout(stop, 60000);
      setStatus("Listening… Release to finish.");
    } catch (error) {
      if (attempt !== generation.current || !mounted.current) return;
      cancel();
      setStatus(
        (error instanceof Error || error instanceof DOMException) &&
          error.name === "NotAllowedError"
          ? "Microphone permission denied. Allow microphone access and try again."
          : error instanceof Error
            ? error.message
            : "Unable to record audio.",
      );
    }
  }
  function stop() {
    held.current = false;
    if (recorder.current?.state === "recording") {
      setStatus("Transcribing locally…");
      recorder.current.stop();
      releaseMicrophone();
    }
  }

  const controls = useRef({
    start,
    stop,
    cancel,
    disabled,
    supported,
    beforeRecord,
  });
  controls.current = { start, stop, cancel, disabled, supported, beforeRecord };
  useEffect(() => {
    if (!binding) return;
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending.current) {
        event.preventDefault();
        event.stopPropagation();
        controls.current.cancel();
        return;
      }
      const code = voiceKeyCode(event);
      if (
        held.current &&
        code !== binding.code &&
        isVoiceModifier(binding.code.replace(/Left$|Right$/, ""))
      ) {
        controls.current.cancel();
        return;
      }
      if (
        code !== binding.code ||
        event.isComposing ||
        (!isVoiceModifier(event.key) &&
          (event.ctrlKey || event.metaKey || event.altKey)) ||
        controls.current.disabled ||
        !controls.current.supported ||
        document.querySelector('[data-voice-learning="true"]') ||
        (!controls.current.beforeRecord &&
          document.querySelector('[aria-modal="true"]'))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void controls.current.start();
    };
    const up = (event: KeyboardEvent) => {
      if (voiceKeyCode(event) !== binding.code || !held.current) return;
      event.preventDefault();
      event.stopPropagation();
      controls.current.stop();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      controls.current.cancel();
    };
  }, [binding?.code]);

  return (
    <p className="voice-status" role="status">
      {binding && !supported
        ? "Microphone recording is unavailable. Open Infonity on localhost in Safari or Chrome."
        : status}
    </p>
  );
}
