import { describe, expect, it } from "vitest";
import { createEmptyFlowDocument } from "@designer/shared";

import {
  appendConnectionToFlowDocument,
  cloneFlowArtifact,
  removeConnectionFromFlowDocument,
  resolveNearestConnectionSnapTarget,
  resolveFlowWheelGesture,
} from "./flowWorkspaceInteractions";

describe("flowWorkspaceInteractions", () => {
  it("classifies ctrl-wheel gestures as zoom with a stable factor", () => {
    const gesture = resolveFlowWheelGesture({
      deltaX: 0,
      deltaY: 24,
      deltaZ: 0,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });

    expect(gesture.kind).toBe("zoom");
    if (gesture.kind !== "zoom") {
      throw new Error("Expected a zoom gesture");
    }
    expect(gesture.factor).toBeLessThan(1);
    expect(gesture.factor).toBeGreaterThan(0.5);
  });

  it("routes shift-wheel to horizontal panning when there is no horizontal delta", () => {
    const gesture = resolveFlowWheelGesture({
      deltaX: 0,
      deltaY: 32,
      deltaZ: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      viewportWidth: 1280,
      viewportHeight: 820,
    });

    expect(gesture).toEqual({
      kind: "pan",
      deltaX: 32,
      deltaY: 0,
    });
  });

  it("adds a normalized connection once and ignores an exact duplicate", () => {
    const baseDoc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "start",
          laneId: "user-journey" as const,
          column: 0,
          areaId: "area-1",
          artifact: { type: "journey-step" as const, text: "Start" },
        },
        {
          id: "next",
          laneId: "user-journey" as const,
          column: 1,
          areaId: "area-1",
          artifact: { type: "journey-step" as const, text: "Next" },
        },
      ],
    };

    const withConnection = appendConnectionToFlowDocument(baseDoc, {
      fromCellId: "start",
      toCellId: "next",
      sourceSide: "right",
      targetSide: "left",
      createId: () => "edge-1",
    });

    expect(withConnection.connections).toEqual([
      {
        id: "edge-1",
        fromCellId: "start",
        toCellId: "next",
        sourceHandle: "right",
        targetHandle: "left-target",
      },
    ]);

    const duplicated = appendConnectionToFlowDocument(withConnection, {
      fromCellId: "start",
      toCellId: "next",
      sourceSide: "right",
      targetSide: "left",
      createId: () => "edge-2",
    });

    expect(duplicated).toBe(withConnection);
  });

  it("removes a selected connection without mutating the original document", () => {
    const doc = {
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

    const nextDoc = removeConnectionFromFlowDocument(doc, "edge-1");

    expect(nextDoc.connections).toEqual([]);
    expect(doc.connections).toHaveLength(1);
  });

  it("clones flow artifacts without reusing the same object reference", () => {
    const artifact = {
      type: "technical-brief" as const,
      title: "Payload",
      language: "json",
      body: '{"ok":true}',
    };

    const clone = cloneFlowArtifact(artifact);

    expect(clone).toEqual(artifact);
    expect(clone).not.toBe(artifact);
  });

  it("snaps to the nearest valid target handle before exact pointer hover", () => {
    const doc = {
      ...createEmptyFlowDocument(),
      cells: [
        {
          id: "start",
          laneId: "user-journey" as const,
          column: 0,
          areaId: "area-1",
          artifact: { type: "journey-step" as const, text: "Start" },
        },
        {
          id: "target",
          laneId: "user-journey" as const,
          column: 1,
          areaId: "area-1",
          artifact: { type: "journey-step" as const, text: "Target" },
        },
      ],
    };

    const snapTarget = resolveNearestConnectionSnapTarget({
      doc,
      sourceCellId: "start",
      point: { x: 326, y: 64 },
      threshold: 48,
      cells: [
        {
          cellId: "start",
          areaId: "area-1",
          laneId: "user-journey",
          x: 0,
          y: 0,
          width: 240,
          height: 128,
        },
        {
          cellId: "target",
          areaId: "area-1",
          laneId: "user-journey",
          x: 320,
          y: 0,
          width: 240,
          height: 128,
        },
      ],
    });

    expect(snapTarget).toMatchObject({
      cellId: "target",
      side: "left",
      point: { x: 320, y: 64 },
    });
  });
});