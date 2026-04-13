import { describe, expect, it } from "vitest";
import { createEmptyFlowDocument } from "@designer/shared";

import {
  buildFlowBoardLayout,
  buildFlowChromeAreas,
  createFlowLayoutMetrics,
  estimateFlowArtifactHeight,
  getFlowDocumentBounds,
  getFlowSlotCenter,
  getFlowSlotLeft,
  getFlowGridSlotAtPosition,
  getFlowLaneTop,
  getMaxVisibleFlowBodyHeight,
  getFlowTranslateExtent,
} from "./flowAdapter";

describe("flowAdapter", () => {
  it("uses a minimum visible column count for sparse boards", () => {
    const doc = createEmptyFlowDocument();
    const metrics = createFlowLayoutMetrics(doc, {
      frameWidth: 1400,
      frameHeight: 800,
      headerHeight: 42,
      allDesignFrames: [],
    });

    expect(metrics.columnCount).toBe(4);
    expect(metrics.nodeWidth).toBeGreaterThan(0);
  });

  it("maps board positions to the nearest slot using cumulative lane tops", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "step-a",
          laneId: "user-journey" as const,
          column: 0,
          artifact: { type: "journey-step" as const, text: "Short" },
        },
        {
          id: "step-b",
          laneId: "normal-flow" as const,
          column: 1,
          artifact: { type: "technical-brief" as const, title: "Tall", language: "json", body: "x".repeat(420) },
        },
      ],
    };
    const metrics = createFlowLayoutMetrics(doc, {
      frameWidth: 1400,
      frameHeight: 800,
      headerHeight: 42,
      measuredNodeHeights: { "step-a": 228, "step-b": 280 },
      allDesignFrames: [],
    });

    expect(getFlowLaneTop("normal-flow", metrics)).toBeGreaterThan(180);
    expect(
      getFlowGridSlotAtPosition({ x: 240, y: 90 }, metrics),
    ).toEqual({
      areaId: "area-1",
      laneId: "user-journey",
      column: 0,
    });

    expect(
      getFlowGridSlotAtPosition({ x: 520, y: getFlowLaneTop("normal-flow", metrics) + 40 }, metrics),
    ).toEqual({
      areaId: "area-1",
      laneId: "normal-flow",
      column: 1,
    });
  });

  it("clamps the visible frame body height while preserving taller content", () => {
    const metrics = createFlowLayoutMetrics(
      {
        cells: [
          {
            id: "tall-image",
            laneId: "user-journey",
            column: 0,
            artifact: {
              type: "uploaded-image",
              dataUrl: "data:image/png;base64,abc",
              width: 600,
              height: 1600,
            },
          },
        ],
      },
      {
        frameWidth: 1400,
        frameHeight: 800,
        headerHeight: 42,
        maxVisibleBodyHeight: getMaxVisibleFlowBodyHeight(760),
        allDesignFrames: [],
      },
    );

    expect(metrics.contentHeight).toBeGreaterThan(metrics.visibleBodyHeight);
    expect(metrics.visibleBodyHeight).toBe(640);
    expect(metrics.frameHeight).toBe(682);
  });

  it("uses uploaded image intrinsic dimensions for initial height", () => {
    const metrics = createFlowLayoutMetrics(
      {
        cells: [
          {
            id: "image-1",
            laneId: "user-journey",
            column: 0,
            artifact: {
              type: "uploaded-image",
              dataUrl: "data:image/png;base64,abc",
              width: 1200,
              height: 900,
            },
          },
        ],
      },
      {
        frameWidth: 1400,
        frameHeight: 800,
        headerHeight: 42,
        allDesignFrames: [],
      },
    );

    expect(metrics.laneHeights[0]).toBeGreaterThan(180);
    expect(metrics.contentHeight).toBeGreaterThanOrEqual(metrics.laneHeights[0] + 180 * 3);
  });

  it("distributes extra frame height across all swimlanes", () => {
    const metrics = createFlowLayoutMetrics(createEmptyFlowDocument(), {
      frameWidth: 1400,
      frameHeight: 1040,
      headerHeight: 0,
      allDesignFrames: [],
    });

    expect(metrics.contentHeight).toBe(1040);
    expect(metrics.laneHeights).toEqual([260, 260, 260, 260]);
    expect(getFlowLaneTop("normal-flow", metrics)).toBe(260);
    expect(getFlowLaneTop("technical-briefing", metrics)).toBe(780);
  });

  it("distributes extra frame width across visible columns", () => {
    const compactMetrics = createFlowLayoutMetrics(createEmptyFlowDocument(), {
      frameWidth: 1200,
      frameHeight: 900,
      headerHeight: 0,
      allDesignFrames: [],
    });
    const wideMetrics = createFlowLayoutMetrics(createEmptyFlowDocument(), {
      frameWidth: 1600,
      frameHeight: 900,
      headerHeight: 0,
      allDesignFrames: [],
    });

    expect(compactMetrics.nodeGap).toBe(32);
    expect(wideMetrics.nodeGap).toBeGreaterThan(compactMetrics.nodeGap);
    expect(wideMetrics.contentWidth).toBe(1600);
    expect(wideMetrics.areas[0]?.width).toBeGreaterThan(compactMetrics.areas[0]?.width ?? 0);
    expect(getFlowSlotLeft(1, wideMetrics, "area-1")).toBeGreaterThan(getFlowSlotLeft(1, compactMetrics, "area-1"));
  });

  it("uses standard screen ratios by default and honors manual screen preview heights", () => {
    const referencedFrames = [
      {
        id: "frame-1",
        projectId: "project-1",
        name: "Desktop screen",
        devicePreset: "desktop" as const,
        mode: "high-fidelity" as const,
        selected: false,
        position: { x: 0, y: 0 },
        size: { width: 1240, height: 2000 },
        currentVersionId: null,
        status: "ready" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
      },
    ];

    const standardHeight = estimateFlowArtifactHeight(
      { type: "design-frame-ref", frameId: "frame-1" },
      240,
      referencedFrames,
    );
    const manualHeight = estimateFlowArtifactHeight(
      { type: "design-frame-ref", frameId: "frame-1", previewMode: "manual", previewHeight: 320 },
      240,
      referencedFrames,
    );

    expect(standardHeight).toBeLessThan(260);
    expect(manualHeight).toBeGreaterThan(standardHeight);
  });

  it("keeps the first visible column aligned with the gutter boundary", () => {
    const metrics = createFlowLayoutMetrics(createEmptyFlowDocument(), {
      frameWidth: 1440,
      frameHeight: 900,
      headerHeight: 0,
      allDesignFrames: [],
    });
    const chromeAreas = buildFlowChromeAreas(metrics);

    expect(chromeAreas[0]?.gutterWidth).toBe(metrics.areas[0]?.slotLeft - metrics.areas[0]?.left);
    expect(chromeAreas[0]?.gridColumns[0]?.left).toBe(chromeAreas[0]?.gutterWidth);
  });

  it("top-aligns screens and images inside taller lane cells", () => {
    const referencedFrames = [
      {
        id: "frame-1",
        projectId: "project-1",
        name: "Desktop screen",
        devicePreset: "desktop" as const,
        mode: "high-fidelity" as const,
        selected: false,
        position: { x: 0, y: 0 },
        size: { width: 1240, height: 1600 },
        currentVersionId: null,
        status: "ready" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
      },
    ];

    const result = buildFlowBoardLayout(
      {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "screen-ref",
            laneId: "normal-flow" as const,
            column: 0,
            artifact: { type: "design-frame-ref" as const, frameId: "frame-1" },
          },
          {
            id: "image-ref",
            laneId: "unhappy-path" as const,
            column: 0,
            artifact: {
              type: "uploaded-image" as const,
              dataUrl: "data:image/png;base64,abc",
              width: 1200,
              height: 900,
            },
          },
        ],
      },
      {
        frameWidth: 1440,
        frameHeight: 1280,
        headerHeight: 0,
        allDesignFrames: referencedFrames,
      },
    );

    const screenCell = result.cells.find((cell) => cell.cellId === "screen-ref");
    const imageCell = result.cells.find((cell) => cell.cellId === "image-ref");

    expect(screenCell?.y).toBe(result.metrics.laneTops[1] + result.metrics.laneInnerPadding);
    expect(imageCell?.y).toBe(result.metrics.laneTops[2] + result.metrics.laneInnerPadding);
  });

  it("ignores stale measured heights for manual screen previews", () => {
    const referencedFrames = [
      {
        id: "frame-1",
        projectId: "project-1",
        name: "Desktop screen",
        devicePreset: "desktop" as const,
        mode: "high-fidelity" as const,
        selected: false,
        position: { x: 0, y: 0 },
        size: { width: 1240, height: 2000 },
        currentVersionId: null,
        status: "ready" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
      },
    ];
    const manualArtifact = {
      type: "design-frame-ref" as const,
      frameId: "frame-1",
      previewMode: "manual" as const,
      previewHeight: 320,
    };

    const result = buildFlowBoardLayout(
      {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "screen-ref",
            laneId: "normal-flow" as const,
            column: 0,
            artifact: manualArtifact,
          },
        ],
      },
      {
        frameWidth: 1400,
        frameHeight: 800,
        headerHeight: 42,
        measuredNodeHeights: { "screen-ref": 140 },
        allDesignFrames: referencedFrames,
      },
    );

    expect(result.cells[0]?.height).toBe(estimateFlowArtifactHeight(manualArtifact, 240, referencedFrames));
  });

  it("normalizes legacy edge handles when building board edges", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        { id: "a", laneId: "normal-flow" as const, column: 0, artifact: { type: "journey-step" as const, text: "A" } },
        { id: "b", laneId: "normal-flow" as const, column: 1, artifact: { type: "journey-step" as const, text: "B" } },
      ],
      connections: [{ id: "edge-1", fromCellId: "a", toCellId: "b" }],
    };

    const result = buildFlowBoardLayout(doc, {
      frameWidth: 1400,
      frameHeight: 800,
      headerHeight: 42,
      allDesignFrames: [],
    });

    expect(result.edges[0]).toMatchObject({
      id: "edge-1",
      fromCellId: "a",
      toCellId: "b",
      sourceHandle: "right",
      targetHandle: "left-target",
      sourceHandleSide: "right",
      targetHandleSide: "left",
    });
  });

  it("filters stale edges that violate the lane matrix", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "journey-step",
          laneId: "user-journey" as const,
          column: 0,
          artifact: { type: "journey-step" as const, text: "Start" },
        },
        {
          id: "technical-step",
          laneId: "technical-briefing" as const,
          column: 0,
          artifact: {
            type: "technical-brief" as const,
            title: "Payload",
            language: "json",
            body: "{}",
          },
        },
      ],
      connections: [
        {
          id: "invalid-edge",
          fromCellId: "journey-step",
          toCellId: "technical-step",
        },
      ],
    };

    const result = buildFlowBoardLayout(doc, {
      frameWidth: 1400,
      frameHeight: 800,
      headerHeight: 42,
      allDesignFrames: [],
    });

    expect(result.edges).toEqual([]);
  });

  it("keeps screen refs connected to technical briefing when the source is a screen artifact", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "screen-ref",
          laneId: "normal-flow" as const,
          column: 0,
          artifact: { type: "design-frame-ref" as const, frameId: "frame-1" },
        },
        {
          id: "technical-step",
          laneId: "technical-briefing" as const,
          column: 0,
          artifact: {
            type: "technical-brief" as const,
            title: "Contract",
            language: "json",
            body: "{}",
          },
        },
      ],
      connections: [
        {
          id: "allowed-edge",
          fromCellId: "screen-ref",
          toCellId: "technical-step",
        },
      ],
    };

    const result = buildFlowBoardLayout(doc, {
      frameWidth: 1400,
      frameHeight: 800,
      headerHeight: 42,
      allDesignFrames: [],
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      id: "allowed-edge",
      fromCellId: "screen-ref",
      toCellId: "technical-step",
    });
  });

  it("treats inter-area gaps as non-droppable and maps slots inside later areas", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      areas: [
        { id: "area-1", name: "Area 1", columnOffset: 0 },
        { id: "area-2", name: "Area 2", columnOffset: 7 },
      ],
    };

    const metrics = createFlowLayoutMetrics(doc, {
      frameWidth: 1600,
      frameHeight: 800,
      headerHeight: 42,
      allDesignFrames: [],
    });

    const gapX = metrics.areas[0].left + metrics.areas[0].width + metrics.areaGap / 2;

    expect(
      getFlowGridSlotAtPosition(
        {
          x: gapX,
          y: 90,
        },
        metrics,
      ),
    ).toBeNull();

    expect(
      getFlowGridSlotAtPosition(
        {
          x: getFlowSlotLeft(0, metrics, "area-2") + metrics.nodeWidth / 2,
          y: 90,
        },
        metrics,
      ),
    ).toEqual({
      areaId: "area-2",
      laneId: "user-journey",
      column: 0,
    });
  });

  it("positions slot overlays using the area-local column instead of reusing global column zero", () => {
    const metrics = createFlowLayoutMetrics(
      {
        ...createEmptyFlowDocument(),
        areas: [
          { id: "area-1", name: "Area 1", columnOffset: 0 },
          { id: "area-2", name: "Area 2", columnOffset: 7 },
        ],
      },
      {
        frameWidth: 1600,
        frameHeight: 900,
        headerHeight: 0,
        allDesignFrames: [],
      },
    );

    const firstAreaCenter = getFlowSlotCenter(
      { areaId: "area-1", laneId: "user-journey", column: 0 },
      metrics,
    );
    const secondAreaCenter = getFlowSlotCenter(
      { areaId: "area-2", laneId: "user-journey", column: 0 },
      metrics,
    );

    expect(secondAreaCenter.x).toBeGreaterThan(firstAreaCenter.x + metrics.areas[0].width);
  });

  it("only snaps inside slot boundaries and switches columns at the midpoint between slot centers", () => {
    const metrics = createFlowLayoutMetrics(createEmptyFlowDocument(), {
      frameWidth: 1400,
      frameHeight: 900,
      headerHeight: 0,
      allDesignFrames: [],
    });

    const firstArea = metrics.areas[0];
    if (!firstArea) {
      throw new Error("Expected a default flow area");
    }

    expect(
      getFlowGridSlotAtPosition(
        {
          x: firstArea.left + 12,
          y: 90,
        },
        metrics,
      ),
    ).toBeNull();

    const firstCenter = getFlowSlotCenter(
      { areaId: firstArea.id, laneId: "user-journey", column: 0 },
      metrics,
    ).x;

    expect(
      getFlowGridSlotAtPosition(
        {
          x: firstCenter + metrics.slotStep * 0.49,
          y: 90,
        },
        metrics,
      ),
    ).toEqual({
      areaId: firstArea.id,
      laneId: "user-journey",
      column: 0,
    });

    expect(
      getFlowGridSlotAtPosition(
        {
          x: firstCenter + metrics.slotStep * 0.51,
          y: 90,
        },
        metrics,
      ),
    ).toEqual({
      areaId: firstArea.id,
      laneId: "user-journey",
      column: 1,
    });
  });

  it("returns document bounds that include lane context, not just artifact columns", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "mobile-ref",
          laneId: "user-journey" as const,
          column: 0,
          artifact: {
            type: "design-frame-ref" as const,
            frameId: "frame-1",
          },
        },
      ],
    };

    const metrics = createFlowLayoutMetrics(doc, {
      frameWidth: 1400,
      frameHeight: 800,
      headerHeight: 42,
      allDesignFrames: [
        {
          id: "frame-1",
          projectId: "project-1",
          name: "Mobile",
          devicePreset: "iphone-15-pro",
          mode: "high-fidelity",
          selected: false,
          position: { x: 0, y: 0 },
          size: { width: 390, height: 844 },
          currentVersionId: null,
          status: "ready",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [],
        },
      ],
    });

    const bounds = getFlowDocumentBounds(doc, metrics);

    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeLessThan(getFlowSlotLeft(0, metrics, "area-1"));
    expect(bounds?.height).toBe(metrics.contentHeight);
  });

  it("builds separate chrome areas for each swimlane frame without emitting decorative cells", () => {
    const result = buildFlowBoardLayout(
      {
        ...createEmptyFlowDocument(),
        areas: [
          { id: "area-1", name: "Area 1", columnOffset: 0 },
          { id: "area-2", name: "Area 2", columnOffset: 7 },
        ],
      },
      {
        frameWidth: 1600,
        frameHeight: 900,
        headerHeight: 0,
        allDesignFrames: [],
      },
    );

    expect(result.cells).toHaveLength(0);
    expect(result.chromeAreas).toHaveLength(2);
    expect(result.chromeAreas[1]?.id).toBe("area-2");
    expect(result.chromeAreas[1]?.gutterWidth).toBeGreaterThan(0);
    expect(result.chromeAreas[1]?.gutterWidth).toBeLessThan(result.chromeAreas[1]?.width ?? 0);
    expect(result.chromeAreas[1]?.lanes).toHaveLength(4);
    expect(result.chromeAreas[1]?.lanes.some((lane) => lane.laneId === "technical-briefing")).toBe(true);
  });

  it("adds min-zoom-aware translate padding so the workspace can pan left after fit", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "start",
          laneId: "user-journey" as const,
          column: 0,
          artifact: { type: "journey-step" as const, text: "Start" },
        },
      ],
    };

    const metrics = createFlowLayoutMetrics(doc, {
      frameWidth: 1440,
      frameHeight: 900,
      headerHeight: 0,
      allDesignFrames: [],
    });

    const extent = getFlowTranslateExtent(metrics, 1440, 900, 0.35);

    expect(extent[0][0]).toBeLessThanOrEqual(-Math.ceil(1440 / 0.35));
    expect(extent[0][1]).toBeLessThanOrEqual(-Math.ceil(900 / 0.35));
    expect(extent[1][0]).toBeGreaterThan(metrics.contentWidth);
    expect(extent[1][1]).toBeGreaterThan(metrics.contentHeight);
  });

  it("extends the visible area width when extra columns are requested", () => {
    const metrics = createFlowLayoutMetrics(createEmptyFlowDocument(), {
      frameWidth: 1400,
      frameHeight: 900,
      headerHeight: 0,
      allDesignFrames: [],
      extraAreaColumns: { "area-1": 2 },
    });

    expect(metrics.areas[0]?.localColumnCount).toBe(6);
    expect(
      getFlowGridSlotAtPosition(
        {
          x: getFlowSlotLeft(5, metrics, "area-1") + metrics.nodeWidth / 2,
          y: 90,
        },
        metrics,
      ),
    ).toEqual({
      areaId: "area-1",
      laneId: "user-journey",
      column: 5,
    });
  });
});
