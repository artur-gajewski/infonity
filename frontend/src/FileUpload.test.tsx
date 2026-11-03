// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FileUpload from "./components/FileUpload";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("uploads the selected file and reports saved sections", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ saved: 2 }) });
  vi.stubGlobal("fetch", fetch);
  render(<FileUpload />);
  const file = new File(["Project notes"], "readme.md", {
    type: "text/markdown",
  });
  fireEvent.change(screen.getByLabelText("Choose file"), {
    target: { files: [file] },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Upload and save to memory" }),
  );
  expect(await screen.findByRole("status")).toBeTruthy();
  await screen.findByText(/Saved readme.md as 2 document sections/);
  expect(fetch).toHaveBeenCalledWith(
    "/api/documents/upload?filename=readme.md",
    expect.objectContaining({ method: "POST", body: file }),
  );
});

it("shows backend errors and allows retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "No readable text found" } }),
    }),
  );
  render(<FileUpload />);
  fireEvent.change(screen.getByLabelText("Choose file"), {
    target: { files: [new File(["scan"], "scan.pdf")] },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Upload and save to memory" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "No readable text found",
  );
  expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(false);
});

it.each([8 * 1024 * 1024, 8 * 1024 * 1024 + 1])(
  "enforces the 8 MiB upload boundary for %i bytes",
  async (size) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ saved: 1 }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<FileUpload />);
    const file = new File(["notes"], "notes.md");
    Object.defineProperty(file, "size", { value: size });
    fireEvent.change(screen.getByLabelText("Choose file"), {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Upload and save to memory" }),
    );
    if (size === 8 * 1024 * 1024) {
      await screen.findByText(/Saved notes.md/);
      expect(fetch).toHaveBeenCalledOnce();
    } else {
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Choose a nonempty file up to 8 MiB.",
      );
      expect(fetch).not.toHaveBeenCalled();
    }
  },
);
