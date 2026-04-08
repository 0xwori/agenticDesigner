import { describe, expect, it } from "vitest";
import type { ReferenceStyleContext } from "@designer/shared";
import {
  validateArtifactsForDevice,
  validateDesignSystemAdherence,
  type FrameArtifacts
} from "./validators.js";

const styleContext: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#2266ff",
    secondary: "#5a6a82",
    accent: "#30b68a",
    surface: "#f7f8fb",
    text: "#1b2230"
  },
  typography: {
    headingFamily: "Sora, ui-sans-serif, system-ui",
    bodyFamily: "Manrope, ui-sans-serif, system-ui",
    cornerRadius: 14
  },
  spacingScale: [4, 8, 12, 16, 20, 24],
  componentPatterns: ["soft cards"],
  layoutMotifs: ["guided column"]
};

function baseArtifacts(overrides?: Partial<FrameArtifacts>): FrameArtifacts {
  return {
    frameName: "Mobile Onboarding",
    sourceCode: `
      function GeneratedScreen(){
        return (
          <div className="tw-screen tw-onboarding-shell">
            <header>Step 1</header>
            <button style={{ minHeight: "44px" }}>Continue</button>
            <button>Marketing landing page</button>
          </div>
        );
      }
      ReactDOM.createRoot(document.getElementById("root")).render(<GeneratedScreen />);
    `,
    cssCode: `
      .tw-screen {
        min-height: 820px;
        padding: 14px;
        padding-top: calc(20px + env(safe-area-inset-top));
        padding-bottom: calc(18px + env(safe-area-inset-bottom));
      }
    `,
    exportHtml: `<div class="tw-screen tw-onboarding-shell"><header>Step 1</header><button>Continue</button></div>`,
    ...overrides
  };
}

describe("pipeline validators", () => {
  it("accepts app-like iPhone screens even when copy mentions marketing text", () => {
    const result = validateArtifactsForDevice(baseArtifacts(), {
      devicePreset: "iphone",
      mode: "high-fidelity"
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects true marketing hero patterns in iPhone mode", () => {
    const result = validateArtifactsForDevice(
      baseArtifacts({
        sourceCode: `
          function GeneratedScreen(){
            return <section className="tw-landing-hero">Pricing waitlist conversion</section>;
          }
          ReactDOM.createRoot(document.getElementById("root")).render(<GeneratedScreen />);
        `,
        cssCode: `.tw-landing-hero { min-height: 820px; padding-top: calc(20px + env(safe-area-inset-top)); }`,
        exportHtml: `<section class="tw-landing-hero">Pricing waitlist conversion</section>`
      }),
      {
        devicePreset: "iphone",
        mode: "high-fidelity"
      }
    );

    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toContain("desktop/marketing hero");
  });

  it("enforces strict design-system checks but allows one miss", () => {
    const result = validateDesignSystemAdherence(
      baseArtifacts({
        cssCode: `:root{--tw-primary:${styleContext.palette.primary};--tw-radius:${styleContext.typography.cornerRadius}px}`,
        sourceCode: `
          function GeneratedScreen(){
            return <div style={{ fontFamily: "${styleContext.typography.bodyFamily}" }}>Test</div>;
          }
          ReactDOM.createRoot(document.getElementById("root")).render(<GeneratedScreen />);
        `
      }),
      styleContext,
      "strict"
    );

    expect(result.valid).toBe(true);
  });
});
