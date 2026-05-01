import type {
  DesignSystemChecklist,
  DesignSystemChecklistSection,
  ReferenceScope,
  ReferenceStyleContext
} from "@designer/shared";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

type ParsedFigmaLink = {
  figmaUrl: string;
  fileKey: string;
  nodeId: string | null;
  scope: ReferenceScope;
};

function buildDirectThumbnailUrl(parsed: ParsedFigmaLink) {
  if (parsed.nodeId) {
    return `https://www.figma.com/file/${encodeURIComponent(parsed.fileKey)}/thumbnail?node-id=${encodeURIComponent(parsed.nodeId.replaceAll(":", "-"))}`;
  }
  return `https://www.figma.com/file/${encodeURIComponent(parsed.fileKey)}/thumbnail`;
}

const REQUIRED_DESIGN_SYSTEM_SECTIONS = [
  "Brand foundations",
  "Color system",
  "Typography system",
  "Spacing and layout",
  "Shape and visual rules",
  "Core components",
  "Navigation"
] as const;

function normalizeNodeId(raw: string | null) {
  if (!raw) {
    return null;
  }

  const value = raw.replace(/-/g, ":");
  return value;
}

export function parseFigmaLink(input: string): ParsedFigmaLink {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Invalid URL format. Please provide a valid Figma link.");
  }

  if (!url.hostname.includes("figma.com")) {
    throw new Error("Only Figma links are supported.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "design") {
    throw new Error("Expected a Figma design link in the form /design/{fileKey}/...");
  }

  const fileKey = parts[1];
  const nodeId = normalizeNodeId(url.searchParams.get("node-id"));

  return {
    figmaUrl: url.toString(),
    fileKey,
    nodeId,
    scope: nodeId ? "frame" : "page"
  };
}

function hashSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value: number) => {
    const normalized = Math.round((value + m) * 255);
    return normalized.toString(16).padStart(2, "0");
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function buildHeuristicStyleContext(seedSource: string): ReferenceStyleContext {
  const seed = hashSeed(seedSource);
  const hue = seed % 360;
  const accentHue = (hue + 28) % 360;

  return {
    source: "heuristic",
    palette: {
      primary: hslToHex(hue, 76, 46),
      secondary: hslToHex((hue + 195) % 360, 24, 38),
      accent: hslToHex(accentHue, 80, 56),
      background: hslToHex((hue + 8) % 360, 26, 96),
      surface: hslToHex((hue + 8) % 360, 26, 96),
      text: hslToHex((hue + 210) % 360, 26, 14)
    },
    typography: {
      headingFamily: "Sora, Manrope, system-ui, sans-serif",
      bodyFamily: "Manrope, ui-sans-serif, system-ui, sans-serif",
      cornerRadius: 14 + (seed % 6)
    },
    spacingScale: [4, 8, 12, 16, 20, 24, 32],
    componentPatterns: ["soft cards", "elevated actions", "icon-forward status rows"],
    layoutMotifs: ["asymmetric hero", "staggered content bands", "high-contrast callouts"]
  };
}

function normalizeHex(input: string) {
  const raw = input.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
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
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) {
    return 0;
  }
  return (max - min) / max;
}

function extractHexPaletteFromHtml(html: string) {
  const matches = html.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  const counts = new Map<string, number>();

  for (const match of matches) {
    const normalized = normalizeHex(match);
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([hex]) => {
      const luminance = hexLuminance(hex);
      return luminance > 0.02 && luminance < 0.98;
    })
    .sort((left, right) => right[1] - left[1])
    .map(([hex]) => hex)
    .slice(0, 24);
}

function rgbToHex(red: number, green: number, blue: number) {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#47;", "/")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#x3A;", ":");
}

function extractMetaThumbnailUrl(html: string) {
  const match = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (!match?.[1]) {
    return null;
  }
  const decoded = decodeHtmlAttribute(match[1]).trim();
  return decoded.startsWith("http://") || decoded.startsWith("https://") ? decoded : null;
}

function extractMetaTitle(html: string) {
  const match = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (!match?.[1]) {
    return null;
  }
  const decoded = decodeHtmlAttribute(match[1]).trim();
  return decoded.length > 0 ? decoded : null;
}

