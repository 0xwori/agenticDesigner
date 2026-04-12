import type {
  FlowDocument,
  FlowBoardMemoryDocument,
  FlowBoardMemoryJourneyNode,
  FlowBoardMemoryJourneyLaneId,
  FlowBoardMemoryState,
  JourneyStepArtifact,
  TechnicalBriefArtifact,
} from "@designer/shared";
import {
  FLOW_LANE_LABELS,
  FLOW_LANE_ORDER,
  createEmptyFlowBoardMemoryDocument,
  getFlowGlobalColumn,
  normalizeFlowBoardMemoryDocument,
  normalizeFlowDocument,
  resolveFlowArea,
} from "@designer/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { FlowDesignFrameContext } from "./flowFrameContext.js";

const TOP_LEVEL_KEYS = new Set([
  "version",
  "goals",
  "assumptions",
  "entities",
  "screens",
  "journey",
  "technicalNotes",
  "openQuestions",
  "artifactMappings",
]);

const ENTITY_KEYS = new Set(["id", "name", "description"]);
const SCREEN_KEYS = new Set(["id", "title", "frameId", "summary", "notes"]);
const JOURNEY_KEYS = new Set(["id", "title", "lane", "kind", "screenId", "notes"]);
const TECHNICAL_NOTE_KEYS = new Set(["id", "title", "body", "language", "tags"]);
const ARTIFACT_MAPPING_KEYS = new Set(["memoryId", "cellId", "frameId"]);

type MemoryRecord = Record<string, unknown>;

export interface FlowBoardMemoryProjection {
  journeyArtifacts: Array<{
    memoryId: string;
    laneId: FlowBoardMemoryJourneyLaneId;
    artifact: JourneyStepArtifact;
    screenId?: string;
    notes: string[];
  }>;
  technicalArtifacts: Array<{
    memoryId: string;
    artifact: TechnicalBriefArtifact;
    tags: string[];
  }>;
}

export class FlowBoardMemoryParseError extends Error {
  constructor(message: string, readonly path?: string) {
    super(path ? `${message} (${path})` : message);
    this.name = "FlowBoardMemoryParseError";
  }
}

function isRecord(value: unknown): value is MemoryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(record: MemoryRecord, allowedKeys: Set<string>, path: string) {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new FlowBoardMemoryParseError(`Unsupported field \"${key}\".`, path);
    }
  }
}

function parseString(value: unknown, path: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw new FlowBoardMemoryParseError("Expected a string.", path);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    throw new FlowBoardMemoryParseError("Expected a string.", path);
  }

  const normalized = value.trim();
  if (!normalized && required) {
    throw new FlowBoardMemoryParseError("Expected a non-empty string.", path);
  }

  return normalized || undefined;
}

function parseStringList(value: unknown, path: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new FlowBoardMemoryParseError("Expected a list of strings.", path);
  }

  return value.map((item, index) => parseString(item, `${path}[${index}]`) ?? "");
}

function parseRecordList(value: unknown, path: string): MemoryRecord[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new FlowBoardMemoryParseError("Expected a list.", path);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new FlowBoardMemoryParseError("Expected an object entry.", `${path}[${index}]`);
    }
    return item;
  });
}

function parseLane(value: unknown, path: string): FlowBoardMemoryJourneyLaneId {
  const normalized = parseString(value, path, false);
  if (!normalized) {
    return "user-journey";
  }
  if (normalized === "user-journey" || normalized === "normal-flow" || normalized === "unhappy-path") {
    return normalized;
  }
  throw new FlowBoardMemoryParseError("Lane must be one of user-journey, normal-flow, unhappy-path.", path);
}

function parseJourneyKind(value: unknown, path: string): "step" | "decision" {
  const normalized = parseString(value, path, false);
  if (!normalized || normalized === "step") {
    return "step";
  }
  if (normalized === "decision") {
    return "decision";
  }
  throw new FlowBoardMemoryParseError("Journey kind must be either step or decision.", path);
}

function compareFlowCells(
  doc: FlowDocument,
  left: FlowDocument["cells"][number],
  right: FlowDocument["cells"][number],
) {
  const columnDelta = getFlowGlobalColumn(doc, left) - getFlowGlobalColumn(doc, right);
  if (columnDelta !== 0) {
    return columnDelta;
  }

  const laneDelta = FLOW_LANE_ORDER.indexOf(left.laneId) - FLOW_LANE_ORDER.indexOf(right.laneId);
  if (laneDelta !== 0) {
    return laneDelta;
  }

  return left.id.localeCompare(right.id);
}

