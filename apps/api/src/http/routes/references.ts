import type { Express } from "express";
import type { ApiDeps } from "../deps.js";
import { sendApiError } from "../errors.js";
import { fallbackCredentialsPrompt, parseNonEmptyString } from "../parsers.js";

export function registerReferenceRoutes(app: Express, deps: ApiDeps) {
  app.post("/projects/:id/references", async (request, response) => {
    const figmaUrl = typeof request.body?.figmaUrl === "string" ? request.body.figmaUrl.trim() : "";
    const figmaClientId = parseNonEmptyString(request.body?.figmaClientId);
    const figmaClientSecret = parseNonEmptyString(request.body?.figmaClientSecret);
    const hasClientCredentials = Boolean(figmaClientId && figmaClientSecret);

    if (!figmaUrl) {
      sendApiError(response, 400, "figmaUrl is required.", "bad_request");
      return;
    }

    const project = await deps.getProjectBundle(request.params.id);
    if (!project) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    try {
      const parsed = deps.parseFigmaLink(figmaUrl);
      const createdReference = await deps.createReferenceSource({
        projectId: request.params.id,
        figmaUrl: parsed.figmaUrl,
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        scope: parsed.scope
      });

      try {
        const synced = await deps.syncReferenceViaMcp(figmaUrl);
        const resolvedStyleContext = deps.deriveStyleContextFromArtifacts(synced.styleContext, synced.referenceScreen);
        const resolvedChecklist = deps.buildDesignSystemChecklistFromStyleContext(resolvedStyleContext);
        const updated = await deps.updateReferenceSource(createdReference.id, {
          syncStatus: "synced",
          syncError: null,
          extractedStyleContext: resolvedStyleContext,
          designSystemStatus: "draft",
          designSystemChecklist: resolvedChecklist,
          designSystemNotes: null,
          updateDesignSystemAt: true,
          updateSyncedAt: true
        });
        if (!updated) {
          throw new Error("Reference was synced but could not be reloaded.");
        }

        const markdown = deps.generateDesignMarkdownFromStyleContext(
          resolvedStyleContext,
          `Brand system seeded from synced Figma reference ${updated.fileKey}.`
        );
        const parsedDesignSystem = deps.parseDesignMarkdown(markdown, resolvedStyleContext);
        await deps.upsertProjectDesignSystem({
          projectId: request.params.id,
          markdown: parsedDesignSystem.markdown,
          structuredTokens: parsedDesignSystem.structuredTokens,
          status: "draft",
          sourceType: "figma-reference",
          sourceReferenceId: updated.id
        });

        try {
          await deps.createReferenceStarterFrames({
            projectId: request.params.id,
            referenceSourceId: updated.id,
            fileKey: updated.fileKey,
            nodeId: updated.nodeId,
            scope: updated.scope,
            styleContext: resolvedStyleContext,
            designSystemChecklist: resolvedChecklist,
            referenceScreen: synced.referenceScreen
          });
        } catch (bootstrapError) {
          response.status(200).json({
            reference: updated,
            error:
              bootstrapError instanceof Error
                ? `Reference synced, but auto-frame bootstrap failed: ${bootstrapError.message}`
                : `Reference synced, but auto-frame bootstrap failed: ${String(bootstrapError)}`
          });
          return;
        }

        response.status(201).json(updated);
        return;
      } catch (syncError) {
        const fallbackReason = deps.classifyMcpFailure(syncError);
        try {
          const publicSync = await deps.syncStyleContextFromFigmaLink(figmaUrl);
          const fallbackReferenceScreen = deps.buildPublicLinkFallbackReferenceScreen({
            fileKey: parsed.fileKey,
            nodeId: parsed.nodeId,
            scope: parsed.scope,
            styleContext: publicSync.styleContext,
            fallbackReason: syncError instanceof Error ? syncError.message : String(syncError),
            usedClientCredentials: hasClientCredentials
          });
          const resolvedStyleContext = deps.deriveStyleContextFromArtifacts(publicSync.styleContext, fallbackReferenceScreen);
          const checklist = deps.buildDesignSystemChecklistFromStyleContext(resolvedStyleContext);

          const updated = await deps.updateReferenceSource(createdReference.id, {
            syncStatus: "synced",
            syncError: null,
            extractedStyleContext: resolvedStyleContext,
            designSystemStatus: "draft",
            designSystemChecklist: checklist,
            designSystemNotes: "Fallback mode: public-link style extraction due to MCP failure.",
            updateDesignSystemAt: true,
            updateSyncedAt: true
          });

          if (!updated) {
            throw new Error("Fallback sync succeeded but reference could not be reloaded.");
          }

          const markdown = deps.generateDesignMarkdownFromStyleContext(
            resolvedStyleContext,
            `Brand system seeded from public-link extraction for ${updated.fileKey}.`
          );
          const parsedDesignSystem = deps.parseDesignMarkdown(markdown, resolvedStyleContext);
          await deps.upsertProjectDesignSystem({
            projectId: request.params.id,
            markdown: parsedDesignSystem.markdown,
            structuredTokens: parsedDesignSystem.structuredTokens,
            status: "draft",
            sourceType: "figma-reference",
            sourceReferenceId: updated.id
          });

          await deps.createReferenceStarterFrames({
            projectId: request.params.id,
            referenceSourceId: updated.id,
            fileKey: updated.fileKey,
            nodeId: updated.nodeId,
            scope: updated.scope,
            styleContext: resolvedStyleContext,
            designSystemChecklist: checklist,
            referenceScreen: fallbackReferenceScreen
          });

          response.status(200).json({
            reference: updated,
            warning:
              "MCP get_design_context was unavailable, so attach used public-link fallback reconstruction.",
            fallback: {
              mode: "public-link-style-context",
              reason: fallbackReason,
              requiredClientCredentials: false,
              retryPrompt: "Re-send the same Figma link once MCP is available to rebuild exact code from MCP."
            }
          });
          return;
        } catch (fallbackError) {
          const updated = await deps.updateReferenceSource(createdReference.id, {
            syncStatus: "failed",
            syncError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            updateSyncedAt: false
          });
          response.status(200).json({
            reference: updated,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            fallback: {
              mode: hasClientCredentials ? "credentials-provided-fallback-failed" : "credentials-required",
              reason: fallbackReason,
              requiredClientCredentials: !hasClientCredentials,
              retryPrompt: hasClientCredentials
                ? "Check credentials and link permissions, then resend the Figma link in chat."
                : fallbackCredentialsPrompt()
            }
          });
          return;
        }
      }
    } catch (error) {
      sendApiError(response, 400, error instanceof Error ? error.message : String(error), "validation_error");
    }
  });

  app.post("/references/:id/resync", async (request, response) => {
    const figmaClientId = parseNonEmptyString(request.body?.figmaClientId);
    const figmaClientSecret = parseNonEmptyString(request.body?.figmaClientSecret);
    const hasClientCredentials = Boolean(figmaClientId && figmaClientSecret);
    const reference = await deps.getReferenceSource(request.params.id);
    if (!reference) {
      sendApiError(response, 404, "Reference not found.", "not_found");
      return;
    }

    await deps.updateReferenceSource(reference.id, {
      syncStatus: "syncing",
      syncError: null,
      updateSyncedAt: false
    });

    try {
      const synced = await deps.syncReferenceViaMcp(reference.figmaUrl);
      const resolvedStyleContext = deps.deriveStyleContextFromArtifacts(synced.styleContext, synced.referenceScreen);
      const resolvedChecklist = deps.buildDesignSystemChecklistFromStyleContext(resolvedStyleContext);
      const updated = await deps.updateReferenceSource(reference.id, {
        syncStatus: "synced",
        syncError: null,
        extractedStyleContext: resolvedStyleContext,
        designSystemStatus: "draft",
        designSystemChecklist: resolvedChecklist,
        designSystemNotes: null,
        updateDesignSystemAt: true,
        updateSyncedAt: true
      });
      if (!updated) {
        throw new Error("Reference was synced but could not be reloaded.");
      }
      const markdown = deps.generateDesignMarkdownFromStyleContext(
        resolvedStyleContext,
        `Brand system refreshed from synced Figma reference ${reference.fileKey}.`
      );
      const parsedDesignSystem = deps.parseDesignMarkdown(markdown, resolvedStyleContext);
      await deps.upsertProjectDesignSystem({
        projectId: reference.projectId,
        markdown: parsedDesignSystem.markdown,
        structuredTokens: parsedDesignSystem.structuredTokens,
        status: "draft",
        sourceType: "figma-reference",
        sourceReferenceId: reference.id
      });

      try {
        await deps.createReferenceStarterFrames({
          projectId: updated.projectId,
          referenceSourceId: updated.id,
          fileKey: updated.fileKey,
          nodeId: updated.nodeId,
          scope: updated.scope,
          styleContext: resolvedStyleContext,
          designSystemChecklist: resolvedChecklist,
          referenceScreen: synced.referenceScreen
        });
      } catch (bootstrapError) {
        response.status(200).json({
          reference: updated,
          error:
            bootstrapError instanceof Error
              ? `Reference synced, but auto-frame bootstrap failed: ${bootstrapError.message}`
              : `Reference synced, but auto-frame bootstrap failed: ${String(bootstrapError)}`
        });
        return;
      }

      response.json(updated);
    } catch (error) {
      const fallbackReason = deps.classifyMcpFailure(error);
      try {
        const publicSync = await deps.syncStyleContextFromFigmaLink(reference.figmaUrl);
        const fallbackReferenceScreen = deps.buildPublicLinkFallbackReferenceScreen({
          fileKey: reference.fileKey,
          nodeId: reference.nodeId,
          scope: reference.scope,
          styleContext: publicSync.styleContext,
          fallbackReason: error instanceof Error ? error.message : String(error),
          usedClientCredentials: hasClientCredentials
        });
        const resolvedStyleContext = deps.deriveStyleContextFromArtifacts(publicSync.styleContext, fallbackReferenceScreen);
        const checklist = deps.buildDesignSystemChecklistFromStyleContext(resolvedStyleContext);

        const updated = await deps.updateReferenceSource(reference.id, {
          syncStatus: "synced",
          syncError: null,
          extractedStyleContext: resolvedStyleContext,
          designSystemStatus: "draft",
          designSystemChecklist: checklist,
          designSystemNotes: "Fallback mode: public-link style extraction due to MCP failure.",
          updateDesignSystemAt: true,
          updateSyncedAt: true
        });

        if (!updated) {
          throw new Error("Fallback sync succeeded but reference reload failed.");
        }

        const markdown = deps.generateDesignMarkdownFromStyleContext(
          resolvedStyleContext,
          `Brand system refreshed from public-link extraction for ${reference.fileKey}.`
        );
        const parsedDesignSystem = deps.parseDesignMarkdown(markdown, resolvedStyleContext);
        await deps.upsertProjectDesignSystem({
          projectId: reference.projectId,
          markdown: parsedDesignSystem.markdown,
          structuredTokens: parsedDesignSystem.structuredTokens,
          status: "draft",
          sourceType: "figma-reference",
          sourceReferenceId: reference.id
        });

        await deps.createReferenceStarterFrames({
          projectId: updated.projectId,
          referenceSourceId: updated.id,
          fileKey: updated.fileKey,
          nodeId: updated.nodeId,
          scope: updated.scope,
          styleContext: resolvedStyleContext,
          designSystemChecklist: checklist,
          referenceScreen: fallbackReferenceScreen
        });

        response.status(200).json({
          reference: updated,
          warning:
            "Resync could not use MCP get_design_context and was rebuilt from public-link fallback style context.",
          fallback: {
            mode: "public-link-style-context",
            reason: fallbackReason,
            requiredClientCredentials: false,
            retryPrompt: "Re-sync again after MCP recovers for exact node-to-code rebuild."
          }
        });
        return;
      } catch (fallbackError) {
        const updated = await deps.updateReferenceSource(reference.id, {
          syncStatus: "failed",
          syncError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          updateSyncedAt: false
        });
        response.status(200).json({
          reference: updated,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          fallback: {
            mode: hasClientCredentials ? "credentials-provided-fallback-failed" : "credentials-required",
            reason: fallbackReason,
            requiredClientCredentials: !hasClientCredentials,
            retryPrompt: hasClientCredentials
              ? "Check link permissions and credentials, then retry."
              : fallbackCredentialsPrompt()
          }
        });
      }
    }
  });

  app.post("/references/:id/design-system/approve", async (request, response) => {
    const reference = await deps.getReferenceSource(request.params.id);
    if (!reference) {
      sendApiError(response, 404, "Reference not found.", "not_found");
      return;
    }

    if (!reference.designSystemChecklist) {
      sendApiError(response, 400, "No design system checklist available to approve.", "bad_request");
      return;
    }

    const notes = typeof request.body?.notes === "string" ? request.body.notes.trim() : "";
    const updated = await deps.updateReferenceSource(reference.id, {
      designSystemStatus: "approved",
      designSystemNotes: notes || null,
      updateDesignSystemAt: true
    });

    response.json(updated);
  });

  app.post("/references/:id/design-system/needs-edits", async (request, response) => {
    const reference = await deps.getReferenceSource(request.params.id);
    if (!reference) {
      sendApiError(response, 404, "Reference not found.", "not_found");
      return;
    }

    const notes = typeof request.body?.notes === "string" ? request.body.notes.trim() : "";
    const updated = await deps.updateReferenceSource(reference.id, {
      designSystemStatus: "needs-edits",
      designSystemNotes: notes || "Requested edits from chat.",
      updateDesignSystemAt: true
    });

    response.json(updated);
  });
}
