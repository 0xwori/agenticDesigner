import { describe, expect, it, vi } from "vitest";
import { FLOW_DEFAULT_AREA_ID, createEmptyFlowDocument, type ComposerAttachment } from "@designer/shared";

import { requestCompletion } from "../llmProviders.js";
import {
  runFlowAction,
  normalizeFlowActionCommands,
  type FlowActionCommand,
} from "./flowAction.js";

vi.mock("../llmProviders.js", () => ({
  requestCompletion: vi.fn(),
}));

describe("normalizeFlowActionCommands", () => {
  it("resolves attachment image commands into add-cell mutations", () => {
    const attachments = [
      {
        id: "att-1",
        type: "image",
        name: "Login screen",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc",
        width: 1200,
        height: 900,
      } as ComposerAttachment & { width: number; height: number },
    ];

    const commands: FlowActionCommand[] = [
      {
        op: "add-attachment-image",
        attachmentId: "att-1",
        laneId: "user-journey",
        column: 1,
        cellId: "login-image",
      },
      {
        op: "add-connection",
        fromCellId: "login-image",
        toCellId: "existing-step",
      },
    ];

    const normalized = normalizeFlowActionCommands({
      doc: {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "existing-step",
            laneId: "user-journey",
            column: 0,
            artifact: { type: "journey-step", text: "Start" },
          },
        ],
      },
      commands,
      attachments,
    });

    expect(normalized).toEqual([
      {
        op: "add-cell",
        cellId: "login-image",
        laneId: "user-journey",
        areaId: FLOW_DEFAULT_AREA_ID,
        column: 1,
        artifact: {
          type: "uploaded-image",
          dataUrl: "data:image/png;base64,abc",
          label: "Login screen",
          width: 1200,
          height: 900,
        },
      },
      {
        op: "add-connection",
        fromCellId: "login-image",
        toCellId: "existing-step",
      },
    ]);
  });

  it("remaps conflicting requested cell ids consistently", () => {
    const commands: FlowActionCommand[] = [
      {
        op: "add-cell",
        cellId: "duplicate",
        laneId: "normal-flow",
        artifact: { type: "journey-step", text: "New step" },
      },
      {
        op: "add-connection",
        fromCellId: "duplicate",
        toCellId: "existing",
      },
    ];

    const normalized = normalizeFlowActionCommands({
      doc: {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "duplicate",
            laneId: "normal-flow",
            column: 0,
            artifact: { type: "journey-step", text: "Existing" },
          },
          {
            id: "existing",
            laneId: "normal-flow",
            column: 1,
            artifact: { type: "journey-step", text: "Target" },
          },
        ],
      },
      commands,
    });

    const addCell = normalized[0];
    const addConnection = normalized[1];

    expect(addCell.op).toBe("add-cell");
    if (addCell.op !== "add-cell") {
      throw new Error("Expected add-cell mutation");
    }
    expect(addCell.cellId).toBeDefined();
    expect(addCell.cellId).not.toBe("duplicate");
    expect(addCell.areaId).toBe(FLOW_DEFAULT_AREA_ID);
    expect(addConnection).toEqual({
      op: "add-connection",
      fromCellId: addCell.cellId,
      toCellId: "existing",
    });
  });

  it("passes through intrinsic image dimensions when normalizing attachments", () => {
    const attachments = [
      {
        id: "att-2",
        type: "image",
        name: "Signup screen",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,def",
        width: 640,
        height: 480,
      },
    ] as Array<ComposerAttachment & { width: number; height: number }>;

    const normalized = normalizeFlowActionCommands({
      doc: createEmptyFlowDocument(),
      commands: [
        {
          op: "add-attachment-image",
          attachmentId: "att-2",
          laneId: "normal-flow",
          cellId: "signup-image",
        },
      ],
      attachments,
    });

    expect(normalized).toEqual([
      {
        op: "add-cell",
        cellId: "signup-image",
        laneId: "normal-flow",
        areaId: FLOW_DEFAULT_AREA_ID,
        artifact: {
          type: "uploaded-image",
          dataUrl: "data:image/png;base64,def",
          label: "Signup screen",
          width: 640,
          height: 480,
        },
      },
    ]);
  });

  it("defaults new cells to the focused area when no areaId is provided", () => {
    const normalized = normalizeFlowActionCommands({
      doc: {
        ...createEmptyFlowDocument(),
        areas: [
          { id: FLOW_DEFAULT_AREA_ID, name: "Area 1", columnOffset: 0 },
          { id: "area-2", name: "Checkout", columnOffset: 7 },
        ],
      },
      focusedAreaId: "area-2",
      commands: [
        {
          op: "add-cell",
          cellId: "checkout-step",
          laneId: "normal-flow",
          artifact: { type: "journey-step", text: "Checkout" },
        },
      ],
    });

    expect(normalized).toEqual([
      {
        op: "add-cell",
        cellId: "checkout-step",
        laneId: "normal-flow",
        areaId: "area-2",
        artifact: { type: "journey-step", text: "Checkout" },
      },
    ]);
  });

  it("ignores new-area creation and falls back to the focused legacy area", () => {
    const normalized = normalizeFlowActionCommands({
      doc: {
        ...createEmptyFlowDocument(),
        areas: [
          { id: FLOW_DEFAULT_AREA_ID, name: "Area 1", columnOffset: 0 },
          { id: "area-2", name: "Existing", columnOffset: 7 },
        ],
      },
      commands: [
        {
          op: "create-area",
          areaId: "area-2",
          name: "Payments",
        },
        {
          op: "add-cell",
          areaId: "area-2",
          cellId: "payments-step",
          laneId: "normal-flow",
          artifact: { type: "journey-step", text: "Payments" },
        },
      ],
    });

    expect(normalized).toEqual([
      {
      op: "add-cell",
      areaId: FLOW_DEFAULT_AREA_ID,
      cellId: "payments-step",
      laneId: "normal-flow",
      artifact: { type: "journey-step", text: "Payments" },
      column: undefined,
      },
    ]);
  });
});

describe("runFlowAction", () => {
  it("guides binary decisions without reintroducing multi-area authoring", async () => {
    vi.mocked(requestCompletion).mockResolvedValue({ content: "[]" } as never);

    await runFlowAction({
      prompt: "Create a flow for a signup screen with a yes/no decision.",
      flowDocument: {
        ...createEmptyFlowDocument(),
        areas: [
          { id: FLOW_DEFAULT_AREA_ID, name: "Area 1", columnOffset: 0 },
          { id: "area-2", name: "Checkout", columnOffset: 7 },
        ],
      },
      designFrames: [],
      provider: "openai",
      model: "gpt-5.4-mini",
      focusedAreaId: "area-2",
    });

    expect(vi.mocked(requestCompletion)).toHaveBeenCalledTimes(1);
    const input = vi.mocked(requestCompletion).mock.calls[0][0];

    expect(input.system).toContain("exactly one diamond decision node");
    expect(input.system).toContain('outcomes labeled "yes" and "no"');
    expect(input.system).toContain('normalize the second branch to "no"');
    expect(input.system).toContain("Do not create new boards or new areas in this route.");
    expect(input.prompt).toContain('Focused area: "Checkout" (id: "area-2")');
  });
});
