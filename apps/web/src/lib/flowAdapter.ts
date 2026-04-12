import type {
  FlowArtifact,
  FlowCell,
  FlowConnection,
  FlowDocument,
  FlowHandleSide,
  FlowLaneId,
  FrameWithVersions,
} from "@designer/shared";
import {
  FLOW_AREA_MIN_COLUMNS,
  FLOW_LANE_LABELS,
  FLOW_LANE_ORDER,
  isMobilePreset,
  getFlowAreaColumnSpan,
  getFlowAreas,
  getFlowCellAreaId,
  getFlowGlobalColumn,
  getFlowHandleSideFromId,
  isFlowConnectionAllowedBetweenCells,
  normalizeFlowConnection,
} from "@designer/shared";

export const LANE_LABEL_WIDTH = 96;
export const NODE_WIDTH = 240;
export const NODE_GAP = 32;
export const NODE_PADDING_LEFT = 10;
export const MIN_VISIBLE_COLUMNS = FLOW_AREA_MIN_COLUMNS;
export const MIN_FLOW_LANE_HEIGHT = 180;
export const FLOW_LANE_VERTICAL_PADDING = 24;
export const FLOW_BODY_MIN_HEIGHT = 640;
export const FLOW_BODY_MAX_HEIGHT = 960;
export const FLOW_BOARD_PADDING_X = 24;
export const FLOW_AREA_FRAME_PADDING_X = 18;
export const FLOW_AREA_GAP = 56;

const FLOW_LANE_EDGE_STYLES: Record<FlowLaneId, { stroke: string; glow: string }> = {
  "user-journey": {
    stroke: "rgba(92, 98, 239, 0.94)",
    glow: "rgba(92, 98, 239, 0.2)",
  },
  "normal-flow": {
    stroke: "rgba(15, 156, 95, 0.94)",
    glow: "rgba(15, 156, 95, 0.2)",
  },
  "unhappy-path": {
    stroke: "rgba(234, 120, 36, 0.96)",
    glow: "rgba(234, 120, 36, 0.22)",
  },
  "technical-briefing": {
    stroke: "rgba(22, 132, 204, 0.94)",
    glow: "rgba(22, 132, 204, 0.2)",
  },
};

type MeasuredNodeHeights = Map<string, number> | Record<string, number | undefined> | undefined;

