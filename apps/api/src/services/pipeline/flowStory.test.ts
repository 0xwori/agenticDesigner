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
        title: "[Platform: APP] Checkout completion",
        goal: "Help the shopper finish checkout and recover from payment failures.",
        userContext: {
          startingPoint: [
            "The shopper is on the checkout screen with a ready cart.",
          ],
        },
        design: {
          reference: "Not available in board context",
        },
        acceptanceCriteriaSections: [
          {
            section: "Checkout Behavior",
            items: [
              "If the shopper submits a valid payment, then the order is confirmed.",
              "If the payment provider rejects the charge, then show recovery options.",
            ],
          },
        ],
        phraseKeys: [
          "checkout_title: \"Checkout\"",
          "checkout_submit_button: \"Place order\"",
          "general_retry_button: \"Try again\"",
          "accessibility_checkout_close_button: \"Close checkout\"",
        ],
        technicalBriefing: [
          "Refresh the cart and payment intent on load.",
          "Persist the checkout state between retries.",
        ],
        accessibilityRequirements: [
          "Support dynamic font sizing up to the maximum system size.",
          "Support dark mode, landscape, and VoiceOver/TalkBack labels for image-only buttons.",
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
          {
            id: "image-1",
            laneId: "normal-flow",
            column: 1,
            artifact: {
              type: "uploaded-image",
              label: "Checkout screenshot",
              dataUrl: "data:image/png;base64,checkout-image",
            },
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
      designFrames: [{ id: "frame-1", name: "Checkout screen", summary: "Visible content: Checkout / Place order. Actions: Place order, Try again." }],
      provider: "openai",
      model: "gpt-5.4-mini",
    });

    expect(result.story.title).toBe("[Platform: APP] Checkout completion");
    expect(result.story.goal).toContain("finish checkout");
    expect(result.story.startingPoint).toEqual([
      "The shopper is on the checkout screen with a ready cart.",
    ]);
    expect(result.story.designReference).toBe("Not available in board context");
    expect(result.story.acceptanceCriteria).toHaveLength(2);
    expect(result.story.acceptanceCriteriaGroups).toEqual([
      {
        title: "Checkout Behavior",
        items: [
          "If the shopper submits a valid payment, then the order is confirmed.",
          "If the payment provider rejects the charge, then show recovery options.",
        ],
      },
    ]);
    expect(result.story.phraseKeys).toContain("general_retry_button: \"Try again\"");
    expect(result.story.technicalBriefing).toContain("Refresh the cart and payment intent on load.");
    expect(result.story.accessibilityRequirements).toHaveLength(2);
    expect(result.updatedDocument.story).toEqual(result.story);
    expect(result.summary).toContain("Generated story");

    const input = vi.mocked(requestCompletion).mock.calls[0][0];
    expect(input.system).toContain("Technical Product Manager (TPM)");
    expect(input.system).toContain("Politie MMA Team");
    expect(input.system).toContain("acceptanceCriteriaSections");
    expect(input.system).toContain('key_name: "Visible text"');
    expect(input.prompt).toContain("Checkout screen");
    expect(input.prompt).toContain("summary: Visible content: Checkout / Place order.");
    expect(input.prompt).toContain('image attachment id: flow-story-image-image-1');
    expect(input.prompt).toContain("Board memory:");
    expect(input.prompt).toContain("goals=1");
    expect(input.prompt).toContain("User request: Export this board as a story.");
    expect(input.attachments).toEqual([
      expect.objectContaining({
        id: "flow-story-image-image-1",
        type: "image",
        dataUrl: "data:image/png;base64,checkout-image",
      }),
    ]);
  });
});