import type { CaptureLogEntry } from "../lib/figmaCapture";
import type { ComposerAttachment, DesignMode, DesignSystemMode, DevicePreset, FrameKind, PipelineEvent, ProviderId, ProjectBundle, SurfaceTarget } from "@designer/shared";

export type CanvasMode = "design" | "flow";
export type RunMode = "new-frame" | "edit-selected";
export type CopyState = "idle" | "capturing" | "copied" | "failed";

export type LocalPreferences = {
  apiBaseUrl: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  figmaClientId: string;
  figmaClientSecret: string;
  tailwindDefault: boolean;
  deviceDefault: DevicePreset;
  modeDefault: DesignMode;
};

export type PromptEntry = {
  runId: string;
  prompt: string;
  submittedAt: string;
  mode: RunMode;
  devicePreset: DevicePreset;
  designMode: DesignMode;
};

export type DebugLogLevel = "debug" | "info" | "warn" | "error";

export type DebugLogEntry = {
  id: string;
  timestamp: string;
  scope: string;
  level: DebugLogLevel;
  message: string;
  details?: string;
};

export type BundledContext = ProjectBundle | null;

export type GroupedRunEvents = Map<string, PipelineEvent[]>;

export type CopyStateEntry = {
  state: CopyState;
  logs: CaptureLogEntry[];
};

export type CopyStateMap = Record<string, CopyStateEntry>;

export type InteractionState =
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

export type PendingCanvasCard = {
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

export type ViewportState = { x: number; y: number; scale: number };

export type AppRunState = {
  chatEvents: PipelineEvent[];
  promptHistory: PromptEntry[];
  copyStates: CopyStateMap;
  debugLogs: DebugLogEntry[];
  isCopyingLogs: boolean;
  captureFrameId: string | null;
};

export type AppProjectState = {
  bundle: ProjectBundle | null;
  loading: boolean;
  error: string;
};

export type AppInputState = {
  composerPrompt: string;
  composerAttachments: ComposerAttachment[];
  runMode: RunMode;
  selectedDevice: DevicePreset;
  selectedMode: DesignMode;
  selectedDesignSystemMode: DesignSystemMode;
  selectedSurfaceTarget: SurfaceTarget;
  variation: number;
  tailwindOverride: boolean;
};

export type AppUIState = {
  preferences: LocalPreferences;
  interaction: InteractionState | null;
  isViewportPanning: boolean;
  viewport: ViewportState;
  expandedHistoryFrameId: string | null;
  isWorkspaceSettingsOpen: boolean;
  isProjectDesignSystemOpen: boolean;
  isBrandPickerOpen: boolean;
  activeBrandName: string | null;
  designSystemWarnings: string[];
  designSystemBusy: boolean;
  designSystemBusyLabel: string | null;
  designSystemRegeneratingReferenceId: string | null;
  pendingFigmaAttachUrl: string | null;
  isFrameInteractionUnlocked: boolean;
  pendingCanvasCards: PendingCanvasCard[];
  canvasMode: CanvasMode;
  lastFlowFrameId: string | null;
};

export type AppState = {
  run: AppRunState;
  project: AppProjectState;
  input: AppInputState;
  ui: AppUIState;
};
