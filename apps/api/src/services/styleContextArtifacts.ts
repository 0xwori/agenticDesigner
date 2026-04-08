import type { ReferenceStyleContext } from "@designer/shared";
import { buildComponentRecipesFromContext, buildQualityReportFromRecipes } from "./designSystemProfile.js";

type ArtifactSourceInput = {
  sourceCode: string;
  cssCode: string;
  exportHtml?: string | null;
};

function normalizeHex(value: string) {
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

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(red: number, green: number, blue: number) {
  const toHex = (value: number) => clampChannel(value).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hslToHex(hue: number, saturationPct: number, lightnessPct: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturationPct)) / 100;
  const l = Math.max(0, Math.min(100, lightnessPct)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let red = 0;
  let green = 0;
  let blue = 0;
  if (h < 60) {
    red = c;
    green = x;
  } else if (h < 120) {
    red = x;
    green = c;
  } else if (h < 180) {
    green = c;
    blue = x;
  } else if (h < 240) {
    green = x;
    blue = c;
  } else if (h < 300) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  return rgbToHex((red + m) * 255, (green + m) * 255, (blue + m) * 255);
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
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
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

function uniqueHex(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeHex(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function extractHexColors(text: string) {
  const matches = text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  return uniqueHex(matches);
}

function extractRgbColors(text: string) {
  const output: string[] = [];
  const matches = [...text.matchAll(/rgba?\(([^)]+)\)/gi)];
  for (const match of matches) {
    const body = match[1];
    if (!body) {
      continue;
    }
    const numbers = body.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (numbers.length < 3) {
      continue;
    }
    const red = Number(numbers[0]);
    const green = Number(numbers[1]);
    const blue = Number(numbers[2]);
    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
      continue;
    }
    output.push(rgbToHex(red, green, blue));
  }
  return uniqueHex(output);
}

function extractHslColors(text: string) {
  const output: string[] = [];
  const matches = [...text.matchAll(/hsla?\(([^)]+)\)/gi)];
  for (const match of matches) {
    const body = match[1];
    if (!body) {
      continue;
    }
    const numbers = body.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (numbers.length < 3) {
      continue;
    }
    const hue = Number(numbers[0]);
    const saturation = Number(numbers[1]);
    const lightness = Number(numbers[2]);
    if (!Number.isFinite(hue) || !Number.isFinite(saturation) || !Number.isFinite(lightness)) {
      continue;
    }
    output.push(hslToHex(hue, saturation, lightness));
  }
  return uniqueHex(output);
}

function parseColorToken(token: string) {
  const normalizedHex = normalizeHex(token);
  if (normalizedHex) {
    return normalizedHex;
  }

  const rgbMatch = token.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch?.[1]) {
    const numbers = rgbMatch[1].match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (numbers.length >= 3) {
      const red = Number(numbers[0]);
      const green = Number(numbers[1]);
      const blue = Number(numbers[2]);
      if (Number.isFinite(red) && Number.isFinite(green) && Number.isFinite(blue)) {
        return rgbToHex(red, green, blue);
      }
    }
  }

  const hslMatch = token.match(/hsla?\(([^)]+)\)/i);
  if (hslMatch?.[1]) {
    const numbers = hslMatch[1].match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (numbers.length >= 3) {
      const hue = Number(numbers[0]);
      const saturation = Number(numbers[1]);
      const lightness = Number(numbers[2]);
      if (Number.isFinite(hue) && Number.isFinite(saturation) && Number.isFinite(lightness)) {
        return hslToHex(hue, saturation, lightness);
      }
    }
  }

  return null;
}

