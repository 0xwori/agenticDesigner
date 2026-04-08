import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DesignSystemChecklist, ReferenceStyleContext } from "@designer/shared";
import {
  buildDesignSystemChecklistFromStyleContext,
  parseFigmaLink,
  syncStyleContextFromFigmaLink
} from "./figmaReference.js";

type ToolContentItem =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "resource";
      resource: {
        text?: string;
      };
    }
  | {
      type: "resource_link";
      name?: string;
      uri?: string;
      mimeType?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type ToolResultLike = {
  content?: ToolContentItem[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ReferenceScreenArtifacts = {
  frameName: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
  tailwindEnabled: boolean;
  passOutputs: Record<string, unknown>;
};

export type SyncedMcpReference = {
  parsed: ReturnType<typeof parseFigmaLink>;
  styleContext: ReferenceStyleContext;
  designSystemChecklist: DesignSystemChecklist;
  referenceScreen: ReferenceScreenArtifacts;
};

export type FigmaFallbackReason = "missing-token" | "quota" | "auth" | "transport" | "unknown";

const FIGMA_MCP_URL = process.env.FIGMA_MCP_URL ?? "https://mcp.figma.com/mcp";
const FIGMA_REGION = process.env.FIGMA_REGION ?? "us-east-1";
const MCP_CLIENT_NAME = "agenticdesigner-api";
const MCP_CLIENT_VERSION = "0.1.0";

function ensureRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHex(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }

  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
  }

  if (/^#[0-9a-f]{8}$/.test(raw)) {
    return raw.slice(0, 7);
  }

  return null;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function hexLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }

  const srgb = [rgb.r, rgb.g, rgb.b].map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function hexSaturation(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }

  const red = rgb.r / 255;
  const green = rgb.g / 255;
  const blue = rgb.b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === 0) {
    return 0;
  }
  return (max - min) / max;
}

function pickFirstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(payload[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickFirstRecord(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = ensureRecord(payload[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseJsonCandidate(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    return ensureRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function extractJsonFromMarkdown(text: string): Record<string, unknown> | null {
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/i);
  if (!jsonFence?.[1]) {
    return null;
  }

  return parseJsonCandidate(jsonFence[1]);
}

function extractAllTextBlocks(result: ToolResultLike): string[] {
  const blocks: string[] = [];
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0) {
      blocks.push(item.text.trim());
      continue;
    }

    if (item.type === "resource") {
      const resource = (item as { resource?: { text?: unknown } }).resource;
      const text = asString(resource?.text);
      if (text) {
        blocks.push(text);
      }
    }
  }

  return blocks;
}

function extractCodeFence(text: string): string | null {
  const matches = [...text.matchAll(/```([a-zA-Z0-9_+-]*)\s*([\s\S]*?)```/g)];
  if (matches.length === 0) {
    return null;
  }

  const preferred =
    matches.find((match) => /^(tsx|jsx|typescript|javascript|react|html)$/i.test(match[1] ?? "")) ??
    matches.sort((left, right) => (right[2]?.length ?? 0) - (left[2]?.length ?? 0))[0];

  return preferred?.[2]?.trim() ?? null;
}

function detectComponentName(sourceCode: string): string | null {
  const candidates = [
    ...sourceCode.matchAll(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g),
    ...sourceCode.matchAll(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)\s*=>|function\s*\()/g),
    ...sourceCode.matchAll(/class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+React\.Component/g)
  ];

  if (candidates.length === 0) {
    return null;
  }

  return candidates[candidates.length - 1]?.[1] ?? null;
}

function sanitizeDesignSource(rawCode: string): string {
  let source = rawCode.trim();
  source = source.replace(/^```[a-zA-Z0-9_+-]*\s*/i, "");
  source = source.replace(/```\s*$/i, "");

  source = source
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(function|const|class)\s+/gm, "$1 ")
    .replace(/^\s*export\s+\{[^}]+\};?\s*$/gm, "")
    .trim();

  if (!/ReactDOM\.(?:createRoot|render)\s*\(/.test(source)) {
    const componentName = detectComponentName(source);
    if (componentName) {
      source = `${source}\n\nReactDOM.createRoot(document.getElementById("root")).render(<${componentName} />);`;
    } else {
      const looksLikeHtmlMarkup =
        /<!doctype html>/i.test(source) || /<html[\s>]/i.test(source) || /<body[\s>]/i.test(source) || /<div[\s>]/i.test(source);
      if (looksLikeHtmlMarkup) {
        source = `function FigmaReferenceRoot() {\n  return <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(source)} }} />;\n}\n\nReactDOM.createRoot(document.getElementById("root")).render(<FigmaReferenceRoot />);`;
      } else {
        source = `${source}\n\nfunction FigmaReferenceRoot() {\n  return (\n    <div style={{ padding: 20, fontFamily: \"ui-sans-serif,system-ui\" }}>\n      Figma code imported, but no mountable React component was detected.\n    </div>\n  );\n}\n\nReactDOM.createRoot(document.getElementById("root")).render(<FigmaReferenceRoot />);`;
      }
    }
  }

  return source;
}

function extractPaletteFromText(input: string): string[] {
  const matches = input.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  const seen = new Set<string>();
  const palette: string[] = [];
  for (const match of matches) {
    const normalized = normalizeHex(match);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    palette.push(normalized);
  }
  return palette;
}

function extractFontFamilyFromText(input: string): string | null {
  const cssMatch = input.match(/font-family\s*:\s*([^;\n]+)/i);
  if (cssMatch?.[1]) {
    const family = cssMatch[1].trim().replace(/["']/g, "");
    if (family.length > 0) {
      return family;
    }
  }

  const tokenMatch = input.match(/(?:font|type|heading|body)[^\n:]*:\s*([A-Za-z][A-Za-z0-9\s,\-]+)/i);
  if (tokenMatch?.[1]) {
    const family = tokenMatch[1].trim();
    return family.length > 0 ? family : null;
  }

  return null;
}

function derivePalette(colors: string[], fallback: ReferenceStyleContext["palette"]) {
  if (colors.length === 0) {
    return fallback;
  }

  const palettePool = [...new Set(colors)];
  const bySaturation = [...palettePool].sort((left, right) => hexSaturation(right) - hexSaturation(left));
  const byLuminance = [...palettePool].sort((left, right) => hexLuminance(left) - hexLuminance(right));

  const primary =
    bySaturation.find((hex) => hexLuminance(hex) > 0.14 && hexLuminance(hex) < 0.78) ?? fallback.primary;
  const accent =
    bySaturation.find((hex) => hex !== primary && hexLuminance(hex) > 0.2 && hexLuminance(hex) < 0.9) ??
    fallback.accent;
  const secondary =
    palettePool.find((hex) => hex !== primary && hex !== accent && hexLuminance(hex) > 0.1 && hexLuminance(hex) < 0.7) ??
    fallback.secondary;
  const surface =
    [...byLuminance]
      .reverse()
      .find((hex) => hex !== primary && hex !== accent && hexLuminance(hex) > 0.82) ?? fallback.surface;
  const text = byLuminance.find((hex) => hex !== surface && hexLuminance(hex) < 0.24) ?? fallback.text;

  return {
    primary,
    secondary,
    accent,
    surface,
    text
  };
}

function deriveStyleContext(input: {
  fallback: ReferenceStyleContext;
  variableText: string;
  designCodeText: string;
}): ReferenceStyleContext {
  const combined = `${input.variableText}\n\n${input.designCodeText}`;
  const colors = extractPaletteFromText(combined);
  const palette = derivePalette(colors, input.fallback.palette);

  const headingFamily =
    extractFontFamilyFromText(input.variableText) ??
    extractFontFamilyFromText(input.designCodeText) ??
    input.fallback.typography.headingFamily;

  const bodyFamily = extractFontFamilyFromText(input.designCodeText) ?? input.fallback.typography.bodyFamily;

  return {
    ...input.fallback,
    source: "figma-public-link",
    palette,
    typography: {
      ...input.fallback.typography,
      headingFamily,
      bodyFamily
    }
  };
}

function buildBaseCss(styleContext: ReferenceStyleContext) {
  return [
    "* { box-sizing: border-box; }",
    "html, body, #root { min-height: 100%; }",
    "body {",
    "  margin: 0;",
    `  background: ${styleContext.palette.surface};`,
    `  color: ${styleContext.palette.text};`,
    `  font-family: ${styleContext.typography.bodyFamily};`,
    "}"
  ].join("\n");
}

function buildFallbackExportHtml(frameName: string) {
  return `<div class=\"mcp-reference-fallback\"><h1>${frameName}</h1><p>Figma MCP source is rendered in the frame runtime.</p></div>`;
}

function inferTailwindUsage(text: string): boolean {
  return /className\s*=\s*[{"'][^\n]*(?:\bp-\d\b|\bpx-\d\b|\bpy-\d\b|\btext-[a-z]|\bbg-[a-z]|\brounded\b|\bgrid\b|\bflex\b)/i.test(
    text
  );
}

function extractToolPayload(result: ToolResultLike): {
  code: string;
  cssCode: string;
  exportHtml: string;
  assets: Record<string, unknown> | null;
  textSummary: string;
} {
  const structured = ensureRecord(result.structuredContent);
  const textBlocks = extractAllTextBlocks(result);
  const combinedText = textBlocks.join("\n\n");

  const structuredCode = structured
    ? pickFirstString(structured, ["code", "tsx", "jsx", "reactCode", "sourceCode", "componentCode"])
    : null;
  const structuredCss = structured
    ? pickFirstString(structured, ["css", "cssCode", "styles", "stylesheet"])
    : null;
  const structuredHtml = structured
    ? pickFirstString(structured, ["html", "exportHtml", "markup"])
    : null;
  const structuredAssets = structured
    ? pickFirstRecord(structured, ["assets", "downloadUrls", "assetUrls", "images"])
    : null;

  let parsedJson = structured;
  if (!parsedJson) {
    for (const block of textBlocks) {
      parsedJson = parseJsonCandidate(block) ?? extractJsonFromMarkdown(block);
      if (parsedJson) {
        break;
      }
    }
  }

  const jsonCode = parsedJson
    ? pickFirstString(parsedJson, ["code", "tsx", "jsx", "reactCode", "sourceCode", "componentCode"])
    : null;
  const jsonCss = parsedJson ? pickFirstString(parsedJson, ["css", "cssCode", "styles", "stylesheet"]) : null;
  const jsonHtml = parsedJson ? pickFirstString(parsedJson, ["html", "exportHtml", "markup"]) : null;
  const jsonAssets = parsedJson ? pickFirstRecord(parsedJson, ["assets", "downloadUrls", "assetUrls", "images"]) : null;

  const fencedCode = extractCodeFence(combinedText);
  const rawCode = structuredCode ?? jsonCode ?? fencedCode ?? asString(combinedText) ?? "";

  if (rawCode.length === 0) {
    throw new Error(
      combinedText.length > 0
        ? `Figma MCP did not return buildable code. Response: ${combinedText}`
        : "Figma MCP did not return buildable code."
    );
  }

  const looksLikeCode = /ReactDOM\.|className\s*=|function\s+[A-Z]|const\s+[A-Z].*=>|return\s*\(|<[A-Za-z]/.test(
    rawCode
  );
  if (
    !looksLikeCode &&
    combinedText.length > 0 &&
    /(tool call limit|upgrade|unauthorized|permission|private|forbidden|failed|error)/i.test(combinedText)
  ) {
    throw new Error(combinedText);
  }

  return {
    code: rawCode,
    cssCode: structuredCss ?? jsonCss ?? "",
    exportHtml: structuredHtml ?? jsonHtml ?? "",
    assets: structuredAssets ?? jsonAssets,
    textSummary: combinedText
  };
}

async function runMcpTool(toolName: string, args: Record<string, unknown>): Promise<ToolResultLike> {
  const token = process.env.FIGMA_OAUTH_TOKEN;
  if (!token || token.trim().length === 0) {
    throw new Error(
      "FIGMA_OAUTH_TOKEN is not set on the API. Add FIGMA_OAUTH_TOKEN to your environment so attach can call Figma MCP get_design_context."
    );
  }

  const client = new Client(
    {
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION
    },
    {
      capabilities: {}
    }
  );

  const transport = new StreamableHTTPClientTransport(new URL(FIGMA_MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Figma-Region": FIGMA_REGION
      }
    }
  });

  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: toolName,
      arguments: args
    })) as ToolResultLike;

    if (result.isError) {
      const message = extractAllTextBlocks(result).join("\n\n") || `Figma MCP tool ${toolName} failed.`;
      throw new Error(message);
    }

    return result;
  } finally {
    await transport.close().catch(() => {
      // Best effort cleanup.
    });
  }
}

