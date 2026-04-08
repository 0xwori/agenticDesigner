import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCompletion } from "./llmProviders.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("llmProviders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to a supported OpenAI model when requested model is unavailable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: {
            message: "The model `gpt-5.3-codex` does not exist",
            code: "model_not_found",
            type: "invalid_request_error"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          choices: [
            {
              message: {
                content: "fallback-success"
              }
            }
          ]
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await requestCompletion({
      provider: "openai",
      model: "gpt-5.3-codex",
      apiKey: "test-key",
      system: "System prompt",
      prompt: "User prompt",
      allowMock: false
    });

    expect(result.usedProvider).toBe("openai");
    expect(result.usedModel).toBe("gpt-5.4-mini");
    expect(result.fallbackModelFrom).toBe("gpt-5.3-codex");
    expect(result.content).toBe("fallback-success");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string };
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { model: string };
    expect(firstPayload.model).toBe("gpt-5.3-codex");
    expect(secondPayload.model).toBe("gpt-5.4-mini");
  });

  it("does not silently fallback on non-model OpenAI errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(401, {
        error: {
          message: "Incorrect API key provided",
          code: "invalid_api_key",
          type: "invalid_request_error"
        }
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestCompletion({
        provider: "openai",
        model: "gpt-5.4-mini",
        apiKey: "bad-key",
        system: "System prompt",
        prompt: "User prompt",
        allowMock: false
      })
    ).rejects.toThrow(/Provider request failed \(openai\/gpt-5\.4-mini\)/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back when OpenAI model is not chat-completions compatible", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: {
            message:
              "This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?",
            code: "invalid_request_error",
            type: "invalid_request_error"
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          choices: [
            {
              message: {
                content: "fallback-chat-compatible-success"
              }
            }
          ]
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await requestCompletion({
      provider: "openai",
      model: "gpt-5.3-codex",
      apiKey: "test-key",
      system: "System prompt",
      prompt: "User prompt",
      allowMock: false
    });

    expect(result.usedProvider).toBe("openai");
    expect(result.usedModel).toBe("gpt-5.4-mini");
    expect(result.fallbackModelFrom).toBe("gpt-5.3-codex");
    expect(result.content).toBe("fallback-chat-compatible-success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
