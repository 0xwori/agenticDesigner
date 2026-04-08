import { describe, expect, it } from "vitest";
import type { ReferenceStyleContext } from "@designer/shared";
import { generateDesignMarkdownFromStyleContext, parseDesignMarkdown } from "./designSystemMd.js";
import { buildStyleProfileFromStyleContext, buildQualityReportFromRecipes } from "./designSystemProfile.js";

const CONTEXT: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#18a999",
    secondary: "#0f4c81",
    accent: "#ff6b35",
    surface: "#f6f8fb",
    text: "#17212b"
  },
  typography: {
    headingFamily: "Inter, ui-sans-serif, system-ui",
    bodyFamily: "Inter, ui-sans-serif, system-ui",
    cornerRadius: 12
  },
  spacingScale: [4, 8, 12, 16, 20, 24, 32],
  componentPatterns: ["pill buttons", "outlined inputs"],
  layoutMotifs: ["content rail", "stacked sections"]
};

describe("parseDesignMarkdown", () => {
  it("does not auto-inject fallback palette tokens when markdown has no valid color lines", () => {
    const markdown = `## Overview
Minimal style.

## Colors
- No explicit color tokens yet.

## Typography
- **Headline Font**: Inter
- **Body Font**: Inter
- **Label Font**: Inter

## Elevation
Flat.

## Components
- Buttons: rounded.

## Do's and Don'ts
- Do keep rhythm.
- Don't over-style.`;

    const parsed = parseDesignMarkdown(markdown, CONTEXT);
    expect(parsed.structuredTokens.colors).toEqual([]);
  });

  it("preserves family-specific recipe morphology from generated component lines", () => {
    const profileBundle = buildStyleProfileFromStyleContext({
      styleContext: CONTEXT,
      sourceType: "figma-reference"
    });
    const styleProfile = {
      ...profileBundle.styleProfile,
      componentRecipes: profileBundle.styleProfile.componentRecipes.map((recipe) => {
        if (recipe.family === "buttons") {
          return {
            ...recipe,
            shape: "pill" as const,
            cornerRadius: 999,
            borderWidth: 0,
            borderStyle: "none" as const,
            fillStyle: "solid" as const,
            controlHeight: 48
          };
        }
        if (recipe.family === "inputs") {
          return {
            ...recipe,
            shape: "rounded" as const,
            cornerRadius: 12,
            borderWidth: 2,
            borderStyle: "solid" as const,
            fillStyle: "outline" as const,
            controlHeight: 44
          };
        }
        return recipe;
      })
    };
    const qualityReport = buildQualityReportFromRecipes(
      styleProfile.componentRecipes,
      styleProfile.extractionEvidence,
      0.82,
      {
        colorsDetected: styleProfile.tokens.colors.length,
        componentFamiliesDetected: styleProfile.componentRecipes.length
      }
    );
    const markdown = generateDesignMarkdownFromStyleContext(CONTEXT, "Roundtrip test", styleProfile, qualityReport);
    const parsed = parseDesignMarkdown(markdown, CONTEXT, {
      styleProfile,
      qualityReport
    });
    const button = parsed.structuredTokens.styleProfile.componentRecipes.find((recipe) => recipe.family === "buttons");
    const input = parsed.structuredTokens.styleProfile.componentRecipes.find((recipe) => recipe.family === "inputs");

    expect(button?.shape).toBe("pill");
    expect(button?.fillStyle).toBe("solid");
    expect(button?.borderStyle).toBe("none");
    expect(input?.borderWidth).toBe(2);
    expect(input?.fillStyle).toBe("outline");
    expect(parsed.structuredTokens.visualBoard.version).toBe(1);
    expect(parsed.structuredTokens.visualBoard.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining([
        "brand-foundations",
        "color-system",
        "typography-system",
        "spacing-layout",
        "shape-visual-rules",
        "core-components",
        "navigation"
      ])
    );
  });
});
