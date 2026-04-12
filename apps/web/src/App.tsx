import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ComposerAttachment,
  DesignSystemMode,
  DevicePreset,
  FlowDocument,
  FlowStory,
  FrameVersion,
  PipelineEvent,
  ProjectSettings,
  ReferenceSource,
  SurfaceTarget
} from "@designer/shared";
import { createEmptyFlowDocument, isMobilePreset, normalizeFlowDocument } from "@designer/shared";
import { select, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3-zoom";
import {
  calibrateProjectDesignSystem,
  clearBoard,
  createManualFrame,
  deleteFrame,
  generateFlowStory,
  getApiBaseUrl,
  getProjectBundle,
  resyncReference,
  startEditRun,
  startGenerateRun,
  sendFlowAction,
  updateFlowDocument,
  updateFrameLayout,
  updateProjectSettings
} from "./api";
import { captureSelectorToFigmaClipboard, type CaptureLogEntry } from "./lib/figmaCapture";
import { ArtboardPane } from "./components/ArtboardPane";
import {
  ensureCanonicalFlowDocument,
  resolveActiveFlowFrame,
  resolveFlowModeTarget,
  shouldUseFlowActionRoute,
} from "./lib/flowMode";
import { replaceFlowDocumentInBundle, rollbackFlowDocumentIfCurrent } from "./lib/flowDocumentState";
import { PromptPanel } from "./components/PromptPanel";
import { FlowBoardMemoryModal } from "./components/FlowBoardMemoryModal";
import { FlowStoryModal } from "./components/FlowStoryModal";
import { WorkspaceSettingsModal } from "./components/WorkspaceSettingsModal";
import { BrandPickerModal } from "./components/BrandPickerModal";
import {
  ProjectDesignSystemModal,
  type DesignSystemReferenceItem
} from "./components/ProjectDesignSystemModal";
import {
  buildFrameMetaMap,
  buildFramePairLinks,
  extractFrameSourceMeta,
  resolveReferenceForFrame
} from "./lib/frameLinking";
import {
  buildPreviewDocument,
  clampScale,
  createArtboardBackgroundStyle,
  createLocalRunId,
  extractFigmaUrl,
  formatThoughtDuration,
  loadPreferences,
  parseDesignSystemCalibrationCommand,
  parseFigmaCredentialsCommand,
  savePreferences,
  VIEWPORT_MAX_SCALE,
  VIEWPORT_MIN_SCALE,
  VIEWPORT_DEFAULT
} from "./lib/appHelpers";
import { comparePipelineEvents } from "./lib/eventOrdering";
import { createSmoothPanController } from "./lib/viewportController";
import { AppStoreContext, createStore, useInputState, useProjectState, useRunState, useUIState } from "./lib/store";
import { usePipelineEvents } from "./hooks/usePipelineEvents";
import { useDesignSystemWorkspace } from "./hooks/useDesignSystemWorkspace";
import { useComposerAttachments } from "./hooks/useComposerAttachments";
import type { AppState, CopyState, PromptEntry, RunMode } from "./types/ui";

type CopyStateMap = Record<string, { state: CopyState; logs: CaptureLogEntry[] }>;

type FlowBoardTaskKind = "agent" | "story";

type FlowBoardTaskState = {
  frameId: string;
  kind: FlowBoardTaskKind;
};

type FlowStoryModalState = {
  open: boolean;
  frameId: string | null;
  busy: boolean;
  error: string | null;
  story: FlowStory | null;
};

type FlowBoardMemoryModalState = {
  open: boolean;
  frameId: string | null;
};

const FLOW_BOARD_AGENT_PROMPT = "Review this entire flow board. Improve the user journey end to end, add missing happy-path and unhappy-path steps, and add short technical briefings for API, SDK, auth, session, cache, refresh-on-load, and recovery where useful. Edit only this selected board.";

function buildFlowBoardScopedPrompt(prompt: string) {
  const trimmedPrompt = prompt.trim();

  return [
    trimmedPrompt,
    "",
    "Board interaction requirements:",
    "- Read the current board artifacts, linked screens, uploaded images, connections, and stored board memory before mutating anything.",
    "- Keep changes scoped to the selected board only.",
    "- Prefer improving existing structure over adding duplicates.",
    "- If the request is broad, make a coherent end-to-end journey with concise technical notes where they materially help delivery.",
  ].join("\n");
}

function buildFlowStoryClipboard(story: FlowStory) {
  const acceptanceCriteria = story.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
  const technicalNotes = story.technicalNotes.length > 0
    ? story.technicalNotes.map((note) => `- ${note}`).join("\n")
    : "- None";

  return [`# ${story.title}`, "", "## User Story", story.userStory, "", "## Acceptance Criteria", acceptanceCriteria, "", "## Technical Notes", technicalNotes].join("\n");
}

function formatMemoryYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatMemoryYamlValue(item)).join(", ")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => {
      if (item === undefined) {
        return false;
      }
      if (Array.isArray(item)) {
        return item.length > 0;
      }
      if (typeof item === "string") {
        return item.trim().length > 0;
      }
      return true;
    });
    return `{ ${entries.map(([key, item]) => `${key}: ${formatMemoryYamlValue(item)}`).join(", ")} }`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return typeof value === "number" || typeof value === "boolean" ? String(value) : "null";
}

