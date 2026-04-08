import type {
  AgentRole,
  DesignSystemMode,
  EventKind,
  EventStatus,
  PipelineStage,
  ProviderId,
  ReferenceScope,
  RunStatus,
  SurfaceTarget
} from "./core.js";

export interface SelectedFrameContextPayload {
  frameId: string;
  name: string;
  devicePreset: "desktop" | "iphone";
  mode: "wireframe" | "high-fidelity";
  size: {
    width: number;
    height: number;
  };
  latestVersionId: string | null;
  sourceType: string | null;
  sourceRole: string | null;
  sourceGroupId: string | null;
}

export interface PipelineEventPayload {
  agent?: AgentRole;
  step?: string;
  target?: string;
  artifact?: string;
  attempt?: number | null;
  statusDetail?: string;
  nextStep?: string | null;
  assumptions?: string[] | null;
  fidelityScore?: number | null;
  referenceQuality?: "good" | "medium" | "poor";
  detectionCoverage?: {
    colorsDetected: number;
    componentFamiliesDetected: number;
  };
  qualityReasons?: string[] | null;
  reason?: string;
  error?: string;
  frameId?: string;
  versionId?: string;
  previousVersionId?: string | null;
  linkedFrameId?: string;
  sourceGroupId?: string;
  provider?: ProviderId;
  model?: string;
  variationCount?: number;
  designSystemMode?: DesignSystemMode;
  surfaceTarget?: SurfaceTarget;
  selectedFrameContext?: SelectedFrameContextPayload | null;
  shouldTakeAction?: boolean;
  designSystemAction?: "none" | "approve" | "iterate";
  referenceId?: string;
  fileKey?: string;
  scope?: ReferenceScope;
  sectionCount?: number;
  frameName?: string;
  strategy?: string;
  usedProvider?: ProviderId | string;
  family?: string;
  confidence?: number | null;
  mismatch?: string[] | null;
  nextAction?: string | null;
  [key: string]: unknown;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  frameId: string | null;
  prompt: string;
  status: RunStatus;
  provider: ProviderId;
  model: string;
  passStatusMap: Record<string, RunStatus | "idle">;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PipelineEvent {
  id?: number;
  runId: string;
  timestamp: string;
  stage: PipelineStage;
  status: EventStatus;
  kind: EventKind;
  message: string;
  payload?: PipelineEventPayload;
}

export const PIPELINE_STAGES: PipelineStage[] = ["enhance", "plan", "generate", "repair", "diff-repair"];
