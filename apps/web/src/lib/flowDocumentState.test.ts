import { describe, expect, it } from "vitest";
import { createEmptyFlowDocument, type ProjectBundle } from "@designer/shared";

import { replaceFlowDocumentInBundle, rollbackFlowDocumentIfCurrent } from "./flowDocumentState";

function createBundle(flowDocument = createEmptyFlowDocument()): ProjectBundle {
  return {
    project: {
      id: "project-1",
      name: "Test Project",
      token: "token-1",
      settings: {
        provider: "openai",
        model: "gpt-5.4-mini",
        tailwindDefault: false,
        modeDefault: "high-fidelity",
        deviceDefault: "desktop",
        designSystemModeDefault: "strict",
        surfaceDefault: "web",
      },
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
    },
    references: [],
    designSystem: null,
    frames: [
      {
        id: "flow-1",
        projectId: "project-1",
        name: "Flow Board",
        devicePreset: "desktop",
        mode: "high-fidelity",
        selected: true,
        position: { x: 0, y: 0 },
        size: { width: 1400, height: 800 },
        currentVersionId: null,
        status: "ready",
        frameKind: "flow",
        flowDocument,
        createdAt: "2026-04-11T10:00:00.000Z",
        updatedAt: "2026-04-11T10:00:00.000Z",
        versions: [],
      },
    ],
  };
}

describe("flowDocumentState", () => {
  it("replaces the flow document for the targeted frame", () => {
    const originalDoc = createEmptyFlowDocument();
    const nextDoc = {
      ...createEmptyFlowDocument(),
      connections: [
        {
          id: "edge-1",
          fromCellId: "a",
          toCellId: "b",
          sourceHandle: "right",
          targetHandle: "left-target",
        },
      ],
    };

    const bundle = createBundle(originalDoc);
    const nextBundle = replaceFlowDocumentInBundle(bundle, "flow-1", nextDoc);

    expect(nextBundle?.frames[0]?.flowDocument).toBe(nextDoc);
    expect(bundle.frames[0]?.flowDocument).toBe(originalDoc);
  });

  it("rolls back only when the optimistic document is still current", () => {
    const previousDoc = createEmptyFlowDocument();
    const optimisticDoc = {
      ...createEmptyFlowDocument(),
      connections: [
        {
          id: "edge-1",
          fromCellId: "a",
          toCellId: "b",
          sourceHandle: "right",
          targetHandle: "left-target",
        },
      ],
    };

    const optimisticBundle = createBundle(optimisticDoc);
    const rolledBack = rollbackFlowDocumentIfCurrent(optimisticBundle, "flow-1", optimisticDoc, previousDoc);

    expect(rolledBack?.frames[0]?.flowDocument).toBe(previousDoc);
  });

  it("keeps a newer local document when an older save fails", () => {
    const failedDoc = {
      ...createEmptyFlowDocument(),
      connections: [
        {
          id: "edge-1",
          fromCellId: "a",
          toCellId: "b",
          sourceHandle: "right",
          targetHandle: "left-target",
        },
      ],
    };
    const newerDoc = {
      ...failedDoc,
      connections: [
        ...failedDoc.connections,
        {
          id: "edge-2",
          fromCellId: "b",
          toCellId: "c",
          sourceHandle: "right",
          targetHandle: "left-target",
        },
      ],
    };

    const bundle = createBundle(newerDoc);
    const rolledBack = rollbackFlowDocumentIfCurrent(bundle, "flow-1", failedDoc, createEmptyFlowDocument());

    expect(rolledBack).toBe(bundle);
    expect(rolledBack?.frames[0]?.flowDocument).toBe(newerDoc);
  });
});