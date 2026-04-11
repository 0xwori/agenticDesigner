import type { DesignMode, DesignSystemMode, DevicePreset, ProviderId, SurfaceTarget } from "./core.js";
import type { FrameKind, FlowSummary } from "./flow.js";
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
}

export type ComposerAttachmentType = "image" | "figma-link";

export interface ComposerAttachment {
  id: string;
  type: ComposerAttachmentType;
  status?: "pending" | "uploaded" | "failed";
  url?: string;
  name?: string;
  mimeType?: string;
  dataUrl?: string;
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
}

export interface EditRunInput extends GenerateRunInput {
  frameId: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export type { PipelineRun };
