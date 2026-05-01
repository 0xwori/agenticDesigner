import { describe, expect, it } from "vitest";
import { getDesignSkill } from "./skills.js";

describe("design skills", () => {
  it("asks web and mobile generation to use visuals and motion", () => {
    const web = getDesignSkill({ surfaceTarget: "web", devicePreset: "desktop" });
    const mobile = getDesignSkill({ surfaceTarget: "mobile", devicePreset: "iphone" });

    expect(web).toContain("visual life");
    expect(web).toContain("prefers-reduced-motion");
    expect(web).toContain("rendered UI artifacts");
    expect(mobile).toContain("visual life");
    expect(mobile).toContain("project assets");
    expect(mobile).toContain("rendered app artifacts");
  });

  it("asks deck generation for structured visuals and asset ids", () => {
    const deck = getDesignSkill({ surfaceTarget: "deck", devicePreset: "desktop" });

    expect(deck).toContain("diagrams");
    expect(deck).toContain("illustration");
    expect(deck).toContain("subtle CSS motion");
    expect(deck).toContain("asset://");
  });
});
