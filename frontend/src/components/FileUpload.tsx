import { useState } from "react";

export default function FileUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="settings-card">
      <h2>Save a file to memory</h2>
      <p>
        Upload a PDF, TXT, or Markdown file, including readme.md. You can ask
        questions about its contents in any conversation after saving.
      </p>
      <p>
        Files stay local. Maximum 8 MiB and 500,000 extracted characters. PDFs
        must contain selectable text; scanned pages need OCR first.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file || busy) return;
          setMessage("");
          setError("");
          if (file.size > 8 * 1024 * 1024 || !file.size) {
            setError("Choose a nonempty file up to 8 MiB.");
            return;
          }
          setBusy(true);
          try {
            const response = await fetch(
              `/api/documents/upload?filename=${encodeURIComponent(file.name)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: file,
              },
            );
            const result = await response.json();
            if (!response.ok)
              throw new Error(
                result?.error?.message || "Unable to upload file.",
              );
            setMessage(
              `Saved ${file.name} as ${result.saved} document section${result.saved === 1 ? "" : "s"}. You can find them in Memory library → Documents. Semantic indexing runs in the background; keyword search is available immediately.`,
            );
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Unable to upload file.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="memory-file">Choose file</label>
        <input
          id="memory-file"
          type="file"
          accept=".pdf,.txt,.md"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setMessage("");
            setError("");
          }}
        />
        <button type="submit" disabled={!file || busy}>
          {busy ? "Processing file…" : "Upload and save to memory"}
        </button>
      </form>
      {busy && <p role="status">Extracting and saving document text…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
