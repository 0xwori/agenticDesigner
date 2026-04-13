export type FrameKind = "design" | "flow";

export type FlowLaneId = "user-journey" | "normal-flow" | "unhappy-path" | "technical-briefing";

export type FlowHandleSide = "top" | "right" | "bottom" | "left";

export interface FlowArea {
  id: string;
  name: string;
  columnOffset: number;
}

export const FLOW_DEFAULT_AREA_ID = "area-1";
export const FLOW_DEFAULT_AREA_NAME = "Area 1";
export const FLOW_AREA_MIN_COLUMNS = 4;
export const FLOW_AREA_COLUMN_GAP = 3;

/** Fixed display order for swim lanes (top → bottom). */
export const FLOW_LANE_ORDER: readonly FlowLaneId[] = [
  "user-journey",
  "normal-flow",
  "unhappy-path",
  "technical-briefing",
] as const;

export const FLOW_LANE_LABELS: Record<FlowLaneId, string> = {
  "user-journey": "User Journey",
  "normal-flow": "Normal Flow",
  "unhappy-path": "Unhappy Path",
  "technical-briefing": "Technical Briefing",
};

export const FLOW_HANDLE_SIDES: readonly FlowHandleSide[] = [
  "top",
  "right",
  "bottom",
  "left",
] as const;

export const FLOW_SOURCE_HANDLE_IDS: Record<FlowHandleSide, string> = {
  top: "top",
  right: "right",
  bottom: "bottom",
  left: "left",
};

export const FLOW_TARGET_HANDLE_IDS: Record<FlowHandleSide, string> = {
  top: "top-target",
  right: "right-target",
  bottom: "bottom-target",
  left: "left-target",
};

// ── Artifacts ──────────────────────────────────────────────

export interface DesignFrameRefArtifact {
  type: "design-frame-ref";
  frameId: string;
  previewMode?: "standard" | "content" | "manual";
  previewHeight?: number;
}

export interface UploadedImageArtifact {
  type: "uploaded-image";
  dataUrl: string;
  label?: string;
  /** Intrinsic image size used to seed layout before the image fully loads. */
  width?: number;
  height?: number;
}

export type JourneyStepShape = "rectangle" | "diamond";

export interface JourneyStepArtifact {
  type: "journey-step";
  text: string;
  /** ERD-style shape: rectangle for steps, diamond for decisions. Defaults to "rectangle". */
  shape?: JourneyStepShape;
}

export interface TechnicalBriefArtifact {
  type: "technical-brief";
  title: string;
  language: string;
  body: string;
}

export type FlowArtifact =
  | DesignFrameRefArtifact
  | UploadedImageArtifact
  | JourneyStepArtifact
  | TechnicalBriefArtifact;

// ── Cells & Connections ────────────────────────────────────

export interface FlowCell {
  id: string;
  laneId: FlowLaneId;
  column: number;
  areaId?: string;
  artifact: FlowArtifact;
}

