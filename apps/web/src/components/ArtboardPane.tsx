import { useEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, PointerEvent, RefObject, SetStateAction } from "react";
import type { FlowDocument, FrameVersion, FrameWithVersions } from "@designer/shared";
import type { CaptureLogEntry } from "../lib/figmaCapture";
import type { FramePairLink, FrameSourceMeta } from "../lib/frameLinking";
import type { CanvasMode, CopyState } from "../types/ui";
import { FrameCard } from "./FrameCard";
import { FlowWorkspace } from "./FlowWorkspace";
import { FigmaImportPopover } from "./FigmaImportPopover";
import { Palette, Link2, Wand2, LayoutDashboard, GitBranch } from "lucide-react";

type PendingCanvasCard = {
  id: string;
  sourceType: "figma-reference" | "image-reference";
  sourceRole: "reference-screen" | "design-system";
  name: string;
  subtitle: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

type ArtboardPaneProps = {
  interactionType: "drag" | "resize" | "pan" | null;
  artboardBackgroundStyle: CSSProperties;
  viewport: { x: number; y: number; scale: number };
  viewportRef: RefObject<HTMLDivElement>;
  frames: FrameWithVersions[];
  frameLookup: Map<string, FrameVersion | undefined>;
  frameMetaById: Map<string, FrameSourceMeta>;
  frameLinks: FramePairLink[];
  copyStates: Record<string, { state: CopyState; logs: CaptureLogEntry[] }>;
  expandedHistoryFrameId: string | null;
  setExpandedHistoryFrameId: Dispatch<SetStateAction<string | null>>;
  zoomBy: (factor: number) => void;
  buildPreviewDocument: (frameId: string, version?: FrameVersion, isBuilding?: boolean) => string;
  beginDrag: (event: PointerEvent, frameId: string) => void;
  beginResize: (event: PointerEvent, frameId: string) => void;
  selectFrame: (frameId: string) => Promise<void>;
  clearCanvasSelection: () => Promise<void>;
  copyFrameToFigma: (frameId: string) => Promise<void>;
  resyncFrameReference: (frameId: string) => Promise<void>;
  openProjectDesignSystem: () => void;
  allowFrameInteraction: boolean;
  pendingCanvasCards: PendingCanvasCard[];
  onImportFigmaScreen?: (figmaUrl: string) => Promise<void>;
  hasDesignSystem?: boolean;
  onOpenBrandPicker?: () => void;
  toggleFrameHeight: (frameId: string) => void;
  onRegenerate?: (frameId: string) => void;
  framePrompts?: Map<string, string>;
  canvasMode: CanvasMode;
  onCanvasModeChange: (mode: CanvasMode) => void;
  activeFlowFrame?: FrameWithVersions | null;
  allDesignFrames?: FrameWithVersions[];
  allFlowFrames?: FrameWithVersions[];
  onFlowDocumentChange?: (frameId: string, doc: FlowDocument) => void;
  onFocusedFlowAreaChange?: (areaId: string | null) => void;
  onSelectFlowBoard?: (frameId: string) => Promise<void>;
  onCreateFlowBoard?: () => Promise<void>;
  onDeleteFlowBoard?: (frameId: string) => Promise<void>;
  onAskAgentForFlowBoard?: (frameId: string) => Promise<void>;
  onOpenFlowStory?: (frameId: string) => Promise<void>;
  activeFlowBoardTask?: "agent" | "story" | null;
};

export function ArtboardPane(props: ArtboardPaneProps) {
  const {
    interactionType,
    artboardBackgroundStyle,
    viewport,
    viewportRef,
    frames,
    frameLookup,
    frameMetaById,
    frameLinks,
    copyStates,
    expandedHistoryFrameId,
    setExpandedHistoryFrameId,
    zoomBy,
    buildPreviewDocument,
    beginDrag,
    beginResize,
    selectFrame,
    clearCanvasSelection,
    copyFrameToFigma,
    resyncFrameReference,
    openProjectDesignSystem,
    allowFrameInteraction,
    pendingCanvasCards,
    onImportFigmaScreen,
    hasDesignSystem,
    onOpenBrandPicker,
    toggleFrameHeight,
    onRegenerate,
    framePrompts,
    canvasMode,
    onCanvasModeChange,
    activeFlowFrame,
    allDesignFrames,
    allFlowFrames,
    onFlowDocumentChange,
    onFocusedFlowAreaChange,
    onSelectFlowBoard,
    onCreateFlowBoard,
    onDeleteFlowBoard,
    onAskAgentForFlowBoard,
    onOpenFlowStory,
    activeFlowBoardTask,
  } = props;

  const [showImportPopover, setShowImportPopover] = useState(false);
  const [artboardViewportHeight, setArtboardViewportHeight] = useState(800);
  const [artboardViewportWidth, setArtboardViewportWidth] = useState(1200);
  const backgroundPointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    canClear: boolean;
  } | null>(null);
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    const updateViewportSize = () => {
      setArtboardViewportWidth(Math.max(960, viewportElement.clientWidth || window.innerWidth));
      setArtboardViewportHeight(Math.max(640, viewportElement.clientHeight || window.innerHeight));
    };

    updateViewportSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportSize);
      return () => window.removeEventListener("resize", updateViewportSize);
    }

    const observer = new ResizeObserver(() => {
      updateViewportSize();
    });
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [viewportRef]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement || canvasMode !== "flow") {
      return;
    }

    const shouldContainFlowGesture = (target: EventTarget | null) =>
      target instanceof HTMLElement && Boolean(target.closest(".flow-workspace"));

    const containFlowGesture = (event: Event) => {
      if (!shouldContainFlowGesture(event.target)) {
        return;
      }
      event.preventDefault();
    };

    viewportElement.addEventListener("wheel", containFlowGesture, { passive: false, capture: true });
    viewportElement.addEventListener("gesturestart", containFlowGesture, { passive: false, capture: true });
    viewportElement.addEventListener("gesturechange", containFlowGesture, { passive: false, capture: true });
    viewportElement.addEventListener("gestureend", containFlowGesture, { passive: false, capture: true });

    return () => {
      viewportElement.removeEventListener("wheel", containFlowGesture, true);
      viewportElement.removeEventListener("gesturestart", containFlowGesture, true);
      viewportElement.removeEventListener("gesturechange", containFlowGesture, true);
      viewportElement.removeEventListener("gestureend", containFlowGesture, true);
    };
  }, [canvasMode, viewportRef]);

  return (
    <main className="canvas-pane">
      <div
        className={`artboard-viewport ${canvasMode === "flow" ? "artboard-viewport--flow" : ""} ${interactionType === "pan" ? "is-panning" : interactionType === "drag" ? "is-dragging" : ""}`}
        ref={viewportRef}
        style={canvasMode === "flow" ? undefined : artboardBackgroundStyle}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".frame-card, .flow-frame-card, .flow-workspace, .canvas-floating-controls, .artboard-empty-state")) {
            backgroundPointerRef.current = null;
            return;
          }

          backgroundPointerRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            canClear: true
          };
        }}
        onPointerMove={(event) => {
          const pointerState = backgroundPointerRef.current;
          if (!pointerState || pointerState.pointerId !== event.pointerId) {
            return;
          }
          if (Math.abs(event.clientX - pointerState.startX) > 5 || Math.abs(event.clientY - pointerState.startY) > 5) {
            pointerState.canClear = false;
          }
        }}
        onPointerUp={(event) => {
          const pointerState = backgroundPointerRef.current;
          backgroundPointerRef.current = null;
          if (!pointerState || pointerState.pointerId !== event.pointerId) {
            return;
          }
          if (!pointerState.canClear || interactionType) {
            return;
          }
          void clearCanvasSelection();
        }}
        onPointerCancel={() => {
          backgroundPointerRef.current = null;
        }}
      >
        <div className="canvas-floating-controls">
          <button
            onClick={() => onCanvasModeChange("design")}
            aria-label="Design mode"
            className={`canvas-ds-btn ${canvasMode === "design" ? "canvas-mode-btn--active" : ""}`}
          >
            <LayoutDashboard size={13} />
          </button>
          <button
            onClick={() => onCanvasModeChange("flow")}
            aria-label="Flow mode"
            className={`canvas-ds-btn ${canvasMode === "flow" ? "canvas-mode-btn--active" : ""}`}
          >
            <GitBranch size={13} />
          </button>
          {canvasMode === "design" ? (
            <>
              <button onClick={() => zoomBy(0.9)} aria-label="Zoom out">
                -
              </button>
              <button onClick={() => zoomBy(1.12)} aria-label="Zoom in">
                +
              </button>
              {onImportFigmaScreen ? (
                <button onClick={() => setShowImportPopover(true)} aria-label="Import Figma screen" className="canvas-ds-btn">
                  <Link2 size={13} />
                </button>
              ) : null}
              {onOpenBrandPicker ? (
                <button onClick={onOpenBrandPicker} aria-label="Brand templates" className="canvas-ds-btn">
                  <Palette size={13} />
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Figma import popover */}
        {showImportPopover && onImportFigmaScreen ? (
          <FigmaImportPopover
            onImport={async (url) => {
              await onImportFigmaScreen(url);
              setShowImportPopover(false);
            }}
            onClose={() => setShowImportPopover(false)}
          />
        ) : null}

        {/* Empty state */}
        {canvasMode === "design" && frames.length === 0 && pendingCanvasCards.length === 0 && !showImportPopover ? (
          <div className="artboard-empty-state">
            {!hasDesignSystem ? (
              <>
                <div className="artboard-empty-state__ds-hint">
                  <Wand2 size={20} />
                  <h3>No design system selected</h3>
                  <p>Choose a brand template or create a custom design system to get started.</p>
                  {onOpenBrandPicker ? (
                    <button className="artboard-empty-state__btn artboard-empty-state__btn--primary" onClick={onOpenBrandPicker}>
                      <Palette size={13} /> Choose Design System
                    </button>
                  ) : null}
                </div>
                <div className="artboard-empty-state__divider">or</div>
              </>
            ) : null}
            <p>Start by typing a prompt{hasDesignSystem ? "" : " after selecting a design system"}, or import an existing screen.</p>
            {onImportFigmaScreen ? (
              <button className="artboard-empty-state__btn" onClick={() => setShowImportPopover(true)}>
                <Link2 size={13} /> Import from Figma
              </button>
            ) : null}
          </div>
        ) : null}

        {canvasMode === "flow" ? (
          activeFlowFrame ? (
            <FlowWorkspace
              frame={activeFlowFrame}
              flowDocument={activeFlowFrame.flowDocument}
              viewportWidth={artboardViewportWidth}
              viewportHeight={artboardViewportHeight}
              allDesignFrames={allDesignFrames ?? []}
              allFlowFrames={allFlowFrames ?? []}
              onFlowDocumentChange={onFlowDocumentChange}
              buildPreviewDocument={buildPreviewDocument}
              onFocusedAreaChange={onFocusedFlowAreaChange}
              onExitToDesign={() => onCanvasModeChange("design")}
              onSelectFlowBoard={onSelectFlowBoard}
              onCreateFlowBoard={onCreateFlowBoard}
              onDeleteBoard={onDeleteFlowBoard}
              onAskAgentForBoard={onAskAgentForFlowBoard}
              onOpenFlowStory={onOpenFlowStory}
              boardBusyState={activeFlowBoardTask}
            />
          ) : null
        ) : (
          <div className="artboard-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
            <div className="artboard-surface">
              {frameLinks.length > 0 ? (
                <svg className="artboard-link-layer" viewBox="0 0 12000 9000" preserveAspectRatio="none">
                  {frameLinks.map((link) => {
                    const fromFrame = frameById.get(link.fromFrameId);
                    const toFrame = frameById.get(link.toFrameId);
                    if (!fromFrame || !toFrame) {
                      return null;
                    }

                    const x1 = fromFrame.position.x + fromFrame.size.width / 2;
                    const y1 = fromFrame.position.y + fromFrame.size.height / 2;
                    const x2 = toFrame.position.x + toFrame.size.width / 2;
                    const y2 = toFrame.position.y + toFrame.size.height / 2;
                    const isImage = link.sourceType === "image-reference";

                    return (
                      <g key={`${link.sourceGroupId}-${link.fromFrameId}-${link.toFrameId}`}>
                        <line
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          className={`artboard-link-line ${isImage ? "artboard-link-line--image" : "artboard-link-line--figma"}`}
                        />
                        <circle
                          cx={x1}
                          cy={y1}
                          r={6}
                          className={`artboard-link-node ${isImage ? "artboard-link-node--image" : "artboard-link-node--figma"}`}
                        />
                        <circle cx={x2} cy={y2} r={7} className="artboard-link-node artboard-link-node--design-system" />
                      </g>
                    );
                  })}
                </svg>
              ) : null}

              {frames.map((frame) => {
                const sourceMeta = frameMetaById.get(frame.id) ?? null;
                const canResyncReference = sourceMeta?.sourceType === "figma-reference";
                return (
                  <FrameCard
                    key={frame.id}
                    frame={frame}
                    version={frameLookup.get(frame.id)}
                    sourceMeta={sourceMeta}
                    copy={copyStates[frame.id] ?? { state: "idle", logs: [] }}
                    expandedHistoryFrameId={expandedHistoryFrameId}
                    setExpandedHistoryFrameId={setExpandedHistoryFrameId}
                    buildPreviewDocument={buildPreviewDocument}
                    beginDrag={beginDrag}
                    beginResize={beginResize}
                    selectFrame={selectFrame}
                    copyFrameToFigma={copyFrameToFigma}
                    resyncFrameReference={resyncFrameReference}
                    canResyncReference={canResyncReference}
                    openProjectDesignSystem={openProjectDesignSystem}
                    allowFrameInteraction={allowFrameInteraction}
                    toggleFrameHeight={toggleFrameHeight}
                    hasDesignSystem={hasDesignSystem ?? false}
                    onOpenBrandPicker={onOpenBrandPicker}
                    onRegenerate={onRegenerate}
                    framePrompt={framePrompts?.get(frame.id)}
                  />
                );
              })}

              {pendingCanvasCards.map((pendingCard) => {
                const pendingClassName = [
                  "frame-card",
                  "frame-card--pending",
                  pendingCard.sourceType === "figma-reference" ? "frame-card--special-figma" : "frame-card--special-image",
                  pendingCard.sourceRole === "reference-screen"
                    ? "frame-card--special-reference-screen"
                    : "frame-card--special-design-system"
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <article
                    key={pendingCard.id}
                    className={pendingClassName}
                    style={{
                      left: pendingCard.position.x,
                      top: pendingCard.position.y,
                      width: pendingCard.size.width,
                      height: pendingCard.size.height
                    }}
                  >
                    <header className="frame-card__header">
                      <div>
                        <h3>{pendingCard.name}</h3>
                        <p>building • syncing to canvas</p>
                      </div>
                    </header>
                    <div className="frame-card__preview frame-card__preview--pending">
                      <div className="frame-card__pending-spinner" />
                      <p>{pendingCard.subtitle}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
