import { Copy, X } from "lucide-react";

type FlowBoardMemoryModalProps = {
  open: boolean;
  boardName: string | null;
  memoryText: string;
  copied: boolean;
  persisted: boolean;
  onClose: () => void;
  onCopy: () => void;
};

export function FlowBoardMemoryModal({
  open,
  boardName,
  memoryText,
  copied,
  persisted,
  onClose,
  onCopy,
}: FlowBoardMemoryModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="workspace-modal-overlay" role="dialog" aria-modal="true">
      <div className="workspace-modal flow-board-memory-modal">
        <header className="workspace-modal__header">
          <div className="workspace-modal__title">
            <h2>Board Memory YAML</h2>
            <p>{boardName ? `Inspect memory for ${boardName}` : "Inspect the board-scoped memory document."}</p>
          </div>
          <div className="workspace-modal__header-actions">
            <button type="button" onClick={onCopy} disabled={!memoryText} aria-label="Copy board memory">
              <Copy size={14} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close board memory modal">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="workspace-modal__body">
          <section className="workspace-modal__section flow-board-memory-modal__meta">
            <div>
              <span className="flow-story-modal__eyebrow">Memory source</span>
              <strong>{persisted ? "Saved board memory" : "Derived preview from current board"}</strong>
            </div>
            <div className="flow-story-modal__meta-actions">
              {copied ? <span className="flow-story-modal__copied">Copied</span> : null}
            </div>
          </section>

          <section className="workspace-modal__section">
            <h3>YAML</h3>
            <pre className="flow-board-memory-modal__code">{memoryText || "# No board memory available yet."}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}