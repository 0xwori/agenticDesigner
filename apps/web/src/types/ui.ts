import type { DesignMode, DevicePreset, PipelineEvent, ProviderId, ProjectBundle } from "@designer/shared";

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
