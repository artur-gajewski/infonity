// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MarkdownText from "./components/MarkdownText";

afterEach(cleanup);

it("renders emphasis, headings, lists, code, and tables", () => {
  const { container } = render(
    <MarkdownText
      text={
        '## Summary\n\n**Bold** and *italic* with `inline`\n\n- First\n- Second\n\n```python\nprint("hello")\n```\n\n| Name | Value |\n| --- | --- |\n| A | B |'
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Summary" })).toBeTruthy();
  expect(container.querySelector("strong")?.textContent).toBe("Bold");
  expect(container.querySelector("em")?.textContent).toBe("italic");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(container.querySelector("pre code")?.textContent).toContain(
    'print("hello")',
  );
  expect(screen.getByRole("table")).toBeTruthy();
});

it("keeps external links safe and blocks HTML, unsafe URLs, and image loading", () => {
  const { container } = render(
    <MarkdownText
      text={
        "[Safe](https://example.com) and https://example.org\n\n[Unsafe](javascript:alert%281%29)\n\n![Tracking image](https://example.com/track.png)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"
      }
    />,
  );
  expect(screen.getAllByRole("link")).toHaveLength(2);
  const safe = screen.getByRole("link", { name: "Safe" });
  expect(safe.getAttribute("target")).toBe("_blank");
  expect(safe.getAttribute("rel")).toBe("noopener noreferrer");
  expect(container.querySelector("script, img")).toBeNull();
  expect(container.querySelector('[href^="javascript:"]')).toBeNull();
});
