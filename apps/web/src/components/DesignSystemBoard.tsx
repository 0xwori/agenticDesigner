import type { ReferenceSource } from "@designer/shared";

type DesignSystemBoardProps = {
  reference: ReferenceSource;
  index: number;
  handleApproveDesignSystem: (reference: ReferenceSource) => Promise<void>;
  handleMarkDesignSystemNeedsEdits: (reference: ReferenceSource) => Promise<void>;
};

export function DesignSystemBoard(props: DesignSystemBoardProps) {
  const { reference, index, handleApproveDesignSystem, handleMarkDesignSystemNeedsEdits } = props;
  const context = reference.extractedStyleContext;
  const checklist = reference.designSystemChecklist;
  if (!context && !checklist) {
    return null;
  }

  return (
    <section
      className="style-board"
      style={{
        left: 48 + index * 560,
        top: 52
      }}
    >
      <header className="style-board__header">
        <div>
          <h3>Design System</h3>
          <p>{reference.scope === "page" ? "Page link" : "Frame link"}</p>
        </div>
        <div className={`style-board__status style-board__status--${reference.designSystemStatus ?? "draft"}`}>
          {reference.designSystemStatus ?? "draft"}
        </div>
      </header>

      {checklist ? (
        <div className="style-board__checklist">
          {checklist.sections.map((section) => (
            <div key={section.section} className="style-board__section">
              <h4>{section.section}</h4>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {context ? (
        <div className="style-board__section">
          <h4>Reference Tokens</h4>
          <div className="style-board__colors">
            {Object.entries(context.palette).map(([token, color]) => (
              <div key={token} className="style-board__color-item">
                <span className="style-board__swatch" style={{ background: color }} />
                <p>
                  <strong>{token}</strong>
                  <span>{color}</span>
                </p>
              </div>
            ))}
          </div>
          <p>Heading: {context.typography.headingFamily}</p>
          <p>Body: {context.typography.bodyFamily}</p>
          <p>Radius: {context.typography.cornerRadius}px</p>
        </div>
      ) : null}

      <footer className="style-board__actions">
        <button
          type="button"
          className="style-board__button style-board__button--approve"
          onClick={() => void handleApproveDesignSystem(reference)}
          disabled={reference.designSystemStatus === "approved"}
        >
          Approve
        </button>
        <button
          type="button"
          className="style-board__button"
          onClick={() => void handleMarkDesignSystemNeedsEdits(reference)}
        >
          Needs edits
        </button>
      </footer>
    </section>
  );
}
