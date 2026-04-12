import { describe, expect, it } from "vitest";

import type { FrameWithVersions } from "@designer/shared";

import { buildFlowDesignFrameContexts } from "./flowFrameContext.js";

function createFrame(input: Partial<FrameWithVersions>): FrameWithVersions {
  return {
    id: input.id ?? "frame-1",
    projectId: input.projectId ?? "project-1",
    name: input.name ?? "Checkout screen",
    devicePreset: input.devicePreset ?? "desktop",
    mode: input.mode ?? "high-fidelity",
    selected: input.selected ?? false,
    position: input.position ?? { x: 0, y: 0 },
    size: input.size ?? { width: 1240, height: 880 },
    currentVersionId: input.currentVersionId ?? "version-1",
    status: input.status ?? "ready",
    frameKind: input.frameKind ?? "design",
    flowDocument: input.flowDocument,
    createdAt: input.createdAt ?? "2026-04-12T10:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-12T10:00:00.000Z",
    versions: input.versions ?? [],
  };
}

describe("buildFlowDesignFrameContexts", () => {
  it("extracts visible screen copy from the current frame version", () => {
    const frames = [
      createFrame({
        versions: [
          {
            id: "version-1",
            frameId: "frame-1",
            sourceCode: "export function Checkout(){ return null; }",
            cssCode: ".checkout {}",
            exportHtml:
              '<main><h1>Checkout</h1><label>Email address</label><input placeholder="name@example.com" /><button>Pay now</button></main>',
            tailwindEnabled: false,
            passOutputs: {},
            diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 },
            createdAt: "2026-04-12T10:00:00.000Z",
          },
        ],
      }),
    ];

    const contexts = buildFlowDesignFrameContexts(frames);
    expect(contexts[0]).toMatchObject({
      id: "frame-1",
      name: "Checkout screen",
    });
    expect(contexts[0]?.summary).toContain("Checkout");
    expect(contexts[0]?.summary).toContain("Email address");
    expect(contexts[0]?.summary).toContain("Pay now");
  });

  it("falls back to source strings when export html is empty", () => {
    const frames = [
      createFrame({
        versions: [
          {
            id: "version-1",
            frameId: "frame-1",
            sourceCode: 'const title = "Account settings"; const cta = "Save changes";',
            cssCode: "",
            exportHtml: "",
            tailwindEnabled: false,
            passOutputs: {},
            diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 },
            createdAt: "2026-04-12T10:00:00.000Z",
          },
        ],
      }),
    ];

    const contexts = buildFlowDesignFrameContexts(frames);
    expect(contexts[0]?.summary).toContain("Account settings");
    expect(contexts[0]?.summary).toContain("Save changes");
  });
});