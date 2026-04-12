import { describe, expect, it, vi } from "vitest";
import { createEmptyFlowDocument } from "@designer/shared";

import { requestCompletion } from "../llmProviders.js";
import { generateFlowStory } from "./flowStory.js";

vi.mock("../llmProviders.js", () => ({
  requestCompletion: vi.fn(),
}));

describe("generateFlowStory", () => {
  it("builds and persists a story payload onto the flow document", async () => {
    vi.mocked(requestCompletion).mockResolvedValue({
      content: JSON.stringify({
        title: "Checkout completion",
        userStory: "As a shopper, I want to finish checkout so that I can place my order.",
        acceptanceCriteria: [
          "Given a ready cart, when the user submits payment, then the order is confirmed.",
          "Given a payment failure, when the provider rejects the charge, then the user sees recovery options.",
        ],
        technicalNotes: [
          "Refresh the cart and payment intent on load.",
          "Persist the checkout state between retries.",
        ],
      }),
      usedProvider: "openai",
      usedModel: "gpt-5.4-mini",
    } as never);

    const result = await generateFlowStory({
      prompt: "Export this board as a story.",
      flowDocument: {
        ...createEmptyFlowDocument(),
        boardMemory: {
          authoredText: "version: 1\ngoals:\n  - Help the shopper finish checkout\n",
          updatedAt: "2026-04-12T10:00:00.000Z",
          snapshot: {
            version: 1,
            goals: ["Help the shopper finish checkout"],
            assumptions: [],
            entities: [],
            screens: [],
            journey: [],
            technicalNotes: [],
            openQuestions: [],
            artifactMappings: [],
          },
        },
        cells: [
          {
            id: "journey",
            laneId: "user-journey",
            column: 0,
            artifact: { type: "journey-step", text: "Checkout" },
          },
          {
            id: "screen",
            laneId: "normal-flow",
            column: 0,
            artifact: { type: "design-frame-ref", frameId: "frame-1" },
          },
        ],
        connections: [
          {
            id: "edge-1",
            fromCellId: "journey",
            toCellId: "screen",
          },
        ],
      },
      designFrames: [{ id: "frame-1", name: "Checkout screen" }],
      provider: "openai",
      model: "gpt-5.4-mini",
    });

    expect(result.story.title).toBe("Checkout completion");
    expect(result.story.acceptanceCriteria).toHaveLength(2);
    expect(result.updatedDocument.story).toEqual(result.story);
    expect(result.summary).toContain("Generated story");

    const input = vi.mocked(requestCompletion).mock.calls[0][0];
    expect(input.system).toContain("Return ONLY valid JSON");
    expect(input.prompt).toContain("Checkout screen");
    expect(input.prompt).toContain("Board memory:");
    expect(input.prompt).toContain("goals=1");
    expect(input.prompt).toContain("User request: Export this board as a story.");
  });

  it("seeds board memory and includes frame summaries when the board has no memory yet", async () => {
    vi.mocked(requestCompletion).mockResolvedValue({
      content: JSON.stringify({
        title: "Checkout completion",
        userStory: "As a shopper, I want to finish checkout so that I can place my order.",
        acceptanceCriteria: ["When payment succeeds, the order is confirmed."],
        technicalNotes: ["Refresh checkout state on load."],
      }),
      usedProvider: "openai",
      usedModel: "gpt-5.4-mini",
    } as never);

    const result = await generateFlowStory({
      flowDocument: {
        ...createEmptyFlowDocument(),
        cells: [
          {
            id: "screen",
            laneId: "normal-flow",
            column: 0,
            artifact: { type: "design-frame-ref", frameId: "frame-1" },
          },
        ],
      },
      designFrames: [
        {
          id: "frame-1",
          name: "Checkout screen",
          summary: "key UI copy: Checkout, Card details, Pay now",
        },
      ],
      provider: "openai",
      model: "gpt-5.4-mini",
    });

    const input = vi.mocked(requestCompletion).mock.calls.at(-1)?.[0];
    expect(input?.prompt).toContain("summary=\"key UI copy: Checkout, Card details, Pay now\"");
    expect(result.updatedDocument.boardMemory?.snapshot.screens[0]).toMatchObject({
      frameId: "frame-1",
      title: "Checkout screen",
    });
  });
});