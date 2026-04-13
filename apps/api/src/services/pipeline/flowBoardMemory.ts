import crypto from "node:crypto";

import type {
  FlowBoardMemoryDocument,
  FlowBoardMemoryJourneyLaneId,
  FlowBoardMemoryState,
  FlowDocument,
  FlowLaneId,
  FlowCell,
  JourneyStepArtifact,
  TechnicalBriefArtifact,
} from "@designer/shared";
import {
  createEmptyFlowBoardMemoryDocument,
  normalizeFlowBoardMemoryDocument,
  normalizeFlowDocument,
  resolveFlowArea,
  resolveFlowInsertColumn,
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

export interface FlowBoardMemorySyncResult {
  flowDocument: FlowDocument;
  snapshot: FlowBoardMemoryDocument;
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

function truncateInline(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function appendDetailSection(lines: string[], label: string, values: string[], maxItems = 4) {
  if (values.length === 0) {
    return;
  }

  lines.push(`${label}:`);
  for (const value of values.slice(0, maxItems)) {
    lines.push(`  - ${truncateInline(value)}`);
  }

  if (values.length > maxItems) {
    lines.push(`  - +${values.length - maxItems} more`);
  }
}

function formatAuthoredYamlExcerpt(authoredText: string, maxLines = 18): string[] {
  const trimmed = authoredText.trim();
  if (!trimmed) {
    return [];
  }

  const rawLines = trimmed.split(/\r?\n/).map((line) => line.slice(0, 220));
  const excerpt = rawLines.slice(0, maxLines).map((line) => `  ${line}`);
  if (rawLines.length > maxLines) {
    excerpt.push(`  # ... ${rawLines.length - maxLines} more lines`);
  }
  return excerpt;
}

function isJourneyCell(cell: FlowCell): boolean {
  return cell.artifact.type === "journey-step";
}

function isTechnicalCell(cell: FlowCell): boolean {
  return cell.artifact.type === "technical-brief";
}

function isDesignFrameRefCell(cell: FlowCell): boolean {
  return cell.artifact.type === "design-frame-ref";
}

function hasSameCellId(left?: { cellId?: string }, right?: { cellId?: string }) {
  return typeof left?.cellId === "string" && left.cellId === right?.cellId;
}

function normalizeArtifactMappings(snapshot: FlowBoardMemoryDocument): FlowBoardMemoryDocument["artifactMappings"] {
  const knownMemoryIds = new Set<string>([
    ...snapshot.screens.map((screen) => screen.id),
    ...snapshot.journey.map((node) => node.id),
    ...snapshot.technicalNotes.map((note) => note.id),
  ]);
  const seen = new Set<string>();

  return snapshot.artifactMappings.filter((mapping) => {
    if (!knownMemoryIds.has(mapping.memoryId)) {
      return false;
    }
    if (seen.has(mapping.memoryId)) {
      return false;
    }
    seen.add(mapping.memoryId);
    return true;
  });
}

function buildProjectedMemoryCells(input: {
  flowDocument: FlowDocument;
  snapshot: FlowBoardMemoryDocument;
}): Array<{
  memoryId: string;
  laneId: FlowLaneId;
  artifact: JourneyStepArtifact | TechnicalBriefArtifact;
  cellId: string;
  preferredColumn?: number;
  areaId: string;
}> {
  const normalizedDoc = normalizeFlowDocument(input.flowDocument);
  const snapshot = normalizeFlowBoardMemoryDocument(input.snapshot);
  const mappingByMemoryId = new Map(normalizeArtifactMappings(snapshot).map((mapping) => [mapping.memoryId, mapping]));
  const existingCellsById = new Map(normalizedDoc.cells.map((cell) => [cell.id, cell]));
  const fallbackAreaId = resolveFlowArea(normalizedDoc, undefined).id;

  const projected = projectFlowBoardMemoryToArtifacts(snapshot);
  const projectedCells: Array<{
    memoryId: string;
    laneId: FlowLaneId;
    artifact: JourneyStepArtifact | TechnicalBriefArtifact;
    cellId: string;
    preferredColumn?: number;
    areaId: string;
  }> = [];

  for (const item of projected.journeyArtifacts) {
    const mappedCell = mappingByMemoryId.get(item.memoryId)?.cellId
      ? existingCellsById.get(mappingByMemoryId.get(item.memoryId)?.cellId as string)
      : undefined;
    const existingCell = mappedCell && isJourneyCell(mappedCell) ? mappedCell : undefined;

    projectedCells.push({
      memoryId: item.memoryId,
      laneId: item.laneId,
      artifact: item.artifact,
      cellId: existingCell?.id ?? crypto.randomUUID(),
      preferredColumn: existingCell?.column,
      areaId: existingCell?.areaId ?? fallbackAreaId,
    });
  }

  for (const item of projected.technicalArtifacts) {
    const mappedCell = mappingByMemoryId.get(item.memoryId)?.cellId
      ? existingCellsById.get(mappingByMemoryId.get(item.memoryId)?.cellId as string)
      : undefined;
    const existingCell = mappedCell && isTechnicalCell(mappedCell) ? mappedCell : undefined;

    projectedCells.push({
      memoryId: item.memoryId,
      laneId: "technical-briefing",
      artifact: item.artifact,
      cellId: existingCell?.id ?? crypto.randomUUID(),
      preferredColumn: existingCell?.column,
      areaId: existingCell?.areaId ?? fallbackAreaId,
    });
  }

  return projectedCells;
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

export function syncFlowDocumentWithBoardMemory(
  flowDocument: FlowDocument,
  memoryDocument: FlowBoardMemoryDocument,
): FlowBoardMemorySyncResult {
  const normalizedDoc = normalizeFlowDocument(flowDocument);
  const normalizedSnapshot = normalizeFlowBoardMemoryDocument(memoryDocument);
  const sanitizedMappings = normalizeArtifactMappings(normalizedSnapshot);
  const baseCells = normalizedDoc.cells.filter((cell) => !isJourneyCell(cell) && !isTechnicalCell(cell));
  const projectedCells = buildProjectedMemoryCells({
    flowDocument: normalizedDoc,
    snapshot: {
      ...normalizedSnapshot,
      artifactMappings: sanitizedMappings,
    },
  });

  let nextDoc: FlowDocument = {
    ...normalizedDoc,
    cells: [...baseCells],
    connections: [...normalizedDoc.connections],
  };

  const nextMappings: FlowBoardMemoryDocument["artifactMappings"] = [];
  const existingCellsById = new Map(normalizedDoc.cells.map((cell) => [cell.id, cell]));
  const mappingByMemoryId = new Map(sanitizedMappings.map((mapping) => [mapping.memoryId, mapping]));

  for (const screen of normalizedSnapshot.screens) {
    const mapped = mappingByMemoryId.get(screen.id);
    const mappedCell = mapped?.cellId ? existingCellsById.get(mapped.cellId) : undefined;
    const inferredFrameRefCell = screen.frameId
      ? normalizedDoc.cells.find(
          (cell) => cell.artifact.type === "design-frame-ref" && cell.artifact.frameId === screen.frameId,
        )
      : undefined;
    const cellId = mappedCell && isDesignFrameRefCell(mappedCell)
      ? mappedCell.id
      : inferredFrameRefCell?.id;

    nextMappings.push({
      memoryId: screen.id,
      cellId,
      frameId: screen.frameId,
    });
  }

  for (const projectedCell of projectedCells) {
    const column = resolveFlowInsertColumn(
      nextDoc,
      projectedCell.laneId,
      projectedCell.preferredColumn,
      undefined,
      projectedCell.areaId,
    );

    nextDoc = {
      ...nextDoc,
      cells: [
        ...nextDoc.cells,
        {
          id: projectedCell.cellId,
          laneId: projectedCell.laneId,
          column,
          areaId: projectedCell.areaId,
          artifact: projectedCell.artifact,
        },
      ],
    };

    nextMappings.push({
      memoryId: projectedCell.memoryId,
      cellId: projectedCell.cellId,
    });
  }

  const survivingCellIds = new Set(nextDoc.cells.map((cell) => cell.id));
  nextDoc = {
    ...nextDoc,
    connections: nextDoc.connections.filter(
      (connection) => survivingCellIds.has(connection.fromCellId) && survivingCellIds.has(connection.toCellId),
    ),
  };

  const nextSnapshot = normalizeFlowBoardMemoryDocument({
    ...normalizedSnapshot,
    artifactMappings: nextMappings.filter((mapping, index, array) =>
      array.findIndex((candidate) => candidate.memoryId === mapping.memoryId && hasSameCellId(candidate, mapping)) === index,
    ),
  });
  const nextState = createFlowBoardMemoryState({ snapshot: nextSnapshot });

  return {
    snapshot: nextSnapshot,
    flowDocument: {
      ...nextDoc,
      boardMemory: nextState,
    },
  };
}

export function buildFlowBoardMemoryContext(memory?: FlowBoardMemoryState): string {
  if (!memory) {
    return "Board memory: (none)";
  }

  const snapshot = normalizeFlowBoardMemoryDocument(memory.snapshot);
  const lines = [
    "Board memory:",
    `- updatedAt=${memory.updatedAt}`,
    `- goals=${snapshot.goals.length}`,
    `- assumptions=${snapshot.assumptions.length}`,
    `- entities=${snapshot.entities.length}`,
    `- screens=${snapshot.screens.length}`,
    `- journey=${snapshot.journey.length}`,
    `- technicalNotes=${snapshot.technicalNotes.length}`,
    `- openQuestions=${snapshot.openQuestions.length}`,
    `- artifactMappings=${snapshot.artifactMappings.length}`,
  ];

  appendDetailSection(lines, "Goals", snapshot.goals);
  appendDetailSection(lines, "Assumptions", snapshot.assumptions);
  appendDetailSection(
    lines,
    "Screens",
    snapshot.screens.map((screen) => {
      const parts = [`${screen.id}: \"${screen.title}\"`];
      if (screen.frameId) {
        parts.push(`frameId=${screen.frameId}`);
      }
      if (screen.summary) {
        parts.push(`summary=${screen.summary}`);
      }
      if (screen.notes.length > 0) {
        parts.push(`notes=${screen.notes.join("; ")}`);
      }
      return parts.join(" | ");
    }),
  );
  appendDetailSection(
    lines,
    "Journey",
    snapshot.journey.map((node) => {
      const parts = [`${node.id}: lane=${node.laneId}`, `kind=${node.kind}`, `title=\"${node.title}\"`];
      if (node.screenId) {
        parts.push(`screenId=${node.screenId}`);
      }
      if (node.notes.length > 0) {
        parts.push(`notes=${node.notes.join("; ")}`);
      }
      return parts.join(" | ");
    }),
  );
  appendDetailSection(
    lines,
    "Technical notes",
    snapshot.technicalNotes.map((note) => {
      const parts = [`${note.id}: title=\"${note.title}\"`];
      if (note.language) {
        parts.push(`language=${note.language}`);
      }
      if (note.tags.length > 0) {
        parts.push(`tags=${note.tags.join(", ")}`);
      }
      if (note.body.trim().length > 0) {
        parts.push(`body=${truncateInline(note.body, 160)}`);
      }
      return parts.join(" | ");
    }),
  );
  appendDetailSection(lines, "Open questions", snapshot.openQuestions);
  appendDetailSection(
    lines,
    "Artifact mappings",
    snapshot.artifactMappings.map((mapping) => {
      const parts = [`memoryId=${mapping.memoryId}`];
      if (mapping.cellId) {
        parts.push(`cellId=${mapping.cellId}`);
      }
      if (mapping.frameId) {
        parts.push(`frameId=${mapping.frameId}`);
      }
      return parts.join(" | ");
    }),
  );

  const authoredExcerpt = formatAuthoredYamlExcerpt(memory.authoredText);
  if (authoredExcerpt.length > 0) {
    lines.push("Authored YAML excerpt:");
    lines.push(...authoredExcerpt);
  }

  return lines.join("\n");
}