async function extractPaletteFromImageUrl(imageUrl: string): Promise<string[]> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Design-Agent-Reference-Sync/1.0"
      }
    });
    if (!response.ok) {
      return [];
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());
    let width = 0;
    let height = 0;
    let pixelData: Uint8Array | Buffer | null = null;

    if (contentType.includes("png") || buffer.slice(1, 4).toString("ascii") === "PNG") {
      const png = PNG.sync.read(buffer);
      width = png.width;
      height = png.height;
      pixelData = png.data;
    } else {
      const jpg = jpeg.decode(buffer, {
        useTArray: true,
        formatAsRGBA: true
      });
      width = jpg.width;
      height = jpg.height;
      pixelData = jpg.data;
    }

    if (!pixelData || width <= 0 || height <= 0) {
      return [];
    }

    const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
    const bins = new Map<string, number>();

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const index = (y * width + x) * 4;
        const red = pixelData[index];
        const green = pixelData[index + 1];
        const blue = pixelData[index + 2];
        const alpha = pixelData[index + 3];

        if (alpha < 170) {
          continue;
        }

        const luminance = hexLuminance(rgbToHex(red, green, blue));
        if (luminance < 0.05 || luminance > 0.96) {
          continue;
        }

        const quantized = rgbToHex(Math.round(red / 24) * 24, Math.round(green / 24) * 24, Math.round(blue / 24) * 24);
        bins.set(quantized, (bins.get(quantized) ?? 0) + 1);
      }
    }

    return [...bins.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([hex]) => hex)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function buildStyleContextFromHtmlPalette(seedSource: string, colors: string[]): ReferenceStyleContext {
  const fallback = buildHeuristicStyleContext(seedSource);
  if (colors.length === 0) {
    return fallback;
  }

  const palettePool = [...new Set(colors)];
  const bySaturation = [...palettePool].sort((left, right) => hexSaturation(right) - hexSaturation(left));
  const byLuminance = [...palettePool].sort((left, right) => hexLuminance(left) - hexLuminance(right));

  const primary =
    bySaturation.find((hex) => hexLuminance(hex) > 0.14 && hexLuminance(hex) < 0.78) ?? fallback.palette.primary;
  const accent =
    bySaturation.find((hex) => hex !== primary && hexLuminance(hex) > 0.2 && hexLuminance(hex) < 0.9) ??
    fallback.palette.accent;
  const secondary =
    palettePool.find((hex) => hex !== primary && hex !== accent && hexLuminance(hex) > 0.1 && hexLuminance(hex) < 0.68) ??
    fallback.palette.secondary;
  const surface = [...byLuminance]
    .reverse()
    .find((hex) => hex !== primary && hex !== accent && hexLuminance(hex) > 0.82) ??
    fallback.palette.surface;
  const background = surface ?? fallback.palette.background ?? fallback.palette.surface;
  const text =
    byLuminance.find((hex) => hex !== surface && hexLuminance(hex) < 0.24) ?? fallback.palette.text;

  return {
    ...fallback,
    source: "figma-public-link",
    palette: {
      primary,
      secondary,
      accent,
      background,
      surface,
      text
    }
  };
}

function ensureSectionItems(items: string[]) {
  const compact = items.map((item) => item.trim()).filter(Boolean);
  if (compact.length > 0) {
    return compact;
  }
  return [];
}

function defaultRequiredSectionItems(section: (typeof REQUIRED_DESIGN_SYSTEM_SECTIONS)[number]) {
  if (section === "Brand foundations") {
    return ["Clear", "Focused", "Consistent", "Readable"];
  }
  if (section === "Color system") {
    return ["Primary", "Secondary", "Accent", "Surface", "Text"];
  }
  if (section === "Typography system") {
    return ["Display", "Heading", "Body", "Label"];
  }
  if (section === "Spacing and layout") {
    return ["4px", "8px", "12px", "16px", "24px", "32px"];
  }
  if (section === "Shape and visual rules") {
    return ["Radius", "Border", "Shadow", "Opacity"];
  }
  if (section === "Core components") {
    return ["Buttons", "Inputs", "Cards"];
  }
  return ["Top bar", "Sidebar", "Tabs", "Breadcrumbs"];
}

function ensureChecklistCompleteness(sections: DesignSystemChecklistSection[]) {
  const mapped = new Map<string, DesignSystemChecklistSection>();
  for (const section of sections) {
    const key = section.section.trim();
    if (!key) {
      continue;
    }
    mapped.set(key, {
      section: key,
      items: ensureSectionItems(section.items)
    });
  }

  for (const required of REQUIRED_DESIGN_SYSTEM_SECTIONS) {
    if (!mapped.has(required)) {
      mapped.set(required, {
        section: required,
        items: defaultRequiredSectionItems(required)
      });
    }
  }
  const requiredSections = REQUIRED_DESIGN_SYSTEM_SECTIONS.map((section) => mapped.get(section)!);
  const optionalSections = [...mapped.values()].filter(
    (section) => !REQUIRED_DESIGN_SYSTEM_SECTIONS.includes(section.section as (typeof REQUIRED_DESIGN_SYSTEM_SECTIONS)[number])
  );
  return [...requiredSections, ...optionalSections.filter((section) => section.items.length > 0)];
}

