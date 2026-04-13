import crypto from "node:crypto";

import type { ComposerAttachment, FlowDocument, FlowLaneId, ProviderId } from "@designer/shared";
import {
  type FlowMutationCommand,
  applyFlowMutations,
  describeFlowMutations,
  FLOW_LANE_LABELS,
  FLOW_LANE_ORDER,
  getFlowGlobalColumn,
  normalizeFlowDocument,
  resolveFlowArea,
} from "@designer/shared";
import { requestCompletion } from "../llmProviders.js";
import { buildFlowBoardMemoryContext } from "./flowBoardMemory.js";

interface DesignFrameInfo {
  id: string;
  name: string;
  summary?: string;
}

type VisionAttachment = ComposerAttachment & {
  width?: number;
  height?: number;
};

interface FlowActionInput {
  prompt: string;
  flowDocument: FlowDocument;
  designFrames: DesignFrameInfo[];
  provider: ProviderId;
  model: string;
  apiKey?: string;
  attachments?: ComposerAttachment[];
  focusedAreaId?: string;
}

interface FlowActionResult {
  commands: FlowMutationCommand[];
  updatedDocument: FlowDocument;
  summary: string;
}

export const REVIEW_REQUIRED_FLOW_MUTATION_OPS = new Set<FlowMutationCommand["op"]>([
  "remove-cell",
  "remove-connection",
  "move-cell",
  "update-cell",
]);

export interface AddAttachmentImageCommand {
  op: "add-attachment-image";
  attachmentId: string;
  laneId: FlowLaneId;
  areaId?: string;
  column?: number;
  cellId?: string;
  label?: string;
}

export type FlowActionCommand = FlowMutationCommand | AddAttachmentImageCommand;

function isFlowLaneId(value: unknown): value is FlowLaneId {
  return typeof value === "string" && FLOW_LANE_ORDER.includes(value as FlowLaneId);
}

function listImageAttachments(attachments?: ComposerAttachment[]) {
  return (attachments ?? []).filter(
    (attachment) => attachment.type === "image" && attachment.dataUrl && attachment.status !== "failed",
  );
}

function getAttachmentSize(
  attachment: ComposerAttachment,
): { width?: number; height?: number } {
  const sizedAttachment = attachment as ComposerAttachment & {
    width?: number;
    height?: number;
  };

  return {
    width: typeof sizedAttachment.width === "number" ? sizedAttachment.width : undefined,
    height: typeof sizedAttachment.height === "number" ? sizedAttachment.height : undefined,
  };
}

