import { describe, expect, it } from "vitest";
import type { FrameVersion } from "@designer/shared";
import { buildPreviewDocument, parseDesignSystemCalibrationCommand } from "./appHelpers";

function createVersion(overrides?: Partial<FrameVersion>): FrameVersion {
  return {
    id: "version-1",
    frameId: "frame-1",
    sourceCode: "const App = () => <main>Hello</main>;\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
    cssCode: "body { margin: 0; }",
    exportHtml: "<main>Hello</main>",
    tailwindEnabled: false,
    passOutputs: {},
    diffFromPrevious: {
      addedLines: 1,
      removedLines: 0,
      changedLines: 1
    },
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe("buildPreviewDocument", () => {
  it("renders a fallback document when no version exists", () => {
    const html = buildPreviewDocument("frame-123");
    expect(html).toContain("No content yet.");
  });

  it("embeds frame/version ids for one-time content height reporting", () => {
    const html = buildPreviewDocument("frame-123", createVersion({ id: "version-9" }));
    expect(html).toContain("designer.frame-content-height");
    expect(html).toContain('"frame-123"');
    expect(html).toContain('"version-9"');
  });

  it("escapes style and script closing tags", () => {
    const html = buildPreviewDocument(
      "frame-123",
      createVersion({
        cssCode: "section::after { content: '</style>'; }",
        sourceCode: "console.log('</script>')"
      })
    );

    expect(html).toContain("<\\/style>");
    expect(html).toContain("<\\/script>");
  });
});

describe("parseDesignSystemCalibrationCommand", () => {
  it("parses slash command with update payload", () => {
    const parsed = parseDesignSystemCalibrationCommand(
      "/ds-calibrate buttons.shape=pill inputs.borderWidth=2 navigation.density=compact"
    );

    expect(parsed).toEqual({
      updates: "buttons.shape=pill inputs.borderWidth=2 navigation.density=compact"
    });
  });

  it("supports the design-calibrate alias", () => {
    const parsed = parseDesignSystemCalibrationCommand("/design-calibrate buttons.borderStyle=none");
    expect(parsed).toEqual({ updates: "buttons.borderStyle=none" });
  });

  it("returns null for normal prompts", () => {
    const parsed = parseDesignSystemCalibrationCommand("Create a settings screen in app style");
    expect(parsed).toBeNull();
  });
});
