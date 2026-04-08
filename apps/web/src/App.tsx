import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ComposerAttachment,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  FrameVersion,
  PipelineEvent,
  ProjectBundle,
  ProjectSettings,
  ReferenceSource,
  SurfaceTarget
} from "@designer/shared";
import { select, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3-zoom";
import {
  addReferenceWithCredentials,
  bootstrapProjectDesignSystem,
  calibrateProjectDesignSystem,
  checkApiHealth,
  clearBoard,
  createManualFrame,
  createProject,
  getApiBaseUrl,
  getProjectBundle,
  getProjectDesignSystem,
  regenerateProjectDesignSystem,
  regenerateProjectDesignSystemFromReference,
  resetAndRegenerateProjectDesignSystem,
  openRunStream,
  resyncReference,
  saveProjectDesignSystem,
  startEditRun,
  startGenerateRun,
  updateFrameLayout,
  updateProjectSettings
} from "./api";
import { captureSelectorToFigmaClipboard, type CaptureLogEntry } from "./lib/figmaCapture";
import { ArtboardPane } from "./components/ArtboardPane";
import { PromptPanel } from "./components/PromptPanel";
import { WorkspaceSettingsModal } from "./components/WorkspaceSettingsModal";
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
import { runSequentialQueue } from "./lib/designSystemModal";
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
  PROJECT_STORAGE_KEY,
  savePreferences,
  VIEWPORT_MAX_SCALE,
  VIEWPORT_MIN_SCALE,
  VIEWPORT_DEFAULT
} from "./lib/appHelpers";
import { annotateClientOrder, comparePipelineEvents } from "./lib/eventOrdering";
import { createSmoothPanController } from "./lib/viewportController";
import type { CopyState, DebugLogEntry, DebugLogLevel, LocalPreferences, PromptEntry, RunMode } from "./types/ui";

type InteractionState =
  | {
      type: "drag";
      frameId: string;
      originX: number;
      originY: number;
      startX: number;
      startY: number;
    }
  | {
      type: "resize";
      frameId: string;
      originWidth: number;
      originHeight: number;
      startX: number;
      startY: number;
    };

type CopyStateMap = Record<
  string,
  {
    state: CopyState;
    logs: CaptureLogEntry[];
  }
>;

