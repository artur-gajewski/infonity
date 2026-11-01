type ConfirmationDialogProps = {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmationDialog({
  text,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  return (
    <section
      className="modal"
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm deletion"
    >
      <h2>Confirm deletion</h2>
      <p className="confirmation-text">{text}</p>
      <div className="card-actions">
        <button onClick={onConfirm} className="danger-button">
          Confirm
        </button>
        <button autoFocus onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