export interface FlowConnection {
  id: string;
  fromCellId: string;
  toCellId: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface FlowStoryAcceptanceCriteriaGroup {
  title: string;
  items: string[];
}

export interface FlowStory {
  title: string;
  userStory: string;
  goal?: string;
  startingPoint?: string[];
  designReference?: string | null;
  acceptanceCriteria: string[];
  acceptanceCriteriaGroups?: FlowStoryAcceptanceCriteriaGroup[];
  phraseKeys?: string[];
  technicalNotes: string[];
  technicalBriefing?: string[];
  accessibilityRequirements?: string[];
  generatedAt: string;
  sourcePrompt: string;
}

export interface FlowBoardMemoryEntity {
  id: string;
  name: string;
  description?: string;
}

export interface FlowBoardMemoryScreen {
  id: string;
  title: string;
  frameId?: string;
  summary?: string;
  notes: string[];
}

export type FlowBoardMemoryJourneyNodeKind = "step" | "decision";

export type FlowBoardMemoryJourneyLaneId = Exclude<FlowLaneId, "technical-briefing">;

export interface FlowBoardMemoryJourneyNode {
  id: string;
  title: string;
  laneId: FlowBoardMemoryJourneyLaneId;
  kind: FlowBoardMemoryJourneyNodeKind;
  screenId?: string;
  notes: string[];
}

export interface FlowBoardMemoryTechnicalNote {
  id: string;
  title: string;
  body: string;
  language?: string;
  tags: string[];
}

export interface FlowBoardMemoryArtifactMapping {
  memoryId: string;
  cellId?: string;
  frameId?: string;
}

export interface FlowBoardMemoryDocument {
  version: 1;
  goals: string[];
  assumptions: string[];
  entities: FlowBoardMemoryEntity[];
  screens: FlowBoardMemoryScreen[];
  journey: FlowBoardMemoryJourneyNode[];
  technicalNotes: FlowBoardMemoryTechnicalNote[];
  openQuestions: string[];
  artifactMappings: FlowBoardMemoryArtifactMapping[];
}

export interface FlowBoardMemoryState {
  authoredText: string;
  snapshot: FlowBoardMemoryDocument;
  updatedAt: string;
}

// ── Document ───────────────────────────────────────────────

export interface FlowDocument {
  lanes: FlowLaneId[];
  areas?: FlowArea[];
  importedSourceFrameIds?: string[];
  cells: FlowCell[];
  connections: FlowConnection[];
  entryFlowFrameId?: string;
  exitFlowFrameId?: string;
  story?: FlowStory;
  boardMemory?: FlowBoardMemoryState;
}

export function createEmptyFlowDocument(): FlowDocument {
  return {
    lanes: [...FLOW_LANE_ORDER],
    areas: [
      {
        id: FLOW_DEFAULT_AREA_ID,
        name: FLOW_DEFAULT_AREA_NAME,
        columnOffset: 0,
      },
    ],
    importedSourceFrameIds: [],
    cells: [],
    connections: [],
  };
}

function normalizeFlowColumn(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeFlowAreaId(value: unknown, fallbackIndex: number): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return `area-${fallbackIndex}`;
}

function normalizeFlowAreaName(value: unknown, fallbackIndex: number): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return `Area ${fallbackIndex}`;
}

