import React, { useRef, useState, useMemo } from "react";
import type {
  ComposerAttachment,
  DeckSlideCount,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  ProjectBundle,
  SelectedBlockContext,
  SurfaceTarget,
} from "@designer/shared";
import {
  FileText,
  ImagePlus,
  Link2,
  Plus,
  SendHorizontal,
  X,
} from "lucide-react";
import type { CanvasMode, RunMode } from "../../types/ui";

function toDisplayUrl(value: string) {
  try {
    const parsed = new URL(value);
    const path = `${parsed.host}${parsed.pathname}`;
    return path.length > 62 ? `${path.slice(0, 59)}...` : path;
  } catch {
    return value.length > 62 ? `${value.slice(0, 59)}...` : value;
  }
}

export type ChatComposerProps = {
  bundle: ProjectBundle | null;
  composerPrompt: string;
  setComposerPrompt: (value: string) => void;
  composerAttachments: ComposerAttachment[];
  addImageAttachment: (file: File) => Promise<void>;
  addTextAttachment: (file: File) => Promise<void>;
  addFigmaAttachment: (url: string) => void;
  removeComposerAttachment: (attachmentId: string) => void;
  runMode: RunMode;
  setRunMode: (value: RunMode) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (value: DevicePreset) => void;
  selectedMode: DesignMode;
  setSelectedMode: (value: DesignMode) => void;
  selectedDesignSystemMode: DesignSystemMode;
  setSelectedDesignSystemMode: (value: DesignSystemMode) => void;
  selectedSurfaceTarget: SurfaceTarget;
  deckSlideCount: DeckSlideCount;
  setDeckSlideCount: (value: DeckSlideCount) => void;
  selectedBlockContext: SelectedBlockContext | null;
  variation: number;
  setVariation: (value: number) => void;
  tailwindOverride: boolean;
  onTailwindPreferenceChange: (value: boolean) => void;
  canSubmit: boolean;
  selectedFrameContextLabel: string | null;
  canvasMode: CanvasMode;
  activeFlowBoardName: string | null;
  handleRun: (event: React.FormEvent) => Promise<void>;
};

