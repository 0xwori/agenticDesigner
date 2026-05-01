import type {
  ComponentRecipe,
  DesignMdColorToken,
  DesignMdStructuredTokens,
  DesignMdTypographyToken,
  DesignMdTypographyHierarchyEntry,
  DesignSystemQualityReport,
  ReferenceStyleContext,
  StyleProfile
} from "@designer/shared";
import {
  applyStyleCalibration,
  buildQualityReportFromRecipes,
  buildStyleProfileFromStyleContext
} from "./designSystemProfile.js";
import { buildDesignSystemVisualBoard } from "./designSystemVisualBoard.js";

const SECTION_ORDER = [
  "visual theme & atmosphere", "color palette & roles", "typography rules",
  "component stylings", "layout principles", "depth & elevation",
  "do's and don'ts", "responsive behavior", "agent prompt guide",
  // Legacy aliases for backward compat:
  "overview", "colors", "typography", "elevation", "components",
] as const;

/**
 * Map aliased heading names to canonical keys.
 * This lets us parse both old-format ("## Colors") and new-format ("## Color Palette & Roles").
 */
const HEADING_ALIASES: Record<string, string> = {
  overview: "visual theme & atmosphere",
  colors: "color palette & roles",
  "color palette & roles": "color palette & roles",
  typography: "typography rules",
  "typography rules": "typography rules",
  elevation: "depth & elevation",
  "depth & elevation": "depth & elevation",
  components: "component stylings",
  "component stylings": "component stylings",
  "layout principles": "layout principles",
  "responsive behavior": "responsive behavior",
  "agent prompt guide": "agent prompt guide",
  "visual theme & atmosphere": "visual theme & atmosphere",
  "do's and don'ts": "do's and don'ts",
  "dos and don'ts": "do's and don'ts",
};

const DEFAULT_OVERVIEW =
  "A calm, modern interface with strong hierarchy, brand consistency, and clear interaction affordances.";

const DEFAULT_DOS = [
  "Do use the primary color for one dominant action per screen.",
  "Do keep spacing and radius tokens consistent across components.",
  "Do maintain WCAG AA contrast for text and controls."
];

const DEFAULT_DONTS = [
  "Don't mix unrelated corner radius systems in one screen.",
  "Don't exceed two body text weights in the same panel.",
  "Don't introduce off-brand accent colors without purpose."
];

const FALLBACK_STYLE_CONTEXT: ReferenceStyleContext = {
  source: "heuristic",
  palette: {
    primary: "#8b8f98",
    secondary: "#6f7785",
    accent: "#9b8f82",
    background: "#f5f5f6",
    surface: "#f5f5f6",
    text: "#202327"
  },
  typography: {
    headingFamily: "Inter, ui-sans-serif, system-ui",
    bodyFamily: "Inter, ui-sans-serif, system-ui",
    cornerRadius: 12
  },
  spacingScale: [4, 8, 12, 16, 20, 24, 32],
  componentPatterns: ["balanced cards", "clear action emphasis", "compact control rows"],
  layoutMotifs: ["content-first grouping", "clean visual hierarchy"]
};

function normalizeHeading(input: string) {
  return input.trim().toLowerCase().replace(/^\d+\.\s*/, "");
}

function buildSectionMap(markdown: string) {
  const sections = new Map<string, string>();
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gim)];
  if (matches.length === 0) {
    return sections;
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const rawHeading = normalizeHeading(current[1] ?? "");
    const heading = HEADING_ALIASES[rawHeading] ?? rawHeading;
    const start = current.index! + current[0].length;
    const end = next?.index ?? markdown.length;
    const body = markdown.slice(start, end).trim();
    if (!sections.has(heading)) {
      sections.set(heading, body);
    }
  }

  return sections;
}

