import type { Express } from "express";
import {
  applyFlowMutations,
  createEmptyFlowDocument,
  describeFlowMutations,
  type FlowDocument,
  type FlowMutationCommand,
} from "@designer/shared";
import type { RunHub } from "../../services/runHub.js";
import type { ApiDeps } from "../deps.js";
import { sendApiError } from "../errors.js";
import {
  REVIEW_REQUIRED_FLOW_MUTATION_OPS,
  runFlowAction,
} from "../../services/pipeline/flowAction.js";
import {
  FlowBoardMemoryParseError,
  parseFlowBoardMemoryText,
  syncFlowDocumentWithBoardMemory,
} from "../../services/pipeline/flowBoardMemory.js";
import { buildDesignFrameSummary } from "../../services/pipeline/designFrameSummary.js";
import { generateFlowStory } from "../../services/pipeline/flowStory.js";
import {
  parseAttachments,
  parseDesignSystemMode,
  parseDevicePreset,
  parseMode,
  parseNonEmptyString,
  parseProvider,
  parseSelectedFrameContext,
  parseSurfaceTarget,
  parseTailwind,
  parseVariation
} from "../parsers.js";

function isFlowMutationCommand(value: unknown): value is FlowMutationCommand {
  return typeof value === "object" && value !== null && typeof (value as { op?: unknown }).op === "string";
}

function splitFlowMutationCommands(commands: FlowMutationCommand[]) {
  const autoAppliedCommands: FlowMutationCommand[] = [];
  const reviewRequiredCommands: FlowMutationCommand[] = [];

  for (const command of commands) {
    if (REVIEW_REQUIRED_FLOW_MUTATION_OPS.has(command.op)) {
      reviewRequiredCommands.push(command);
      continue;
    }
    autoAppliedCommands.push(command);
  }

  return {
    autoAppliedCommands,
    reviewRequiredCommands,
  };
}

function buildFlowActionSummary(input: {
  sourceDocument: FlowDocument;
  autoAppliedCommands: FlowMutationCommand[];
  reviewRequiredCommands: FlowMutationCommand[];
  fallbackSummary: string;
}) {
  const autoSummary = input.autoAppliedCommands.length > 0
    ? describeFlowMutations(input.autoAppliedCommands, input.sourceDocument)
    : "";
  const reviewSummary = input.reviewRequiredCommands.length > 0
    ? input.reviewRequiredCommands.length === 1
      ? "1 change is waiting for confirmation. The board will stay unchanged until you apply it."
      : `${input.reviewRequiredCommands.length} changes are waiting for confirmation. The board will stay unchanged until you apply them.`
    : "";

  if (autoSummary && reviewSummary) {
    return `${autoSummary} ${reviewSummary}`;
  }
  if (autoSummary) {
    return autoSummary;
  }
  if (reviewSummary) {
    return reviewSummary;
  }
  return input.fallbackSummary;
}

