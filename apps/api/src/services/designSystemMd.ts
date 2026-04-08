import type {
  ComponentRecipe,
  DesignMdColorToken,
  DesignMdStructuredTokens,
  DesignMdTypographyToken,
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

const SECTION_ORDER = ["overview", "colors", "typography", "elevation", "components", "do's and don'ts"] as const;

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
  return input.trim().toLowerCase();
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
    const heading = normalizeHeading(current[1] ?? "");
    const start = current.index! + current[0].length;
    const end = next?.index ?? markdown.length;
    const body = markdown.slice(start, end).trim();
    sections.set(heading, body);
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

function firstColorByName(colors: DesignMdColorToken[], fallback: string, names: string[]) {
  const token = colors.find((item) => {
    const lowered = item.name.toLowerCase();
    return names.some((name) => lowered.includes(name));
  });
  return token?.hex ?? fallback;
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
    normalized.push({
      name: token.name.trim(),
      hex,
      role: token.role.trim()
    });
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
      { name: "Surface", hex: safeContext.palette.surface, role: "Backgrounds and container surfaces" },
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

  return `## Overview
${input.overview}

## Colors
${input.colors.map((token) => `- **${token.name}** (${token.hex}): ${token.role}`).join("\n")}

## Typography
- **Headline Font**: ${typography.headlineFont}
- **Body Font**: ${typography.bodyFont}
- **Label Font**: ${typography.labelFont}

${typography.notes.join("\n")}

## Elevation
${elevation}

## Components
${componentLines.map((line) => `- ${line}`).join("\n")}

## Do's and Don'ts
${[...dos, ...donts].map((line) => `- ${line}`).join("\n")}
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
      warnings.push(`Missing section: ${key}`);
    }
  }

  const overview = sections.get("overview")?.trim() || DEFAULT_OVERVIEW;
  const colorBody = sections.get("colors") ?? "";
  const colorLines = extractBulletLines(colorBody);
  const parsedColors: DesignMdColorToken[] = [];

  for (const line of colorLines) {
    const match = line.match(/^\*\*(.+?)\*\*\s*\((#[0-9a-fA-F]{3,8})\)\s*:?\s*(.+)$/);
    if (!match) {
      continue;
    }
    parsedColors.push({
      name: match[1].trim(),
      hex: match[2].trim(),
      role: match[3].trim()
    });
  }

  const typographyBody = sections.get("typography") ?? "";
  const typographyLines = typographyBody.split("\n").map((line) => line.trim()).filter(Boolean);
  const headlineFont = typographyLines.find((line) => /headline font/i.test(line))?.split(":").slice(1).join(":").trim();
  const bodyFont = typographyLines.find((line) => /body font/i.test(line))?.split(":").slice(1).join(":").trim();
  const labelFont = typographyLines.find((line) => /label font/i.test(line))?.split(":").slice(1).join(":").trim();
  const typographyNotes = typographyLines.filter((line) => !line.startsWith("- "));
  const componentLines = extractBulletLines(sections.get("components") ?? "");

  const dosAndDonts = extractBulletLines(sections.get("do's and don'ts") ?? "");
  const dos = dosAndDonts.filter((line) => /^do\b/i.test(line));
  const donts = dosAndDonts.filter((line) => /^don'?t\b/i.test(line));
  const elevation = sections.get("elevation")?.trim() || "Depth is conveyed by border contrast and restrained shadows.";

  const colors = normalizeColorTokens(parsedColors, safeContext);
  const typography: DesignMdTypographyToken = {
    headlineFont: headlineFont || base.styleProfile.tokens.typography.headlineFont,
    bodyFont: bodyFont || base.styleProfile.tokens.typography.bodyFont,
    labelFont: labelFont || base.styleProfile.tokens.typography.labelFont,
    notes: typographyNotes.length > 0 ? typographyNotes : base.styleProfile.tokens.typography.notes
  };

  const styleContextFromMarkdown: ReferenceStyleContext = {
    ...safeContext,
    palette: {
      primary: firstColorByName(colors, safeContext.palette.primary, ["primary", "brand"]),
      secondary: firstColorByName(colors, safeContext.palette.secondary, ["secondary", "support"]),
      accent: firstColorByName(colors, safeContext.palette.accent, ["accent", "tertiary"]),
      surface: firstColorByName(colors, safeContext.palette.surface, ["surface", "neutral", "background"]),
      text: firstColorByName(colors, safeContext.palette.text, ["text", "ink", "on"])
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
      typography
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
      styleProfile,
      qualityReport,
      visualBoard
    },
    warnings
  };
}

export const DEFAULT_DESIGN_MD_TEMPLATE = generateDesignMarkdownFromStyleContext(FALLBACK_STYLE_CONTEXT);
