import { describe, expect, it } from "vitest";

import {
  buildFlowBoardMemoryContext,
  createFlowBoardMemoryState,
  FlowBoardMemoryParseError,
  parseFlowBoardMemoryText,
  projectFlowBoardMemoryToArtifacts,
  serializeFlowBoardMemoryDocument,
  syncFlowDocumentWithBoardMemory,
  updateFlowBoardMemoryStateFromText,
} from "./flowBoardMemory.js";
import { createEmptyFlowDocument } from "@designer/shared";

describe("flowBoardMemory", () => {
  it("parses a YAML-like board memory document into a canonical snapshot", () => {
    const parsed = parseFlowBoardMemoryText(`
version: 1
goals:
  - Improve checkout clarity
assumptions:
  - Customer is authenticated
screens:
  - id: browse
    title: Browse products
    frameId: frame-1
    notes:
      - Show search early
journey:
  - id: browse-step
    title: Browse products
    lane: user-journey
    kind: step
    screenId: browse
  - id: payment-decision
    title: Payment successful?
    lane: unhappy-path
    kind: decision
technicalNotes:
  - id: checkout-api
    title: Checkout API
    body: POST /checkout
    language: http
    tags:
      - api
openQuestions:
  - What happens when payment fails twice?
artifactMappings:
  - memoryId: browse-step
    frameId: frame-1
`);

    expect(parsed.screens[0]).toMatchObject({
      id: "browse",
      title: "Browse products",
      frameId: "frame-1",
      notes: ["Show search early"],
    });
    expect(parsed.journey[1]).toMatchObject({
      id: "payment-decision",
      laneId: "unhappy-path",
      kind: "decision",
    });

    const projection = projectFlowBoardMemoryToArtifacts(parsed);
    expect(projection.journeyArtifacts[1]).toMatchObject({
      memoryId: "payment-decision",
      laneId: "unhappy-path",
      artifact: { type: "journey-step", text: "Payment successful?", shape: "diamond" },
    });
    expect(projection.technicalArtifacts[0]).toMatchObject({
      memoryId: "checkout-api",
      artifact: { type: "technical-brief", title: "Checkout API", language: "http", body: "POST /checkout" },
      tags: ["api"],
    });
  });

  it("rejects unsupported fields for predictable parsing", () => {
    expect(() =>
      parseFlowBoardMemoryText(`
version: 1
randomField: true
`),
    ).toThrow(FlowBoardMemoryParseError);
  });

  it("creates and updates persisted board memory state", () => {
    const state = createFlowBoardMemoryState({
      snapshot: {
        version: 1,
        goals: ["Ship a safer checkout flow"],
        assumptions: [],
        entities: [],
        screens: [],
        journey: [],
        technicalNotes: [],
        openQuestions: [],
        artifactMappings: [],
      },
      updatedAt: "2026-04-12T10:00:00.000Z",
    });

    expect(state.authoredText).toContain("Ship a safer checkout flow");
    expect(serializeFlowBoardMemoryDocument(state.snapshot)).toContain("goals:");

    const updated = updateFlowBoardMemoryStateFromText(`
version: 1
goals:
  - Reduce drop-off before payment
journey:
  - title: Review cart
`, "2026-04-12T10:10:00.000Z");

    expect(updated.snapshot.goals).toEqual(["Reduce drop-off before payment"]);
    expect(updated.snapshot.journey[0]).toMatchObject({
      id: "journey-1",
      title: "Review cart",
      laneId: "user-journey",
      kind: "step",
    });
    expect(buildFlowBoardMemoryContext(updated)).toContain("journey=1");
    expect(buildFlowBoardMemoryContext(updated)).toContain("Reduce drop-off before payment");
    expect(buildFlowBoardMemoryContext(updated)).toContain('title="Review cart"');
  });

  it("syncs board-memory artifacts back into the flow document with stable mappings", () => {
    const synced = syncFlowDocumentWithBoardMemory(
      {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "design-1",
            laneId: "normal-flow",
            column: 0,
            artifact: { type: "design-frame-ref", frameId: "frame-1" },
          },
          {
            id: "journey-cell",
            laneId: "user-journey",
            column: 0,
            artifact: { type: "journey-step", text: "Legacy browse" },
          },
          {
            id: "tech-cell",
            laneId: "technical-briefing",
            column: 1,
            artifact: { type: "technical-brief", title: "Legacy API", language: "http", body: "GET /legacy" },
          },
        ],
        connections: [
          {
            id: "conn-1",
            fromCellId: "journey-cell",
            toCellId: "design-1",
          },
        ],
      },
      parseFlowBoardMemoryText(`
version: 1
screens:
  - id: browse-screen
    title: Browse products
    frameId: frame-1
journey:
  - id: browse-step
    title: Browse products
    lane: user-journey
technicalNotes:
  - id: api-brief
    title: Browse API
    body: GET /products
    language: http
artifactMappings:
  - memoryId: browse-step
    cellId: journey-cell
  - memoryId: api-brief
    cellId: tech-cell
`),
    );

    expect(synced.flowDocument.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "journey-cell",
          laneId: "user-journey",
          artifact: expect.objectContaining({ type: "journey-step", text: "Browse products" }),
        }),
        expect.objectContaining({
          id: "tech-cell",
          laneId: "technical-briefing",
          artifact: expect.objectContaining({ type: "technical-brief", title: "Browse API", body: "GET /products" }),
        }),
      ]),
    );
    expect(synced.flowDocument.connections).toEqual([
      expect.objectContaining({ id: "conn-1", fromCellId: "journey-cell", toCellId: "design-1" }),
    ]);
    expect(synced.snapshot.artifactMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memoryId: "browse-screen", cellId: "design-1", frameId: "frame-1" }),
        expect.objectContaining({ memoryId: "browse-step", cellId: "journey-cell" }),
        expect.objectContaining({ memoryId: "api-brief", cellId: "tech-cell" }),
      ]),
    );
    expect(synced.flowDocument.boardMemory?.authoredText).toContain("artifactMappings:");
  });
});