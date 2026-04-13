import { describe, it, expect } from "vitest";
import {
  applyFlowMutations,
  createEmptyFlowBoardMemoryDocument,
  findNextFreeFlowColumn,
  describeFlowMutations,
  FLOW_AREA_COLUMN_GAP,
  FLOW_AREA_MIN_COLUMNS,
  FLOW_DEFAULT_AREA_ID,
  FLOW_DEFAULT_AREA_NAME,
  getDefaultFlowArea,
  getFlowAreaColumnSpan,
  getFlowCellAreaId,
  getFlowGlobalColumn,
  getNextFlowAreaColumnOffset,
  getFlowSourceHandleId,
  getFlowTargetHandleId,
  inferFlowConnectionHandles,
  isConnectionAllowed,
  isFlowConnectionAllowedBetweenCells,
  createEmptyFlowDocument,
  normalizeFlowBoardMemoryDocument,
  normalizeFlowDocument,
  normalizeFlowConnection,
  resolveFlowInsertColumn,
  summarizeFlowDocument,
  FLOW_LANE_ORDER,
  type FlowDocument,
  type FlowLaneId,
} from "../index";

describe("isConnectionAllowed", () => {
  const allLanes: FlowLaneId[] = [...FLOW_LANE_ORDER];

  it("allows user-journey to connect to the screen lanes", () => {
    expect(isConnectionAllowed("user-journey", "normal-flow")).toBe(true);
    expect(isConnectionAllowed("user-journey", "unhappy-path")).toBe(true);
  });

  it("blocks user-journey and technical-briefing in both directions", () => {
    expect(isConnectionAllowed("user-journey", "technical-briefing")).toBe(false);
    expect(isConnectionAllowed("technical-briefing", "user-journey")).toBe(false);
  });

  it("allows normal-flow ↔ unhappy-path", () => {
    expect(isConnectionAllowed("normal-flow", "unhappy-path")).toBe(true);
    expect(isConnectionAllowed("unhappy-path", "normal-flow")).toBe(true);
  });

  it("allows same-lane connections", () => {
    for (const lane of allLanes) {
      expect(isConnectionAllowed(lane, lane)).toBe(true);
    }
  });

  it("blocks normal-flow → technical-briefing", () => {
    expect(isConnectionAllowed("normal-flow", "technical-briefing")).toBe(false);
  });

  it("blocks unhappy-path → technical-briefing", () => {
    expect(isConnectionAllowed("unhappy-path", "technical-briefing")).toBe(false);
  });

  it("blocks technical-briefing → normal-flow", () => {
    expect(isConnectionAllowed("technical-briefing", "normal-flow")).toBe(false);
  });

  it("blocks technical-briefing → unhappy-path", () => {
    expect(isConnectionAllowed("technical-briefing", "unhappy-path")).toBe(false);
  });

  it("keeps technical-briefing isolated to its own lane", () => {
    expect(isConnectionAllowed("technical-briefing", "technical-briefing")).toBe(true);
  });

  it("allows screen refs to connect into technical-briefing through the cell-aware helper", () => {
    const doc = createEmptyFlowDocument();
    const fromCell = {
      id: "screen-ref",
      areaId: FLOW_DEFAULT_AREA_ID,
      laneId: "normal-flow" as const,
      artifact: { type: "design-frame-ref" as const, frameId: "frame-1" },
    };
    const toCell = {
      id: "technical-step",
      areaId: FLOW_DEFAULT_AREA_ID,
      laneId: "technical-briefing" as const,
      artifact: {
        type: "technical-brief" as const,
        title: "Payload",
        language: "json",
        body: "{}",
      },
    };

    expect(isFlowConnectionAllowedBetweenCells(doc, fromCell, toCell)).toBe(true);
  });

  it("keeps non-screen artifacts blocked from technical-briefing in the cell-aware helper", () => {
    const doc = createEmptyFlowDocument();
    const fromCell = {
      id: "journey-step",
      areaId: FLOW_DEFAULT_AREA_ID,
      laneId: "normal-flow" as const,
      artifact: { type: "journey-step" as const, text: "Start" },
    };
    const toCell = {
      id: "technical-step",
      areaId: FLOW_DEFAULT_AREA_ID,
      laneId: "technical-briefing" as const,
      artifact: {
        type: "technical-brief" as const,
        title: "Payload",
        language: "json",
        body: "{}",
      },
    };

    expect(isFlowConnectionAllowedBetweenCells(doc, fromCell, toCell)).toBe(false);
  });
});

