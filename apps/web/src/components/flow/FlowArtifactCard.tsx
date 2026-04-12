import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  FlowArtifact,
  FlowHandleSide,
  FrameVersion,
  FrameWithVersions,
  JourneyStepShape,
} from "@designer/shared";
import { FLOW_HANDLE_SIDES } from "@designer/shared";
import { X } from "lucide-react";

type FlowArtifactCardProps = {
  cellId: string;
  artifact: FlowArtifact;
  refFrame?: FrameWithVersions;
  buildPreviewDocument: (frameId: string, version?: FrameVersion, isBuilding?: boolean) => string;
  editing?: boolean;
  dragging?: boolean;
  connecting?: boolean;
  selected?: boolean;
  focusState?: "default" | "primary" | "related" | "dimmed";
  snapTargetSide?: FlowHandleSide | null;
  onRemove?: (cellId: string) => void;
  onUpdateArtifact?: (cellId: string, artifact: FlowArtifact) => void;
  onStartEdit?: (cellId: string) => void;
  onFinishEdit?: () => void;
  onMeasure?: (cellId: string, height: number) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartConnection?: (side: FlowHandleSide, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onEnterFocusMode?: (cellId: string) => void;
};

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getVerticalBoxModelHeight(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  return Math.ceil(
    readPixelValue(styles.paddingTop) +
      readPixelValue(styles.paddingBottom) +
      readPixelValue(styles.borderTopWidth) +
      readPixelValue(styles.borderBottomWidth),
  );
}

function getIntrinsicElementHeight(contentElement: HTMLElement): number {
  const visibleContentHeight = Math.max(
    Math.ceil(contentElement.offsetHeight || 0),
    Math.ceil(contentElement.clientHeight || 0),
  );

  const visualElement = contentElement.parentElement;
  if (!(visualElement instanceof HTMLElement)) {
    return visibleContentHeight;
  }

  const minimumDiamondHeight = visualElement.classList.contains("flow-rf-node__visual--diamond")
    ? Math.ceil((visualElement.clientWidth || 240) * 0.6)
    : 0;

  return Math.max(visibleContentHeight + getVerticalBoxModelHeight(visualElement), minimumDiamondHeight);
}

function resolveRefFrameVersion(refFrame?: FrameWithVersions): FrameVersion | undefined {
  if (!refFrame) {
    return undefined;
  }

  const currentVersion = refFrame.currentVersionId
    ? refFrame.versions.find((version) => version.id === refFrame.currentVersionId)
    : undefined;
  if (currentVersion) {
    return currentVersion;
  }

  return refFrame.versions[refFrame.versions.length - 1];
}

export function FlowArtifactCard({
  cellId,
  artifact,
  refFrame,
  buildPreviewDocument,
  editing = false,
  dragging = false,
  connecting = false,
  selected = false,
  focusState = "default",
  snapTargetSide = null,
  onRemove,
  onUpdateArtifact,
  onStartEdit,
  onFinishEdit,
  onMeasure,
  onPointerDown,
  onStartConnection,
  onEnterFocusMode,
}: FlowArtifactCardProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const shape = artifact.type === "journey-step" ? (artifact.shape ?? "rectangle") : "rectangle";

  const reportMeasurement = useCallback(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    const nextHeight = getIntrinsicElementHeight(element);
    if (nextHeight <= 0) {
      return;
    }

    onMeasure?.(cellId, nextHeight);
  }, [cellId, onMeasure]);

  useEffect(() => {
    reportMeasurement();
  }, [artifact, editing, reportMeasurement, shape]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      reportMeasurement();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [reportMeasurement]);

  return (
    <div
      className={[
        "flow-rf-node",
        shape === "diamond" ? "flow-rf-node--diamond" : "",
        dragging ? "is-dragging" : "",
        connecting ? "flow-rf-node--connecting" : "",
        selected ? "is-selected" : "",
        focusState === "primary" ? "is-focus-primary" : "",
        focusState === "related" ? "is-focus-related" : "",
        focusState === "dimmed" ? "is-focus-dimmed" : "",
        snapTargetSide ? "is-snap-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-selected={selected}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (editing) {
          return;
        }
        onEnterFocusMode?.(cellId);
      }}
    >
      {FLOW_HANDLE_SIDES.map((side) => (
        <button
          key={side}
          type="button"
          className={`flow-rf-handle flow-node-handle ${snapTargetSide === side ? "is-snap-target" : ""}`}
          data-side={side}
          data-flow-target-handle="true"
          data-cell-id={cellId}
          data-flow-node-interactive="true"
          aria-label={`Connect from ${side}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            onStartConnection?.(side, event);
          }}
        />
      ))}

      <button
        type="button"
        className="flow-rf-node__remove"
        data-flow-node-interactive="true"
        onClick={(event) => {
          event.stopPropagation();
          onRemove?.(cellId);
        }}
        aria-label="Remove"
      >
        <X size={10} />
      </button>

      <div className="flow-rf-node__shell">
        <div className={`flow-rf-node__visual ${shape === "diamond" ? "flow-rf-node__visual--diamond" : ""}`}>
          <div
            ref={contentRef}
            className={`flow-rf-node__content ${shape === "diamond" ? "flow-rf-node__content--diamond" : ""}`}
          >
            {artifact.type === "design-frame-ref" ? (
              <DesignFrameRefContent
                refFrame={refFrame}
                buildPreviewDocument={buildPreviewDocument}
                onLoad={reportMeasurement}
              />
            ) : null}
            {artifact.type === "uploaded-image" ? (
              <UploadedImageContent dataUrl={artifact.dataUrl} label={artifact.label} onLoad={reportMeasurement} />
            ) : null}
            {artifact.type === "journey-step" ? (
              <JourneyStepContent
                text={artifact.text}
                shape={artifact.shape ?? "rectangle"}
                isEditing={editing}
                onChange={(text) => onUpdateArtifact?.(cellId, { ...artifact, text })}
                onToggleShape={() => {
                  const nextShape = (artifact.shape ?? "rectangle") === "rectangle" ? "diamond" : "rectangle";
                  onUpdateArtifact?.(cellId, { ...artifact, shape: nextShape });
                }}
                onStartEdit={() => onStartEdit?.(cellId)}
                onFinishEdit={() => onFinishEdit?.()}
                onResize={reportMeasurement}
              />
            ) : null}
            {artifact.type === "technical-brief" ? (
              <TechnicalBriefContent
                title={artifact.title}
                language={artifact.language}
                body={artifact.body}
                isEditing={editing}
                onChange={(updates) => onUpdateArtifact?.(cellId, { ...artifact, ...updates })}
                onStartEdit={() => onStartEdit?.(cellId)}
                onFinishEdit={() => onFinishEdit?.()}
                onResize={reportMeasurement}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignFrameRefContent({
  refFrame,
  buildPreviewDocument,
  onLoad,
}: {
  refFrame?: FrameWithVersions;
  buildPreviewDocument: (frameId: string, version?: FrameVersion, isBuilding?: boolean) => string;
  onLoad: () => void;
}) {
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const previewWidth = Math.max(refFrame?.size.width ?? 1, 1);
  const previewHeight = Math.max(refFrame?.size.height ?? 1, 1);

  const updatePreviewScale = useCallback(() => {
    const element = previewFrameRef.current;
    if (!element) {
      return;
    }

    const nextScale = Math.min(
      element.clientWidth / previewWidth,
      element.clientHeight / previewHeight,
    );
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      return;
    }

    setPreviewScale((current) => (Math.abs(current - nextScale) < 0.01 ? current : nextScale));
  }, [previewHeight, previewWidth]);

  useEffect(() => {
    if (!refFrame) {
      return;
    }

    updatePreviewScale();
  }, [refFrame, updatePreviewScale]);

  useEffect(() => {
    const element = previewFrameRef.current;
    if (!refFrame || !element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updatePreviewScale();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [refFrame, updatePreviewScale]);

  if (!refFrame) {
    return (
      <div className="flow-rf-node__frame-preview">
        <div className="flow-rf-node__frame-header">
          <div className="flow-rf-node__frame-title-block">
            <span className="flow-rf-node__frame-kicker">Screen</span>
            <span className="flow-rf-node__frame-name">Referenced screen</span>
          </div>
          <span className="flow-rf-node__frame-status flow-rf-node__frame-status--missing">Missing</span>
        </div>
        <div className="flow-rf-node__frame-placeholder flow-rf-node__frame-placeholder--missing">
          Referenced screen is no longer available.
        </div>
      </div>
    );
  }

  const previewVersion = resolveRefFrameVersion(refFrame);
  const previewHtml = buildPreviewDocument(refFrame.id, previewVersion, refFrame.status === "building");
  const previewAspectRatio = refFrame.size.width > 0 && refFrame.size.height > 0
    ? `${refFrame.size.width} / ${refFrame.size.height}`
    : "16 / 10";
  const statusTone = refFrame.status === "building" ? "loading" : previewVersion ? "ready" : "empty";
  const statusLabel = refFrame.status === "building" ? "Building" : previewVersion ? "Live" : "Empty";

  return (
    <div className="flow-rf-node__frame-preview">
      <div className="flow-rf-node__frame-header">
        <div className="flow-rf-node__frame-title-block">
          <span className="flow-rf-node__frame-kicker">Screen</span>
          <span className="flow-rf-node__frame-name">{refFrame.name}</span>
        </div>
        <span className={`flow-rf-node__frame-status flow-rf-node__frame-status--${statusTone}`}>
          {statusLabel}
        </span>
      </div>
      <div ref={previewFrameRef} className="flow-rf-node__frame-live" style={{ aspectRatio: previewAspectRatio }}>
        <div className="flow-rf-node__frame-live-stage">
          <iframe
            key={previewVersion?.id ?? refFrame.id}
            srcDoc={previewHtml}
            title={refFrame.name}
            sandbox="allow-scripts"
            loading="lazy"
            tabIndex={-1}
            aria-hidden="true"
            style={{
              width: previewWidth,
              height: previewHeight,
              transform: `translate(-50%, -50%) scale(${previewScale})`,
            }}
            onLoad={() => {
              updatePreviewScale();
              onLoad();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function UploadedImageContent({
  dataUrl,
  label,
  onLoad,
}: {
  dataUrl: string;
  label?: string;
  onLoad: () => void;
}) {
  return (
    <div className="flow-rf-node__image">
      <img src={dataUrl} alt={label ?? "uploaded"} draggable={false} onLoad={onLoad} />
      {label ? <span className="flow-rf-node__image-label">{label}</span> : null}
    </div>
  );
}

function JourneyStepContent({
  text,
  shape,
  isEditing,
  onChange,
  onToggleShape,
  onStartEdit,
  onFinishEdit,
  onResize,
}: {
  text: string;
  shape: JourneyStepShape;
  isEditing: boolean;
  onChange: (text: string) => void;
  onToggleShape: () => void;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onResize: () => void;
}) {
  if (isEditing) {
    return (
      <div className="flow-rf-node__journey-edit" data-flow-node-interactive="true">
        <textarea
          className="flow-rf-node__journey-input"
          defaultValue={text}
          autoFocus
          onInput={onResize}
          onBlur={(event) => {
            onChange(event.target.value);
            onFinishEdit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onChange((event.target as HTMLTextAreaElement).value);
              onFinishEdit();
            }
          }}
          placeholder="Describe what the user does..."
        />
        <button
          type="button"
          className="flow-rf-node__shape-toggle"
          onClick={(event) => {
            event.stopPropagation();
            onToggleShape();
          }}
          title={shape === "rectangle" ? "Switch to decision (diamond)" : "Switch to step (rectangle)"}
        >
          {shape === "rectangle" ? "◇" : "▭"}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flow-rf-node__journey-text"
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
    >
      <span className="flow-rf-node__shape-badge">
        {shape === "diamond" ? "◇ Decision" : "▭ Step"}
      </span>
      {text || <span className="flow-rf-node__placeholder">Empty step. Double-click to edit.</span>}
    </div>
  );
}

function TechnicalBriefContent({
  title,
  language,
  body,
  isEditing,
  onChange,
  onStartEdit,
  onFinishEdit,
  onResize,
}: {
  title: string;
  language: string;
  body: string;
  isEditing: boolean;
  onChange: (updates: { title?: string; language?: string; body?: string }) => void;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onResize: () => void;
}) {
  if (isEditing) {
    return (
      <div className="flow-rf-node__brief-editor" data-flow-node-interactive="true">
        <input
          className="flow-rf-node__brief-title-input"
          defaultValue={title}
          placeholder="Title"
          onBlur={(event) => onChange({ title: event.target.value })}
        />
        <select
          className="flow-rf-node__brief-lang"
          defaultValue={language}
          onChange={(event) => onChange({ language: event.target.value })}
        >
          <option value="json">JSON</option>
          <option value="typescript">TypeScript</option>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="curl">cURL</option>
          <option value="text">Plain text</option>
        </select>
        <textarea
          className="flow-rf-node__brief-body-input"
          defaultValue={body}
          placeholder="Code or technical details..."
          onInput={onResize}
          onBlur={(event) => {
            onChange({ body: event.target.value });
            onFinishEdit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onChange({ body: (event.target as HTMLTextAreaElement).value });
              onFinishEdit();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="flow-rf-node__brief"
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
    >
      <div className="flow-rf-node__brief-header">
        <span className="flow-rf-node__brief-title">{title}</span>
        <span className="flow-rf-node__brief-lang-badge">{language}</span>
      </div>
      <pre className="flow-rf-node__brief-code">
        <code>{body || "// empty"}</code>
      </pre>
    </div>
  );
}