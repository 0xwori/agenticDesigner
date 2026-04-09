import type { Express } from "express";
import type { RunHub } from "../../services/runHub.js";
import type { ApiDeps } from "../deps.js";
import { sendApiError } from "../errors.js";
import {
  parseAttachments,
  parseDesignSystemMode,
  parseDevicePreset,
  parseMode,
  parseProvider,
  parseSelectedFrameContext,
  parseSurfaceTarget,
  parseTailwind,
  parseVariation
} from "../parsers.js";

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
        tailwindEnabled: parseTailwind(request.body?.tailwindEnabled)
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

  app.get("/frames/:id", async (request, response) => {
    const frame = await deps.getFrameWithVersions(request.params.id);
    if (!frame) {
      sendApiError(response, 404, "Frame not found.", "not_found");
      return;
    }

    response.json(frame);
  });

  app.delete("/frames/:id", async (request, response) => {
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
        editing: true
      },
      { hub: runHub }
    );

    response.status(202).json({ runId: run.id });
  });
}
