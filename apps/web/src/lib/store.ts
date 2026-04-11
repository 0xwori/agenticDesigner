/**
 * Minimal store following Claude Code's createStore pattern.
 * Provides getState / setState / subscribe with React useSyncExternalStore integration.
 */

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type {
  AppInputState,
  AppProjectState,
  AppRunState,
  AppState,
  AppUIState,
} from "../types/ui";

// ---------------------------------------------------------------------------
// Generic store engine (20-line core, Claude Code pattern)
// ---------------------------------------------------------------------------

type Listener = () => void;
type OnChange<T> = (info: { newState: T; oldState: T }) => void;

export type Store<T> = {
  getState: () => T;
  setState: (updater: (prev: T) => T) => void;
  subscribe: (listener: Listener) => () => void;
};

export function createStore<T>(initialState: T, onChange?: OnChange<T>): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState: (updater) => {
      const prev = state;
      const next = updater(prev);
      if (Object.is(next, prev)) return;
      state = next;
      onChange?.({ newState: next, oldState: prev });
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------
// React context
// ---------------------------------------------------------------------------

const AppStoreContext = createContext<Store<AppState> | null>(null);

export { AppStoreContext };

function useAppStore(): Store<AppState> {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error("useAppStore must be used inside AppStoreContext.Provider");
  }
  return store;
}

/** Select a slice of AppState. Re-renders only when the selected value changes (Object.is). */
export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useAppStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  );
}

/** Returns the raw setState function for mutations from event handlers / effects. */
export function useSetAppState(): Store<AppState>["setState"] {
  return useAppStore().setState;
}

// ---------------------------------------------------------------------------
// Group-level setters (typed, functional-update-aware)
// ---------------------------------------------------------------------------

type Setter<S, K extends keyof S> = (
  value: S[K] | ((prev: S[K]) => S[K])
) => void;

function makeGroupSetter<G extends keyof AppState>(
  setState: Store<AppState>["setState"],
  group: G
) {
  return function setField<K extends keyof AppState[G]>(
    key: K,
    value: AppState[G][K] | ((prev: AppState[G][K]) => AppState[G][K])
  ): void {
    setState((s) => ({
      ...s,
      [group]: {
        ...s[group],
        [key]:
          typeof value === "function"
            ? (value as (prev: AppState[G][K]) => AppState[G][K])(s[group][key])
            : value,
      },
    }));
  };
}

// ---------------------------------------------------------------------------
// Per-group hooks — return [value, setter] tuples matching useState interface
// ---------------------------------------------------------------------------

export function useRunState() {
  const state = useAppState((s) => s.run);
  const setState = useSetAppState();

  const setters = useMemo(() => {
    const set = makeGroupSetter(setState, "run");
    return {
      setChatEvents: ((v) => set("chatEvents", v)) as Setter<AppRunState, "chatEvents">,
      setPromptHistory: ((v) => set("promptHistory", v)) as Setter<AppRunState, "promptHistory">,
      setCopyStates: ((v) => set("copyStates", v)) as Setter<AppRunState, "copyStates">,
      setDebugLogs: ((v) => set("debugLogs", v)) as Setter<AppRunState, "debugLogs">,
      setIsCopyingLogs: ((v) => set("isCopyingLogs", v)) as Setter<AppRunState, "isCopyingLogs">,
      setCaptureFrameId: ((v) => set("captureFrameId", v)) as Setter<AppRunState, "captureFrameId">,
    };
  }, [setState]);

  return {
    chatEvents: state.chatEvents,
    promptHistory: state.promptHistory,
    copyStates: state.copyStates,
    debugLogs: state.debugLogs,
    isCopyingLogs: state.isCopyingLogs,
    captureFrameId: state.captureFrameId,
    ...setters,
  };
}

export function useProjectState() {
  const state = useAppState((s) => s.project);
  const setState = useSetAppState();

  const setters = useMemo(() => {
    const set = makeGroupSetter(setState, "project");
    return {
      setBundle: ((v) => set("bundle", v)) as Setter<AppProjectState, "bundle">,
      setLoading: ((v) => set("loading", v)) as Setter<AppProjectState, "loading">,
      setError: ((v) => set("error", v)) as Setter<AppProjectState, "error">,
    };
  }, [setState]);

  return {
    bundle: state.bundle,
    loading: state.loading,
    error: state.error,
    ...setters,
  };
}

