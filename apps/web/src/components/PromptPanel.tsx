import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ComposerAttachment,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  PipelineEvent,
  ProjectBundle,
  SurfaceTarget
} from "@designer/shared";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ImagePlus,
  Link2,
  LoaderCircle,
  Monitor,
  Palette,
  Plus,
  RefreshCw,
  SendHorizontal,
  Settings2,
  Sparkles,
  UserRound,
  X
} from "lucide-react";
import type { LocalPreferences, PromptEntry, RunMode } from "../types/ui";
import { EventStageIcon, stageLabel } from "./pipelineVisuals";
import { sortPipelineEvents } from "../lib/eventOrdering";

type PromptPanelProps = {
  bundle: ProjectBundle | null;
  preferences: LocalPreferences;
  composerPrompt: string;
  setComposerPrompt: (value: string) => void;
  composerAttachments: ComposerAttachment[];
  addImageAttachment: (file: File) => Promise<void>;
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
  setSelectedSurfaceTarget: (value: SurfaceTarget) => void;
  variation: number;
  setVariation: (value: number) => void;
  tailwindOverride: boolean;
  onTailwindPreferenceChange: (value: boolean) => void;
  promptHistory: PromptEntry[];
  eventsByRun: Map<string, PipelineEvent[]>;
  orphanEvents: PipelineEvent[];
  error: string;
  initializeProject: () => Promise<void> | void;
  handleRun: (event: React.FormEvent) => Promise<void>;
  openWorkspaceSettings: () => void;
  openProjectDesignSystem: () => void;
  formatThoughtDuration: (startedAt: string, events: PipelineEvent[]) => string;
  canSubmit: boolean;
  selectedFrameContextLabel: string | null;
};

function toDisplayUrl(value: string) {
  try {
    const parsed = new URL(value);
    const path = `${parsed.host}${parsed.pathname}`;
    return path.length > 62 ? `${path.slice(0, 59)}...` : path;
  } catch {
    return value.length > 62 ? `${value.slice(0, 59)}...` : value;
  }
}

function describeActionEvent(event: PipelineEvent) {
  const detailParts: string[] = [];
  const step = typeof event.payload?.step === "string" ? event.payload.step : null;
  const target = typeof event.payload?.target === "string" ? event.payload.target : null;
  const artifact = typeof event.payload?.artifact === "string" ? event.payload.artifact : null;
  const statusDetail = typeof event.payload?.statusDetail === "string" ? event.payload.statusDetail : null;
  const attempt = typeof event.payload?.attempt === "number" ? event.payload.attempt : null;
  const nextStep = typeof event.payload?.nextStep === "string" ? event.payload.nextStep : null;

  if (step) {
    detailParts.push(step.replaceAll("-", " "));
  }
  if (attempt !== null) {
    detailParts.push(`attempt ${attempt}`);
  }
  if (target) {
    detailParts.push(target);
  }
  if (artifact) {
    detailParts.push(artifact);
  }
  if (statusDetail) {
    detailParts.push(statusDetail);
  }
  if (nextStep) {
    detailParts.push(`next: ${nextStep.replaceAll("-", " ")}`);
  }

  return detailParts.join(" • ");
}

type RunActivity = {
  state: "running" | "done" | "failed";
  stage: PipelineEvent["stage"];
  statusDetail: string | null;
};

function resolveRunActivity(events: PipelineEvent[]): RunActivity {
  if (events.length === 0) {
    return { state: "running", stage: "system", statusDetail: null };
  }

  const latest = events[events.length - 1];
  const latestStep = typeof latest.payload?.step === "string" ? latest.payload.step : null;
  const isTerminalSuccess = latestStep === "run-complete";
  const isTerminalFailure = latestStep === "run-failed" || (latest.stage === "system" && latest.status === "error");
  const stageSource = [...events].reverse().find((event) => event.stage !== "system") ?? latest;
  const statusDetail =
    typeof latest.payload?.statusDetail === "string"
      ? latest.payload.statusDetail
      : typeof latest.payload?.nextStep === "string"
        ? `Next: ${latest.payload.nextStep.replaceAll("-", " ")}`
        : null;

  if (isTerminalFailure) {
    return {
      state: "failed",
      stage: stageSource.stage,
      statusDetail
    };
  }

  if (isTerminalSuccess || (latest.stage === "system" && latest.status === "success")) {
    return {
      state: "done",
      stage: stageSource.stage,
      statusDetail
    };
  }

  return {
    state: "running",
    stage: stageSource.stage,
    statusDetail
  };
}

