import type { FlowStory } from "@designer/shared";
import { Copy, RefreshCw, X } from "lucide-react";

type FlowStoryModalProps = {
  open: boolean;
  boardName: string | null;
  busy: boolean;
  error: string | null;
  story: FlowStory | null;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
};

function formatGeneratedAt(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

export function FlowStoryModal({
  open,
  boardName,
  busy,
  error,
  story,
  copied,
  onClose,
  onCopy,
  onRegenerate,
}: FlowStoryModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="workspace-modal-overlay" role="dialog" aria-modal="true">
      <div className="workspace-modal flow-story-modal">
        <header className="workspace-modal__header">
          <div className="workspace-modal__title">
            <h2>Flow Story Export</h2>
            <p>{boardName ? `Saved for ${boardName}` : "Generate a user story from the current board."}</p>
          </div>
          <div className="workspace-modal__header-actions">
            <button type="button" onClick={onRegenerate} disabled={busy} aria-label="Regenerate flow story">
              <RefreshCw size={14} />
            </button>
            <button type="button" onClick={onCopy} disabled={!story || busy} aria-label="Copy flow story">
              <Copy size={14} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close flow story modal">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="workspace-modal__body">
          {busy ? (
            <section className="workspace-modal__section flow-story-modal__busy">
              <div className="gradient-loader">
                <div className="gradient-loader__bar" />
                <span className="gradient-loader__label">Generating the user story and acceptance criteria...</span>
              </div>
            </section>
          ) : null}

          {!busy && error ? (
            <section className="workspace-modal__section flow-story-modal__error">
              <h3>Story export failed</h3>
              <p className="workspace-modal__hint">{error}</p>
            </section>
          ) : null}

          {!busy && story ? (
            <>
              <section className="workspace-modal__section flow-story-modal__meta">
                <div>
                  <span className="flow-story-modal__eyebrow">Latest export</span>
                  <strong>{story.title}</strong>
                </div>
                <div className="flow-story-modal__meta-actions">
                  <span>{formatGeneratedAt(story.generatedAt)}</span>
                  {copied ? <span className="flow-story-modal__copied">Copied</span> : null}
                </div>
              </section>

              <section className="workspace-modal__section">
                <h3>User Story</h3>
                <p className="flow-story-modal__story">{story.userStory}</p>
              </section>

              <section className="workspace-modal__section">
                <h3>Acceptance Criteria</h3>
                <ol className="flow-story-modal__list">
                  {story.acceptanceCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ol>
              </section>

              <section className="workspace-modal__section">
                <h3>Technical Notes</h3>
                {story.technicalNotes.length > 0 ? (
                  <ul className="flow-story-modal__list flow-story-modal__list--unordered">
                    {story.technicalNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-modal__hint">No additional technical notes were needed for this export.</p>
                )}
              </section>
            </>
          ) : null}

          {!busy && !error && !story ? (
            <section className="workspace-modal__section flow-story-modal__empty">
              <h3>No story yet</h3>
              <p className="workspace-modal__hint">Generate a story from the board to capture user flow, acceptance criteria, and technical notes.</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}