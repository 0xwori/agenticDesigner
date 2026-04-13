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

function getAcceptanceCriteriaGroups(story: FlowStory) {
  if (story.acceptanceCriteriaGroups && story.acceptanceCriteriaGroups.length > 0) {
    return story.acceptanceCriteriaGroups;
  }

  if (story.acceptanceCriteria.length === 0) {
    return [];
  }

  return [{ title: "Acceptance Criteria", items: story.acceptanceCriteria }];
}

function getTechnicalBriefing(story: FlowStory) {
  return story.technicalBriefing && story.technicalBriefing.length > 0
    ? story.technicalBriefing
    : story.technicalNotes;
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

  const acceptanceCriteriaGroups = story ? getAcceptanceCriteriaGroups(story) : [];
  const technicalBriefing = story ? getTechnicalBriefing(story) : [];

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
                <h3>Goal</h3>
                <p className="flow-story-modal__story">{story.goal ?? story.userStory}</p>
              </section>

              <section className="workspace-modal__section">
                <h3>User Context</h3>
                <strong>Starting Point</strong>
                {story.startingPoint && story.startingPoint.length > 0 ? (
                  <ul className="flow-story-modal__list flow-story-modal__list--unordered">
                    {story.startingPoint.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-modal__hint">No explicit starting point was captured for this export.</p>
                )}
              </section>

              <section className="workspace-modal__section">
                <h3>Design</h3>
                <p className="flow-story-modal__story">{story.designReference?.trim() || "Not available in board context"}</p>
              </section>

              <section className="workspace-modal__section">
                <h3>Acceptance Criteria</h3>
                {acceptanceCriteriaGroups.map((group) => (
                  <div key={group.title} className="flow-story-modal__group">
                    <strong>{group.title}</strong>
                    <ul className="flow-story-modal__list flow-story-modal__list--unordered">
                      {group.items.map((criterion) => (
                        <li key={`${group.title}-${criterion}`}>{criterion}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>

              <section className="workspace-modal__section">
                <h3>Phrase Keys</h3>
                {story.phraseKeys && story.phraseKeys.length > 0 ? (
                  <ul className="flow-story-modal__list flow-story-modal__list--unordered">
                    {story.phraseKeys.map((key) => (
                      <li key={key}>{key}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-modal__hint">No specific phrase keys were needed for this export.</p>
                )}
              </section>

              <section className="workspace-modal__section">
                <h3>Technical Briefing</h3>
                {technicalBriefing.length > 0 ? (
                  <ul className="flow-story-modal__list flow-story-modal__list--unordered">
                    {technicalBriefing.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-modal__hint">No additional technical briefing was needed for this export.</p>
                )}
              </section>

              <section className="workspace-modal__section">
                <h3>Accessibility Requirements</h3>
                {story.accessibilityRequirements && story.accessibilityRequirements.length > 0 ? (
                  <ul className="flow-story-modal__list flow-story-modal__list--unordered">
                    {story.accessibilityRequirements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-modal__hint">No extra accessibility requirements were captured for this export.</p>
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