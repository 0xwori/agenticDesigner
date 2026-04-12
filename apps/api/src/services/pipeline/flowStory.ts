import type { FlowDocument, FlowStory, ProviderId } from "@designer/shared";
import {
  FLOW_LANE_LABELS,
  FLOW_LANE_ORDER,
  getFlowGlobalColumn,
  normalizeFlowDocument,
  resolveFlowArea,
  summarizeFlowDocument,
} from "@designer/shared";

import { requestCompletion } from "../llmProviders.js";
import { buildFlowBoardMemoryContext } from "./flowBoardMemory.js";

interface DesignFrameInfo {
  id: string;
  name: string;
}

export interface FlowStoryInput {
  prompt?: string;
  flowDocument: FlowDocument;
  designFrames: DesignFrameInfo[];
  provider: ProviderId;
  model: string;
  apiKey?: string;
}

export interface FlowStoryResult {
  story: FlowStory;
  updatedDocument: FlowDocument;
  summary: string;
}

const DEFAULT_STORY_PROMPT =
  "Export this flow board as a user story with concise acceptance criteria and technical notes.";

const SYSTEM_PROMPT = `You are a senior product manager and technical designer.

You will receive a flow board context for one selected board only.
Write a single user story export that helps a product or engineering team implement the flow.

Requirements:
- Analyze the full board, including user journey, normal flow, unhappy path, and technical briefing lanes.
- Capture missing but implied edge cases when the board strongly suggests them.
- Keep the user story concise and implementation-ready.
- Technical notes should mention API, SDK, auth/session, refresh-on-load, cache/state, or integrations when relevant.
- Do not invent new screens or boards that are not supported by the board context.

Return ONLY valid JSON with this exact shape:
{
  "title": "string",
  "userStory": "string",
  "acceptanceCriteria": ["string"],
  "technicalNotes": ["string"]
}`;

function buildFlowStoryContext(doc: FlowDocument, frames: DesignFrameInfo[]): string {
  const normalizedDoc = normalizeFlowDocument(doc);
  const summary = summarizeFlowDocument(normalizedDoc);

  const areaLines = (normalizedDoc.areas ?? []).map(
    (area) => `  - area "${area.name}" id="${area.id}" columnOffset=${area.columnOffset}`,
  );

  const cellLines = normalizedDoc.cells.map((cell) => {
    const area = resolveFlowArea(normalizedDoc, cell.areaId);
    const globalColumn = getFlowGlobalColumn(normalizedDoc, cell);
    const laneLabel = FLOW_LANE_LABELS[cell.laneId];
    const artifact = cell.artifact;

    switch (artifact.type) {
      case "design-frame-ref": {
        const refFrame = frames.find((frame) => frame.id === artifact.frameId);
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: screen "${refFrame?.name ?? artifact.frameId}"`;
      }
      case "journey-step":
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: step "${artifact.text}" shape="${artifact.shape ?? "rectangle"}"`;
      case "technical-brief":
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: technical brief "${artifact.title}" language="${artifact.language}"`;
      case "uploaded-image":
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: image "${artifact.label ?? "Untitled image"}"`;
    }
  });

  const connectionLines = normalizedDoc.connections.map(
    (connection) => `  - "${connection.fromCellId}" -> "${connection.toCellId}"`,
  );

  const frameLines = frames.map((frame) => `  - id="${frame.id}" name="${frame.name}"`);
  const boardMemoryContext = buildFlowBoardMemoryContext(normalizedDoc.boardMemory);

  return `Flow board summary:
- cells=${summary.cellCount}
- connections=${summary.connectionCount}
- lane counts=${FLOW_LANE_ORDER.map((laneId) => `${laneId}:${summary.laneArtifactCounts[laneId]}`).join(", ")}

Areas:
${areaLines.join("\n") || "  (none)"}

Cells:
${cellLines.join("\n") || "  (none)"}

Connections:
${connectionLines.join("\n") || "  (none)"}

Available design frames:
${frameLines.join("\n") || "  (none)"}

${boardMemoryContext}`;
}

function parseFlowStory(content: string): Omit<FlowStory, "generatedAt" | "sourcePrompt"> | null {
  const trimmed = content.trim();
  const normalized = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.userStory !== "string" ||
      !Array.isArray(parsed.acceptanceCriteria) ||
      !Array.isArray(parsed.technicalNotes)
    ) {
      return null;
    }

    const acceptanceCriteria = parsed.acceptanceCriteria
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    const technicalNotes = parsed.technicalNotes
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);

    if (acceptanceCriteria.length === 0) {
      return null;
    }

    return {
      title: parsed.title.trim() || "Flow board story",
      userStory: parsed.userStory.trim(),
      acceptanceCriteria,
      technicalNotes,
    };
  } catch {
    return null;
  }
}

export async function generateFlowStory(input: FlowStoryInput): Promise<FlowStoryResult> {
  const normalizedDoc = normalizeFlowDocument(input.flowDocument);
  const prompt = input.prompt?.trim() || DEFAULT_STORY_PROMPT;
  const context = buildFlowStoryContext(normalizedDoc, input.designFrames);

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    timeoutMs: 30_000,
    system: SYSTEM_PROMPT,
    prompt: `${context}\n\nUser request: ${prompt}`,
  });

  const parsed = parseFlowStory(completion.content);
  if (!parsed) {
    throw new Error("Flow story response was not valid JSON.");
  }

  const story: FlowStory = {
    ...parsed,
    generatedAt: new Date().toISOString(),
    sourcePrompt: prompt,
  };

  return {
    story,
    updatedDocument: {
      ...normalizedDoc,
      story,
    },
    summary: `Generated story with ${story.acceptanceCriteria.length} acceptance criteria.`,
  };
}