function extractPreferredPaletteFromVariables(combined: string, fallback: ReferenceStyleContext["palette"]) {
  const variableMatches = [...combined.matchAll(/--([a-z0-9-_]+)\s*:\s*([^;}{\n]+)/gi)];
  if (variableMatches.length === 0) {
    return null;
  }

  const variableColors = new Map<string, string>();
  for (const match of variableMatches) {
    const variableName = (match[1] ?? "").toLowerCase();
    const rawValue = (match[2] ?? "").trim();
    if (!variableName || !rawValue) {
      continue;
    }
    const parsed = parseColorToken(rawValue);
    if (!parsed) {
      continue;
    }
    variableColors.set(variableName, parsed);
  }

  if (variableColors.size === 0) {
    return null;
  }

  const pick = (names: string[]) => {
    for (const name of names) {
      const color = variableColors.get(name);
      if (color) {
        return color;
      }
    }
    return null;
  };

  const primary = pick(["tw-primary", "ds-primary", "primary", "brand", "brand-primary"]);
  const secondary = pick(["tw-secondary", "ds-secondary", "secondary", "support", "brand-secondary"]);
  const accent = pick(["tw-accent", "ds-accent", "accent", "tertiary"]);
  const surface = pick(["tw-surface", "ds-surface", "surface", "background", "neutral"]);
  const text = pick(["tw-text", "ds-text", "text", "ink", "on-primary", "on-surface"]);

  if (!primary && !secondary && !accent && !surface && !text) {
    return null;
  }

  return {
    primary: primary ?? fallback.primary,
    secondary: secondary ?? fallback.secondary,
    accent: accent ?? primary ?? fallback.accent,
    surface: surface ?? fallback.surface,
    text: text ?? fallback.text
  };
}

function derivePaletteFromCandidates(
  candidates: string[],
  fallback: ReferenceStyleContext["palette"]
): ReferenceStyleContext["palette"] {
  if (candidates.length === 0) {
    return fallback;
  }

  const pool = uniqueHex(candidates);
  const bySaturation = [...pool].sort((left, right) => hexSaturation(right) - hexSaturation(left));
  const byLuminance = [...pool].sort((left, right) => hexLuminance(left) - hexLuminance(right));

  const primary = bySaturation.find((color) => {
    const luminance = hexLuminance(color);
    return luminance > 0.12 && luminance < 0.78;
  }) ?? fallback.primary;

  const accent = bySaturation.find((color) => {
    if (color === primary) {
      return false;
    }
    const luminance = hexLuminance(color);
    return luminance > 0.18 && luminance < 0.9;
  }) ?? fallback.accent;

  const secondary = pool.find((color) => {
    if (color === primary || color === accent) {
      return false;
    }
    const luminance = hexLuminance(color);
    return luminance > 0.1 && luminance < 0.68;
  }) ?? fallback.secondary;

  const surface = [...byLuminance]
    .reverse()
    .find((color) => color !== primary && color !== accent && hexLuminance(color) > 0.84) ?? fallback.surface;

  const text = byLuminance.find((color) => color !== surface && hexLuminance(color) < 0.24) ?? fallback.text;

  return {
    primary,
    secondary,
    accent,
    surface,
    text
  };
}

