import type { Dispatch, PointerEvent, SetStateAction } from "react";
import type { CaptureLogEntry } from "../lib/figmaCapture";
import type { CopyState } from "../types/ui";
import type { FrameVersion, FrameWithVersions } from "@designer/shared";
import type { FrameSourceMeta } from "../lib/frameLinking";

type FrameCardProps = {
  frame: FrameWithVersions;
  version: FrameVersion | undefined;
  sourceMeta: FrameSourceMeta | null;
  copy: {
    state: CopyState;
    logs: CaptureLogEntry[];
  };
  expandedHistoryFrameId: string | null;
  buildPreviewDocument: (frameId: string, version?: FrameVersion) => string;
  beginDrag: (event: PointerEvent, frameId: string) => void;
  beginResize: (event: PointerEvent, frameId: string) => void;
  selectFrame: (frameId: string) => Promise<void>;
  copyFrameToFigma: (frameId: string) => Promise<void>;
  resyncFrameReference: (frameId: string) => Promise<void>;
  canResyncReference: boolean;
  allowFrameInteraction: boolean;
  openProjectDesignSystem: () => void;
  setExpandedHistoryFrameId: Dispatch<SetStateAction<string | null>>;
};

export function FrameCard(props: FrameCardProps) {
  const {
    frame,
    version,
    sourceMeta,
    copy,
    expandedHistoryFrameId,
    buildPreviewDocument,
    beginDrag,
    beginResize,
    selectFrame,
    copyFrameToFigma,
    resyncFrameReference,
    canResyncReference,
    allowFrameInteraction,
    openProjectDesignSystem,
    setExpandedHistoryFrameId
  } = props;

  const className = [
    "frame-card",
    frame.selected ? "is-selected" : "",
    sourceMeta?.sourceType === "figma-reference" ? "frame-card--special-figma" : "",
    sourceMeta?.sourceType === "image-reference" ? "frame-card--special-image" : "",
    sourceMeta?.sourceRole === "reference-screen" ? "frame-card--special-reference-screen" : "",
    sourceMeta?.sourceRole === "design-system" ? "frame-card--special-design-system" : "",
    allowFrameInteraction ? "frame-card--interactive" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      style={{
        left: frame.position.x,
        top: frame.position.y,
        width: frame.size.width,
        height: frame.size.height
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, summary, details")) {
          return;
        }
        void selectFrame(frame.id);
      }}
    >
      <header className="frame-card__header" onPointerDown={(event) => beginDrag(event, frame.id)}>
        <div>
          <h3>{frame.name}</h3>
          <p>
            {frame.devicePreset} • {frame.mode} • {frame.status}
          </p>
        </div>
        <div className="frame-card__actions">
          {canResyncReference ? <button onClick={() => void resyncFrameReference(frame.id)}>Resync</button> : null}
          {sourceMeta?.sourceRole === "design-system" ? (
            <button onClick={openProjectDesignSystem}>Open DS</button>
          ) : null}
          <button onClick={() => void selectFrame(frame.id)}>Select</button>
          <button onClick={() => setExpandedHistoryFrameId((current) => (current === frame.id ? null : frame.id))}>Versions</button>
          <button onClick={() => void copyFrameToFigma(frame.id)} disabled={copy.state === "capturing"}>
            {copy.state === "capturing"
              ? "Capturing..."
              : copy.state === "copied"
                ? "Copied"
                : copy.state === "failed"
                  ? "Copy Failed"
                  : "Copy to Figma"}
          </button>
        </div>
      </header>

      <div className="frame-card__preview">
        <iframe
          srcDoc={buildPreviewDocument(frame.id, version)}
          title={frame.name}
          sandbox="allow-scripts"
          style={{ pointerEvents: allowFrameInteraction ? "auto" : "none" }}
        />
        {!allowFrameInteraction ? (
          <div className="frame-card__preview-shield">
            Hold <kbd>Option</kbd> to interact with this preview
          </div>
        ) : null}
      </div>

      {expandedHistoryFrameId === frame.id ? (
        <div className="frame-history">
          {frame.versions.map((versionItem) => (
            <p key={versionItem.id}>
              {new Date(versionItem.createdAt).toLocaleTimeString()} • +{versionItem.diffFromPrevious.addedLines} / -
              {versionItem.diffFromPrevious.removedLines}
            </p>
          ))}
        </div>
      ) : null}

      <details className="frame-copy-debug" open={copy.state === "failed"}>
        <summary>Copy Debug Logs</summary>
        <pre>
          {copy.logs.length > 0
            ? copy.logs
                .map(
                  (entry) =>
                    `[${entry.timestamp}] [${entry.stage}] [${entry.status}] ${entry.message}${entry.data ? ` | ${entry.data}` : ""}`
                )
                .join("\n")
            : "No logs yet."}
        </pre>
      </details>

      <button className="frame-card__resize" onPointerDown={(event) => beginResize(event, frame.id)} aria-label="Resize frame" />
    </article>
  );
}
