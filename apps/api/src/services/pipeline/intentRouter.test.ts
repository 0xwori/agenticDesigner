import { describe, expect, it } from "vitest";
import { detectIntentHeuristic } from "./intentRouter.js";

describe("intent router heuristic", () => {
  it("routes pure questions without action verbs to question intent", () => {
    const result = detectIntentHeuristic("What is the best way to improve visual hierarchy?");
    expect(result.type).toBe("question");
    expect(result.shouldTakeAction).toBe(false);
  });

  it("routes design-system approvals to approval action", () => {
    const result = detectIntentHeuristic("Design system looks good, approve and ship it.");
    expect(result.type).toBe("design-system");
    expect(result.designSystemAction).toBe("approve");
  });

  it("routes generation prompts to screen action", () => {
    const result = detectIntentHeuristic("Create a mobile onboarding screen with progress and CTA.");
    expect(result.type).toBe("screen-action");
    expect(result.shouldTakeAction).toBe(true);
  });
});
