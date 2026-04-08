import { describe, expect, it } from "vitest";
import { parseAttachments, parseSelectedFrameContext } from "./parsers.js";

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
});