function sanitizeContextText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toContextSnippet(value: string, maxLength = 180): string {
  const normalized = sanitizeContextText(value).replace(/"/g, "'");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function inferMimeTypeFromDataUrl(dataUrl: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1]?.trim() || undefined;
}

function buildVisionAttachments(doc: FlowDocument, attachments?: ComposerAttachment[]): VisionAttachment[] {
  const merged: VisionAttachment[] = [];
  const seenKeys = new Set<string>();

  const pushAttachment = (attachment: VisionAttachment) => {
    const key = attachment.dataUrl?.trim() || attachment.id.trim();
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    merged.push(attachment);
  };

  for (const attachment of listImageAttachments(attachments) as VisionAttachment[]) {
    pushAttachment(attachment);
  }

  for (const cell of doc.cells) {
    if (merged.length >= 6) {
      break;
    }
    if (cell.artifact.type !== "uploaded-image" || typeof cell.artifact.dataUrl !== "string") {
      continue;
    }

    pushAttachment({
      id: `board-image-${cell.id}`,
      type: "image",
      status: "uploaded",
      name: cell.artifact.label?.trim() || `Board image ${cell.id}`,
      mimeType: inferMimeTypeFromDataUrl(cell.artifact.dataUrl),
      dataUrl: cell.artifact.dataUrl,
      width: cell.artifact.width,
      height: cell.artifact.height,
    });
  }

  return merged.slice(0, 6);
}

function buildFlowContext(
  doc: FlowDocument,
  frames: DesignFrameInfo[],
  focusedAreaId?: string,
  attachments?: ComposerAttachment[],
): string {
  const normalizedDoc = normalizeFlowDocument(doc);
  const focusedArea = resolveFlowArea(normalizedDoc, focusedAreaId);

  const areaLines = (normalizedDoc.areas ?? []).map((area) => {
    const focusedLabel = area.id === focusedArea.id ? " [focused]" : "";
    return `  - area "${area.name}" id="${area.id}" columnOffset=${area.columnOffset}${focusedLabel}`;
  });

  const cellLines = normalizedDoc.cells.map((cell) => {
    const artifact = cell.artifact;
    const area = resolveFlowArea(normalizedDoc, cell.areaId);
    let label: string = artifact.type;

    if (artifact.type === "design-frame-ref") {
      const frame = frames.find((candidate) => candidate.id === artifact.frameId);
      const summary = frame?.summary ? ` | summary: ${toContextSnippet(frame.summary)}` : "";
      label = `design-frame-ref → "${frame?.name ?? artifact.frameId}"${summary}`;
    } else if (artifact.type === "journey-step") {
      label = `journey-step: text="${toContextSnippet(artifact.text, 160)}" shape="${artifact.shape === "diamond" ? "diamond" : "rectangle"}"`;
    } else if (artifact.type === "technical-brief") {
      const title = toContextSnippet(artifact.title, 90) || "Untitled";
      const language = artifact.language.trim();
      const body = toContextSnippet(artifact.body, 220);
      label = `technical-brief: title="${title}"${language ? ` language="${language.replace(/"/g, "'")}"` : ""}${body ? ` body="${body}"` : ""}`;
    } else if (artifact.type === "uploaded-image") {
      const size =
        typeof artifact.width === "number" && typeof artifact.height === "number"
          ? ` (${artifact.width}x${artifact.height})`
          : "";
      const rawLabel = artifact.label?.trim() || "image";
      const labelType = isGenericUploadedImageLabel(rawLabel) ? "generic screenshot label" : "label";
      label = `uploaded-image: ${labelType} "${toContextSnippet(rawLabel, 90)}"${size} | vision attachment id: "board-image-${cell.id}"`;
    }

    return `  - cell "${cell.id}" in area "${area.name}" (id: "${area.id}") lane "${cell.laneId}" local col ${cell.column} global col ${getFlowGlobalColumn(normalizedDoc, cell)}: ${label}`;
  });

  const connectionLines = normalizedDoc.connections.map((connection) => {
    const handles =
      connection.sourceHandle || connection.targetHandle
        ? ` [${connection.sourceHandle ?? "?"} -> ${connection.targetHandle ?? "?"}]`
        : "";
    return `  - "${connection.fromCellId}" → "${connection.toCellId}"${handles} (id: "${connection.id}")`;
  });

  const frameLines = frames.map((frame) => {
    const summary = typeof frame.summary === "string" ? sanitizeContextText(frame.summary) : "";
    return summary.length > 0
      ? `  - id="${frame.id}" name="${frame.name}"\n    summary: ${summary}`
      : `  - id="${frame.id}" name="${frame.name}"`;
  });
  const attachmentLines = listImageAttachments(attachments).map((attachment) => {
    const name = attachment.name?.trim() || "Attached image";
    return `  - attachment "${attachment.id}" name="${name}"`;
  });

  const importedSourceLines = (normalizedDoc.importedSourceFrameIds ?? []).map(
    (frameId) => `  - imported source frame id="${frameId}"`,
  );
  const boardMemoryContext = buildFlowBoardMemoryContext(normalizedDoc.boardMemory);

  return `Current flow document:
Areas (${normalizedDoc.areas?.length ?? 0}):
${areaLines.join("\n") || "  (none)"}
Focused area: "${focusedArea.name}" (id: "${focusedArea.id}")
Lanes: ${FLOW_LANE_ORDER.join(", ")}
Cells (${normalizedDoc.cells.length}):
${cellLines.join("\n") || "  (none)"}
Connections (${normalizedDoc.connections.length}):
${connectionLines.join("\n") || "  (none)"}

Imported source frames:
${importedSourceLines.join("\n") || "  (none)"}

Available design frames:
${frameLines.join("\n") || "  (none)"}

Available image attachments:
${attachmentLines.join("\n") || "  (none)"}

${boardMemoryContext}`;
}

