// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import VoiceInput from "./VoiceInput";
class Recorder {
  static instance: Recorder;
  static isTypeSupported = (type: string) => type === "audio/mp4";
  state = "inactive";
  ondataavailable: any;
  onstop: any;
  onerror: any;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable({ data: new Blob(["audio"], { type: "audio/mp4" }) });
    void this.onstop();
  });
  constructor(
    public stream: any,
    public options: any,
  ) {
    Recorder.instance = this;
  }
}
function setup() {
  const stop = vi.fn();
  const media = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn(async () => media);
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ text: "Buy milk" }),
  }));
  vi.stubGlobal("fetch", fetch);
  const onTranscript = vi.fn();
  const onActiveChange = vi.fn();
  const result = render(
    <VoiceInput
      disabled={false}
      binding={{ code: "F8", label: "F8" }}
      onTranscript={onTranscript}
      onActiveChange={onActiveChange}
    />,
  );
  return {
    ...result,
    stop,
    media,
    getUserMedia,
    fetch,
    onTranscript,
    onActiveChange,
    button: window,
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("records Safari-compatible MP4 and sends it only to the local endpoint on release", async () => {
  const { button, fetch, stop, onTranscript } = setup();
  fireEvent.keyDown(button, { key: "F8", code: "F8" });
  await screen.findByText("Listening… Release to finish.");
  expect(fetch).not.toHaveBeenCalled();
  expect(Recorder.instance.options).toEqual({ mimeType: "audio/mp4" });
  fireEvent.keyUp(button, { key: "F8", code: "F8" });
  await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("Buy milk"));
  expect(fetch).toHaveBeenCalledWith(
    "/api/speech/transcribe",
    expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "audio/mp4" },
    }),
  );
  expect(stop).toHaveBeenCalled();
});
it("discards cancelled recordings", async () => {
  const { button, fetch, stop } = setup();
  fireEvent.keyDown(button, { key: "F8", code: "F8" });
  await screen.findByText("Listening… Release to finish.");
  fireEvent.keyDown(button, { key: "Escape" });
  expect(fetch).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
});
it("releases a microphone granted after the button was released", async () => {
  const { button, getUserMedia, media, stop, fetch } = setup();
  let resolve!: (value: any) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.keyDown(button, { key: "F8", code: "F8" });
  fireEvent.keyUp(button, { key: "F8", code: "F8" });
  await act(async () => resolve(media));
  expect(stop).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("shows microphone permission failures", async () => {
  const { button, getUserMedia } = setup();
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  fireEvent.keyDown(button, { key: "F8", code: "F8" });
  await screen.findByText(/Microphone permission denied/);
});
it("stops the microphone on unmount", async () => {
  const { button, unmount, stop, fetch } = setup();
  fireEvent.keyDown(button, { key: "F8", code: "F8" });
  await screen.findByText("Listening… Release to finish.");
  unmount();
  expect(stop).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("does not record without an assigned key", () => {
  const { rerender, getUserMedia } = setup();
  rerender(
    <VoiceInput
      disabled={false}
      binding={null}
      onTranscript={vi.fn()}
      onActiveChange={vi.fn()}
    />,
  );
  fireEvent.keyDown(window, { key: "F8", code: "F8" });
  expect(getUserMedia).not.toHaveBeenCalled();
});
it("ignores other keys, repeats, modified shortcuts, and modal dialogs", () => {
  const { getUserMedia } = setup();
  fireEvent.keyDown(window, { key: "F7", code: "F7" });
  fireEvent.keyDown(window, { key: "F8", code: "F8", repeat: true });
  fireEvent.keyDown(window, { key: "F8", code: "F8", metaKey: true });
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.appendChild(dialog);
  fireEvent.keyDown(window, { key: "F8", code: "F8" });
  dialog.remove();
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("allows dictation in a modal text field through the target callback", async () => {
  const { rerender, getUserMedia, onTranscript, onActiveChange } = setup();
  const beforeRecord = vi.fn(() => true);
  rerender(
    <VoiceInput
      disabled={false}
      binding={{ code: "F8", label: "F8" }}
      beforeRecord={beforeRecord}
      onTranscript={onTranscript}
      onActiveChange={onActiveChange}
    />,
  );
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.appendChild(dialog);
  try {
    fireEvent.keyDown(window, { key: "F8", code: "F8" });
    await screen.findByText("Listening… Release to finish.");
    expect(beforeRecord).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();
  } finally {
    dialog.remove();
  }
});
it("does not start during key learning or without an eligible target", () => {
  const { rerender, getUserMedia } = setup();
  const beforeRecord = vi.fn(() => false);
  rerender(
    <VoiceInput
      disabled={false}
      binding={{ code: "F8", label: "F8" }}
      beforeRecord={beforeRecord}
      onTranscript={vi.fn()}
      onActiveChange={vi.fn()}
    />,
  );
  fireEvent.keyDown(window, { key: "F8", code: "F8" });
  expect(beforeRecord).toHaveBeenCalledOnce();
  const learning = document.createElement("section");
  learning.dataset.voiceLearning = "true";
  document.body.appendChild(learning);
  fireEvent.keyDown(window, { key: "F8", code: "F8" });
  learning.remove();
  expect(beforeRecord).toHaveBeenCalledOnce();
  expect(getUserMedia).not.toHaveBeenCalled();
});

it.each([
  ["Shift", "ShiftLeft", { shiftKey: true }],
  ["Control", "ControlLeft", { ctrlKey: true }],
  ["Alt", "AltRight", { altKey: true }],
  ["Meta", "MetaRight", { metaKey: true }],
  ["Fn", "", {}],
])(
  "records with %s held alone and stops on release",
  async (key, code, flags) => {
    const { rerender, onTranscript, onActiveChange } = setup();
    rerender(
      <VoiceInput
        disabled={false}
        binding={{ code: code || key, label: key }}
        onTranscript={onTranscript}
        onActiveChange={onActiveChange}
      />,
    );
    fireEvent.keyDown(window, { key, code, ...flags });
    await screen.findByText("Listening… Release to finish.");
    fireEvent.keyUp(window, { key, code });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("Buy milk"));
  },
);
it("cancels modifier recording when another key starts a shortcut", async () => {
  const { rerender, fetch, onTranscript, onActiveChange } = setup();
  rerender(
    <VoiceInput
      disabled={false}
      binding={{ code: "MetaLeft", label: "Command (left)" }}
      onTranscript={onTranscript}
      onActiveChange={onActiveChange}
    />,
  );
  fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
  await screen.findByText("Listening… Release to finish.");
  fireEvent.keyDown(window, { key: "c", code: "KeyC", metaKey: true });
  fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });
  expect(fetch).not.toHaveBeenCalled();
});