describe("createEmptyFlowDocument", () => {
  it("creates a document with all lanes and empty cells/connections", () => {
    const doc = createEmptyFlowDocument();
    expect(doc.lanes).toEqual(FLOW_LANE_ORDER);
    expect(doc.areas).toEqual([
      {
        id: FLOW_DEFAULT_AREA_ID,
        name: FLOW_DEFAULT_AREA_NAME,
        columnOffset: 0,
      },
    ]);
    expect(doc.importedSourceFrameIds).toEqual([]);
    expect(doc.cells).toEqual([]);
    expect(doc.connections).toEqual([]);
    expect(doc.entryFlowFrameId).toBeUndefined();
    expect(doc.exitFlowFrameId).toBeUndefined();
  });
});

describe("flow board memory", () => {
  it("creates an empty board memory document", () => {
    expect(createEmptyFlowBoardMemoryDocument()).toEqual({
      version: 1,
      goals: [],
      assumptions: [],
      entities: [],
      screens: [],
      journey: [],
      technicalNotes: [],
      openQuestions: [],
      artifactMappings: [],
    });
  });

  it("normalizes persisted board memory when flow documents load", () => {
    const doc = normalizeFlowDocument({
      ...createEmptyFlowDocument(),
      boardMemory: {
        authoredText: "version: 1",
        updatedAt: "not-a-date",
        snapshot: {
          version: 1,
          goals: ["  Improve checkout clarity  "],
          assumptions: [" Customer is authenticated "],
          entities: [{ name: " Shopper " }],
          screens: [{ title: " Browse ", notes: ["  Show search  "] }],
          journey: [{ title: " Browse products ", kind: "decision", laneId: "normal-flow" }],
          technicalNotes: [{ title: " Checkout API ", body: " POST /checkout ", tags: [" api "] }],
          openQuestions: [" What happens when payment fails? "],
          artifactMappings: [{ memoryId: "journey-1", cellId: "cell-1" }],
        },
      },
    });

    expect(doc.boardMemory?.updatedAt).toBe(new Date(0).toISOString());
    expect(doc.boardMemory?.snapshot).toEqual(
      normalizeFlowBoardMemoryDocument({
        version: 1,
        goals: ["Improve checkout clarity"],
        assumptions: ["Customer is authenticated"],
        entities: [{ id: "entity-1", name: "Shopper" }],
        screens: [{ id: "screen-1", title: "Browse", notes: ["Show search"] }],
        journey: [{ id: "journey-1", title: "Browse products", kind: "decision", laneId: "normal-flow" }],
        technicalNotes: [{ id: "technical-note-1", title: "Checkout API", body: "POST /checkout", tags: ["api"] }],
        openQuestions: ["What happens when payment fails?"],
        artifactMappings: [{ memoryId: "journey-1", cellId: "cell-1" }],
      }),
    );
  });
});

describe("flow area helpers", () => {
  it("normalizes legacy documents into the default area", () => {
    const doc = normalizeFlowDocument({
      lanes: [...FLOW_LANE_ORDER],
      cells: [
        {
          id: "legacy-cell",
          laneId: "normal-flow",
          column: 2,
          artifact: { type: "journey-step", text: "Legacy" },
        },
      ],
      connections: [],
    });

    expect(getDefaultFlowArea(doc)).toEqual({
      id: FLOW_DEFAULT_AREA_ID,
      name: FLOW_DEFAULT_AREA_NAME,
      columnOffset: 0,
    });
    expect(doc.importedSourceFrameIds).toEqual([]);
    expect(doc.cells[0]?.areaId).toBe(FLOW_DEFAULT_AREA_ID);
  });

  it("normalizes persisted screen preview settings", () => {
    const doc = normalizeFlowDocument({
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "screen-1",
          laneId: "normal-flow",
          column: 0,
          artifact: {
            type: "design-frame-ref",
            frameId: "frame-1",
            previewMode: "manual",
            previewHeight: 72,
          },
        },
      ],
      connections: [],
    });

    expect(doc.cells[0]?.artifact).toEqual({
      type: "design-frame-ref",
      frameId: "frame-1",
      previewMode: "manual",
      previewHeight: 120,
    });
  });

  it("computes global columns and next offsets from area spans", () => {
    const doc = normalizeFlowDocument({
      ...createEmptyFlowDocument(),
      areas: [
        { id: FLOW_DEFAULT_AREA_ID, name: FLOW_DEFAULT_AREA_NAME, columnOffset: 0 },
        { id: "area-2", name: "Area 2", columnOffset: 10 },
      ],
      cells: [
        {
          id: "default-cell",
          areaId: FLOW_DEFAULT_AREA_ID,
          laneId: "normal-flow",
          column: 1,
          artifact: { type: "journey-step", text: "Default" },
        },
        {
          id: "secondary-cell",
          areaId: "area-2",
          laneId: "normal-flow",
          column: 2,
          artifact: { type: "journey-step", text: "Secondary" },
        },
      ],
      connections: [],
    });

    expect(getFlowAreaColumnSpan(doc, FLOW_DEFAULT_AREA_ID)).toEqual({
      startColumn: 0,
      endColumn: FLOW_AREA_MIN_COLUMNS - 1,
    });
    expect(getFlowAreaColumnSpan(doc, "area-2")).toEqual({
      startColumn: 10,
      endColumn: 13,
    });
    expect(getFlowGlobalColumn(doc, doc.cells[1]!)).toBe(12);
    expect(getNextFlowAreaColumnOffset(doc)).toBe(13 + FLOW_AREA_COLUMN_GAP + 1);
  });
});

