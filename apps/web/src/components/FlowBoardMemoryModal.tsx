import { Copy, X } from "lucide-react";

type FlowBoardMemoryModalProps = {
  open: boolean;
  boardName: string | null;
  memoryText: string;
  copied: boolean;
  persisted: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onCopy: () => void;
  onChangeMemoryText: (value: string) => void;
  onSave: () => void;
};

export function FlowBoardMemoryModal({
  open,
  boardName,
  memoryText,
  copied,
  persisted,
  dirty,
  saving,
  error,
  onClose,
  onCopy,
  onChangeMemoryText,
  onSave,
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
              <span>{dirty ? "Unsaved changes" : persisted ? "Synced" : "Preview"}</span>
              {copied ? <span className="flow-story-modal__copied">Copied</span> : null}
              <button
                type="button"
                className="flow-board-memory-modal__save-btn"
                onClick={onSave}
                disabled={saving || !dirty}
              >
                {saving ? "Saving..." : dirty ? "Save and sync" : "Saved"}
              </button>
            </div>
          </section>

          {error ? (
            <section className="workspace-modal__section flow-story-modal__error">
              <h3>Board memory save failed</h3>
              <p className="workspace-modal__hint">{error}</p>
            </section>
          ) : null}

          <section className="workspace-modal__section">
            <h3>YAML</h3>
            <p className="workspace-modal__hint">
              Saving updates the board-scoped memory document and resynchronizes mapped journey and technical notes on this board.
            </p>
            <textarea
              className="flow-board-memory-modal__textarea"
              value={memoryText}
              onChange={(event) => onChangeMemoryText(event.target.value)}
              spellCheck={false}
            />
          </section>
        </div>
      </div>
    </div>
  );
}