export function useInputState() {
  const state = useAppState((s) => s.input);
  const setState = useSetAppState();

  const setters = useMemo(() => {
    const set = makeGroupSetter(setState, "input");
    return {
      setComposerPrompt: ((v) => set("composerPrompt", v)) as Setter<AppInputState, "composerPrompt">,
      setComposerAttachments: ((v) => set("composerAttachments", v)) as Setter<AppInputState, "composerAttachments">,
      setRunMode: ((v) => set("runMode", v)) as Setter<AppInputState, "runMode">,
      setSelectedDevice: ((v) => set("selectedDevice", v)) as Setter<AppInputState, "selectedDevice">,
      setSelectedMode: ((v) => set("selectedMode", v)) as Setter<AppInputState, "selectedMode">,
      setSelectedDesignSystemMode: ((v) => set("selectedDesignSystemMode", v)) as Setter<AppInputState, "selectedDesignSystemMode">,
      setSelectedSurfaceTarget: ((v) => set("selectedSurfaceTarget", v)) as Setter<AppInputState, "selectedSurfaceTarget">,
      setVariation: ((v) => set("variation", v)) as Setter<AppInputState, "variation">,
      setTailwindOverride: ((v) => set("tailwindOverride", v)) as Setter<AppInputState, "tailwindOverride">,
    };
  }, [setState]);

  return {
    composerPrompt: state.composerPrompt,
    composerAttachments: state.composerAttachments,
    runMode: state.runMode,
    selectedDevice: state.selectedDevice,
    selectedMode: state.selectedMode,
    selectedDesignSystemMode: state.selectedDesignSystemMode,
    selectedSurfaceTarget: state.selectedSurfaceTarget,
    variation: state.variation,
    tailwindOverride: state.tailwindOverride,
    ...setters,
  };
}

export function useUIState() {
  const state = useAppState((s) => s.ui);
  const setState = useSetAppState();

  const setters = useMemo(() => {
    const set = makeGroupSetter(setState, "ui");
    return {
      setPreferences: ((v) => set("preferences", v)) as Setter<AppUIState, "preferences">,
      setInteraction: ((v) => set("interaction", v)) as Setter<AppUIState, "interaction">,
      setViewportPanning: ((v) => set("isViewportPanning", v)) as Setter<AppUIState, "isViewportPanning">,
      setViewport: ((v) => set("viewport", v)) as Setter<AppUIState, "viewport">,
      setExpandedHistoryFrameId: ((v) => set("expandedHistoryFrameId", v)) as Setter<AppUIState, "expandedHistoryFrameId">,
      setWorkspaceSettingsOpen: ((v) => set("isWorkspaceSettingsOpen", v)) as Setter<AppUIState, "isWorkspaceSettingsOpen">,
      setProjectDesignSystemOpen: ((v) => set("isProjectDesignSystemOpen", v)) as Setter<AppUIState, "isProjectDesignSystemOpen">,
      setDesignSystemWarnings: ((v) => set("designSystemWarnings", v)) as Setter<AppUIState, "designSystemWarnings">,
      setDesignSystemBusy: ((v) => set("designSystemBusy", v)) as Setter<AppUIState, "designSystemBusy">,
      setDesignSystemBusyLabel: ((v) => set("designSystemBusyLabel", v)) as Setter<AppUIState, "designSystemBusyLabel">,
      setDesignSystemRegeneratingReferenceId: ((v) => set("designSystemRegeneratingReferenceId", v)) as Setter<AppUIState, "designSystemRegeneratingReferenceId">,
      setPendingFigmaAttachUrl: ((v) => set("pendingFigmaAttachUrl", v)) as Setter<AppUIState, "pendingFigmaAttachUrl">,
      setFrameInteractionUnlocked: ((v) => set("isFrameInteractionUnlocked", v)) as Setter<AppUIState, "isFrameInteractionUnlocked">,
      setPendingCanvasCards: ((v) => set("pendingCanvasCards", v)) as Setter<AppUIState, "pendingCanvasCards">,
      setBrandPickerOpen: ((v) => set("isBrandPickerOpen", v)) as Setter<AppUIState, "isBrandPickerOpen">,
      setActiveBrandName: ((v) => set("activeBrandName", v)) as Setter<AppUIState, "activeBrandName">,
      setCanvasMode: ((v) => set("canvasMode", v)) as Setter<AppUIState, "canvasMode">,
      setLastFlowFrameId: ((v) => set("lastFlowFrameId", v)) as Setter<AppUIState, "lastFlowFrameId">,
    };
  }, [setState]);

  return {
    preferences: state.preferences,
    interaction: state.interaction,
    isViewportPanning: state.isViewportPanning,
    viewport: state.viewport,
    expandedHistoryFrameId: state.expandedHistoryFrameId,
    isWorkspaceSettingsOpen: state.isWorkspaceSettingsOpen,
    isProjectDesignSystemOpen: state.isProjectDesignSystemOpen,
    isBrandPickerOpen: state.isBrandPickerOpen,
    activeBrandName: state.activeBrandName,
    designSystemWarnings: state.designSystemWarnings,
    designSystemBusy: state.designSystemBusy,
    designSystemBusyLabel: state.designSystemBusyLabel,
    designSystemRegeneratingReferenceId: state.designSystemRegeneratingReferenceId,
    pendingFigmaAttachUrl: state.pendingFigmaAttachUrl,
    isFrameInteractionUnlocked: state.isFrameInteractionUnlocked,
    pendingCanvasCards: state.pendingCanvasCards,
    canvasMode: state.canvasMode,
    lastFlowFrameId: state.lastFlowFrameId,
    ...setters,
  };
}
