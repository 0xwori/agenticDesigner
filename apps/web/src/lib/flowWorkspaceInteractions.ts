import type { FlowArtifact, FlowDocument, FlowHandleSide } from "@designer/shared";
import {
  FLOW_HANDLE_SIDES,
  getFlowSourceHandleId,
  getFlowTargetHandleId,
  normalizeFlowConnection,
} from "@designer/shared";

import {
  getFlowNodeHandlePosition,
  isValidFlowConnectionBetweenCells,
  type FlowBoardCellLayout,
} from "./flowAdapter";

const FLOW_WHEEL_LINE_PIXELS = 16;
const FLOW_WHEEL_ZOOM_SENSITIVITY = 0.0042;

export type FlowWheelGesture =
  | {
      kind: "zoom";
      factor: number;
    }
  | {
      kind: "pan";
      deltaX: number;
      deltaY: number;
    };

export interface FlowConnectionSnapTarget {
  cellId: string;
  side: FlowHandleSide;
  point: { x: number; y: number };
  distance: number;
}

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  if (deltaMode === 1) {
    return delta * FLOW_WHEEL_LINE_PIXELS;
  }
  if (deltaMode === 2) {
    return delta * Math.max(1, pageSize);
  }
  return delta;
}

function hasExactConnectionDuplicate(
  doc: FlowDocument,
  nextConnection: Pick<FlowDocument["connections"][number], "fromCellId" | "toCellId" | "sourceHandle" | "targetHandle">,
) {
  return doc.connections.some(
    (connection) =>
      connection.fromCellId === nextConnection.fromCellId &&
      connection.toCellId === nextConnection.toCellId &&
      connection.sourceHandle === nextConnection.sourceHandle &&
      connection.targetHandle === nextConnection.targetHandle,
  );
}

export function cloneFlowArtifact(artifact: FlowArtifact): FlowArtifact {
  switch (artifact.type) {
    case "design-frame-ref":
      return { ...artifact };
    case "uploaded-image":
      return { ...artifact };
    case "journey-step":
      return { ...artifact };
    case "technical-brief":
      return { ...artifact };
  }
}

export function resolveNearestConnectionSnapTarget(input: {
  doc: FlowDocument;
  sourceCellId: string;
  point: { x: number; y: number };
  cells: Array<Pick<FlowBoardCellLayout, "cellId" | "areaId" | "laneId" | "x" | "y" | "width" | "height">>;
  threshold: number;
}): FlowConnectionSnapTarget | null {
  const threshold = Math.max(0, input.threshold);
  let closest: FlowConnectionSnapTarget | null = null;

  for (const cell of input.cells) {
    if (cell.cellId === input.sourceCellId) {
      continue;
    }

    if (!isValidFlowConnectionBetweenCells(input.doc, input.sourceCellId, cell.cellId)) {
      continue;
    }

    const minX = cell.x - threshold;
    const maxX = cell.x + cell.width + threshold;
    const minY = cell.y - threshold;
    const maxY = cell.y + cell.height + threshold;
    if (input.point.x < minX || input.point.x > maxX || input.point.y < minY || input.point.y > maxY) {
      continue;
    }

    for (const side of FLOW_HANDLE_SIDES) {
      const handlePoint = getFlowNodeHandlePosition(cell, side);
      const distance = Math.hypot(handlePoint.x - input.point.x, handlePoint.y - input.point.y);
      if (distance > threshold) {
        continue;
      }

      if (!closest || distance < closest.distance) {
        closest = {
          cellId: cell.cellId,
          side,
          point: handlePoint,
          distance,
        };
      }
    }
  }

  return closest;
}

export function resolveFlowWheelGesture(input: {
  deltaX: number;
  deltaY: number;
  deltaZ?: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  viewportWidth: number;
  viewportHeight: number;
}): FlowWheelGesture {
  const normalizedDeltaX = normalizeWheelDelta(input.deltaX, input.deltaMode, input.viewportWidth);
  const normalizedDeltaY = normalizeWheelDelta(input.deltaY, input.deltaMode, input.viewportHeight);
  const normalizedDeltaZ = normalizeWheelDelta(input.deltaZ ?? 0, input.deltaMode, input.viewportHeight);
  const isZoomGesture = input.ctrlKey || input.metaKey || Math.abs(normalizedDeltaZ) > 0.01;

  if (isZoomGesture) {
    const zoomDelta = Math.abs(normalizedDeltaZ) > 0.01 ? normalizedDeltaZ : normalizedDeltaY;
    return {
      kind: "zoom",
      factor: Math.exp(-zoomDelta * FLOW_WHEEL_ZOOM_SENSITIVITY),
    };
  }

  if (input.shiftKey && Math.abs(normalizedDeltaX) < 0.5) {
    return {
      kind: "pan",
      deltaX: normalizedDeltaY,
      deltaY: 0,
    };
  }

  return {
    kind: "pan",
    deltaX: normalizedDeltaX,
    deltaY: normalizedDeltaY,
  };
}

export function appendConnectionToFlowDocument(
  doc: FlowDocument,
  input: {
    fromCellId: string;
    toCellId: string;
    sourceSide: FlowHandleSide;
    targetSide: FlowHandleSide;
    createId?: () => string;
  },
): FlowDocument {
  if (input.fromCellId === input.toCellId) {
    return doc;
  }

  if (!isValidFlowConnectionBetweenCells(doc, input.fromCellId, input.toCellId)) {
    return doc;
  }

  const normalized = normalizeFlowConnection(doc, {
    id: input.createId?.() ?? crypto.randomUUID(),
    fromCellId: input.fromCellId,
    toCellId: input.toCellId,
    sourceHandle: getFlowSourceHandleId(input.sourceSide),
    targetHandle: getFlowTargetHandleId(input.targetSide),
  });

  if (
    hasExactConnectionDuplicate(doc, {
      fromCellId: normalized.fromCellId,
      toCellId: normalized.toCellId,
      sourceHandle: normalized.sourceHandle,
      targetHandle: normalized.targetHandle,
    })
  ) {
    return doc;
  }

  return {
    ...doc,
    connections: [...doc.connections, normalized],
  };
}

export function removeConnectionFromFlowDocument(doc: FlowDocument, connectionId: string): FlowDocument {
  const nextConnections = doc.connections.filter((connection) => connection.id !== connectionId);
  if (nextConnections.length === doc.connections.length) {
    return doc;
  }

  return {
    ...doc,
    connections: nextConnections,
  };
}

export function shouldIgnoreFlowDeleteShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}