function normalizeFamily(rawFamily: string) {
  const cleaned = rawFamily
    .trim()
    .replace(/["']/g, "")
    .replace(/!important/gi, "")
    .replace(/\s+/g, " ")
    .replace(/,+/g, ",")
    .replace(/^\s*,|,\s*$/g, "");

  if (!cleaned) {
    return null;
  }

  const lowered = cleaned.toLowerCase();
  if (
    lowered.includes("inherit") ||
    lowered.includes("initial") ||
    lowered.includes("unset") ||
    lowered.startsWith("var(")
  ) {
    return null;
  }

  return cleaned;
}

function extractFontFamilies(text: string) {
  const families: string[] = [];
  for (const match of text.matchAll(/font-family\s*:\s*([^;\n}]+)/gi)) {
    const normalized = normalizeFamily(match[1] ?? "");
    if (normalized) {
      families.push(normalized);
    }
  }
  return families;
}

function deriveTypographyFromArtifacts(base: ReferenceStyleContext, combined: string) {
  const families = extractFontFamilies(combined);
  const headingFamily = families[0] ?? base.typography.headingFamily;
  const bodyFamily = families[1] ?? families[0] ?? base.typography.bodyFamily;

  const radiusMatches = [...combined.matchAll(/border-radius\s*:\s*(-?\d+(?:\.\d+)?)px/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 2 && value <= 64)
    .map((value) => Math.round(value));

  const cornerRadius =
    radiusMatches.length > 0
      ? radiusMatches.sort((left, right) => left - right)[Math.floor(radiusMatches.length / 2)]
      : base.typography.cornerRadius;

  return {
    headingFamily,
    bodyFamily,
    cornerRadius
  };
}

function uniqueNumberList(values: number[]) {
  const seen = new Set<number>();
  const output: number[] = [];
  for (const value of values) {
    const rounded = Math.round(value);
    if (seen.has(rounded)) {
      continue;
    }
    seen.add(rounded);
    output.push(rounded);
  }
  return output;
}

function buildSpacingScaleFromBase(baseUnit: number) {
  const base = Math.max(4, Math.min(16, Math.round(baseUnit)));
  return uniqueNumberList([base * 0.5, base, base * 1.5, base * 2, base * 2.5, base * 3, base * 4]);
}

function deriveSpacingScale(base: ReferenceStyleContext, combined: string) {
  const spacingValues = [...combined.matchAll(/(?:gap|padding|margin|inset|top|left|right|bottom)\s*:\s*(-?\d+(?:\.\d+)?)px/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 2 && value <= 72)
    .map((value) => Math.round(value));

  if (spacingValues.length === 0) {
    return base.spacingScale;
  }

  const sorted = uniqueNumberList(spacingValues).sort((left, right) => left - right);
  const meaningful = sorted.filter((value) => value >= 4 && value <= 40);
  if (meaningful.length >= 5) {
    return meaningful.slice(0, 7);
  }

  const baseUnit = meaningful.find((value) => value >= 6 && value <= 12) ?? meaningful[0] ?? base.spacingScale[1] ?? 8;
  return buildSpacingScaleFromBase(baseUnit);
}

function extractMedian(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function extractPxValuesByPattern(combined: string, pattern: RegExp) {
  return [...combined.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 120)
    .map((value) => Math.round(value));
}

function extractClassTokensForTag(combined: string, tagName: "button" | "input"): string[] {
  const pattern = new RegExp(
    `<${tagName}[^>]*class(?:Name)?\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)'|\\{\\s*['"\`]([^'"\`]+)['"\`]\\s*\\})`,
    "gi"
  );
  const tokens: string[] = [];
  for (const match of combined.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    tokens.push(
      ...raw
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
    );
  }
  return tokens;
}

function extractClassTokensByContextKeywords(combined: string, keywords: string[]): string[] {
  const pattern = /class(?:Name)?\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*['"`]([^'"`]+)['"`]\s*\})/gi;
  const tokens: string[] = [];
  for (const match of combined.matchAll(pattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw) {
      continue;
    }
    const lowered = raw.toLowerCase();
    if (!keywords.some((keyword) => lowered.includes(keyword))) {
      continue;
    }
    tokens.push(
      ...raw
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
    );
  }
  return tokens;
}

function extractRadiusFromTailwindTokens(tokens: string[]) {
  const radiusMap: Record<string, number> = {
    rounded: 4,
    "rounded-sm": 2,
    "rounded-md": 6,
    "rounded-lg": 8,
    "rounded-xl": 12,
    "rounded-2xl": 16,
    "rounded-3xl": 24,
    "rounded-full": 999,
    "rounded-none": 0
  };
  const values: number[] = [];
  for (const token of tokens) {
    const direct = radiusMap[token];
    if (typeof direct === "number") {
      values.push(direct);
      continue;
    }
    const pxMatch = token.match(/^rounded-\[(\d+(?:\.\d+)?)px\]$/i);
    if (pxMatch) {
      values.push(Math.round(Number(pxMatch[1])));
    }
  }
  return extractMedian(values);
}

function extractHeightFromTailwindTokens(tokens: string[]) {
  const values: number[] = [];
  for (const token of tokens) {
    const match = token.match(/^h-(\d+(?:\.\d+)?)$/i);
    if (!match) {
      continue;
    }
    const scale = Number(match[1]);
    if (!Number.isFinite(scale)) {
      continue;
    }
    values.push(Math.round(scale * 4));
  }
  return extractMedian(values);
}

type InlineElementSignals = {
  sampleCount: number;
  radii: number[];
  heights: number[];
  borderWidths: number[];
  hasShadow: boolean;
  hasTransparentBackground: boolean;
  hasSolidBackground: boolean;
  hasTintBackground: boolean;
  hasWhiteBackground: boolean;
  hasBorder: boolean;
  borderStyles: Array<"none" | "solid" | "subtle">;
  evidence: string[];
};

function normalizeStyleValue(value: string) {
  return value.trim().replace(/^['"`]/, "").replace(/['"`]$/, "").trim();
}

function toKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (token) => `-${token.toLowerCase()}`);
}

function parseLengthPx(value: string): number | null {
  const normalized = normalizeStyleValue(value).toLowerCase();
  const pxMatch = normalized.match(/(-?\d+(?:\.\d+)?)px\b/);
  if (pxMatch?.[1]) {
    const parsed = Number(pxMatch[1]);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

function parseStyleDeclarations(styleText: string) {
  const declarations = new Map<string, string>();
  for (const chunk of styleText.split(";")) {
    const separator = chunk.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const property = chunk.slice(0, separator).trim().toLowerCase();
    const value = chunk.slice(separator + 1).trim();
    if (!property || !value) {
      continue;
    }
    declarations.set(property, value);
  }
  return declarations;
}

function parseJsxStyleObject(styleObject: string) {
  const declarations = new Map<string, string>();
  for (const match of styleObject.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*:\s*([^,}]+)/g)) {
    const property = toKebabCase((match[1] ?? "").trim());
    const value = (match[2] ?? "").trim();
    if (!property || !value) {
      continue;
    }
    declarations.set(property, value);
  }
  return declarations;
}

function mergeDeclarations(
  target: Map<string, string>,
  source: Map<string, string>
) {
  for (const [key, value] of source.entries()) {
    target.set(key, value);
  }
}

function parseBorderStyleSignal(value: string): "none" | "solid" | "subtle" | null {
  const normalized = normalizeStyleValue(value).toLowerCase();
  if (normalized.includes("none")) {
    return "none";
  }
  if (normalized.includes("solid")) {
    return "solid";
  }
  if (normalized.includes("dashed") || normalized.includes("dotted")) {
    return "subtle";
  }
  return null;
}

function parseBorderWidthSignal(value: string): number | null {
  const normalized = normalizeStyleValue(value).toLowerCase();
  const pxMatch = normalized.match(/(-?\d+(?:\.\d+)?)px/);
  if (pxMatch?.[1]) {
    const parsed = Number(pxMatch[1]);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.round(numeric));
  }
  return null;
}

function extractTagInlineSignals(
  combined: string,
  tagName: "button" | "input"
): InlineElementSignals {
  const tagPattern = new RegExp(`<${tagName}\\b[\\s\\S]*?>`, "gi");
  const tagMatches = [...combined.matchAll(tagPattern)].map((match) => match[0] ?? "");
  const radii: number[] = [];
  const heights: number[] = [];
  const borderWidths: number[] = [];
  const borderStyles: Array<"none" | "solid" | "subtle"> = [];
  const evidence: string[] = [];
  let hasShadow = false;
  let hasTransparentBackground = false;
  let hasSolidBackground = false;
  let hasTintBackground = false;
  let hasWhiteBackground = false;
  let hasBorder = false;

  for (const tag of tagMatches) {
    const declarations = new Map<string, string>();

    const styleLiteral = tag.match(/style\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/style\s*=\s*'([^']*)'/i)?.[1];
    if (styleLiteral) {
      mergeDeclarations(declarations, parseStyleDeclarations(styleLiteral));
    }

    const jsxStyle = tag.match(/style\s*=\s*\{\{([\s\S]*?)\}\}/i)?.[1];
    if (jsxStyle) {
      mergeDeclarations(declarations, parseJsxStyleObject(jsxStyle));
    }

    if (declarations.size === 0) {
      continue;
    }

    evidence.push(`Detected inline ${tagName} style attributes.`);

    const radius = parseLengthPx(declarations.get("border-radius") ?? "");
    if (radius !== null) {
      radii.push(radius);
    }

    const explicitHeight =
      parseLengthPx(declarations.get("height") ?? "") ?? parseLengthPx(declarations.get("min-height") ?? "");
    if (explicitHeight !== null) {
      heights.push(explicitHeight);
    } else {
      const paddingTop = parseLengthPx(declarations.get("padding-top") ?? declarations.get("padding-block-start") ?? "");
      const paddingBottom = parseLengthPx(
        declarations.get("padding-bottom") ?? declarations.get("padding-block-end") ?? ""
      );
      const paddingY = parseLengthPx(declarations.get("padding") ?? "");
      if (paddingTop !== null && paddingBottom !== null) {
        heights.push(Math.max(24, paddingTop + paddingBottom + 18));
      } else if (paddingY !== null) {
        heights.push(Math.max(24, paddingY * 2 + 18));
      }
    }

    const borderWidth = parseBorderWidthSignal(declarations.get("border-width") ?? "");
    if (borderWidth !== null) {
      borderWidths.push(borderWidth);
      if (borderWidth > 0) {
        hasBorder = true;
      }
    }

    const borderShorthand = declarations.get("border");
    if (borderShorthand) {
      const shorthandWidth = parseBorderWidthSignal(borderShorthand);
      if (shorthandWidth !== null) {
        borderWidths.push(shorthandWidth);
        if (shorthandWidth > 0) {
          hasBorder = true;
        }
      }
      const shorthandStyle = parseBorderStyleSignal(borderShorthand);
      if (shorthandStyle) {
        borderStyles.push(shorthandStyle);
        if (shorthandStyle !== "none") {
          hasBorder = true;
        }
      }
    }

    const borderStyle = parseBorderStyleSignal(declarations.get("border-style") ?? "");
    if (borderStyle) {
      borderStyles.push(borderStyle);
      if (borderStyle !== "none") {
        hasBorder = true;
      }
    }

    const backgroundValue = normalizeStyleValue(
      declarations.get("background-color") ?? declarations.get("background") ?? ""
    ).toLowerCase();
    if (backgroundValue.includes("transparent") || backgroundValue === "none") {
      hasTransparentBackground = true;
    } else if (backgroundValue.length > 0) {
      hasSolidBackground = true;
      if (backgroundValue.includes("#fff") || backgroundValue.includes("white")) {
        hasWhiteBackground = true;
      }
      if (!backgroundValue.includes("white") && !backgroundValue.includes("#fff")) {
        hasTintBackground = true;
      }
    }

    const shadowValue = normalizeStyleValue(declarations.get("box-shadow") ?? "").toLowerCase();
    if (shadowValue.length > 0 && shadowValue !== "none") {
      hasShadow = true;
    }
  }

  return {
    sampleCount: tagMatches.length,
    radii,
    heights,
    borderWidths,
    hasShadow,
    hasTransparentBackground,
    hasSolidBackground,
    hasTintBackground,
    hasWhiteBackground,
    hasBorder,
    borderStyles,
    evidence: [...new Set(evidence)].slice(0, 2)
  };
}

function inferShapeFromMetrics(radius: number, controlHeight: number | null) {
  if (controlHeight !== null && controlHeight > 0 && radius >= controlHeight / 2 - 2) {
    return "pill" as const;
  }
  return inferShape(radius);
}

function inferBorderStyleFromWidth(borderWidth: number | null): "none" | "subtle" | "solid" {
  if (borderWidth === null || borderWidth <= 0) {
    return "none";
  }
  if (borderWidth <= 1) {
    return "subtle";
  }
  return "solid";
}

function inferButtonFillStyle(
  combined: string,
  classTokens: string[],
  inlineSignals: InlineElementSignals
): "solid" | "outline" | "ghost" | "mixed" {
  const hasSolidCssBackground =
    /button[^{}]*\{[^}]*background(?:-color)?\s*:\s*(?!transparent|none)[^;]+;/i.test(combined);
  const hasTransparentCssBackground =
    /button[^{}]*\{[^}]*background(?:-color)?\s*:\s*(transparent|none)/i.test(combined);
  const hasCssBorder =
    /button[^{}]*\{[^}]*border(?:-width)?\s*:\s*(?!0(?:px)?\b)[^;]+;/i.test(combined);
  const hasSolidClassBackground = classTokens.some((token) => /^bg-(?!transparent\b|none\b)/.test(token));
  const hasTransparentClassBackground = classTokens.some((token) => token === "bg-transparent");
  const hasClassBorder = classTokens.some((token) => token === "border" || /^border-/.test(token));
  const hasBorder = hasCssBorder || hasClassBorder || inlineSignals.hasBorder;
  const hasSolid =
    hasSolidCssBackground || hasSolidClassBackground || inlineSignals.hasSolidBackground;
  const hasTransparent =
    hasTransparentCssBackground ||
    hasTransparentClassBackground ||
    inlineSignals.hasTransparentBackground;

  if (hasSolid && hasTransparent) {
    return "mixed";
  }
  if (hasSolid) {
    return "solid";
  }
  if (hasTransparent && hasBorder) {
    return "outline";
  }
  if (hasTransparent && !hasBorder) {
    return "ghost";
  }
  if (hasBorder) {
    return "outline";
  }
  return "solid";
}

function inferInputFillStyle(
  combined: string,
  classTokens: string[],
  inlineSignals: InlineElementSignals
): "outline" | "ghost" | "tint" | "solid" {
  const hasTransparentCssBackground =
    /input[^{}]*\{[^}]*background(?:-color)?\s*:\s*(transparent|none)/i.test(combined);
  const hasColoredCssBackground =
    /input[^{}]*\{[^}]*background(?:-color)?\s*:\s*(?!transparent|none|#fff\b|#ffffff\b|white\b)[^;]+;/i.test(combined);
  const hasWhiteCssBackground =
    /input[^{}]*\{[^}]*background(?:-color)?\s*:\s*(#fff\b|#ffffff\b|white\b)/i.test(combined);
  const hasTintClass = classTokens.some((token) => /^bg-(?!transparent\b|white\b)/.test(token));
  const hasTransparentClass = classTokens.some((token) => token === "bg-transparent");
  const hasBorder = /input[^{}]*\{[^}]*border(?:-width)?\s*:\s*(?!0(?:px)?\b)[^;]+;/i.test(combined) ||
    classTokens.some((token) => token === "border" || /^border-/.test(token)) ||
    inlineSignals.hasBorder;

  if (hasTransparentCssBackground || hasTransparentClass || inlineSignals.hasTransparentBackground) {
    return hasBorder ? "outline" : "ghost";
  }
  if (hasColoredCssBackground || hasTintClass || inlineSignals.hasTintBackground) {
    return "tint";
  }
  if ((hasWhiteCssBackground || inlineSignals.hasWhiteBackground) && hasBorder) {
    return "outline";
  }
  return "solid";
}

function inferShape(radius: number) {
  if (radius >= 20) {
    return "pill";
  }
  if (radius >= 8) {
    return "rounded";
  }
  if (radius <= 3) {
    return "sharp";
  }
  return "mixed";
}

function collectExtractionEvidence(combined: string) {
  const snippets: string[] = [];
  const border = combined.match(/border-radius\s*:\s*[^;]+;/i)?.[0];
  if (border) {
    snippets.push(border.trim());
  }
  const shadow = combined.match(/box-shadow\s*:\s*[^;]+;/i)?.[0];
  if (shadow) {
    snippets.push(shadow.trim());
  }
  const hover = combined.match(/:[a-z-]*hover[a-z-]*\s*\{[^}]*\}/i)?.[0];
  if (hover) {
    snippets.push("Detected hover state styles.");
  }
  const focus = combined.match(/:[a-z-]*focus[a-z-]*\s*\{[^}]*\}/i)?.[0];
  if (focus) {
    snippets.push("Detected focus state styles.");
  }
  const disabled = combined.match(/:[a-z-]*disabled[a-z-]*\s*\{[^}]*\}/i)?.[0];
  if (disabled) {
    snippets.push("Detected disabled state styles.");
  }
  return [...new Set(snippets)].slice(0, 6);
}