const SYSTEM_PROMPT = `You are a flow-board assistant for a UI design tool. The user has a flow board with swim lanes and wants to make changes.

Available mutation commands (return them inside a JSON object with a \"commands\" array):
- {"op":"add-cell","laneId":"<lane>","artifact":<artifact>,"areaId":"<optional area-id>","column":<optional int>,"cellId":"<optional stable ref>"}
  artifact can be:
    {"type":"design-frame-ref","frameId":"<id>"}
    {"type":"journey-step","text":"<text>","shape":"rectangle"|"diamond"}
      shape "rectangle" = normal process step, shape "diamond" = decision point
    {"type":"technical-brief","title":"<t>","language":"<lang>","body":"<code>"}
    {"type":"uploaded-image","dataUrl":"<url>","label":"<label>"}
- {"op":"add-attachment-image","attachmentId":"<attachment-id>","laneId":"<lane>","areaId":"<optional area-id>","column":<optional int>,"cellId":"<required if you reference it later>","label":"<optional label>"}
- {"op":"remove-cell","cellId":"<id>"}
- {"op":"add-connection","fromCellId":"<id>","toCellId":"<id>","sourceHandle":"top|right|bottom|left","targetHandle":"top-target|right-target|bottom-target|left-target"}
- {"op":"remove-connection","connectionId":"<id>"}
- {"op":"move-cell","cellId":"<id>","toColumn":<int>,"toLaneId":"<optional lane>","toAreaId":"<optional area-id>"}
- {"op":"update-cell","cellId":"<id>","artifact":<artifact>}

Valid lanes: ${FLOW_LANE_ORDER.join(", ")}
Lane labels: ${FLOW_LANE_ORDER.map((lane) => `${lane} = "${FLOW_LANE_LABELS[lane]}"`).join(", ")}

Connection rules:
- Connections are directional.
- Reverse-direction edges are allowed.
- Preserve or choose meaningful side handles when connecting screens or steps.
- This route edits the currently selected flow board only.
- Do not create new boards or new areas in this route.
- If you reference a newly inserted attachment later in the same response, give it a stable "cellId" and reuse that same id in later commands.
- Areas are legacy compatibility only. If the current board already has areas, you may target one of the existing area ids from the context.
- If the user does not specify an area, use the focused area from the context for newly added content.
- Never create cross-area connections.

Board analysis rules:
- Treat the selected board as a full user-journey artifact, not a single-node edit surface.
- When the user asks for analysis, improvement, refinement, or cleanup, review the whole board before deciding what to mutate.
- Look for missing happy-path steps, unhappy-path branches, recovery loops, and edge cases implied by the existing sequence.
- Add concise technical-brief artifacts when the flow implies integration or delivery concerns such as API calls, SDK use, auth/session handling, cache/state sync, refresh-on-load behavior, retries, or async failure recovery.
- Prefer improving the existing structure over rewriting the whole board.
- Keep all edits scoped to the current board. Never reference or mutate sibling flow boards.

ERD / Flow Diagram Rules:
- When the user asks for an ERD, user flow, or flow diagram, create journey-step cells in the "user-journey" lane.
- Use shape "rectangle" for process steps (actions the user takes).
- Use shape "diamond" for decision points (yes/no branches, conditionals).
- Connect steps sequentially with add-connection commands.
- For decisions, connect the diamond to multiple outcomes (branching paths).
- For explicit binary choices, create exactly one diamond decision node and branch it into two outcomes labeled "yes" and "no".
- If the user appears to have a typo in a binary choice prompt, normalize the second branch to "no" when the intent is clearly yes/no.

Image Analysis:
- When an uploaded-image cell includes a "vision attachment id" in the context, inspect the corresponding provided image contents before deciding how the board should change.
- When uploaded images already exist on the board, analyze their labels/context to understand the screens they represent.
- When an image attachment is available and the user wants it on the board, use add-attachment-image rather than embedding a raw data URL.
- Create journey steps that describe the user flow between image/screens, connecting them with add-connection.
- Infer screen transitions, decision points, and error paths from the screen context.

Artifact editing rules:
- When the user asks to edit, rename, rewrite, shorten, expand, fix, or update an existing card, prefer "update-cell" with the exact existing "cellId" from the current board context.
- Preserve the existing artifact type when editing a cell unless the user explicitly asks to convert it.
- Do not remove and recreate a cell when an in-place "update-cell" is sufficient.
- For "update-cell", always return the full replacement artifact object, not a partial diff.
- If you update a journey step, return its full "text" and "shape".
- If you update a technical brief, return its full "title", "language", and "body".

When connecting frames, use cell IDs, not frame IDs. Match frame names from the user's prompt to the available design frames listed in the context.

Return ONLY a JSON object with this shape: {"commands":[...]}. No explanation text.`;

