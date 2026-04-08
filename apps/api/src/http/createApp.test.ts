import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@designer/shared";
import { createApp } from "./createApp.js";
import { RunHub } from "../services/runHub.js";
import type { ApiDeps } from "./deps.js";

const runHub = new RunHub(async () => []);

const projectBundle: ProjectBundle = {
  project: {
    id: "project-1",
    name: "Project 1",
    token: "token",
    settings: {
      provider: "openai",
      model: "gpt-5.4-mini",
      tailwindDefault: false,
      modeDefault: "high-fidelity",
      deviceDefault: "desktop",
      designSystemModeDefault: "strict",
      surfaceDefault: "web"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  references: [],
  frames: [],
  designSystem: null
};

async function startApiForTest(deps?: Partial<ApiDeps>) {
  const app = createApp({
    runHub,
    deps: {
      getProjectBundle: async () => projectBundle,
      ...(deps ?? {})
    }
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const apiBase = `http://127.0.0.1:${address.port}`;

  return {
    apiBase,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

describe("createApp", () => {
  const teardown: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (teardown.length > 0) {
      const close = teardown.pop();
      if (close) {
        await close();
      }
    }
  });

  it("returns typed validation error envelope for invalid generate payload", async () => {
    const api = await startApiForTest();
    teardown.push(api.close);

    const response = await fetch(`${api.apiBase}/projects/project-1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: "   " })
    });

    const body = (await response.json()) as {
      error: string;
      code?: string;
      details?: unknown;
    };

    expect(response.status).toBe(400);
    expect(body.error).toContain("prompt is required");
    expect(body.code).toBe("validation_error");
    expect(body.details).toBeUndefined();
  });

  it("returns not_found envelope for unknown routes", async () => {
    const api = await startApiForTest();
    teardown.push(api.close);

    const response = await fetch(`${api.apiBase}/not-a-route`);
    const body = (await response.json()) as { error: string; code?: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not found.");
    expect(body.code).toBe("not_found");
  });

  it("validates design-system regenerate-from-reference payload", async () => {
    const api = await startApiForTest();
    teardown.push(api.close);

    const response = await fetch(`${api.apiBase}/projects/project-1/design-system/regenerate-from-reference`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    const body = (await response.json()) as {
      error: string;
      code?: string;
    };

    expect(response.status).toBe(400);
    expect(body.error).toContain("sourceType");
    expect(body.code).toBe("bad_request");
  });

  it("runs full-reset route and returns a clear error when no references can regenerate", async () => {
    const clearProjectDesignSystem = vi.fn(async () => undefined);
    const resetReferenceDesignSystemMetadata = vi.fn(async () => undefined);
    const getProjectBundle = vi.fn(async () => projectBundle);

    const api = await startApiForTest({
      getProjectBundle,
      clearProjectDesignSystem,
      resetReferenceDesignSystemMetadata
    });
    teardown.push(api.close);

    const response = await fetch(`${api.apiBase}/projects/project-1/design-system/reset-regenerate`, {
      method: "POST"
    });
    const body = (await response.json()) as { error: string; code?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("No usable references found for regeneration");
    expect(body.code).toBe("bad_request");
    expect(clearProjectDesignSystem).toHaveBeenCalledWith("project-1");
    expect(resetReferenceDesignSystemMetadata).toHaveBeenCalledWith("project-1");
    expect(getProjectBundle).toHaveBeenCalledTimes(2);
  });
});
