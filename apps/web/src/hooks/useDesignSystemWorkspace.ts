import { useCallback, useRef } from "react";
import type { ComposerAttachment, ProjectBundle } from "@designer/shared";
import {
  addReferenceWithCredentials,
  bootstrapProjectDesignSystem,
  getApiBaseUrl,
  getProjectBundle,
  getProjectDesignSystem,
  regenerateProjectDesignSystem,
  regenerateProjectDesignSystemFromReference,
  resetAndRegenerateProjectDesignSystem,
  saveProjectDesignSystem,
  startGenerateRun
} from "../api";
import { createLocalRunId, extractFigmaUrl } from "../lib/appHelpers";
import { runSequentialQueue } from "../lib/designSystemModal";
import { extractFrameSourceMeta } from "../lib/frameLinking";
import { useProjectState, useInputState, useUIState } from "../lib/store";
import type { PipelineEventsApi } from "./usePipelineEvents";
import type { DesignSystemReferenceItem } from "../components/ProjectDesignSystemModal";

export type DesignSystemWorkspaceApi = {
  openProjectDesignSystem: () => Promise<void>;
  emitDesignSystemQualitySummary: (input: { designSystem: NonNullable<ProjectBundle["designSystem"]>; reason: string }) => void;
  addFigmaReferenceFromDesignSystemModal: (rawUrl: string) => Promise<void>;
  bootstrapProjectDesignSystemFromModal: (mode: "manual" | "reference") => Promise<void>;
  resetAndRegenerateDesignSystemFromModal: () => Promise<void>;
  saveProjectDesignSystemMarkdown: (markdown: string) => Promise<void>;
  regenerateDesignSystemFromReference: (item: DesignSystemReferenceItem) => Promise<void>;
  regenerateDesignSystemFromAllReferences: () => Promise<void>;
  addImageReferencesFromDesignSystemModal: (files: File[]) => Promise<void>;
  attachFigmaFromChat: (input: { runId: string; figmaUrl: string }) => Promise<boolean>;
};