function deriveComponentRecipes(base: ReferenceStyleContext, combined: string) {
  const recipes = buildComponentRecipesFromContext(base);
  const byFamily = new Map(recipes.map((recipe) => [recipe.family, { ...recipe }]));
  const evidence = collectExtractionEvidence(combined);
  const buttonClassTokens = [
    ...extractClassTokensForTag(combined, "button"),
    ...extractClassTokensByContextKeywords(combined, ["btn", "button", "cta", "action"])
  ];
  const inputClassTokens = [
    ...extractClassTokensForTag(combined, "input"),
    ...extractClassTokensByContextKeywords(combined, ["input", "field", "textfield", "form-control", "search"])
  ];
  const inlineButtonSignals = extractTagInlineSignals(combined, "button");
  const inlineInputSignals = extractTagInlineSignals(combined, "input");
  const buttonSelectorPattern = /(?:button|btn|cta|primary-action|secondary-action)[^{}]*\{[^}]*?border-radius\s*:\s*(-?\d+(?:\.\d+)?)px/gi;
  const buttonHeightPattern = /(?:button|btn|cta|primary-action|secondary-action)[^{}]*\{[^}]*?(?:min-height|height)\s*:\s*(-?\d+(?:\.\d+)?)px/gi;
  const buttonBorderPattern = /(?:button|btn|cta|primary-action|secondary-action)[^{}]*\{[^}]*?border(?:-width)?\s*:\s*(-?\d+(?:\.\d+)?)px/gi;
  const inputSelectorPattern = /(?:input|field|textfield|form-control|search)[^{}]*\{[^}]*?border-radius\s*:\s*(-?\d+(?:\.\d+)?)px/gi;
  const inputHeightPattern = /(?:input|field|textfield|form-control|search)[^{}]*\{[^}]*?(?:min-height|height|padding)\s*:\s*(-?\d+(?:\.\d+)?)px/gi;
  const inputBorderPattern = /(?:input|field|textfield|form-control|search)[^{}]*\{[^}]*?border(?:-width)?\s*:\s*(-?\d+(?:\.\d+)?)px/gi;

  const buttonRadius =
    extractMedian([
      ...extractPxValuesByPattern(combined, buttonSelectorPattern),
      ...inlineButtonSignals.radii
    ]) ?? extractRadiusFromTailwindTokens(buttonClassTokens);
  const buttonHeight =
    extractMedian([
      ...extractPxValuesByPattern(combined, buttonHeightPattern),
      ...inlineButtonSignals.heights
    ]) ?? extractHeightFromTailwindTokens(buttonClassTokens);
  const buttonBorder = extractMedian([
    ...extractPxValuesByPattern(combined, buttonBorderPattern),
    ...inlineButtonSignals.borderWidths
  ]);
  const buttonShadow =
    /button[^{}]*\{[^}]*box-shadow\s*:\s*[^;]+;/i.test(combined) ||
    buttonClassTokens.some((token) => token === "shadow" || /^shadow-/.test(token)) ||
    inlineButtonSignals.hasShadow;

  const inputRadius =
    extractMedian([
      ...extractPxValuesByPattern(combined, inputSelectorPattern),
      ...inlineInputSignals.radii
    ]) ?? extractRadiusFromTailwindTokens(inputClassTokens);
  const inputHeight =
    extractMedian([
      ...extractPxValuesByPattern(combined, inputHeightPattern),
      ...inlineInputSignals.heights
    ]) ?? extractHeightFromTailwindTokens(inputClassTokens);
  const inputBorder = extractMedian([
    ...extractPxValuesByPattern(combined, inputBorderPattern),
    ...inlineInputSignals.borderWidths
  ]);
  const cardRadius = extractMedian(
    extractPxValuesByPattern(combined, /(?:card|panel|surface)[^{}]*\{[^}]*?border-radius\s*:\s*(-?\d+(?:\.\d+)?)px/gi)
  );
  const cardShadow = /(card|panel|surface)[^{}]*\{[^}]*box-shadow\s*:\s*[^;]+;/i.test(combined);

  const button = byFamily.get("buttons");
  if (button) {
    if (buttonRadius !== null) {
      button.cornerRadius = buttonRadius;
      button.shape = inferShapeFromMetrics(buttonRadius, buttonHeight);
    }
    if (buttonHeight !== null) {
      button.controlHeight = buttonHeight;
    }
    if (buttonBorder !== null) {
      button.borderWidth = buttonBorder;
    }
    button.borderStyle = inferBorderStyleFromWidth(button.borderWidth);
    button.fillStyle = inferButtonFillStyle(combined, buttonClassTokens, inlineButtonSignals);
    button.shadowStyle = buttonShadow ? "soft" : "none";
    button.confidence =
      buttonRadius !== null ||
      buttonHeight !== null ||
      buttonClassTokens.length > 0 ||
      inlineButtonSignals.sampleCount > 0
        ? 0.86
        : 0.62;
    button.evidence = [...new Set([...button.evidence, ...evidence, ...inlineButtonSignals.evidence])].slice(0, 4);
    byFamily.set("buttons", button);
  }

  const inputs = byFamily.get("inputs");
  if (inputs) {
    if (inputRadius !== null) {
      inputs.cornerRadius = inputRadius;
      inputs.shape = inferShapeFromMetrics(inputRadius, inputHeight);
    }
    if (inputHeight !== null) {
      inputs.controlHeight = Math.max(32, inputHeight);
    }
    if (inputBorder !== null) {
      inputs.borderWidth = inputBorder;
    }
    inputs.borderStyle = inferBorderStyleFromWidth(inputs.borderWidth);
    inputs.fillStyle = inferInputFillStyle(combined, inputClassTokens, inlineInputSignals);
    inputs.confidence =
      inputRadius !== null ||
      inputHeight !== null ||
      inputClassTokens.length > 0 ||
      inlineInputSignals.sampleCount > 0
        ? 0.84
        : 0.6;
    inputs.evidence = [...new Set([...inputs.evidence, ...evidence, ...inlineInputSignals.evidence])].slice(0, 4);
    byFamily.set("inputs", inputs);
  }

  const cards = byFamily.get("cards");
  if (cards) {
    if (cardRadius !== null) {
      cards.cornerRadius = cardRadius;
      cards.shape = inferShape(cardRadius);
    }
    cards.shadowStyle = cardShadow ? "soft" : "none";
    cards.confidence = cardRadius !== null || cardShadow ? 0.72 : 0.58;
    cards.evidence = [...new Set([...cards.evidence, ...evidence])].slice(0, 4);
    byFamily.set("cards", cards);
  }

  return {
    componentRecipes: recipes.map((recipe) => byFamily.get(recipe.family) ?? recipe),
    extractionEvidence: evidence
  };
}