function buildReferenceFrameName(nodeId: string) {
  return `Figma Frame ${nodeId}`;
}

export function classifyMcpFailure(error: unknown): FigmaFallbackReason {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("figma_oauth_token is not set")) {
    return "missing-token";
  }
  if (normalized.includes("tool call limit") || normalized.includes("upgrade your seat")) {
    return "quota";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("permission") ||
    normalized.includes("access denied")
  ) {
    return "auth";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("transport") ||
    normalized.includes("failed to fetch")
  ) {
    return "transport";
  }
  return "unknown";
}

export function buildPublicLinkFallbackReferenceScreen(input: {
  fileKey: string;
  nodeId: string | null;
  scope: "frame" | "page";
  styleContext: ReferenceStyleContext;
  fallbackReason: string;
  usedClientCredentials: boolean;
}): ReferenceScreenArtifacts {
  const frameName = input.nodeId ? `Figma Frame ${input.nodeId}` : `Figma ${input.scope === "page" ? "Page" : "Frame"}`;

  const exportHtml = `
    <div class="fg-fallback">
      <header class="fg-fallback__header">
        <p class="fg-fallback__kicker">Figma Link Fallback</p>
        <h1>${frameName}</h1>
        <p>MCP design context was unavailable, so this frame was rebuilt from public-link style analysis for file ${input.fileKey}.</p>
      </header>
      <section class="fg-fallback__grid">
        <article>
          <h2>Reference Scope</h2>
          <p>${input.scope.toUpperCase()} ${input.nodeId ? `(${input.nodeId})` : ""}</p>
        </article>
        <article>
          <h2>Recovered Style</h2>
          <p>Primary ${input.styleContext.palette.primary} · Accent ${input.styleContext.palette.accent}</p>
        </article>
        <article>
          <h2>Fallback Notes</h2>
          <p>${input.fallbackReason}</p>
        </article>
      </section>
      <footer>
        <span>${input.usedClientCredentials ? "Client credentials provided." : "No client credentials provided."}</span>
      </footer>
    </div>
  `.trim();

  const cssCode = `
    :root {
      --fg-primary: ${input.styleContext.palette.primary};
      --fg-secondary: ${input.styleContext.palette.secondary};
      --fg-accent: ${input.styleContext.palette.accent};
      --fg-surface: ${input.styleContext.palette.surface};
      --fg-text: ${input.styleContext.palette.text};
      --fg-radius: ${input.styleContext.typography.cornerRadius}px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 16px;
      min-height: 100vh;
      background: color-mix(in srgb, var(--fg-surface) 90%, white);
      color: var(--fg-text);
      font-family: ${input.styleContext.typography.bodyFamily};
    }

    .fg-fallback {
      min-height: 100%;
      border: 1px solid color-mix(in srgb, var(--fg-secondary) 16%, white);
      border-radius: calc(var(--fg-radius) + 8px);
      background: linear-gradient(180deg, #fff 0%, color-mix(in srgb, var(--fg-surface) 88%, white) 100%);
      box-shadow: 0 14px 32px rgba(16, 22, 36, 0.08);
      padding: 16px;
      display: grid;
      gap: 12px;
      align-content: start;
    }

    .fg-fallback__kicker {
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      font-size: 11px;
      color: var(--fg-primary);
    }

    .fg-fallback__header h1 {
      margin: 4px 0;
      font-family: ${input.styleContext.typography.headingFamily};
      font-size: 30px;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .fg-fallback__header p {
      margin: 0;
      font-size: 13px;
      color: color-mix(in srgb, var(--fg-text) 76%, white);
    }

    .fg-fallback__grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .fg-fallback__grid article {
      border: 1px solid color-mix(in srgb, var(--fg-secondary) 14%, white);
      border-radius: var(--fg-radius);
      padding: 10px;
      background: rgba(255, 255, 255, 0.9);
    }

    .fg-fallback__grid h2 {
      margin: 0 0 6px;
      font-size: 14px;
      font-family: ${input.styleContext.typography.headingFamily};
    }

    .fg-fallback__grid p {
      margin: 0;
      font-size: 12px;
    }

    .fg-fallback footer {
      font-size: 11px;
      color: color-mix(in srgb, var(--fg-text) 72%, white);
    }
  `.trim();

  const sourceCode = `
    function FigmaPublicLinkFallbackFrame() {
      return (
        <div className="fg-fallback">
          <header className="fg-fallback__header">
            <p className="fg-fallback__kicker">Figma Link Fallback</p>
            <h1>${JSON.stringify(frameName)}</h1>
            <p>${JSON.stringify(
              `MCP design context was unavailable, so this frame was rebuilt from public-link style analysis for file ${input.fileKey}.`
            )}</p>
          </header>
          <section className="fg-fallback__grid">
            <article>
              <h2>Reference Scope</h2>
              <p>${JSON.stringify(`${input.scope.toUpperCase()} ${input.nodeId ? `(${input.nodeId})` : ""}`)}</p>
            </article>
            <article>
              <h2>Recovered Style</h2>
              <p>${JSON.stringify(
                `Primary ${input.styleContext.palette.primary} · Accent ${input.styleContext.palette.accent}`
              )}</p>
            </article>
            <article>
              <h2>Fallback Notes</h2>
              <p>${JSON.stringify(input.fallbackReason)}</p>
            </article>
          </section>
          <footer>
            <span>${JSON.stringify(
              input.usedClientCredentials ? "Client credentials provided." : "No client credentials provided."
            )}</span>
          </footer>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<FigmaPublicLinkFallbackFrame />);
  `.trim();

  return {
    frameName,
    sourceCode,
    cssCode,
    exportHtml,
    tailwindEnabled: false,
    passOutputs: {
      pass: "reference-bootstrap-screen",
      source: "public-link-fallback",
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      scope: input.scope,
      fallbackReason: input.fallbackReason,
      usedClientCredentials: input.usedClientCredentials
    }
  };
}

