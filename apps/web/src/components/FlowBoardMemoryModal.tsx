import { Copy, X } from "lucide-react";

type FlowBoardMemoryModalProps = {
  open: boolean;
  boardName: string;
  memoryText: string;
  updatedAt?: string | null;
  copied: boolean;
  derived: boolean;
  onClose: () => void;
  onCopy: () => void;
};

function formatTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

export function FlowBoardMemoryModal({
  open,
  boardName,
  memoryText,
  updatedAt,
  copied,
  derived,
  onClose,
  onCopy,
}: FlowBoardMemoryModalProps) {
  if (!open) {
    return null;
  }

  const formattedTimestamp = formatTimestamp(updatedAt);

  return (
    <div className="workspace-modal-overlay" role="dialog" aria-modal="true">
      <div className="workspace-modal flow-board-memory-modal">
        <header className="workspace-modal__header">
          <div className="workspace-modal__title">
            <h2>Board Memory YAML</h2>
            <p>
              {derived
                ? `Preview generated from the current ${boardName} board.`
                : `Saved board memory for ${boardName}.`}
            </p>
          </div>
          <div className="workspace-modal__header-actions">
            <button type="button" onClick={onCopy} aria-label="Copy board memory">
              <Copy size={14} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close board memory modal">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="workspace-modal__body flow-board-memory-modal__body">
          <section className="workspace-modal__section flow-board-memory-modal__meta">
            <span>{derived ? "Preview only" : formattedTimestamp ? `Updated ${formattedTimestamp}` : "Saved board memory"}</span>
            {copied ? <strong>Copied</strong> : null}
          </section>

          <section className="workspace-modal__section flow-board-memory-modal__content">
            <pre className="flow-board-memory-modal__pre">{memoryText}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}