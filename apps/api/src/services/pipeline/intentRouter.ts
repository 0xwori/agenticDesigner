import type { PromptIntentType, ProviderId, ReferenceStyleContext } from "@designer/shared";
import { requestCompletion } from "../llmProviders.js";

type PromptIntent = {
  type: PromptIntentType;
  reason: string;
  shouldTakeAction: boolean;
  designSystemAction: "none" | "approve" | "iterate";
};

function asJsonObject<T extends object>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export function detectIntentHeuristic(prompt: string): PromptIntent {
  const normalized = prompt.trim().toLowerCase();
  const asksQuestion =
    normalized.endsWith("?") ||
    /^(what|why|how|when|where|who|can you|could you|would you|is it|are there)\b/.test(normalized);

  const actionVerb = /\b(design|generate|create|build|make|redesign|draft|render|add|edit|update|revise)\b/.test(normalized);
  const mentionsDesignSystem = /\b(design system|design-system|style guide|tokens|figma variables)\b/.test(normalized);
  const approve = /\b(approve|approved|ship it|looks good|accept)\b/.test(normalized);
  const iterate = /\b(change|edit|update|iterate|tweak|adjust|improve|refine)\b/.test(normalized);

  if (mentionsDesignSystem) {
    if (approve) {
      return {
        type: "design-system",
        reason: "Prompt explicitly requests design-system approval.",
        shouldTakeAction: true,
        designSystemAction: "approve"
      };
    }

    if (asksQuestion && !iterate) {
      return {
        type: "question",
        reason: "Prompt asks a design-system question without requesting changes.",
        shouldTakeAction: false,
        designSystemAction: "none"
      };
    }

    return {
      type: "design-system",
      reason: "Prompt references design-system content and should route to checklist workflow.",
      shouldTakeAction: true,
      designSystemAction: "iterate"
    };
  }

  if (asksQuestion && !actionVerb) {
    return {
      type: "question",
      reason: "Prompt is a design question with no explicit generation/edit action.",
      shouldTakeAction: false,
      designSystemAction: "none"
    };
  }

  return {
    type: "screen-action",
    reason: "Prompt requests a concrete design action.",
    shouldTakeAction: true,
    designSystemAction: "none"
  };
}

/**
 * Detects flow-action intent when the selected frame is a flow board.
 * Call before the general heuristic; returns null if the prompt is not flow-related.
 */
export function detectFlowIntentHeuristic(
  prompt: string,
  frameKind: string | undefined
): PromptIntent | null {
  if (frameKind !== "flow") return null;

  const normalized = prompt.trim().toLowerCase();
  const flowVerb =
    /\b(add|connect|link|remove|generate|create|upload|disconnect|attach|insert)\b/.test(normalized);

  if (flowVerb) {
    return {
      type: "flow-action",
      reason: "Flow board is selected and prompt contains a flow mutation verb.",
      shouldTakeAction: true,
      designSystemAction: "none",
    };
  }

  // If a flow board is selected but prompt looks like a question, treat as question
  const isQuestion =
    normalized.endsWith("?") ||
    /^(what|why|how|when|where|who|can you|could you|would you|is it|are there)\b/.test(normalized);

  if (isQuestion) {
    return {
      type: "question",
      reason: "Flow board context but prompt is asking a question.",
      shouldTakeAction: false,
      designSystemAction: "none",
    };
  }

  // Default: treat as flow-action when a flow board is selected
  return {
    type: "flow-action",
    reason: "Flow board is selected; routing to flow-action by default.",
    shouldTakeAction: true,
    designSystemAction: "none",
  };
}

export async function classifyPromptIntent(input: {
  prompt: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  editing: boolean;
  styleContext: ReferenceStyleContext;
  hasSyncedReference: boolean;
}): Promise<PromptIntent> {
  const fallback = detectIntentHeuristic(input.prompt);

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    system:
      "Classify prompt intent for a design assistant. Return JSON with keys: type (screen-action|question|design-system|flow-action), shouldTakeAction (boolean), reason (string), designSystemAction (none|approve|iterate). Use flow-action when the prompt targets a flow board (adding screens, journey steps, connections, code blocks).",
    prompt: `Prompt: ${input.prompt}
Editing mode: ${input.editing}
Has synced reference: ${input.hasSyncedReference}
Style motifs: ${input.styleContext.layoutMotifs.join(", ")}
Return strict JSON.`
  });

  const parsed = asJsonObject<Partial<PromptIntent>>(completion.content, fallback);
  const type =
    parsed.type === "screen-action" || parsed.type === "question" || parsed.type === "design-system" || parsed.type === "flow-action"
      ? parsed.type
      : fallback.type;
  const designSystemAction =
    parsed.designSystemAction === "approve" || parsed.designSystemAction === "iterate" || parsed.designSystemAction === "none"
      ? parsed.designSystemAction
      : fallback.designSystemAction;

  return {
    type,
    shouldTakeAction: typeof parsed.shouldTakeAction === "boolean" ? parsed.shouldTakeAction : fallback.shouldTakeAction,
    reason: typeof parsed.reason === "string" && parsed.reason.trim().length > 0 ? parsed.reason : fallback.reason,
    designSystemAction
  };
}

export type { PromptIntent };