function toJourneyLaneId(laneId: FlowDocument["cells"][number]["laneId"]): FlowBoardMemoryJourneyLaneId | null {
  if (laneId === "user-journey" || laneId === "normal-flow" || laneId === "unhappy-path") {
    return laneId;
  }
  return null;
}

function getCellMemoryTitle(
  cell: FlowDocument["cells"][number],
  designFramesById: Map<string, FlowDesignFrameContext>,
) {
  switch (cell.artifact.type) {
    case "design-frame-ref":
      return designFramesById.get(cell.artifact.frameId)?.name ?? cell.artifact.frameId;
    case "uploaded-image":
      return cell.artifact.label?.trim() || "Board image";
    case "journey-step":
      return cell.artifact.text.trim() || "Journey step";
    case "technical-brief":
      return cell.artifact.title.trim() || "Technical note";
  }
}

function getOrCreateScreenId(input: {
  cell: FlowDocument["cells"][number];
  screens: FlowBoardMemoryDocument["screens"];
  artifactMappings: FlowBoardMemoryDocument["artifactMappings"];
  screenIdsByKey: Map<string, string>;
  designFramesById: Map<string, FlowDesignFrameContext>;
}) {
  const { cell, screens, artifactMappings, screenIdsByKey, designFramesById } = input;
  if (cell.artifact.type !== "design-frame-ref" && cell.artifact.type !== "uploaded-image") {
    return undefined;
  }

  const key =
    cell.artifact.type === "design-frame-ref"
      ? `frame:${cell.artifact.frameId}`
      : `image:${cell.id}`;
  const existing = screenIdsByKey.get(key);
  if (existing) {
    return existing;
  }

  const nextId = `screen-${screens.length + 1}`;
  screenIdsByKey.set(key, nextId);

  if (cell.artifact.type === "design-frame-ref") {
    const frame = designFramesById.get(cell.artifact.frameId);
    screens.push({
      id: nextId,
      title: frame?.name ?? cell.artifact.frameId,
      frameId: cell.artifact.frameId,
      summary: frame?.summary,
      notes: [],
    });
    artifactMappings.push({
      memoryId: nextId,
      frameId: cell.artifact.frameId,
    });
  } else {
    screens.push({
      id: nextId,
      title: cell.artifact.label?.trim() || `Board image ${screens.length + 1}`,
      summary: undefined,
      notes: [],
    });
  }

  return nextId;
}

function buildJourneyNode(
  cell: FlowDocument["cells"][number],
  designFramesById: Map<string, FlowDesignFrameContext>,
  screenId?: string,
): FlowBoardMemoryJourneyNode | null {
  const laneId = toJourneyLaneId(cell.laneId);
  if (!laneId) {
    return null;
  }

  const title = getCellMemoryTitle(cell, designFramesById);
  if (!title) {
    return null;
  }

  return {
    id: "",
    title,
    laneId,
    kind: cell.artifact.type === "journey-step" && cell.artifact.shape === "diamond" ? "decision" : "step",
    screenId,
    notes: [],
  };
}

