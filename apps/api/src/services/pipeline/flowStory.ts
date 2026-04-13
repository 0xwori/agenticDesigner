import type { ComposerAttachment, FlowDocument, FlowStory, FlowStoryAcceptanceCriteriaGroup, ProviderId } from "@designer/shared";
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
  summary?: string;
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
  "Export this flow board using the Politie MMA TPM user story template.";

const SYSTEM_PROMPT = `You are a highly skilled Technical Product Manager (TPM) specialized in the tech space.

Make strong business decisions while going deep on technical details, programming implications, and UI/UX quality.
Your primary focus is to advise, architect solutions, write user stories, and design workflows for the Politie MMA Team.
You support Burgernet, NL-Alert, and the 112NL App when the board context is relevant, but you must not invent domain details that are not present in the board.

You will receive a flow board context for one selected board only.
Write a single small, simple, straight-to-the-point user story export that is valuable to developers, testers, and non-technical stakeholders.

Requirements:
- Analyze the full board, including user journey, normal flow, unhappy path, and technical briefing lanes.
- Capture missing but implied edge cases when the board strongly suggests them.
- Keep the story concise, implementation-ready, and inclusive.
- Set the title to this style: "[Platform: APP|Backend|WEB|ENABLER] Short title".
- Use the Goal field for the short value summary; do not add filler.
- Starting Point should be a short list of where the user begins this flow.
- If a design reference is missing, say "Not available in board context" instead of inventing one.
- Acceptance criteria must stay short and simple, grouped by behavior or logic sections, and use "If ..., then ..." style where possible.
- Phrase keys must be scoped, descriptive, and include general_ keys when reuse is implied.
- When phrase keys map to visible UI copy, format them as strings like key_name: "Visible text" using exact or near-exact text from provided screen summaries and uploaded images whenever possible.
- Technical briefing should mention endpoints, backend conditions, user states, frontend logic, cache, refresh-on-load, auth/session, SDKs, or integrations when relevant.
- Accessibility requirements should cover dynamic type, dark mode, landscape, and VoiceOver/TalkBack unless the board clearly justifies an exception.
- Do not invent new screens or boards that are not supported by the board context.

Return ONLY valid JSON with this exact shape:
{
  "title": "string",
  "goal": "string",
  "userContext": {
    "startingPoint": ["string"]
  },
  "design": {
    "reference": "string"
  },
  "acceptanceCriteriaSections": [
    {
      "section": "string",
      "items": ["string"]
    }
  ],
  "phraseKeys": ["string"],
  "technicalBriefing": ["string"],
  "accessibilityRequirements": ["string"]
}`;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAcceptanceCriteriaGroups(value: unknown): FlowStoryAcceptanceCriteriaGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as { section?: unknown; title?: unknown; items?: unknown };
      const title = typeof candidate.section === "string"
        ? candidate.section.trim()
        : typeof candidate.title === "string"
          ? candidate.title.trim()
          : "";
      const items = normalizeStringArray(candidate.items);

      if (!title || items.length === 0) {
        return null;
      }

      return { title, items };
    })
    .filter((group): group is FlowStoryAcceptanceCriteriaGroup => Boolean(group));
}

function inferMimeTypeFromDataUrl(dataUrl: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1];
}