export function buildDesignSystemChecklistFromStyleContext(styleContext: ReferenceStyleContext): DesignSystemChecklist {
  const rawSections: DesignSystemChecklistSection[] = [
    {
      section: "Brand foundations",
      items: [
        "Brand tone keywords (3-5): clear, warm, focused, and product-oriented.",
        "Core voice rule: concise guidance language, never decorative filler copy.",
        "Visual signature: soft surfaces, restrained elevation, and high readability hierarchy.",
        "Usage boundary: apply this system to product UI and marketing UI to keep one recognizable brand."
      ]
    },
    {
      section: "Color system",
      items: [
        `Brand primary token: ${styleContext.palette.primary}.`,
        `Secondary/support token: ${styleContext.palette.secondary}.`,
        `Accent token for focus/action: ${styleContext.palette.accent}.`,
        `Background token: ${styleContext.palette.background ?? styleContext.palette.surface}; surface token: ${styleContext.palette.surface}; text base token: ${styleContext.palette.text}.`,
        "Required color roles: background, surface, border, text-primary, text-secondary, action-primary, action-secondary, success, warning, error, info."
      ]
    },
    {
      section: "Typography system",
      items: [
        `Heading family token: ${styleContext.typography.headingFamily}.`,
        `Body family token: ${styleContext.typography.bodyFamily}.`,
        "Define type scale tokens: display, h1, h2, h3, title, body, body-small, caption, overline.",
        "Define line-height and letter-spacing tokens per size to avoid ad-hoc typography."
      ]
    },
    {
      section: "Spacing and layout",
      items: [
        `Base spacing scale tokens: ${styleContext.spacingScale.map((value) => `${value}px`).join(", ")}.`,
        "Desktop: 12-column grid with named gutters and max content width token.",
        "Mobile/app: 4-column grid with safe-area aware margins.",
        "Section spacing and alignment follow the extracted rhythm."
      ]
    },
    {
      section: "Shape and visual rules",
      items: [
        `Corner radius base token: ${styleContext.typography.cornerRadius}px with explicit size variants.`,
        "Define border tokens by hierarchy: subtle, strong, focus, destructive.",
        "Define elevation tokens (none, low, mid, high) with exact shadow specs.",
        "Define opacity tokens for disabled, overlay, and emphasis states."
      ]
    },
    {
      section: "Iconography and imagery rules",
      items: [
        "Choose one icon stroke style and one size set (e.g. 16/20/24) for consistency.",
        "Define icon usage rules: decorative vs semantic vs actionable icons.",
        "Define image treatment rules: corner radius, overlay, crop ratios, and fallback behavior."
      ]
    },
    {
      section: "Core components",
      items: [
        "Button (primary, secondary, ghost, destructive) with all states.",
        "Input, textarea, select, checkbox, radio, switch with validation states.",
        "Card, section header, tabs, and modal/sheet primitives.",
        `Pattern focus list: ${styleContext.componentPatterns.join(", ")}.`
      ]
    },
    {
      section: "Navigation",
      items: [
        "Top navigation shell with active, hover, and collapsed states.",
        "Side navigation rail/list with section headers and selected state.",
        "Breadcrumb and contextual back/close patterns."
      ]
    },
    {
      section: "Feedback/status components",
      items: [
        "Badge/chip variants for neutral, success, warning, error, and info.",
        "Inline alert, toast, loading skeleton, and empty state components.",
        "Progress indicator patterns for multi-step and long-running tasks."
      ]
    },
    {
      section: "Data display components",
      items: [
        "Table (dense/comfortable), metric card, and chart container primitives.",
        "List rows with icon, title, metadata, actions, and status slot.",
        "Pagination/filter bar patterns with responsive fallbacks."
      ]
    },
    {
      section: "Page/screen templates",
      items: [
        "App templates: dashboard, detail page, settings page, form flow.",
        "Web templates: landing hero + feature band + CTA + FAQ skeleton.",
        "Device-specific frame presets: desktop and iPhone with canonical spacing."
      ]
    },
    {
      section: "Interaction states",
      items: [
        "Define default, hover, focus-visible, active, loading, disabled, selected states.",
        "Define motion rules: transition durations, easing, and reduced-motion behavior.",
        "Define drag/resize/edit affordance styling for canvas interactions."
      ]
    },
    {
      section: "Accessibility rules",
      items: [
        "Set minimum contrast targets for text and interactive UI.",
        "Set focus ring token and keyboard navigation expectations.",
        "Set minimum touch target and semantic labeling requirements."
      ]
    },
    {
      section: "Figma variables/styles structure",
      items: [
        "Variables collections required: color, spacing, radius, typography, effects.",
        "Styles required: text styles, color styles, effect styles, grid styles.",
        "Component properties required: variant, state, size, density, theme where relevant.",
        "Map variable names to implementation tokens one-to-one."
      ]
    },
    {
      section: "Naming conventions",
      items: [
        "Use slash-based taxonomy: foundation/color/primary, component/button/primary/default.",
        "Use predictable state suffixes: /default, /hover, /focus, /disabled.",
        "Use device suffixes for templates only when layout differs materially."
      ]
    },
    {
      section: "Library/documentation requirements",
      items: [
        "One publishable Figma library with version notes and change log.",
        "Each core component must include usage notes, do/don't examples, and state matrix.",
        "Document implementation parity notes for React/CSS token mapping."
      ]
    }
  ];

  return {
    source: "figma-link-seeded",
    sections: ensureChecklistCompleteness(rawSections)
  };
}