export function PromptPanel(props: PromptPanelProps) {
  const {
    bundle,
    preferences,
    composerPrompt,
    setComposerPrompt,
    composerAttachments,
    addImageAttachment,
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
    setSelectedSurfaceTarget,
    variation,
    setVariation,
    tailwindOverride,
    onTailwindPreferenceChange,
    promptHistory,
    eventsByRun,
    orphanEvents,
    error,
    initializeProject,
    handleRun,
    openWorkspaceSettings,
    openProjectDesignSystem,
    formatThoughtDuration,
    canSubmit,
    selectedFrameContextLabel
  } = props;

  const [isAttachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isFigmaInputOpen, setFigmaInputOpen] = useState(false);
  const [figmaInput, setFigmaInput] = useState("");
  const [isAddingImage, setIsAddingImage] = useState(false);
  const [, setTicker] = useState(0);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const formatAgentLabel = (event: PipelineEvent) => {
    const agent = typeof event.payload?.agent === "string" ? event.payload.agent : null;
    if (!agent) {
      return stageLabel(event.stage);
    }
    return `${agent} • ${stageLabel(event.stage)}`;
  };

  useEffect(() => {
    if (!isAttachMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!attachMenuRef.current) {
        return;
      }
      const target = event.target as Node;
      if (!attachMenuRef.current.contains(target)) {
        setAttachMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isAttachMenuOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTicker((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const imageAttachmentCount = useMemo(
    () =>
      composerAttachments.filter(
        (attachment) => attachment.type === "image" && attachment.status !== "failed"
      ).length,
    [composerAttachments]
  );

  async function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setAttachMenuOpen(false);
    setIsAddingImage(true);
    try {
      await addImageAttachment(file);
    } finally {
      setIsAddingImage(false);
    }
  }

  function onSubmitFigmaLink() {
    if (!figmaInput.trim()) {
      return;
    }

    addFigmaAttachment(figmaInput.trim());
    setFigmaInput("");
    setFigmaInputOpen(false);
    setAttachMenuOpen(false);
  }

  return (
    <aside className="chat-pane">
      <header className="chat-pane__header">
        <div className="chat-pane__title">
          <span className="chat-pane__mark" />
          <div>
            <p className="chat-pane__eyebrow">Design Agent Lab</p>
            <h1>Publisher&apos;s Workshop</h1>
          </div>
        </div>
        <div className="chat-pane__header-actions">
          <button onClick={openProjectDesignSystem} aria-label="Open project design system">
            <Palette size={13} />
          </button>
          <button onClick={openWorkspaceSettings} aria-label="Open workspace settings">
            <Settings2 size={13} />
          </button>
          <button onClick={() => void initializeProject()} aria-label="Refresh workspace">
            <RefreshCw size={13} />
          </button>
        </div>
      </header>

      <section className="chat-summary-strip">
        <span>
          <Monitor size={11} />
          {bundle?.frames.length ?? 0} frames
        </span>
        <span>
          <Sparkles size={11} />
          {bundle?.references.length ?? 0} refs
        </span>
        <span>
          <Bot size={11} />
          {preferences.provider}
        </span>
      </section>

      <section className="chat-feed">
        {promptHistory.length === 0 ? (
          <div className="chat-empty-state">
            <p>Ask a design question or request a screen. The intent router will answer or take action automatically.</p>
          </div>
        ) : null}

        {promptHistory.map((entry) => {
          const runEvents = sortPipelineEvents(eventsByRun.get(entry.runId) ?? []);
          const summaryEvent = [...runEvents].reverse().find((event) => event.kind === "summary") ?? runEvents[0];
          const actionEvents = runEvents.filter((event) => event.kind !== "summary");
          const runActivity = resolveRunActivity(runEvents);
          const runStage = stageLabel(runActivity.stage);
          const runElapsed =
            runActivity.state === "running"
              ? `${Math.max(1, Math.round((Date.now() - new Date(entry.submittedAt).getTime()) / 1000))}s`
              : formatThoughtDuration(entry.submittedAt, runEvents);

          return (
            <section key={entry.runId} className="chat-turn">
              <p className="chat-turn__time">{new Date(entry.submittedAt).toLocaleTimeString()}</p>

              <div className="chat-message chat-message--user">
                <span className="chat-avatar">
                  <UserRound size={12} />
                </span>
                <div className="chat-bubble chat-bubble--user">
                  <p>{entry.prompt}</p>
                </div>
              </div>

              {summaryEvent ? (
                <div className="chat-message chat-message--assistant">
                  <span className="chat-avatar chat-avatar--assistant">
                    <Bot size={12} />
                  </span>
                  <div className="thought-block">
                    <p className="thought-block__label">Thought for {formatThoughtDuration(entry.submittedAt, runEvents)}</p>
                    <article className="thought-card">
                      <div className="thought-card__summary">
                        <span className="thought-card__summary-icon">
                          <Sparkles size={12} />
                        </span>
                        <div>
                          <p>{summaryEvent.message}</p>
                          {typeof summaryEvent.payload?.reason === "string" ? (
                            <span className="thought-card__meta">{summaryEvent.payload.reason}</span>
                          ) : null}
                          <div className={`thought-card__run-state thought-card__run-state--${runActivity.state}`}>
                            <span className="thought-card__run-state-icon" aria-hidden="true">
                              {runActivity.state === "running" ? (
                                <LoaderCircle size={11} />
                              ) : runActivity.state === "done" ? (
                                <CheckCircle2 size={11} />
                              ) : (
                                <AlertCircle size={11} />
                              )}
                            </span>
                            <div>
                              <p>
                                {runActivity.state === "running"
                                  ? `Running • ${runStage}`
                                  : runActivity.state === "done"
                                    ? "Done"
                                    : "Failed"}
                              </p>
                              <span>{runActivity.statusDetail ?? `Elapsed ${runElapsed}`}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="thought-timeline" role="list">
                        {actionEvents.length > 0 ? (
                          actionEvents.map((event, index) => {
                            const detail = describeActionEvent(event);
                            const calibrationOptions = Array.isArray(event.payload?.calibrationOptions)
                              ? event.payload.calibrationOptions.filter(
                                  (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
                                )
                              : [];
                            return (
                              <article
                                key={`${event.timestamp}-${index}`}
                                role="listitem"
                                className={`timeline-action-card timeline-action-card--${event.status}`}
                              >
                                <span className="timeline-action-card__icon">
                                  <EventStageIcon stage={event.stage} />
                                </span>
                                <div className="timeline-action-card__body">
                                  <p>{event.message}</p>
                                  <span>{formatAgentLabel(event)}</span>
                                  {detail ? <span className="timeline-action-card__detail">{detail}</span> : null}
                                  {calibrationOptions.length > 0 ? (
                                    <div className="timeline-action-card__calibration">
                                      {calibrationOptions.map((option) => (
                                        <button
                                          key={option}
                                          type="button"
                                          onClick={() => setComposerPrompt(`/ds-calibrate ${option}`)}
                                        >
                                          {option}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              </article>
                            );
                          })
                        ) : (
                          runActivity.state === "running" ? (
                            <article className="timeline-action-card timeline-action-card--idle">
                              <span className="timeline-action-card__icon">
                                <LoaderCircle size={11} />
                              </span>
                              <div className="timeline-action-card__body">
                                <p>Working on the next step…</p>
                                <span>{entry.mode === "edit-selected" ? "editing selected frame" : "preparing new frame"}</span>
                              </div>
                            </article>
                          ) : null
                        )}
                      </div>
                    </article>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}

        {orphanEvents.length > 0 ? (
          <section className="system-feed">
            {orphanEvents.map((event, index) => (
              <article key={`${event.runId}-${event.timestamp}-${index}`} className={`timeline-item timeline-item--${event.status}`}>
                <span className="timeline-icon">
                  <EventStageIcon stage={event.stage} />
                </span>
                <div>
                  <p className="timeline-message">{event.message}</p>
                  <p className="timeline-meta">{stageLabel(event.stage)}</p>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </section>

      <form className="composer" onSubmit={(event) => void handleRun(event)}>
        <div className="composer-attach-row" ref={attachMenuRef}>
          <button
            type="button"
            className={`composer-plus ${isAttachMenuOpen ? "is-open" : ""}`}
            onClick={() => setAttachMenuOpen((current) => !current)}
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

          {isFigmaInputOpen ? (
            <div className="composer-figma-attach">
              <span className="composer-figma-label">
                <Link2 size={11} />
                Figma link
              </span>
              <input
                value={figmaInput}
                onChange={(event) => setFigmaInput(event.target.value)}
                placeholder="https://www.figma.com/design/..."
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmitFigmaLink();
                  }
                }}
              />
              <button type="button" onClick={onSubmitFigmaLink}>Add</button>
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
              const label =
                isImage
                  ? attachment.name || "image"
                  : attachment.url
                    ? toDisplayUrl(attachment.url)
                    : "figma link";

              return (
                <div key={attachment.id} className={`composer-attachment-chip composer-attachment-chip--${attachment.status ?? "uploaded"}`}>
                  <span className="composer-attachment-chip__label">
                    {isImage ? <ImagePlus size={11} /> : <Link2 size={11} />}
                    {label}
                  </span>
                  <span className="composer-attachment-chip__status">{attachment.status ?? "uploaded"}</span>
                  <button type="button" onClick={() => removeComposerAttachment(attachment.id)} aria-label="Remove attachment">
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {selectedFrameContextLabel ? (
          <div className="composer-selection-chip">
            <span>Selected frame</span>
            <strong>{selectedFrameContextLabel}</strong>
          </div>
        ) : null}

        <textarea
          value={composerPrompt}
          onChange={(event) => setComposerPrompt(event.target.value)}
          placeholder="Ask a question, request a screen, or attach a Figma/image reference..."
          rows={3}
        />
        <div className="composer-toolbar">
          <div className="composer-toolbar__left">
            <label>
              <select value={runMode} onChange={(event) => setRunMode(event.target.value as RunMode)}>
                <option value="new-frame">New frame</option>
                <option value="edit-selected">Edit selected</option>
              </select>
            </label>
            <label>
              <select
                value={selectedSurfaceTarget}
                onChange={(event) => {
                  const next = event.target.value as SurfaceTarget;
                  setSelectedSurfaceTarget(next);
                  setSelectedDevice(next === "mobile" ? "iphone" : "desktop");
                }}
              >
                <option value="web">Web</option>
                <option value="mobile">Mobile</option>
              </select>
            </label>
            <label>
              <select value={selectedDevice} onChange={(event) => setSelectedDevice(event.target.value as DevicePreset)}>
                <option value="desktop">Desktop</option>
                <option value="iphone">iPhone</option>
              </select>
            </label>
            <label>
              <select value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as DesignMode)}>
                <option value="high-fidelity">High-fidelity</option>
                <option value="wireframe">Wireframe</option>
              </select>
            </label>
            <label>
              <select
                value={selectedDesignSystemMode}
                onChange={(event) => setSelectedDesignSystemMode(event.target.value as DesignSystemMode)}
              >
                <option value="strict">DS strict</option>
                <option value="creative">DS creative</option>
              </select>
            </label>
            <label>
              <select value={variation} onChange={(event) => setVariation(Number(event.target.value))}>
                <option value={1}>1x</option>
                <option value={3}>3x</option>
                <option value={5}>5x</option>
              </select>
            </label>
            <label className="composer-checkbox">
              <input
                type="checkbox"
                checked={tailwindOverride}
                onChange={(event) => {
                  const next = event.target.checked;
                  onTailwindPreferenceChange(next);
                }}
              />
              Tailwind
            </label>
          </div>
          <button type="submit" disabled={!canSubmit}>
            <SendHorizontal size={13} />
            Send
          </button>
        </div>
      </form>

      {error ? <p className="global-error">{error}</p> : null}
    </aside>
  );
}
