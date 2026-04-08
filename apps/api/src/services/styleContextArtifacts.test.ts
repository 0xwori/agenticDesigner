import { describe, expect, it } from "vitest";
import type { ReferenceStyleContext } from "@designer/shared";
import { deriveStyleContextFromArtifacts } from "./styleContextArtifacts.js";

const baseStyleContext: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#f0672a",
    secondary: "#2f4d68",
    accent: "#f58c57",
    surface: "#f7f4ef",
    text: "#1f2430"
  },
  typography: {
    headingFamily: "Sora, ui-sans-serif, system-ui",
    bodyFamily: "Manrope, ui-sans-serif, system-ui",
    cornerRadius: 14
  },
  spacingScale: [4, 8, 12, 16, 20, 24, 32],
  componentPatterns: ["cards", "status badges"],
  layoutMotifs: ["content-first"]
};

describe("deriveStyleContextFromArtifacts", () => {
  it("prefers named CSS variables for palette extraction when available", () => {
    const result = deriveStyleContextFromArtifacts(baseStyleContext, {
      cssCode: `
        :root {
          --tw-primary: #0f62fe;
          --tw-secondary: #3a4a60;
          --tw-accent: #ff7d4d;
          --tw-surface: #f7fbff;
          --tw-text: #1a2533;
        }
        .screen {
          color: #d23f3f;
          background: #fbf3eb;
          border-radius: 14px;
        }
      `,
      sourceCode: "function Screen(){ return <div className=\"screen\">Hello</div>; }",
      exportHtml: "<div class=\"screen\">Hello</div>"
    });

    expect(result.palette.primary).toBe("#0f62fe");
    expect(result.palette.secondary).toBe("#3a4a60");
    expect(result.palette.accent).toBe("#ff7d4d");
    expect(result.palette.surface).toBe("#f7fbff");
    expect(result.palette.text).toBe("#1a2533");
  });

  it("derives palette, typography, radius, and spacing from built artifacts", () => {
    const result = deriveStyleContextFromArtifacts(baseStyleContext, {
      cssCode: `
        :root {
          --brand: #3d5afe;
          --accent: rgb(255, 119, 89);
          --surface: #f4f8ff;
          --ink: #131a25;
        }
        .screen {
          background: #f4f8ff;
          color: #131a25;
          border-radius: 18px;
          padding: 24px;
          margin: 8px;
          gap: 12px;
          font-family: "Satoshi", "Inter", sans-serif;
        }
        h1 {
          font-family: "Satoshi", sans-serif;
        }
      `,
      sourceCode: `
        function Screen() {
          return <div style={{ color: "hsl(220 44% 28%)" }}>Hello</div>;
        }
      `,
      exportHtml: `<div class="screen"><h1>Heading</h1></div>`
    });

    const paletteValues = [result.palette.primary, result.palette.secondary, result.palette.accent];
    expect(paletteValues).not.toContain(baseStyleContext.palette.primary);
    expect(paletteValues.some((value) => value === "#3d5afe" || value === "#ff7759")).toBe(true);
    expect(result.palette.surface).toMatch(/^#/);
    expect(result.typography.headingFamily.toLowerCase()).toContain("satoshi");
    expect(result.typography.bodyFamily.toLowerCase()).toContain("satoshi");
    expect(result.typography.cornerRadius).toBe(18);
    expect(result.spacingScale.some((value) => value === 8)).toBe(true);
    expect(result.spacingScale.some((value) => value === 24)).toBe(true);
  });

  it("keeps fallback values when artifacts do not expose style signals", () => {
    const result = deriveStyleContextFromArtifacts(baseStyleContext, {
      cssCode: ".root { display: grid; }",
      sourceCode: "function Empty(){ return <div />; }",
      exportHtml: "<div></div>"
    });

    expect(result.palette).toEqual(baseStyleContext.palette);
    expect(result.typography).toEqual(baseStyleContext.typography);
    expect(result.spacingScale).toEqual(baseStyleContext.spacingScale);
  });

  it("infers button and input morphology from class-based references", () => {
    const result = deriveStyleContextFromArtifacts(baseStyleContext, {
      cssCode: `
        .card { border-radius: 20px; box-shadow: 0 10px 24px rgba(0,0,0,0.18); }
      `,
      sourceCode: `
        function Screen() {
          return (
            <div className="card">
              <button className="rounded-full h-12 bg-green-500 text-white border-0 shadow-md">Continue</button>
              <button className="rounded-full h-12 bg-transparent border border-green-500 text-green-600">Skip</button>
              <input className="rounded-xl h-12 border-2 bg-white" />
            </div>
          );
        }
      `,
      exportHtml: "<div></div>"
    });

    const buttonRecipe = result.componentRecipes?.find((recipe) => recipe.family === "buttons");
    const inputRecipe = result.componentRecipes?.find((recipe) => recipe.family === "inputs");
    const cardRecipe = result.componentRecipes?.find((recipe) => recipe.family === "cards");

    expect(buttonRecipe).toBeTruthy();
    expect(buttonRecipe?.shape).toBe("pill");
    expect(buttonRecipe?.controlHeight).toBeGreaterThanOrEqual(44);
    expect(buttonRecipe?.fillStyle).toMatch(/solid|mixed/);

    expect(inputRecipe).toBeTruthy();
    expect(inputRecipe?.shape).toBe("rounded");
    expect(inputRecipe?.fillStyle).toMatch(/outline|solid|tint/);

    expect(cardRecipe).toBeTruthy();
    expect(cardRecipe?.shadowStyle).toBe("soft");
  });

  it("infers morphology from inline JSX style attributes", () => {
    const result = deriveStyleContextFromArtifacts(baseStyleContext, {
      cssCode: "",
      sourceCode: `
        function Screen() {
          return (
            <section>
              <button style={{ borderRadius: "999px", minHeight: 52, border: "0px solid transparent", backgroundColor: "#58cc02" }}>
                Continue
              </button>
              <button style={{ borderRadius: "999px", minHeight: 52, border: "2px solid #58cc02", backgroundColor: "transparent" }}>
                Later
              </button>
              <input style={{ borderRadius: "18px", minHeight: "50px", borderWidth: 2, borderStyle: "solid", backgroundColor: "#f7fdf0" }} />
            </section>
          );
        }
      `,
      exportHtml: "<div></div>"
    });

    const buttonRecipe = result.componentRecipes?.find((recipe) => recipe.family === "buttons");
    const inputRecipe = result.componentRecipes?.find((recipe) => recipe.family === "inputs");

    expect(buttonRecipe?.shape).toBe("pill");
    expect(buttonRecipe?.controlHeight).toBeGreaterThanOrEqual(50);
    expect(buttonRecipe?.fillStyle).toMatch(/mixed|solid|outline/);
    expect(buttonRecipe?.evidence.some((entry) => entry.toLowerCase().includes("inline button"))).toBe(true);

    expect(inputRecipe?.shape).toBe("rounded");
    expect(inputRecipe?.cornerRadius).toBeGreaterThanOrEqual(16);
    expect(inputRecipe?.controlHeight).toBeGreaterThanOrEqual(48);
    expect(inputRecipe?.fillStyle).toMatch(/tint|outline/);
    expect(inputRecipe?.evidence.some((entry) => entry.toLowerCase().includes("inline input"))).toBe(true);
  });
});