export function deriveStyleContextFromArtifacts(
  base: ReferenceStyleContext,
  artifacts: ArtifactSourceInput
): ReferenceStyleContext {
  const combined = `${artifacts.cssCode}\n\n${artifacts.sourceCode}\n\n${artifacts.exportHtml ?? ""}`;
  const colorCandidates = uniqueHex([
    ...extractHexColors(combined),
    ...extractRgbColors(combined),
    ...extractHslColors(combined)
  ]);
  const variablePalette = extractPreferredPaletteFromVariables(combined, base.palette);

  const nextContext: ReferenceStyleContext = {
    ...base,
    palette: variablePalette ?? derivePaletteFromCandidates(colorCandidates, base.palette),
    typography: deriveTypographyFromArtifacts(base, combined),
    spacingScale: deriveSpacingScale(base, combined)
  };

  const derivedRecipes = deriveComponentRecipes(nextContext, combined);
  const qualityReport = buildQualityReportFromRecipes(
    derivedRecipes.componentRecipes,
    derivedRecipes.extractionEvidence,
    null,
    {
      colorsDetected: colorCandidates.length,
      componentFamiliesDetected: derivedRecipes.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
    }
  );

  return {
    ...nextContext,
    componentRecipes: derivedRecipes.componentRecipes,
    extractionEvidence: derivedRecipes.extractionEvidence,
    qualityReport
  };
}