export function parseFlowBoardMemoryText(authoredText: string): FlowBoardMemoryDocument {
  const trimmed = authoredText.trim();
  if (!trimmed) {
    return createEmptyFlowBoardMemoryDocument();
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FlowBoardMemoryParseError(`Invalid YAML-like memory document: ${message}`);
  }

  if (parsed === undefined || parsed === null) {
    return createEmptyFlowBoardMemoryDocument();
  }
  if (!isRecord(parsed)) {
    throw new FlowBoardMemoryParseError("Board memory must be a top-level object.", "root");
  }

  assertKnownKeys(parsed, TOP_LEVEL_KEYS, "root");

  const version = parsed.version === undefined ? 1 : Number(parsed.version);
  if (version !== 1) {
    throw new FlowBoardMemoryParseError("Only board memory version 1 is supported.", "version");
  }

  const entities = parseRecordList(parsed.entities, "entities").map((entity, index) => {
    assertKnownKeys(entity, ENTITY_KEYS, `entities[${index}]`);
    return {
      id: parseString(entity.id, `entities[${index}].id`, false) ?? `entity-${index + 1}`,
      name: parseString(entity.name, `entities[${index}].name`) ?? `Entity ${index + 1}`,
      description: parseString(entity.description, `entities[${index}].description`, false),
    };
  });

  const screens = parseRecordList(parsed.screens, "screens").map((screen, index) => {
    assertKnownKeys(screen, SCREEN_KEYS, `screens[${index}]`);
    return {
      id: parseString(screen.id, `screens[${index}].id`, false) ?? `screen-${index + 1}`,
      title: parseString(screen.title, `screens[${index}].title`) ?? `Screen ${index + 1}`,
      frameId: parseString(screen.frameId, `screens[${index}].frameId`, false),
      summary: parseString(screen.summary, `screens[${index}].summary`, false),
      notes: parseStringList(screen.notes, `screens[${index}].notes`),
    };
  });

  const journey = parseRecordList(parsed.journey, "journey").map((node, index) => {
    assertKnownKeys(node, JOURNEY_KEYS, `journey[${index}]`);
    return {
      id: parseString(node.id, `journey[${index}].id`, false) ?? `journey-${index + 1}`,
      title: parseString(node.title, `journey[${index}].title`) ?? `Step ${index + 1}`,
      laneId: parseLane(node.lane, `journey[${index}].lane`),
      kind: parseJourneyKind(node.kind, `journey[${index}].kind`),
      screenId: parseString(node.screenId, `journey[${index}].screenId`, false),
      notes: parseStringList(node.notes, `journey[${index}].notes`),
    };
  });

  const technicalNotes = parseRecordList(parsed.technicalNotes, "technicalNotes").map((note, index) => {
    assertKnownKeys(note, TECHNICAL_NOTE_KEYS, `technicalNotes[${index}]`);
    return {
      id: parseString(note.id, `technicalNotes[${index}].id`, false) ?? `technical-note-${index + 1}`,
      title: parseString(note.title, `technicalNotes[${index}].title`) ?? `Technical note ${index + 1}`,
      body: parseString(note.body, `technicalNotes[${index}].body`) ?? "",
      language: parseString(note.language, `technicalNotes[${index}].language`, false),
      tags: parseStringList(note.tags, `technicalNotes[${index}].tags`),
    };
  });

  const artifactMappings = parseRecordList(parsed.artifactMappings, "artifactMappings").map((mapping, index) => {
    assertKnownKeys(mapping, ARTIFACT_MAPPING_KEYS, `artifactMappings[${index}]`);
    return {
      memoryId: parseString(mapping.memoryId, `artifactMappings[${index}].memoryId`) ?? "",
      cellId: parseString(mapping.cellId, `artifactMappings[${index}].cellId`, false),
      frameId: parseString(mapping.frameId, `artifactMappings[${index}].frameId`, false),
    };
  });

  return normalizeFlowBoardMemoryDocument({
    version: 1,
    goals: parseStringList(parsed.goals, "goals"),
    assumptions: parseStringList(parsed.assumptions, "assumptions"),
    entities,
    screens,
    journey,
    technicalNotes,
    openQuestions: parseStringList(parsed.openQuestions, "openQuestions"),
    artifactMappings,
  });
}

export function serializeFlowBoardMemoryDocument(doc: FlowBoardMemoryDocument): string {
  const normalized = normalizeFlowBoardMemoryDocument(doc);
  const payload: Record<string, unknown> = { version: normalized.version };

  if (normalized.goals.length > 0) payload.goals = normalized.goals;
  if (normalized.assumptions.length > 0) payload.assumptions = normalized.assumptions;
  if (normalized.entities.length > 0) payload.entities = normalized.entities;
  if (normalized.screens.length > 0) payload.screens = normalized.screens;
  if (normalized.journey.length > 0) {
    payload.journey = normalized.journey.map((node) => ({
      id: node.id,
      title: node.title,
      lane: node.laneId,
      kind: node.kind,
      screenId: node.screenId,
      notes: node.notes.length > 0 ? node.notes : undefined,
    }));
  }
  if (normalized.technicalNotes.length > 0) payload.technicalNotes = normalized.technicalNotes;
  if (normalized.openQuestions.length > 0) payload.openQuestions = normalized.openQuestions;
  if (normalized.artifactMappings.length > 0) payload.artifactMappings = normalized.artifactMappings;

  return stringifyYaml(payload, { lineWidth: 0 }).trim();
}

export function createFlowBoardMemoryState(
  input?: Partial<FlowBoardMemoryState> | null,
): FlowBoardMemoryState {
  const snapshot = normalizeFlowBoardMemoryDocument(input?.snapshot);
  const authoredText =
    typeof input?.authoredText === "string" && input.authoredText.trim().length > 0
      ? input.authoredText
      : serializeFlowBoardMemoryDocument(snapshot);
  const updatedAt =
    typeof input?.updatedAt === "string" && Number.isFinite(Date.parse(input.updatedAt))
      ? input.updatedAt
      : new Date().toISOString();

  return {
    authoredText,
    snapshot,
    updatedAt,
  };
}

