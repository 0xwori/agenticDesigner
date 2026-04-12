import { describe, expect, it } from "vitest";

import {
  buildFlowBoardMemoryContext,
  createFlowBoardMemoryState,
  FlowBoardMemoryParseError,
  parseFlowBoardMemoryText,
  projectFlowBoardMemoryToArtifacts,
  serializeFlowBoardMemoryDocument,
  updateFlowBoardMemoryStateFromText,
} from "./flowBoardMemory.js";

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
  });
});