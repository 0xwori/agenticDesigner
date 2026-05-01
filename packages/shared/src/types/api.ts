import type { DeckSlideCount, DesignMode, DesignSystemMode, DevicePreset, ProviderId, SurfaceTarget } from "./core.js";
import type { FlowBoardMemoryState, FlowDocument, FlowMutationCommand, FlowStory, FrameKind, FlowSummary } from "./flow.js";
import type { FrameWithVersions } from "./frames.js";
import type { PipelineRun } from "./pipeline.js";
import type { ProjectDesignSystem } from "./designSystem.js";
import type { Project } from "./project.js";
import type { ReferenceSource } from "./references.js";

export interface ProjectBundle {
  project: Project;
  references: ReferenceSource[];
  frames: FrameWithVersions[];
  designSystem: ProjectDesignSystem | null;
  assets: ProjectAsset[];
}

export type ProjectAssetKind = "image" | "document";

export interface ProjectAsset {
  id: string;
  projectId: string;
  kind: ProjectAssetKind;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string | null;
  textContent?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ComposerAttachmentType = "image" | "figma-link" | "text";

export interface ComposerAttachment {
  id: string;
  type: ComposerAttachmentType;
  status?: "pending" | "uploaded" | "failed";
  url?: string;
  name?: string;
  mimeType?: string;
  dataUrl?: string;
  textContent?: string;
}

export interface SelectedBlockContext {
  frameId: string;
  versionId: string;
  blockId: string;
  label: string;
  selector: string;
  tagName: string;
  className: string;
  textSnippet: string;
  outerHtml: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SelectedFrameContext {
  frameId: string;
  name: string;
  devicePreset: DevicePreset;
  mode: DesignMode;
  size: {
    width: number;
    height: number;
  };
  latestVersionId: string | null;
  sourceType: string | null;
  sourceRole: string | null;
  sourceGroupId: string | null;
  frameKind?: FrameKind;
  flowSummary?: FlowSummary;
}

export interface GenerateRunInput {
  prompt: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  devicePreset: DevicePreset;
  mode: DesignMode;
  surfaceTarget?: SurfaceTarget;
  designSystemMode?: DesignSystemMode;
  variation?: number;
  tailwindEnabled?: boolean;
  attachments?: ComposerAttachment[];
  selectedFrameContext?: SelectedFrameContext;
  selectedBlockContext?: SelectedBlockContext;
  deckSlideCount?: DeckSlideCount;
}

export interface EditRunInput extends GenerateRunInput {
  frameId: string;
}

export interface FlowStoryRequest {
  prompt?: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
}

export interface FlowStoryResponse {
  ok: boolean;
  frameId: string;
  story: FlowStory;
  flowDocument: FlowDocument;
  summary: string;
}

export type FlowActionReviewSeverity = "modify" | "remove";

export interface FlowActionReviewCommand {
  command: FlowMutationCommand;
  summary: string;
  severity: FlowActionReviewSeverity;
}

export interface FlowActionResponse {
  ok: boolean;
  frameId: string;
  commands: FlowMutationCommand[];
  autoAppliedCommands: FlowMutationCommand[];
  reviewRequiredCommands: FlowActionReviewCommand[];
  flowDocument: FlowDocument;
  summary: string;
}

export interface ApplyFlowActionRequest {
  commands: FlowMutationCommand[];
}

export interface ApplyFlowActionResponse {
  ok: boolean;
  frameId: string;
  appliedCommands: FlowMutationCommand[];
  flowDocument: FlowDocument;
  summary: string;
}

export type FlowAgentMode = "review" | "auto-apply";

export type FlowAgentPhase =
  | "intake"
  | "read-memory"
  | "interpret"
  | "analyze"
  | "plan"
  | "validate"
  | "review-ready"
  | "apply"
  | "complete";

export type FlowBoardFindingSeverity = "info" | "warning" | "risk";

export interface FlowBoardFinding {
  id: string;
  severity: FlowBoardFindingSeverity;
  title: string;
  detail: string;
  relatedCellIds?: string[];
  relatedMemoryIds?: string[];
}

export interface FlowBoardPlan {
  summary: string;
  rationale: string;
  warnings: string[];
  findings: FlowBoardFinding[];
  commands: FlowMutationCommand[];
  updatedMemory: FlowBoardMemoryState;
}

export interface FlowAgentRunRequest {
  prompt: string;
  mode?: FlowAgentMode;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  attachments?: ComposerAttachment[];
  focusedAreaId?: string;
}

export interface FlowAgentRunResult {
  runId: string;
  mode: FlowAgentMode;
  phase: FlowAgentPhase;
}

export interface FlowAgentRunResponse {
  ok: boolean;
  frameId: string;
  run: FlowAgentRunResult;
}

export interface FlowAgentReviewResponse {
  ok: boolean;
  frameId: string;
  findings: FlowBoardFinding[];
  plan: FlowBoardPlan;
  flowDocument: FlowDocument;
}

export interface FlowAgentApplyRequest {
  runId?: string;
  commands?: FlowMutationCommand[];
  memory?: FlowBoardMemoryState;
}

export interface FlowAgentApplyResponse {
  ok: boolean;
  frameId: string;
  flowDocument: FlowDocument;
  appliedCommands: FlowMutationCommand[];
  summary: string;
  memory?: FlowBoardMemoryState;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export type { PipelineRun };
