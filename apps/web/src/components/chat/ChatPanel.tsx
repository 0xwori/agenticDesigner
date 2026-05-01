import React, { useEffect, useMemo, useState } from "react";
import type {
  ComposerAttachment,
  DeckSlideCount,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  PipelineEvent,
  ProjectBundle,
  SelectedBlockContext,
  SurfaceTarget,
} from "@designer/shared";
import { AlertCircle, Bot, Boxes, Monitor, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { ThreadPrimitive } from "@assistant-ui/react";
import type {
  CanvasMode,
  FlowMutationReviewState,
  LocalPreferences,
  PromptEntry,
  RunMode,
} from "../../types/ui";
import { ChatRuntimeProvider } from "./ChatRuntimeProvider";
import { ChatContextProvider } from "./ChatContext";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ChatComposer } from "./ChatComposer";

export type ChatPanelProps = {
  bundle: ProjectBundle | null;
  preferences: LocalPreferences;
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
  promptHistory: PromptEntry[];
  eventsByRun: Map<string, PipelineEvent[]>;
  orphanEvents: PipelineEvent[];
  error: string;
  initializeProject: () => Promise<void> | void;
  handleRun: (event: React.FormEvent) => Promise<void>;
  openWorkspaceSettings: () => void;
  formatThoughtDuration: (startedAt: string, events: PipelineEvent[]) => string;
  canSubmit: boolean;
  selectedFrameContextLabel: string | null;
  eventCapReached: boolean;
  canvasMode: CanvasMode;
  activeFlowBoardName: string | null;
  flowMutationReviews: Record<string, FlowMutationReviewState>;
  onApproveFlowMutationReview: (runId: string) => void;
  onRejectFlowMutationReview: (runId: string) => void;
};

export function ChatPanel(props: ChatPanelProps) {
  const {
    bundle,
    preferences,
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
    promptHistory,
    eventsByRun,
    orphanEvents,
    error,
    initializeProject,
    handleRun,
    openWorkspaceSettings,
    formatThoughtDuration,
    canSubmit,
    selectedFrameContextLabel,
    eventCapReached,
    canvasMode,
    activeFlowBoardName,
    flowMutationReviews,
    onApproveFlowMutationReview,
    onRejectFlowMutationReview,
  } = props;

  // Ticker for live elapsed time in thought blocks
  const [, setTicker] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTicker((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const chatContextValue = useMemo(
    () => ({
      eventsByRun,
      flowMutationReviews,
      formatThoughtDuration,
      onApproveFlowMutationReview,
      onRejectFlowMutationReview,
      onSetComposerPrompt: setComposerPrompt,
    }),
    [
      eventsByRun,
      flowMutationReviews,
      formatThoughtDuration,
      onApproveFlowMutationReview,
      onRejectFlowMutationReview,
      setComposerPrompt,
    ],
  );

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
          <Boxes size={11} />
          {bundle?.assets?.length ?? 0} assets
        </span>
        <span>
          <Bot size={11} />
          {preferences.provider}
        </span>
      </section>

      <ChatRuntimeProvider
        promptHistory={promptHistory}
        eventsByRun={eventsByRun}
        orphanEvents={orphanEvents}
      >
        <ChatContextProvider value={chatContextValue}>
          <ThreadPrimitive.Root className="aui-root chat-thread-root">
            <ThreadPrimitive.Viewport className="chat-feed">
              {eventCapReached ? (
                <div className="chat-cap-notice">
                  <AlertCircle size={11} />
                  <span>Older events not shown — session history capped at 420 events.</span>
                </div>
              ) : null}

              {promptHistory.length === 0 && orphanEvents.length === 0 ? (
                <div className="chat-empty-state">
                  <p>
                    Ask a design question or request a screen. The intent router will answer or
                    take action automatically.
                  </p>
                </div>
              ) : null}

              <ThreadPrimitive.Messages
                components={{
                  UserMessage,
                  AssistantMessage,
                }}
              />
            </ThreadPrimitive.Viewport>

            <ChatComposer
              bundle={bundle}
              composerPrompt={composerPrompt}
              setComposerPrompt={setComposerPrompt}
              composerAttachments={composerAttachments}
              addImageAttachment={addImageAttachment}
              addTextAttachment={addTextAttachment}
              addFigmaAttachment={addFigmaAttachment}
              removeComposerAttachment={removeComposerAttachment}
              runMode={runMode}
              setRunMode={setRunMode}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              selectedMode={selectedMode}
              setSelectedMode={setSelectedMode}
              selectedDesignSystemMode={selectedDesignSystemMode}
              setSelectedDesignSystemMode={setSelectedDesignSystemMode}
              selectedSurfaceTarget={selectedSurfaceTarget}
              deckSlideCount={deckSlideCount}
              setDeckSlideCount={setDeckSlideCount}
              selectedBlockContext={selectedBlockContext}
              variation={variation}
              setVariation={setVariation}
              tailwindOverride={tailwindOverride}
              onTailwindPreferenceChange={onTailwindPreferenceChange}
              canSubmit={canSubmit}
              selectedFrameContextLabel={selectedFrameContextLabel}
              canvasMode={canvasMode}
              activeFlowBoardName={activeFlowBoardName}
              handleRun={handleRun}
            />
          </ThreadPrimitive.Root>
        </ChatContextProvider>
      </ChatRuntimeProvider>

      {error ? <p className="global-error">{error}</p> : null}
    </aside>
  );
}
