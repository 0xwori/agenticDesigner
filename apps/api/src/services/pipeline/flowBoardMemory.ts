import type {
  FlowBoardMemoryDocument,
  FlowBoardMemoryJourneyLaneId,
  FlowBoardMemoryState,
  JourneyStepArtifact,
  TechnicalBriefArtifact,
} from "@designer/shared";
import {
  createEmptyFlowBoardMemoryDocument,
  normalizeFlowBoardMemoryDocument,
} from "@designer/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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