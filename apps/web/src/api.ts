import type {
  ApplyFlowActionResponse,
  ComposerAttachment,
  DeckSlideCount,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  FlowActionResponse,
  FlowDocument,
  FlowStoryResponse,
  Frame,
  FrameKind,
  FrameVersion,
  PipelineEvent,
  Project,
  ProjectAsset,
  ProjectBundle,
  ProjectDesignSystem,
  ProjectSettings,
  PromptIntentType,
  ProviderId,
  ReferenceSource,
  SelectedBlockContext,
  SelectedFrameContext,
  SurfaceTarget
} from "@designer/shared";

export const DEFAULT_API_BASE = "http://localhost:8787";

export type RunRequestPayload = {
  prompt: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  devicePreset: DevicePreset;
  mode: DesignMode;
  surfaceTarget?: SurfaceTarget;
  designSystemMode?: DesignSystemMode;
  variation: number;
  tailwindEnabled: boolean;
  attachments?: ComposerAttachment[];
  selectedFrameContext?: SelectedFrameContext;
  selectedBlockContext?: SelectedBlockContext;
  deckSlideCount?: DeckSlideCount;
  intentHint?: PromptIntentType;
};

async function request<T>(apiBaseUrl: string, path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {})
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Network error while calling ${apiBaseUrl}${path}: ${message}`);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = errorBody?.error ?? `Request failed (${response.status})`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function checkApiHealth(apiBaseUrl: string) {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function getApiBaseUrl(input?: string) {
  if (!input) {
    return DEFAULT_API_BASE;
  }
  return input.replace(/\/+$/, "");
}

export function createProject(apiBaseUrl: string, name?: string) {
  return request<ProjectBundle>(apiBaseUrl, "/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export function getProjectBundle(apiBaseUrl: string, projectId: string) {
  return request<ProjectBundle>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}`);
}

export function getProjectAssets(apiBaseUrl: string, projectId: string) {
  return request<{ assets: ProjectAsset[] }>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/assets`);
}

export function createProjectAsset(
  apiBaseUrl: string,
  projectId: string,
  payload: {
    kind: ProjectAsset["kind"];
    name: string;
    mimeType: string;
    dataUrl?: string;
    textContent?: string;
  }
) {
  return request<{ asset: ProjectAsset }>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/assets`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteProjectAsset(apiBaseUrl: string, projectId: string, assetId: string) {
  return request<{ ok: boolean }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "DELETE"
    }
  );
}

export function clearBoard(apiBaseUrl: string, projectId: string) {
  return request<ProjectBundle>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/clear-board`, {
    method: "POST"
  });
}

export function updateProjectSettings(apiBaseUrl: string, projectId: string, patch: Partial<ProjectSettings>) {
  return request<Project>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function getProjectDesignSystem(apiBaseUrl: string, projectId: string) {
  return request<{ designSystem: ProjectDesignSystem | null }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system`
  );
}

export function saveProjectDesignSystem(
  apiBaseUrl: string,
  projectId: string,
  payload: {
    markdown: string;
    status?: "empty" | "draft" | "approved";
    sourceType?: "manual" | "figma-reference" | "image-reference" | "chat";
    sourceReferenceId?: string | null;
  }
) {
  return request<{ designSystem: ProjectDesignSystem; warnings: string[] }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function bootstrapProjectDesignSystem(
  apiBaseUrl: string,
  projectId: string,
  mode: "manual" | "reference"
) {
  return request<{ designSystem: ProjectDesignSystem; warnings: string[] }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system/bootstrap`,
    {
      method: "POST",
      body: JSON.stringify({ mode })
    }
  );
}

export function regenerateProjectDesignSystemFromReference(
  apiBaseUrl: string,
  projectId: string,
  payload:
    | { sourceType: "figma-reference"; referenceSourceId: string }
    | { sourceType: "image-reference"; frameId: string }
) {
  const normalized =
    payload.sourceType === "figma-reference"
      ? [{ sourceType: "figma-reference" as const, referenceSourceId: payload.referenceSourceId }]
      : [{ sourceType: "image-reference" as const, frameId: payload.frameId }];

  return request<{ designSystem: ProjectDesignSystem; warnings: string[] }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({ references: normalized })
    }
  );
}

export function regenerateProjectDesignSystem(
  apiBaseUrl: string,
  projectId: string,
  payload?: {
    references?: Array<
      | { sourceType: "figma-reference"; referenceSourceId: string }
      | { sourceType: "image-reference"; frameId: string }
    >;
  }
) {
  return request<{ designSystem: ProjectDesignSystem; warnings: string[] }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system/regenerate`,
    {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    }
  );
}

