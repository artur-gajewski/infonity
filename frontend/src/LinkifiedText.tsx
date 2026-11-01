import React from "react";

function trimPunctuation(value: string) {
  let result = value.replace(/[.,;:!?]+$/, "");
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    while (
      result.endsWith(close) &&
      result.split(close).length > result.split(open).length
    )
      result = result.slice(0, -1);
  }
  return result;
}

export default function LinkifiedText({ text }: { text: string }) {
  const pattern =
    /https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?:[/?#][^\s<>"'`]*)?/gi;
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > 0 && /[\w@./-]/.test(text[index - 1])) continue;
    const label = trimPunctuation(match[0]);
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(label) ? label : `https://${label}`);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) continue;
    parts.push(text.slice(offset, index));
    parts.push(
      <a
        key={index}
        className="external-link"
        href={url.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>,
    );
    offset = index + label.length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
