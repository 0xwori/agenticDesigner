import { describe, expect, it } from "vitest";
import {
  parseAttachments,
  parseDeckSlideCount,
  parseSelectedBlockContext,
  parseSelectedFrameContext,
  parseSurfaceTarget
} from "./parsers.js";

describe("http parsers", () => {
  it("rejects more than one image attachment", () => {
    expect(() =>
      parseAttachments([
        { id: "a", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" },
        { id: "b", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }
      ])
    ).toThrow(/Only one image attachment/i);
  });

  it("filters invalid figma-link attachments", () => {
    const parsed = parseAttachments([
      { id: "f-1", type: "figma-link", url: "https://example.com/not-figma" },
      { id: "f-2", type: "figma-link", url: "https://www.figma.com/design/abc/Example?node-id=1-2" }
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.url).toContain("figma.com/design");
  });

  it("parses text attachments for deck source material", () => {
    const parsed = parseAttachments([
      { id: "t-1", type: "text", name: "brief.md", mimeType: "text/markdown", textContent: "# Brief" }
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.textContent).toBe("# Brief");
  });

  it("parses deck surface and slide count defaults", () => {
    expect(parseSurfaceTarget("deck")).toBe("deck");
    expect(parseSurfaceTarget("mobile")).toBe("mobile");
    expect(parseSurfaceTarget("other")).toBe("web");
    expect(parseDeckSlideCount(5)).toBe(5);
    expect(parseDeckSlideCount("25")).toBe(25);
    expect(parseDeckSlideCount(7)).toBe(10);
  });

  it("parses selected frame context only when shape is valid", () => {
    const valid = parseSelectedFrameContext({
      frameId: "frame-1",
      name: "Login Screen",
      devicePreset: "iphone",
      mode: "high-fidelity",
      size: { width: 393, height: 852 },
      latestVersionId: "v-1",
      sourceType: "generated",
      sourceRole: null,
      sourceGroupId: null
    });

    expect(valid?.frameId).toBe("frame-1");

    const invalid = parseSelectedFrameContext({
      frameId: "frame-1",
      mode: "high-fidelity"
    });

    expect(invalid).toBeUndefined();
  });

  it("parses selected block context only when shape is valid", () => {
    const valid = parseSelectedBlockContext({
      frameId: "frame-1",
      versionId: "version-1",
      blockId: "hero",
      label: "Hero",
      selector: "[data-designer-block=\"hero\"]",
      tagName: "section",
      className: "hero",
      textSnippet: "Launch faster",
      outerHtml: "<section data-designer-block=\"hero\">Launch faster</section>",
      rect: { x: 10, y: 20, width: 300, height: 180 }
    });

    expect(valid?.blockId).toBe("hero");

    expect(parseSelectedBlockContext({ frameId: "frame-1" })).toBeUndefined();
  });
});
