import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  DesignFrameRefArtifact,
  FlowArtifact,
  FlowHandleSide,
  FrameVersion,
  FrameWithVersions,
  JourneyStepShape,
} from "@designer/shared";
import { FLOW_HANDLE_SIDES, isMobilePreset } from "@designer/shared";
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

function getFramePreviewCardHeight(frameElement: HTMLElement): number {
  const frameHeight = Math.max(
    Math.ceil(frameElement.offsetHeight || 0),
    Math.ceil(frameElement.clientHeight || 0),
  );
  const visualElement = frameElement.closest(".flow-rf-node__visual");
  if (!(visualElement instanceof HTMLElement)) {
    return frameHeight;
  }

  return Math.max(frameHeight + getVerticalBoxModelHeight(visualElement), 120);
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

type FlowScreenPreviewMode = NonNullable<DesignFrameRefArtifact["previewMode"]>;

function getStandardFrameSize(devicePreset?: FrameWithVersions["devicePreset"]) {
  if (devicePreset === "iphone-15-pro-max") {
    return { width: 430, height: 932 };
  }
  if (devicePreset === "iphone-15-pro" || devicePreset === "iphone-15" || devicePreset === "iphone" || isMobilePreset(devicePreset ?? "desktop")) {
    return { width: 393, height: 852 };
  }
  return { width: 1240, height: 880 };
}

function resolveScreenPreviewMode(artifact: DesignFrameRefArtifact): FlowScreenPreviewMode {
  if (artifact.previewMode === "content" || artifact.previewMode === "manual") {
    return artifact.previewMode;
  }
  return "standard";
}

function clampManualPreviewHeight(value: number): number {
  return Math.max(140, Math.round(value));
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
  const isMediaArtifact = artifact.type === "design-frame-ref" || artifact.type === "uploaded-image";
  const reportResolvedPreviewHeight = useCallback(
    (height: number) => {
      if (height <= 0) {
        return;
      }

      onMeasure?.(cellId, height);
    },
    [cellId, onMeasure],
  );

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
        <div
          className={[
            "flow-rf-node__visual",
            shape === "diamond" ? "flow-rf-node__visual--diamond" : "",
            isMediaArtifact ? "flow-rf-node__visual--media" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            ref={contentRef}
            className={[
              "flow-rf-node__content",
              shape === "diamond" ? "flow-rf-node__content--diamond" : "",
              isMediaArtifact ? "flow-rf-node__content--media" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {artifact.type === "design-frame-ref" ? (
              <DesignFrameRefContent
                artifact={artifact}
                refFrame={refFrame}
                buildPreviewDocument={buildPreviewDocument}
                onLoad={reportMeasurement}
                onResolvedHeightChange={reportResolvedPreviewHeight}
                onChangeArtifact={(nextArtifact) => onUpdateArtifact?.(cellId, nextArtifact)}
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
  artifact,
  refFrame,
  buildPreviewDocument,
  onLoad,
  onResolvedHeightChange,
  onChangeArtifact,
}: {
  artifact: DesignFrameRefArtifact;
  refFrame?: FrameWithVersions;
  buildPreviewDocument: (frameId: string, version?: FrameVersion, isBuilding?: boolean) => string;
  onLoad: () => void;
  onResolvedHeightChange?: (height: number) => void;
  onChangeArtifact?: (artifact: DesignFrameRefArtifact) => void;
}) {
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ pointerId: number; startClientY: number; startHeight: number } | null>(null);
  const previewWidth = Math.max(refFrame?.size.width ?? 1, 1);
  const previewHeight = Math.max(refFrame?.size.height ?? 1, 1);
  const [previewScale, setPreviewScale] = useState(() => 220 / previewWidth);
  const [previewWidthPx, setPreviewWidthPx] = useState(220);
  const [reportedContentHeight, setReportedContentHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const previewVersion = resolveRefFrameVersion(refFrame);
  const standardFrameSize = getStandardFrameSize(refFrame?.devicePreset);
  const previewMode = resolveScreenPreviewMode(artifact);
  const intrinsicIframeHeight = Math.max(reportedContentHeight ?? previewHeight, previewHeight);

  const updatePreviewScale = useCallback(() => {
    const element = previewFrameRef.current;
    if (!element) {
      return;
    }

    const nextWidth = Math.max(element.clientWidth, 1);
    const nextScale = nextWidth / previewWidth;
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      return;
    }

    setPreviewWidthPx((current) => (Math.abs(current - nextWidth) < 1 ? current : nextWidth));
    setPreviewScale((current) => (Math.abs(current - nextScale) < 0.01 ? current : nextScale));
  }, [previewWidth]);

  const standardDisplayHeight = Math.max(
    140,
    Math.round((previewWidthPx * standardFrameSize.height) / standardFrameSize.width),
  );
  const contentDisplayHeight = Math.max(140, Math.round(intrinsicIframeHeight * previewScale));
  const resolvedDisplayHeight = previewMode === "manual"
    ? clampManualPreviewHeight(artifact.previewHeight ?? standardDisplayHeight)
    : previewMode === "content"
      ? contentDisplayHeight
      : standardDisplayHeight;

  useLayoutEffect(() => {
    if (!refFrame || !onResolvedHeightChange) {
      return;
    }

    const frameElement = previewFrameRef.current;
    if (!frameElement) {
      return;
    }

    onResolvedHeightChange(getFramePreviewCardHeight(frameElement));
  }, [onResolvedHeightChange, refFrame, resolvedDisplayHeight]);

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

  useEffect(() => {
    setReportedContentHeight(null);
  }, [refFrame?.id, previewVersion?.id]);

  useEffect(() => {
    if (!refFrame || !previewVersion) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        frameId?: string;
        versionId?: string;
        height?: number;
      } | null;

      if (!payload || payload.type !== "designer.frame-content-height") {
        return;
      }

      const reportedHeight = typeof payload.height === "number" ? payload.height : null;

      if (payload.frameId !== refFrame.id || payload.versionId !== previewVersion.id || reportedHeight === null) {
        return;
      }

      if (!Number.isFinite(reportedHeight) || reportedHeight < 120) {
        return;
      }

      setReportedContentHeight((current) => {
        const nextHeight = Math.ceil(reportedHeight);
        return current !== null && Math.abs(current - nextHeight) < 2 ? current : nextHeight;
      });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [previewVersion, refFrame]);

  useEffect(() => {
    if (!isResizing || !onChangeArtifact) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || event.pointerId !== resizeState.pointerId) {
        return;
      }

      onChangeArtifact({
        ...artifact,
        previewMode: "manual",
        previewHeight: clampManualPreviewHeight(resizeState.startHeight + (event.clientY - resizeState.startClientY)),
      });
    };

    const stopResize = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || event.pointerId !== resizeState.pointerId) {
        return;
      }

      resizeStateRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [artifact, isResizing, onChangeArtifact]);

  if (!refFrame) {
    return (
      <div className="flow-rf-node__frame-preview flow-rf-node__frame-preview--minimal">
        <div className="flow-rf-node__frame-placeholder flow-rf-node__frame-placeholder--missing">
          Referenced screen is no longer available.
        </div>
      </div>
    );
  }

  const previewHtml = buildPreviewDocument(refFrame.id, previewVersion, refFrame.status === "building");
  const statusTone = refFrame.status === "building" ? "loading" : previewVersion ? "ready" : "empty";

  return (
    <div className="flow-rf-node__frame-preview flow-rf-node__frame-preview--minimal">
      <div className="flow-rf-node__frame-stage">
        {onChangeArtifact ? (
          <div className="flow-rf-node__frame-toolbar" data-flow-node-interactive="true">
            <button
              type="button"
              className={`flow-rf-node__frame-toolbar-btn ${previewMode === "standard" ? "is-active" : ""}`}
              title="Use the standard device ratio"
              onClick={(event) => {
                event.stopPropagation();
                onChangeArtifact({ ...artifact, previewMode: "standard" });
              }}
            >
              Std
            </button>
            <button
              type="button"
              className={`flow-rf-node__frame-toolbar-btn ${previewMode === "content" ? "is-active" : ""}`}
              title="Show the screen until the end of the content"
              onClick={(event) => {
                event.stopPropagation();
                onChangeArtifact({ ...artifact, previewMode: "content" });
              }}
            >
              Full
            </button>
          </div>
        ) : null}

        {statusTone === "ready" ? (
          <span className="flow-rf-node__frame-live-dot" title="Live" aria-label="Live preview" />
        ) : null}

        <div ref={previewFrameRef} className="flow-rf-node__frame-live" style={{ height: resolvedDisplayHeight }}>
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
                height: intrinsicIframeHeight,
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
              onLoad={() => {
                updatePreviewScale();
                onLoad();
              }}
            />
          </div>
        </div>

        {onChangeArtifact ? (
          <button
            type="button"
            className={`flow-rf-node__frame-resize ${isResizing ? "is-active" : ""}`}
            data-flow-node-interactive="true"
            aria-label="Resize screen preview height"
            title="Drag to set a custom preview height"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resizeStateRef.current = {
                pointerId: event.pointerId,
                startClientY: event.clientY,
                startHeight: resolvedDisplayHeight,
              };
              setIsResizing(true);
            }}
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}
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
    <div className="flow-rf-node__image" title={label ?? "Uploaded image"}>
      <img src={dataUrl} alt={label ?? "uploaded"} draggable={false} onLoad={onLoad} />
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