export async function syncReferenceViaMcp(figmaUrl: string): Promise<SyncedMcpReference> {
  const parsed = parseFigmaLink(figmaUrl);
  if (!parsed.nodeId) {
    throw new Error(
      "Attach requires a frame link with node-id. Use a Figma URL that includes ?node-id=... so the page can be rebuilt exactly."
    );
  }

  const fallbackStyleContext = await syncStyleContextFromFigmaLink(figmaUrl)
    .then((result) => result.styleContext)
    .catch(() => {
      const seed = `${parsed.fileKey}:${parsed.nodeId}`;
      const hueSeed = seed
        .split("")
        .reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const hue = hueSeed % 360;

      return {
        source: "heuristic",
        palette: {
          primary: `hsl(${hue} 70% 46%)`,
          secondary: "#445268",
          accent: `hsl(${(hue + 24) % 360} 80% 58%)`,
          surface: "#f5f6f8",
          text: "#1d2433"
        },
        typography: {
          headingFamily: "Sora, ui-sans-serif, system-ui",
          bodyFamily: "Inter, ui-sans-serif, system-ui",
          cornerRadius: 14
        },
        spacingScale: [4, 8, 12, 16, 20, 24, 32],
        componentPatterns: ["clean cards", "quiet emphasis", "compact control rows"],
        layoutMotifs: ["balanced vertical rhythm", "content-first grouping", "clear action hierarchy"]
      } as ReferenceStyleContext;
    });

  const designContextResult = await runMcpTool("get_design_context", {
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
    clientFrameworks: "react",
    clientLanguages: "typescript,css"
  });

  const designPayload = extractToolPayload(designContextResult);

  const variableDefsResult = await runMcpTool("get_variable_defs", {
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
    clientFrameworks: "react",
    clientLanguages: "typescript,css"
  }).catch(() => null);

  const variableText = variableDefsResult ? extractAllTextBlocks(variableDefsResult).join("\n\n") : "";

  const styleContext = deriveStyleContext({
    fallback: fallbackStyleContext,
    variableText,
    designCodeText: `${designPayload.code}\n\n${designPayload.cssCode}\n\n${designPayload.textSummary}`
  });

  const frameName = buildReferenceFrameName(parsed.nodeId);
  const sourceCode = sanitizeDesignSource(designPayload.code);
  const cssCode = `${buildBaseCss(styleContext)}\n\n${designPayload.cssCode}`.trim();
  const exportHtml =
    designPayload.exportHtml.trim().length > 0 ? designPayload.exportHtml : buildFallbackExportHtml(frameName);
  const tailwindEnabled = inferTailwindUsage(sourceCode) || inferTailwindUsage(designPayload.textSummary);

  return {
    parsed,
    styleContext,
    designSystemChecklist: buildDesignSystemChecklistFromStyleContext(styleContext),
    referenceScreen: {
      frameName,
      sourceCode,
      cssCode,
      exportHtml,
      tailwindEnabled,
      passOutputs: {
        pass: "reference-bootstrap-screen",
        source: "figma-mcp-get_design_context",
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        scope: parsed.scope,
        mcpUrl: FIGMA_MCP_URL,
        hasVariableDefs: Boolean(variableDefsResult),
        hasStructuredContent: Boolean(ensureRecord(designContextResult.structuredContent)),
        assets: designPayload.assets
      }
    }
  };
}