describe("summarizeFlowDocument", () => {
  it("returns zero counts for empty document", () => {
    const doc = createEmptyFlowDocument();
    const summary = summarizeFlowDocument(doc);
    expect(summary.cellCount).toBe(0);
    expect(summary.connectionCount).toBe(0);
    for (const lane of FLOW_LANE_ORDER) {
      expect(summary.laneArtifactCounts[lane]).toBe(0);
    }
  });

  it("counts cells and connections correctly", () => {
    const doc: FlowDocument = {
      ...createEmptyFlowDocument(),
      cells: [
        { id: "c1", laneId: "normal-flow", column: 0, artifact: { type: "design-frame-ref", frameId: "f1" } },
        { id: "c2", laneId: "normal-flow", column: 1, artifact: { type: "design-frame-ref", frameId: "f2" } },
        { id: "c3", laneId: "user-journey", column: 0, artifact: { type: "journey-step", text: "login" } },
      ],
      connections: [
        { id: "conn1", fromCellId: "c1", toCellId: "c2" },
      ],
    };
    const summary = summarizeFlowDocument(doc);
    expect(summary.cellCount).toBe(3);
    expect(summary.connectionCount).toBe(1);
    expect(summary.laneArtifactCounts["normal-flow"]).toBe(2);
    expect(summary.laneArtifactCounts["user-journey"]).toBe(1);
    expect(summary.laneArtifactCounts["unhappy-path"]).toBe(0);
    expect(summary.laneArtifactCounts["technical-briefing"]).toBe(0);
  });
});

describe("flow connection handles", () => {
  const doc: FlowDocument = {
    ...createEmptyFlowDocument(),
    cells: [
      { id: "left", laneId: "normal-flow", column: 0, artifact: { type: "journey-step", text: "left" } },
      { id: "right", laneId: "normal-flow", column: 1, artifact: { type: "journey-step", text: "right" } },
      { id: "lower", laneId: "unhappy-path", column: 1, artifact: { type: "journey-step", text: "lower" } },
    ],
  };

  it("infers horizontal handles for legacy same-lane connections", () => {
    expect(
      inferFlowConnectionHandles(doc, {
        fromCellId: "left",
        toCellId: "right",
      }),
    ).toEqual({
      sourceHandle: getFlowSourceHandleId("right"),
      targetHandle: getFlowTargetHandleId("left"),
    });
  });

  it("infers vertical handles for legacy cross-lane connections", () => {
    expect(
      inferFlowConnectionHandles(doc, {
        fromCellId: "right",
        toCellId: "lower",
      }),
    ).toEqual({
      sourceHandle: getFlowSourceHandleId("bottom"),
      targetHandle: getFlowTargetHandleId("top"),
    });
  });

  it("preserves explicit handles during normalization", () => {
    expect(
      normalizeFlowConnection(doc, {
        id: "edge-1",
        fromCellId: "left",
        toCellId: "right",
        sourceHandle: "top",
        targetHandle: "bottom-target",
      }),
    ).toEqual({
      id: "edge-1",
      fromCellId: "left",
      toCellId: "right",
      sourceHandle: "top",
      targetHandle: "bottom-target",
    });
  });
});