export function resetAndRegenerateProjectDesignSystem(apiBaseUrl: string, projectId: string) {
  return request<{ designSystem: ProjectDesignSystem; warnings: string[] }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system/reset-regenerate`,
    {
      method: "POST"
    }
  );
}

export function calibrateProjectDesignSystem(
  apiBaseUrl: string,
  projectId: string,
  payload: {
    updates:
      | string
      | Array<{
          family: string;
          field: string;
          value: string | number;
        }>;
  }
) {
  return request<{ designSystem: ProjectDesignSystem; warnings: string[]; applied?: string[] }>(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/design-system/calibrate`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function addReference(apiBaseUrl: string, projectId: string, figmaUrl: string) {
  return request<
    | ReferenceSource
    | {
        reference?: ReferenceSource;
        error?: string;
        warning?: string;
        fallback?: {
          mode: string;
          reason: string;
          requiredClientCredentials: boolean;
          retryPrompt: string;
        };
      }
  >(
    apiBaseUrl,
    `/projects/${encodeURIComponent(projectId)}/references`,
    {
      method: "POST",
      body: JSON.stringify({ figmaUrl })
    }
  );
}

export function addReferenceWithCredentials(
  apiBaseUrl: string,
  projectId: string,
  payload: {
    figmaUrl: string;
    figmaClientId?: string;
    figmaClientSecret?: string;
  }
) {
  return request<
    | ReferenceSource
    | {
        reference?: ReferenceSource;
        error?: string;
        warning?: string;
        fallback?: {
          mode: string;
          reason: string;
          requiredClientCredentials: boolean;
          retryPrompt: string;
        };
      }
  >(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/references`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function resyncReference(apiBaseUrl: string, referenceId: string) {
  return request<
    | ReferenceSource
    | {
        reference?: ReferenceSource;
        error?: string;
        warning?: string;
        fallback?: {
          mode: string;
          reason: string;
          requiredClientCredentials: boolean;
          retryPrompt: string;
        };
      }
  >(
    apiBaseUrl,
    `/references/${encodeURIComponent(referenceId)}/resync`,
    {
      method: "POST"
    }
  );
}

export function approveReferenceDesignSystem(apiBaseUrl: string, referenceId: string, notes?: string) {
  return request<ReferenceSource>(apiBaseUrl, `/references/${encodeURIComponent(referenceId)}/design-system/approve`, {
    method: "POST",
    body: JSON.stringify({
      notes
    })
  });
}

export function markReferenceDesignSystemNeedsEdits(apiBaseUrl: string, referenceId: string, notes?: string) {
  return request<ReferenceSource>(
    apiBaseUrl,
    `/references/${encodeURIComponent(referenceId)}/design-system/needs-edits`,
    {
      method: "POST",
      body: JSON.stringify({
        notes
      })
    }
  );
}

export function createManualFrame(
  apiBaseUrl: string,
  projectId: string,
  payload: {
    devicePreset?: DevicePreset;
    mode?: DesignMode;
    tailwindEnabled?: boolean;
    name?: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    frameKind?: FrameKind;
    flowDocument?: FlowDocument;
  }
) {
  return request<Frame & { versions: FrameVersion[] }>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/frames`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteFrame(apiBaseUrl: string, frameId: string) {
  return request<{ ok: boolean }>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}`, {
    method: "DELETE"
  });
}

export function updateFrameLayout(
  apiBaseUrl: string,
  frameId: string,
  payload: { position?: { x: number; y: number }; size?: { width: number; height: number }; selected?: boolean }
) {
  return request<Frame>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/layout`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function updateFlowDocument(
  apiBaseUrl: string,
  frameId: string,
  flowDocument: FlowDocument
) {
  return request<Frame>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/flow-document`, {
    method: "PATCH",
    body: JSON.stringify({ flowDocument })
  });
}

export function saveFlowBoardMemory(
  apiBaseUrl: string,
  frameId: string,
  authoredText: string,
) {
  return request<{
    ok: boolean;
    frameId: string;
    flowDocument: FlowDocument;
    memoryText: string;
    summary: string;
  }>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/board-memory`, {
    method: "PATCH",
    body: JSON.stringify({ authoredText })
  });
}

export function sendFlowAction(
  apiBaseUrl: string,
  frameId: string,
  payload: {
    prompt: string;
    provider: string;
    model: string;
    apiKey?: string;
    attachments?: ComposerAttachment[];
    focusedAreaId?: string;
  }
) {
  return request<FlowActionResponse>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/flow-action`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function applyFlowActionReview(
  apiBaseUrl: string,
  frameId: string,
  reviewCommands: FlowActionResponse["reviewRequiredCommands"],
) {
  return request<ApplyFlowActionResponse>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/flow-action/apply`, {
    method: "POST",
    body: JSON.stringify({ commands: reviewCommands.map((item) => item.command) })
  });
}

export function generateFlowStory(
  apiBaseUrl: string,
  frameId: string,
  payload: {
    prompt?: string;
    provider: ProviderId;
    model: string;
    apiKey?: string;
  },
) {
  return request<FlowStoryResponse>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/flow-story`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getFrameVersions(apiBaseUrl: string, frameId: string) {
  return request<FrameVersion[]>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/versions`);
}