export function useDesignSystemWorkspace(
  events: Pick<PipelineEventsApi,
    | "pushDebugLog"
    | "appendSystemEvent"
    | "appendChatEvent"
    | "appendOrderedEvent"
    | "appendPromptTurn"
    | "openRunSocket"
    | "waitForRunCompletion"
    | "revealDesignSystemRunsRef"
    | "scheduleRefresh"
  >
): DesignSystemWorkspaceApi {
  const { bundle, setBundle } = useProjectState();
  const {
    selectedDevice,
    selectedMode,
    selectedSurfaceTarget,
    selectedDesignSystemMode,
    tailwindOverride,
    setComposerAttachments,
    setComposerPrompt,
    variation
  } = useInputState();
  const {
    preferences,
    setProjectDesignSystemOpen,
    setDesignSystemBusy,
    setDesignSystemBusyLabel,
    setDesignSystemRegeneratingReferenceId,
    setDesignSystemWarnings,
    setPendingFigmaAttachUrl,
    setPendingCanvasCards
  } = useUIState();

  const {
    pushDebugLog,
    appendSystemEvent,
    appendChatEvent,
    appendOrderedEvent,
    appendPromptTurn,
    openRunSocket,
    waitForRunCompletion,
    revealDesignSystemRunsRef,
    scheduleRefresh
  } = events;

  // Keep stable refs to avoid stale closures in callbacks
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  // Derived
  const projectId = bundle?.project.id ?? null;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // -------------------------------------------------------------------------
  // emitDesignSystemQualitySummary
  // -------------------------------------------------------------------------
  const emitDesignSystemQualitySummary = useCallback(
    (input: { designSystem: NonNullable<ProjectBundle["designSystem"]>; reason: string }) => {
      const report = input.designSystem.structuredTokens.qualityReport;
      appendSystemEvent({
        status: report.referenceQuality === "poor" ? "error" : "info",
        kind: "summary",
        message: `${input.reason}: reference quality ${report.referenceQuality} (${Math.round(report.globalConfidence * 100)}% confidence).`,
        payload: {
          step: "design-system-quality",
          referenceQuality: report.referenceQuality,
          confidence: report.globalConfidence,
          fidelityScore: report.fidelityScore,
          detectionCoverage: report.detectionCoverage,
          qualityReasons: report.qualityReasons
        }
      });
      if (report.referenceQuality !== "good") {
        const guidance =
          report.qualityReasons[0] ??
          report.recommendations[0] ??
          "Attach clearer references or calibrate in chat, then regenerate.";
        appendSystemEvent({
          status: report.referenceQuality === "poor" ? "error" : "info",
          kind: "action",
          message: `Quality note: ${guidance}`
        });
      }
    },
    [appendSystemEvent]
  );

  // -------------------------------------------------------------------------
  // openProjectDesignSystem
  // -------------------------------------------------------------------------
  const openProjectDesignSystem = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setProjectDesignSystemOpen(true);
    try {
      const apiBase = getApiBaseUrl(preferencesRef.current.apiBaseUrl);
      const response = await getProjectDesignSystem(apiBase, pid);
      setBundle((current) => (current ? { ...current, designSystem: response.designSystem } : current));
    } catch (reason) {
      pushDebugLog("design-system", reason, { projectId: pid }, "warn");
    }
  }, [setProjectDesignSystemOpen, setBundle, pushDebugLog]);

  // -------------------------------------------------------------------------
  // attachFigmaFromChat
  // -------------------------------------------------------------------------
  const attachFigmaFromChat = useCallback(
    async (input: { runId: string; figmaUrl: string }): Promise<boolean> => {
      const pid = projectIdRef.current;
      if (!pid) return false;
      const prefs = preferencesRef.current;
      const apiBase = getApiBaseUrl(prefs.apiBaseUrl);

      appendChatEvent({
        runId: input.runId,
        stage: "system",
        status: "info",
        kind: "summary",
        message: "Detected a Figma link in chat. Starting reference attach via MCP get_design_context."
      });

      try {
        const result = await addReferenceWithCredentials(apiBase, pid, {
          figmaUrl: input.figmaUrl.trim(),
          figmaClientId: prefs.figmaClientId.trim() || undefined,
          figmaClientSecret: prefs.figmaClientSecret.trim() || undefined
        });

        const payload =
          typeof result === "object" && result !== null
            ? (result as {
                error?: string;
                warning?: string;
                fallback?: { mode?: string; requiredClientCredentials?: boolean; retryPrompt?: string };
              })
            : null;

        const fallback = payload?.fallback;
        const errorMessage = payload?.error;
        const warningMessage = payload?.warning;

        if (errorMessage) {
          appendChatEvent({ runId: input.runId, stage: "system", status: "error", kind: "summary", message: errorMessage });
        }

        if (fallback?.requiredClientCredentials) {
          setPendingFigmaAttachUrl(input.figmaUrl);
          appendChatEvent({
            runId: input.runId,
            stage: "system",
            status: "info",
            kind: "action",
            message: fallback.retryPrompt ?? "MCP failed. Send `/figma-credentials <clientId> <clientSecret>` in chat, then resend your Figma link."
          });
          return false;
        } else if (!errorMessage) {
          appendChatEvent({
            runId: input.runId,
            stage: "system",
            status: "success",
            kind: "summary",
            message: warningMessage
              ? `Reference attached with fallback mode (${fallback?.mode ?? "public-link-style-context"}).`
              : "Reference attached and frames were created from the Figma link."
          });
          if (warningMessage) {
            appendChatEvent({ runId: input.runId, stage: "system", status: "info", kind: "action", message: warningMessage });
          }
          setPendingFigmaAttachUrl(null);
        } else {
          return false;
        }

        const refreshed = await getProjectBundle(apiBase, pid);
        setBundle(refreshed);
        pushDebugLog("add-reference", "Reference attach completed", { figmaUrl: input.figmaUrl, referenceCount: refreshed.references.length }, "info");
        return true;
      } catch (reason) {
        pushDebugLog("add-reference", reason, { figmaUrl: input.figmaUrl }, "error");
        appendChatEvent({ runId: input.runId, stage: "system", status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
        return false;
      }
    },
    [appendChatEvent, setBundle, pushDebugLog, setPendingFigmaAttachUrl]
  );

  // -------------------------------------------------------------------------
  // addFigmaReferenceFromDesignSystemModal
  // -------------------------------------------------------------------------
  const addFigmaReferenceFromDesignSystemModal = useCallback(
    async (rawUrl: string) => {
      const figmaUrl = extractFigmaUrl(rawUrl);
      if (!figmaUrl) {
        appendSystemEvent({ status: "error", kind: "action", message: "Invalid Figma URL. Use a figma.com/design link." });
        return;
      }
      const runId = createLocalRunId("ds-reference");
      appendChatEvent({ runId, stage: "system", status: "info", kind: "summary", message: "Adding Figma reference from the design system workspace." });
      const attached = await attachFigmaFromChat({ runId, figmaUrl });
      if (attached) {
        setProjectDesignSystemOpen(false);
        await bootstrapProjectDesignSystemFromModal("reference");
      }
    },
    [appendSystemEvent, appendChatEvent, attachFigmaFromChat, setProjectDesignSystemOpen]
  );

  // -------------------------------------------------------------------------
  // bootstrapProjectDesignSystemFromModal
  // -------------------------------------------------------------------------
  const bootstrapProjectDesignSystemFromModal = useCallback(
    async (mode: "manual" | "reference") => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const apiBase = getApiBaseUrl(preferencesRef.current.apiBaseUrl);
      setDesignSystemBusy(true);
      setDesignSystemBusyLabel(
        mode === "reference"
          ? "Reviewing connected references and refreshing visual components..."
          : "Creating a manual design system workspace..."
      );
      setDesignSystemRegeneratingReferenceId(null);
      try {
        const result = await bootstrapProjectDesignSystem(apiBase, pid, mode);
        setBundle((current) => (current ? { ...current, designSystem: result.designSystem } : current));
        setDesignSystemWarnings(result.warnings ?? []);
        emitDesignSystemQualitySummary({
          designSystem: result.designSystem,
          reason: mode === "manual" ? "Manual DESIGN.md bootstrap completed" : "Reference bootstrap completed"
        });
        appendSystemEvent({
          status: "success",
          kind: "summary",
          message:
            mode === "manual"
              ? "Design system seeded from manual template. Open design.md to refine it."
              : "Design system bootstrapped from the latest synced reference."
        });
      } catch (reason) {
        appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
        pushDebugLog("design-system-bootstrap", reason, { mode, projectId: pid }, "error");
      } finally {
        setDesignSystemBusy(false);
        setDesignSystemBusyLabel(null);
      }
    },
    [setDesignSystemBusy, setDesignSystemBusyLabel, setDesignSystemRegeneratingReferenceId, setBundle, setDesignSystemWarnings, emitDesignSystemQualitySummary, appendSystemEvent, pushDebugLog]
  );

  // -------------------------------------------------------------------------
  // resetAndRegenerateDesignSystemFromModal
  // -------------------------------------------------------------------------
  const resetAndRegenerateDesignSystemFromModal = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const apiBase = getApiBaseUrl(preferencesRef.current.apiBaseUrl);
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel("Resetting design system and rebuilding from all references...");
    setDesignSystemRegeneratingReferenceId(null);
    try {
      const result = await resetAndRegenerateProjectDesignSystem(apiBase, pid);
      setBundle((current) => (current ? { ...current, designSystem: result.designSystem } : current));
      setDesignSystemWarnings(result.warnings ?? []);
      emitDesignSystemQualitySummary({ designSystem: result.designSystem, reason: "Full reset and regeneration completed" });
      appendSystemEvent({ status: "success", kind: "summary", message: "Design system reset completed. Metadata was cleared and system rebuilt from current references." });
    } catch (reason) {
      appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
      pushDebugLog("design-system-reset-regenerate", reason, { projectId: pid }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
    }
  }, [setDesignSystemBusy, setDesignSystemBusyLabel, setDesignSystemRegeneratingReferenceId, setBundle, setDesignSystemWarnings, emitDesignSystemQualitySummary, appendSystemEvent, pushDebugLog]);

  // -------------------------------------------------------------------------
  // saveProjectDesignSystemMarkdown
  // -------------------------------------------------------------------------
  const saveProjectDesignSystemMarkdown = useCallback(async (markdown: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const apiBase = getApiBaseUrl(preferencesRef.current.apiBaseUrl);
    const currentBundle = bundleRef.current;
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel("Saving design.md and refreshing visual components...");
    setDesignSystemRegeneratingReferenceId(null);
    try {
      const result = await saveProjectDesignSystem(apiBase, pid, {
        markdown,
        status: "draft",
        sourceType: currentBundle?.designSystem?.sourceType ?? "manual",
        sourceReferenceId: currentBundle?.designSystem?.sourceReferenceId ?? null
      });
      setBundle((current) => (current ? { ...current, designSystem: result.designSystem } : current));
      setDesignSystemWarnings(result.warnings ?? []);
      appendSystemEvent({ status: "success", kind: "action", message: "Saved design.md and refreshed the visual system." });
      // Refresh the full bundle so the artboard DS frame updates immediately
      scheduleRefresh(400);
    } catch (reason) {
      appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
      pushDebugLog("design-system-save", reason, { projectId: pid }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
    }
  }, [setDesignSystemBusy, setDesignSystemBusyLabel, setDesignSystemRegeneratingReferenceId, setBundle, setDesignSystemWarnings, appendSystemEvent, pushDebugLog, scheduleRefresh]);

  // -------------------------------------------------------------------------
  // regenerateDesignSystemFromReference
  // -------------------------------------------------------------------------
  const regenerateDesignSystemFromReference = useCallback(async (item: DesignSystemReferenceItem) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    if (item.sourceType === "image-reference" && !item.frameId) {
      appendSystemEvent({ status: "error", kind: "summary", message: "Cannot regenerate from this image reference yet because its frame mapping is missing." });
      return;
    }
    const apiBase = getApiBaseUrl(preferencesRef.current.apiBaseUrl);
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel(`Reviewing ${item.previewLabel.toLowerCase()} and updating the visual design system...`);
    setDesignSystemRegeneratingReferenceId(item.id);
    appendSystemEvent({ status: "info", kind: "summary", message: `Regenerating design system from ${item.title}.` });
    try {
      const result =
        item.sourceType === "figma-reference"
          ? await regenerateProjectDesignSystemFromReference(apiBase, pid, { sourceType: "figma-reference", referenceSourceId: item.referenceSourceId ?? "" })
          : await regenerateProjectDesignSystemFromReference(apiBase, pid, { sourceType: "image-reference", frameId: item.frameId ?? "" });
      setBundle((current) => (current ? { ...current, designSystem: result.designSystem } : current));
      setDesignSystemWarnings(result.warnings ?? []);
      emitDesignSystemQualitySummary({ designSystem: result.designSystem, reason: `Regeneration completed from ${item.title}` });
      appendSystemEvent({ status: "success", kind: "summary", message: `Design system regenerated from ${item.title}.` });
    } catch (reason) {
      appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
      pushDebugLog("design-system-regenerate", reason, { projectId: pid, sourceType: item.sourceType, referenceSourceId: item.referenceSourceId, frameId: item.frameId }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
    }
  }, [setDesignSystemBusy, setDesignSystemBusyLabel, setDesignSystemRegeneratingReferenceId, setBundle, setDesignSystemWarnings, emitDesignSystemQualitySummary, appendSystemEvent, pushDebugLog]);

  // -------------------------------------------------------------------------
  // regenerateDesignSystemFromAllReferences
  // -------------------------------------------------------------------------
  const regenerateDesignSystemFromAllReferences = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const apiBase = getApiBaseUrl(preferencesRef.current.apiBaseUrl);
    setDesignSystemBusy(true);
    setDesignSystemBusyLabel("Re-analyzing all references and rebuilding component recipes...");
    setDesignSystemRegeneratingReferenceId(null);
    appendSystemEvent({ status: "info", kind: "summary", message: "Regenerating design system from all available references." });
    try {
      const result = await regenerateProjectDesignSystem(apiBase, pid);
      setBundle((current) => (current ? { ...current, designSystem: result.designSystem } : current));
      setDesignSystemWarnings(result.warnings ?? []);
      emitDesignSystemQualitySummary({ designSystem: result.designSystem, reason: "Regeneration completed from all references" });
      appendSystemEvent({ status: "success", kind: "summary", message: "Design system regenerated from all references." });
    } catch (reason) {
      appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
      pushDebugLog("design-system-regenerate", reason, { projectId: pid, scope: "all-references" }, "error");
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
      setDesignSystemRegeneratingReferenceId(null);
    }
  }, [setDesignSystemBusy, setDesignSystemBusyLabel, setDesignSystemRegeneratingReferenceId, setBundle, setDesignSystemWarnings, emitDesignSystemQualitySummary, appendSystemEvent, pushDebugLog]);

  // -------------------------------------------------------------------------
  // Image reference file helpers
  // -------------------------------------------------------------------------

  function validateImageReferenceFile(file: File): string | null {
    const allowedMime = new Set(["image/png", "image/jpg", "image/jpeg", "image/webp", "image/svg+xml"]);
    if (!allowedMime.has(file.type)) return "Unsupported image type. Use png, jpg, jpeg, webp, or svg.";
    if (file.size > 8 * 1024 * 1024) return "Image is too large. Max supported size is 8 MB.";
    return null;
  }

  async function fileToImageAttachment(file: File): Promise<ComposerAttachment | null> {
    const validationError = validateImageReferenceFile(file);
    if (validationError) {
      appendSystemEvent({ status: "error", kind: "action", message: validationError });
      return null;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("File reader did not return a data URL."));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read image attachment."));
      reader.readAsDataURL(file);
    }).catch((reason) => {
      appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
      return null;
    });
    if (!dataUrl) return null;
    return {
      id: `image-modal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "image",
      status: "uploaded",
      name: file.name,
      mimeType: file.type,
      dataUrl
    } as ComposerAttachment;
  }

  // -------------------------------------------------------------------------
  // startImageReferenceRunFromModal
  // -------------------------------------------------------------------------
  async function startImageReferenceRunFromModal(
    imageAttachment: ComposerAttachment,
    options?: { waitForCompletion?: boolean; keepModalOpen?: boolean }
  ): Promise<boolean | Promise<boolean>> {
    const pid = projectIdRef.current;
    if (!pid) return false;
    const prefs = preferencesRef.current;
    const currentBundle = bundleRef.current;
    const apiBase = getApiBaseUrl(prefs.apiBaseUrl);

    const run = await startGenerateRun(apiBase, pid, {
      prompt: "Rebuild the attached image into an editable screen and refresh the canonical design-system board.",
      provider: prefs.provider,
      model: prefs.model,
      apiKey: prefs.apiKey.trim() || undefined,
      devicePreset: selectedDevice,
      mode: selectedMode,
      surfaceTarget: selectedSurfaceTarget,
      designSystemMode: selectedDesignSystemMode,
      variation: 1,
      tailwindEnabled: tailwindOverride,
      attachments: [imageAttachment]
    });

    const runId = run.runId;
    const completionPromise = options?.waitForCompletion ? waitForRunCompletion(runId) : null;
    revealDesignSystemRunsRef.current.add(runId);
    const createdAfterMs = Date.now();

    // Find anchor position from last frame
    const lastFrame = currentBundle?.frames?.[currentBundle.frames.length - 1];
    const anchor = lastFrame
      ? { x: lastFrame.position.x + lastFrame.size.width + 72, y: lastFrame.position.y + 12 }
      : { x: 320, y: 220 };

    setPendingCanvasCards((current) => [
      ...current,
      {
        id: `pending-image-screen-${runId}`,
        runId,
        sourceType: "image-reference" as const,
        sourceRole: "reference-screen" as const,
        createdAfterMs,
        name: "Reference Screen (building)",
        subtitle: "Rebuilding attached image into editable React/HTML",
        position: anchor,
        size: { width: 1080, height: 720 }
      },
      {
        id: `pending-image-ds-${runId}`,
        runId,
        sourceType: "image-reference" as const,
        sourceRole: "design-system" as const,
        createdAfterMs,
        name: "Design System (building)",
        subtitle: "Refreshing the canonical visual DS board from the rebuilt screen",
        position: { x: anchor.x + 1140, y: anchor.y + 28 },
        size: { width: 920, height: 620 }
      }
    ]);

    appendOrderedEvent({
      runId,
      timestamp: new Date().toISOString(),
      stage: "system",
      status: "info",
      kind: "summary",
      message: "Starting image-aware pipeline (analyze -> rebuild screen -> canonical design-system refresh)."
    });
    appendPromptTurn({ runId, prompt: "Generate from image reference (Design System modal)." });
    openRunSocket(runId);

    if (!options?.keepModalOpen) setProjectDesignSystemOpen(false);
    setComposerAttachments([]);
    setComposerPrompt("");

    pushDebugLog(
      "start-run",
      "Image reference run started from Design System modal",
      { runId, provider: prefs.provider, model: prefs.model, devicePreset: selectedDevice, designMode: selectedMode, attachmentCount: 1 },
      "info"
    );

    return completionPromise ?? true;
  }

  // -------------------------------------------------------------------------
  // addImageReferencesFromDesignSystemModal
  // -------------------------------------------------------------------------
  const addImageReferencesFromDesignSystemModal = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    try {
      setDesignSystemBusy(true);
      setDesignSystemBusyLabel(`Processing image references (0/${files.length})...`);
      setDesignSystemRegeneratingReferenceId(null);
      const queueResult = await runSequentialQueue(files, async (file, index) => {
        setDesignSystemBusyLabel(`Processing image references (${index + 1}/${files.length})...`);
        const attachment = await fileToImageAttachment(file);
        if (!attachment) return false;
        appendSystemEvent({ status: "info", kind: "summary", message: `Processing image reference ${index + 1}/${files.length}: ${file.name}` });
        const success = await startImageReferenceRunFromModal(attachment, { waitForCompletion: true, keepModalOpen: true });
        return success;
      });

      if (queueResult.successful > 0) {
        setDesignSystemBusyLabel("Merging all references into one design system...");
        await regenerateDesignSystemFromAllReferences();
      } else {
        appendSystemEvent({ status: "error", kind: "summary", message: "No valid image references completed. Design system was not regenerated." });
      }
    } catch (reason) {
      pushDebugLog("start-run", reason, { source: "design-system-modal-images" }, "error");
      appendSystemEvent({ status: "error", kind: "summary", message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setDesignSystemBusy(false);
      setDesignSystemBusyLabel(null);
    }
  }, [
    setDesignSystemBusy, setDesignSystemBusyLabel, setDesignSystemRegeneratingReferenceId,
    appendSystemEvent, pushDebugLog, regenerateDesignSystemFromAllReferences,
    // These are captured from the outer scope; listing them so deps are explicit
    selectedDevice, selectedMode, selectedSurfaceTarget, selectedDesignSystemMode, tailwindOverride,
    variation, waitForRunCompletion, revealDesignSystemRunsRef,
    setPendingCanvasCards, appendOrderedEvent, appendPromptTurn, openRunSocket,
    setProjectDesignSystemOpen, setComposerAttachments, setComposerPrompt
  ]);

  return {
    openProjectDesignSystem,
    emitDesignSystemQualitySummary,
    addFigmaReferenceFromDesignSystemModal,
    bootstrapProjectDesignSystemFromModal,
    resetAndRegenerateDesignSystemFromModal,
    saveProjectDesignSystemMarkdown,
    regenerateDesignSystemFromReference,
    regenerateDesignSystemFromAllReferences,
    addImageReferencesFromDesignSystemModal,
    attachFigmaFromChat
  };
}
