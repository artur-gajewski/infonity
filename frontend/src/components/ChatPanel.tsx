import React, { type FormEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { Memory, Message } from "../api";
import LinkifiedText from "../LinkifiedText";
import { documentTitle } from "../ui";

function responseOnly(text: string) {
  const withoutBlocks = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const lastClose = withoutBlocks.toLowerCase().lastIndexOf("</think>");
  const answer =
    lastClose < 0 ? withoutBlocks : withoutBlocks.slice(lastClose + 8);
  return answer.replace(/<think>[\s\S]*$/gi, "").trim();
}

type ChatPanelProps = {
  messages: Message[];
  busy: boolean;
  notice: string;
  input: string;
  voiceActive: boolean;
  setInput: (value: string) => void;
  send: (event: FormEvent) => void;
  chatScroll: RefObject<HTMLDivElement | null>;
  chatContent: RefObject<HTMLDivElement | null>;
  composer: RefObject<HTMLDivElement | null>;
  messageInput: RefObject<HTMLInputElement | null>;
  openDocument: (id: string) => Promise<void>;
  inspect: (memory: Memory) => Promise<void>;
  stopResponse: () => void;
};

export default function ChatPanel({
  messages,
  busy,
  notice,
  input,
  voiceActive,
  setInput,
  send,
  chatScroll,
  chatContent,
  composer,
  messageInput,
  openDocument,
  inspect,
  stopResponse,
}: ChatPanelProps) {
  function messageContent(message: Message, content: string) {
    const documents =
      message.role === "assistant"
        ? message.memories?.filter(
            (memory) => memory.category === "documents",
          ) || []
        : [];
    return content.split("\n").map((line, index) => {
      const document = documents.find(
        (document) => line === `• ${documentTitle(document)}`,
      );
      return (
        <React.Fragment key={index}>
          {index > 0 && "\n"}
          {document ? (
            <>
              •{" "}
              <a
                className="document-link"
                href={`#document/${document.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  void openDocument(document.id);
                }}
              >
                {documentTitle(document)}
              </a>
            </>
          ) : (
            <LinkifiedText text={line} />
          )}
        </React.Fragment>
      );
    });
  }

  return (
    <>
      <div className="chat-scroll" ref={chatScroll}>
        <div ref={chatContent}>
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="orb">✳</div>
              <h2>New conversation</h2>
              <p>Send a message or select an example below.</p>
              <div className="starter-grid">
                {[
                  [
                    "Add a todo",
                    "Add this to todo: Buy groceries.",
                    "Add this to todo: ",
                  ],
                  [
                    "Save a link",
                    "Add this to links: https://example.com",
                    "Add this to links: ",
                  ],
                  [
                    "Create a document",
                    "Create a document: Meeting notes.",
                    "Create a document: ",
                  ],
                ].map(([title, text, command]) => (
                  <button
                    key={title}
                    onClick={() => {
                      flushSync(() => setInput(command));
                      messageInput.current?.focus();
                      messageInput.current?.setSelectionRange(
                        command.length,
                        command.length,
                      );
                    }}
                  >
                    <span>{title} ↗</span>
                    <small>{text}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const content =
                m.role === "assistant" ? responseOnly(m.content) : m.content;
              if (m.role === "assistant" && busy && i === messages.length - 1)
                return null;
              return (
                <article className={"message " + m.role} key={i}>
                  <div className="avatar">{m.role === "user" ? "Y" : "✳"}</div>
                  <div className="message-body">
                    <strong>{m.role === "user" ? "You" : "Infonity"}</strong>
                    <div className="message-text">
                      {messageContent(m, content || "No response received.")}
                    </div>
                    {!!m.memories?.length && (
                      <details className="provenance">
                        <summary>
                          {m.memories.length} memories provided as context
                        </summary>
                        {m.memories.map((x) => (
                          <button
                            key={x.id}
                            onClick={() =>
                              x.category === "documents"
                                ? void openDocument(x.id)
                                : void inspect(x)
                            }
                          >
                            {x.title || x.predicate.replaceAll("_", " ")}:{" "}
                            {x.value}{" "}
                            <small>
                              {x.state} · {x.id.slice(0, 8)}
                            </small>
                          </button>
                        ))}
                      </details>
                    )}
                  </div>
                </article>
              );
            })
          )}
          {busy && (
            <div
              className="response-pending"
              role="status"
              aria-label="Waiting for response"
            >
              <span className="response-spinner" aria-hidden="true" />
            </div>
          )}
          {notice && (
            <p role="status" className="memory-notice">
              ✧ {notice}
            </p>
          )}
        </div>
      </div>
      <div className="composer-wrap" ref={composer}>
        <form className="composer" onSubmit={send}>
          <input
            type="text"
            aria-label="Message"
            ref={messageInput}
            placeholder="Write a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                setInput("");
              }
            }}
          />
          <div className="composer-bottom">
            {busy ? (
              <button type="button" onClick={() => stopResponse()}>
                Stop ■
              </button>
            ) : (
              <button
                aria-label="Send message"
                disabled={!input.trim() || voiceActive}
                type="submit"
              >
                ↑
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
