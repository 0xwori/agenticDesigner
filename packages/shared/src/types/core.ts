export type ProviderId = "openai" | "anthropic" | "google";
export type DesignMode = "wireframe" | "high-fidelity";
export type DevicePreset = "desktop" | "iphone";
export type DesignSystemMode = "strict" | "creative";
export type SurfaceTarget = "web" | "mobile";

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type PipelineStage = "system" | "enhance" | "plan" | "generate" | "repair" | "diff-repair";
export type EventStatus = "info" | "success" | "error";
export type EventKind = "status" | "summary" | "action";

export type SyncStatus = "syncing" | "synced" | "failed";
export type ReferenceScope = "frame" | "page";
export type DesignSystemStatus = "draft" | "approved" | "needs-edits";
export type PromptIntentType = "screen-action" | "question" | "design-system";
export type AgentRole =
  | "orchestrator"
  | "web-designer"
  | "app-designer"
  | "design-system-designer"
  | "design-system-figma-researcher";