function extractBulletLines(sectionBody: string): string[] {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

/**
 * Parse a typography hierarchy table from a markdown section.
 * Supports tables like:
 *   | Role | Size | Weight | Line Height | ...
 *   |------|------|--------|-------------|
 *   | Hero Title | 40px (2.50rem) | 500 | 48px (1.20) | ...
 */
function parseTypographyHierarchy(sectionBody: string): DesignMdTypographyHierarchyEntry[] {
  const lines = sectionBody.split("\n").map((l) => l.trim());
  const entries: DesignMdTypographyHierarchyEntry[] = [];

  // Find the table header row (must contain "Role" and "Size" or "Weight")
  let headerIndex = -1;
  let colMap: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim().toLowerCase()).filter(Boolean);
    if (cells.includes("role") && (cells.includes("size") || cells.includes("weight"))) {
      headerIndex = i;
      for (let ci = 0; ci < cells.length; ci++) {
        colMap[cells[ci]] = ci;
      }
      break;
    }
  }
  if (headerIndex < 0) return entries;

  // Skip separator row (|---|---|...)
  const startRow = headerIndex + 2;
  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const role = cells[colMap["role"] ?? 0] ?? "";
    if (!role || /^-+$/.test(role)) continue;

    const sizeRaw = cells[colMap["size"] ?? 1] ?? "";
    const sizeMatch = sizeRaw.match(/(\d+(?:\.\d+)?)\s*px/i);
    const sizePx = sizeMatch ? parseFloat(sizeMatch[1]) : 14;

    const weightRaw = cells[colMap["weight"] ?? 2] ?? "";
    const weightMatch = weightRaw.match(/(\d{3})/);
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : 400;

    const lhRaw = cells[colMap["line height"] ?? colMap["lineheight"] ?? -1] ?? "";
    const lhMatch = lhRaw.match(/(\d+(?:\.\d+)?)\s*px/i);
    const lineHeight = lhMatch ? parseFloat(lhMatch[1]) : undefined;

    const lsRaw = cells[colMap["letter spacing"] ?? colMap["letterspacing"] ?? -1] ?? "";
    const letterSpacing = lsRaw && lsRaw !== "—" ? lsRaw : undefined;

    const notesRaw = cells[colMap["notes"] ?? -1] ?? "";
    const notes = notesRaw && notesRaw !== "—" ? notesRaw : undefined;

    const fontVariantRaw = cells[colMap["font"] ?? colMap["font variant"] ?? -1] ?? "";
    const fontVariant = fontVariantRaw && fontVariantRaw !== "—" ? fontVariantRaw : undefined;

    entries.push({
      role,
      sizePx,
      weight,
      ...(lineHeight !== undefined && { lineHeight }),
      ...(letterSpacing !== undefined && { letterSpacing }),
      ...(fontVariant !== undefined && { fontVariant }),
      ...(notes !== undefined && { notes })
    });
  }
  return entries;
}

/**
 * Parse spacing and radius values from the layout section body.
 */
function parseLayoutTokens(sectionBody: string): { spacingScale: number[]; radiusScale: number[] } {
  const spacingScale: number[] = [];
  const radiusScale: number[] = [];

  for (const rawLine of sectionBody.split("\n")) {
    const line = rawLine.trim().toLowerCase();

    // Spacing scale line: "- **Spacing scale**: 8px, 16px, 21.44px, 4px" or similar
    if (line.includes("spacing") && line.includes("scale")) {
      const values = [...line.matchAll(/(\d+(?:\.\d+)?)\s*px/gi)];
      for (const m of values) {
        const v = Math.round(parseFloat(m[1]));
        if (v > 0 && v <= 128 && !spacingScale.includes(v)) spacingScale.push(v);
      }
    }

    // Base unit line: "- **Base unit**: 8px"
    if (line.includes("base unit") && spacingScale.length === 0) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*px/i);
      if (match) {
        const base = Math.round(parseFloat(match[1]));
        if (base >= 2 && base <= 16) {
          for (const mult of [0.5, 1, 1.5, 2, 3, 4, 6, 8]) {
            const v = Math.round(base * mult);
            if (v > 0 && v <= 128 && !spacingScale.includes(v)) spacingScale.push(v);
          }
        }
      }
    }

    // Radius scale line: "- **Border-radius scale**: 2px (small), 8px (default), 12px (large), 999px (pill)"
    if (line.includes("radius")) {
      const values = [...line.matchAll(/(\d+(?:\.\d+)?)\s*px/gi)];
      for (const m of values) {
        const v = Math.round(parseFloat(m[1]));
        if (v >= 0 && v <= 999 && !radiusScale.includes(v)) radiusScale.push(v);
      }
    }
  }

  spacingScale.sort((a, b) => a - b);
  radiusScale.sort((a, b) => a - b);
  return { spacingScale, radiusScale };
}

