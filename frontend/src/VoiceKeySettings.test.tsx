// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import VoiceKeySettings from "./VoiceKeySettings";
afterEach(cleanup);
it.each([
  ["Shift", "ShiftLeft", "Shift (left)", { shiftKey: true }],
  ["Control", "ControlRight", "Control (right)", { ctrlKey: true }],
  ["Alt", "AltLeft", "Option (left)", { altKey: true }],
  ["Meta", "MetaRight", "Command (right)", { metaKey: true }],
  ["Fn", "", "Fn", {}],
])(
  "learns and saves %s as a standalone recording key",
  (key, code, label, flags) => {
    const onChange = vi.fn();
    render(
      <VoiceKeySettings
        binding={null}
        onChange={onChange}
        autoSend={false}
        onAutoSendChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));
    fireEvent.keyDown(window, { key, code, ...flags });
    fireEvent.keyUp(window, { key, code });
    expect(onChange).toHaveBeenCalledWith({ code: code || key, label });
    expect(screen.getByRole("button", { name: "Learn" })).toBeTruthy();
  },
);
