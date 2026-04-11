import {
  createEmptyFlowDocument,
  normalizeFlowDocument,
  type FlowDocument,
  type FrameWithVersions,
} from "@designer/shared";

import type { CanvasMode } from "../types/ui";

type FlowFrameLike = Pick<
  FrameWithVersions,
  "id" | "name" | "selected" | "frameKind" | "updatedAt" | "flowDocument"
>;

function getFrameUpdatedAtRank(frame: Pick<FlowFrameLike, "updatedAt">): number {
  const rank = Date.parse(frame.updatedAt);
  return Number.isFinite(rank) ? rank : 0;
}

function findFlowFrameById<T extends FlowFrameLike>(flowFrames: T[], frameId: string | null): T | null {
  if (typeof frameId !== "string" || frameId.trim().length === 0) {
    return null;
  }

  return flowFrames.find((frame) => frame.id === frameId.trim()) ?? null;
}

function comparePreferredCanonicalFrames<T extends FlowFrameLike>(left: T, right: T): number {
  if (left.selected !== right.selected) {
    return left.selected ? -1 : 1;
  }

  const updatedAtDelta = getFrameUpdatedAtRank(right) - getFrameUpdatedAtRank(left);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return left.id.localeCompare(right.id);
}

export function resolveCanonicalFlowFrame<T extends FlowFrameLike>(flowFrames: T[]): T | null {
  if (flowFrames.length === 0) {
    return null;
  }

  return [...flowFrames].sort(comparePreferredCanonicalFrames)[0] ?? null;
}

export function ensureCanonicalFlowDocument<T extends FlowFrameLike>(
  canonicalFrame: T,
  _flowFrames: T[],
): { flowDocument: FlowDocument; changed: boolean; importedFrameIds: string[] } {
  const startingDoc = canonicalFrame.flowDocument ?? createEmptyFlowDocument();
  const normalizedNextDoc = normalizeFlowDocument(startingDoc);
  return {
    flowDocument: normalizedNextDoc,
    changed: JSON.stringify(startingDoc) !== JSON.stringify(normalizedNextDoc),
    importedFrameIds: [],
  };
}

export function resolveFlowModeTarget<T extends FlowFrameLike>(
  flowFrames: T[],
  lastFlowFrameId: string | null,
): { selectedFlowFrameId: string | null; shouldCreateFlowBoard: boolean } {
  if (flowFrames.length === 0) {
    return {
      selectedFlowFrameId: null,
      shouldCreateFlowBoard: true,
    };
  }

  const target = findFlowFrameById(flowFrames, lastFlowFrameId) ?? resolveCanonicalFlowFrame(flowFrames);

  return {
    selectedFlowFrameId: target?.id ?? null,
    shouldCreateFlowBoard: false,
  };
}

export function resolveActiveFlowFrame<T extends FlowFrameLike>(
  flowFrames: T[],
  selectedFrameId: string | null,
  lastFlowFrameId: string | null,
): T | null {
  return (
    findFlowFrameById(flowFrames, selectedFrameId) ??
    findFlowFrameById(flowFrames, lastFlowFrameId) ??
    resolveCanonicalFlowFrame(flowFrames)
  );
}

export function shouldUseFlowActionRoute(input: {
  canvasMode: CanvasMode;
  flowFrameId: string | null;
  prompt: string;
  figmaUrl?: string | null;
}) {
  return (
    input.canvasMode === "flow" &&
    typeof input.flowFrameId === "string" &&
    input.flowFrameId.length > 0 &&
    input.prompt.trim().length > 0 &&
    !input.figmaUrl
  );
}
