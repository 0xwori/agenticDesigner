import { useCallback, useEffect, useRef } from "react";
import type { PipelineEvent, ProjectBundle } from "@designer/shared";
import {
  checkApiHealth,
  createProject,
  getApiBaseUrl,
  getProjectBundle,
  openRunStream
} from "../api";
import { annotateClientOrder } from "../lib/eventOrdering";
import { extractFrameSourceMeta } from "../lib/frameLinking";
import {
  createLocalRunId,
  loadPreferences,
  PROJECT_STORAGE_KEY
} from "../lib/appHelpers";
import { useProjectState, useRunState, useInputState, useUIState } from "../lib/store";
import type { DebugLogEntry, DebugLogLevel, LocalPreferences } from "../types/ui";

type AppendChatEventInput = {
  runId: string;
  stage: PipelineEvent["stage"];
  status: PipelineEvent["status"];
  kind: PipelineEvent["kind"];
  message: string;
  payload?: Record<string, unknown>;
};

type AppendSystemEventInput = {
  status: PipelineEvent["status"];
  message: string;
  kind?: PipelineEvent["kind"];
  payload?: Record<string, unknown>;
  stage?: PipelineEvent["stage"];
};

export type RunStreamHandle = { close(): void; readyState: number };

export type PipelineEventsApi = {
  pushDebugLog: (scope: string, reason: unknown, details?: Record<string, unknown>, level?: DebugLogLevel) => void;
  appendOrderedEvent: (event: PipelineEvent) => void;
  appendPromptTurn: (input: { runId: string; prompt: string }) => void;
  appendChatEvent: (input: AppendChatEventInput) => void;
  appendSystemEvent: (input: AppendSystemEventInput) => void;
  resolveRunCompletion: (runId: string, success: boolean) => void;
  waitForRunCompletion: (runId: string, timeoutMs?: number) => Promise<boolean>;
  scheduleRefresh: (delayMs?: number) => void;
  openRunSocket: (runId: string) => void;
  initializeProject: () => Promise<void>;
  revealDesignSystemRunsRef: React.MutableRefObject<Set<string>>;
  runSockets: React.MutableRefObject<Map<string, RunStreamHandle>>;
  eventOrderRef: React.MutableRefObject<number>;
};

