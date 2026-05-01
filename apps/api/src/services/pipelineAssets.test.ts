import { describe, expect, it } from "vitest";
import type { ProjectAsset } from "@designer/shared";
import { pipelineTestHooks } from "./pipeline.js";

const imageAsset: ProjectAsset = {
  id: "asset-image",
  projectId: "project-1",
  kind: "image",
  name: "hero.png",
  mimeType: "image/png",
  size: 1200,
  dataUrl: "data:image/png;base64,abc123",
  textContent: null,
  createdAt: "2026-04-20T00:00:00.000Z",
  updatedAt: "2026-04-20T00:00:00.000Z"
};

describe("pipeline asset context", () => {
  it("builds reusable asset context and materializes asset uris", () => {
    const context = pipelineTestHooks.buildProjectAssetContext([
      imageAsset,
      {
        ...imageAsset,
        id: "asset-doc",
        kind: "document",
        name: "brief.md",
        mimeType: "text/markdown",
        dataUrl: null,
        textContent: "Use a launch narrative."
      }
    ]);

    expect(context).toContain("asset://asset-image");
    expect(context).toContain("Use a launch narrative.");

    const artifacts = pipelineTestHooks.materializeAssetUris(
      {
        frameName: "Asset Frame",
        sourceCode: `<img src="asset://asset-image" />`,
        cssCode: `.hero{background-image:url(asset://asset-image)}`,
        exportHtml: `<img src="asset://asset-image" />`
      },
      [imageAsset]
    );

    expect(artifacts.sourceCode).toContain(imageAsset.dataUrl);
    expect(artifacts.cssCode).toContain(imageAsset.dataUrl);
    expect(artifacts.exportHtml).toContain(imageAsset.dataUrl);
  });

  it("detects visual richness beyond plain text", () => {
    expect(
      pipelineTestHooks.hasVisualRichness({
        frameName: "Plain",
        sourceCode: "<main><h1>Plain text</h1></main>",
        cssCode: "body{color:#111}",
        exportHtml: "<main><h1>Plain text</h1></main>"
      })
    ).toBe(false);

    expect(
      pipelineTestHooks.hasVisualRichness({
        frameName: "Visual",
        sourceCode: "<figure><img src=\"asset://asset-image\" /></figure>",
        cssCode: "@keyframes fade{from{opacity:0}to{opacity:1}}",
        exportHtml: "<figure><img src=\"asset://asset-image\" /></figure>"
      })
    ).toBe(true);
  });
});
