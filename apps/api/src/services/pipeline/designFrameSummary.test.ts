import { describe, expect, it } from "vitest";

import type { FrameWithVersions } from "@designer/shared";

import { buildDesignFrameSummary } from "./designFrameSummary.js";

function makeFrame(exportHtml: string, sourceCode = ""): FrameWithVersions {
  return {
    id: "frame-1",
    projectId: "project-1",
    name: "Checkout",
    devicePreset: "desktop",
    mode: "high-fidelity",
    selected: false,
    position: { x: 0, y: 0 },
    size: { width: 1240, height: 880 },
    currentVersionId: "version-1",
    status: "ready",
    frameKind: "design",
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    versions: [
      {
        id: "version-1",
        frameId: "frame-1",
        sourceCode,
        cssCode: "",
        exportHtml,
        tailwindEnabled: false,
        passOutputs: {},
        diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 },
        createdAt: "2026-04-12T00:00:00.000Z",
      },
    ],
  };
}

describe("buildDesignFrameSummary", () => {
  it("extracts semantic screen structure from HTML", () => {
    const summary = buildDesignFrameSummary(
      makeFrame(
        `
          <main>
            <header><h1>Sign in</h1><p>Welcome back to Acme</p></header>
            <form>
              <input placeholder="Email address" />
              <input placeholder="Password" />
              <button>Continue</button>
            </form>
            <aside>Need help?</aside>
          </main>
        `,
        "fetch('/api/session') // auth",
      ),
    );

    expect(summary).toContain("Visible content");
    expect(summary).toContain("Headings: Sign in");
    expect(summary).toContain("Actions: Continue");
    expect(summary).toContain("Fields: Email address, Password");
    expect(summary).toContain("Layout: form flow");
    expect(summary).toContain("Contains auth or session-related UI");
    expect(summary).toContain("Includes API or data-fetching logic");
  });

  it("detects loading and validation states", () => {
    const summary = buildDesignFrameSummary(
      makeFrame(
        `
          <section>
            <h2>Processing payment</h2>
            <p>Loading your confirmation</p>
            <button>Try again</button>
            <p>Payment failed. Please retry.</p>
          </section>
        `,
      ),
    );

    expect(summary).toContain("Shows loading or async processing states");
    expect(summary).toContain("Shows error, retry, or validation handling");
  });
});