function firstColorByName(
  colors: DesignMdColorToken[],
  fallback: string,
  names: string[],
  options?: { skipForegroundRoles?: boolean }
) {
  const shouldSkip = (item: DesignMdColorToken & { _subsection?: string }) =>
    options?.skipForegroundRoles === true && isForegroundColorRole(item);

  for (const matcher of names) {
    const needle = matcher.toLowerCase();
    const byName = colors.find((item) => item.name.toLowerCase().includes(needle) && !shouldSkip(item));
    if (byName) return byName.hex;

    const byRole = colors.find((item) => item.role.toLowerCase().includes(needle) && !shouldSkip(item));
    if (byRole) return byRole.hex;

    const byTag = colors.find((item) => {
      const tag = (item as DesignMdColorToken & { _subsection?: string })._subsection?.toLowerCase() ?? "";
      return tag.includes(needle) && !shouldSkip(item);
    });
    if (byTag) return byTag.hex;
  }

  return fallback;
}

function isForegroundColorRole(item: DesignMdColorToken & { _subsection?: string }) {
  const text = `${item.role ?? ""} ${item._subsection ?? ""}`.toLowerCase();
  return (
    /\b(text|copy|heading|foreground|ink)\b/.test(text) ||
    /\bon\s+(?:light|dark|brand|colored|neutral)?\s*backgrounds?\b/.test(text)
  );
}