describe("flow placement helpers", () => {
  const doc: FlowDocument = {
    ...createEmptyFlowDocument(),
    areas: [
      { id: FLOW_DEFAULT_AREA_ID, name: FLOW_DEFAULT_AREA_NAME, columnOffset: 0 },
      { id: "area-2", name: "Area 2", columnOffset: 10 },
    ],
    cells: [
      {
        id: "c1",
        areaId: FLOW_DEFAULT_AREA_ID,
        laneId: "normal-flow",
        column: 0,
        artifact: { type: "journey-step", text: "A" },
      },
      {
        id: "c2",
        areaId: FLOW_DEFAULT_AREA_ID,
        laneId: "normal-flow",
        column: 2,
        artifact: { type: "journey-step", text: "B" },
      },
    ],
  };

  it("finds the next free column from a preferred slot", () => {
    expect(findNextFreeFlowColumn(doc, "normal-flow", 0)).toBe(1);
    expect(findNextFreeFlowColumn(doc, "normal-flow", 2)).toBe(3);
  });

  it("resolves insert columns without colliding", () => {
    expect(resolveFlowInsertColumn(doc, "normal-flow", 0)).toBe(1);
    expect(resolveFlowInsertColumn(doc, "normal-flow", 4)).toBe(4);
  });

  it("keeps local columns independent across areas", () => {
    expect(findNextFreeFlowColumn(doc, "normal-flow", 0, undefined, "area-2")).toBe(0);
    expect(resolveFlowInsertColumn(doc, "normal-flow", 0, undefined, "area-2")).toBe(0);
  });
});

