import { describe, expect, it } from "vitest";
import { FLOW_DEFAULT_AREA_ID, createEmptyFlowDocument } from "@designer/shared";

import {
  ensureCanonicalFlowDocument,
  resolveActiveFlowFrame,
  resolveCanonicalFlowFrame,
  resolveFlowModeTarget,
  shouldUseFlowActionRoute,
} from "./flowMode";

describe("flowMode helpers", () => {
  const flowFrames = [
    {
      id: "flow-a",
      name: "Primary",
      selected: false,
      frameKind: "flow" as const,
      updatedAt: "2026-04-08T09:00:00.000Z",
      flowDocument: createEmptyFlowDocument(),
    },
    {
      id: "flow-b",
      name: "Secondary",
      selected: true,
      frameKind: "flow" as const,
      updatedAt: "2026-04-09T09:00:00.000Z",
      flowDocument: createEmptyFlowDocument(),
    },
  ];

  it("signals flow-board creation when none exist", () => {
    expect(resolveFlowModeTarget([], null)).toEqual({
      selectedFlowFrameId: null,
      shouldCreateFlowBoard: true,
    });
  });

  it("prefers the selected flow frame when choosing the default active board", () => {
    expect(resolveCanonicalFlowFrame(flowFrames)?.id).toBe("flow-b");
    expect(resolveFlowModeTarget(flowFrames, null)).toEqual({
      selectedFlowFrameId: "flow-b",
      shouldCreateFlowBoard: false,
    });
  });

  it("reopens the last flow board when one was already active", () => {
    expect(resolveFlowModeTarget(flowFrames, "flow-a")).toEqual({
      selectedFlowFrameId: "flow-a",
      shouldCreateFlowBoard: false,
    });

    expect(resolveActiveFlowFrame(flowFrames, null, "flow-a")?.id).toBe("flow-a");
  });

  it("prefers the explicitly selected flow frame over the last opened board", () => {
    expect(resolveActiveFlowFrame(flowFrames, "flow-b", "flow-a")?.id).toBe("flow-b");
  });

  it("falls back to the most recently updated flow frame when none is selected", () => {
    const unselectedFrames = flowFrames.map((frame) => ({ ...frame, selected: false }));
    expect(resolveCanonicalFlowFrame(unselectedFrames)?.id).toBe("flow-b");
    expect(resolveActiveFlowFrame(unselectedFrames, null, null)?.id).toBe("flow-b");
  });

  it("does not merge sibling flow boards into the active document", () => {
    const primaryFrame = {
      id: "flow-a",
      name: "Primary",
      selected: true,
      frameKind: "flow" as const,
      updatedAt: "2026-04-10T09:00:00.000Z",
      flowDocument: {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "primary-step",
            areaId: FLOW_DEFAULT_AREA_ID,
            laneId: "user-journey" as const,
            column: 0,
            artifact: { type: "journey-step" as const, text: "Primary" },
          },
        ],
      },
    };
    const siblingFrame = {
      id: "flow-b",
      name: "Checkout",
      selected: false,
      frameKind: "flow" as const,
      updatedAt: "2026-04-09T09:00:00.000Z",
      flowDocument: {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "checkout-step",
            areaId: FLOW_DEFAULT_AREA_ID,
            laneId: "normal-flow" as const,
            column: 0,
            artifact: { type: "journey-step" as const, text: "Checkout" },
          },
        ],
      },
    };

    const ensured = ensureCanonicalFlowDocument(primaryFrame, [primaryFrame, siblingFrame]);

    expect(ensured.changed).toBe(false);
    expect(ensured.importedFrameIds).toEqual([]);
    expect(ensured.flowDocument.cells).toHaveLength(1);
    expect(ensured.flowDocument.cells[0]?.id).toBe("primary-step");
  });

  it("normalizes a single legacy flow document into the default area", () => {
    const legacyFrame = {
      id: "flow-legacy",
      name: "Legacy",
      selected: true,
      frameKind: "flow" as const,
      updatedAt: "2026-04-10T09:00:00.000Z",
      flowDocument: {
        lanes: [...createEmptyFlowDocument().lanes],
        cells: [
          {
            id: "legacy-cell",
            laneId: "user-journey" as const,
            column: 0,
            artifact: { type: "journey-step" as const, text: "Legacy" },
          },
        ],
        connections: [],
      },
    };

    const result = ensureCanonicalFlowDocument(legacyFrame, [legacyFrame]);

    expect(result.changed).toBe(true);
    expect(result.importedFrameIds).toEqual([]);
    expect(result.flowDocument.cells[0]?.areaId).toBe(FLOW_DEFAULT_AREA_ID);
    expect(result.flowDocument.areas).toHaveLength(1);
  });

  it("routes prompts to flow-action only in flow mode with a flow target", () => {
    expect(
      shouldUseFlowActionRoute({
        canvasMode: "flow",
        flowFrameId: "flow-a",
        prompt: "Create a yes/no startup flow.",
        figmaUrl: null,
      }),
    ).toBe(true);

    expect(
      shouldUseFlowActionRoute({
        canvasMode: "design",
        flowFrameId: "flow-a",
        prompt: "Create a yes/no startup flow.",
        figmaUrl: null,
      }),
    ).toBe(false);

    expect(
      shouldUseFlowActionRoute({
        canvasMode: "flow",
        flowFrameId: "flow-a",
        prompt: "Create a yes/no startup flow.",
        figmaUrl: "https://figma.com/file/abc",
      }),
    ).toBe(false);
  });
});