export function startGenerateRun(apiBaseUrl: string, projectId: string, payload: RunRequestPayload) {
  return request<{ runId: string }>(apiBaseUrl, `/projects/${encodeURIComponent(projectId)}/generate`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function startEditRun(apiBaseUrl: string, frameId: string, payload: Omit<RunRequestPayload, "variation">) {
  return request<{ runId: string }>(apiBaseUrl, `/frames/${encodeURIComponent(frameId)}/edit`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getDeckDownloadUrl(apiBaseUrl: string, frameId: string) {
  return `${apiBaseUrl}/frames/${encodeURIComponent(frameId)}/deck.pptx`;
}

export function openRunStream(
  apiBaseUrl: string,
  runId: string,
  handlers: {
    onEvent: (event: PipelineEvent) => void;
    onError?: (error: Event) => void;
    onClose?: () => void;
  }
) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/runs/${encodeURIComponent(runId)}/stream`;
  url.search = "";
  const wsUrl = url.toString();

  const seenEventIds = new Set<number>();
  let reconnectAttempt = 0;
  const MAX_RECONNECT = 5;
  let disposed = false;
  let activeSocket: WebSocket | null = null;

  function connect() {
    const socket = new WebSocket(wsUrl);
    activeSocket = socket;

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as PipelineEvent;
        // Deduplicate events on reconnect (server replays backlog)
        if (typeof parsed.id === "number") {
          if (seenEventIds.has(parsed.id)) return;
          seenEventIds.add(parsed.id);
        }
        handlers.onEvent(parsed);
      } catch {
        // ignore malformed stream payload
      }
    };

    socket.onerror = (event) => {
      // Only surface errors to callers if we've exhausted reconnect attempts
      if (reconnectAttempt >= MAX_RECONNECT || disposed) {
        handlers.onError?.(event);
      }
    };

    socket.onclose = () => {
      if (disposed) {
        handlers.onClose?.();
        return;
      }
      if (reconnectAttempt < MAX_RECONNECT) {
        reconnectAttempt += 1;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 16_000);
        setTimeout(connect, delay);
      } else {
        handlers.onClose?.();
      }
    };
  }

  connect();

  // Return a proxy object so callers can close the stream
  return {
    close() {
      disposed = true;
      activeSocket?.close();
    },
    get readyState() {
      return activeSocket?.readyState ?? WebSocket.CLOSED;
    }
  };
}