describe("applyFlowMutations", () => {
  it("deduplicates only exact directional matches", () => {
    const doc = createEmptyFlowDocument();
    const seeded = applyFlowMutations(doc, [
      {
        op: "add-cell",
        cellId: "a",
        laneId: "normal-flow",
        column: 0,
        artifact: { type: "journey-step", text: "A" },
      },
      {
        op: "add-cell",
        cellId: "b",
        laneId: "normal-flow",
        column: 1,
        artifact: { type: "journey-step", text: "B" },
      },
    ]);

    const once = applyFlowMutations(seeded, [
      { op: "add-connection", fromCellId: "a", toCellId: "b", sourceHandle: "right", targetHandle: "left-target" },
      { op: "add-connection", fromCellId: "a", toCellId: "b", sourceHandle: "right", targetHandle: "left-target" },
      { op: "add-connection", fromCellId: "b", toCellId: "a", sourceHandle: "left", targetHandle: "right-target" },
    ]);

    expect(once.connections).toHaveLength(2);
    expect(once.connections[0]).toMatchObject({
      fromCellId: "a",
      toCellId: "b",
      sourceHandle: "right",
      targetHandle: "left-target",
    });
    expect(once.connections[1]).toMatchObject({
      fromCellId: "b",
      toCellId: "a",
      sourceHandle: "left",
      targetHandle: "right-target",
    });
  });

  it("uses explicit cell ids and resolves occupied insert columns", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      {
        op: "add-cell",
        cellId: "first",
        laneId: "user-journey",
        column: 0,
        artifact: { type: "journey-step", text: "Start" },
      },
      {
        op: "add-cell",
        cellId: "second",
        laneId: "user-journey",
        column: 0,
        artifact: { type: "uploaded-image", dataUrl: "data:image/png;base64,abc", label: "Login" },
      },
    ]);

    expect(doc.cells.map((cell) => ({ id: cell.id, column: cell.column }))).toEqual([
      { id: "first", column: 0 },
      { id: "second", column: 1 },
    ]);
  });

  it("preserves intrinsic uploaded-image dimensions through flow mutations", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      {
        op: "add-cell",
        cellId: "hero-image",
        laneId: "user-journey",
        column: 0,
        artifact: {
          type: "uploaded-image",
          dataUrl: "data:image/png;base64,abc",
          label: "Hero",
          width: 1440,
          height: 960,
        },
      },
    ]);

    expect(doc.cells).toEqual([
      {
        id: "hero-image",
        laneId: "user-journey",
        column: 0,
        areaId: FLOW_DEFAULT_AREA_ID,
        artifact: {
          type: "uploaded-image",
          dataUrl: "data:image/png;base64,abc",
          label: "Hero",
          width: 1440,
          height: 960,
        },
      },
    ]);
  });

  it("creates new areas with the configured placement gap", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      { op: "create-area", areaId: "area-2" },
    ]);

    expect(doc.areas).toEqual([
      { id: FLOW_DEFAULT_AREA_ID, name: FLOW_DEFAULT_AREA_NAME, columnOffset: 0 },
      { id: "area-2", name: "Area 2", columnOffset: FLOW_AREA_MIN_COLUMNS + FLOW_AREA_COLUMN_GAP },
    ]);
  });

  it("adds cells into separate areas without local column collisions", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      { op: "create-area", areaId: "area-2" },
      {
        op: "add-cell",
        cellId: "default-step",
        laneId: "normal-flow",
        areaId: FLOW_DEFAULT_AREA_ID,
        column: 0,
        artifact: { type: "journey-step", text: "Default" },
      },
      {
        op: "add-cell",
        cellId: "secondary-step",
        laneId: "normal-flow",
        areaId: "area-2",
        column: 0,
        artifact: { type: "journey-step", text: "Secondary" },
      },
    ]);

    expect(doc.cells.map((cell) => ({ id: cell.id, areaId: getFlowCellAreaId(doc, cell), column: cell.column }))).toEqual([
      { id: "default-step", areaId: FLOW_DEFAULT_AREA_ID, column: 0 },
      { id: "secondary-step", areaId: "area-2", column: 0 },
    ]);
  });

  it("rejects cross-area connections", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      { op: "create-area", areaId: "area-2" },
      {
        op: "add-cell",
        cellId: "default-step",
        laneId: "normal-flow",
        areaId: FLOW_DEFAULT_AREA_ID,
        column: 0,
        artifact: { type: "journey-step", text: "Default" },
      },
      {
        op: "add-cell",
        cellId: "secondary-step",
        laneId: "normal-flow",
        areaId: "area-2",
        column: 0,
        artifact: { type: "journey-step", text: "Secondary" },
      },
      {
        op: "add-connection",
        fromCellId: "default-step",
        toCellId: "secondary-step",
      },
    ]);

    expect(doc.connections).toEqual([]);
  });

  it("allows screen refs to connect into technical-briefing via mutations", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      {
        op: "add-cell",
        cellId: "screen-ref",
        laneId: "normal-flow",
        column: 0,
        artifact: { type: "design-frame-ref", frameId: "frame-1" },
      },
      {
        op: "add-cell",
        cellId: "technical-step",
        laneId: "technical-briefing",
        column: 0,
        artifact: {
          type: "technical-brief",
          title: "Contract",
          language: "json",
          body: "{}",
        },
      },
      {
        op: "add-connection",
        fromCellId: "screen-ref",
        toCellId: "technical-step",
      },
    ]);

    expect(doc.connections).toHaveLength(1);
    expect(doc.connections[0]).toMatchObject({
      fromCellId: "screen-ref",
      toCellId: "technical-step",
    });
  });

  it("moves cells between areas and drops now-invalid cross-area connections", () => {
    const seeded = applyFlowMutations(createEmptyFlowDocument(), [
      { op: "create-area", areaId: "area-2" },
      {
        op: "add-cell",
        cellId: "step-a",
        laneId: "normal-flow",
        areaId: FLOW_DEFAULT_AREA_ID,
        column: 0,
        artifact: { type: "journey-step", text: "A" },
      },
      {
        op: "add-cell",
        cellId: "step-b",
        laneId: "normal-flow",
        areaId: FLOW_DEFAULT_AREA_ID,
        column: 1,
        artifact: { type: "journey-step", text: "B" },
      },
      {
        op: "add-connection",
        fromCellId: "step-a",
        toCellId: "step-b",
      },
    ]);

    const moved = applyFlowMutations(seeded, [
      {
        op: "move-cell",
        cellId: "step-b",
        toColumn: 0,
        toAreaId: "area-2",
      },
    ]);

    expect(moved.cells.find((cell) => cell.id === "step-b")?.areaId).toBe("area-2");
    expect(moved.connections).toEqual([]);
  });

  it("describes update-cell mutations using the replacement artifact details", () => {
    const doc = applyFlowMutations(createEmptyFlowDocument(), [
      {
        op: "add-cell",
        cellId: "brief-1",
        laneId: "technical-briefing",
        column: 0,
        artifact: {
          type: "technical-brief",
          title: "Legacy API",
          language: "http",
          body: "GET /legacy",
        },
      },
    ]);

    const summary = describeFlowMutations([
      {
        op: "update-cell",
        cellId: "brief-1",
        artifact: {
          type: "technical-brief",
          title: "Checkout API",
          language: "http",
          body: "POST /checkout",
        },
      },
    ], doc);

    expect(summary).toBe('Updated technical brief "Checkout API"');
  });
});
