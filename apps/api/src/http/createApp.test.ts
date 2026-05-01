import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameWithVersions, ProjectBundle } from "@designer/shared";
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
  designSystem: null,
  assets: []
};

function frameWithVersions(input: Partial<FrameWithVersions> = {}): FrameWithVersions {
  const createdAt = new Date().toISOString();
  return {
    id: "frame-1",
    projectId: "project-1",
    name: "Deck Frame",
    devicePreset: "desktop",
    mode: "high-fidelity",
    selected: true,
    position: { x: 0, y: 0 },
    size: { width: 1360, height: 980 },
    currentVersionId: "version-1",
    status: "ready",
    frameKind: "deck",
    createdAt,
    updatedAt: createdAt,
    versions: [
      {
        id: "version-1",
        frameId: "frame-1",
        sourceCode: "",
        cssCode: "",
        exportHtml: "",
        tailwindEnabled: false,
        passOutputs: {
          deckSpec: {
            specVersion: 1,
            title: "Deck Frame",
            theme: {
              background: "#f8fafc",
              surface: "#ffffff",
              text: "#0f172a",
              mutedText: "#64748b",
              primary: "#2563eb",
              secondary: "#64748b",
              accent: "#16a34a",
              headingFont: "Aptos Display",
              bodyFont: "Aptos"
            },
            slides: [
              {
                id: "slide-1",
                blockId: "slide-1",
                title: "Opening",
                body: ["Point one", "Point two"],
                layout: "title"
              }
            ]
          }
        },
        diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 },
        createdAt
      }
    ],
    ...input
  };
}

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

  it("creates, lists, and deletes project assets", async () => {
    const createdAt = new Date().toISOString();
    const asset = {
      id: "asset-1",
      projectId: "project-1",
      kind: "document" as const,
      name: "brief.md",
      mimeType: "text/markdown",
      size: 12,
      dataUrl: null,
      textContent: "Deck brief",
      createdAt,
      updatedAt: createdAt
    };
    const getProjectAssets = vi.fn(async () => [asset]);
    const createProjectAsset = vi.fn(async () => asset);
    const deleteProjectAsset = vi.fn(async () => true);
    const api = await startApiForTest({ getProjectAssets, createProjectAsset, deleteProjectAsset });
    teardown.push(api.close);

    const listResponse = await fetch(`${api.apiBase}/projects/project-1/assets`);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()) as { assets: unknown[] }).toEqual({ assets: [asset] });

    const createResponse = await fetch(`${api.apiBase}/projects/project-1/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "document",
        name: "brief.md",
        mimeType: "text/markdown",
        textContent: "Deck brief"
      })
    });
    expect(createResponse.status).toBe(201);
    expect(createProjectAsset).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      kind: "document",
      name: "brief.md",
      mimeType: "text/markdown"
    }));

    const deleteResponse = await fetch(`${api.apiBase}/projects/project-1/assets/asset-1`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    expect(deleteProjectAsset).toHaveBeenCalledWith("project-1", "asset-1");
  });

  it("rejects PPTX export for non-deck frames", async () => {
    const api = await startApiForTest({
      getFrameWithVersions: async () => frameWithVersions({ frameKind: "design" })
    });
    teardown.push(api.close);

    const response = await fetch(`${api.apiBase}/frames/frame-1/deck.pptx`);
    const body = (await response.json()) as { error: string; code?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("not a deck");
    expect(body.code).toBe("validation_error");
  });

  it("exports PPTX for deck frames with a deck spec", async () => {
    const api = await startApiForTest({
      getFrameWithVersions: async () => frameWithVersions()
    });
    teardown.push(api.close);

    const response = await fetch(`${api.apiBase}/frames/frame-1/deck.pptx`);
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("presentationml.presentation");
    expect(body.subarray(0, 2).toString("utf8")).toBe("PK");
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
