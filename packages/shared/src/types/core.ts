export type ProviderId = "openai" | "anthropic" | "google";
export type DesignMode = "wireframe" | "high-fidelity";
export type DevicePreset = "desktop" | "iphone" | "iphone-15" | "iphone-15-pro" | "iphone-15-pro-max";
export type DesignSystemMode = "strict" | "creative";
export type SurfaceTarget = "web" | "mobile" | "deck";
export type DeckSlideCount = 5 | 10 | 25;

export function isMobilePreset(device: DevicePreset): boolean {
  return device !== "desktop";
}

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type PipelineStage = "system" | "enhance" | "plan" | "generate" | "repair" | "diff-repair";
export type EventStatus = "info" | "success" | "error";
export type EventKind = "status" | "summary" | "action";

export type SyncStatus = "syncing" | "synced" | "failed";
export type ReferenceScope = "frame" | "page";
export type DesignSystemStatus = "draft" | "approved" | "needs-edits";
export type PromptIntentType = "screen-action" | "question" | "design-system" | "flow-action";
export type AgentRole =
  | "orchestrator"
  | "web-designer"
  | "app-designer"
  | "deck-designer"
  | "design-system-designer"
  | "design-system-figma-researcher";