export interface FlowBoardCellLayout {
  cellId: string;
  areaId: string;
  laneId: FlowLaneId;
  column: number;
  globalColumn: number;
  artifact: FlowArtifact;
  refFrame?: FrameWithVersions;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowBoardEdgeLayout {
  id: string;
  fromCellId: string;
  toCellId: string;
  sourceHandle?: string;
  targetHandle?: string;
  sourceHandleSide: FlowHandleSide;
  targetHandleSide: FlowHandleSide;
  laneId: FlowLaneId;
  targetLaneId?: FlowLaneId;
  isCrossLane: boolean;
  strokeColor: string;
  glowColor: string;
}

export interface FlowBoardLayout {
  cells: FlowBoardCellLayout[];
  edges: FlowBoardEdgeLayout[];
  metrics: FlowLayoutMetrics;
  chromeAreas: FlowAreaChrome[];
}

export interface FlowLayoutOptions {
  frameWidth: number;
  frameHeight: number;
  headerHeight: number;
  layoutScale?: number;
  maxVisibleBodyHeight?: number;
  measuredNodeHeights?: MeasuredNodeHeights;
  extraAreaColumns?: Record<string, number | undefined>;
  allDesignFrames: FrameWithVersions[];
  onRemove?: (cellId: string) => void;
  onUpdateArtifact?: (cellId: string, artifact: FlowArtifact) => void;
  onStartEdit?: (cellId: string) => void;
  onFinishEdit?: () => void;
  onDeleteEdge?: (edgeId: string) => void;
  onMeasureNode?: (cellId: string, height: number) => void;
  editingCellId?: string | null;
}

export interface FlowLayoutMetrics {
  frameWidth: number;
  frameHeight: number;
  headerHeight: number;
  layoutScale: number;
  availableHeight: number;
  availableWidth: number;
  visibleBodyHeight: number;
  maxVisibleBodyHeight: number;
  contentHeight: number;
  contentWidth: number;
  laneHeights: number[];
  laneTops: number[];
  columnCount: number;
  labelWidth: number;
  nodeGap: number;
  nodePaddingLeft: number;
  boardPaddingX: number;
  areaGap: number;
  laneInnerPadding: number;
  nodeWidth: number;
  slotStep: number;
  nodeMinX: number;
  nodeMaxX: number;
  areas: Array<{
    id: string;
    name: string;
    columnOffset: number;
    startColumn: number;
    endColumn: number;
    localColumnCount: number;
    left: number;
    slotLeft: number;
    slotWidth: number;
    width: number;
  }>;
}

export interface FlowGridSlot {
  areaId: string;
  laneId: FlowLaneId;
  column: number;
}

export interface FlowLaneChrome {
  areaId: string;
  laneId: FlowLaneId;
  label: string;
  top: number;
  height: number;
  isFirstLane: boolean;
  isLastLane: boolean;
}

export interface FlowAreaChrome {
  id: string;
  name: string;
  left: number;
  width: number;
  height: number;
  gutterWidth: number;
  lanes: FlowLaneChrome[];
  gridColumns: Array<{
    left: number;
    width: number;
  }>;
}

export type FlowTranslateExtent = [[number, number], [number, number]];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readMeasuredHeight(
  measuredNodeHeights: MeasuredNodeHeights,
  cellId: string,
): number | undefined {
  if (!measuredNodeHeights) return undefined;
  if (measuredNodeHeights instanceof Map) {
    return measuredNodeHeights.get(cellId);
  }
  return measuredNodeHeights[cellId];
}

function estimateTextHeight(text: string, minHeight: number, lineHeight: number, charsPerLine: number) {
  const lineCount = Math.max(1, Math.ceil((text.trim().length || 1) / charsPerLine));
  return minHeight + Math.max(0, lineCount - 1) * lineHeight;
}

function scaleLayoutValue(value: number, scale: number) {
  return Math.max(1, Math.round(value * scale));
}

function getStandardPreviewAspectRatio(devicePreset?: FrameWithVersions["devicePreset"]): number {
  if (devicePreset === "iphone-15-pro-max") {
    return 932 / 430;
  }
  if (devicePreset === "iphone-15-pro" || devicePreset === "iphone-15" || devicePreset === "iphone" || isMobilePreset(devicePreset ?? "desktop")) {
    return 852 / 393;
  }
  return 880 / 1240;
}

function getFlowAreaMetric(
  metrics: FlowLayoutMetrics,
  areaId?: string | null,
) {
  if (typeof areaId !== "string" || areaId.trim().length === 0) {
    return metrics.areas[0];
  }

  return metrics.areas.find((area) => area.id === areaId) ?? metrics.areas[0];
}

export function getMaxVisibleFlowBodyHeight(artboardViewportHeight: number): number {
  return clamp(artboardViewportHeight - 160, FLOW_BODY_MIN_HEIGHT, FLOW_BODY_MAX_HEIGHT);
}

export function estimateFlowArtifactHeight(
  artifact: FlowArtifact,
  nodeWidth: number,
  allDesignFrames: FrameWithVersions[] = [],
  layoutScale = 1,
): number {
  const contentWidth = Math.max(scaleLayoutValue(120, layoutScale), nodeWidth - scaleLayoutValue(16, layoutScale));

  switch (artifact.type) {
    case "design-frame-ref": {
      if (artifact.previewMode === "manual" && typeof artifact.previewHeight === "number") {
        return Math.max(scaleLayoutValue(120, layoutScale), Math.round(artifact.previewHeight) + scaleLayoutValue(8, layoutScale));
      }

      const ref = allDesignFrames.find((frame) => frame.id === artifact.frameId);
      const aspect = artifact.previewMode === "content"
        ? ref
          ? ref.size.height / Math.max(ref.size.width, 1)
          : 0.65
        : getStandardPreviewAspectRatio(ref?.devicePreset);
      return Math.max(scaleLayoutValue(120, layoutScale), Math.round(contentWidth * aspect) + scaleLayoutValue(12, layoutScale));
    }

    case "uploaded-image": {
      if (typeof artifact.width === "number" && typeof artifact.height === "number" && artifact.width > 0) {
        return Math.max(
          scaleLayoutValue(120, layoutScale),
          Math.round((contentWidth * artifact.height) / artifact.width) + scaleLayoutValue(12, layoutScale),
        );
      }
      return scaleLayoutValue(180, layoutScale);
    }

    case "journey-step": {
      const textHeight = estimateTextHeight(
        artifact.text,
        scaleLayoutValue(72, layoutScale),
        scaleLayoutValue(18, layoutScale),
        artifact.shape === "diamond" ? 18 : 26,
      );
      return artifact.shape === "diamond"
        ? Math.max(scaleLayoutValue(144, layoutScale), textHeight + scaleLayoutValue(44, layoutScale))
        : Math.max(scaleLayoutValue(96, layoutScale), textHeight);
    }

    case "technical-brief": {
      const bodyHeight = estimateTextHeight(
        artifact.body,
        scaleLayoutValue(88, layoutScale),
        scaleLayoutValue(14, layoutScale),
        34,
      );
      return Math.max(scaleLayoutValue(140, layoutScale), bodyHeight + scaleLayoutValue(28, layoutScale));
    }
  }
}

export function createFlowLayoutMetrics(
  doc: Pick<FlowDocument, "areas" | "cells">,
  input: Pick<
    FlowLayoutOptions,
    "frameWidth" | "frameHeight" | "headerHeight" | "layoutScale" | "maxVisibleBodyHeight" | "measuredNodeHeights" | "allDesignFrames" | "extraAreaColumns"
  >,
): FlowLayoutMetrics {
  const layoutScale = input.layoutScale ?? 1;
  const labelWidth = scaleLayoutValue(LANE_LABEL_WIDTH, layoutScale);
  const nodeGap = scaleLayoutValue(NODE_GAP, layoutScale);
  const nodePaddingLeft = scaleLayoutValue(NODE_PADDING_LEFT, layoutScale);
  const boardPaddingX = scaleLayoutValue(FLOW_BOARD_PADDING_X, layoutScale);
  const areaGap = scaleLayoutValue(FLOW_AREA_GAP, layoutScale);
  const areaFramePaddingX = scaleLayoutValue(FLOW_AREA_FRAME_PADDING_X, layoutScale);
  const laneInnerPadding = scaleLayoutValue(12, layoutScale);
  const minLaneHeight = scaleLayoutValue(MIN_FLOW_LANE_HEIGHT, layoutScale);
  const laneVerticalPadding = scaleLayoutValue(FLOW_LANE_VERTICAL_PADDING, layoutScale);
  const availableWidth = Math.max(0, input.frameWidth - boardPaddingX * 2);
  const nodeWidth = scaleLayoutValue(NODE_WIDTH, layoutScale);
  const slotStep = nodeWidth + nodeGap;

  const sizedAreas = getFlowAreas(doc).map((area) => {
    const sharedSpan = getFlowAreaColumnSpan(doc, area.id);
    const maxLocalColumn = doc.cells.reduce((current, cell) => {
      if (getFlowCellAreaId(doc, cell) !== area.id) {
        return current;
      }
      return Math.max(current, cell.column);
    }, -1);
    const extraColumns = Math.max(0, Math.floor(input.extraAreaColumns?.[area.id] ?? 0));
    const visibleColumnCount = Math.max(MIN_VISIBLE_COLUMNS, maxLocalColumn + 1);
    const localColumnCount = visibleColumnCount + extraColumns;
    const slotWidth =
      localColumnCount * nodeWidth + Math.max(0, localColumnCount - 1) * nodeGap;
    const endColumn = Math.max(sharedSpan.endColumn, area.columnOffset + Math.max(0, localColumnCount - 1));
    const startColumn = sharedSpan.startColumn;

    return {
      id: area.id,
      name: area.name,
      columnOffset: area.columnOffset,
      startColumn,
      endColumn,
      localColumnCount,
      slotWidth,
    };
  });

  let areaCursorX = boardPaddingX;
  const areas = sizedAreas.map((area) => {
    const left = areaCursorX;
    const slotLeft = left + areaFramePaddingX + labelWidth + nodePaddingLeft;
    const width = areaFramePaddingX * 2 + labelWidth + nodePaddingLeft + area.slotWidth;
    areaCursorX += width + areaGap;

    return {
      ...area,
      left,
      slotLeft,
      width,
    };
  });

  const maxColumn = areas.reduce((current, area) => Math.max(current, area.endColumn), MIN_VISIBLE_COLUMNS - 1);
  const columnCount = Math.max(MIN_VISIBLE_COLUMNS, maxColumn + 1);
  const contentWidth =
    areas.length > 0
      ? Math.max(areaCursorX - areaGap + boardPaddingX, input.frameWidth)
      : Math.max(input.frameWidth, boardPaddingX * 2 + labelWidth + nodePaddingLeft + nodeWidth);

  const laneHeights = FLOW_LANE_ORDER.map((laneId) => {
    const tallestNode = doc.cells
      .filter((cell) => cell.laneId === laneId)
      .reduce((maxHeight, cell) => {
        const measuredHeight = readMeasuredHeight(input.measuredNodeHeights, cell.id);
        const nextHeight =
          typeof measuredHeight === "number" && Number.isFinite(measuredHeight)
            ? measuredHeight
            : estimateFlowArtifactHeight(cell.artifact, nodeWidth, input.allDesignFrames, layoutScale);
        return Math.max(maxHeight, nextHeight);
      }, 0);

    return Math.max(minLaneHeight, tallestNode + laneVerticalPadding);
  });

  const laneTops: number[] = [];
  let contentHeight = 0;
  for (const laneHeight of laneHeights) {
    laneTops.push(contentHeight);
    contentHeight += laneHeight;
  }

  const fallbackVisibleBodyHeight = Math.max(input.frameHeight - input.headerHeight, FLOW_BODY_MIN_HEIGHT);
  const maxVisibleBodyHeight = input.maxVisibleBodyHeight ?? fallbackVisibleBodyHeight;
  const visibleBodyHeight = Math.min(contentHeight, maxVisibleBodyHeight);
  const frameHeight = input.headerHeight + visibleBodyHeight;
  const lastArea = areas[areas.length - 1];
  const nodeMinX = areas[0]?.slotLeft ?? boardPaddingX + labelWidth + nodePaddingLeft;
  const nodeMaxX = lastArea
    ? lastArea.slotLeft + Math.max(0, lastArea.localColumnCount - 1) * slotStep
    : nodeMinX;

  return {
    frameWidth: Math.max(input.frameWidth, contentWidth),
    frameHeight,
    headerHeight: input.headerHeight,
    layoutScale,
    availableHeight: visibleBodyHeight,
    availableWidth,
    visibleBodyHeight,
    maxVisibleBodyHeight,
    contentHeight,
    contentWidth,
    laneHeights,
    laneTops,
    columnCount,
    labelWidth,
    nodeGap,
    nodePaddingLeft,
    boardPaddingX,
    areaGap,
    laneInnerPadding,
    nodeWidth,
    slotStep,
    nodeMinX,
    nodeMaxX,
    areas,
  };
}

export function getFlowSlotLeft(column: number, metrics: FlowLayoutMetrics, areaId?: string): number {
  const normalizedColumn = Math.max(0, Math.floor(column));
  if (typeof areaId === "string") {
    const area = getFlowAreaMetric(metrics, areaId);
    if (!area) {
      return metrics.nodeMinX;
    }
    return area.slotLeft + Math.min(normalizedColumn, area.localColumnCount - 1) * metrics.slotStep;
  }

  const area = metrics.areas.find(
    (candidate) => normalizedColumn >= candidate.startColumn && normalizedColumn <= candidate.endColumn,
  );
  if (!area) {
    return metrics.nodeMinX + normalizedColumn * metrics.slotStep;
  }

  return area.slotLeft + Math.min(normalizedColumn - area.columnOffset, area.localColumnCount - 1) * metrics.slotStep;
}

export function getFlowLaneTop(laneId: FlowLaneId, metrics: FlowLayoutMetrics): number {
  const laneIndex = FLOW_LANE_ORDER.indexOf(laneId);
  return laneIndex >= 0 ? metrics.laneTops[laneIndex] ?? 0 : 0;
}

export function getFlowLaneHeight(laneId: FlowLaneId, metrics: FlowLayoutMetrics): number {
  const laneIndex = FLOW_LANE_ORDER.indexOf(laneId);
  const fallback = scaleLayoutValue(MIN_FLOW_LANE_HEIGHT, metrics.layoutScale);
  return laneIndex >= 0 ? metrics.laneHeights[laneIndex] ?? fallback : fallback;
}

export function getFlowAreaBounds(
  areaId: string,
  metrics: FlowLayoutMetrics,
): { x: number; y: number; width: number; height: number } | null {
  const area = getFlowAreaMetric(metrics, areaId);
  if (!area) {
    return null;
  }

  return {
    x: Math.max(0, area.left - metrics.boardPaddingX),
    y: 0,
    width: area.width + metrics.boardPaddingX * 2,
    height: metrics.contentHeight,
  };
}

export function getFlowDocumentBounds(
  doc: Pick<FlowDocument, "areas" | "cells">,
  metrics: FlowLayoutMetrics,
): { x: number; y: number; width: number; height: number } | null {
  const occupiedAreaIds = new Set(doc.cells.map((cell) => getFlowCellAreaId(doc, cell)));
  const targetAreaIds = occupiedAreaIds.size > 0 ? occupiedAreaIds : new Set([metrics.areas[0]?.id].filter(Boolean));

  const areaBounds = [...targetAreaIds]
    .map((areaId) => getFlowAreaBounds(areaId, metrics))
    .filter((bounds): bounds is { x: number; y: number; width: number; height: number } => Boolean(bounds));

  if (areaBounds.length === 0) {
    return null;
  }

  const minX = Math.min(...areaBounds.map((bounds) => bounds.x));
  const maxX = Math.max(...areaBounds.map((bounds) => bounds.x + bounds.width));

  return {
    x: Math.max(0, minX - metrics.boardPaddingX / 2),
    y: 0,
    width: Math.max(1, maxX - Math.max(0, minX - metrics.boardPaddingX / 2)),
    height: metrics.contentHeight,
  };
}

export function getFlowTranslateExtent(
  metrics: FlowLayoutMetrics,
  viewportWidth: number,
  viewportHeight: number,
  minZoom: number,
): FlowTranslateExtent {
  const safeMinZoom = Math.max(minZoom, 0.1);
  const horizontalPadding = Math.max(
    metrics.boardPaddingX + metrics.areaGap * 2,
    Math.ceil(viewportWidth / safeMinZoom),
  );
  const verticalPadding = Math.max(
    scaleLayoutValue(180, metrics.layoutScale),
    Math.ceil(viewportHeight / safeMinZoom),
  );

  return [
    [-horizontalPadding, -verticalPadding],
    [metrics.contentWidth + horizontalPadding, metrics.contentHeight + verticalPadding],
  ];
}

export function getFlowSlotTop(laneId: FlowLaneId, metrics: FlowLayoutMetrics): number {
  return getFlowLaneTop(laneId, metrics) + metrics.laneInnerPadding;
}

function getFlowLaneIndexAtY(y: number, metrics: FlowLayoutMetrics): number | null {
  if (y < 0 || y > metrics.contentHeight) {
    return null;
  }

  for (let laneIndex = 0; laneIndex < FLOW_LANE_ORDER.length; laneIndex += 1) {
    const laneTop = metrics.laneTops[laneIndex] ?? 0;
    const laneBottom = laneTop + (metrics.laneHeights[laneIndex] ?? MIN_FLOW_LANE_HEIGHT);
    if (y >= laneTop && y <= laneBottom) {
      return laneIndex;
    }
  }

  return FLOW_LANE_ORDER.length - 1;
}

export function getFlowGridSlotAtPosition(
  position: { x: number; y: number },
  metrics: FlowLayoutMetrics,
): FlowGridSlot | null {
  const laneIndex = getFlowLaneIndexAtY(position.y, metrics);
  if (laneIndex === null) {
    return null;
  }

  const area = metrics.areas.find(
    (candidate) => {
      const firstCenter = candidate.slotLeft + metrics.nodeWidth / 2;
      const lastCenter = firstCenter + Math.max(0, candidate.localColumnCount - 1) * metrics.slotStep;
      const slotBoundaryPadding = metrics.slotStep / 2;
      return position.x >= firstCenter - slotBoundaryPadding && position.x <= lastCenter + slotBoundaryPadding;
    },
  );
  if (!area) {
    return null;
  }

  const firstCenter = area.slotLeft + metrics.nodeWidth / 2;
  const rawLocalColumn = (position.x - firstCenter) / metrics.slotStep;
  const localColumn = Math.max(0, Math.min(area.localColumnCount - 1, Math.round(rawLocalColumn)));

  return {
    areaId: area.id,
    laneId: FLOW_LANE_ORDER[laneIndex],
    column: localColumn,
  };
}

export function getFlowSlotCenter(
  slot: FlowGridSlot,
  metrics: FlowLayoutMetrics,
): { x: number; y: number } {
  const laneTop = getFlowLaneTop(slot.laneId, metrics);
  const laneHeight = getFlowLaneHeight(slot.laneId, metrics);

  return {
    x: getFlowSlotLeft(slot.column, metrics, slot.areaId) + metrics.nodeWidth / 2,
    y: laneTop + laneHeight / 2,
  };
}

export function buildFlowChromeAreas(metrics: FlowLayoutMetrics): FlowAreaChrome[] {
  return metrics.areas.map((area) => ({
    id: area.id,
    name: area.name,
    left: area.left,
    width: area.width,
    height: metrics.contentHeight,
    gutterWidth: Math.max(metrics.labelWidth, area.slotLeft - area.left - Math.round(metrics.nodePaddingLeft / 2)),
    gridColumns: Array.from({ length: area.localColumnCount }, (_, columnIndex) => ({
      left: area.slotLeft - area.left + columnIndex * metrics.slotStep,
      width: metrics.nodeWidth,
    })),
    lanes: FLOW_LANE_ORDER.map((laneId, laneIndex) => ({
      areaId: area.id,
      laneId,
      label: FLOW_LANE_LABELS[laneId],
      top: metrics.laneTops[laneIndex] ?? 0,
      height: metrics.laneHeights[laneIndex] ?? MIN_FLOW_LANE_HEIGHT,
      isFirstLane: laneIndex === 0,
      isLastLane: laneIndex === FLOW_LANE_ORDER.length - 1,
    })),
  }));
}

export function buildFlowBoardLayout(
  doc: FlowDocument,
  options: FlowLayoutOptions,
): FlowBoardLayout {
  const { allDesignFrames } = options;
  const metrics = createFlowLayoutMetrics(doc, options);
  const cells: FlowBoardCellLayout[] = [];
  const edges: FlowBoardEdgeLayout[] = [];
  const chromeAreas = buildFlowChromeAreas(metrics);

  for (const cell of doc.cells) {
    const artifact = cell.artifact;
    const areaId = getFlowCellAreaId(doc, cell);
    const globalColumn = getFlowGlobalColumn(doc, cell);
    const laneTop = getFlowLaneTop(cell.laneId, metrics);
    const laneHeight = getFlowLaneHeight(cell.laneId, metrics);
    const nodeHeight =
      readMeasuredHeight(options.measuredNodeHeights, cell.id) ??
      estimateFlowArtifactHeight(artifact, metrics.nodeWidth, allDesignFrames, metrics.layoutScale);
    const x = getFlowSlotLeft(cell.column, metrics, areaId);
    const y = laneTop + Math.max(metrics.laneInnerPadding, (laneHeight - nodeHeight) / 2);

    cells.push({
      cellId: cell.id,
      areaId,
      laneId: cell.laneId,
      column: cell.column,
      globalColumn,
      artifact,
      refFrame:
        artifact.type === "design-frame-ref"
          ? allDesignFrames.find((frame) => frame.id === artifact.frameId)
          : undefined,
      x,
      y,
      width: metrics.nodeWidth,
      height: nodeHeight,
    });
  }

  for (const conn of doc.connections) {
    const normalized = normalizeFlowConnection(doc, conn);
    const fromCell = doc.cells.find((cell) => cell.id === normalized.fromCellId);
    const toCell = doc.cells.find((cell) => cell.id === normalized.toCellId);
    if (!fromCell || !toCell) {
      continue;
    }

    if (!isFlowConnectionAllowedBetweenCells(doc, fromCell, toCell)) {
      continue;
    }

    const isCrossLane = fromCell.laneId !== toCell.laneId;
    const sourceLaneId = fromCell?.laneId ?? "user-journey";
    const laneEdgeStyle = FLOW_LANE_EDGE_STYLES[sourceLaneId];

    edges.push({
      id: normalized.id,
      fromCellId: normalized.fromCellId,
      toCellId: normalized.toCellId,
      sourceHandle: normalized.sourceHandle,
      targetHandle: normalized.targetHandle,
      sourceHandleSide: getFlowHandleSideFromId(normalized.sourceHandle) ?? "right",
      targetHandleSide: getFlowHandleSideFromId(normalized.targetHandle) ?? "left",
      laneId: sourceLaneId,
      targetLaneId: toCell?.laneId,
      isCrossLane,
      strokeColor: laneEdgeStyle.stroke,
      glowColor: laneEdgeStyle.glow,
    });
  }

  return { cells, edges, metrics, chromeAreas };
}

export function getFlowNodeHandlePosition(
  cell: Pick<FlowBoardCellLayout, "x" | "y" | "width" | "height">,
  side: FlowHandleSide,
): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: cell.x + cell.width / 2, y: cell.y };
    case "right":
      return { x: cell.x + cell.width, y: cell.y + cell.height / 2 };
    case "bottom":
      return { x: cell.x + cell.width / 2, y: cell.y + cell.height };
    case "left":
      return { x: cell.x, y: cell.y + cell.height / 2 };
  }
}

export function isValidFlowConnectionBetweenCells(
  doc: Pick<FlowDocument, "areas" | "cells">,
  sourceId: string,
  targetId: string,
): boolean {
  const sourceCell = doc.cells.find((cell) => cell.id === sourceId);
  const targetCell = doc.cells.find((cell) => cell.id === targetId);
  if (!sourceCell || !targetCell) {
    return false;
  }

  return isFlowConnectionAllowedBetweenCells(doc, sourceCell, targetCell);
}

export function toFlowConnectionRecord(
  connection: Pick<FlowConnection, "id" | "fromCellId" | "toCellId" | "sourceHandle" | "targetHandle">,
): FlowConnection {
  return {
    id: connection.id,
    fromCellId: connection.fromCellId,
    toCellId: connection.toCellId,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  };
}
