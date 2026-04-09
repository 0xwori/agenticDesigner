import type { ComposerAttachment, ProviderId } from "@designer/shared";
import { providerCircuit } from "../lib/circuitBreaker.js";

type CompletionInput = {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  system: string;
  prompt: string;
  jsonMode?: boolean;
  attachments?: ComposerAttachment[];
  allowMock?: boolean;
  timeoutMs?: number;
};

type CompletionResult = {
  content: string;
  usedProvider: ProviderId | "mock";
  usedModel: string;
  fallbackModelFrom?: string;
};

class OpenAIHttpError extends Error {
  status: number;
  code?: string;
  type?: string;

  constructor(input: { status: number; message: string; code?: string; type?: string }) {
    super(input.message);
    this.name = "OpenAIHttpError";
    this.status = input.status;
    this.code = input.code;
    this.type = input.type;
  }
}

const OPENAI_MODEL_FALLBACKS = ["gpt-5.4-mini", "gpt-5.4-nano"] as const;

function resolveOpenAIModelCandidates(requestedModel: string) {
  const requested = requestedModel.trim();
  if (!requested) {
    return [...OPENAI_MODEL_FALLBACKS];
  }
  return [requested, ...OPENAI_MODEL_FALLBACKS.filter((model) => model !== requested)];
}

function isOpenAIModelUnavailable(error: unknown) {
  if (!(error instanceof OpenAIHttpError)) {
    return false;
  }
  if (error.status !== 400 && error.status !== 404) {
    return false;
  }
  const details = `${error.code ?? ""} ${error.type ?? ""} ${error.message}`.toLowerCase();
  return (
    details.includes("model_not_found") ||
    (details.includes("model") && details.includes("does not exist")) ||
    details.includes("not a chat model") ||
    details.includes("not supported in the v1/chat/completions endpoint") ||
    details.includes("did you mean to use v1/completions")
  );
}

async function withTimeout(url: string, options: RequestInit, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function mockResponse(input: CompletionInput) {
  const prefix = input.jsonMode ? "{\"note\":\"mock\",\"content\":" : "Mock mode: ";
  return input.jsonMode
    ? `${prefix}${JSON.stringify(input.prompt.slice(0, 500))}}`
    : `${prefix}${input.prompt.slice(0, 500)}`;
}

function getImageAttachments(attachments?: ComposerAttachment[]) {
  if (!attachments?.length) {
    return [];
  }

  const imageAttachments: Array<{ url: string; mimeType?: string }> = [];
  for (const attachment of attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    if (typeof attachment.dataUrl !== "string" || attachment.dataUrl.length === 0) {
      continue;
    }

    imageAttachments.push({
      url: attachment.dataUrl,
      mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : undefined
    });
  }

  return imageAttachments;
}

async function callOpenAIModel(input: CompletionInput, model: string) {
  const imageAttachments = getImageAttachments(input.attachments);
  const userContent =
    imageAttachments.length > 0
      ? [
          {
            type: "text",
            text: input.prompt
          },
          ...imageAttachments.map((attachment) => ({
            type: "image_url",
            image_url: {
              url: attachment.url
            }
          }))
        ]
      : input.prompt;

  const response = await withTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: input.jsonMode ? { type: "json_object" } : undefined,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: userContent }
      ]
    })
  }, input.timeoutMs);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: {
            message?: string;
            code?: string;
            type?: string;
          };
        }
      | null;
    const code = payload?.error?.code;
    const type = payload?.error?.type;
    const message = payload?.error?.message ?? `OpenAI request failed (${response.status})`;
    throw new OpenAIHttpError({
      status: response.status,
      message: `OpenAI request failed (${response.status}): ${message}`,
      code,
      type
    });
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response did not contain text content.");
  }
  if (typeof content === "string") {
    return content;
  }
  const asText = content
    .map((part) => (part.type === "text" ? part.text ?? "" : ""))
    .join("")
    .trim();
  if (!asText) {
    throw new Error("OpenAI response did not contain text content.");
  }
  return asText;
}