export function createFlowBoardMemoryStateFromFlowDocument(
  doc: FlowDocument,
  designFrames: FlowDesignFrameContext[] = [],
): FlowBoardMemoryState {
  const normalizedDoc = normalizeFlowDocument(doc);
  const designFramesById = new Map(designFrames.map((frame) => [frame.id, frame]));
  const orderedCells = [...normalizedDoc.cells].sort((left, right) => compareFlowCells(normalizedDoc, left, right));

  const screens: FlowBoardMemoryDocument["screens"] = [];
  const journey: FlowBoardMemoryDocument["journey"] = [];
  const technicalNotes: FlowBoardMemoryDocument["technicalNotes"] = [];
  const artifactMappings: FlowBoardMemoryDocument["artifactMappings"] = [];
  const screenIdsByKey = new Map<string, string>();

  for (const cell of orderedCells) {
    const area = resolveFlowArea(normalizedDoc, cell.areaId);
    const areaNote = (normalizedDoc.areas?.length ?? 0) > 1 ? `Area: ${area.name}` : undefined;
    const laneNote = `Lane: ${FLOW_LANE_LABELS[cell.laneId]}`;
    const screenId = getOrCreateScreenId({
      cell,
      screens,
      artifactMappings,
      screenIdsByKey,
      designFramesById,
    });

    const journeyNode = buildJourneyNode(cell, designFramesById, screenId);
    if (journeyNode) {
      const memoryId = `journey-${journey.length + 1}`;
      journey.push({
        ...journeyNode,
        id: memoryId,
        notes: [areaNote, laneNote].filter((note): note is string => Boolean(note)),
      });
      artifactMappings.push({
        memoryId,
        cellId: cell.id,
        frameId: cell.artifact.type === "design-frame-ref" ? cell.artifact.frameId : undefined,
      });
      continue;
    }

    if (cell.artifact.type === "technical-brief") {
      const memoryId = `technical-note-${technicalNotes.length + 1}`;
      technicalNotes.push({
        id: memoryId,
        title: cell.artifact.title.trim() || `Technical note ${technicalNotes.length + 1}`,
        body: cell.artifact.body,
        language: cell.artifact.language,
        tags: [areaNote, laneNote].filter((note): note is string => Boolean(note)),
      });
      artifactMappings.push({
        memoryId,
        cellId: cell.id,
      });
    }
  }

  return createFlowBoardMemoryState({
    snapshot: {
      version: 1,
      goals: [],
      assumptions: [],
      entities: [],
      screens,
      journey,
      technicalNotes,
      openQuestions: [],
      artifactMappings,
    },
  });
}

export function ensureFlowBoardMemoryDocument(
  doc: FlowDocument,
  designFrames: FlowDesignFrameContext[] = [],
): FlowDocument {
  const normalizedDoc = normalizeFlowDocument(doc);
  if (normalizedDoc.boardMemory) {
    return normalizedDoc;
  }

  return {
    ...normalizedDoc,
    boardMemory: createFlowBoardMemoryStateFromFlowDocument(normalizedDoc, designFrames),
  };
}

export function updateFlowBoardMemoryStateFromText(
  authoredText: string,
  updatedAt = new Date().toISOString(),
): FlowBoardMemoryState {
  const snapshot = parseFlowBoardMemoryText(authoredText);
  return {
    authoredText: authoredText.trim().length > 0 ? authoredText : serializeFlowBoardMemoryDocument(snapshot),
    snapshot,
    updatedAt,
  };
}

export function projectFlowBoardMemoryToArtifacts(doc: FlowBoardMemoryDocument): FlowBoardMemoryProjection {
  const normalized = normalizeFlowBoardMemoryDocument(doc);

  return {
    journeyArtifacts: normalized.journey.map((node) => ({
      memoryId: node.id,
      laneId: node.laneId,
      artifact: {
        type: "journey-step",
        text: node.title,
        shape: node.kind === "decision" ? "diamond" : "rectangle",
      },
      screenId: node.screenId,
      notes: node.notes,
    })),
    technicalArtifacts: normalized.technicalNotes.map((note) => ({
      memoryId: note.id,
      artifact: {
        type: "technical-brief",
        title: note.title,
        language: note.language ?? "text",
        body: note.body,
      },
      tags: note.tags,
    })),
  };
}

export function buildFlowBoardMemoryContext(memory?: FlowBoardMemoryState): string {
  if (!memory) {
    return "Board memory: (none)";
  }

  const snapshot = normalizeFlowBoardMemoryDocument(memory.snapshot);

  return [
    "Board memory:",
    `- goals=${snapshot.goals.length}`,
    `- assumptions=${snapshot.assumptions.length}`,
    `- entities=${snapshot.entities.length}`,
    `- screens=${snapshot.screens.length}`,
    `- journey=${snapshot.journey.length}`,
    `- technicalNotes=${snapshot.technicalNotes.length}`,
    `- openQuestions=${snapshot.openQuestions.length}`,
  ].join("\n");
}