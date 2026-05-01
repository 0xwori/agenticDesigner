import { describe, expect, it } from "vitest";
import type { ReferenceStyleContext } from "@designer/shared";
import { buildDeckPreviewArtifacts, normalizeDeckSpec } from "./deckArtifacts.js";

const styleContext: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#2563eb",
    secondary: "#64748b",
    accent: "#16a34a",
    background: "#f1f5f9",
    surface: "#ffffff",
    text: "#0f172a"
  },
  typography: {
    headingFamily: "Sora, ui-sans-serif, system-ui",
    bodyFamily: "Manrope, ui-sans-serif, system-ui",
    cornerRadius: 12
  },
  spacingScale: [4, 8, 12, 16, 24, 32],
  componentPatterns: [],
  layoutMotifs: []
};

describe("deck artifacts", () => {
  it("normalizes to the exact requested slide count", () => {
    const deck = normalizeDeckSpec(
      {
        title: "Launch Plan",
        slides: [
          { id: "intro", blockId: "intro", title: "Intro", body: ["One"], layout: "title" }
        ]
      },
      { prompt: "Create a launch deck", slideCount: 5, styleContext }
    );

    expect(deck.slides).toHaveLength(5);
    expect(deck.slides[0]?.blockId).toBe("intro");
    expect(deck.theme.background).toBe("#f1f5f9");
    expect(deck.slides[0]?.visual.type).not.toBe("none");
    expect(deck.slides[0]?.visual.type).toBe("illustration");
    expect(deck.slides[4]?.layout).toBe("closing");
  });

  it("builds annotated preview artifacts", () => {
    const deck = normalizeDeckSpec({ title: "Board Update" }, { prompt: "Board update", slideCount: 10, styleContext });
    const artifacts = buildDeckPreviewArtifacts(deck);

    expect(artifacts.exportHtml).toContain('data-designer-block="deck"');
    expect(artifacts.exportHtml).toContain("deck-slide");
    expect(artifacts.exportHtml).toContain("deck-visual");
    expect(artifacts.exportHtml).toContain("data-visual-artifact=");
    expect(artifacts.exportHtml).toContain("deck-illustration-svg");
    expect(artifacts.sourceCode).toContain("ReactDOM.createRoot");
    expect(artifacts.sourceCode).toContain("VisualArtifact");
    expect(artifacts.cssCode).toContain("aspect-ratio: 16 / 9");
    expect(artifacts.cssCode).toContain("@keyframes deck-float");
    expect(artifacts.cssCode).toContain("prefers-reduced-motion");
  });
});