async function callOpenAI(input: CompletionInput): Promise<Pick<CompletionResult, "content" | "usedModel" | "fallbackModelFrom">> {
  const candidates = resolveOpenAIModelCandidates(input.model);
  let lastModelError: unknown;
  for (const candidateModel of candidates) {
    try {
      const content = await callOpenAIModel(input, candidateModel);
      if (candidateModel !== input.model) {
        console.warn(
          `[llmProviders] OpenAI model fallback applied: requested "${input.model}" -> using "${candidateModel}".`
        );
        return {
          content,
          usedModel: candidateModel,
          fallbackModelFrom: input.model
        };
      }
      return {
        content,
        usedModel: candidateModel
      };
    } catch (error) {
      if (!isOpenAIModelUnavailable(error)) {
        throw error;
      }
      lastModelError = error;
    }
  }

  throw lastModelError instanceof Error
    ? lastModelError
    : new Error(`OpenAI model "${input.model}" is unavailable and fallback models were not accepted.`);
}

async function callAnthropic(input: CompletionInput) {
  const response = await withTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.apiKey ?? "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1200,
      system: input.system,
      messages: [
        {
          role: "user",
          content: input.prompt
        }
      ]
    })
  }, input.timeoutMs);

  if (!response.ok) {
    const err = new Error(`Anthropic request failed (${response.status})`);
    (err as Error & { status: number }).status = response.status;
    throw err;
  }

  const data = (await response.json()) as {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
  const content = data.content?.find((part) => part.type === "text")?.text;
  if (!content) {
    throw new Error("Anthropic response did not contain text content.");
  }
  return content;
}

async function callGoogle(input: CompletionInput) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey ?? "")}`;
  const response = await withTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${input.system}\n\n${input.prompt}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.4
      }
    })
  }, input.timeoutMs);

  if (!response.ok) {
    const err = new Error(`Google request failed (${response.status})`);
    (err as Error & { status: number }).status = response.status;
    throw err;
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Google response did not contain text content.");
  }
  return content;
}

export async function requestCompletion(input: CompletionInput): Promise<CompletionResult> {
  const allowMock = input.allowMock !== false;
  const hasImageAttachments = getImageAttachments(input.attachments).length > 0;

  if (hasImageAttachments && input.provider !== "openai") {
    throw new Error("Image attachments are currently supported only with OpenAI vision-capable models.");
  }

  if (!input.apiKey) {
    if (!allowMock) {
      throw new Error(
        `Missing API key for provider "${input.provider}". Add a valid key in workspace settings and retry.`
      );
    }
    return {
      content: mockResponse(input),
      usedProvider: "mock",
      usedModel: "mock"
    };
  }

  if (providerCircuit.isOpen(input.provider)) {
    const circuitErr = new Error(
      `Provider "${input.provider}" circuit breaker is open — too many consecutive failures. Wait ~60 s and retry.`
    );
    (circuitErr as Error & { status: number }).status = 503;
    if (!allowMock || hasImageAttachments) {
      throw circuitErr;
    }
    return {
      content: mockResponse(input),
      usedProvider: "mock",
      usedModel: "mock"
    };
  }

  try {
    let result: CompletionResult;

    if (input.provider === "openai") {
      const openAIResult = await callOpenAI(input);
      result = {
        content: openAIResult.content,
        usedProvider: "openai",
        usedModel: openAIResult.usedModel,
        fallbackModelFrom: openAIResult.fallbackModelFrom
      };
    } else if (input.provider === "anthropic") {
      result = {
        content: await callAnthropic(input),
        usedProvider: "anthropic",
        usedModel: input.model
      };
    } else {
      result = {
        content: await callGoogle(input),
        usedProvider: "google",
        usedModel: input.model
      };
    }

    providerCircuit.recordSuccess(input.provider);
    return result;
  } catch (error) {
    providerCircuit.recordFailure(input.provider);

    if (!allowMock || hasImageAttachments) {
      const detail = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(
        `Provider request failed (${input.provider}/${input.model}). ${detail}. Verify key/model/provider configuration and retry.`
      );
      // Preserve HTTP status for downstream classifyPipelineError()
      const status = (error as { status?: number }).status;
      if (status) {
        (wrapped as Error & { status: number }).status = status;
      }
      throw wrapped;
    }
    return {
      content: mockResponse(input),
      usedProvider: "mock",
      usedModel: "mock"
    };
  }
}