export function usePipelineEvents(
  openProjectDesignSystemRef: React.MutableRefObject<() => Promise<void>>
): PipelineEventsApi {
  const { setChatEvents, setPromptHistory, setDebugLogs } = useRunState();
  const { setBundle, setLoading, setError } = useProjectState();
  const {
    runMode, selectedDevice, selectedMode,
    setSelectedDevice, setSelectedMode, setSelectedDesignSystemMode,
    setSelectedSurfaceTarget, setTailwindOverride
  } = useInputState();
  const { setPreferences, preferences, setPendingCanvasCards } = useUIState();

  const runSockets = useRef<Map<string, RunStreamHandle>>(new Map());
  const runCompletionResolversRef = useRef<Map<string, { resolve: (success: boolean) => void; timeoutId: number }>>(new Map());
  const revealDesignSystemRunsRef = useRef<Set<string>>(new Set());
  const pendingRefresh = useRef<number | null>(null);

  // Keep a stable ref to projectId and apiBaseUrl without re-subscribing hooks
  const projectIdRef = useRef<string | null>(null);
  const apiBaseUrlRef = useRef<string>(preferences.apiBaseUrl);

  // Update refs when state changes (without making them hook deps)
  useEffect(() => { apiBaseUrlRef.current = preferences.apiBaseUrl; }, [preferences.apiBaseUrl]);

  const eventOrderRef = useRef(0);

  // -------------------------------------------------------------------------
  // pushDebugLog
  // -------------------------------------------------------------------------
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
        } satisfies DebugLogEntry
      ].slice(-400));
    },
    [setDebugLogs]
  );

  // -------------------------------------------------------------------------
  // appendOrderedEvent
  // -------------------------------------------------------------------------
  const appendOrderedEvent = useCallback((event: PipelineEvent) => {
    eventOrderRef.current += 1;
    const orderedEvent = annotateClientOrder(event, eventOrderRef.current);
    setChatEvents((current) => [...current, orderedEvent].slice(-420));
  }, [setChatEvents]);

  // -------------------------------------------------------------------------
  // appendPromptTurn
  // -------------------------------------------------------------------------
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
    [runMode, selectedDevice, selectedMode, setPromptHistory]
  );

  // -------------------------------------------------------------------------
  // appendChatEvent / appendSystemEvent
  // -------------------------------------------------------------------------
  const appendChatEvent = useCallback(
    (input: AppendChatEventInput) => {
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
    (input: AppendSystemEventInput) => {
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

  // -------------------------------------------------------------------------
  // Run completion promises
  // -------------------------------------------------------------------------
  const resolveRunCompletion = useCallback((runId: string, success: boolean) => {
    const entry = runCompletionResolversRef.current.get(runId);
    if (!entry) return;
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
        runCompletionResolversRef.current.set(runId, { resolve, timeoutId });
      }),
    []
  );

  // -------------------------------------------------------------------------
  // scheduleRefresh
  // -------------------------------------------------------------------------
  const scheduleRefresh = useCallback(
    (delayMs = 420) => {
      if (pendingRefresh.current) {
        window.clearTimeout(pendingRefresh.current);
      }
      pendingRefresh.current = window.setTimeout(async () => {
        const projectId = projectIdRef.current;
        if (!projectId) return;
        const apiBase = getApiBaseUrl(apiBaseUrlRef.current);
        try {
          const data = await getProjectBundle(apiBase, projectId);
          setBundle(data);
          setPendingCanvasCards((current) =>
            current.filter((pending) => {
              const hasMaterializedFrame = data.frames.some((frame) => {
                const meta = extractFrameSourceMeta(frame);
                if (!meta) return false;
                if (meta.sourceType !== pending.sourceType || meta.sourceRole !== pending.sourceRole) return false;
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
    [pushDebugLog, setBundle, setPendingCanvasCards]
  );

  // -------------------------------------------------------------------------
  // openRunSocket
  // -------------------------------------------------------------------------
  const openRunSocket = useCallback(
    (runId: string) => {
      const socket = openRunStream(getApiBaseUrl(apiBaseUrlRef.current), runId, {
        onEvent: (event) => {
          appendOrderedEvent(event);
          const step = typeof event.payload?.step === "string" ? event.payload.step : null;

          // Phase 2.1: Optimistic frame update from inline content (avoids HTTP refresh latency)
          if (step === "diff-repair-complete" && event.payload?.frameId && event.payload?.frameContent) {
            const fc = event.payload.frameContent as { sourceCode: string; cssCode: string; exportHtml: string; tailwindEnabled: boolean };
            const fid = event.payload.frameId as string;
            const vid = (event.payload.versionId as string) ?? `inline-${Date.now()}`;
            setBundle((current) => {
              if (!current) return current;
              return {
                ...current,
                frames: current.frames.map((f) => {
                  if (f.id !== fid) return f;
                  const inlineVersion = {
                    id: vid,
                    frameId: fid,
                    sourceCode: fc.sourceCode,
                    cssCode: fc.cssCode,
                    exportHtml: fc.exportHtml,
                    tailwindEnabled: fc.tailwindEnabled,
                    passOutputs: {} as Record<string, unknown>,
                    diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 },
                    createdAt: new Date().toISOString()
                  };
                  return {
                    ...f,
                    status: "ready" as const,
                    versions: [...f.versions, inlineVersion]
                  };
                })
              };
            });
          }

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
            window.setTimeout(() => { void openProjectDesignSystemRef.current(); }, 420);
          }
          if (event.payload?.frameId || event.status === "success" || event.status === "error") {
            // Shorter debounce when we already have inline content (edit runs)
            const delay = event.payload?.frameContent ? 100 : 320;
            scheduleRefresh(delay);
          }
        },
        onClose: () => {
          runSockets.current.delete(runId);
          resolveRunCompletion(runId, false);
          pushDebugLog("run-stream", "WebSocket stream closed", { runId }, "debug");
          scheduleRefresh(520);
        },
        onError: (event) => {
          pushDebugLog("run-stream", "WebSocket stream error", { runId, type: event.type }, "warn");
          setError("Live run stream disconnected. Open logs for details.");
        }
      });
      runSockets.current.set(runId, socket);
    },
    [appendOrderedEvent, pushDebugLog, resolveRunCompletion, scheduleRefresh, setPendingCanvasCards, setError, openProjectDesignSystemRef]
  );

  // -------------------------------------------------------------------------
  // initializeProject
  // -------------------------------------------------------------------------
  const initializeProject = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const apiBase = getApiBaseUrl(apiBaseUrlRef.current);
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
      projectIdRef.current = data.project.id;
      setBundle(data);
      setPendingCanvasCards([]);
      revealDesignSystemRunsRef.current.clear();
      setSelectedDevice(data.project.settings.deviceDefault);
      setSelectedMode(data.project.settings.modeDefault);
      setSelectedDesignSystemMode(data.project.settings.designSystemModeDefault);
      setSelectedSurfaceTarget(data.project.settings.surfaceDefault);
      setTailwindOverride(data.project.settings.tailwindDefault);
      setPreferences((current: LocalPreferences) => ({
        ...current,
        provider: data!.project.settings.provider,
        model: data!.project.settings.model,
        tailwindDefault: data!.project.settings.tailwindDefault,
        deviceDefault: data!.project.settings.deviceDefault,
        modeDefault: data!.project.settings.modeDefault
      }));
      pushDebugLog("initialize-project", "Workspace initialized", { projectId: data.project.id, frameCount: data.frames.length }, "info");
    } catch (reason) {
      pushDebugLog("initialize-project", reason, { apiBaseUrl: apiBaseUrlRef.current }, "error");
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [pushDebugLog, setBundle, setLoading, setError, setPendingCanvasCards, setSelectedDevice, setSelectedMode, setSelectedDesignSystemMode, setSelectedSurfaceTarget, setTailwindOverride, setPreferences]);

  // -------------------------------------------------------------------------
  // Sync projectId ref whenever bundle changes
  // -------------------------------------------------------------------------
  // This is done externally in AppContent since bundle comes from the store

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      for (const socket of runSockets.current.values()) socket.close();
      for (const resolver of runCompletionResolversRef.current.values()) {
        window.clearTimeout(resolver.timeoutId);
        resolver.resolve(false);
      }
      runCompletionResolversRef.current.clear();
    };
  }, []);

  return {
    pushDebugLog,
    appendOrderedEvent,
    appendPromptTurn,
    appendChatEvent,
    appendSystemEvent,
    resolveRunCompletion,
    waitForRunCompletion,
    scheduleRefresh,
    openRunSocket,
    initializeProject,
    revealDesignSystemRunsRef,
    runSockets,
    eventOrderRef
  };
}