function normalizeColorTokens(colors: DesignMdColorToken[], styleContext: ReferenceStyleContext): DesignMdColorToken[] {
  void styleContext;
  const normalized: DesignMdColorToken[] = [];
  const seen = new Set<string>();
  for (const token of colors) {
    const rawHex = token.hex.trim().toLowerCase();
    const hex =
      /^#[0-9a-f]{3}$/.test(rawHex)
        ? `#${rawHex[1]}${rawHex[1]}${rawHex[2]}${rawHex[2]}${rawHex[3]}${rawHex[3]}`
        : /^#[0-9a-f]{8}$/.test(rawHex)
          ? rawHex.slice(0, 7)
          : rawHex;
    if (!/^#[0-9a-f]{6}$/.test(hex)) {
      continue;
    }
    const key = `${token.name.toLowerCase()}-${hex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const entry: DesignMdColorToken & { _subsection?: string } = {
      name: token.name.trim(),
      hex,
      role: token.role.trim()
    };
    const sub = (token as DesignMdColorToken & { _subsection?: string })._subsection;
    if (sub) entry._subsection = sub;
    normalized.push(entry);
  }
  return normalized;
}

function recipeToMarkdownLine(recipe: ComponentRecipe) {
  const familyLabel = recipe.family
    .replaceAll("-", " ")
    .replace(/\b\w/g, (token) => token.toUpperCase());
  const states = recipe.states.map((state) => state.name).join("/");
  const evidence = recipe.evidence[0] ? ` evidence: ${recipe.evidence[0]}.` : "";
  return `${familyLabel}: ${recipe.shape} form, radius ${recipe.cornerRadius}px, border ${recipe.borderWidth}px ${recipe.borderStyle}, ${recipe.fillStyle} fill, ${recipe.shadowStyle} shadow, ${recipe.density} density, states ${states}.${evidence}`;
}

function recipesToMarkdownLines(profile: StyleProfile) {
  const lines = profile.componentRecipes.map(recipeToMarkdownLine);
  if (lines.length > 0) {
    return lines;
  }
  return [
    "Buttons: rounded form, clear primary/secondary/ghost states.",
    "Inputs: readable field hierarchy with clear focus/error treatments.",
    "Cards: reusable surfaces with predictable spacing and border rhythm."
  ];
}

type ComponentFamilyKey =
  | "buttons"
  | "inputs"
  | "cards"
  | "navigation"
  | "feedback"
  | "data-display"
  | "templates"
  | "interaction-states"
  | "iconography";

function normalizeFamilyFromComponentLine(value: string): ComponentFamilyKey | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("button")) return "buttons";
  if (normalized.startsWith("input")) return "inputs";
  if (normalized.startsWith("card")) return "cards";
  if (normalized.startsWith("navigation")) return "navigation";
  if (normalized.startsWith("feedback")) return "feedback";
  if (normalized.startsWith("data display")) return "data-display";
  if (normalized.startsWith("template")) return "templates";
  if (normalized.startsWith("interaction")) return "interaction-states";
  if (normalized.startsWith("icon")) return "iconography";
  return null;
}

function parseComponentsFromMarkdown(components: string[], profile: StyleProfile): StyleProfile {
  if (components.length === 0) {
    return profile;
  }

  const updates: Array<{
    family: ComponentFamilyKey;
    field:
      | "shape"
      | "cornerRadius"
      | "borderWidth"
      | "borderStyle"
      | "shadowStyle"
      | "density"
      | "controlHeight"
      | "fillStyle";
    value: string | number;
  }> = [];

  for (const line of components) {
    const familyRaw = line.split(":")[0] ?? "";
    const family = normalizeFamilyFromComponentLine(familyRaw);
    if (!family) {
      continue;
    }

    const shape = line.match(/\b(pill|rounded|sharp|mixed)\s+form\b/i)?.[1]?.toLowerCase();
    if (shape === "pill" || shape === "rounded" || shape === "sharp" || shape === "mixed") {
      updates.push({ family, field: "shape", value: shape });
    }

    const radiusMatch = line.match(/\bradius\s+(\d{1,2})px\b/i)?.[1];
    if (radiusMatch) {
      updates.push({ family, field: "cornerRadius", value: Number.parseInt(radiusMatch, 10) });
    }

    const borderMatch = line.match(/\bborder\s+(\d{1,2})px\s+(none|solid|subtle)\b/i);
    if (borderMatch) {
      updates.push({ family, field: "borderWidth", value: Number.parseInt(borderMatch[1], 10) });
      updates.push({ family, field: "borderStyle", value: borderMatch[2].toLowerCase() });
    }

    const fill = line.match(/\b(solid|tint|outline|ghost|mixed)\s+fill\b/i)?.[1]?.toLowerCase();
    if (fill === "solid" || fill === "tint" || fill === "outline" || fill === "ghost" || fill === "mixed") {
      updates.push({ family, field: "fillStyle", value: fill });
    }

    const shadow = line.match(/\b(none|soft|medium|strong)\s+shadow\b/i)?.[1]?.toLowerCase();
    if (shadow === "none" || shadow === "soft" || shadow === "medium" || shadow === "strong") {
      updates.push({ family, field: "shadowStyle", value: shadow });
    }

    const density = line.match(/\b(compact|comfortable|spacious)\s+density\b/i)?.[1]?.toLowerCase();
    if (density === "compact" || density === "comfortable" || density === "spacious") {
      updates.push({ family, field: "density", value: density });
    }

    const heightMatch = line.match(/\bheight\s+(\d{2})px\b/i)?.[1];
    if (heightMatch) {
      updates.push({ family, field: "controlHeight", value: Number.parseInt(heightMatch, 10) });
    }
  }

  if (updates.length > 0) {
    return applyStyleCalibration(profile, updates).profile;
  }

  const combined = components.join(" ").toLowerCase();
  if (combined.length === 0) {
    return profile;
  }

  const fallbackUpdates: Array<{ family: ComponentFamilyKey; field: "shape" | "fillStyle"; value: string }> = [];
  if (combined.includes("pill")) {
    fallbackUpdates.push({ family: "buttons", field: "shape", value: "pill" });
  } else if (combined.includes("rounded")) {
    fallbackUpdates.push({ family: "buttons", field: "shape", value: "rounded" });
  }
  if (combined.includes("outline")) {
    fallbackUpdates.push({ family: "buttons", field: "fillStyle", value: "outline" });
  } else if (combined.includes("ghost")) {
    fallbackUpdates.push({ family: "buttons", field: "fillStyle", value: "ghost" });
  }
  if (fallbackUpdates.length === 0) {
    return profile;
  }
  return applyStyleCalibration(profile, fallbackUpdates).profile;
}

function colorTokensFromContext(styleContext?: ReferenceStyleContext): DesignMdColorToken[] {
  const safeContext = styleContext ?? FALLBACK_STYLE_CONTEXT;
  return normalizeColorTokens(
    [
      { name: "Primary", hex: safeContext.palette.primary, role: "CTAs, active states, key interactive elements" },
      { name: "Secondary", hex: safeContext.palette.secondary, role: "Supporting actions, chips, toggle states" },
      { name: "Accent", hex: safeContext.palette.accent, role: "Accent highlights, badges, decorative elements" },
      { name: "Background", hex: safeContext.palette.background ?? safeContext.palette.surface, role: "Primary page and app background" },
      { name: "Surface", hex: safeContext.palette.surface, role: "Cards, panels, and container surfaces" },
      { name: "Text", hex: safeContext.palette.text, role: "Primary text and icon color" }
    ],
    safeContext
  );
}

function generateMarkdownFromProfile(input: {
  overview: string;
  colors: DesignMdColorToken[];
  styleProfile: StyleProfile;
  elevation?: string;
  dos?: string[];
  donts?: string[];
}) {
  const typography = input.styleProfile.tokens.typography;
  const componentLines = recipesToMarkdownLines(input.styleProfile);
  const dos = input.dos && input.dos.length > 0 ? input.dos : DEFAULT_DOS;
  const donts = input.donts && input.donts.length > 0 ? input.donts : DEFAULT_DONTS;
  const elevation =
    input.elevation ??
    `Use ${input.styleProfile.tokens.shadows.join(", ")} elevation tokens with restrained border contrast.`;

  const spacingScale = input.styleProfile.tokens.spacingScale;
  const spacingStr = spacingScale.length > 0
    ? spacingScale.map((v: number) => `${v}px`).join(", ")
    : "4, 8, 12, 16, 24, 32, 48, 64";
  const radiusVal = input.styleProfile.componentRecipes?.[0]?.cornerRadius ?? 8;

  return `## Visual Theme & Atmosphere
${input.overview}

## Color Palette & Roles
${input.colors.map((token) => `- **${token.name}** (\`${token.hex}\`): ${token.role}`).join("\n")}

## Typography Rules
- **Headline Font**: ${typography.headlineFont}
- **Body Font**: ${typography.bodyFont}
- **Label Font**: ${typography.labelFont}

${typography.notes.join("\n")}

## Component Stylings
${componentLines.map((line) => `- ${line}`).join("\n")}

## Layout Principles
- **Spacing scale**: ${spacingStr}
- **Base unit**: ${spacingScale[0] ?? 4}px
- **Container max-width**: 1200px for content, 1440px for dashboards
- **Border-radius scale**: ${Math.max(2, radiusVal - 4)}px (small), ${radiusVal}px (default), ${radiusVal + 4}px (large), 999px (pill)

## Depth & Elevation
${elevation}

## Do's and Don'ts
${[...dos, ...donts].map((line) => `- ${line}`).join("\n")}

## Responsive Behavior
- **Breakpoints**: 640px (mobile), 768px (tablet), 1024px (small desktop), 1280px (desktop)
- Below 768px: stack to single column, increase touch targets to 44px
- Below 640px: collapse sidebar navigation, full-width cards
- Use min() and clamp() for fluid typography and spacing

## Agent Prompt Guide
- Primary color: ${input.colors.find((c) => c.name.toLowerCase().includes("primary"))?.hex ?? input.colors[0]?.hex ?? "#000"}
- Font stack: ${typography.headlineFont} / ${typography.bodyFont}
- Corner radius: ${radiusVal}px
- Spacing base: ${spacingScale[0] ?? 8}px
- Component shape: ${input.styleProfile.componentRecipes?.[0]?.shape ?? "rounded"}
- Follow the palette strictly and ensure WCAG AA contrast ratios on all text.
`;
}

export function generateDesignMarkdownFromStyleContext(
  styleContext?: ReferenceStyleContext,
  overview?: string,
  styleProfileInput?: StyleProfile,
  qualityReportInput?: DesignSystemQualityReport
): string {
  const safeContext = styleContext ?? FALLBACK_STYLE_CONTEXT;
  const generated = buildStyleProfileFromStyleContext({
    styleContext: safeContext,
    sourceType: styleProfileInput?.sourceType ?? (safeContext.source === "figma-public-link" ? "figma-reference" : "manual"),
    componentRecipes: styleProfileInput?.componentRecipes ?? safeContext.componentRecipes,
    extractionEvidence: styleProfileInput?.extractionEvidence ?? safeContext.extractionEvidence,
    explicitQualityScore: qualityReportInput?.fidelityScore ?? safeContext.qualityReport?.fidelityScore ?? null
  });

  const colors =
    styleProfileInput?.tokens.colors && styleProfileInput.tokens.colors.length > 0
      ? styleProfileInput.tokens.colors
      : generated.styleProfile.tokens.colors.length > 0
        ? generated.styleProfile.tokens.colors
        : colorTokensFromContext(safeContext);

  return generateMarkdownFromProfile({
    overview: overview?.trim() || DEFAULT_OVERVIEW,
    colors,
    styleProfile: styleProfileInput ?? generated.styleProfile
  });
}

export function parseDesignMarkdown(
  markdownInput: string,
  styleContext?: ReferenceStyleContext,
  options?: {
    styleProfile?: StyleProfile | null;
    qualityReport?: DesignSystemQualityReport | null;
  }
): {
  markdown: string;
  structuredTokens: DesignMdStructuredTokens;
  warnings: string[];
} {
  const safeContext = styleContext ?? FALLBACK_STYLE_CONTEXT;
  const base = buildStyleProfileFromStyleContext({
    styleContext: safeContext,
    sourceType: options?.styleProfile?.sourceType ?? (safeContext.source === "figma-public-link" ? "figma-reference" : "manual"),
    componentRecipes: options?.styleProfile?.componentRecipes ?? safeContext.componentRecipes,
    extractionEvidence: options?.styleProfile?.extractionEvidence ?? safeContext.extractionEvidence,
    explicitQualityScore: options?.qualityReport?.fidelityScore ?? safeContext.qualityReport?.fidelityScore ?? null
  });

  const markdown =
    markdownInput.trim().length > 0
      ? markdownInput.trim()
      : generateDesignMarkdownFromStyleContext(safeContext, undefined, base.styleProfile, base.qualityReport);
  const sections = buildSectionMap(markdown);
  const warnings: string[] = [];

  for (const key of SECTION_ORDER) {
    if (!sections.has(key)) {
      // Don't warn about legacy aliases if canonical key exists
      const isLegacyAlias = Object.keys(HEADING_ALIASES).includes(key) && HEADING_ALIASES[key] !== key;
      if (!isLegacyAlias) {
        warnings.push(`Missing section: ${key}`);
      }
    }
  }

  const overview = (sections.get("visual theme & atmosphere") ?? sections.get("overview"))?.trim() || DEFAULT_OVERVIEW;
  const colorBody = sections.get("color palette & roles") ?? sections.get("colors") ?? "";
  const parsedColors: DesignMdColorToken[] = [];

  // Parse color bullets with sub-section context awareness (### Primary, ### Accent, etc.)
  {
    let currentSubsection = "";
    for (const rawLine of colorBody.split("\n")) {
      const trimmed = rawLine.trim();
      // Track ### sub-section headers (e.g. "### Primary", "### Accent Colors")
      const subMatch = trimmed.match(/^#{2,4}\s+(.+)$/);
      if (subMatch) {
        currentSubsection = subMatch[1].trim();
        continue;
      }
      if (!trimmed.startsWith("- ")) continue;
      const bullet = trimmed.slice(2).trim();
      const match = bullet.match(/^\*\*(.+?)\*\*\s*\(`?(#[0-9a-fA-F]{3,8})`?\)\s*:?\s*(.+)$/);
      if (!match) continue;
      const token: DesignMdColorToken & { _subsection?: string } = {
        name: match[1].trim(),
        hex: match[2].trim(),
        role: match[3].trim()
      };
      if (currentSubsection) {
        token._subsection = currentSubsection;
      }
      parsedColors.push(token);
    }
  }

  const typographyBody = sections.get("typography rules") ?? sections.get("typography") ?? "";
  const typographyLines = typographyBody.split("\n").map((line) => line.trim()).filter(Boolean);
  const headlineFont = typographyLines.find((line) => /headline font/i.test(line))?.split(":").slice(1).join(":").trim();
  const bodyFont = typographyLines.find((line) => /body font/i.test(line))?.split(":").slice(1).join(":").trim();
  const labelFont = typographyLines.find((line) => /label font/i.test(line))?.split(":").slice(1).join(":").trim();
  const typographyNotes = typographyLines.filter((line) => !line.startsWith("- "));
  const typographyHierarchy = parseTypographyHierarchy(typographyBody);
  const componentLines = extractBulletLines(sections.get("component stylings") ?? sections.get("components") ?? "");

  const dosAndDonts = extractBulletLines(sections.get("do's and don'ts") ?? "");
  const dos = dosAndDonts.filter((line) => /^do\b/i.test(line));
  const donts = dosAndDonts.filter((line) => /^don'?t\b/i.test(line));
  const elevation = (sections.get("depth & elevation") ?? sections.get("elevation"))?.trim() || "Depth is conveyed by border contrast and restrained shadows.";

  // Parse layout section for spacing/radius tokens
  const layoutBody = sections.get("layout principles") ?? "";
  const responsiveBody = sections.get("responsive behavior") ?? "";
  const imageryBody = (sections.get("visual theme & atmosphere") ?? sections.get("overview") ?? "")
    .split("\n")
    .filter((line) => {
      const lower = line.toLowerCase();
      return lower.includes("photo") || lower.includes("image") || lower.includes("illustrat") || lower.includes("icon") || lower.includes("hero") || lower.includes("viewport");
    })
    .join("\n")
    .trim();
  const layoutTokens = parseLayoutTokens(layoutBody);

  const colors = normalizeColorTokens(parsedColors, safeContext);
  const typography: DesignMdTypographyToken = {
    headlineFont: headlineFont || base.styleProfile.tokens.typography.headlineFont,
    bodyFont: bodyFont || base.styleProfile.tokens.typography.bodyFont,
    labelFont: labelFont || base.styleProfile.tokens.typography.labelFont,
    notes: typographyNotes.length > 0 ? typographyNotes : base.styleProfile.tokens.typography.notes,
    ...(typographyHierarchy.length > 0 && { hierarchy: typographyHierarchy })
  };

  // Build palette with positional fallbacks: if name/role/subsection search fails,
  // use the first few distinct colors from the parsed list as fallbacks.
  const resolvedPrimary = firstColorByName(colors, "", ["primary", "brand"], { skipForegroundRoles: true });
  const resolvedSecondary = firstColorByName(colors, "", ["secondary", "support"], { skipForegroundRoles: true });
  const resolvedAccent = firstColorByName(colors, "", ["accent", "tertiary"], { skipForegroundRoles: true });
  const resolvedBackground = firstColorByName(colors, "", ["background", "page", "canvas"], {
    skipForegroundRoles: true
  });
  const resolvedSurface = firstColorByName(colors, "", ["surface", "container", "panel", "card", "neutral"], {
    skipForegroundRoles: true
  });
  const resolvedText = firstColorByName(colors, "", ["text", "ink", "on", "heading"]);

  // Positional fallback: first color = primary, skip duplicates for others
  const positionalColors = colors.map((c) => c.hex);
  const usedPositional = new Set<string>();
  function nextPositional() {
    for (const hex of positionalColors) {
      if (!usedPositional.has(hex)) {
        usedPositional.add(hex);
        return hex;
      }
    }
    return "";
  }

  const finalPrimary = resolvedPrimary || nextPositional() || safeContext.palette.primary;
  usedPositional.add(finalPrimary);
  const finalSecondary = resolvedSecondary || nextPositional() || safeContext.palette.secondary;
  usedPositional.add(finalSecondary);
  const finalAccent = resolvedAccent || nextPositional() || safeContext.palette.accent;
  usedPositional.add(finalAccent);
  const finalBackground = resolvedBackground || safeContext.palette.background || safeContext.palette.surface;
  const finalSurface = resolvedSurface || safeContext.palette.surface;
  const finalText = resolvedText || safeContext.palette.text;

  const styleContextFromMarkdown: ReferenceStyleContext = {
    ...safeContext,
    palette: {
      primary: finalPrimary,
      secondary: finalSecondary,
      accent: finalAccent,
      background: finalBackground,
      surface: finalSurface,
      text: finalText
    },
    typography: {
      headingFamily: typography.headlineFont,
      bodyFamily: typography.bodyFont,
      cornerRadius:
        base.styleProfile.componentRecipes.find((recipe) => recipe.family === "buttons")?.cornerRadius ??
        safeContext.typography.cornerRadius
    }
  };

  const nextBase = buildStyleProfileFromStyleContext({
    styleContext: styleContextFromMarkdown,
    sourceType: options?.styleProfile?.sourceType ?? base.styleProfile.sourceType,
    componentRecipes: options?.styleProfile?.componentRecipes ?? base.styleProfile.componentRecipes,
    extractionEvidence: options?.styleProfile?.extractionEvidence ?? base.styleProfile.extractionEvidence,
    explicitQualityScore: options?.qualityReport?.fidelityScore ?? base.qualityReport.fidelityScore
  });

  const styleProfile = parseComponentsFromMarkdown(componentLines, {
    ...nextBase.styleProfile,
    tokens: {
      ...nextBase.styleProfile.tokens,
      colors,
      typography,
      ...(layoutTokens.spacingScale.length > 0 && { spacingScale: layoutTokens.spacingScale }),
      ...(layoutTokens.radiusScale.length > 0 && { radiusScale: layoutTokens.radiusScale })
    }
  });

  const qualityReport = buildQualityReportFromRecipes(
    styleProfile.componentRecipes,
    styleProfile.extractionEvidence,
    options?.qualityReport?.fidelityScore ?? nextBase.qualityReport.fidelityScore,
    {
      colorsDetected: colors.length,
      componentFamiliesDetected: styleProfile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length,
      qualityReasons: options?.qualityReport?.qualityReasons ?? null
    }
  );
  const visualBoard = buildDesignSystemVisualBoard({
    styleProfile,
    qualityReport,
    overview,
    colors,
    typography,
    components: componentLines.length > 0 ? componentLines : recipesToMarkdownLines(styleProfile),
    dos: dos.length > 0 ? dos : DEFAULT_DOS,
    donts: donts.length > 0 ? donts : DEFAULT_DONTS
  });

  return {
    markdown,
    structuredTokens: {
      overview,
      colors,
      typography,
      elevation,
      components: componentLines.length > 0 ? componentLines : recipesToMarkdownLines(styleProfile),
      dos: dos.length > 0 ? dos : DEFAULT_DOS,
      donts: donts.length > 0 ? donts : DEFAULT_DONTS,
      layout: layoutBody.trim(),
      responsive: responsiveBody.trim(),
      imagery: imageryBody,
      styleProfile,
      qualityReport,
      visualBoard
    },
    warnings
  };
}

export const DEFAULT_DESIGN_MD_TEMPLATE = generateDesignMarkdownFromStyleContext(FALLBACK_STYLE_CONTEXT);
