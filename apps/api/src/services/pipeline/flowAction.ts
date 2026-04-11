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

interface DesignFrameInfo {
  id: string;
  name: string;
}

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
      label = `design-frame-ref → "${frame?.name ?? artifact.frameId}"`;
    } else if (artifact.type === "journey-step") {
      label = `journey-step: "${artifact.text.slice(0, 50)}"`;
    } else if (artifact.type === "technical-brief") {
      label = `technical-brief: "${artifact.title}"`;
    } else if (artifact.type === "uploaded-image") {
      const size =
        typeof artifact.width === "number" && typeof artifact.height === "number"
          ? ` (${artifact.width}x${artifact.height})`
          : "";
      label = `uploaded-image: "${artifact.label ?? "image"}"${size}`;
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

  const frameLines = frames.map((frame) => `  - id="${frame.id}" name="${frame.name}"`);
  const attachmentLines = listImageAttachments(attachments).map((attachment) => {
    const name = attachment.name?.trim() || "Attached image";
    return `  - attachment "${attachment.id}" name="${name}"`;
  });

  const importedSourceLines = (normalizedDoc.importedSourceFrameIds ?? []).map(
    (frameId) => `  - imported source frame id="${frameId}"`,
  );

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
${attachmentLines.join("\n") || "  (none)"}`;
}

const SYSTEM_PROMPT = `You are a flow-board assistant for a UI design tool. The user has a flow board with swim lanes and wants to make changes.

Available mutation commands (return as JSON array):
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

ERD / Flow Diagram Rules:
- When the user asks for an ERD, user flow, or flow diagram, create journey-step cells in the "user-journey" lane.
- Use shape "rectangle" for process steps (actions the user takes).
- Use shape "diamond" for decision points (yes/no branches, conditionals).
- Connect steps sequentially with add-connection commands.
- For decisions, connect the diamond to multiple outcomes (branching paths).
- For explicit binary choices, create exactly one diamond decision node and branch it into two outcomes labeled "yes" and "no".
- If the user appears to have a typo in a binary choice prompt, normalize the second branch to "no" when the intent is clearly yes/no.

Image Analysis:
- When uploaded images already exist on the board, analyze their labels/context to understand the screens they represent.
- When an image attachment is available and the user wants it on the board, use add-attachment-image rather than embedding a raw data URL.
- Create journey steps that describe the user flow between image/screens, connecting them with add-connection.
- Infer screen transitions, decision points, and error paths from the screen context.

When connecting frames, use cell IDs, not frame IDs. Match frame names from the user's prompt to the available design frames listed in the context.

Return ONLY a JSON array of commands. No explanation text.`;

function parseFlowActionCommands(content: string): FlowActionCommand[] {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((command: unknown) => {
      if (typeof command !== "object" || command === null) return false;
      const record = command as Record<string, unknown>;
      return typeof record.op === "string";
    }) as FlowActionCommand[];
  } catch {
    return [];
  }
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

function buildCellIdMap(doc: FlowDocument, commands: FlowActionCommand[]): Map<string, string> {
  const used = new Set(doc.cells.map((cell) => cell.id));
  const idMap = new Map<string, string>();

  for (const command of commands) {
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

export async function runFlowAction(input: FlowActionInput): Promise<FlowActionResult> {
  const normalizedDoc = normalizeFlowDocument(input.flowDocument);
  const context = buildFlowContext(normalizedDoc, input.designFrames, input.focusedAreaId, input.attachments);

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    timeoutMs: 30_000,
    system: SYSTEM_PROMPT,
    prompt: `${context}\n\nUser request: ${input.prompt}\n\nReturn JSON array of commands.`,
  });

  const rawCommands = parseFlowActionCommands(completion.content);
  const commands = normalizeFlowActionCommands({
    doc: normalizedDoc,
    commands: rawCommands,
    attachments: input.attachments,
    focusedAreaId: input.focusedAreaId,
  });

  const updatedDocument = applyFlowMutations(normalizedDoc, commands);
  const summary = describeFlowMutations(commands, normalizedDoc);

  return { commands, updatedDocument, summary };
}
