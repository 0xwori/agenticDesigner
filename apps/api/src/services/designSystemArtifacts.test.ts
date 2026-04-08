import { describe, expect, it } from "vitest";
import type { ComponentRecipe, ReferenceStyleContext } from "@designer/shared";
import { buildStyleProfileFromStyleContext } from "./designSystemProfile.js";
import { buildDesignSystemComponentsArtifacts } from "./designSystemArtifacts.js";

const componentRecipes: ComponentRecipe[] = [
  {
    family: "buttons",
    shape: "pill",
    cornerRadius: 999,
    borderWidth: 2,
    borderStyle: "solid",
    shadowStyle: "none",
    density: "comfortable",
    controlHeight: 52,
    fillStyle: "outline",
    iconStyle: "outlined",
    spacing: 8,
    states: [
      { name: "default", emphasis: "high" },
      { name: "hover", emphasis: "medium" },
      { name: "disabled", emphasis: "low" }
    ],
    evidence: ["reference button morphology"],
    confidence: 0.9
  },
  {
    family: "inputs",
    shape: "rounded",
    cornerRadius: 18,
    borderWidth: 2,
    borderStyle: "solid",
    shadowStyle: "none",
    density: "comfortable",
    controlHeight: 50,
    fillStyle: "tint",
    iconStyle: "outlined",
    spacing: 8,
    states: [
      { name: "default", emphasis: "high" },
      { name: "focus", emphasis: "high" },
      { name: "error", emphasis: "high" }
    ],
    evidence: ["reference input morphology"],
    confidence: 0.88
  }
] as ComponentRecipe[];

const styleContext: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#58cc02",
    secondary: "#1cb0f6",
    accent: "#ffc800",
    surface: "#f7fdf0",
    text: "#1f2937"
  },
  typography: {
    headingFamily: "Nunito, ui-sans-serif, system-ui",
    bodyFamily: "Nunito, ui-sans-serif, system-ui",
    cornerRadius: 16
  },
  spacingScale: [4, 8, 12, 16, 20, 24, 32],
  componentPatterns: ["pill controls", "thick borders"],
  layoutMotifs: ["stacked cards"],
  componentRecipes
};

describe("buildDesignSystemComponentsArtifacts", () => {
  it("renders visual board sections without explanatory prose", () => {
    const profileBundle = buildStyleProfileFromStyleContext({
      styleContext,
      sourceType: "image-reference",
      componentRecipes,
      explicitQualityScore: 0.88
    });

    const artifacts = buildDesignSystemComponentsArtifacts({
      styleContext,
      frameName: "Reference DS",
      scope: "frame",
      styleProfile: profileBundle.styleProfile,
      qualityReport: profileBundle.qualityReport,
      sourceLabel: "Image Reference",
      sourceDescription: "duolingo-like reference"
    });

    expect(artifacts.cssCode).toContain("--ds-primary: #58cc02;");
    expect(artifacts.cssCode).toContain("--ds-text: #1f2937;");
    expect(artifacts.cssCode).toContain(".ds-swatch-grid");
    expect(artifacts.cssCode).toContain(".ds-component-pill.is-active");

    expect(artifacts.exportHtml).toContain('data-section-id="brand-foundations"');
    expect(artifacts.exportHtml).toContain('data-section-id="color-system"');
    expect(artifacts.exportHtml).toContain('data-section-id="typography-system"');
    expect(artifacts.exportHtml).toContain('data-section-id="spacing-layout"');
    expect(artifacts.exportHtml).toContain('data-section-id="shape-visual-rules"');
    expect(artifacts.exportHtml).toContain('data-section-id="core-components"');
    expect(artifacts.exportHtml).toContain('data-section-id="navigation"');
    expect(artifacts.exportHtml).toContain('class="ds-component-pill');
    expect(artifacts.exportHtml).not.toContain("evidence:");
    expect(artifacts.exportHtml).not.toContain("confidence");

    expect(artifacts.sourceCode).toContain('data-section-id="color-system"');
    expect(artifacts.sourceCode).toContain('className="ds-swatch-grid"');
  });
});
