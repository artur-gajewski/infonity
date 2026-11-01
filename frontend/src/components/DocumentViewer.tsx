import type { Memory } from "../api";
import { documentTitle } from "../ui";

type DocumentViewerProps = {
  document: Memory;
  onEdit: (memory: Memory) => void;
  onClose: () => void;
};

export default function DocumentViewer({
  document,
  onEdit,
  onClose,
}: DocumentViewerProps) {
  return (
    <section
      className="modal document-modal document-view-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Document"
    >
      <h2 className="document-dialog-title" tabIndex={-1}>
        {documentTitle(document)}
      </h2>
      <div className="document-body">
        {document.value || "This document is empty."}
      </div>
      <div className="card-actions">
        <button onClick={() => onEdit(document)}>Edit memory</button>
        <button onClick={onClose}>Close</button>
      </div>
    </section>
  );
}
