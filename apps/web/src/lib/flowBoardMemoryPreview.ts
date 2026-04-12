import type { FlowDocument, FrameWithVersions } from "@designer/shared";
import { FLOW_LANE_LABELS, FLOW_LANE_ORDER, getFlowGlobalColumn, normalizeFlowDocument } from "@designer/shared";

function quoteYamlValue(value: string) {
  return JSON.stringify(value);
}

function compareCells(
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

function pushOptionalString(lines: string[], key: string, value: string | undefined, indent = "    ") {
  if (!value) {
    return;
  }
  lines.push(`${indent}${key}: ${quoteYamlValue(value)}`);
}

function pushStringList(lines: string[], key: string, values: string[], indent = "    ") {
  if (values.length === 0) {
    return;
  }

  lines.push(`${indent}${key}:`);
  values.forEach((value) => {
    lines.push(`${indent}  - ${quoteYamlValue(value)}`);
  });
}

export function buildFlowBoardMemoryPreview(doc: FlowDocument, designFrames: FrameWithVersions[]) {
  const authoredText = doc.boardMemory?.authoredText?.trim();
  if (authoredText) {
    return authoredText;
  }

  const normalizedDoc = normalizeFlowDocument(doc);
  const frameNamesById = new Map(designFrames.map((frame) => [frame.id, frame.name]));
  const screenIdsByKey = new Map<string, string>();
  const screens: Array<{ id: string; title: string; frameId?: string }> = [];
  const journey: Array<{ id: string; title: string; lane: string; kind: string; screenId?: string; notes: string[] }> = [];
  const technicalNotes: Array<{ id: string; title: string; body: string; language?: string; tags: string[] }> = [];
  const artifactMappings: Array<{ memoryId: string; cellId?: string; frameId?: string }> = [];

  const orderedCells = [...normalizedDoc.cells].sort((left, right) => compareCells(normalizedDoc, left, right));

  for (const cell of orderedCells) {
    let screenId: string | undefined;

    if (cell.artifact.type === "design-frame-ref") {
      const key = `frame:${cell.artifact.frameId}`;
      screenId = screenIdsByKey.get(key);
      if (!screenId) {
        screenId = `screen-${screens.length + 1}`;
        screenIdsByKey.set(key, screenId);
        screens.push({
          id: screenId,
          title: frameNamesById.get(cell.artifact.frameId) ?? cell.artifact.frameId,
          frameId: cell.artifact.frameId,
        });
        artifactMappings.push({ memoryId: screenId, frameId: cell.artifact.frameId });
      }
    }

    if (cell.artifact.type === "uploaded-image") {
      const key = `image:${cell.id}`;
      screenId = screenIdsByKey.get(key);
      if (!screenId) {
        screenId = `screen-${screens.length + 1}`;
        screenIdsByKey.set(key, screenId);
        screens.push({
          id: screenId,
          title: cell.artifact.label?.trim() || `Board image ${screens.length + 1}`,
        });
      }
    }

    if (cell.laneId !== "technical-briefing") {
      let title: string | undefined;
      let kind = "step";

      if (cell.artifact.type === "journey-step") {
        title = cell.artifact.text.trim() || "Journey step";
        kind = cell.artifact.shape === "diamond" ? "decision" : "step";
      } else if (cell.artifact.type === "design-frame-ref") {
        title = frameNamesById.get(cell.artifact.frameId) ?? cell.artifact.frameId;
      } else if (cell.artifact.type === "uploaded-image") {
        title = cell.artifact.label?.trim() || "Board image";
      }

      if (title) {
        const memoryId = `journey-${journey.length + 1}`;
        journey.push({
          id: memoryId,
          title,
          lane: cell.laneId,
          kind,
          screenId,
          notes: [`Lane: ${FLOW_LANE_LABELS[cell.laneId]}`],
        });
        artifactMappings.push({
          memoryId,
          cellId: cell.id,
          frameId: cell.artifact.type === "design-frame-ref" ? cell.artifact.frameId : undefined,
        });
      }
      continue;
    }

    if (cell.artifact.type === "technical-brief") {
      const memoryId = `technical-note-${technicalNotes.length + 1}`;
      technicalNotes.push({
        id: memoryId,
        title: cell.artifact.title.trim() || `Technical note ${technicalNotes.length + 1}`,
        body: cell.artifact.body,
        language: cell.artifact.language,
        tags: ["Lane: Technical Briefing"],
      });
      artifactMappings.push({ memoryId, cellId: cell.id });
    }
  }

  const lines = ["version: 1"];

  if (screens.length > 0) {
    lines.push("screens:");
    screens.forEach((screen) => {
      lines.push(`  - id: ${quoteYamlValue(screen.id)}`);
      lines.push(`    title: ${quoteYamlValue(screen.title)}`);
      pushOptionalString(lines, "frameId", screen.frameId);
    });
  }

  if (journey.length > 0) {
    lines.push("journey:");
    journey.forEach((node) => {
      lines.push(`  - id: ${quoteYamlValue(node.id)}`);
      lines.push(`    title: ${quoteYamlValue(node.title)}`);
      lines.push(`    lane: ${node.lane}`);
      lines.push(`    kind: ${node.kind}`);
      pushOptionalString(lines, "screenId", node.screenId);
      pushStringList(lines, "notes", node.notes);
    });
  }

  if (technicalNotes.length > 0) {
    lines.push("technicalNotes:");
    technicalNotes.forEach((note) => {
      lines.push(`  - id: ${quoteYamlValue(note.id)}`);
      lines.push(`    title: ${quoteYamlValue(note.title)}`);
      lines.push(`    body: ${quoteYamlValue(note.body)}`);
      pushOptionalString(lines, "language", note.language);
      pushStringList(lines, "tags", note.tags);
    });
  }

  if (artifactMappings.length > 0) {
    lines.push("artifactMappings:");
    artifactMappings.forEach((mapping) => {
      lines.push(`  - memoryId: ${quoteYamlValue(mapping.memoryId)}`);
      pushOptionalString(lines, "cellId", mapping.cellId);
      pushOptionalString(lines, "frameId", mapping.frameId);
    });
  }

  return lines.join("\n");
}