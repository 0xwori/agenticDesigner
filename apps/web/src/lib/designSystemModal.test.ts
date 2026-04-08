import { describe, expect, it } from "vitest";
import type { ProjectDesignSystem } from "@designer/shared";
import { getDesignSystemVisualSections, runSequentialQueue } from "./designSystemModal";

describe("designSystemModal helpers", () => {
  it("reads visual sections directly from visualBoard tokens", () => {
    const designSystem = {
      projectId: "project-1",
      markdown: "## Overview",
      structuredTokens: {
        overview: "Overview",
        colors: [],
        typography: {
          headlineFont: "Sora",
          bodyFont: "Manrope",
          labelFont: "Manrope",
          notes: []
        },
        elevation: "",
        components: [],
        dos: [],
        donts: [],
        styleProfile: {
          sourceType: "manual",
          foundations: {
            toneKeywords: [],
            density: "comfortable",
            contrast: "medium"
          },
          tokens: {
            colors: [],
            typography: {
              headlineFont: "Sora",
              bodyFont: "Manrope",
              labelFont: "Manrope",
              notes: []
            },
            spacingScale: [4, 8, 12, 16, 24, 32],
            radiusScale: [8, 12, 16],
            borderWidths: [1, 2],
            shadows: ["none", "soft"],
            opacityScale: [0.5, 1]
          },
          componentRecipes: [],
          extractionEvidence: []
        },
        qualityReport: {
          fidelityScore: 0.8,
          globalConfidence: 0.8,
          status: "high",
          referenceQuality: "good",
          detectionCoverage: {
            colorsDetected: 0,
            componentFamiliesDetected: 0
          },
          qualityReasons: [],
          familyConfidence: [],
          recommendations: []
        },
        visualBoard: {
          version: 1,
          sections: [
            {
              id: "brand-foundations",
              label: "Brand Foundations",
              required: true,
              blocks: [
                {
                  kind: "chips",
                  items: [{ label: "Clear" }]
                }
              ]
            },
            {
              id: "color-system",
              label: "Color System",
              required: true,
              blocks: [
                {
                  kind: "swatches",
                  items: [{ label: "Primary", hex: "#2563eb" }]
                }
              ]
            }
          ]
        }
      },
      status: "draft",
      sourceType: "manual",
      sourceReferenceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } satisfies ProjectDesignSystem;

    const sections = getDesignSystemVisualSections(designSystem);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.id).toBe("brand-foundations");
    expect(sections[1]?.id).toBe("color-system");
  });

  it("processes batch items sequentially", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await runSequentialQueue([1, 2, 3], async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start-${item}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${item}`);
      inFlight -= 1;
      return item !== 2;
    });

    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
    expect(result).toEqual({
      total: 3,
      successful: 2,
      failed: 1
    });
  });
});
