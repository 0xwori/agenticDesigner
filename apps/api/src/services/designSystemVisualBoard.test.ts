import { describe, expect, it } from "vitest";
import type { ReferenceStyleContext } from "@designer/shared";
import { buildStyleProfileFromStyleContext } from "./designSystemProfile.js";
import { buildDesignSystemVisualBoard } from "./designSystemVisualBoard.js";

const CORE_SECTION_IDS = [
  "brand-foundations",
  "color-system",
  "typography-system",
  "spacing-layout",
  "shape-visual-rules",
  "core-components",
  "navigation"
] as const;

const CONTEXT: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#2563eb",
    secondary: "#0f766e",
    accent: "#f59e0b",
    surface: "#f8fafc",
    text: "#0f172a"
  },
  typography: {
    headingFamily: "Sora, ui-sans-serif, system-ui",
    bodyFamily: "Manrope, ui-sans-serif, system-ui",
    cornerRadius: 14
  },
  spacingScale: [4, 8, 12, 16, 20, 24, 32],
  componentPatterns: ["buttons", "inputs", "cards", "navigation", "feedback", "data display", "iconography"],
  layoutMotifs: ["dashboard", "stacked sections"]
};

describe("buildDesignSystemVisualBoard", () => {
  it("always includes the Core 7 sections", () => {
    const profileBundle = buildStyleProfileFromStyleContext({
      styleContext: CONTEXT,
      sourceType: "figma-reference",
      explicitQualityScore: 0.84
    });

    const lowOptionalQuality = {
      ...profileBundle.qualityReport,
      familyConfidence: profileBundle.qualityReport.familyConfidence.map((family) =>
        family.family === "feedback" || family.family === "data-display" || family.family === "iconography"
          ? {
              ...family,
              confidence: 0.2
            }
          : family
      )
    };

    const board = buildDesignSystemVisualBoard({
      styleProfile: profileBundle.styleProfile,
      qualityReport: lowOptionalQuality,
      overview: "Reference board",
      colors: profileBundle.styleProfile.tokens.colors,
      typography: profileBundle.styleProfile.tokens.typography,
      components: [],
      dos: [],
      donts: []
    });

    const sectionIds = board.sections.map((section) => section.id);
    for (const sectionId of CORE_SECTION_IDS) {
      expect(sectionIds).toContain(sectionId);
    }
    expect(sectionIds).not.toContain("feedback-status");
    expect(sectionIds).not.toContain("data-display");
    expect(sectionIds).not.toContain("iconography-imagery");
  });

  it("shows optional sections when confidence is above threshold", () => {
    const profileBundle = buildStyleProfileFromStyleContext({
      styleContext: CONTEXT,
      sourceType: "figma-reference",
      explicitQualityScore: 0.9
    });

    const highOptionalQuality = {
      ...profileBundle.qualityReport,
      familyConfidence: profileBundle.qualityReport.familyConfidence.map((family) =>
        family.family === "feedback" || family.family === "data-display" || family.family === "iconography"
          ? {
              ...family,
              confidence: 0.9
            }
          : family
      )
    };

    const board = buildDesignSystemVisualBoard({
      styleProfile: profileBundle.styleProfile,
      qualityReport: highOptionalQuality,
      overview: "Reference board",
      colors: profileBundle.styleProfile.tokens.colors,
      typography: profileBundle.styleProfile.tokens.typography,
      components: [],
      dos: [],
      donts: []
    });

    const sectionIds = board.sections.map((section) => section.id);
    expect(sectionIds).toContain("feedback-status");
    expect(sectionIds).toContain("data-display");
    expect(sectionIds).toContain("iconography-imagery");
  });
});