function buildFlowBoardMemoryPreview(flowDocument?: FlowDocument): { text: string; persisted: boolean } {
  const doc = normalizeFlowDocument(flowDocument ?? createEmptyFlowDocument());
  const authoredText = doc.boardMemory?.authoredText?.trim();

  if (authoredText) {
    return { text: authoredText, persisted: true };
  }

  const snapshot = doc.boardMemory?.snapshot ?? {
    version: 1 as const,
    goals: [],
    assumptions: [],
    entities: [],
    screens: doc.cells.flatMap((cell) => {
      if (cell.artifact.type === "design-frame-ref") {
        return [{
          id: `screen-${cell.id}`,
          title: `Frame ${cell.artifact.frameId}`,
          frameId: cell.artifact.frameId,
          summary: "Referenced on the current board.",
          notes: [],
        }];
      }

      if (cell.artifact.type === "uploaded-image") {
        return [{
          id: `screen-${cell.id}`,
          title: cell.artifact.label?.trim() || `Image ${cell.id}`,
          summary: "Uploaded image artifact on the current board.",
          notes: [],
        }];
      }

      return [];
    }),
    journey: doc.cells
      .flatMap((cell) =>
        cell.artifact.type === "journey-step"
          ? [{
              id: `journey-${cell.id}`,
              title: cell.artifact.text.trim() || `Step ${cell.column + 1}`,
              laneId: cell.laneId,
              kind: cell.artifact.shape === "diamond" ? "decision" : "step",
              notes: [],
            }]
          : [],
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
    technicalNotes: doc.cells.flatMap((cell) =>
      cell.artifact.type === "technical-brief"
        ? [{
            id: `note-${cell.id}`,
            title: cell.artifact.title.trim() || `Note ${cell.id}`,
            body: cell.artifact.body,
            language: cell.artifact.language,
            tags: [],
          }]
        : [],
    ),
    openQuestions: [],
    artifactMappings: doc.cells.flatMap((cell) => {
      if (cell.artifact.type === "design-frame-ref") {
        return [{ memoryId: `screen-${cell.id}`, cellId: cell.id, frameId: cell.artifact.frameId }];
      }
      if (cell.artifact.type === "uploaded-image") {
        return [{ memoryId: `screen-${cell.id}`, cellId: cell.id }];
      }
      if (cell.artifact.type === "journey-step") {
        return [{ memoryId: `journey-${cell.id}`, cellId: cell.id }];
      }
      if (cell.artifact.type === "technical-brief") {
        return [{ memoryId: `note-${cell.id}`, cellId: cell.id }];
      }
      return [];
    }),
  };

  const lines = [
    `version: ${snapshot.version}`,
    `goals: ${formatMemoryYamlValue(snapshot.goals)}`,
    `assumptions: ${formatMemoryYamlValue(snapshot.assumptions)}`,
    `entities: ${formatMemoryYamlValue(snapshot.entities)}`,
    "screens:",
    ...(snapshot.screens.length > 0 ? snapshot.screens.map((screen) => `  - ${formatMemoryYamlValue(screen)}`) : ["  []"]),
    "journey:",
    ...(snapshot.journey.length > 0 ? snapshot.journey.map((node) => `  - ${formatMemoryYamlValue(node)}`) : ["  []"]),
    "technicalNotes:",
    ...(snapshot.technicalNotes.length > 0
      ? snapshot.technicalNotes.map((note) => `  - ${formatMemoryYamlValue(note)}`)
      : ["  []"]),
    `openQuestions: ${formatMemoryYamlValue(snapshot.openQuestions)}`,
    "artifactMappings:",
    ...(snapshot.artifactMappings.length > 0
      ? snapshot.artifactMappings.map((mapping) => `  - ${formatMemoryYamlValue(mapping)}`)
      : ["  []"]),
  ];

  return { text: lines.join("\n"), persisted: Boolean(doc.boardMemory?.snapshot) };
}

// ---------------------------------------------------------------------------
// Module-level store — created once, survives hot-reload
// ---------------------------------------------------------------------------

const _initialPrefs = loadPreferences();

const appStore = createStore<AppState>({
  run: {
    chatEvents: [],
    promptHistory: [],
    copyStates: {},
    debugLogs: [],
    isCopyingLogs: false,
    captureFrameId: null,
  },
  project: {
    bundle: null,
    loading: true,
    error: "",
  },
  input: {
    composerPrompt: "",
    composerAttachments: [],
    runMode: "new-frame",
    selectedDevice: _initialPrefs.deviceDefault,
    selectedMode: _initialPrefs.modeDefault,
    selectedDesignSystemMode: "strict",
    selectedSurfaceTarget: "web",
    variation: 1,
    tailwindOverride: _initialPrefs.tailwindDefault,
  },
  ui: {
    preferences: _initialPrefs,
    interaction: null,
    isViewportPanning: false,
    viewport: VIEWPORT_DEFAULT,
    expandedHistoryFrameId: null,
    isWorkspaceSettingsOpen: false,
    isProjectDesignSystemOpen: false,
    isBrandPickerOpen: false,
    activeBrandName: null,
    designSystemWarnings: [],
    designSystemBusy: false,
    designSystemBusyLabel: null,
    designSystemRegeneratingReferenceId: null,
    pendingFigmaAttachUrl: null,
    isFrameInteractionUnlocked: false,
    pendingCanvasCards: [],
    canvasMode: "design",
    lastFlowFrameId: null,
  },
});

// ---------------------------------------------------------------------------
// Root component — provides the store context
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <AppStoreContext.Provider value={appStore}>
      <AppContent />
    </AppStoreContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// App content — all existing logic using store hooks
// ---------------------------------------------------------------------------

function AppContent() {
  // ---------------------------------------------------------------------------
  // Store state — only what AppContent itself renders or mutates directly
  // ---------------------------------------------------------------------------
  const {
    chatEvents, setChatEvents,
    promptHistory, setPromptHistory,
    copyStates, setCopyStates,
    debugLogs, setDebugLogs,
    isCopyingLogs, setIsCopyingLogs,
    captureFrameId, setCaptureFrameId,
  } = useRunState();

  const { bundle, setBundle, loading, setLoading, error, setError } = useProjectState();

  const {
    composerPrompt, setComposerPrompt,
    composerAttachments, setComposerAttachments,
    runMode, setRunMode,
    selectedDevice, setSelectedDevice,
    selectedMode, setSelectedMode,
    selectedDesignSystemMode, setSelectedDesignSystemMode,
    selectedSurfaceTarget, setSelectedSurfaceTarget,
    variation, setVariation,
    tailwindOverride, setTailwindOverride,
  } = useInputState();

  const {
    preferences, setPreferences,
    interaction, setInteraction,
    isViewportPanning, setViewportPanning,
    viewport, setViewport,
    expandedHistoryFrameId, setExpandedHistoryFrameId,
    isWorkspaceSettingsOpen, setWorkspaceSettingsOpen,
    isProjectDesignSystemOpen, setProjectDesignSystemOpen,
    isBrandPickerOpen, setBrandPickerOpen,
    activeBrandName, setActiveBrandName,
    designSystemWarnings, setDesignSystemWarnings,
    designSystemBusy, setDesignSystemBusy,
    designSystemBusyLabel, setDesignSystemBusyLabel,
    designSystemRegeneratingReferenceId, setDesignSystemRegeneratingReferenceId,
    pendingFigmaAttachUrl, setPendingFigmaAttachUrl,
    isFrameInteractionUnlocked, setFrameInteractionUnlocked,
    pendingCanvasCards, setPendingCanvasCards,
    canvasMode, setCanvasMode,
    lastFlowFrameId, setLastFlowFrameId,
  } = useUIState();

  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;
  const artboardViewportRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(VIEWPORT_DEFAULT);
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const zoomSelectionRef = useRef<Selection<HTMLDivElement, unknown, null, undefined> | null>(null);
  const focusAnimationRef = useRef<number | null>(null);
  const lastFocusedFrameIdRef = useRef<string | null>(null);
  const autoFitAppliedVersionsRef = useRef<Set<string>>(new Set());
  const autoFitSuppressedVersionsRef = useRef<Set<string>>(new Set());
  const autoFitPendingVersionsRef = useRef<Set<string>>(new Set());
  const contentHeightsRef = useRef<Map<string, number>>(new Map());
  const frameHeightModeRef = useRef<Map<string, "standard" | "content">>(new Map());
  const framePromptsRef = useRef<Map<string, string>>(new Map());
  const [framePromptsVersion, setFramePromptsVersion] = useState(0);
  const [focusedFlowAreaId, setFocusedFlowAreaId] = useState<string | null>(null);

  // Stable ref for openProjectDesignSystem — written after dsWorkspace is created
  const openProjectDesignSystemRef = useRef<() => Promise<void>>(async () => {});

  const projectId = bundle?.project.id ?? null;

  // ---------------------------------------------------------------------------
  // Feature hooks
  // ---------------------------------------------------------------------------
  const pipelineEvents = usePipelineEvents(openProjectDesignSystemRef);
  const {
    pushDebugLog,
    appendOrderedEvent,
    appendPromptTurn,
    appendChatEvent,
    appendSystemEvent,
    scheduleRefresh,
    openRunSocket,
    initializeProject,
    revealDesignSystemRunsRef,
    eventOrderRef
  } = pipelineEvents;

  const dsWorkspace = useDesignSystemWorkspace(pipelineEvents);
  const {
    openProjectDesignSystem,
    attachFigmaFromChat,
    bootstrapProjectDesignSystemFromModal,
    resetAndRegenerateDesignSystemFromModal,
    saveProjectDesignSystemMarkdown,
    regenerateDesignSystemFromReference,
    regenerateDesignSystemFromAllReferences,
    addFigmaReferenceFromDesignSystemModal,
    addImageReferencesFromDesignSystemModal
  } = dsWorkspace;

  // Keep the ref in sync so pipelineEvents can call openProjectDesignSystem without a circular dep
  openProjectDesignSystemRef.current = openProjectDesignSystem;

  const { removeComposerAttachment, addFigmaAttachment, addImageAttachment } = useComposerAttachments(appendSystemEvent);

  // Toast state for artboard import guidance
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flowBoardTask, setFlowBoardTask] = useState<FlowBoardTaskState | null>(null);
  const [flowStoryModal, setFlowStoryModal] = useState<FlowStoryModalState>({
    open: false,
    frameId: null,
    busy: false,
    error: null,
    story: null,
  });
  const [flowStoryCopied, setFlowStoryCopied] = useState(false);
  const [flowBoardMemoryModal, setFlowBoardMemoryModal] = useState<FlowBoardMemoryModalState>({
    open: false,
    frameId: null,
  });
  const [flowBoardMemoryCopied, setFlowBoardMemoryCopied] = useState(false);
  const showToast = useCallback((msg: string, durationMs = 5000) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), durationMs);
  }, []);

  // Artboard Figma import handler
  const handleImportFigmaScreen = useCallback(async (figmaUrl: string) => {
    const runId = createLocalRunId("import-figma");
    const success = await attachFigmaFromChat({ runId, figmaUrl });
    if (success) {
      showToast("Screen imported. Select it and describe changes to iterate.");
    }
  }, [attachFigmaFromChat, showToast]);

  // Brand picker: apply from references handler
  const handleBrandApplyFromReferences = useCallback(async (refs: {
    figmaUrls: string[];
    imageFiles: File[];
    imageUrls: string[];
    styleNotes: string;
  }) => {
    // Process Figma links
    for (const url of refs.figmaUrls) {
      await addFigmaReferenceFromDesignSystemModal(url);
    }
    // Process image files
    if (refs.imageFiles.length > 0) {
      await addImageReferencesFromDesignSystemModal(refs.imageFiles);
    }
    // After all references attached, regenerate DS from all
    await regenerateDesignSystemFromAllReferences();
    setActiveBrandName("Custom (Reference)");
    setBrandPickerOpen(false);
  }, [addFigmaReferenceFromDesignSystemModal, addImageReferencesFromDesignSystemModal, regenerateDesignSystemFromAllReferences, setActiveBrandName, setBrandPickerOpen]);

  useEffect(() => {
    void initializeProject();
  }, [initializeProject]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const selectedFrame = useMemo(() => {
    if (!bundle?.frames.length) return null;
    return bundle.frames.find((frame) => frame.selected) ?? null;
  }, [bundle]);

  const captureFrame = useMemo(() => {
    if (!bundle || !captureFrameId) return null;
    return bundle.frames.find((frame) => frame.id === captureFrameId) ?? null;
  }, [bundle, captureFrameId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        frameId?: string;
        versionId?: string;
        height?: number;
      } | null;

      if (!payload || payload.type !== "designer.frame-content-height") {
        return;
      }

      const frameId = typeof payload.frameId === "string" ? payload.frameId : null;
      const versionId = typeof payload.versionId === "string" ? payload.versionId : null;
      const contentHeight = typeof payload.height === "number" ? payload.height : null;
      if (!frameId || !versionId || contentHeight === null || !Number.isFinite(contentHeight)) {
        return;
      }

      const currentBundle = bundleRef.current;
      if (!currentBundle) {
        return;
      }

      const frame = currentBundle.frames.find((item) => item.id === frameId);
      if (!frame) {
        return;
      }

      const latestVersion = frame.versions[frame.versions.length - 1];
      if (!latestVersion || latestVersion.id !== versionId) {
        return;
      }

      const chromeOffset = 84;
      const computedContentHeight = Math.max(260, Math.ceil(contentHeight + chromeOffset));
      contentHeightsRef.current.set(frameId, computedContentHeight);

      const versionKey = `${frameId}:${versionId}`;
      if (
        autoFitSuppressedVersionsRef.current.has(versionKey) ||
        autoFitPendingVersionsRef.current.has(versionKey)
      ) {
        return;
      }

      const nextHeight = computedContentHeight;
      const currentHeight = frame.size.height;
      autoFitAppliedVersionsRef.current.add(versionKey);

      if (Math.abs(nextHeight - currentHeight) < 8) {
        return;
      }

      autoFitPendingVersionsRef.current.add(versionKey);
      setBundle((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          frames: current.frames.map((item) =>
            item.id === frameId
              ? {
                  ...item,
                  size: {
                    ...item.size,
                    height: nextHeight
                  }
                }
              : item
          )
        };
      });

      void updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), frameId, {
        size: {
          width: frame.size.width,
          height: nextHeight
        }
      })
        .catch((reason) => {
          autoFitAppliedVersionsRef.current.delete(versionKey);
          pushDebugLog("frame-autofit", reason, { frameId, versionId, nextHeight }, "warn");
        })
        .finally(() => {
          autoFitPendingVersionsRef.current.delete(versionKey);
        });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [preferences.apiBaseUrl, pushDebugLog]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setFrameInteractionUnlocked(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setFrameInteractionUnlocked(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Track which prompt was used for each frame (via pipeline events carrying frameId)
  useEffect(() => {
    const promptByRunId = new Map(promptHistory.map((entry) => [entry.runId, entry.prompt]));
    let changed = false;
    for (const event of chatEvents) {
      const frameId = typeof event.payload?.frameId === "string" ? event.payload.frameId : null;
      if (frameId && promptByRunId.has(event.runId) && !framePromptsRef.current.has(frameId)) {
        framePromptsRef.current.set(frameId, promptByRunId.get(event.runId)!);
        changed = true;
      }
    }
    if (changed) {
      setFramePromptsVersion((v) => v + 1);
    }
  }, [chatEvents, promptHistory]);

  // Delete/Backspace to remove selected frame (except design-system and flow frames)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // Don't intercept when user is typing in an input/textarea
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const currentBundle = bundleRef.current;
      if (!currentBundle) return;
      const selected = currentBundle.frames.find((f) => f.selected);
      if (!selected) return;

      // Protect design-system frames from deletion
      const meta = extractFrameSourceMeta(selected);
      if (meta?.sourceRole === "design-system" || selected.frameKind === "flow") return;

      event.preventDefault();
      // Optimistically remove from local state
      setBundle((current) => {
        if (!current) return current;
        return { ...current, frames: current.frames.filter((f) => f.id !== selected.id) };
      });
      setRunMode("new-frame");
      showToast("Frame deleted", 2500);

      void deleteFrame(getApiBaseUrl(preferences.apiBaseUrl), selected.id).catch((reason) => {
        pushDebugLog("delete-frame", reason, { frameId: selected.id }, "warn");
        // Re-fetch bundle to restore if the delete failed
        const pid = bundleRef.current?.project.id;
        if (pid) void getProjectBundle(getApiBaseUrl(preferences.apiBaseUrl), pid).then(setBundle);
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preferences.apiBaseUrl, pushDebugLog, showToast]);

  useEffect(() => {
    return () => {
      if (focusAnimationRef.current) {
        window.cancelAnimationFrame(focusAnimationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isWorkspaceSettingsOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkspaceSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isWorkspaceSettingsOpen]);

  useEffect(() => {
    if (!interaction) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const scale = Math.max(0.001, viewportRef.current.scale);
      setBundle((current) => {
        if (!current) {
          return current;
        }

        const scaledDeltaX = (event.clientX - interaction.startX) / scale;
        const scaledDeltaY = (event.clientY - interaction.startY) / scale;

        return {
          ...current,
          frames: current.frames.map((frame) => {
            if (frame.id !== interaction.frameId) {
              return frame;
            }

            if (interaction.type === "drag") {
              return {
                ...frame,
                position: {
                  x: interaction.originX + scaledDeltaX,
                  y: interaction.originY + scaledDeltaY
                }
              };
            }

            return {
              ...frame,
              size: {
                width: isMobilePreset(frame.devicePreset)
                  ? frame.size.width
                  : Math.max(220, interaction.originWidth + scaledDeltaX),
                height:
                  frame.frameKind === "flow"
                    ? frame.size.height
                    : Math.max(260, interaction.originHeight + scaledDeltaY)
              }
            };
          })
        };
      });
    };

    const onPointerUp = () => {
      setInteraction((currentInteraction) => {
        if (!currentInteraction) {
          return null;
        }

        const currentBundle = bundleRef.current;
        if (!currentBundle) {
          return null;
        }

        const frame = currentBundle.frames.find((item) => item.id === currentInteraction.frameId);
        if (frame && projectId) {
          const currentVersionId = frame.currentVersionId || frame.versions[frame.versions.length - 1]?.id;
          if (currentInteraction.type === "resize" && currentVersionId) {
            autoFitSuppressedVersionsRef.current.add(`${frame.id}:${currentVersionId}`);
          }
          void updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), frame.id, {
            position: frame.position,
            size: frame.size
          }).catch(() => {
            // Ignore transient layout save failures and keep optimistic UI.
          });
        }

        return null;
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [interaction, preferences.apiBaseUrl, projectId]);

  async function persistProjectSettings(patch: Partial<ProjectSettings>) {
    if (!projectId) {
      return;
    }

    try {
      const updatedProject = await updateProjectSettings(getApiBaseUrl(preferences.apiBaseUrl), projectId, patch);
      setBundle((current) => (current ? { ...current, project: updatedProject } : current));
      pushDebugLog("update-settings", "Project settings updated", { projectId, patch }, "info");
    } catch (reason) {
      pushDebugLog("update-settings", reason, { patch }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const handleTailwindPreferenceChange = useCallback(
    (next: boolean) => {
      setTailwindOverride(next);
      setPreferences((current) => ({ ...current, tailwindDefault: next }));
      void persistProjectSettings({ tailwindDefault: next });
      pushDebugLog("update-settings", "Tailwind default toggled", { value: next }, "info");
    },
    [persistProjectSettings, pushDebugLog]
  );

  const handleDesignSystemModeChange = useCallback(
    (next: DesignSystemMode) => {
      setSelectedDesignSystemMode(next);
      void persistProjectSettings({ designSystemModeDefault: next });
      pushDebugLog("update-settings", "Design system mode default changed", { value: next }, "info");
    },
    [persistProjectSettings, pushDebugLog]
  );

  const handleSurfaceTargetChange = useCallback(
    (next: SurfaceTarget) => {
      setSelectedSurfaceTarget(next);
      void persistProjectSettings({ surfaceDefault: next });
      pushDebugLog("update-settings", "Surface target default changed", { value: next }, "info");
    },
    [persistProjectSettings, pushDebugLog]
  );

  async function handleResyncReference(reference: ReferenceSource) {
    const runId = createLocalRunId("resync");
    appendChatEvent({
      runId,
      stage: "system",
      status: "info",
      kind: "summary",
      message: `Re-syncing Figma reference ${reference.fileKey}${reference.nodeId ? ` (${reference.nodeId})` : ""}...`
    });

    try {
      const result = await resyncReference(getApiBaseUrl(preferences.apiBaseUrl), reference.id);
      const payload =
        typeof result === "object" && result !== null
          ? (result as {
              error?: string;
              warning?: string;
              fallback?: {
                mode?: string;
                requiredClientCredentials?: boolean;
                retryPrompt?: string;
              };
            })
          : null;

      if (payload?.error) {
        appendChatEvent({
          runId,
          stage: "system",
          status: "error",
          kind: "summary",
          message: payload.error
        });
      } else {
        appendChatEvent({
          runId,
          stage: "system",
          status: "success",
          kind: "summary",
          message: "Reference re-sync completed."
        });
      }

      if (payload?.warning) {
        appendChatEvent({
          runId,
          stage: "system",
          status: "info",
          kind: "action",
          message: payload.warning
        });
      }

      if (payload?.fallback?.requiredClientCredentials) {
        appendChatEvent({
          runId,
          stage: "system",
          status: "info",
          kind: "action",
          message:
            payload.fallback.retryPrompt ??
            "MCP failed. Send `/figma-credentials <clientId> <clientSecret>` in chat, then retry."
        });
      }

      if (!projectId) {
        return;
      }
      const refreshed = await getProjectBundle(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle(refreshed);
      pushDebugLog("resync-reference", "Reference re-sync completed", { referenceId: reference.id }, "info");
    } catch (reason) {
      pushDebugLog("resync-reference", reason, { referenceId: reference.id }, "error");
      appendChatEvent({
        runId,
        stage: "system",
        status: "error",
        kind: "summary",
        message: reason instanceof Error ? reason.message : String(reason)
      });
    }
  }

  async function handleCreateManualFrame(devicePreset: DevicePreset) {
    if (!projectId) {
      return;
    }

    try {
      await createManualFrame(getApiBaseUrl(preferences.apiBaseUrl), projectId, {
        devicePreset,
        mode: selectedMode,
        tailwindEnabled: tailwindOverride
      });
      const refreshed = await getProjectBundle(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle(refreshed);
      const newlySelected = refreshed.frames.find((frame) => frame.selected) ?? refreshed.frames[refreshed.frames.length - 1];
      if (newlySelected) {
        lastFocusedFrameIdRef.current = null;
        focusViewportOnFrame(newlySelected.id);
      }
      pushDebugLog("create-frame", "Manual frame created", { devicePreset, frameCount: refreshed.frames.length }, "info");
    } catch (reason) {
      pushDebugLog("create-frame", reason, { devicePreset }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleClearBoard() {
    if (!projectId) {
      return;
    }

    setError("");
    try {
      const refreshed = await clearBoard(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle(refreshed);
      setPromptHistory([]);
      setChatEvents([]);
      eventOrderRef.current = 0;
      setCopyStates({});
      setCaptureFrameId(null);
      setExpandedHistoryFrameId(null);
      setPendingCanvasCards([]);
      revealDesignSystemRunsRef.current.clear();
      setComposerAttachments([]);
      setDesignSystemWarnings([]);
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
      setRunMode("new-frame");
      lastFocusedFrameIdRef.current = null;
      autoFitAppliedVersionsRef.current.clear();
      autoFitSuppressedVersionsRef.current.clear();
      autoFitPendingVersionsRef.current.clear();
      pushDebugLog("clear-board", "Board cleared", { projectId }, "info");
    } catch (reason) {
      pushDebugLog("clear-board", reason, { projectId }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleRun(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) {
      return;
    }

    const promptValue = composerPrompt.trim();
    const credentialCommand = parseFigmaCredentialsCommand(promptValue);
    const designSystemCalibrationCommand = parseDesignSystemCalibrationCommand(promptValue);

    if (credentialCommand) {
      const localRunId = createLocalRunId("chat");
      appendPromptTurn({
        runId: localRunId,
        prompt: promptValue
      });
      setComposerPrompt("");
      setError("");

      if (!credentialCommand.clientId || !credentialCommand.clientSecret) {
        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "info",
          kind: "summary",
          message: "Credential format: `/figma-credentials <clientId> <clientSecret>`."
        });
        return;
      }

      setPreferences((current) => ({
        ...current,
        figmaClientId: credentialCommand.clientId,
        figmaClientSecret: credentialCommand.clientSecret
      }));

      appendChatEvent({
        runId: localRunId,
        stage: "system",
        status: "success",
        kind: "summary",
        message: "Saved Figma client credentials locally for fallback attach retries."
      });

      if (pendingFigmaAttachUrl) {
        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "info",
          kind: "action",
          message: `Retrying pending attach for ${pendingFigmaAttachUrl}`
        });
        await attachFigmaFromChat({
          runId: localRunId,
          figmaUrl: pendingFigmaAttachUrl
        });
      } else {
        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "info",
          kind: "action",
          message: "Now resend the Figma link in chat to attach it."
        });
      }
      return;
    }

    if (designSystemCalibrationCommand) {
      const localRunId = createLocalRunId("ds-calibration");
      appendPromptTurn({
        runId: localRunId,
        prompt: promptValue
      });
      setComposerPrompt("");
      setError("");

      if (!designSystemCalibrationCommand.updates) {
        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "info",
          kind: "summary",
          message:
            "Calibration command format: `/ds-calibrate buttons.shape=pill inputs.borderWidth=2 navigation.density=compact`."
        });
        return;
      }

      if (!bundle?.designSystem) {
        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "error",
          kind: "summary",
          message: "No design system found yet. Add a reference and generate the design system first."
        });
        return;
      }

      setDesignSystemBusy(true);
      setDesignSystemBusyLabel("Applying design-system calibration and refreshing visual recipes...");
      setDesignSystemRegeneratingReferenceId(null);
      appendChatEvent({
        runId: localRunId,
        stage: "system",
        status: "info",
        kind: "action",
        message: "Applying calibration constraints to component recipes."
      });

      try {
        const result = await calibrateProjectDesignSystem(getApiBaseUrl(preferences.apiBaseUrl), projectId, {
          updates: designSystemCalibrationCommand.updates
        });

        setBundle((current) =>
          current
            ? {
                ...current,
                designSystem: result.designSystem
              }
            : current
        );
        setDesignSystemWarnings(result.warnings ?? []);

        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "success",
          kind: "summary",
          message: "Calibration applied and design system visuals refreshed.",
          payload: {
            step: "design-system-calibration",
            artifact: "project-design-system",
            statusDetail:
              Array.isArray(result.applied) && result.applied.length > 0
                ? `Applied ${result.applied.join(", ")}`
                : "Applied requested recipe updates."
          }
        });

        if ((result.warnings ?? []).length > 0) {
          appendChatEvent({
            runId: localRunId,
            stage: "system",
            status: "info",
            kind: "action",
            message: result.warnings[0] ?? "Calibration saved as draft due low confidence."
          });
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        appendChatEvent({
          runId: localRunId,
          stage: "system",
          status: "error",
          kind: "summary",
          message
        });
        pushDebugLog(
          "design-system-calibrate",
          reason,
          {
            projectId,
            updates: designSystemCalibrationCommand.updates
          },
          "error"
        );
      } finally {
        setDesignSystemBusy(false);
        setDesignSystemBusyLabel(null);
      }
      return;
    }

    const explicitFigmaAttachment =
      composerAttachments.find((attachment) => attachment.type === "figma-link" && attachment.url) ?? null;
    const inlineFigmaUrl = extractFigmaUrl(promptValue);
    const figmaUrl = explicitFigmaAttachment?.url ?? inlineFigmaUrl;
    const imageAttachment =
      composerAttachments.find(
        (attachment) => attachment.type === "image" && attachment.dataUrl && attachment.status !== "failed"
      ) ?? null;

    if (!promptValue && !figmaUrl && !imageAttachment) {
      return;
    }

    if (figmaUrl && imageAttachment) {
      appendSystemEvent({
        status: "error",
        kind: "action",
        message: "Use either one image or one Figma link per send so the reference route stays deterministic."
      });
      return;
    }

    let cleanedPrompt = inlineFigmaUrl ? promptValue.replace(inlineFigmaUrl, "").trim() : promptValue;
    const hasPromptForGeneration = cleanedPrompt.length > 0;
    setError("");

    if (figmaUrl) {
      const attachRunId = createLocalRunId("attach");
      if (!hasPromptForGeneration && !imageAttachment) {
        appendPromptTurn({
          runId: attachRunId,
          prompt: `Attach Figma link: ${figmaUrl}`
        });
      } else {
        appendChatEvent({
          runId: attachRunId,
          stage: "system",
          status: "info",
          kind: "summary",
          message: "Attaching Figma reference before generation so the next frame aligns with this source."
        });
      }

      const attached = await attachFigmaFromChat({
        runId: attachRunId,
        figmaUrl
      });
      if (!attached) {
        return;
      }

      if (!hasPromptForGeneration) {
        setComposerPrompt("");
        setComposerAttachments((current) => current.filter((attachment) => attachment.type !== "figma-link"));
        appendChatEvent({
          runId: attachRunId,
          stage: "system",
          status: "success",
          kind: "summary",
          message: "Reference attached. Ask me to generate or edit a screen when you're ready."
        });
        return;
      }
    }

    if (canvasMode === "flow" && activeFlowFrame && !cleanedPrompt && imageAttachment) {
      cleanedPrompt = "Add the attached image to the flow board in the user-journey lane.";
    } else if (!cleanedPrompt && imageAttachment) {
      cleanedPrompt = "Rebuild the attached image into an editable screen and refresh the canonical design-system board.";
    }

    if (canvasMode === "flow" && !activeFlowFrame && (cleanedPrompt || imageAttachment) && !figmaUrl) {
      appendSystemEvent({
        status: "error",
        kind: "action",
        message: "Open flow mode first so the prompt has an active flow board to update."
      });
      return;
    }

    if (
      activeFlowFrame &&
      selectedFrame?.id !== activeFlowFrame.id &&
      canvasMode === "flow"
    ) {
      await selectFrame(activeFlowFrame.id);
    }

    // ---- Flow-action dispatch: route to LLM mutation handler when in flow mode ----
    if (
      shouldUseFlowActionRoute({
        canvasMode,
        flowFrameId: activeFlowFrame?.id ?? null,
        prompt: cleanedPrompt,
        figmaUrl
      }) &&
      activeFlowFrame
    ) {
      await runFlowBoardAction({
        frameId: activeFlowFrame.id,
        prompt: cleanedPrompt,
        rawPrompt: promptValue,
        attachments: imageAttachment ? [imageAttachment] : undefined,
        taskKind: "agent",
      });
      return;
    }

    const selectedSourceMeta = selectedDesignFrame ? extractFrameSourceMeta(selectedDesignFrame) : null;
    const selectedFrameContext = selectedDesignFrame
      ? {
          frameId: selectedDesignFrame.id,
          name: selectedDesignFrame.name,
          devicePreset: selectedDesignFrame.devicePreset,
          mode: selectedDesignFrame.mode,
          size: {
            width: selectedDesignFrame.size.width,
            height: selectedDesignFrame.size.height
          },
          latestVersionId: selectedDesignFrame.currentVersionId,
          sourceType: selectedSourceMeta?.sourceType ?? null,
          sourceRole: selectedSourceMeta?.sourceRole ?? null,
          sourceGroupId: selectedSourceMeta?.sourceGroupId ?? null
        }
      : undefined;

    const payload = {
      prompt: cleanedPrompt,
      provider: preferences.provider,
      model: preferences.model,
      apiKey: preferences.apiKey.trim() || undefined,
      devicePreset: selectedDevice,
      mode: selectedMode,
      surfaceTarget: selectedSurfaceTarget,
      designSystemMode: selectedDesignSystemMode,
      variation,
      tailwindEnabled: tailwindOverride,
      attachments: imageAttachment ? [imageAttachment] : undefined,
      selectedFrameContext,
      intentHint: runMode === "edit-selected" && selectedDesignFrame && !imageAttachment ? "screen-action" as const : undefined
    } as const;

    try {
      let runId: string;
      if (runMode === "edit-selected" && selectedDesignFrame && !imageAttachment) {
        // Phase 2.3: Optimistic "building" state for immediate visual feedback
        setBundle((current) => {
          if (!current) return current;
          return {
            ...current,
            frames: current.frames.map((f) =>
              f.id === selectedDesignFrame.id ? { ...f, status: "building" as const } : f
            )
          };
        });
        const { variation: _ignoredVariation, ...editPayload } = payload;
        const run = await startEditRun(getApiBaseUrl(preferences.apiBaseUrl), selectedDesignFrame.id, {
          ...editPayload
        });
        runId = run.runId;
      } else {
        const run = await startGenerateRun(getApiBaseUrl(preferences.apiBaseUrl), projectId, payload);
        runId = run.runId;
      }

      appendOrderedEvent({
        runId,
        timestamp: new Date().toISOString(),
        stage: "system",
        status: "info",
        kind: "summary",
        message:
          imageAttachment
            ? "Starting image-aware pipeline (analyze -> rebuild screen -> canonical design-system refresh)."
            : runMode === "edit-selected"
            ? "Starting edit pipeline for selected frame."
            : "Starting generation pipeline for a new frame."
      });
      setPromptHistory((current) => [
        ...current,
        {
          runId,
          prompt: promptValue || cleanedPrompt,
          submittedAt: new Date().toISOString(),
          mode: runMode,
          devicePreset: selectedDevice,
          designMode: selectedMode
        }
      ]);
      openRunSocket(runId);
      setComposerPrompt("");
      setComposerAttachments([]);
      pushDebugLog("start-run", "Pipeline run started", {
        runId,
        mode: runMode,
        selectedFrameId: selectedDesignFrame?.id ?? activeFlowFrame?.id ?? null,
        provider: preferences.provider,
        model: preferences.model,
        devicePreset: selectedDevice,
        designMode: selectedMode,
        surfaceTarget: selectedSurfaceTarget,
        designSystemMode: selectedDesignSystemMode,
        variation,
        attachmentCount: payload.attachments?.length ?? 0,
        selectedFrameContext: payload.selectedFrameContext ?? null
      }, "info");
    } catch (reason) {
      pushDebugLog("start-run", reason, {
        provider: preferences.provider,
        model: preferences.model,
        apiBaseUrl: getApiBaseUrl(preferences.apiBaseUrl)
      }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  // -------------------------------------------------------------------------
  // Regenerate a frame using its original prompt
  // -------------------------------------------------------------------------
  async function handleRegenerate(frameId: string) {
    const prompt = framePromptsRef.current.get(frameId);
    if (!prompt || !projectId) return;

    const frame = bundle?.frames.find((f) => f.id === frameId);
    if (!frame) return;

    const payload = {
      prompt,
      provider: preferences.provider,
      model: preferences.model,
      apiKey: preferences.apiKey.trim() || undefined,
      devicePreset: frame.devicePreset,
      mode: frame.mode,
      surfaceTarget: selectedSurfaceTarget,
      designSystemMode: selectedDesignSystemMode,
      variation: 1,
      tailwindEnabled: tailwindOverride,
    } as const;

    try {
      const { variation: _ignoredVariation, ...editPayload } = payload;
      const run = await startEditRun(getApiBaseUrl(preferences.apiBaseUrl), frameId, {
        ...editPayload
      });
      const runId = run.runId;

      appendOrderedEvent({
        runId,
        timestamp: new Date().toISOString(),
        stage: "system",
        status: "info",
        kind: "summary",
        message: "Regenerating frame with original prompt."
      });
      setPromptHistory((current) => [
        ...current,
        {
          runId,
          prompt,
          submittedAt: new Date().toISOString(),
          mode: "edit-selected",
          devicePreset: frame.devicePreset,
          designMode: frame.mode
        }
      ]);
      openRunSocket(runId);
      pushDebugLog("regenerate-frame", "Regenerate started", { runId, frameId }, "info");
    } catch (reason) {
      pushDebugLog("regenerate-frame", reason, { frameId }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const applyViewportTransform = useCallback((next: { x: number; y: number; scale: number }) => {
    viewportRef.current = next;
    const selection = zoomSelectionRef.current;
    const behavior = zoomBehaviorRef.current;
    if (selection && behavior) {
      selection.call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.scale));
      return;
    }
    setViewport(next);
  }, []);

  useEffect(() => {
    const viewportElement = artboardViewportRef.current;
    if (!viewportElement) {
      return;
    }

    if (canvasMode === "flow") {
      setViewportPanning(false);
      zoomBehaviorRef.current = null;
      zoomSelectionRef.current = null;
      return;
    }

    const selection = select(viewportElement);
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([VIEWPORT_MIN_SCALE, VIEWPORT_MAX_SCALE])
      .wheelDelta((event: WheelEvent) => {
        const modeFactor = event.deltaMode === 1 ? 0.06 : event.deltaMode ? 1 : 0.0022;
        const pinchFactor = event.ctrlKey || event.metaKey ? 4.8 : 1;
        return -event.deltaY * modeFactor * pinchFactor;
      })
      .filter((event) => {
        const sourceEvent = event as Event;
        const eventType = sourceEvent.type;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".canvas-floating-controls, .artboard-empty-state")) {
          return false;
        }
        if (eventType === "wheel") {
          const wheelEvent = event as WheelEvent;
          return wheelEvent.ctrlKey || wheelEvent.metaKey;
        }
        if (target?.closest(".frame-card, .flow-frame-card")) {
          return false;
        }
        if (eventType === "mousedown") {
          return event.button === 0;
        }
        return true;
      })
      .on("start", (_event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        // Don't set panning=true here; wait for actual movement in the zoom handler
        // to avoid blocking background-click deselection on simple clicks.
      })
      .on("zoom", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        setViewportPanning(true);
        const next = {
          x: event.transform.x,
          y: event.transform.y,
          scale: event.transform.k
        };
        viewportRef.current = next;
        setViewport(next);
      })
      .on("end", () => {
        setViewportPanning(false);
      });

    const panController = createSmoothPanController({
      readViewport: () => viewportRef.current,
      applyViewport: applyViewportTransform,
      damping: 0.45,
      isPanAllowed: (event) => {
        if (event.ctrlKey || event.metaKey) {
          return false;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(".canvas-floating-controls")) {
          return false;
        }
        return true;
      }
    });

    const onWheelPan = (event: WheelEvent) => panController.onWheel(event);

    viewportElement.addEventListener("wheel", onWheelPan, { passive: false });
    selection.call(behavior);
    selection.on("dblclick.zoom", null);
    selection.call(
      behavior.transform,
      zoomIdentity.translate(viewportRef.current.x, viewportRef.current.y).scale(viewportRef.current.scale)
    );

    zoomBehaviorRef.current = behavior;
    zoomSelectionRef.current = selection;

    return () => {
      setViewportPanning(false);
      viewportElement.removeEventListener("wheel", onWheelPan);
      panController.dispose();
      selection.on(".zoom", null);
      zoomBehaviorRef.current = null;
      zoomSelectionRef.current = null;
    };
  }, [applyViewportTransform, canvasMode, loading]);

  const focusViewportOnFrame = useCallback((frameId: string) => {
    if (!bundle) {
      return;
    }
    const frame = bundle.frames.find((item) => item.id === frameId);
    const viewportElement = artboardViewportRef.current;
    if (!frame || !viewportElement) {
      return;
    }

    const bounds = viewportElement.getBoundingClientRect();
    const width = Math.max(640, bounds.width);
    const height = Math.max(400, bounds.height);
    const targetScale = clampScale(
      Math.min((width * 0.58) / frame.size.width, (height * 0.78) / frame.size.height, VIEWPORT_MAX_SCALE)
    );
    const anchorX = width * 0.62;
    const anchorY = height * 0.5;
    const targetViewport = {
      x: anchorX - (frame.position.x + frame.size.width / 2) * targetScale,
      y: anchorY - (frame.position.y + frame.size.height / 2) * targetScale,
      scale: targetScale
    };

    if (focusAnimationRef.current) {
      window.cancelAnimationFrame(focusAnimationRef.current);
      focusAnimationRef.current = null;
    }

    const start = viewportRef.current;
    const startedAt = performance.now();
    const duration = 280;
    const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);

    const tick = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = easeOut(progress);
      const next = {
        x: start.x + (targetViewport.x - start.x) * eased,
        y: start.y + (targetViewport.y - start.y) * eased,
        scale: start.scale + (targetViewport.scale - start.scale) * eased
      };
      applyViewportTransform(next);

      if (progress < 1) {
        focusAnimationRef.current = window.requestAnimationFrame(tick);
      } else {
        focusAnimationRef.current = null;
      }
    };

    focusAnimationRef.current = window.requestAnimationFrame(tick);
  }, [bundle]);

  useEffect(() => {
    if (!selectedFrame) {
      lastFocusedFrameIdRef.current = null;
      setRunMode((current) => (current === "edit-selected" ? "new-frame" : current));
      return;
    }
    if (lastFocusedFrameIdRef.current === selectedFrame.id) {
      return;
    }
    lastFocusedFrameIdRef.current = selectedFrame.id;
    setRunMode("edit-selected");

    const sourceMeta = extractFrameSourceMeta(selectedFrame);
    appendSystemEvent({
      status: "info",
      kind: "action",
      stage: "system",
      message: `Selected frame: ${selectedFrame.name} (${selectedFrame.devicePreset}, ${selectedFrame.mode}, ${selectedFrame.size.width}x${selectedFrame.size.height}).`,
      payload: {
        frameId: selectedFrame.id,
        sourceType: sourceMeta?.sourceType ?? "generated",
        sourceRole: sourceMeta?.sourceRole ?? null
      }
    });
    if (selectedFrame.frameKind !== "flow") {
      focusViewportOnFrame(selectedFrame.id);
    }
  }, [appendSystemEvent, focusViewportOnFrame, selectedFrame]);

  function zoomBy(factor: number) {
    if (canvasMode === "flow") {
      return;
    }

    const behavior = zoomBehaviorRef.current;
    const selection = zoomSelectionRef.current;
    const viewportElement = artboardViewportRef.current;
    if (behavior && selection && viewportElement) {
      const bounds = viewportElement.getBoundingClientRect();
      selection.call(behavior.scaleBy, factor, [bounds.width / 2, bounds.height / 2]);
      pushDebugLog(
        "viewport",
        `Zoom changed (${factor < 1 ? "out" : "in"})`,
        { factor, nextScale: clampScale(viewportRef.current.scale * factor) },
        "debug"
      );
      return;
    }

    setViewport((current) => {
      const bounds = viewportElement?.getBoundingClientRect();
      const focusX = bounds ? bounds.width / 2 : 640;
      const focusY = bounds ? bounds.height / 2 : 360;
      const scale = clampScale(current.scale * factor);
      const worldX = (focusX - current.x) / current.scale;
      const worldY = (focusY - current.y) / current.scale;
      return {
        x: focusX - worldX * scale,
        y: focusY - worldY * scale,
        scale
      };
    });
    pushDebugLog(
      "viewport",
      `Zoom changed (${factor < 1 ? "out" : "in"})`,
      { factor, nextScale: clampScale(viewportRef.current.scale * factor) },
      "debug"
    );
  }

  function beginDrag(event: React.PointerEvent, frameId: string) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, summary, details")) {
      return;
    }
    const frame = bundle?.frames.find((item) => item.id === frameId);
    if (!frame) {
      return;
    }
    setInteraction({
      type: "drag",
      frameId,
      originX: frame.position.x,
      originY: frame.position.y,
      startX: event.clientX,
      startY: event.clientY
    });
  }

  function beginResize(event: React.PointerEvent, frameId: string) {
    event.preventDefault();
    event.stopPropagation();
    const frame = bundle?.frames.find((item) => item.id === frameId);
    if (!frame) {
      return;
    }
    setInteraction({
      type: "resize",
      frameId,
      originWidth: frame.size.width,
      originHeight: frame.size.height,
      startX: event.clientX,
      startY: event.clientY
    });
  }

  function toggleFrameHeight(frameId: string) {
    const currentBundle = bundleRef.current;
    if (!currentBundle) return;
    const frame = currentBundle.frames.find((item) => item.id === frameId);
    if (!frame) return;

    const standardHeight = isMobilePreset(frame.devicePreset) ? 852 : 880;
    const currentMode = frameHeightModeRef.current.get(frameId) ?? "content";
    const contentHeight = contentHeightsRef.current.get(frameId);

    let nextHeight: number;
    let nextMode: "standard" | "content";

    if (currentMode === "content") {
      nextHeight = standardHeight;
      nextMode = "standard";
    } else {
      nextHeight = contentHeight ?? frame.size.height;
      nextMode = "content";
    }

    frameHeightModeRef.current.set(frameId, nextMode);

    // Suppress auto-fit in standard mode so it sticks
    const latestVersion = frame.versions[frame.versions.length - 1];
    if (latestVersion) {
      const versionKey = `${frameId}:${latestVersion.id}`;
      if (nextMode === "standard") {
        autoFitSuppressedVersionsRef.current.add(versionKey);
      } else {
        autoFitSuppressedVersionsRef.current.delete(versionKey);
        autoFitAppliedVersionsRef.current.delete(versionKey);
      }
    }

    setBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        frames: current.frames.map((item) =>
          item.id === frameId
            ? { ...item, size: { ...item.size, height: nextHeight } }
            : item
        )
      };
    });

    void updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), frameId, {
      size: { width: frame.size.width, height: nextHeight }
    }).catch(() => {});
  }

  async function selectFrame(frameId: string) {
    const currentBundle = bundleRef.current;
    if (!currentBundle) {
      return;
    }
    const frame = currentBundle.frames.find((item) => item.id === frameId);
    if (frame?.frameKind === "flow") {
      setLastFlowFrameId(frameId);
    }
    setRunMode("edit-selected");
    setBundle((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        frames: current.frames.map((frame) => ({
          ...frame,
          selected: frame.id === frameId
        }))
      };
    });

    await updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), frameId, {
      selected: true
    }).catch(() => {
      pushDebugLog("select-frame", "Failed to persist selected frame.", { frameId }, "warn");
    });
  }

  async function copyFrameToFigma(frameId: string) {
    setCopyStates((current) => ({
      ...current,
      [frameId]: {
        state: "capturing",
        logs: []
      }
    }));

    setCaptureFrameId(frameId);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    const appendLog = (entry: CaptureLogEntry) => {
      setCopyStates((current) => {
        const existing = current[frameId] ?? { state: "idle" as CopyState, logs: [] as CaptureLogEntry[] };
        return {
          ...current,
          [frameId]: {
            ...existing,
            logs: [...existing.logs, entry].slice(-80)
          }
        };
      });
    };

    try {
      await captureSelectorToFigmaClipboard({
        selector: `#capture-surface-${frameId}`,
        delayMs: 900,
        logger: appendLog
      });

      setCopyStates((current) => ({
        ...current,
        [frameId]: {
          ...(current[frameId] ?? { logs: [] }),
          state: "copied",
          logs: current[frameId]?.logs ?? []
        }
      }));
      pushDebugLog("copy-to-figma", "Frame copied to Figma clipboard", { frameId }, "info");
    } catch {
      pushDebugLog("copy-to-figma", "Capture failed.", { frameId }, "error");
      setCopyStates((current) => ({
        ...current,
        [frameId]: {
          ...(current[frameId] ?? { logs: [] }),
          state: "failed",
          logs: current[frameId]?.logs ?? []
        }
      }));
    } finally {
      window.setTimeout(() => setCaptureFrameId(null), 300);
    }
  }

  async function resyncFrameReference(frameId: string) {
    const frame = bundle?.frames.find((item) => item.id === frameId);
    if (!frame) {
      return;
    }

    const frameMeta = extractFrameSourceMeta(frame);
    const reference = resolveReferenceForFrame(frameMeta, bundle?.references ?? []);

    if (!reference) {
      appendSystemEvent({
        status: "error",
        kind: "action",
        message: "Cannot resync this frame. Missing reference mapping metadata."
      });
      pushDebugLog("resync-frame", "Reference lookup failed", { frameId, frameMeta }, "warn");
      return;
    }

    await handleResyncReference(reference);
  }

  const clearCanvasSelection = useCallback(async () => {
    const currentBundle = bundleRef.current;
    if (!currentBundle) {
      return;
    }

    if (canvasMode === "flow") {
      const flowTarget = resolveActiveFlowFrame(
        currentBundle.frames.filter((frame) => frame.frameKind === "flow"),
        currentBundle.frames.find((frame) => frame.selected && frame.frameKind === "flow")?.id ?? null,
        lastFlowFrameId
      );
      if (flowTarget && !flowTarget.selected) {
        await selectFrame(flowTarget.id);
      }
      return;
    }

    const selected = currentBundle.frames.find((frame) => frame.selected);
    if (!selected) {
      setRunMode("new-frame");
      return;
    }

    lastFocusedFrameIdRef.current = null;
    setRunMode("new-frame");
    showToast("Deselected — next prompt creates a new screen", 3000);
    setBundle((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        frames: current.frames.map((frame) =>
          frame.id === selected.id
            ? {
                ...frame,
                selected: false
              }
            : frame
        )
      };
    });

    await updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), selected.id, { selected: false }).catch((reason) => {
      pushDebugLog("select-frame", reason, { frameId: selected.id, mode: "deselect" }, "warn");
    });
  }, [canvasMode, lastFlowFrameId, preferences.apiBaseUrl, pushDebugLog, selectFrame, showToast]);

  const frameLookup = useMemo(() => {
    if (!bundle) {
      return new Map<string, FrameVersion | undefined>();
    }
    return new Map(bundle.frames.map((frame) => [frame.id, frame.versions[frame.versions.length - 1]]));
  }, [bundle]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- framePromptsVersion triggers re-snapshot
  const framePromptsSnapshot = useMemo(() => new Map(framePromptsRef.current), [framePromptsVersion]);

  const frameMetaById = useMemo(() => buildFrameMetaMap(bundle?.frames ?? []), [bundle?.frames]);
  const designSystemReferenceItems = useMemo<DesignSystemReferenceItem[]>(() => {
    if (!bundle) {
      return [];
    }

    const figmaItemsByReferenceId = new Map<string, DesignSystemReferenceItem>();
    const fallbackFigmaFrameItems: DesignSystemReferenceItem[] = [];
    const imageItems: DesignSystemReferenceItem[] = [];

    for (const frame of bundle.frames) {
      const meta = frameMetaById.get(frame.id);
      if (!meta || meta.sourceRole !== "reference-screen") {
        continue;
      }

      if (meta.sourceType === "image-reference") {
        const latestVersion = frame.versions[frame.versions.length - 1];
        const attachmentName =
          latestVersion &&
          latestVersion.passOutputs &&
          typeof latestVersion.passOutputs === "object" &&
          typeof latestVersion.passOutputs.attachmentName === "string"
            ? latestVersion.passOutputs.attachmentName
            : null;

        imageItems.push({
          id: `image:${frame.id}`,
          frameId: frame.id,
          title: attachmentName || frame.name,
          subtitle: `Image reference • ${frame.devicePreset} • ${frame.mode}`,
          sourceType: "image-reference",
          referenceSourceId: null,
          referenceUrl: null,
          previewLabel: "Image"
        });
        continue;
      }

      if (meta.sourceType !== "figma-reference") {
        continue;
      }

      const resolvedReference = resolveReferenceForFrame(meta, bundle.references);
      if (resolvedReference) {
        figmaItemsByReferenceId.set(resolvedReference.id, {
          id: `figma:${resolvedReference.id}`,
          frameId: frame.id,
          title: frame.name,
          subtitle: `${resolvedReference.scope === "page" ? "Page" : "Frame"} • ${resolvedReference.fileKey}${
            resolvedReference.nodeId ? `:${resolvedReference.nodeId}` : ""
          }`,
          sourceType: "figma-reference",
          referenceSourceId: resolvedReference.id,
          referenceUrl: resolvedReference.figmaUrl,
          previewLabel: resolvedReference.scope === "page" ? "Figma Page" : "Figma Frame"
        });
      } else {
        fallbackFigmaFrameItems.push({
          id: `figma-frame:${frame.id}`,
          frameId: frame.id,
          title: frame.name,
          subtitle: meta.fileKey
            ? `Frame • ${meta.fileKey}${meta.nodeId ? `:${meta.nodeId}` : ""}`
            : "Frame • unresolved Figma reference",
          sourceType: "figma-reference",
          referenceSourceId: meta.referenceSourceId ?? null,
          referenceUrl: null,
          previewLabel: "Figma Frame"
        });
      }
    }

    const figmaItems = bundle.references.map((reference) => {
      const fromFrame = figmaItemsByReferenceId.get(reference.id);
      if (fromFrame) {
        return fromFrame;
      }
      return {
        id: `figma:${reference.id}`,
        frameId: null,
        title: reference.scope === "page" ? "Figma page reference" : "Figma frame reference",
        subtitle: `${reference.scope === "page" ? "Page" : "Frame"} • ${reference.fileKey}${
          reference.nodeId ? `:${reference.nodeId}` : ""
        }`,
        sourceType: "figma-reference" as const,
        referenceSourceId: reference.id,
        referenceUrl: reference.figmaUrl,
        previewLabel: reference.scope === "page" ? "Figma Page" : "Figma Frame"
      };
    });

    return [...figmaItems, ...fallbackFigmaFrameItems, ...imageItems];
  }, [bundle, frameMetaById]);

  const selectedFrameContextLabel = useMemo(() => {
    if (!selectedFrame) {
      return null;
    }
    const sourceMeta = extractFrameSourceMeta(selectedFrame);
    const sourceLabel = sourceMeta?.sourceType ? sourceMeta.sourceType.replaceAll("-", " ") : "generated";
    return `${selectedFrame.name} • ${selectedFrame.devicePreset} • ${selectedFrame.mode} • ${sourceLabel}`;
  }, [selectedFrame]);

  const frameLinks = useMemo(() => buildFramePairLinks(bundle?.frames ?? [], frameMetaById), [bundle?.frames, frameMetaById]);

  const eventsByRun = useMemo(() => {
    const grouped = new Map<string, PipelineEvent[]>();
    for (const event of chatEvents) {
      const current = grouped.get(event.runId) ?? [];
      current.push(event);
      grouped.set(event.runId, current);
    }
    for (const [runId, events] of grouped.entries()) {
      grouped.set(runId, [...events].sort(comparePipelineEvents));
    }
    return grouped;
  }, [chatEvents]);

  const orphanEvents = useMemo(
    () =>
      chatEvents
        .filter((event) => !promptHistory.some((entry) => entry.runId === event.runId))
        .sort(comparePipelineEvents),
    [chatEvents, promptHistory]
  );

  const hasPendingAttachment = composerAttachments.some((attachment) => attachment.status === "pending");
  const hasReadyAttachment = composerAttachments.some((attachment) => {
    if (attachment.type === "figma-link") {
      return Boolean(attachment.url);
    }
    return Boolean(attachment.dataUrl) && attachment.status !== "failed";
  });
  const canSubmit = (composerPrompt.trim().length > 0 || hasReadyAttachment) && !hasPendingAttachment;

  const artboardBackgroundStyle = createArtboardBackgroundStyle(viewport);

  // ── Flow mode helpers ─────────────────────────────────────────────────
  const allFrames = bundle?.frames ?? [];
  const designFrames = useMemo(
    () => allFrames.filter((f) => f.frameKind !== "flow"),
    [allFrames]
  );
  const flowFrames = useMemo(
    () => allFrames.filter((f) => f.frameKind === "flow"),
    [allFrames]
  );
  const selectedDesignFrame = useMemo(
    () => (selectedFrame?.frameKind === "flow" ? null : selectedFrame),
    [selectedFrame]
  );
  const activeFlowFrame = useMemo(
    () =>
      resolveActiveFlowFrame(
        flowFrames,
        selectedFrame?.frameKind === "flow" ? selectedFrame.id : null,
        lastFlowFrameId
      ),
    [flowFrames, lastFlowFrameId, selectedFrame]
  );
  const filteredFrames = canvasMode === "flow" ? flowFrames : designFrames;
  const flowBoardMemoryFrame = useMemo(
    () =>
      flowBoardMemoryModal.frameId
        ? bundle?.frames.find((frame) => frame.id === flowBoardMemoryModal.frameId && frame.frameKind === "flow") ?? null
        : null,
    [bundle, flowBoardMemoryModal.frameId],
  );
  const flowBoardMemoryPreview = useMemo(
    () => (flowBoardMemoryFrame ? buildFlowBoardMemoryPreview(flowBoardMemoryFrame.flowDocument) : null),
    [flowBoardMemoryFrame],
  );

  function applyFlowDocumentFromServer(frameId: string, doc: FlowDocument) {
    setBundle((current) => replaceFlowDocumentInBundle(current, frameId, doc));
  }

  async function runFlowBoardAction(input: {
    frameId: string;
    prompt: string;
    rawPrompt?: string;
    attachments?: ComposerAttachment[];
    taskKind?: FlowBoardTaskKind;
    statusMessage?: string;
  }) {
    const frame = bundleRef.current?.frames.find((candidate) => candidate.id === input.frameId) ?? null;
    if (!frame || frame.frameKind !== "flow") {
      return;
    }

    if (selectedFrame?.id !== frame.id && canvasMode === "flow") {
      await selectFrame(frame.id);
    }

    const visiblePrompt = input.rawPrompt?.trim().length ? input.rawPrompt.trim() : input.prompt.trim();
    const flowRunId = createLocalRunId("flow-action");
    appendPromptTurn({ runId: flowRunId, prompt: visiblePrompt });
    setComposerPrompt("");
    setComposerAttachments([]);
    setFlowBoardTask({ frameId: frame.id, kind: input.taskKind ?? "agent" });

    appendChatEvent({
      runId: flowRunId,
      stage: "system",
      status: "info",
      kind: "action",
      message: input.statusMessage ?? "Running flow-action: asking the agent to update the flow board..."
    });

    try {
      const result = await sendFlowAction(
        getApiBaseUrl(preferences.apiBaseUrl),
        frame.id,
        {
          prompt: buildFlowBoardScopedPrompt(input.prompt),
          provider: preferences.provider,
          model: preferences.model,
          apiKey: preferences.apiKey.trim() || undefined,
          attachments: input.attachments,
          focusedAreaId: focusedFlowAreaId ?? undefined,
        }
      );

      if (result.flowDocument) {
        applyFlowDocumentFromServer(frame.id, result.flowDocument);
      }

      appendChatEvent({
        runId: flowRunId,
        stage: "system",
        status: "success",
        kind: "summary",
        message: result.summary || `Applied ${result.commands?.length ?? 0} flow mutation(s).`
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      appendChatEvent({
        runId: flowRunId,
        stage: "system",
        status: "error",
        kind: "summary",
        message: `Flow action failed: ${message}`
      });
      pushDebugLog("flow-action", reason, { frameId: frame.id }, "error");
    } finally {
      setFlowBoardTask((current) => (current?.frameId === frame.id ? null : current));
    }
  }

  async function handleDeleteFlowBoard(frameId: string) {
    const currentBundle = bundleRef.current;
    if (!currentBundle) {
      return;
    }

    const frame = currentBundle.frames.find((candidate) => candidate.id === frameId) ?? null;
    if (!frame || frame.frameKind !== "flow") {
      return;
    }

    const remainingFlowFrames = currentBundle.frames.filter(
      (candidate) => candidate.frameKind === "flow" && candidate.id !== frameId,
    );
    const nextFlowTarget = resolveFlowModeTarget(
      remainingFlowFrames,
      lastFlowFrameId === frameId ? null : lastFlowFrameId,
    );
    const nextSelectedFlowFrameId = nextFlowTarget.selectedFlowFrameId;

    try {
      await deleteFrame(getApiBaseUrl(preferences.apiBaseUrl), frameId);
      setFlowStoryModal((current) =>
        current.frameId === frameId
          ? { open: false, frameId: null, busy: false, error: null, story: null }
          : current,
      );
      const refreshed = await getProjectBundle(getApiBaseUrl(preferences.apiBaseUrl), currentBundle.project.id);

      if (nextSelectedFlowFrameId) {
        setBundle({
          ...refreshed,
          frames: refreshed.frames.map((candidate) => ({
            ...candidate,
            selected: candidate.id === nextSelectedFlowFrameId,
          })),
        });
        setLastFlowFrameId(nextSelectedFlowFrameId);
        await updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), nextSelectedFlowFrameId, {
          selected: true,
        }).catch((reason) => {
          pushDebugLog("select-frame", reason, { frameId: nextSelectedFlowFrameId, mode: "flow-delete-select" }, "warn");
        });
      } else {
        setBundle({
          ...refreshed,
          frames: refreshed.frames.map((candidate) => ({
            ...candidate,
            selected: false,
          })),
        });
        setLastFlowFrameId(null);
        setFocusedFlowAreaId(null);
        setCanvasMode("design");
        setRunMode("new-frame");
      }

      showToast(`${frame.name} deleted`, 2600);
    } catch (reason) {
      pushDebugLog("delete-flow-board", reason, { frameId }, "error");
      showToast("Flow board delete failed.", 3200);
    }
  }

  async function openFlowStoryExport(frameId: string) {
    const frame = bundleRef.current?.frames.find((candidate) => candidate.id === frameId) ?? null;
    if (!frame || frame.frameKind !== "flow") {
      return;
    }

    setFlowStoryCopied(false);
    setFlowStoryModal({
      open: true,
      frameId,
      busy: true,
      error: null,
      story: frame.flowDocument?.story ?? null,
    });
    setFlowBoardTask({ frameId, kind: "story" });

    try {
      const result = await generateFlowStory(getApiBaseUrl(preferences.apiBaseUrl), frameId, {
        prompt: "Export this board as a user story with acceptance criteria and concise technical notes.",
        provider: preferences.provider,
        model: preferences.model,
        apiKey: preferences.apiKey.trim() || undefined,
      });

      applyFlowDocumentFromServer(frameId, result.flowDocument);
      setFlowStoryModal({
        open: true,
        frameId,
        busy: false,
        error: null,
        story: result.story,
      });
      showToast("Flow story updated", 2400);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      pushDebugLog("flow-story", reason, { frameId }, "error");
      setFlowStoryModal((current) => ({
        open: true,
        frameId,
        busy: false,
        error: message,
        story: current.story ?? frame.flowDocument?.story ?? null,
      }));
    } finally {
      setFlowBoardTask((current) => (current?.frameId === frameId && current.kind === "story" ? null : current));
    }
  }

  async function copyFlowStoryToClipboard() {
    if (!flowStoryModal.story) {
      return;
    }

    try {
      await navigator.clipboard.writeText(buildFlowStoryClipboard(flowStoryModal.story));
      setFlowStoryCopied(true);
      window.setTimeout(() => setFlowStoryCopied(false), 1200);
    } catch (reason) {
      pushDebugLog("flow-story-copy", reason, { frameId: flowStoryModal.frameId }, "warn");
    }
  }

  async function copyFlowBoardMemoryToClipboard() {
    const frameId = flowBoardMemoryModal.frameId;
    const frame = bundleRef.current?.frames.find((candidate) => candidate.id === frameId) ?? null;
    if (!frame || frame.frameKind !== "flow") {
      return;
    }

    try {
      await navigator.clipboard.writeText(buildFlowBoardMemoryPreview(frame.flowDocument).text);
      setFlowBoardMemoryCopied(true);
      window.setTimeout(() => setFlowBoardMemoryCopied(false), 1200);
    } catch (reason) {
      pushDebugLog("flow-board-memory-copy", reason, { frameId }, "warn");
    }
  }

  const createFlowBoard = useCallback(async () => {
    if (!bundle) {
      return null;
    }

    try {
      const nextBoardNumber = flowFrames.length + 1;
      const frame = await createManualFrame(getApiBaseUrl(preferences.apiBaseUrl), bundle.project.id, {
        name: nextBoardNumber === 1 ? "Flow Board" : `Flow Board ${nextBoardNumber}`,
        devicePreset: "desktop",
        mode: "high-fidelity",
        position: { x: 120, y: 120 },
        size: { width: 1400, height: 800 },
        frameKind: "flow",
        flowDocument: createEmptyFlowDocument(),
      });
      setBundle((current) => {
        if (!current) return current;
        return {
          ...current,
          frames: [
            ...current.frames.map((item) => ({ ...item, selected: false })),
            { ...frame, selected: true, versions: [] },
          ],
        };
      });
      setLastFlowFrameId(frame.id);
      setRunMode("edit-selected");
      await updateFrameLayout(getApiBaseUrl(preferences.apiBaseUrl), frame.id, { selected: true }).catch((reason) => {
        pushDebugLog("select-frame", reason, { frameId: frame.id, mode: "flow-create-select" }, "warn");
      });
      return frame;
    } catch (reason) {
      pushDebugLog("create-flow-board", reason, { projectId: bundle.project.id }, "error");
      return null;
    }
  }, [
    bundle,
    flowFrames.length,
    preferences.apiBaseUrl,
    pushDebugLog,
    setBundle,
    setLastFlowFrameId,
    setRunMode,
  ]);

  const handleCanvasModeChange = useCallback(async (mode: "design" | "flow") => {
    setCanvasMode(mode);
    if (mode !== "flow") {
      setFocusedFlowAreaId(null);
      if (selectedFrame?.frameKind === "flow") {
        setBundle((current) => {
          if (!current) return current;
          return {
            ...current,
            frames: current.frames.map((frame) =>
              frame.frameKind === "flow" ? { ...frame, selected: false } : frame
            ),
          };
        });
        setRunMode("new-frame");
      }
      return;
    }

    const transitionTarget = resolveFlowModeTarget(flowFrames, lastFlowFrameId);
    if (transitionTarget.selectedFlowFrameId) {
      await selectFrame(transitionTarget.selectedFlowFrameId);
      setLastFlowFrameId(transitionTarget.selectedFlowFrameId);
      return;
    }

    if (!bundle || !transitionTarget.shouldCreateFlowBoard) {
      return;
    }

    await createFlowBoard();
  }, [
    bundle,
    createFlowBoard,
    flowFrames,
    lastFlowFrameId,
    selectFrame,
    selectedFrame,
    setCanvasMode,
    setFocusedFlowAreaId,
    setLastFlowFrameId,
    setRunMode,
  ]);

  const handleCreateFlowBoard = useCallback(async () => {
    await createFlowBoard();
  }, [createFlowBoard]);

  const handleFlowDocumentChange = useCallback(async (frameId: string, doc: FlowDocument) => {
    const previousDoc = bundleRef.current?.frames.find((frame) => frame.id === frameId)?.flowDocument;

    setBundle((current) => replaceFlowDocumentInBundle(current, frameId, doc));
    try {
      await updateFlowDocument(getApiBaseUrl(preferences.apiBaseUrl), frameId, doc);
    } catch (err) {
      pushDebugLog("flow-document-save", err, { frameId }, "error");
      showToast("Flow board save failed. Reverted the local change.", 3600);
      setBundle((current) => rollbackFlowDocumentIfCurrent(current, frameId, doc, previousDoc));
    }
  }, [preferences.apiBaseUrl, pushDebugLog, setBundle, showToast]);

  useEffect(() => {
    if (canvasMode !== "flow" || !activeFlowFrame) {
      return;
    }

    const ensured = ensureCanonicalFlowDocument(activeFlowFrame, flowFrames);
    if (!ensured.changed) {
      return;
    }

    void handleFlowDocumentChange(activeFlowFrame.id, ensured.flowDocument);
  }, [activeFlowFrame, canvasMode, flowFrames, handleFlowDocumentChange]);

  async function copyDebugLogs() {
    const content = debugLogs
      .map((entry) => {
        const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`;
        return entry.details ? `${base}\n${entry.details}` : base;
      })
      .join("\n\n");

    if (!content) {
      return;
    }

    try {
      setIsCopyingLogs(true);
      await navigator.clipboard.writeText(content);
    } finally {
      window.setTimeout(() => setIsCopyingLogs(false), 1200);
    }
  }

  if (loading) {
    return <div className="app-loading">Loading project...</div>;
  }

  return (
    <div className="app-shell">
      <PromptPanel
        bundle={bundle}
        preferences={preferences}
        composerPrompt={composerPrompt}
        setComposerPrompt={setComposerPrompt}
        composerAttachments={composerAttachments}
        addImageAttachment={addImageAttachment}
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
        setSelectedSurfaceTarget={setSelectedSurfaceTarget}
        variation={variation}
        setVariation={setVariation}
        tailwindOverride={tailwindOverride}
        onTailwindPreferenceChange={handleTailwindPreferenceChange}
        promptHistory={promptHistory}
        eventsByRun={eventsByRun}
        orphanEvents={orphanEvents}
        error={error}
        initializeProject={initializeProject}
        handleRun={handleRun}
        openWorkspaceSettings={() => setWorkspaceSettingsOpen(true)}
        openProjectDesignSystem={() => {
          void openProjectDesignSystem();
        }}
        formatThoughtDuration={formatThoughtDuration}
        canSubmit={canSubmit}
        selectedFrameContextLabel={selectedFrameContextLabel}
        eventCapReached={chatEvents.length >= 420}
        canvasMode={canvasMode}
        activeFlowBoardName={activeFlowFrame?.name ?? null}
      />

      <WorkspaceSettingsModal
        open={isWorkspaceSettingsOpen}
        bundle={bundle}
        preferences={preferences}
        setPreferences={setPreferences}
        initializeProject={initializeProject}
        persistProjectSettings={persistProjectSettings}
        handleResyncReference={handleResyncReference}
        handleCreateManualFrame={handleCreateManualFrame}
        updateDeviceDefault={(devicePreset) => {
          setSelectedDevice(devicePreset);
          void persistProjectSettings({ deviceDefault: devicePreset });
        }}
        updateModeDefault={(modeDefault) => {
          setSelectedMode(modeDefault);
          void persistProjectSettings({ modeDefault });
        }}
        updateDesignSystemModeDefault={handleDesignSystemModeChange}
        updateSurfaceDefault={handleSurfaceTargetChange}
        handleClearBoard={handleClearBoard}
        copyDebugLogs={copyDebugLogs}
        debugLogs={debugLogs}
        isCopyingLogs={isCopyingLogs}
        error={error}
        onClose={() => setWorkspaceSettingsOpen(false)}
        onOpenBrandPicker={() => {
          setWorkspaceSettingsOpen(false);
          setBrandPickerOpen(true);
        }}
        onOpenVisualBoard={() => {
          setWorkspaceSettingsOpen(false);
          void openProjectDesignSystem();
        }}
        activeBrandName={activeBrandName}
      />

      <BrandPickerModal
        open={isBrandPickerOpen}
        onClose={() => setBrandPickerOpen(false)}
        onApply={(markdown, brandName) => {
          void saveProjectDesignSystemMarkdown(markdown);
          setActiveBrandName(brandName);
          setBrandPickerOpen(false);
        }}
        currentBrandId={null}
        hasExistingDesignSystem={!!bundle?.designSystem?.markdown}
        onApplyFromReferences={handleBrandApplyFromReferences}
        onOpenVisualBoard={() => {
          setBrandPickerOpen(false);
          void openProjectDesignSystem();
        }}
      />

      <ProjectDesignSystemModal
        open={isProjectDesignSystemOpen}
        designSystem={bundle?.designSystem ?? null}
        references={bundle?.references ?? []}
        referenceItems={designSystemReferenceItems}
        warnings={designSystemWarnings}
        busy={designSystemBusy}
        busyLabel={designSystemBusyLabel}
        regeneratingReferenceId={designSystemRegeneratingReferenceId}
        onClose={() => setProjectDesignSystemOpen(false)}
        onBootstrap={bootstrapProjectDesignSystemFromModal}
        onResetAndRegenerate={resetAndRegenerateDesignSystemFromModal}
        onSaveMarkdown={saveProjectDesignSystemMarkdown}
        onRegenerateFromReference={regenerateDesignSystemFromReference}
        onRegenerateAllReferences={regenerateDesignSystemFromAllReferences}
        onAddFigmaReference={addFigmaReferenceFromDesignSystemModal}
        onAddImageReferences={addImageReferencesFromDesignSystemModal}
      />

      <FlowStoryModal
        open={flowStoryModal.open}
        boardName={flowStoryModal.frameId ? (bundle?.frames.find((frame) => frame.id === flowStoryModal.frameId)?.name ?? null) : null}
        busy={flowStoryModal.busy}
        error={flowStoryModal.error}
        story={flowStoryModal.story}
        copied={flowStoryCopied}
        onClose={() => {
          setFlowStoryCopied(false);
          setFlowStoryModal((current) => ({ ...current, open: false, busy: false, error: null }));
        }}
        onCopy={() => {
          void copyFlowStoryToClipboard();
        }}
        onRegenerate={() => {
          if (flowStoryModal.frameId) {
            void openFlowStoryExport(flowStoryModal.frameId);
          }
        }}
      />

      <FlowBoardMemoryModal
        open={flowBoardMemoryModal.open}
        boardName={flowBoardMemoryFrame?.name ?? null}
        memoryText={flowBoardMemoryPreview?.text ?? ""}
        copied={flowBoardMemoryCopied}
        persisted={flowBoardMemoryPreview?.persisted ?? false}
        onClose={() => {
          setFlowBoardMemoryCopied(false);
          setFlowBoardMemoryModal({ open: false, frameId: null });
        }}
        onCopy={() => {
          void copyFlowBoardMemoryToClipboard();
        }}
      />

      <ArtboardPane
        interactionType={isViewportPanning ? "pan" : interaction?.type ?? null}
        artboardBackgroundStyle={artboardBackgroundStyle}
        viewport={viewport}
        viewportRef={artboardViewportRef}
        frames={filteredFrames}
        frameLookup={frameLookup}
        frameMetaById={frameMetaById}
        frameLinks={frameLinks}
        copyStates={copyStates}
        expandedHistoryFrameId={expandedHistoryFrameId}
        setExpandedHistoryFrameId={setExpandedHistoryFrameId}
        zoomBy={zoomBy}
        buildPreviewDocument={buildPreviewDocument}
        beginDrag={beginDrag}
        beginResize={beginResize}
        selectFrame={selectFrame}
        clearCanvasSelection={clearCanvasSelection}
        copyFrameToFigma={copyFrameToFigma}
        resyncFrameReference={resyncFrameReference}
        openProjectDesignSystem={() => {
          void openProjectDesignSystem();
        }}
        allowFrameInteraction={isFrameInteractionUnlocked}
        pendingCanvasCards={pendingCanvasCards}
        onImportFigmaScreen={handleImportFigmaScreen}
        hasDesignSystem={!!bundle?.designSystem?.markdown}
        onOpenBrandPicker={() => setBrandPickerOpen(true)}
        toggleFrameHeight={toggleFrameHeight}
        onRegenerate={(fId) => void handleRegenerate(fId)}
        framePrompts={framePromptsSnapshot}
        canvasMode={canvasMode}
        onCanvasModeChange={handleCanvasModeChange}
        activeFlowFrame={activeFlowFrame}
        allDesignFrames={designFrames}
        allFlowFrames={flowFrames}
        onFlowDocumentChange={handleFlowDocumentChange}
        onFocusedFlowAreaChange={setFocusedFlowAreaId}
        onSelectFlowBoard={selectFrame}
        onCreateFlowBoard={handleCreateFlowBoard}
        onDeleteFlowBoard={handleDeleteFlowBoard}
        onAskAgentForFlowBoard={async (frameId) => {
          await runFlowBoardAction({
            frameId,
            prompt: FLOW_BOARD_AGENT_PROMPT,
            taskKind: "agent",
            statusMessage: "Running flow-action: asking the journey agent to review the whole board...",
          });
        }}
        onOpenFlowBoardMemory={(frameId) => {
          setFlowBoardMemoryCopied(false);
          setFlowBoardMemoryModal({ open: true, frameId });
        }}
        onOpenFlowStory={openFlowStoryExport}
        activeFlowBoardTask={activeFlowFrame && flowBoardTask?.frameId === activeFlowFrame.id ? flowBoardTask.kind : null}
      />

      {captureFrame ? (
        <div className="capture-overlay">
          <div className="capture-overlay__panel">
            <p>Preparing editable Figma capture for: {captureFrame.name}</p>
            <div id={`capture-surface-${captureFrame.id}`} className="capture-overlay__surface">
              <style>{captureFrame.versions[captureFrame.versions.length - 1]?.cssCode ?? ""}</style>
              <div
                dangerouslySetInnerHTML={{
                  __html: captureFrame.versions[captureFrame.versions.length - 1]?.exportHtml ?? "<div />"
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? <div className="artboard-toast">{toastMessage}</div> : null}
    </div>
  );
}