export function normalizeDesignSystemChecklist(input: DesignSystemChecklist): DesignSystemChecklist {
  return {
    source: input.source,
    sections: ensureChecklistCompleteness(input.sections)
  };
}

async function fetchFigmaOEmbed(figmaUrl: string): Promise<{ thumbnailUrl: string | null; title: string | null }> {
  try {
    const response = await fetch(`https://www.figma.com/oembed?url=${encodeURIComponent(figmaUrl)}`, {
      headers: {
        "User-Agent": "Design-Agent-Reference-Sync/1.0"
      }
    });

    if (!response.ok) {
      return { thumbnailUrl: null, title: null };
    }

    const payload = (await response.json()) as { thumbnail_url?: unknown; title?: unknown };
    const thumbnailUrl = typeof payload.thumbnail_url === "string" ? decodeHtmlAttribute(payload.thumbnail_url) : null;
    const title = typeof payload.title === "string" ? decodeHtmlAttribute(payload.title) : null;
    return { thumbnailUrl, title };
  } catch {
    return { thumbnailUrl: null, title: null };
  }
}

async function resolveImageUrl(candidateUrl: string, depth = 0): Promise<string | null> {
  if (depth > 2) {
    return candidateUrl;
  }

  try {
    const response = await fetch(candidateUrl, {
      headers: {
        "User-Agent": "Design-Agent-Reference-Sync/1.0"
      }
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("image/")) {
      return candidateUrl;
    }

    if (!contentType.includes("html")) {
      return null;
    }

    const html = await response.text();
    const nested = extractMetaThumbnailUrl(html);
    if (!nested || nested === candidateUrl) {
      return null;
    }

    return resolveImageUrl(nested, depth + 1);
  } catch {
    return null;
  }
}

export async function ensurePublicReference(figmaUrl: string): Promise<string> {
  const response = await fetch(figmaUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Design-Agent-Reference-Sync/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Figma link returned HTTP ${response.status}. Public access is required in v1.`);
  }

  const html = await response.text();
  const blockSignals = [
    "Log in to Figma",
    "Join this file",
    "You need to sign in",
    "This file is private"
  ];

  const appearsPrivate = blockSignals.some((signal) => html.includes(signal));
  if (appearsPrivate) {
    throw new Error("Reference appears private. V1 only supports publicly accessible Figma links.");
  }

  return html;
}

export async function syncStyleContextFromFigmaLink(figmaUrl: string): Promise<{
  parsed: ParsedFigmaLink;
  styleContext: ReferenceStyleContext;
  thumbnailUrl: string | null;
  title: string | null;
}> {
  const parsed = parseFigmaLink(figmaUrl);
  const html = await ensurePublicReference(parsed.figmaUrl);
  const extractedColors = extractHexPaletteFromHtml(html);
  const metaThumbnailUrl = extractMetaThumbnailUrl(html);
  const metaTitle = extractMetaTitle(html);
  const oEmbed = await fetchFigmaOEmbed(parsed.figmaUrl);
  const directThumbnailUrl = buildDirectThumbnailUrl(parsed);
  const resolvedDirectThumbnailUrl = await resolveImageUrl(directThumbnailUrl);
  const rawThumbnailUrl = resolvedDirectThumbnailUrl ?? oEmbed.thumbnailUrl ?? metaThumbnailUrl;
  const thumbnailUrl = rawThumbnailUrl ? (await resolveImageUrl(rawThumbnailUrl)) ?? rawThumbnailUrl : null;
  const imageColors = thumbnailUrl ? await extractPaletteFromImageUrl(thumbnailUrl) : [];
  const styleCandidates = imageColors.length > 0 ? imageColors : extractedColors;
  const styleContext = buildStyleContextFromHtmlPalette(`${parsed.fileKey}:${parsed.nodeId ?? "page"}`, styleCandidates);

  return {
    parsed,
    styleContext,
    thumbnailUrl,
    title: oEmbed.title ?? metaTitle
  };
}