function normalizeFlowAreas(areas?: FlowArea[]): FlowArea[] {
  const nextAreas: FlowArea[] = [];
  const seenIds = new Set<string>();

  if (Array.isArray(areas)) {
    areas.forEach((area, index) => {
      if (!area || typeof area !== "object") {
        return;
      }

      const id = normalizeFlowAreaId(area.id, index + 1);
      if (seenIds.has(id)) {
        return;
      }

      seenIds.add(id);
      nextAreas.push({
        id,
        name: normalizeFlowAreaName(area.name, index + 1),
        columnOffset: normalizeFlowColumn(area.columnOffset),
      });
    });
  }

  if (nextAreas.length === 0) {
    return [
      {
        id: FLOW_DEFAULT_AREA_ID,
        name: FLOW_DEFAULT_AREA_NAME,
        columnOffset: 0,
      },
    ];
  }

  return nextAreas.sort((left, right) => {
    if (left.columnOffset !== right.columnOffset) {
      return left.columnOffset - right.columnOffset;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeImportedSourceFrameIds(importedSourceFrameIds?: string[]): string[] {
  if (!Array.isArray(importedSourceFrameIds)) {
    return [];
  }

  const seen = new Set<string>();
  const nextIds: string[] = [];
  for (const id of importedSourceFrameIds) {
    if (typeof id !== "string") {
      continue;
    }
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    nextIds.push(normalized);
  }

  return nextIds;
}

function normalizeFlowBoardMemoryStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nextItems: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    nextItems.push(normalized);
  }

  return nextItems;
}

function normalizeOptionalFlowBoardMemoryString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFlowBoardMemoryId(value: unknown, prefix: string, index: number): string {
  return normalizeOptionalFlowBoardMemoryString(value) ?? `${prefix}-${index + 1}`;
}

function isIsoDateString(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function createEmptyFlowBoardMemoryDocument(): FlowBoardMemoryDocument {
  return {
    version: 1,
    goals: [],
    assumptions: [],
    entities: [],
    screens: [],
    journey: [],
    technicalNotes: [],
    openQuestions: [],
    artifactMappings: [],
  };
}

export function normalizeFlowBoardMemoryDocument(
  value?: Partial<FlowBoardMemoryDocument> | null,
): FlowBoardMemoryDocument {
  const doc = value ?? undefined;

  const entities = Array.isArray(doc?.entities)
    ? doc.entities.map((entity, index) => ({
        id: normalizeFlowBoardMemoryId(entity?.id, "entity", index),
        name: normalizeOptionalFlowBoardMemoryString(entity?.name) ?? `Entity ${index + 1}`,
        description: normalizeOptionalFlowBoardMemoryString(entity?.description),
      }))
    : [];

  const screens = Array.isArray(doc?.screens)
    ? doc.screens.map((screen, index) => ({
        id: normalizeFlowBoardMemoryId(screen?.id, "screen", index),
        title: normalizeOptionalFlowBoardMemoryString(screen?.title) ?? `Screen ${index + 1}`,
        frameId: normalizeOptionalFlowBoardMemoryString(screen?.frameId),
        summary: normalizeOptionalFlowBoardMemoryString(screen?.summary),
        notes: normalizeFlowBoardMemoryStringList(screen?.notes),
      }))
    : [];

  const journey: FlowBoardMemoryJourneyNode[] = Array.isArray(doc?.journey)
    ? doc.journey.map((node, index) => ({
        id: normalizeFlowBoardMemoryId(node?.id, "journey", index),
        title: normalizeOptionalFlowBoardMemoryString(node?.title) ?? `Step ${index + 1}`,
        laneId:
          node?.laneId === "normal-flow" || node?.laneId === "unhappy-path" || node?.laneId === "user-journey"
            ? node.laneId
            : "user-journey",
        kind: (node?.kind === "decision" ? "decision" : "step") as FlowBoardMemoryJourneyNodeKind,
        screenId: normalizeOptionalFlowBoardMemoryString(node?.screenId),
        notes: normalizeFlowBoardMemoryStringList(node?.notes),
      }))
    : [];

  const technicalNotes = Array.isArray(doc?.technicalNotes)
    ? doc.technicalNotes.map((note, index) => ({
        id: normalizeFlowBoardMemoryId(note?.id, "technical-note", index),
        title: normalizeOptionalFlowBoardMemoryString(note?.title) ?? `Technical note ${index + 1}`,
        body: normalizeOptionalFlowBoardMemoryString(note?.body) ?? "",
        language: normalizeOptionalFlowBoardMemoryString(note?.language),
        tags: normalizeFlowBoardMemoryStringList(note?.tags),
      }))
    : [];

  const artifactMappings: FlowBoardMemoryArtifactMapping[] = Array.isArray(doc?.artifactMappings)
    ? doc.artifactMappings
        .map((mapping) => ({
          memoryId: normalizeOptionalFlowBoardMemoryString(mapping?.memoryId),
          cellId: normalizeOptionalFlowBoardMemoryString(mapping?.cellId),
          frameId: normalizeOptionalFlowBoardMemoryString(mapping?.frameId),
        }))
        .flatMap((mapping) =>
          mapping.memoryId
            ? [
                {
                  memoryId: mapping.memoryId,
                  cellId: mapping.cellId,
                  frameId: mapping.frameId,
                },
              ]
            : [],
        )
    : [];

  return {
    version: 1,
    goals: normalizeFlowBoardMemoryStringList(doc?.goals),
    assumptions: normalizeFlowBoardMemoryStringList(doc?.assumptions),
    entities,
    screens,
    journey,
    technicalNotes,
    openQuestions: normalizeFlowBoardMemoryStringList(doc?.openQuestions),
    artifactMappings,
  };
}

export function normalizeFlowBoardMemoryState(
  value?: Partial<FlowBoardMemoryState> | null,
): FlowBoardMemoryState | undefined {
  if (!value) {
    return undefined;
  }

  const authoredText = typeof value.authoredText === "string" ? value.authoredText : "";
  const updatedAt =
    typeof value.updatedAt === "string" && isIsoDateString(value.updatedAt)
      ? value.updatedAt
      : new Date(0).toISOString();

  return {
    authoredText,
    snapshot: normalizeFlowBoardMemoryDocument(value.snapshot),
    updatedAt,
  };
}

export function getDefaultFlowArea(doc: Pick<FlowDocument, "areas">): FlowArea {
  return normalizeFlowAreas(doc.areas)[0];
}

export function getFlowAreas(doc: Pick<FlowDocument, "areas">): FlowArea[] {
  return normalizeFlowAreas(doc.areas);
}

export function resolveFlowArea(
  doc: Pick<FlowDocument, "areas">,
  areaId?: string | null,
): FlowArea {
  const areas = normalizeFlowAreas(doc.areas);
  if (typeof areaId === "string" && areaId.trim().length > 0) {
    const match = areas.find((area) => area.id === areaId.trim());
    if (match) {
      return match;
    }
  }
  return areas[0];
}

export function getFlowCellAreaId(
  doc: Pick<FlowDocument, "areas">,
  cell: Pick<FlowCell, "areaId">,
): string {
  return resolveFlowArea(doc, cell.areaId).id;
}

export function getFlowAreaColumnSpan(
  doc: Pick<FlowDocument, "areas" | "cells">,
  areaId?: string | null,
): { startColumn: number; endColumn: number } {
  const area = resolveFlowArea(doc, areaId);
  const maxLocalColumn = doc.cells.reduce((current, cell) => {
    if (getFlowCellAreaId(doc, cell) !== area.id) {
      return current;
    }
    return Math.max(current, normalizeFlowColumn(cell.column));
  }, -1);

  const endColumn = area.columnOffset + Math.max(maxLocalColumn, FLOW_AREA_MIN_COLUMNS - 1);
  return {
    startColumn: area.columnOffset,
    endColumn,
  };
}

export function getFlowGlobalColumn(
  doc: Pick<FlowDocument, "areas">,
  cell: Pick<FlowCell, "areaId" | "column">,
): number {
  const area = resolveFlowArea(doc, cell.areaId);
  return area.columnOffset + normalizeFlowColumn(cell.column);
}

export function getNextFlowAreaName(doc: Pick<FlowDocument, "areas">): string {
  const highestIndex = normalizeFlowAreas(doc.areas).reduce((current, area) => {
    const match = /^Area\s+(\d+)$/i.exec(area.name.trim());
    if (!match) {
      return current;
    }
    return Math.max(current, Number.parseInt(match[1] ?? "0", 10));
  }, 0);

  return `Area ${highestIndex + 1}`;
}

export function getNextFlowAreaColumnOffset(
  doc: Pick<FlowDocument, "areas" | "cells">,
): number {
  return normalizeFlowAreas(doc.areas).reduce((current, area) => {
    const { endColumn } = getFlowAreaColumnSpan(doc, area.id);
    return Math.max(current, endColumn + FLOW_AREA_COLUMN_GAP + 1);
  }, 0);
}

export function normalizeFlowDocument(doc: FlowDocument): FlowDocument {
  const areas = normalizeFlowAreas(doc.areas);
  const areaIds = new Set(areas.map((area) => area.id));
  const defaultAreaId = areas[0].id;
  const lanes =
    Array.isArray(doc.lanes) && doc.lanes.length > 0
      ? doc.lanes.filter((lane): lane is FlowLaneId =>
          typeof lane === "string" && FLOW_LANE_ORDER.includes(lane as FlowLaneId),
        )
      : [...FLOW_LANE_ORDER];

  return {
    ...doc,
    lanes: lanes.length > 0 ? lanes : [...FLOW_LANE_ORDER],
    areas,
    importedSourceFrameIds: normalizeImportedSourceFrameIds(doc.importedSourceFrameIds),
    boardMemory: normalizeFlowBoardMemoryState(doc.boardMemory),
    cells: doc.cells.map((cell) => ({
      ...cell,
      artifact: normalizeFlowArtifact(cell.artifact),
      column: normalizeFlowColumn(cell.column),
      areaId:
        typeof cell.areaId === "string" && areaIds.has(cell.areaId)
          ? cell.areaId
          : defaultAreaId,
    })),
    connections: doc.connections.map((connection) => ({ ...connection })),
  };
}

function normalizeFlowArtifact(artifact: FlowArtifact): FlowArtifact {
  switch (artifact.type) {
    case "design-frame-ref": {
      const previewMode =
        artifact.previewMode === "content" || artifact.previewMode === "manual" || artifact.previewMode === "standard"
          ? artifact.previewMode
          : undefined;
      const previewHeight =
        typeof artifact.previewHeight === "number" && Number.isFinite(artifact.previewHeight)
          ? Math.max(120, Math.round(artifact.previewHeight))
          : undefined;

      return {
        ...artifact,
        previewMode,
        previewHeight,
      };
    }

    case "uploaded-image": {
      return {
        ...artifact,
        width:
          typeof artifact.width === "number" && Number.isFinite(artifact.width) && artifact.width > 0
            ? Math.round(artifact.width)
            : undefined,
        height:
          typeof artifact.height === "number" && Number.isFinite(artifact.height) && artifact.height > 0
            ? Math.round(artifact.height)
            : undefined,
      };
    }

    default:
      return { ...artifact };
  }
}

// ── Connection rules ───────────────────────────────────────

const ALLOWED_CROSS_LANE: Record<FlowLaneId, Set<FlowLaneId>> = {
  "user-journey": new Set<FlowLaneId>(["user-journey", "normal-flow", "unhappy-path"]),
  "normal-flow": new Set<FlowLaneId>(["user-journey", "normal-flow", "unhappy-path"]),
  "unhappy-path": new Set<FlowLaneId>(["user-journey", "normal-flow", "unhappy-path"]),
  "technical-briefing": new Set<FlowLaneId>(["technical-briefing"]),
};

/**
 * Returns `true` when a connection from `fromLane` to `toLane` is allowed.
 *
 * Rules:
 * - user-journey ↔ normal-flow / unhappy-path: OK
 * - normal-flow ↔ unhappy-path: OK
 * - user-journey ↔ technical-briefing: BLOCKED
 * - normal-flow / unhappy-path ↔ technical-briefing: BLOCKED
 * - technical-briefing only connects within its own lane
 */
export function isConnectionAllowed(fromLane: FlowLaneId, toLane: FlowLaneId): boolean {
  return ALLOWED_CROSS_LANE[fromLane]?.has(toLane) ?? false;
}

function isDesignFrameToTechnicalBriefingConnection(
  fromCell: Pick<FlowCell, "artifact">,
  toCell: Pick<FlowCell, "laneId">,
): boolean {
  return fromCell.artifact.type === "design-frame-ref" && toCell.laneId === "technical-briefing";
}

export function isFlowConnectionAllowedBetweenCells(
  doc: Pick<FlowDocument, "areas">,
  fromCell: Pick<FlowCell, "artifact" | "laneId" | "areaId">,
  toCell: Pick<FlowCell, "artifact" | "laneId" | "areaId">,
): boolean {
  if (getFlowCellAreaId(doc, fromCell) !== getFlowCellAreaId(doc, toCell)) {
    return false;
  }

  return (
    isConnectionAllowed(fromCell.laneId, toCell.laneId) ||
    isDesignFrameToTechnicalBriefingConnection(fromCell, toCell)
  );
}

export function isFlowHandleSide(value: string): value is FlowHandleSide {
  return FLOW_HANDLE_SIDES.includes(value as FlowHandleSide);
}

export function getFlowHandleSideFromId(handleId?: string | null): FlowHandleSide | undefined {
  if (!handleId) return undefined;
  const normalized = handleId.endsWith("-target") ? handleId.slice(0, -7) : handleId;
  return isFlowHandleSide(normalized) ? normalized : undefined;
}

export function getFlowSourceHandleId(side: FlowHandleSide): string {
  return FLOW_SOURCE_HANDLE_IDS[side];
}

export function getFlowTargetHandleId(side: FlowHandleSide): string {
  return FLOW_TARGET_HANDLE_IDS[side];
}

export function isFlowCellOccupied(
  doc: Pick<FlowDocument, "areas" | "cells">,
  laneId: FlowLaneId,
  column: number,
  ignoreCellId?: string,
  areaId?: string,
): boolean {
  const resolvedAreaId = resolveFlowArea(doc, areaId).id;
  return doc.cells.some(
    (cell) =>
      cell.laneId === laneId &&
      normalizeFlowColumn(cell.column) === normalizeFlowColumn(column) &&
      getFlowCellAreaId(doc, cell) === resolvedAreaId &&
      cell.id !== ignoreCellId,
  );
}

export function findNextFreeFlowColumn(
  doc: Pick<FlowDocument, "areas" | "cells">,
  laneId: FlowLaneId,
  startColumn = 0,
  ignoreCellId?: string,
  areaId?: string,
): number {
  let column = Math.max(0, Math.floor(startColumn));
  while (isFlowCellOccupied(doc, laneId, column, ignoreCellId, areaId)) {
    column += 1;
  }
  return column;
}

export function resolveFlowInsertColumn(
  doc: Pick<FlowDocument, "areas" | "cells">,
  laneId: FlowLaneId,
  preferredColumn?: number,
  ignoreCellId?: string,
  areaId?: string,
): number {
  const resolvedAreaId = resolveFlowArea(doc, areaId).id;
  const laneCells = doc.cells.filter(
    (cell) =>
      cell.laneId === laneId &&
      getFlowCellAreaId(doc, cell) === resolvedAreaId &&
      cell.id !== ignoreCellId,
  );
  const fallbackColumn =
    laneCells.length === 0 ? 0 : Math.max(...laneCells.map((cell) => cell.column)) + 1;
  const baseColumn =
    typeof preferredColumn === "number" && Number.isFinite(preferredColumn)
      ? Math.max(0, Math.floor(preferredColumn))
      : fallbackColumn;
  return findNextFreeFlowColumn(doc, laneId, baseColumn, ignoreCellId, resolvedAreaId);
}

export function inferFlowConnectionSides(
  fromCell: Pick<FlowCell, "laneId" | "column">,
  toCell: Pick<FlowCell, "laneId" | "column">,
): { sourceSide: FlowHandleSide; targetSide: FlowHandleSide } {
  const laneDelta = FLOW_LANE_ORDER.indexOf(toCell.laneId) - FLOW_LANE_ORDER.indexOf(fromCell.laneId);
  const columnDelta = toCell.column - fromCell.column;

  if (Math.abs(columnDelta) >= Math.abs(laneDelta)) {
    if (columnDelta >= 0) {
      return { sourceSide: "right", targetSide: "left" };
    }
    return { sourceSide: "left", targetSide: "right" };
  }

  if (laneDelta >= 0) {
    return { sourceSide: "bottom", targetSide: "top" };
  }

  return { sourceSide: "top", targetSide: "bottom" };
}

export function inferFlowConnectionHandles(
  doc: Pick<FlowDocument, "areas" | "cells">,
  connection: Pick<FlowConnection, "fromCellId" | "toCellId" | "sourceHandle" | "targetHandle">,
): { sourceHandle?: string; targetHandle?: string } {
  const explicitSourceSide = getFlowHandleSideFromId(connection.sourceHandle);
  const explicitTargetSide = getFlowHandleSideFromId(connection.targetHandle);
  const explicitSourceHandle = explicitSourceSide
    ? getFlowSourceHandleId(explicitSourceSide)
    : undefined;
  const explicitTargetHandle = explicitTargetSide
    ? getFlowTargetHandleId(explicitTargetSide)
    : undefined;

  if (explicitSourceHandle && explicitTargetHandle) {
    return { sourceHandle: explicitSourceHandle, targetHandle: explicitTargetHandle };
  }

  const fromCell = doc.cells.find((cell) => cell.id === connection.fromCellId);
  const toCell = doc.cells.find((cell) => cell.id === connection.toCellId);
  if (!fromCell || !toCell) {
    return {
      sourceHandle: explicitSourceHandle,
      targetHandle: explicitTargetHandle,
    };
  }

  const inferred = inferFlowConnectionSides(
    {
      laneId: fromCell.laneId,
      column: getFlowGlobalColumn(doc, fromCell),
    },
    {
      laneId: toCell.laneId,
      column: getFlowGlobalColumn(doc, toCell),
    },
  );

  return {
    sourceHandle: explicitSourceHandle ?? getFlowSourceHandleId(inferred.sourceSide),
    targetHandle: explicitTargetHandle ?? getFlowTargetHandleId(inferred.targetSide),
  };
}

export function normalizeFlowConnection(
  doc: Pick<FlowDocument, "areas" | "cells">,
  connection: FlowConnection,
): FlowConnection {
  return {
    ...connection,
    ...inferFlowConnectionHandles(doc, connection),
  };
}

// ── Flow summary (for pipeline context) ────────────────────

export interface FlowSummary {
  cellCount: number;
  connectionCount: number;
  laneArtifactCounts: Record<FlowLaneId, number>;
}

export function summarizeFlowDocument(doc: FlowDocument): FlowSummary {
  const normalizedDoc = normalizeFlowDocument(doc);
  const laneArtifactCounts: Record<FlowLaneId, number> = {
    "user-journey": 0,
    "normal-flow": 0,
    "unhappy-path": 0,
    "technical-briefing": 0,
  };
  for (const cell of normalizedDoc.cells) {
    laneArtifactCounts[cell.laneId]++;
  }
  return {
    cellCount: normalizedDoc.cells.length,
    connectionCount: normalizedDoc.connections.length,
    laneArtifactCounts,
  };
}

// ── Flow mutation commands (for agent-driven changes) ──────

export type FlowMutationCommand =
  | { op: "add-cell"; laneId: FlowLaneId; artifact: FlowArtifact; column?: number; cellId?: string; areaId?: string }
  | { op: "remove-cell"; cellId: string }
  | { op: "add-connection"; fromCellId: string; toCellId: string; sourceHandle?: string; targetHandle?: string }
  | { op: "remove-connection"; connectionId: string }
  | { op: "move-cell"; cellId: string; toColumn: number; toLaneId?: FlowLaneId; toAreaId?: string }
  | { op: "create-area"; areaId?: string; name?: string; columnOffset?: number }
  | { op: "update-cell"; cellId: string; artifact: FlowArtifact };

function normalizeAndFilterFlowConnections(doc: FlowDocument): FlowConnection[] {
  const seenKeys = new Set<string>();
  const nextConnections: FlowConnection[] = [];

  for (const connection of doc.connections) {
    const fromCell = doc.cells.find((cell) => cell.id === connection.fromCellId);
    const toCell = doc.cells.find((cell) => cell.id === connection.toCellId);
    if (!fromCell || !toCell) {
      continue;
    }
    if (!isFlowConnectionAllowedBetweenCells(doc, fromCell, toCell)) {
      continue;
    }

    const normalized = normalizeFlowConnection(doc, connection);
    const dedupeKey = [
      normalized.fromCellId,
      normalized.toCellId,
      normalized.sourceHandle ?? "",
      normalized.targetHandle ?? "",
    ].join("|");
    if (seenKeys.has(dedupeKey)) {
      continue;
    }

    seenKeys.add(dedupeKey);
    nextConnections.push(normalized);
  }

  return nextConnections;
}

/**
 * Apply a list of mutation commands to a FlowDocument.
 * Invalid commands are silently skipped.
 */
export function applyFlowMutations(
  doc: FlowDocument,
  commands: FlowMutationCommand[],
): FlowDocument {
  let result = normalizeFlowDocument(doc);
  result = {
    ...result,
    areas: [...(result.areas ?? [])],
    importedSourceFrameIds: [...(result.importedSourceFrameIds ?? [])],
    cells: [...result.cells],
    connections: [...result.connections],
  };

  for (const cmd of commands) {
    switch (cmd.op) {
      case "create-area": {
        const requestedAreaId =
          typeof cmd.areaId === "string" && cmd.areaId.trim().length > 0
            ? cmd.areaId.trim()
            : crypto.randomUUID();
        if ((result.areas ?? []).some((area) => area.id === requestedAreaId)) break;

        result.areas = [
          ...(result.areas ?? []),
          {
            id: requestedAreaId,
            name: typeof cmd.name === "string" && cmd.name.trim().length > 0 ? cmd.name.trim() : getNextFlowAreaName(result),
            columnOffset:
              typeof cmd.columnOffset === "number" && Number.isFinite(cmd.columnOffset)
                ? normalizeFlowColumn(cmd.columnOffset)
                : getNextFlowAreaColumnOffset(result),
          },
        ];
        break;
      }
      case "add-cell": {
        const id = cmd.cellId ?? crypto.randomUUID();
        if (result.cells.some((cell) => cell.id === id)) break;
        const areaId = resolveFlowArea(result, cmd.areaId).id;
        const column = resolveFlowInsertColumn(result, cmd.laneId, cmd.column, undefined, areaId);
        result.cells.push({
          id,
          laneId: cmd.laneId,
          column,
          areaId,
          artifact: cmd.artifact,
        });
        break;
      }
      case "remove-cell": {
        const exists = result.cells.some((c) => c.id === cmd.cellId);
        if (!exists) break;
        result.cells = result.cells.filter((c) => c.id !== cmd.cellId);
        result.connections = result.connections.filter(
          (c) => c.fromCellId !== cmd.cellId && c.toCellId !== cmd.cellId,
        );
        break;
      }
      case "add-connection": {
        const fromCell = result.cells.find((c) => c.id === cmd.fromCellId);
        const toCell = result.cells.find((c) => c.id === cmd.toCellId);
        if (!fromCell || !toCell) break;
        if (!isFlowConnectionAllowedBetweenCells(result, fromCell, toCell)) break;
        const normalized = normalizeFlowConnection(result, {
          id: crypto.randomUUID(),
          fromCellId: cmd.fromCellId,
          toCellId: cmd.toCellId,
          sourceHandle: cmd.sourceHandle,
          targetHandle: cmd.targetHandle,
        });
        const dup = result.connections.some(
          (c) =>
            c.fromCellId === normalized.fromCellId &&
            c.toCellId === normalized.toCellId &&
            c.sourceHandle === normalized.sourceHandle &&
            c.targetHandle === normalized.targetHandle,
        );
        if (dup) break;
        result.connections.push(normalized);
        break;
      }
      case "remove-connection": {
        result.connections = result.connections.filter((c) => c.id !== cmd.connectionId);
        break;
      }
      case "move-cell": {
        const cell = result.cells.find((c) => c.id === cmd.cellId);
        if (!cell) break;
        const targetAreaId = resolveFlowArea(result, cmd.toAreaId ?? cell.areaId).id;
        const targetLaneId = cmd.toLaneId ?? cell.laneId;
        const targetColumn = resolveFlowInsertColumn(result, targetLaneId, cmd.toColumn, cell.id, targetAreaId);
        result.cells = result.cells.map((c) => {
          if (c.id !== cmd.cellId) return c;
          return { ...c, column: targetColumn, laneId: targetLaneId, areaId: targetAreaId };
        });
        break;
      }
      case "update-cell": {
        result.cells = result.cells.map((c) => {
          if (c.id !== cmd.cellId) return c;
          return { ...c, artifact: cmd.artifact };
        });
        break;
      }
    }
  }

  result.connections = normalizeAndFilterFlowConnections(result);

  return result;
}

function truncateFlowMutationSummaryText(value: string, maxLength = 52): string {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function describeFlowArtifactForSummary(artifact: FlowArtifact): string {
  switch (artifact.type) {
    case "journey-step":
      return `journey step \"${truncateFlowMutationSummaryText(artifact.text || "Untitled step")}\"`;
    case "technical-brief":
      return `technical brief \"${truncateFlowMutationSummaryText(artifact.title || artifact.language || "Untitled brief")}\"`;
    case "design-frame-ref":
      return `linked screen \"${truncateFlowMutationSummaryText(artifact.frameId)}\"`;
    case "uploaded-image":
      return `uploaded image \"${truncateFlowMutationSummaryText(artifact.label || "image")}\"`;
  }
}

/**
 * Build a human-readable summary of mutation commands.
 */
export function describeFlowMutations(
  commands: FlowMutationCommand[],
  doc: FlowDocument,
): string {
  const normalizedDoc = normalizeFlowDocument(doc);
  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.op) {
      case "create-area":
        parts.push(`Created ${cmd.name?.trim() || getNextFlowAreaName(normalizedDoc)}`);
        break;
      case "add-cell":
        parts.push(`Added ${cmd.artifact.type} to ${FLOW_LANE_LABELS[cmd.laneId]}`);
        break;
      case "remove-cell": {
        const cell = normalizedDoc.cells.find((c) => c.id === cmd.cellId);
        parts.push(`Removed ${cell?.artifact.type ?? "cell"} from ${cell ? FLOW_LANE_LABELS[cell.laneId] : "board"}`);
        break;
      }
      case "add-connection": {
        const from = normalizedDoc.cells.find((c) => c.id === cmd.fromCellId);
        const to = normalizedDoc.cells.find((c) => c.id === cmd.toCellId);
        const fromLabel = from ? `${FLOW_LANE_LABELS[from.laneId]}[${from.column}]` : cmd.fromCellId;
        const toLabel = to ? `${FLOW_LANE_LABELS[to.laneId]}[${to.column}]` : cmd.toCellId;
        parts.push(`Connected ${fromLabel} → ${toLabel}`);
        break;
      }
      case "remove-connection":
        parts.push(`Removed a connection`);
        break;
      case "move-cell":
        parts.push(`Moved cell to column ${cmd.toColumn}`);
        break;
      case "update-cell":
        parts.push(`Updated ${describeFlowArtifactForSummary(cmd.artifact)}`);
        break;
    }
  }
  return parts.join("; ") || "No changes";
}