export function registerFrameRunRoutes(app: Express, deps: ApiDeps, runHub: RunHub) {
  app.post("/projects/:id/frames", async (request, response) => {
    const project = await deps.getProjectBundle(request.params.id);
    if (!project) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    try {
      const frameId = await deps.createManualFrame({
        projectId: request.params.id,
        devicePreset: parseDevicePreset(request.body?.devicePreset),
        mode: parseMode(request.body?.mode),
        tailwindEnabled: parseTailwind(request.body?.tailwindEnabled),
        name: typeof request.body?.name === "string" ? request.body.name : undefined,
        position: request.body?.position,
        size: request.body?.size,
        frameKind: request.body?.frameKind === "flow" ? "flow" : undefined,
        flowDocument: request.body?.frameKind === "flow" ? request.body?.flowDocument : undefined,
      });
      const frame = await deps.getFrameWithVersions(frameId);
      response.status(201).json(frame);
    } catch (error) {
      sendApiError(response, 500, error instanceof Error ? error.message : String(error), "internal_error");
    }
  });

  app.patch("/frames/:id/layout", async (request, response) => {
    const frame = await deps.updateFrameLayout(request.params.id, {
      position:
        typeof request.body?.position?.x === "number" && typeof request.body?.position?.y === "number"
          ? {
              x: request.body.position.x,
              y: request.body.position.y
            }
          : undefined,
      size:
        typeof request.body?.size?.width === "number" && typeof request.body?.size?.height === "number"
          ? {
              width: Math.max(220, request.body.size.width),
              height: Math.max(260, request.body.size.height)
            }
          : undefined,
      selected: typeof request.body?.selected === "boolean" ? request.body.selected : undefined
    });

    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }

    response.json(frame);
  });

  app.patch("/frames/:id/flow-document", async (request, response) => {
    const existing = await deps.getFrame(request.params.id);
    if (!existing) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }
    if (existing.frameKind !== "flow") {
      sendApiError(response, 400, "Frame is not a flow board.", "validation_error");
      return;
    }
    const flowDocument = request.body?.flowDocument;
    if (!flowDocument || typeof flowDocument !== "object") {
      sendApiError(response, 400, "flowDocument is required.", "validation_error");
      return;
    }
    try {
      const updated = await deps.updateFlowDocument(request.params.id, flowDocument);
      if (!updated) {
        sendApiError(response, 404, "Frame not found.", "not_found");
        return;
      }
      response.json(updated);
    } catch (error) {
      sendApiError(response, 500, error instanceof Error ? error.message : String(error), "internal_error");
    }
  });

  app.patch("/frames/:id/board-memory", async (request, response) => {
    const existing = await deps.getFrame(request.params.id);
    if (!existing) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }
    if (existing.frameKind !== "flow") {
      sendApiError(response, 400, "Frame is not a flow board.", "validation_error");
      return;
    }

    const authoredText = typeof request.body?.authoredText === "string" ? request.body.authoredText : "";

    try {
      const parsedMemory = parseFlowBoardMemoryText(authoredText);
      const synced = syncFlowDocumentWithBoardMemory(
        existing.flowDocument ?? createEmptyFlowDocument(),
        parsedMemory,
      );
      const updated = await deps.updateFlowDocument(request.params.id, synced.flowDocument);
      if (!updated) {
        sendApiError(response, 404, "Frame not found.", "not_found");
        return;
      }

      response.json({
        ok: true,
        frameId: existing.id,
        flowDocument: updated.flowDocument ?? synced.flowDocument,
        memoryText: synced.flowDocument.boardMemory?.authoredText ?? authoredText,
        summary: "Board memory saved and synchronized with the selected board.",
      });
    } catch (error) {
      if (error instanceof FlowBoardMemoryParseError) {
        sendApiError(response, 400, error.message, "validation_error");
        return;
      }

      sendApiError(response, 500, error instanceof Error ? error.message : String(error), "internal_error");
    }
  });

  app.get("/frames/:id", async (request, response) => {
    const frame = await deps.getFrameWithVersions(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }

    response.json(frame);
  });

  app.delete("/frames/:id", async (request, response) => {
    const frame = await deps.getFrame(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }

    const deleted = await deps.deleteFrame(request.params.id);
    if (!deleted) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }
    response.json({ ok: true });
  });

  app.get("/frames/:id/versions", async (request, response) => {
    const frame = await deps.getFrame(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }

    const versions = await deps.getFrameVersions(frame.id);
    response.json(versions);
  });

  app.post("/projects/:id/generate", async (request, response) => {
    const project = await deps.getProjectBundle(request.params.id);
    if (!project) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    if (!prompt) {
      sendApiError(response, 400, "prompt is required.", "validation_error");
      return;
    }

    let attachments;
    try {
      attachments = parseAttachments(request.body?.attachments);
    } catch (error) {
      sendApiError(response, 400, error instanceof Error ? error.message : String(error), "validation_error");
      return;
    }

    const surfaceTarget =
      request.body?.surfaceTarget === "web" || request.body?.surfaceTarget === "mobile"
        ? parseSurfaceTarget(request.body.surfaceTarget)
        : project.project.settings.surfaceDefault;
    const designSystemMode =
      request.body?.designSystemMode === "strict" || request.body?.designSystemMode === "creative"
        ? parseDesignSystemMode(request.body.designSystemMode)
        : project.project.settings.designSystemModeDefault;

    const run = await deps.createPipelineRun({
      projectId: request.params.id,
      frameId: null,
      prompt,
      provider: parseProvider(request.body?.provider),
      model: typeof request.body?.model === "string" ? request.body.model : "gpt-5.4-mini"
    });

    await deps.startPipeline(
      {
        runId: run.id,
        projectId: request.params.id,
        prompt,
        provider: parseProvider(request.body?.provider),
        model: typeof request.body?.model === "string" ? request.body.model : "gpt-5.4-mini",
        apiKey: typeof request.body?.apiKey === "string" ? request.body.apiKey : undefined,
        devicePreset: parseDevicePreset(request.body?.devicePreset),
        mode: parseMode(request.body?.mode),
        surfaceTarget,
        designSystemMode,
        variation: parseVariation(request.body?.variation),
        tailwindEnabled: parseTailwind(request.body?.tailwindEnabled),
        attachments,
        selectedFrameContext: parseSelectedFrameContext(request.body?.selectedFrameContext),
        editing: false
      },
      { hub: runHub }
    );

    response.status(202).json({ runId: run.id });
  });

  app.post("/frames/:id/edit", async (request, response) => {
    const frame = await deps.getFrame(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }

    const projectBundle = await deps.getProjectBundle(frame.projectId);
    if (!projectBundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    if (!prompt) {
      sendApiError(response, 400, "prompt is required.", "validation_error");
      return;
    }

    let attachments;
    try {
      attachments = parseAttachments(request.body?.attachments);
    } catch (error) {
      sendApiError(response, 400, error instanceof Error ? error.message : String(error), "validation_error");
      return;
    }

    const surfaceTarget =
      request.body?.surfaceTarget === "web" || request.body?.surfaceTarget === "mobile"
        ? parseSurfaceTarget(request.body.surfaceTarget)
        : projectBundle.project.settings.surfaceDefault;
    const designSystemMode =
      request.body?.designSystemMode === "strict" || request.body?.designSystemMode === "creative"
        ? parseDesignSystemMode(request.body.designSystemMode)
        : projectBundle.project.settings.designSystemModeDefault;

    const run = await deps.createPipelineRun({
      projectId: frame.projectId,
      frameId: frame.id,
      prompt,
      provider: parseProvider(request.body?.provider),
      model: typeof request.body?.model === "string" ? request.body.model : "gpt-5.4-mini"
    });

    await deps.startPipeline(
      {
        runId: run.id,
        projectId: frame.projectId,
        prompt,
        provider: parseProvider(request.body?.provider),
        model: typeof request.body?.model === "string" ? request.body.model : "gpt-5.4-mini",
        apiKey: typeof request.body?.apiKey === "string" ? request.body.apiKey : undefined,
        devicePreset: parseDevicePreset(request.body?.devicePreset ?? frame.devicePreset),
        mode: parseMode(request.body?.mode ?? frame.mode),
        surfaceTarget,
        designSystemMode,
        variation: 1,
        tailwindEnabled: parseTailwind(request.body?.tailwindEnabled),
        attachments,
        selectedFrameContext: parseSelectedFrameContext(request.body?.selectedFrameContext),
        frameId: frame.id,
        editing: true,
        intentHint: request.body?.intentHint === "screen-action" ? "screen-action" : undefined,
        preloadedBundle: projectBundle
      },
      { hub: runHub }
    );

    response.status(202).json({ runId: run.id });
  });

  // ── Flow action (lightweight document mutation) ─────────────
  app.post("/frames/:id/flow-action", async (request, response) => {
    const frame = await deps.getFrame(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }
    if (frame.frameKind !== "flow") {
      sendApiError(response, 400, "Frame is not a flow board.", "validation_error");
      return;
    }

    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    if (!prompt) {
      sendApiError(response, 400, "prompt is required.", "validation_error");
      return;
    }

    let attachments;
    try {
      attachments = parseAttachments(request.body?.attachments);
    } catch (error) {
      sendApiError(response, 400, error instanceof Error ? error.message : String(error), "validation_error");
      return;
    }

    try {
      const provider = parseProvider(request.body?.provider);
      const model = typeof request.body?.model === "string" ? request.body.model : "gpt-5.4-mini";
      const apiKey = typeof request.body?.apiKey === "string" ? request.body.apiKey : undefined;

      // Gather design frame names for the LLM context
      const projectBundle = await deps.getProjectBundle(frame.projectId);
      const designFrames = (projectBundle?.frames ?? [])
        .filter((f) => f.frameKind !== "flow")
        .map((f) => ({ id: f.id, name: f.name, summary: buildDesignFrameSummary(f) }));

      const result = await runFlowAction({
        prompt,
        flowDocument: frame.flowDocument ?? createEmptyFlowDocument(),
        designFrames,
        provider,
        model,
        apiKey,
        attachments,
        focusedAreaId:
          typeof request.body?.focusedAreaId === "string" && request.body.focusedAreaId.trim().length > 0
            ? request.body.focusedAreaId.trim()
            : undefined,
      });

      const sourceDocument = frame.flowDocument ?? createEmptyFlowDocument();
      const { autoAppliedCommands, reviewRequiredCommands } = splitFlowMutationCommands(result.commands);
      const nextFlowDocument = autoAppliedCommands.length > 0
        ? applyFlowMutations(sourceDocument, autoAppliedCommands)
        : sourceDocument;
      const reviewDetails = reviewRequiredCommands.map((command) => ({
        command,
        summary: describeFlowMutations([command], sourceDocument),
        severity: command.op === "remove-cell" || command.op === "remove-connection" ? "remove" : "modify",
      }));

      if (autoAppliedCommands.length > 0) {
        await deps.updateFlowDocument(frame.id, nextFlowDocument);
      }

      response.json({
        ok: true,
        frameId: frame.id,
        commands: result.commands,
        autoAppliedCommands,
        reviewRequiredCommands: reviewDetails,
        flowDocument: nextFlowDocument,
        summary: buildFlowActionSummary({
          sourceDocument,
          autoAppliedCommands,
          reviewRequiredCommands,
          fallbackSummary: result.summary,
        }),
      });
    } catch (err) {
      console.error("[flow-action] Error:", err);
      sendApiError(response, 500, "Flow action failed.", "internal_error");
    }
  });

  app.post("/frames/:id/flow-action/apply", async (request, response) => {
    const frame = await deps.getFrame(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }
    if (frame.frameKind !== "flow") {
      sendApiError(response, 400, "Frame is not a flow board.", "validation_error");
      return;
    }

    const commands = Array.isArray(request.body?.commands)
      ? request.body.commands.filter(isFlowMutationCommand)
      : [];
    if (commands.length === 0) {
      sendApiError(response, 400, "commands are required.", "validation_error");
      return;
    }

    try {
      const sourceDocument = frame.flowDocument ?? createEmptyFlowDocument();
      const updatedDocument = applyFlowMutations(sourceDocument, commands);
      await deps.updateFlowDocument(frame.id, updatedDocument);

      response.json({
        ok: true,
        frameId: frame.id,
        appliedCommands: commands,
        flowDocument: updatedDocument,
        summary: describeFlowMutations(commands, sourceDocument),
      });
    } catch (error) {
      sendApiError(response, 500, error instanceof Error ? error.message : String(error), "internal_error");
    }
  });

  app.post("/frames/:id/flow-story", async (request, response) => {
    const frame = await deps.getFrame(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }
    if (frame.frameKind !== "flow") {
      sendApiError(response, 400, "Frame is not a flow board.", "validation_error");
      return;
    }

    try {
      const provider = parseProvider(request.body?.provider);
      const model = typeof request.body?.model === "string" ? request.body.model : "gpt-5.4-mini";
      const apiKey = typeof request.body?.apiKey === "string" ? request.body.apiKey : undefined;
      const prompt = parseNonEmptyString(request.body?.prompt);

      const projectBundle = await deps.getProjectBundle(frame.projectId);
      const designFrames = (projectBundle?.frames ?? [])
        .filter((candidate) => candidate.frameKind !== "flow")
        .map((candidate) => ({ id: candidate.id, name: candidate.name, summary: buildDesignFrameSummary(candidate) }));

      const result = await generateFlowStory({
        prompt,
        flowDocument: frame.flowDocument ?? createEmptyFlowDocument(),
        designFrames,
        provider,
        model,
        apiKey,
      });

      await deps.updateFlowDocument(frame.id, result.updatedDocument);

      response.json({
        ok: true,
        frameId: frame.id,
        story: result.story,
        flowDocument: result.updatedDocument,
        summary: result.summary,
      });
    } catch (err) {
      console.error("[flow-story] Error:", err);
      sendApiError(response, 500, "Flow story export failed.", "internal_error");
    }
  });
}
