import { describe, expect, it } from "vitest";
import { buildDeckPptx } from "./deckPptx.js";
import type { DeckSpec } from "./deckArtifacts.js";

const deck: DeckSpec = {
  specVersion: 1,
  title: "Export Test",
  theme: {
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    mutedText: "#64748b",
    primary: "#2563eb",
    secondary: "#64748b",
    accent: "#16a34a",
    headingFont: "Aptos Display",
    bodyFont: "Aptos"
  },
  slides: [
    {
      id: "slide-1",
      blockId: "slide-1",
      title: "Opening",
      eyebrow: "Intro",
      subtitle: "Editable deck",
      body: ["First point", "Second point"],
      callout: "Ship it",
      speakerNotes: "Speaker note",
      layout: "title",
      visual: {
        type: "diagram",
        title: "Flow",
        items: ["Plan", "Build", "Launch"],
        assetId: "",
        caption: ""
      }
    }
  ]
};

describe("deck pptx export", () => {
  it("builds a PPTX zip package with presentation parts", () => {
    const pptx = buildDeckPptx(deck);

    expect(pptx.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(pptx.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
    expect(pptx.includes(Buffer.from("ppt/slides/slide1.xml"))).toBe(true);
    expect(pptx.includes(Buffer.from("Visual Canvas"))).toBe(true);
    expect(pptx.includes(Buffer.from("Diagram Center"))).toBe(true);
  });
});