export function ChatComposer({
  bundle,
  composerPrompt,
  setComposerPrompt,
  composerAttachments,
  addImageAttachment,
  addTextAttachment,
  addFigmaAttachment,
  removeComposerAttachment,
  runMode,
  setRunMode,
  selectedDevice,
  setSelectedDevice,
  selectedMode,
  setSelectedMode,
  selectedDesignSystemMode,
  setSelectedDesignSystemMode,
  selectedSurfaceTarget,
  deckSlideCount,
  setDeckSlideCount,
  selectedBlockContext,
  variation,
  setVariation,
  tailwindOverride,
  onTailwindPreferenceChange,
  canSubmit,
  selectedFrameContextLabel,
  canvasMode,
  activeFlowBoardName,
  handleRun,
}: ChatComposerProps) {
  const [isAttachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isFigmaInputOpen, setFigmaInputOpen] = useState(false);
  const [figmaInput, setFigmaInput] = useState("");
  const [isAddingImage, setIsAddingImage] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textFileInputRef = useRef<HTMLInputElement | null>(null);

  const imageAttachmentCount = useMemo(
    () =>
      composerAttachments.filter((a) => a.type === "image" && a.status !== "failed").length,
    [composerAttachments],
  );
  const textAttachmentCount = useMemo(
    () =>
      composerAttachments.filter((a) => a.type === "text" && a.status !== "failed").length,
    [composerAttachments],
  );

  React.useEffect(() => {
    if (!isAttachMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!attachMenuRef.current) return;
      if (!attachMenuRef.current.contains(event.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isAttachMenuOpen]);

  async function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachMenuOpen(false);
    setIsAddingImage(true);
    try {
      await addImageAttachment(file);
    } finally {
      setIsAddingImage(false);
    }
  }

  async function onTextSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachMenuOpen(false);
    await addTextAttachment(file);
  }

  function onSubmitFigmaLink() {
    if (!figmaInput.trim()) return;
    addFigmaAttachment(figmaInput.trim());
    setFigmaInput("");
    setFigmaInputOpen(false);
    setAttachMenuOpen(false);
  }

  const composerPlaceholder =
    canvasMode === "flow"
      ? "Describe the journey, ask the agent to fix gaps, add edge cases, or write technical briefings for this board..."
      : selectedSurfaceTarget === "deck"
        ? "Describe the presentation, paste source text, or attach a .txt/.md file..."
        : "Ask a question, request a screen, or attach a Figma/image reference...";

  return (
    <form className="composer" onSubmit={(event) => void handleRun(event)}>
      <div className="composer-attach-row" ref={attachMenuRef}>
        <button
          type="button"
          className={`composer-plus ${isAttachMenuOpen ? "is-open" : ""}`}
          onClick={() => setAttachMenuOpen((c) => !c)}
          aria-label="Open attachment options"
        >
          <Plus size={14} />
        </button>

        {isAttachMenuOpen ? (
          <div className="composer-plus-menu">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isAddingImage || imageAttachmentCount >= 1}
            >
              <ImagePlus size={13} />
              Add image
            </button>
            {selectedSurfaceTarget === "deck" ? (
              <button
                type="button"
                onClick={() => textFileInputRef.current?.click()}
                disabled={textAttachmentCount >= 1}
              >
                <FileText size={13} />
                Add text
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setFigmaInputOpen(true);
                setAttachMenuOpen(false);
              }}
            >
              <Link2 size={13} />
              Add Figma link
            </button>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          className="composer-hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
          onChange={onImageSelected}
        />
        <input
          ref={textFileInputRef}
          className="composer-hidden-file-input"
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={onTextSelected}
        />

        {isFigmaInputOpen ? (
          <div className="composer-figma-attach">
            <span className="composer-figma-label">
              <Link2 size={11} />
              Figma link
            </span>
            <input
              value={figmaInput}
              onChange={(e) => setFigmaInput(e.target.value)}
              placeholder="https://www.figma.com/design/..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmitFigmaLink();
                }
              }}
            />
            <button type="button" onClick={onSubmitFigmaLink}>
              Add
            </button>
            <button
              type="button"
              className="composer-icon-button"
              onClick={() => {
                setFigmaInputOpen(false);
                setFigmaInput("");
              }}
              aria-label="Close figma input"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}
      </div>

      {composerAttachments.length > 0 ? (
        <div className="composer-attachments">
          {composerAttachments.map((attachment) => {
            const isImage = attachment.type === "image";
            const isText = attachment.type === "text";
            const label = isImage
              ? attachment.name || "image"
              : isText
                ? attachment.name || "text source"
                : attachment.url
                  ? toDisplayUrl(attachment.url)
                  : "figma link";
            return (
              <div
                key={attachment.id}
                className={`composer-attachment-chip composer-attachment-chip--${attachment.status ?? "uploaded"}`}
              >
                <span className="composer-attachment-chip__label">
                  {isImage ? (
                    <ImagePlus size={11} />
                  ) : isText ? (
                    <FileText size={11} />
                  ) : (
                    <Link2 size={11} />
                  )}
                  {label}
                </span>
                <span className="composer-attachment-chip__status">
                  {attachment.status ?? "uploaded"}
                </span>
                <button
                  type="button"
                  onClick={() => removeComposerAttachment(attachment.id)}
                  aria-label="Remove attachment"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {canvasMode === "flow" && activeFlowBoardName ? (
        <div className="composer-selection-chip composer-selection-chip--flow">
          <span>Board</span>
          <strong>{activeFlowBoardName}</strong>
          <span className="composer-selection-chip__hint">Agent edits only this board</span>
        </div>
      ) : null}

      {canvasMode !== "flow" && selectedFrameContextLabel ? (
        <div className="composer-selection-chip">
          <span>{runMode === "edit-selected" ? "Editing:" : "Variant of:"}</span>
          <strong>{selectedFrameContextLabel}</strong>
          <span className="composer-selection-chip__hint">Click canvas to deselect</span>
        </div>
      ) : null}

      {canvasMode !== "flow" ? (
        <div className="composer-selection-chip composer-selection-chip--surface">
          <span>Type</span>
          <strong>
            {selectedSurfaceTarget === "deck"
              ? `Deck • ${deckSlideCount} slides`
              : selectedSurfaceTarget === "mobile"
                ? "Mobile"
                : "Web"}
          </strong>
          <span className="composer-selection-chip__hint">
            {selectedSurfaceTarget === "deck"
              ? "Prompt creates a slide deck"
              : "Prompt creates a screen"}
          </span>
        </div>
      ) : null}

      {(bundle?.assets?.length ?? 0) > 0 ? (
        <div className="composer-selection-chip composer-selection-chip--assets">
          <span>Assets</span>
          <strong>{bundle?.assets.length} available</strong>
          <span className="composer-selection-chip__hint">Agent can reuse them</span>
        </div>
      ) : null}

      {canvasMode !== "flow" && selectedBlockContext ? (
        <div className="composer-selection-chip composer-selection-chip--block">
          <span>Editing block</span>
          <strong>{selectedBlockContext.label || selectedBlockContext.blockId}</strong>
          <span className="composer-selection-chip__hint">Next edit is scoped to this block</span>
        </div>
      ) : null}

      <textarea
        value={composerPrompt}
        onChange={(e) => setComposerPrompt(e.target.value)}
        placeholder={composerPlaceholder}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
            e.preventDefault();
            void handleRun(e as unknown as React.FormEvent);
          }
        }}
      />

      <div className="composer-toolbar">
        <div className="composer-toolbar__left">
          {canvasMode !== "flow" && selectedFrameContextLabel ? (
            <div className="composer-mode-toggle">
              <button
                type="button"
                className={`composer-mode-toggle__btn${runMode === "edit-selected" ? " is-active" : ""}`}
                onClick={() => setRunMode("edit-selected")}
              >
                Edit
              </button>
              <button
                type="button"
                className={`composer-mode-toggle__btn${runMode === "new-frame" ? " is-active" : ""}`}
                onClick={() => setRunMode("new-frame")}
              >
                Variant
              </button>
            </div>
          ) : null}
          {canvasMode === "flow" ? (
            <span className="composer-flow-hint">
              Journey agent mode. The selected board is the only editable scope.
            </span>
          ) : selectedSurfaceTarget === "deck" ? (
            <>
              <label>
                <select
                  value={deckSlideCount}
                  onChange={(e) => setDeckSlideCount(Number(e.target.value) as DeckSlideCount)}
                >
                  <option value={5}>5 slides</option>
                  <option value={10}>10 slides</option>
                  <option value={25}>25 slides</option>
                </select>
              </label>
              <label>
                <select
                  value={selectedDesignSystemMode}
                  onChange={(e) =>
                    setSelectedDesignSystemMode(e.target.value as DesignSystemMode)
                  }
                >
                  <option value="strict">DS strict</option>
                  <option value="creative">DS creative</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                <select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value as DevicePreset)}
                >
                  <option value="desktop">Desktop</option>
                  <option value="iphone">iPhone</option>
                  <option value="iphone-15">iPhone 15</option>
                  <option value="iphone-15-pro">iPhone 15 Pro</option>
                  <option value="iphone-15-pro-max">iPhone 15 Pro Max</option>
                </select>
              </label>
              <label>
                <select
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value as DesignMode)}
                >
                  <option value="high-fidelity">High-fidelity</option>
                  <option value="wireframe">Wireframe</option>
                </select>
              </label>
              <label>
                <select
                  value={selectedDesignSystemMode}
                  onChange={(e) =>
                    setSelectedDesignSystemMode(e.target.value as DesignSystemMode)
                  }
                >
                  <option value="strict">DS strict</option>
                  <option value="creative">DS creative</option>
                </select>
              </label>
              <label>
                <select
                  value={variation}
                  onChange={(e) => setVariation(Number(e.target.value))}
                >
                  <option value={1}>1x</option>
                  <option value={3}>3x</option>
                  <option value={5}>5x</option>
                </select>
              </label>
              <label className="composer-checkbox">
                <input
                  type="checkbox"
                  checked={tailwindOverride}
                  onChange={(e) => onTailwindPreferenceChange(e.target.checked)}
                />
                Tailwind
              </label>
            </>
          )}
        </div>
        <button type="submit" disabled={!canSubmit}>
          <SendHorizontal size={13} />
          Send
        </button>
      </div>
    </form>
  );
}
