import { describe, expect, it } from "vitest";
import type { ReferenceStyleContext } from "@designer/shared";
import { buildStyleProfileFromStyleContext, mergeComponentRecipeSets } from "./designSystemProfile.js";

function createStyleContext(overrides?: Partial<ReferenceStyleContext>): ReferenceStyleContext {
  return {
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
    layoutMotifs: ["content rail", "stacked sections"],
    ...overrides
  };
}

describe("buildStyleProfileFromStyleContext", () => {
  it("keeps extracted palette colors without static defaults", () => {
    const context = createStyleContext();
    const result = buildStyleProfileFromStyleContext({
      styleContext: context,
      sourceType: "image-reference"
    });

    const tokenHex = result.styleProfile.tokens.colors.map((token) => token.hex);
    expect(tokenHex).toEqual(
      expect.arrayContaining([
        context.palette.primary,
        context.palette.secondary,
        context.palette.accent,
        context.palette.surface,
        context.palette.text
      ])
    );
    expect(tokenHex).not.toContain("#2665fd");
    expect(tokenHex).not.toContain("#6074b9");
    expect(tokenHex).not.toContain("#bd3800");
  });

  it("computes quality coverage fields", () => {
    const context = createStyleContext();
    const result = buildStyleProfileFromStyleContext({
      styleContext: context,
      sourceType: "figma-reference"
    });

    expect(result.qualityReport.referenceQuality).toMatch(/good|medium|poor/);
    expect(result.qualityReport.detectionCoverage.colorsDetected).toBe(result.styleProfile.tokens.colors.length);
    expect(result.qualityReport.detectionCoverage.componentFamiliesDetected).toBeGreaterThanOrEqual(0);
  });

  it("does not inject legacy color defaults when palette values are invalid", () => {
    const context = createStyleContext({
      palette: {
        primary: "invalid",
        secondary: "still-invalid",
        accent: "#ff7a33",
        surface: "not-a-color",
        text: "#222222"
      }
    });

    const result = buildStyleProfileFromStyleContext({
      styleContext: context,
      sourceType: "manual"
    });

    const tokenHex = result.styleProfile.tokens.colors.map((token) => token.hex);
    expect(tokenHex).toEqual(expect.arrayContaining(["#ff7a33", "#222222"]));
    expect(tokenHex).not.toContain("#2665fd");
    expect(tokenHex).not.toContain("#6074b9");
    expect(tokenHex).not.toContain("#bd3800");
  });

  it("prefers stronger component morphology when merging recipe sets", () => {
    const base = buildStyleProfileFromStyleContext({
      styleContext: createStyleContext(),
      sourceType: "image-reference"
    }).styleProfile;

    const genericRecipes = base.componentRecipes.map((recipe) =>
      recipe.family === "buttons" || recipe.family === "inputs"
        ? {
            ...recipe,
            shape: "rounded" as const,
            cornerRadius: 8,
            controlHeight: 40,
            borderWidth: 1,
            borderStyle: "solid" as const,
            fillStyle: "solid" as const,
            confidence: 0.62,
            evidence: ["generic vision hint"]
          }
        : recipe
    );

    const artifactRecipes = base.componentRecipes.map((recipe) =>
      recipe.family === "buttons"
        ? {
            ...recipe,
            shape: "pill" as const,
            cornerRadius: 999,
            controlHeight: 52,
            borderWidth: 2,
            borderStyle: "solid" as const,
            fillStyle: "mixed" as const,
            confidence: 0.88,
            evidence: ["inline button style", "rebuild artifact css"]
          }
        : recipe.family === "inputs"
          ? {
              ...recipe,
              shape: "rounded" as const,
              cornerRadius: 18,
              controlHeight: 50,
              borderWidth: 2,
              borderStyle: "solid" as const,
              fillStyle: "tint" as const,
              confidence: 0.84,
              evidence: ["inline input style", "rebuild artifact css"]
            }
          : recipe
    );

    const merged = mergeComponentRecipeSets(genericRecipes, artifactRecipes);
    const mergedButton = merged.find((recipe) => recipe.family === "buttons");
    const mergedInput = merged.find((recipe) => recipe.family === "inputs");

    expect(mergedButton?.shape).toBe("pill");
    expect(mergedButton?.cornerRadius).toBe(999);
    expect(mergedButton?.evidence).toEqual(
      expect.arrayContaining(["inline button style", "rebuild artifact css", "generic vision hint"])
    );

    expect(mergedInput?.cornerRadius).toBe(18);
    expect(mergedInput?.fillStyle).toBe("tint");
    expect(mergedInput?.confidence).toBeGreaterThanOrEqual(0.84);
  });
});
