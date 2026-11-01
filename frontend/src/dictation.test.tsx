// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { insertDictation, isDictationField } from "./dictation";
afterEach(cleanup);
it("inserts at the selection in a controlled document field and retains focus", () => {
  function Document() {
    const [body, setBody] = useState("Buy bread today");
    return (
      <>
        <textarea
          aria-label="Body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <output>{body}</output>
      </>
    );
  }
  render(<Document />);
  const field = screen.getByLabelText("Body") as HTMLTextAreaElement;
  field.focus();
  field.setSelectionRange(4, 9);
  act(() => insertDictation(field, "milk"));
  expect(field.value).toBe("Buy milk today");
  expect(
    screen.getByText("Buy milk today", { selector: "output" }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(8);
  expect(field.selectionEnd).toBe(8);
  fireEvent.change(field, { target: { value: field.value + "!" } });
  expect(field.value).toBe("Buy milk today!");
});
it("dictates into input fields and respects maximum length", () => {
  render(<input aria-label="Title" defaultValue="Plan: " maxLength={10} />);
  const field = screen.getByLabelText("Title") as HTMLInputElement;
  field.setSelectionRange(6, 6);
  insertDictation(field, "shopping");
  expect(field.value).toBe("Plan: shop");
  expect(field.selectionStart).toBe(10);
});
it("ignores disabled, read-only, removed, and non-text fields", () => {
  render(
    <>
      <input aria-label="Disabled" disabled />
      <textarea aria-label="Read only" readOnly />
      <input aria-label="Number" type="number" />
      <input aria-label="Password" type="password" />
    </>,
  );
  for (const label of ["Disabled", "Read only", "Number", "Password"])
    expect(isDictationField(screen.getByLabelText(label))).toBe(false);
  const removed = document.createElement("textarea");
  insertDictation(removed, "ignored");
  expect(removed.value).toBe("");
});