function buildFlowStoryImageAttachments(doc: FlowDocument): ComposerAttachment[] {
  const attachments: ComposerAttachment[] = [];
  const seen = new Set<string>();

  for (const cell of doc.cells) {
    if (cell.artifact.type !== "uploaded-image") {
      continue;
    }

    const dataUrl = typeof cell.artifact.dataUrl === "string" ? cell.artifact.dataUrl.trim() : "";
    if (!dataUrl || seen.has(dataUrl)) {
      continue;
    }

    seen.add(dataUrl);
    attachments.push({
      id: `flow-story-image-${cell.id}`,
      type: "image",
      status: "uploaded",
      name: cell.artifact.label ?? `Board image ${attachments.length + 1}`,
      mimeType: inferMimeTypeFromDataUrl(dataUrl),
      dataUrl,
    });

    if (attachments.length >= 6) {
      break;
    }
  }

  return attachments;
}

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
        const summary = refFrame?.summary ? ` | summary: ${refFrame.summary}` : "";
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: screen "${refFrame?.name ?? artifact.frameId}"${summary}`;
      }
      case "journey-step":
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: step "${artifact.text}" shape="${artifact.shape ?? "rectangle"}"`;
      case "technical-brief":
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: technical brief "${artifact.title}" language="${artifact.language}"`;
      case "uploaded-image":
        return `  - cell "${cell.id}" lane="${laneLabel}" area="${area.name}" globalCol=${globalColumn}: image "${artifact.label ?? "Untitled image"}"${artifact.dataUrl ? ` | image attachment id: flow-story-image-${cell.id}` : ""}`;
    }
  });

  const connectionLines = normalizedDoc.connections.map(
    (connection) => `  - "${connection.fromCellId}" -> "${connection.toCellId}"`,
  );

  const frameLines = frames.map((frame) => `  - id="${frame.id}" name="${frame.name}"${frame.summary ? `\n    summary: ${frame.summary}` : ""}`);
  const boardMemoryContext = buildFlowBoardMemoryContext(normalizedDoc.boardMemory);
  const imageAttachmentLines = buildFlowStoryImageAttachments(normalizedDoc).map(
    (attachment) => `  - id="${attachment.id}" name="${attachment.name ?? attachment.id}"`,
  );

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

Uploaded image attachments available to inspect:
${imageAttachmentLines.join("\n") || "  (none)"}

${boardMemoryContext}`;
}

function parseFlowStory(content: string): Omit<FlowStory, "generatedAt" | "sourcePrompt"> | null {
  const trimmed = content.trim();
  const normalized = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;

    if (typeof parsed.title !== "string") {
      return null;
    }

    const legacyUserStory = typeof parsed.userStory === "string" ? parsed.userStory.trim() : "";
    const goal = typeof parsed.goal === "string" ? parsed.goal.trim() : legacyUserStory;
    const parsedUserContext = parsed.userContext && typeof parsed.userContext === "object"
      ? parsed.userContext as { startingPoint?: unknown }
      : null;
    const parsedDesign = parsed.design && typeof parsed.design === "object"
      ? parsed.design as { reference?: unknown }
      : null;

    const acceptanceCriteriaGroups = normalizeAcceptanceCriteriaGroups(parsed.acceptanceCriteriaSections);
    const legacyAcceptanceCriteria = normalizeStringArray(parsed.acceptanceCriteria);
    const acceptanceCriteria = acceptanceCriteriaGroups.length > 0
      ? acceptanceCriteriaGroups.flatMap((group) => group.items)
      : legacyAcceptanceCriteria;

    const technicalBriefing = normalizeStringArray(parsed.technicalBriefing);
    const technicalNotes = technicalBriefing.length > 0
      ? technicalBriefing
      : normalizeStringArray(parsed.technicalNotes);

    const startingPoint = normalizeStringArray(parsedUserContext?.startingPoint);
    const phraseKeys = normalizeStringArray(parsed.phraseKeys);
    const accessibilityRequirements = normalizeStringArray(parsed.accessibilityRequirements);
    const designReference = typeof parsedDesign?.reference === "string"
      ? parsedDesign.reference.trim() || null
      : null;

    if (acceptanceCriteria.length === 0) {
      return null;
    }

    return {
      title: parsed.title.trim() || "Flow board story",
      userStory: goal || legacyUserStory || "Implement the selected flow.",
      goal: goal || legacyUserStory || "Implement the selected flow.",
      startingPoint,
      designReference,
      acceptanceCriteria,
      acceptanceCriteriaGroups: acceptanceCriteriaGroups.length > 0 ? acceptanceCriteriaGroups : undefined,
      phraseKeys,
      technicalNotes,
      technicalBriefing,
      accessibilityRequirements,
    };
  } catch {
    return null;
  }
}

export async function generateFlowStory(input: FlowStoryInput): Promise<FlowStoryResult> {
  const normalizedDoc = normalizeFlowDocument(input.flowDocument);
  const prompt = input.prompt?.trim() || DEFAULT_STORY_PROMPT;
  const context = buildFlowStoryContext(normalizedDoc, input.designFrames);
  const attachments = buildFlowStoryImageAttachments(normalizedDoc);

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    timeoutMs: 30_000,
    attachments,
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