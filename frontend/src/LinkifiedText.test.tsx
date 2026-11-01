// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LinkifiedText from "./LinkifiedText";
afterEach(cleanup);
it("makes full URLs, www addresses and bare domains open in new tabs", () => {
  render(
    <LinkifiedText text="YouTube: https://youtube.com/watch?v=123&list=abc, www.example.com and youtube.com." />,
  );
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://youtube.com/watch?v=123&list=abc",
    "https://www.example.com/",
    "https://youtube.com/",
  ]);
  for (const link of links) {
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
});
it("keeps surrounding punctuation outside links and preserves balanced URL parentheses", () => {
  const text = "See (https://example.com/a_(b)). Then https://example.org/!";
  const { container } = render(<LinkifiedText text={text} />);
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "https://example.com/a_(b)",
    "https://example.org/",
  ]);
  expect(container.textContent).toBe(text);
});
it("renders HTML and unsafe schemes as text and does not link emails", () => {
  const text =
    "<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,hello user@example.com";
  const { container } = render(<LinkifiedText text={text} />);
  expect(container.textContent).toBe(text);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
});
