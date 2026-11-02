import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a
                className="external-link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <>{children}</>
            ),
          img: ({ alt }) => <>{alt}</>,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