type PendingCanvasCard = {
  id: string;
  runId: string;
  sourceType: "figma-reference" | "image-reference";
  sourceRole: "reference-screen" | "design-system";
  createdAfterMs: number;
  name: string;
  subtitle: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

export default function App() {
  const [preferences, setPreferences] = useState<LocalPreferences>(loadPreferences);
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [composerPrompt, setComposerPrompt] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [runMode, setRunMode] = useState<RunMode>("new-frame");
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(preferences.deviceDefault);
  const [selectedMode, setSelectedMode] = useState<DesignMode>(preferences.modeDefault);
  const [selectedDesignSystemMode, setSelectedDesignSystemMode] = useState<DesignSystemMode>("strict");
  const [selectedSurfaceTarget, setSelectedSurfaceTarget] = useState<SurfaceTarget>("web");
  const [variation, setVariation] = useState(1);
  const [tailwindOverride, setTailwindOverride] = useState(preferences.tailwindDefault);
  const [chatEvents, setChatEvents] = useState<PipelineEvent[]>([]);
  const [promptHistory, setPromptHistory] = useState<PromptEntry[]>([]);
  const [copyStates, setCopyStates] = useState<CopyStateMap>({});
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [isCopyingLogs, setIsCopyingLogs] = useState(false);
  const [captureFrameId, setCaptureFrameId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [isViewportPanning, setViewportPanning] = useState(false);
  const [viewport, setViewport] = useState(VIEWPORT_DEFAULT);
  const [expandedHistoryFrameId, setExpandedHistoryFrameId] = useState<string | null>(null);
  const [isWorkspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [isProjectDesignSystemOpen, setProjectDesignSystemOpen] = useState(false);
  const [designSystemWarnings, setDesignSystemWarnings] = useState<string[]>([]);
  const [designSystemBusy, setDesignSystemBusy] = useState(false);
  const [designSystemBusyLabel, setDesignSystemBusyLabel] = useState<string | null>(null);
  const [designSystemRegeneratingReferenceId, setDesignSystemRegeneratingReferenceId] = useState<string | null>(null);
  const [pendingFigmaAttachUrl, setPendingFigmaAttachUrl] = useState<string | null>(null);
  const [isFrameInteractionUnlocked, setFrameInteractionUnlocked] = useState(false);
  const [pendingCanvasCards, setPendingCanvasCards] = useState<PendingCanvasCard[]>([]);
  const runSockets = useRef<Map<string, WebSocket>>(new Map());
  const runCompletionResolversRef = useRef<Map<string, { resolve: (success: boolean) => void; timeoutId: number }>>(
    new Map()
  );
  const revealDesignSystemRunsRef = useRef<Set<string>>(new Set());
  const pendingRefresh = useRef<number | null>(null);
  const bundleRef = useRef<ProjectBundle | null>(null);
  const artboardViewportRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(VIEWPORT_DEFAULT);
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const zoomSelectionRef = useRef<Selection<HTMLDivElement, unknown, null, undefined> | null>(null);
  const focusAnimationRef = useRef<number | null>(null);
  const lastFocusedFrameIdRef = useRef<string | null>(null);
  const eventOrderRef = useRef(0);
  const autoFitAppliedVersionsRef = useRef<Set<string>>(new Set());
  const autoFitSuppressedVersionsRef = useRef<Set<string>>(new Set());
  const autoFitPendingVersionsRef = useRef<Set<string>>(new Set());

  const projectId = bundle?.project.id ?? null;

  const pushDebugLog = useCallback(
    (
      scope: string,
      reason: unknown,
      details?: Record<string, unknown>,
      level: DebugLogLevel = reason instanceof Error ? "error" : "info"
    ) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      const payload = {
        ...(details ?? {}),
        ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {})
      };

      setDebugLogs((current) => [
        ...current,
        {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          scope,
          level,
          message,
          details: Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2) : undefined
        }
      ].slice(-400));
    },
    []
  );

  const appendOrderedEvent = useCallback((event: PipelineEvent) => {
    eventOrderRef.current += 1;
    const orderedEvent = annotateClientOrder(event, eventOrderRef.current);
    setChatEvents((current) => [...current, orderedEvent].slice(-420));
  }, []);

  const appendPromptTurn = useCallback(
    (input: { runId: string; prompt: string }) => {
      setPromptHistory((current) => [
        ...current,
        {
          runId: input.runId,
          prompt: input.prompt,
          submittedAt: new Date().toISOString(),
          mode: runMode,
          devicePreset: selectedDevice,
          designMode: selectedMode
        }
      ]);
    },
    [runMode, selectedDevice, selectedMode]
  );

  const appendChatEvent = useCallback(
    (input: {
      runId: string;
      stage: PipelineEvent["stage"];
      status: PipelineEvent["status"];
      kind: PipelineEvent["kind"];
      message: string;
      payload?: Record<string, unknown>;
    }) => {
      appendOrderedEvent({
        runId: input.runId,
        timestamp: new Date().toISOString(),
        stage: input.stage,
        status: input.status,
        kind: input.kind,
        message: input.message,
        payload: input.payload
      });
    },
    [appendOrderedEvent]
  );

  const appendSystemEvent = useCallback(
    (input: {
      status: PipelineEvent["status"];
      message: string;
      kind?: PipelineEvent["kind"];
      payload?: Record<string, unknown>;
      stage?: PipelineEvent["stage"];
    }) => {
      appendChatEvent({
        runId: "composer-system",
        stage: input.stage ?? "system",
        status: input.status,
        kind: input.kind ?? "summary",
        message: input.message,
        payload: input.payload
      });
    },
    [appendChatEvent]
  );

  const resolveRunCompletion = useCallback((runId: string, success: boolean) => {
    const entry = runCompletionResolversRef.current.get(runId);
    if (!entry) {
      return;
    }
    window.clearTimeout(entry.timeoutId);
    runCompletionResolversRef.current.delete(runId);
    entry.resolve(success);
  }, []);

  const waitForRunCompletion = useCallback(
    (runId: string, timeoutMs = 6 * 60 * 1000) =>
      new Promise<boolean>((resolve) => {
        const existing = runCompletionResolversRef.current.get(runId);
        if (existing) {
          window.clearTimeout(existing.timeoutId);
          runCompletionResolversRef.current.delete(runId);
        }

        const timeoutId = window.setTimeout(() => {
          runCompletionResolversRef.current.delete(runId);
          resolve(false);
        }, timeoutMs);

        runCompletionResolversRef.current.set(runId, {
          resolve,
          timeoutId
        });
      }),
    []
  );

  const removeComposerAttachment = useCallback(
    (attachmentId: string) => {
      setComposerAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    },
    []
  );

  const addFigmaAttachment = useCallback(
    (rawUrl: string) => {
      const figmaUrl = extractFigmaUrl(rawUrl);
      if (!figmaUrl) {
        appendSystemEvent({
          status: "error",
          kind: "action",
          message: "Invalid Figma URL. Use a figma.com/design link."
        });
        return;
      }

      const attachment: ComposerAttachment = {
        id: `figma-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "figma-link",
        url: figmaUrl,
        status: "uploaded",
        name: "Figma reference"
      };

      setComposerAttachments((current) => {
        const withoutExisting = current.filter((item) => item.type !== "figma-link");
        return [...withoutExisting, attachment];
      });

      appendSystemEvent({
        status: "success",
        kind: "action",
        message: "Figma link attached to composer.",
        payload: { url: figmaUrl }
      });
    },
    [appendSystemEvent]
  );

  const addImageAttachment = useCallback(
    async (file: File) => {
      const allowedMime = new Set(["image/png", "image/jpg", "image/jpeg", "image/webp", "image/svg+xml"]);
      if (!allowedMime.has(file.type)) {
        appendSystemEvent({
          status: "error",
          kind: "action",
          message: "Unsupported image type. Use png, jpg, jpeg, webp, or svg."
        });
        return;
      }

      if (file.size > 8 * 1024 * 1024) {
        appendSystemEvent({
          status: "error",
          kind: "action",
          message: "Image is too large. Max supported size is 8 MB."
        });
        return;
      }

      if (composerAttachments.some((attachment) => attachment.type === "image" && attachment.status !== "failed")) {
        appendSystemEvent({
          status: "error",
          kind: "action",
          message: "Only one image attachment is supported per message."
        });
        return;
      }

      const provisionalId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setComposerAttachments((current) => [
        ...current.filter((attachment) => !(attachment.type === "image" && attachment.status === "failed")),
        {
          id: provisionalId,
          type: "image",
          status: "pending",
          name: file.name,
          mimeType: file.type
        }
      ]);

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("File reader did not return a data URL."));
          }
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read image attachment."));
        reader.readAsDataURL(file);
      }).catch((reason) => {
        appendSystemEvent({
          status: "error",
          kind: "action",
          message: reason instanceof Error ? reason.message : String(reason)
        });
        return null;
      });

      if (!dataUrl) {
        setComposerAttachments((current) =>
          current.map((attachment) => {
            if (attachment.id !== provisionalId) {
              return attachment;
            }
            return {
              ...attachment,
              status: "failed"
            };
          })
        );
        return;
      }

      setComposerAttachments((current) =>
        current.map((attachment) => {
          if (attachment.id !== provisionalId) {
            return attachment;
          }
          return {
            ...attachment,
            status: "uploaded",
            dataUrl
          };
        })
      );

      appendSystemEvent({
        status: "success",
        kind: "action",
        message: "Image attached. I can rebuild it into editable React UI on send.",
        payload: { name: file.name }
      });
    },
    [appendSystemEvent, composerAttachments]
  );

  const selectedFrame = useMemo(() => {
    if (!bundle?.frames.length) {
      return null;
    }
    return bundle.frames.find((frame) => frame.selected) ?? null;
  }, [bundle]);

  const captureFrame = useMemo(() => {
    if (!bundle || !captureFrameId) {
      return null;
    }
    return bundle.frames.find((frame) => frame.id === captureFrameId) ?? null;
  }, [bundle, captureFrameId]);

  const scheduleRefresh = useCallback(
    (delayMs = 420) => {
      if (pendingRefresh.current) {
        window.clearTimeout(pendingRefresh.current);
      }

      pendingRefresh.current = window.setTimeout(async () => {
        if (!projectId) {
          return;
        }
        try {
          const data = await getProjectBundle(getApiBaseUrl(preferences.apiBaseUrl), projectId);
          setBundle(data);
          setPendingCanvasCards((current) =>
            current.filter((pending) => {
              const hasMaterializedFrame = data.frames.some((frame) => {
                const meta = extractFrameSourceMeta(frame);
                if (!meta) {
                  return false;
                }
                if (meta.sourceType !== pending.sourceType || meta.sourceRole !== pending.sourceRole) {
                  return false;
                }
                const updatedAtMs = new Date(frame.updatedAt).getTime();
                const createdAtMs = new Date(frame.createdAt).getTime();
                return (
                  (Number.isFinite(updatedAtMs) && updatedAtMs >= pending.createdAfterMs - 1000) ||
                  (Number.isFinite(createdAtMs) && createdAtMs >= pending.createdAfterMs - 1000)
                );
              });
              return !hasMaterializedFrame;
            })
          );
        } catch (reason) {
          pushDebugLog("refresh-project", reason, { projectId }, "warn");
        }
      }, delayMs);
    },
    [preferences.apiBaseUrl, projectId, pushDebugLog]
  );

  const openRunSocket = useCallback(
    (runId: string) => {
      const socket = openRunStream(getApiBaseUrl(preferences.apiBaseUrl), runId, {
        onEvent: (event) => {
          appendOrderedEvent(event);
          const step = typeof event.payload?.step === "string" ? event.payload.step : null;
          if (step === "run-complete") {
            resolveRunCompletion(runId, true);
          } else if (step === "run-failed") {
            resolveRunCompletion(runId, false);
          } else if (event.status === "error" && event.stage === "system") {
            resolveRunCompletion(runId, false);
          }
          if (event.status === "error") {
            setPendingCanvasCards((current) => current.filter((pending) => pending.runId !== runId));
            revealDesignSystemRunsRef.current.delete(runId);
          }
          if (
            event.status === "success" &&
            revealDesignSystemRunsRef.current.has(runId) &&
            event.payload?.step === "run-complete"
          ) {
            revealDesignSystemRunsRef.current.delete(runId);
            window.setTimeout(() => {
              void openProjectDesignSystem();
            }, 420);
          }
          if (event.payload?.frameId || event.status === "success" || event.status === "error") {
            scheduleRefresh(320);
          }
        },
        onClose: () => {
          runSockets.current.delete(runId);
          resolveRunCompletion(runId, false);
          pushDebugLog("run-stream", "WebSocket stream closed", { runId }, "debug");
          scheduleRefresh(520);
        },
        onError: (event) => {
          pushDebugLog("run-stream", "WebSocket stream error", {
            runId,
            type: event.type
          }, "warn");
          setError("Live run stream disconnected. Open logs for details.");
        }
      });

      runSockets.current.set(runId, socket);
    },
    [appendOrderedEvent, preferences.apiBaseUrl, pushDebugLog, resolveRunCompletion, scheduleRefresh]
  );

  const initializeProject = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const apiBase = getApiBaseUrl(preferences.apiBaseUrl);
      const isHealthy = await checkApiHealth(apiBase);
      if (!isHealthy) {
        throw new Error(`API unreachable at ${apiBase}. Start the backend and verify the API base URL.`);
      }
      const storedProjectId = window.localStorage.getItem(PROJECT_STORAGE_KEY);
      let data: ProjectBundle | null = null;

      if (storedProjectId) {
        data = await getProjectBundle(apiBase, storedProjectId).catch(() => null);
      }

      if (!data) {
        data = await createProject(apiBase, "Conversational UI Designer");
        window.localStorage.setItem(PROJECT_STORAGE_KEY, data.project.id);
        pushDebugLog("initialize-project", "Created new project", { projectId: data.project.id }, "info");
      }

      setBundle(data);
      setPendingCanvasCards([]);
      revealDesignSystemRunsRef.current.clear();
      setSelectedDevice(data.project.settings.deviceDefault);
      setSelectedMode(data.project.settings.modeDefault);
      setSelectedDesignSystemMode(data.project.settings.designSystemModeDefault);
      setSelectedSurfaceTarget(data.project.settings.surfaceDefault);
      setTailwindOverride(data.project.settings.tailwindDefault);
      setPreferences((current) => ({
        ...current,
        provider: data.project.settings.provider,
        model: data.project.settings.model,
        tailwindDefault: data.project.settings.tailwindDefault,
        deviceDefault: data.project.settings.deviceDefault,
        modeDefault: data.project.settings.modeDefault
      }));
      pushDebugLog("initialize-project", "Workspace initialized", { projectId: data.project.id, frameCount: data.frames.length }, "info");
    } catch (reason) {
      pushDebugLog("initialize-project", reason, { apiBaseUrl: getApiBaseUrl(preferences.apiBaseUrl) }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [preferences.apiBaseUrl, pushDebugLog]);

  useEffect(() => {
    void initializeProject();
  }, [initializeProject]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

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

      const versionKey = `${frameId}:${versionId}`;
      if (
        autoFitAppliedVersionsRef.current.has(versionKey) ||
        autoFitSuppressedVersionsRef.current.has(versionKey) ||
        autoFitPendingVersionsRef.current.has(versionKey)
      ) {
        return;
      }

      const chromeOffset = 84;
      const nextHeight = Math.max(260, Math.min(3600, Math.ceil(contentHeight + chromeOffset)));
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

  useEffect(() => {
    return () => {
      for (const socket of runSockets.current.values()) {
        socket.close();
      }
      for (const resolver of runCompletionResolversRef.current.values()) {
        window.clearTimeout(resolver.timeoutId);
        resolver.resolve(false);
      }
      runCompletionResolversRef.current.clear();
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
                  x: Math.max(0, interaction.originX + scaledDeltaX),
                  y: Math.max(0, interaction.originY + scaledDeltaY)
                }
              };
            }

            return {
              ...frame,
              size: {
                width: Math.max(220, interaction.originWidth + scaledDeltaX),
                height: Math.max(260, interaction.originHeight + scaledDeltaY)
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

  async function attachFigmaFromChat(input: { runId: string; figmaUrl: string }) {
    if (!projectId) {
      return false;
    }

    setError("");
    appendChatEvent({
      runId: input.runId,
      stage: "system",
      status: "info",
      kind: "summary",
      message: "Detected a Figma link in chat. Starting reference attach via MCP get_design_context."
    });

    try {
      const result = await addReferenceWithCredentials(getApiBaseUrl(preferences.apiBaseUrl), projectId, {
        figmaUrl: input.figmaUrl.trim(),
        figmaClientId: preferences.figmaClientId.trim() || undefined,
        figmaClientSecret: preferences.figmaClientSecret.trim() || undefined
      });

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

      const fallback = payload?.fallback;
      const errorMessage = payload?.error;
      const warningMessage = payload?.warning;

      if (errorMessage) {
        appendChatEvent({
          runId: input.runId,
          stage: "system",
          status: "error",
          kind: "summary",
          message: errorMessage
        });
      }

      if (fallback?.requiredClientCredentials) {
        setPendingFigmaAttachUrl(input.figmaUrl);
        appendChatEvent({
          runId: input.runId,
          stage: "system",
          status: "info",
          kind: "action",
          message:
            fallback.retryPrompt ??
            "MCP failed. Send `/figma-credentials <clientId> <clientSecret>` in chat, then resend your Figma link."
        });
        return false;
      } else if (!errorMessage) {
        appendChatEvent({
          runId: input.runId,
          stage: "system",
          status: "success",
          kind: "summary",
          message: warningMessage
            ? `Reference attached with fallback mode (${fallback?.mode ?? "public-link-style-context"}).`
            : "Reference attached and frames were created from the Figma link."
        });

        if (warningMessage) {
          appendChatEvent({
            runId: input.runId,
            stage: "system",
            status: "info",
            kind: "action",
            message: warningMessage
          });
        }
        setPendingFigmaAttachUrl(null);
      } else {
        return false;
      }

      const refreshed = await getProjectBundle(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle(refreshed);
      pushDebugLog("add-reference", "Reference attach completed", { figmaUrl: input.figmaUrl, referenceCount: refreshed.references.length }, "info");
      return true;
    } catch (reason) {
      pushDebugLog("add-reference", reason, {
        figmaUrl: input.figmaUrl
      }, "error");
      appendChatEvent({
        runId: input.runId,
        stage: "system",
        status: "error",
        kind: "summary",
        message: reason instanceof Error ? reason.message : String(reason)
      });
      return false;
    }
  }

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

  async function openProjectDesignSystem() {
    if (!projectId) {
      return;
    }
    setProjectDesignSystemOpen(true);
    try {
      const response = await getProjectDesignSystem(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle((current) =>
        current
          ? {
              ...current,
              designSystem: response.designSystem
            }
          : current
      );
    } catch (reason) {
      pushDebugLog("design-system", reason, { projectId }, "warn");
    }
  }

  const emitDesignSystemQualitySummary = useCallback(
    (input: { designSystem: NonNullable<ProjectBundle["designSystem"]>; reason: string }) => {
      const report = input.designSystem.structuredTokens.qualityReport;
      appendSystemEvent({
        status: report.referenceQuality === "poor" ? "error" : "info",
        kind: "summary",
        message: `${input.reason}: reference quality ${report.referenceQuality} (${Math.round(
          report.globalConfidence * 100
        )}% confidence).`,
        payload: {
          step: "design-system-quality",
          referenceQuality: report.referenceQuality,
          confidence: report.globalConfidence,
          fidelityScore: report.fidelityScore,
          detectionCoverage: report.detectionCoverage,
          qualityReasons: report.qualityReasons
        }
      });

      if (report.referenceQuality !== "good") {
        const guidance =
          report.qualityReasons[0] ??
          report.recommendations[0] ??
          "Attach clearer references or calibrate in chat, then regenerate.";
        appendSystemEvent({
          status: report.referenceQuality === "poor" ? "error" : "info",
          kind: "action",
          message: `Quality note: ${guidance}`
        });
      }
    },
    [appendSystemEvent]
  );

  async function addFigmaReferenceFromDesignSystemModal(rawUrl: string) {
    const figmaUrl = extractFigmaUrl(rawUrl);
    if (!figmaUrl) {
      appendSystemEvent({
        status: "error",
        kind: "action",
        message: "Invalid Figma URL. Use a figma.com/design link."
      });
      return;
    }

    const runId = createLocalRunId("ds-reference");
    appendChatEvent({
      runId,
      stage: "system",
      status: "info",
      kind: "summary",
      message: "Adding Figma reference from the design system workspace."
    });

    const attached = await attachFigmaFromChat({
      runId,
      figmaUrl
    });

    if (attached) {
      setProjectDesignSystemOpen(false);
      await bootstrapProjectDesignSystemFromModal("reference");
    }
  }

  function getPendingAnchorPosition() {
    if (selectedFrame) {
      return {
        x: selectedFrame.position.x + selectedFrame.size.width + 72,
        y: selectedFrame.position.y + 12
      };
    }
    const lastFrame = bundle?.frames?.[bundle.frames.length - 1];
    if (lastFrame) {
      return {
        x: lastFrame.position.x + lastFrame.size.width + 72,
        y: lastFrame.position.y + 12
      };
    }
    return { x: 320, y: 220 };
  }

  async function startImageReferenceRunFromModal(
    imageAttachment: ComposerAttachment,
    options?: { waitForCompletion?: boolean; keepModalOpen?: boolean }
  ) {
    if (!projectId) {
      return false;
    }

    const runPrompt = "Rebuild the attached image into an editable screen and refresh the canonical design-system board.";
    const payload = {
      prompt: runPrompt,
      provider: preferences.provider,
      model: preferences.model,
      apiKey: preferences.apiKey.trim() || undefined,
      devicePreset: selectedDevice,
      mode: selectedMode,
      surfaceTarget: selectedSurfaceTarget,
      designSystemMode: selectedDesignSystemMode,
      variation: 1,
      tailwindEnabled: tailwindOverride,
      attachments: [imageAttachment]
    };

    const run = await startGenerateRun(getApiBaseUrl(preferences.apiBaseUrl), projectId, payload);
    const runId = run.runId;
    const completionPromise = options?.waitForCompletion ? waitForRunCompletion(runId) : null;
    revealDesignSystemRunsRef.current.add(runId);
    const createdAfterMs = Date.now();
    const anchor = getPendingAnchorPosition();

    setPendingCanvasCards((current) => [
      ...current,
      {
        id: `pending-image-screen-${runId}`,
        runId,
        sourceType: "image-reference",
        sourceRole: "reference-screen",
        createdAfterMs,
        name: "Reference Screen (building)",
        subtitle: "Rebuilding attached image into editable React/HTML",
        position: anchor,
        size: { width: 1080, height: 720 }
      },
      {
        id: `pending-image-ds-${runId}`,
        runId,
        sourceType: "image-reference",
        sourceRole: "design-system",
        createdAfterMs,
        name: "Design System (building)",
        subtitle: "Refreshing the canonical visual DS board from the rebuilt screen",
        position: { x: anchor.x + 1140, y: anchor.y + 28 },
        size: { width: 920, height: 620 }
      }
    ]);

    appendOrderedEvent({
      runId,
      timestamp: new Date().toISOString(),
      stage: "system",
      status: "info",
      kind: "summary",
      message: "Starting image-aware pipeline (analyze -> rebuild screen -> canonical design-system refresh)."
    });
    appendPromptTurn({
      runId,
      prompt: "Generate from image reference (Design System modal)."
    });
    openRunSocket(runId);
    if (!options?.keepModalOpen) {
      setProjectDesignSystemOpen(false);
    }
    setComposerAttachments([]);
    setComposerPrompt("");
    pushDebugLog(
      "start-run",
      "Image reference run started from Design System modal",
      {
        runId,
        provider: preferences.provider,
        model: preferences.model,
        devicePreset: selectedDevice,
        designMode: selectedMode,
        surfaceTarget: selectedSurfaceTarget,
        designSystemMode: selectedDesignSystemMode,
        attachmentCount: 1
      },
      "info"
    );
    if (completionPromise) {
      return completionPromise;
    }
    return true;
  }

  function validateImageReferenceFile(file: File) {
    const allowedMime = new Set(["image/png", "image/jpg", "image/jpeg", "image/webp", "image/svg+xml"]);
    if (!allowedMime.has(file.type)) {
      return "Unsupported image type. Use png, jpg, jpeg, webp, or svg.";
    }

    if (file.size > 8 * 1024 * 1024) {
      return "Image is too large. Max supported size is 8 MB.";
    }

    return null;
  }

  async function fileToImageAttachment(file: File) {
    const validationError = validateImageReferenceFile(file);
    if (validationError) {
      appendSystemEvent({
        status: "error",
        kind: "action",
        message: validationError
      });
      return null;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("File reader did not return a data URL."));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read image attachment."));
      reader.readAsDataURL(file);
    }).catch((reason) => {
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message: reason instanceof Error ? reason.message : String(reason)
      });
      return null;
    });

    if (!dataUrl) {
      return null;
    }

    return {
      id: `image-modal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "image",
      status: "uploaded",
      name: file.name,
      mimeType: file.type,
      dataUrl
    } as ComposerAttachment;
  }

  async function addImageReferencesFromDesignSystemModal(files: File[]) {
    if (files.length === 0) {
      return;
    }

    try {
      setDesignSystemBusy(true);
      setDesignSystemBusyLabel(`Processing image references (0/${files.length})...`);
      setDesignSystemRegeneratingReferenceId(null);
      const queueResult = await runSequentialQueue(files, async (file, index) => {
        setDesignSystemBusyLabel(`Processing image references (${index + 1}/${files.length})...`);
        const attachment = await fileToImageAttachment(file);
        if (!attachment) {
          return false;
        }

        appendSystemEvent({
          status: "info",
          kind: "summary",
          message: `Processing image reference ${index + 1}/${files.length}: ${file.name}`
        });

        const success = await startImageReferenceRunFromModal(attachment, {
          waitForCompletion: true,
          keepModalOpen: true
        });
        return success;
      });

      if (queueResult.successful > 0) {
        setDesignSystemBusyLabel("Merging all references into one design system...");
        await regenerateDesignSystemFromAllReferences();
      } else {
        appendSystemEvent({
          status: "error",
          kind: "summary",
          message: "No valid image references completed. Design system was not regenerated."
        });
      }
    } catch (reason) {
      pushDebugLog("start-run", reason, {
        provider: preferences.provider,
        model: preferences.model,
        apiBaseUrl: getApiBaseUrl(preferences.apiBaseUrl),
        source: "design-system-modal-images"
      }, "error");
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message: reason instanceof Error ? reason.message : String(reason)
      });
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
    }
  }

  async function bootstrapProjectDesignSystemFromModal(mode: "manual" | "reference") {
    if (!projectId) {
      return;
    }
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel(
      mode === "reference"
        ? "Reviewing connected references and refreshing visual components..."
        : "Creating a manual design system workspace..."
    );
    setDesignSystemRegeneratingReferenceId(null);
    try {
      const result = await bootstrapProjectDesignSystem(getApiBaseUrl(preferences.apiBaseUrl), projectId, mode);
      setBundle((current) =>
        current
          ? {
              ...current,
              designSystem: result.designSystem
            }
          : current
      );
      setDesignSystemWarnings(result.warnings ?? []);
      emitDesignSystemQualitySummary({
        designSystem: result.designSystem,
        reason: mode === "manual" ? "Manual DESIGN.md bootstrap completed" : "Reference bootstrap completed"
      });
      appendSystemEvent({
        status: "success",
        kind: "summary",
        message:
          mode === "manual"
            ? "Design system seeded from manual template. Open design.md to refine it."
            : "Design system bootstrapped from the latest synced reference."
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message
      });
      pushDebugLog("design-system-bootstrap", reason, { mode, projectId }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
    }
  }

  async function resetAndRegenerateDesignSystemFromModal() {
    if (!projectId) {
      return;
    }
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel("Resetting design system and rebuilding from all references...");
    setDesignSystemRegeneratingReferenceId(null);
    try {
      const result = await resetAndRegenerateProjectDesignSystem(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle((current) =>
        current
          ? {
              ...current,
              designSystem: result.designSystem
            }
          : current
      );
      setDesignSystemWarnings(result.warnings ?? []);
      emitDesignSystemQualitySummary({
        designSystem: result.designSystem,
        reason: "Full reset and regeneration completed"
      });
      appendSystemEvent({
        status: "success",
        kind: "summary",
        message: "Design system reset completed. Metadata was cleared and system rebuilt from current references."
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message
      });
      pushDebugLog("design-system-reset-regenerate", reason, { projectId }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
    }
  }

  async function saveProjectDesignSystemMarkdown(markdown: string) {
    if (!projectId) {
      return;
    }
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel("Saving design.md and refreshing visual components...");
    setDesignSystemRegeneratingReferenceId(null);
    try {
      const result = await saveProjectDesignSystem(getApiBaseUrl(preferences.apiBaseUrl), projectId, {
        markdown,
        status: "draft",
        sourceType: bundle?.designSystem?.sourceType ?? "manual",
        sourceReferenceId: bundle?.designSystem?.sourceReferenceId ?? null
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
      appendSystemEvent({
        status: "success",
        kind: "action",
        message: "Saved design.md and refreshed the visual system."
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message
      });
      pushDebugLog("design-system-save", reason, { projectId }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
    }
  }

  async function regenerateDesignSystemFromReference(item: DesignSystemReferenceItem) {
    if (!projectId) {
      return;
    }

    if (item.sourceType === "image-reference" && !item.frameId) {
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message: "Cannot regenerate from this image reference yet because its frame mapping is missing."
      });
      return;
    }

    setDesignSystemBusy(true);
    setDesignSystemBusyLabel(`Reviewing ${item.previewLabel.toLowerCase()} and updating the visual design system...`);
    setDesignSystemRegeneratingReferenceId(item.id);
    appendSystemEvent({
      status: "info",
      kind: "summary",
      message: `Regenerating design system from ${item.title}.`
    });

    try {
      const result =
        item.sourceType === "figma-reference"
          ? await regenerateProjectDesignSystemFromReference(getApiBaseUrl(preferences.apiBaseUrl), projectId, {
              sourceType: "figma-reference",
              referenceSourceId: item.referenceSourceId ?? ""
            })
          : await regenerateProjectDesignSystemFromReference(getApiBaseUrl(preferences.apiBaseUrl), projectId, {
              sourceType: "image-reference",
              frameId: item.frameId ?? ""
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
      emitDesignSystemQualitySummary({
        designSystem: result.designSystem,
        reason: `Regeneration completed from ${item.title}`
      });
      appendSystemEvent({
        status: "success",
        kind: "summary",
        message: `Design system regenerated from ${item.title}.`
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message
      });
      pushDebugLog(
        "design-system-regenerate",
        reason,
        {
          projectId,
          sourceType: item.sourceType,
          referenceSourceId: item.referenceSourceId,
          frameId: item.frameId
        },
        "error"
      );
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
    }
  }

  async function regenerateDesignSystemFromAllReferences() {
    if (!projectId) {
      return;
    }

    setDesignSystemBusy(true);
    setDesignSystemBusyLabel("Re-analyzing all references and rebuilding component recipes...");
    setDesignSystemRegeneratingReferenceId(null);
    appendSystemEvent({
      status: "info",
      kind: "summary",
      message: "Regenerating design system from all available references."
    });

    try {
      const result = await regenerateProjectDesignSystem(getApiBaseUrl(preferences.apiBaseUrl), projectId);
      setBundle((current) =>
        current
          ? {
              ...current,
              designSystem: result.designSystem
            }
          : current
      );
      setDesignSystemWarnings(result.warnings ?? []);
      emitDesignSystemQualitySummary({
        designSystem: result.designSystem,
        reason: "Regeneration completed from all references"
      });
      appendSystemEvent({
        status: "success",
        kind: "summary",
        message: "Design system regenerated from all references."
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      appendSystemEvent({
        status: "error",
        kind: "summary",
        message
      });
      pushDebugLog("design-system-regenerate", reason, { projectId, scope: "all-references" }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
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

    if (!cleanedPrompt && imageAttachment) {
      cleanedPrompt = "Rebuild the attached image into an editable screen and refresh the canonical design-system board.";
    }

    const selectedSourceMeta = selectedFrame ? extractFrameSourceMeta(selectedFrame) : null;
    const selectedFrameContext = selectedFrame
      ? {
          frameId: selectedFrame.id,
          name: selectedFrame.name,
          devicePreset: selectedFrame.devicePreset,
          mode: selectedFrame.mode,
          size: {
            width: selectedFrame.size.width,
            height: selectedFrame.size.height
          },
          latestVersionId: selectedFrame.currentVersionId,
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
      selectedFrameContext
    } as const;

    try {
      let runId: string;
      if (runMode === "edit-selected" && selectedFrame && !imageAttachment) {
        const { variation: _ignoredVariation, ...editPayload } = payload;
        const run = await startEditRun(getApiBaseUrl(preferences.apiBaseUrl), selectedFrame.id, {
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
        selectedFrameId: selectedFrame?.id ?? null,
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
        if (target?.closest(".canvas-floating-controls")) {
          return false;
        }
        if (eventType === "wheel") {
          const wheelEvent = event as WheelEvent;
          return wheelEvent.ctrlKey || wheelEvent.metaKey;
        }
        if (target?.closest(".frame-card")) {
          return false;
        }
        if (eventType === "mousedown") {
          return event.button === 0;
        }
        return true;
      })
      .on("start", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        const sourceType = (event.sourceEvent as Event | undefined)?.type;
        if (sourceType === "mousedown" || sourceType === "touchstart") {
          setViewportPanning(true);
        }
      })
      .on("zoom", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
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
      damping: 0.78,
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
  }, [applyViewportTransform, loading]);

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
    focusViewportOnFrame(selectedFrame.id);
  }, [appendSystemEvent, focusViewportOnFrame, selectedFrame]);

  function zoomBy(factor: number) {
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

  async function selectFrame(frameId: string) {
    if (!bundleRef.current) {
      return;
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

    const selected = currentBundle.frames.find((frame) => frame.selected);
    if (!selected) {
      setRunMode("new-frame");
      return;
    }

    lastFocusedFrameIdRef.current = null;
    setRunMode("new-frame");
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
  }, [preferences.apiBaseUrl, pushDebugLog]);

  const frameLookup = useMemo(() => {
    if (!bundle) {
      return new Map<string, FrameVersion | undefined>();
    }
    return new Map(bundle.frames.map((frame) => [frame.id, frame.versions[frame.versions.length - 1]]));
  }, [bundle]);

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

      <ArtboardPane
        interactionType={isViewportPanning ? "pan" : interaction?.type ?? null}
        artboardBackgroundStyle={artboardBackgroundStyle}
        viewport={viewport}
        viewportRef={artboardViewportRef}
        frames={bundle?.frames ?? []}
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
    </div>
  );
}