const FLOW_ACTION_RESPONSE_KEYS = [
  "commands",
  "mutations",
  "operations",
  "ops",
  "actions",
  "edits",
  "result",
  "content",
] as const;

const DIRECT_STEP_PROMPT_PREFIX = /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?(?:add|insert|append)\b/i;

const STEP_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function filterFlowActionCommandArray(value: unknown): FlowActionCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((command: unknown) => {
    if (typeof command !== "object" || command === null) {
      return false;
    }
    const record = command as Record<string, unknown>;
    return typeof record.op === "string";
  }) as FlowActionCommand[];
}

function collectJsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  pushCandidate(trimmed);

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const block = match[1];
    if (typeof block === "string") {
      pushCandidate(block);
    }
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    pushCandidate(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    pushCandidate(trimmed.slice(objectStart, objectEnd + 1));
  }

  return candidates;
}

function extractFlowActionCommands(payload: unknown): FlowActionCommand[] {
  const directCommands = filterFlowActionCommandArray(payload);
  if (directCommands.length > 0 || Array.isArray(payload)) {
    return directCommands;
  }

  if (typeof payload === "string") {
    return parseFlowActionCommands(payload);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  for (const key of FLOW_ACTION_RESPONSE_KEYS) {
    if (!(key in record)) {
      continue;
    }
    const nestedCommands = extractFlowActionCommands(record[key]);
    if (nestedCommands.length > 0 || Array.isArray(record[key])) {
      return nestedCommands;
    }
  }

  return [];
}

function parseFlowActionCommands(content: string): FlowActionCommand[] {
  for (const candidate of collectJsonCandidates(content)) {
    try {
      return extractFlowActionCommands(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return [];
}

function getRequestedCellId(command: FlowActionCommand): string | undefined {
  if ("cellId" in command && typeof command.cellId === "string" && command.cellId.trim().length > 0) {
    return command.cellId.trim();
  }
  return undefined;
}

function getRequestedAreaId(command: FlowActionCommand): string | undefined {
  if ("areaId" in command && typeof command.areaId === "string" && command.areaId.trim().length > 0) {
    return command.areaId.trim();
  }
  return undefined;
}

function createsNewCell(command: FlowActionCommand): boolean {
  return command.op === "add-cell" || command.op === "add-attachment-image";
}

function buildCellIdMap(doc: FlowDocument, commands: FlowActionCommand[]): Map<string, string> {
  const used = new Set(doc.cells.map((cell) => cell.id));
  const idMap = new Map<string, string>();

  for (const command of commands) {
    if (!createsNewCell(command)) {
      continue;
    }

    const requestedCellId = getRequestedCellId(command);
    if (!requestedCellId) continue;
    if (idMap.has(requestedCellId)) continue;

    let resolved = requestedCellId;
    while (used.has(resolved)) {
      resolved = crypto.randomUUID();
    }

    used.add(resolved);
    idMap.set(requestedCellId, resolved);
  }

  return idMap;
}

function buildAreaIdMap(doc: FlowDocument, commands: FlowActionCommand[]): Map<string, string> {
  const normalizedDoc = normalizeFlowDocument(doc);
  const used = new Set((normalizedDoc.areas ?? []).map((area) => area.id));
  const idMap = new Map<string, string>();

  for (const command of commands) {
    if (command.op !== "create-area") continue;

    const requestedAreaId = getRequestedAreaId(command);
    if (!requestedAreaId || idMap.has(requestedAreaId)) continue;

    let resolved = requestedAreaId;
    while (used.has(resolved)) {
      resolved = crypto.randomUUID();
    }

    used.add(resolved);
    idMap.set(requestedAreaId, resolved);
  }

  return idMap;
}

function remapCellId(cellId: string, idMap: Map<string, string>) {
  return idMap.get(cellId) ?? cellId;
}

function remapAreaId(areaId: string | undefined, idMap: Map<string, string>): string | undefined {
  if (typeof areaId !== "string" || areaId.trim().length === 0) {
    return undefined;
  }
  return idMap.get(areaId.trim()) ?? areaId.trim();
}

function resolveSupportedAreaId(
  doc: FlowDocument,
  areaId: string | undefined,
  idMap: Map<string, string>,
  fallbackAreaId: string,
): string {
  const remappedAreaId = remapAreaId(areaId, idMap);
  if (!remappedAreaId) {
    return fallbackAreaId;
  }

  const areaExists = (normalizeFlowDocument(doc).areas ?? []).some((area) => area.id === remappedAreaId);
  return areaExists ? remappedAreaId : fallbackAreaId;
}

export function normalizeFlowActionCommands(input: {
  doc: FlowDocument;
  commands: FlowActionCommand[];
  attachments?: ComposerAttachment[];
  focusedAreaId?: string;
}): FlowMutationCommand[] {
  const normalizedDoc = normalizeFlowDocument(input.doc);
  const fallbackAreaId = resolveFlowArea(normalizedDoc, input.focusedAreaId).id;
  const imageAttachments = new Map(
    listImageAttachments(input.attachments).map((attachment) => [attachment.id, attachment]),
  );
  const idMap = buildCellIdMap(normalizedDoc, input.commands);
  const areaIdMap = buildAreaIdMap(normalizedDoc, input.commands);

  const normalized: FlowMutationCommand[] = [];

  for (const command of input.commands) {
    switch (command.op) {
      case "create-area": {
        break;
      }

      case "add-attachment-image": {
        if (!isFlowLaneId(command.laneId)) break;
        const attachment = imageAttachments.get(command.attachmentId);
        if (!attachment?.dataUrl) break;
        const requestedCellId = getRequestedCellId(command);
        const { width, height } = getAttachmentSize(attachment);

        normalized.push({
          op: "add-cell",
          cellId: requestedCellId ? remapCellId(requestedCellId, idMap) : undefined,
          laneId: command.laneId,
          areaId: resolveSupportedAreaId(normalizedDoc, command.areaId, areaIdMap, fallbackAreaId),
          column: typeof command.column === "number" ? command.column : undefined,
          artifact: {
            type: "uploaded-image",
            dataUrl: attachment.dataUrl,
            label: command.label?.trim() || attachment.name || "Attached image",
            width,
            height,
          },
        });
        break;
      }

      case "add-cell": {
        if (!isFlowLaneId(command.laneId)) break;
        const requestedCellId = getRequestedCellId(command);

        normalized.push({
          ...command,
          cellId: requestedCellId ? remapCellId(requestedCellId, idMap) : undefined,
          areaId: resolveSupportedAreaId(normalizedDoc, command.areaId, areaIdMap, fallbackAreaId),
          column: typeof command.column === "number" ? command.column : undefined,
        });
        break;
      }

      case "remove-cell":
        normalized.push({
          ...command,
          cellId: remapCellId(command.cellId, idMap),
        });
        break;

      case "add-connection":
        normalized.push({
          ...command,
          fromCellId: remapCellId(command.fromCellId, idMap),
          toCellId: remapCellId(command.toCellId, idMap),
        });
        break;

      case "remove-connection":
        normalized.push(command);
        break;

      case "move-cell":
        normalized.push({
          ...command,
          cellId: remapCellId(command.cellId, idMap),
          toAreaId: resolveSupportedAreaId(normalizedDoc, command.toAreaId, areaIdMap, fallbackAreaId),
        });
        break;

      case "update-cell":
        normalized.push({
          ...command,
          cellId: remapCellId(command.cellId, idMap),
        });
        break;
    }
  }

  return normalized;
}

function normalizePromptLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripImageExtension(value: string): string {
  return value.replace(/\.(?:png|jpe?g|webp|gif|heic|heif|svg)$/i, "").trim();
}

function isGenericUploadedImageLabel(label?: string | null): boolean {
  if (typeof label !== "string") {
    return true;
  }

  const normalized = normalizePromptLabel(stripImageExtension(label));
  if (!normalized) {
    return true;
  }

  return /^(?:screenshot(?: at)?(?: \d{4}.*)?|screen shot(?: \d+.*)?|screen capture(?: \d+.*)?|capture(?: \d+.*)?|pasted image(?: \d+.*)?|image(?: \d+.*)?|photo(?: \d+.*)?|picture(?: \d+.*)?|img(?: \d+.*)?|untitled(?: \d+.*)?)$/i.test(
    normalized,
  );
}

function isBoardAnalysisPrompt(prompt: string): boolean {
  return /\b(analy[sz]e|review|audit|improve|fill(?:\s+in)?|add(?:\s+the)?\s+steps?|missing\s+steps?|journey|edge\s+cases?|happy\s+path|unhappy\s+path)\b/i.test(
    prompt,
  );
}

function getArtifactJourneyLabel(artifact: FlowDocument["cells"][number]["artifact"], frames: DesignFrameInfo[]): string | null {
  switch (artifact.type) {
    case "design-frame-ref":
      return frames.find((frame) => frame.id === artifact.frameId)?.name ?? null;
    case "uploaded-image":
      return !isGenericUploadedImageLabel(artifact.label) ? artifact.label?.trim() || null : null;
    case "journey-step":
      return artifact.text.trim() || null;
    case "technical-brief":
      return null;
  }
}

function buildHeuristicFlowSummary(commands: FlowMutationCommand[]): string {
  const addedCells = commands.filter((command) => command.op === "add-cell").length;
  const addedConnections = commands.filter((command) => command.op === "add-connection").length;
  return `The model returned no reliable board mutations, so the agent backfilled ${addedCells} journey step(s) and ${addedConnections} connection(s) from existing named screen references.`;
}

function parseRequestedStepCount(prompt: string): number | null {
  if (!DIRECT_STEP_PROMPT_PREFIX.test(prompt) || !/\bsteps?\b/i.test(prompt)) {
    return null;
  }

  const match = prompt.match(/\b(?:add|insert|append)\s+(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:more\s+)?steps?\b/i);
  const countToken = match?.[1]?.toLowerCase();
  if (!countToken) {
    return 1;
  }

  if (/^\d+$/.test(countToken)) {
    return Math.max(1, Math.min(6, Number.parseInt(countToken, 10)));
  }

  return STEP_COUNT_WORDS[countToken] ?? 1;
}

function inferPromptFallbackLane(prompt: string): FlowLaneId {
  if (/\btechnical(?:\s+brief(?:ing)?)?\b/i.test(prompt)) {
    return "technical-briefing";
  }
  if (/\bunhappy(?:-|\s)?path\b|\berror\b|\bfailure\b|\bretry\b|\bfallback\b/i.test(prompt)) {
    return "unhappy-path";
  }
  if (/\bnormal(?:-|\s)?flow\b/i.test(prompt)) {
    return "normal-flow";
  }
  return "user-journey";
}

function buildPromptDerivedStepTexts(prompt: string, count: number): string[] {
  if (/\bwait\b|\bwaiting\b|\bloading\b|\bprocessing\b|\bpending\b|\bverifying\b|\bconfirm(?:ation|ing)?\b|\brefresh(?:ing)?\b/i.test(prompt)) {
    const waitSteps = [
      "Wait for the request to process",
      "Wait for confirmation before continuing",
      "Refresh once the updated state is available",
      "Recover if processing takes too long",
    ];
    return Array.from({ length: count }, (_, index) => waitSteps[index] ?? `Wait step ${index + 1}`);
  }

  if (/\berror\b|\bfailure\b|\bfailed\b|\bretry\b|\btimeout\b/i.test(prompt)) {
    const recoverySteps = [
      "Detect the failure state",
      "Show the retry path",
      "Confirm recovery before continuing",
    ];
    return Array.from({ length: count }, (_, index) => recoverySteps[index] ?? `Recovery step ${index + 1}`);
  }

  return Array.from({ length: count }, (_, index) => `New step ${index + 1}`);
}

function buildPromptFallbackSummary(commands: FlowMutationCommand[]): string {
  const addedCells = commands.filter((command) => command.op === "add-cell").length;
  const addedConnections = commands.filter((command) => command.op === "add-connection").length;
  return `The model returned no reliable board mutations, so the agent added ${addedCells} prompt-derived step(s) and ${addedConnections} connection(s).`;
}

function buildNoOpFlowSummary(doc: FlowDocument, prompt: string): string {
  const normalizedDoc = normalizeFlowDocument(doc);
  const imageCells = normalizedDoc.cells.filter((cell) => cell.artifact.type === "uploaded-image");
  const genericImageCount = imageCells.filter(
    (cell) => cell.artifact.type === "uploaded-image" && isGenericUploadedImageLabel(cell.artifact.label),
  ).length;
  const designFrameRefCount = normalizedDoc.cells.filter((cell) => cell.artifact.type === "design-frame-ref").length;

  if (/\b(edit|update|change|rewrite|rename|replace|shorten|expand|fix)\b/i.test(prompt) && normalizedDoc.cells.length > 0) {
    return "No confident changes applied. The agent could not confidently map the requested edit to an existing artifact on the selected board. Name the target card more explicitly or retry after confirming the pending board review card.";
  }

  if (isBoardAnalysisPrompt(prompt) && imageCells.length > 0 && genericImageCount === imageCells.length && designFrameRefCount === 0) {
    return "No confident changes applied. This board mostly contains generic screenshot labels, so the agent could not infer a reliable journey. Add board-memory YAML or clearer linked screens, then rerun the analysis.";
  }

  return "No confident changes applied. The agent could not infer a safe board mutation from the current board context.";
}

function buildHeuristicFlowCommands(input: {
  doc: FlowDocument;
  designFrames: DesignFrameInfo[];
  prompt: string;
  focusedAreaId?: string;
}): FlowMutationCommand[] {
  if (!isBoardAnalysisPrompt(input.prompt)) {
    return [];
  }

  const normalizedDoc = normalizeFlowDocument(input.doc);
  const focusedAreaId = resolveFlowArea(normalizedDoc, input.focusedAreaId).id;
  const areaCells = normalizedDoc.cells
    .filter((cell) => resolveFlowArea(normalizedDoc, cell.areaId).id === focusedAreaId)
    .sort((left, right) => {
      const leftColumn = getFlowGlobalColumn(normalizedDoc, left);
      const rightColumn = getFlowGlobalColumn(normalizedDoc, right);
      if (leftColumn !== rightColumn) {
        return leftColumn - rightColumn;
      }
      const laneDelta = FLOW_LANE_ORDER.indexOf(left.laneId) - FLOW_LANE_ORDER.indexOf(right.laneId);
      if (laneDelta !== 0) {
        return laneDelta;
      }
      return left.id.localeCompare(right.id);
    });

  const existingJourneySteps = areaCells.filter(
    (cell) => cell.laneId === "user-journey" && cell.artifact.type === "journey-step",
  );
  const existingLabels = new Set(
    existingJourneySteps.map((cell) =>
      normalizePromptLabel(cell.artifact.type === "journey-step" ? cell.artifact.text : ""),
    ),
  );

  const commands: FlowMutationCommand[] = [];
  const heuristicSteps: Array<{ cellId: string; column: number }> = [];

  const sourceCells = areaCells.filter(
    (cell) => cell.laneId !== "user-journey" && cell.laneId !== "technical-briefing",
  );

  for (const cell of sourceCells) {
    const label = getArtifactJourneyLabel(cell.artifact, input.designFrames);
    if (!label) {
      continue;
    }

    const normalizedLabel = normalizePromptLabel(label);
    if (!normalizedLabel || existingLabels.has(normalizedLabel)) {
      continue;
    }

    existingLabels.add(normalizedLabel);
    const cellId = `heuristic-journey-${crypto.randomUUID()}`;
    commands.push({
      op: "add-cell",
      cellId,
      areaId: focusedAreaId,
      laneId: "user-journey",
      column: cell.column,
      artifact: {
        type: "journey-step",
        text: label,
        shape: "rectangle",
      },
    });
    heuristicSteps.push({ cellId, column: cell.column });
  }

  const journeySequence = [
    ...existingJourneySteps.map((cell) => ({ cellId: cell.id, column: cell.column })),
    ...heuristicSteps,
  ].sort((left, right) => {
    if (left.column !== right.column) {
      return left.column - right.column;
    }
    return left.cellId.localeCompare(right.cellId);
  });

  const existingConnections = new Set(
    normalizedDoc.connections.map((connection) => `${connection.fromCellId}->${connection.toCellId}`),
  );

  for (let index = 0; index < journeySequence.length - 1; index += 1) {
    const fromCellId = journeySequence[index]?.cellId;
    const toCellId = journeySequence[index + 1]?.cellId;
    if (!fromCellId || !toCellId) {
      continue;
    }

    const key = `${fromCellId}->${toCellId}`;
    if (existingConnections.has(key)) {
      continue;
    }

    existingConnections.add(key);
    commands.push({
      op: "add-connection",
      fromCellId,
      toCellId,
    });
  }

  return commands;
}

function buildPromptDerivedFlowCommands(input: {
  doc: FlowDocument;
  prompt: string;
  focusedAreaId?: string;
}): FlowMutationCommand[] {
  const requestedStepCount = parseRequestedStepCount(input.prompt);
  if (!requestedStepCount) {
    return [];
  }

  const normalizedDoc = normalizeFlowDocument(input.doc);
  const focusedAreaId = resolveFlowArea(normalizedDoc, input.focusedAreaId).id;
  const laneId = inferPromptFallbackLane(input.prompt);
  if (laneId === "technical-briefing") {
    return [];
  }

  const areaJourneyCells = normalizedDoc.cells
    .filter(
      (cell) =>
        resolveFlowArea(normalizedDoc, cell.areaId).id === focusedAreaId &&
        cell.laneId === laneId &&
        cell.artifact.type === "journey-step",
    )
    .sort((left, right) => {
      if (left.column !== right.column) {
        return left.column - right.column;
      }
      return left.id.localeCompare(right.id);
    });

  const baseColumn = areaJourneyCells.length === 0 ? 0 : areaJourneyCells[areaJourneyCells.length - 1]!.column + 1;
  const stepTexts = buildPromptDerivedStepTexts(input.prompt, requestedStepCount);
  const newCellIds: string[] = [];
  const commands: FlowMutationCommand[] = stepTexts.map((text, index) => {
    const cellId = `prompt-step-${crypto.randomUUID()}`;
    newCellIds.push(cellId);
    return {
      op: "add-cell",
      cellId,
      laneId,
      areaId: focusedAreaId,
      column: baseColumn + index,
      artifact: {
        type: "journey-step",
        text,
        shape: /\bdecision\b|\bchoose\b|\byes\b|\bno\b|\bif\b|\bwhether\b/i.test(text) ? "diamond" : "rectangle",
      },
    };
  });

  const lastExistingCellId = areaJourneyCells[areaJourneyCells.length - 1]?.id;
  if (lastExistingCellId && newCellIds[0]) {
    commands.push({
      op: "add-connection",
      fromCellId: lastExistingCellId,
      toCellId: newCellIds[0],
    });
  }

  for (let index = 0; index < newCellIds.length - 1; index += 1) {
    const fromCellId = newCellIds[index];
    const toCellId = newCellIds[index + 1];
    if (!fromCellId || !toCellId) {
      continue;
    }
    commands.push({
      op: "add-connection",
      fromCellId,
      toCellId,
    });
  }

  return commands;
}

export async function runFlowAction(input: FlowActionInput): Promise<FlowActionResult> {
  const normalizedDoc = normalizeFlowDocument(input.flowDocument);
  const visionAttachments = buildVisionAttachments(normalizedDoc, input.attachments);
  const context = buildFlowContext(normalizedDoc, input.designFrames, input.focusedAreaId, visionAttachments);

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    timeoutMs: 30_000,
    attachments: input.provider === "openai" && visionAttachments.length > 0 ? visionAttachments : undefined,
    system: SYSTEM_PROMPT,
    prompt: `${context}\n\nUser request: ${input.prompt}\n\nReturn a JSON object with a \"commands\" array.`,
  });

  const rawCommands = parseFlowActionCommands(completion.content);
  const commands = normalizeFlowActionCommands({
    doc: normalizedDoc,
    commands: rawCommands,
    attachments: input.attachments,
    focusedAreaId: input.focusedAreaId,
  });

  const promptFallbackCommands = commands.length > 0
    ? []
    : buildPromptDerivedFlowCommands({
        doc: normalizedDoc,
        prompt: input.prompt,
        focusedAreaId: input.focusedAreaId,
      });
  const heuristicCommands = commands.length > 0 || promptFallbackCommands.length > 0
    ? []
    : buildHeuristicFlowCommands({
        doc: normalizedDoc,
        designFrames: input.designFrames,
        prompt: input.prompt,
        focusedAreaId: input.focusedAreaId,
      });
  const resolvedCommands = commands.length > 0 ? commands : promptFallbackCommands.length > 0 ? promptFallbackCommands : heuristicCommands;
  const updatedDocument = resolvedCommands.length > 0 ? applyFlowMutations(normalizedDoc, resolvedCommands) : normalizedDoc;
  const summary = commands.length > 0
    ? describeFlowMutations(resolvedCommands, normalizedDoc)
    : promptFallbackCommands.length > 0
      ? buildPromptFallbackSummary(promptFallbackCommands)
    : heuristicCommands.length > 0
      ? buildHeuristicFlowSummary(heuristicCommands)
      : buildNoOpFlowSummary(normalizedDoc, input.prompt);

  return { commands: resolvedCommands, updatedDocument, summary };
}
