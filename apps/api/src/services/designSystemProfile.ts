import type {
  ComponentRecipe,
  ComponentStateRecipe,
  DesignDensity,
  DesignMdColorToken,
  DesignMdTypographyToken,
  DesignSystemComponentFamily,
  DesignSystemQualityReport,
  DesignSystemSourceType,
  ReferenceStyleContext,
  StyleProfile
} from "@designer/shared";

const ALL_COMPONENT_FAMILIES: DesignSystemComponentFamily[] = [
  "buttons",
  "inputs",
  "cards",
  "navigation",
  "feedback",
  "data-display",
  "templates",
  "interaction-states",
  "iconography"
];

const COMPONENT_STATE_NAMES: ComponentStateRecipe["name"][] = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "error",
  "success"
];

const COMPONENT_STATE_EMPHASIS: ComponentStateRecipe["emphasis"][] = ["high", "medium", "low"];

const DEFAULT_STATE_SET = [
  { name: "default", emphasis: "high" },
  { name: "hover", emphasis: "medium" },
  { name: "focus", emphasis: "high" },
  { name: "active", emphasis: "high" },
  { name: "disabled", emphasis: "low" }
] as const;

type RecipeFallbackInput = {
  cornerRadius: number;
  spacingScale: number[];
  componentPatterns: string[];
};

function normalizeStateName(value: string | null | undefined): ComponentStateRecipe["name"] | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return COMPONENT_STATE_NAMES.find((name) => name === normalized) ?? null;
}

function normalizeStateEmphasis(value: string | null | undefined): ComponentStateRecipe["emphasis"] | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return COMPONENT_STATE_EMPHASIS.find((name) => name === normalized) ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampConfidence(value: number | undefined | null, fallback = 0.6) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, 0, 1);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeHexColor(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9a-f]{8}$/.test(normalized)) {
    return normalized.slice(0, 7);
  }
  return null;
}

function normalizeScale(values: number[], fallback: number[]) {
  const unique = [...new Set(values.map((value) => Math.round(value)).filter((value) => value >= 2 && value <= 128))].sort(
    (left, right) => left - right
  );
  if (unique.length >= 4) {
    return unique;
  }
  return fallback;
}

function inferShape(cornerRadius: number) {
  if (cornerRadius >= 20) {
    return "pill";
  }
  if (cornerRadius >= 8) {
    return "rounded";
  }
  if (cornerRadius <= 3) {
    return "sharp";
  }
  return "mixed";
}

function inferDensity(spacingScale: number[]): DesignDensity {
  const median = spacingScale[Math.floor(spacingScale.length / 2)] ?? 12;
  if (median <= 8) {
    return "compact";
  }
  if (median >= 18) {
    return "spacious";
  }
  return "comfortable";
}

function contrastLuminance(hex: string) {
  const safe = normalizeHexColor(hex) ?? "#000000";
  const channels = [1, 3, 5].map((offset) => Number.parseInt(safe.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const fg = contrastLuminance(foreground);
  const bg = contrastLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function inferContrastLevel(context: ReferenceStyleContext) {
  const ratio = contrastRatio(context.palette.text, context.palette.surface);
  if (ratio >= 7) {
    return "high";
  }
  if (ratio >= 4.5) {
    return "medium";
  }
  return "low";
}

function fallbackStates(family: DesignSystemComponentFamily): ComponentRecipe["states"] {
  if (family === "feedback") {
    return [
      { name: "default", emphasis: "medium", notes: "Informational neutral state." },
      { name: "success", emphasis: "high", notes: "Success confirmation." },
      { name: "error", emphasis: "high", notes: "Blocking error state." }
    ];
  }

  return DEFAULT_STATE_SET.map((state) => ({
    ...state
  }));
}

function defaultRecipeForFamily(family: DesignSystemComponentFamily, input: RecipeFallbackInput): ComponentRecipe {
  const spacingBase = input.spacingScale[1] ?? 8;
  const cornerRadius = clamp(input.cornerRadius, 4, 32);
  const shape = inferShape(cornerRadius);
  const density = inferDensity(input.spacingScale);

  const base: ComponentRecipe = {
    family,
    shape,
    cornerRadius,
    borderWidth: family === "cards" ? 1 : 1,
    borderStyle: family === "buttons" ? "solid" : "subtle",
    shadowStyle: family === "cards" || family === "templates" ? "soft" : "none",
    density,
    controlHeight: clamp(Math.round(spacingBase * 5.5), 36, 64),
    fillStyle: family === "buttons" ? "solid" : "tint",
    spacing: spacingBase,
    states: fallbackStates(family),
    iconStyle: "outlined",
    evidence: uniqueStrings(input.componentPatterns.slice(0, 3)),
    confidence: 0.62
  };

  if (family === "buttons") {
    return {
      ...base,
      fillStyle: shape === "pill" ? "solid" : "outline",
      borderStyle: shape === "pill" ? "none" : "solid",
      controlHeight: clamp(Math.round(spacingBase * 6), 40, 64)
    };
  }

  if (family === "inputs") {
    return {
      ...base,
      shape: shape === "pill" ? "rounded" : shape,
      fillStyle: "outline",
      borderStyle: "solid",
      shadowStyle: "none",
      controlHeight: clamp(Math.round(spacingBase * 6.2), 40, 68)
    };
  }

  if (family === "navigation") {
    return {
      ...base,
      fillStyle: "ghost",
      borderStyle: "subtle",
      controlHeight: clamp(Math.round(spacingBase * 5), 34, 56)
    };
  }

  if (family === "feedback") {
    return {
      ...base,
      fillStyle: "tint",
      borderStyle: "solid",
      controlHeight: clamp(Math.round(spacingBase * 4.5), 30, 52)
    };
  }

  if (family === "iconography") {
    return {
      ...base,
      shape: "mixed",
      fillStyle: "ghost",
      borderStyle: "none",
      shadowStyle: "none",
      controlHeight: clamp(Math.round(spacingBase * 4), 24, 48),
      iconStyle: "rounded-stroke"
    };
  }

  return base;
}

function normalizeRecipe(
  input: Partial<ComponentRecipe>,
  family: DesignSystemComponentFamily,
  fallback: RecipeFallbackInput
): ComponentRecipe {
  const base = defaultRecipeForFamily(family, fallback);
  const states = Array.isArray(input.states)
    ? input.states.reduce<ComponentStateRecipe[]>((accumulator, state) => {
        if (!state || typeof state !== "object") {
          return accumulator;
        }
        const row = state as Partial<ComponentStateRecipe>;
        const name = normalizeStateName(typeof row.name === "string" ? row.name : null);
        const emphasis = normalizeStateEmphasis(typeof row.emphasis === "string" ? row.emphasis : null);
        if (!name || !emphasis) {
          return accumulator;
        }
        const notes = typeof row.notes === "string" ? row.notes.trim() : "";
        accumulator.push({
          name,
          emphasis,
          ...(notes.length > 0 ? { notes } : {})
        });
        return accumulator;
      }, [])
    : [];

  return {
    ...base,
    shape:
      input.shape === "pill" || input.shape === "rounded" || input.shape === "sharp" || input.shape === "mixed"
        ? input.shape
        : base.shape,
    cornerRadius:
      typeof input.cornerRadius === "number" && Number.isFinite(input.cornerRadius)
        ? clamp(Math.round(input.cornerRadius), 0, 48)
        : base.cornerRadius,
    borderWidth:
      typeof input.borderWidth === "number" && Number.isFinite(input.borderWidth)
        ? clamp(Math.round(input.borderWidth), 0, 8)
        : base.borderWidth,
    borderStyle:
      input.borderStyle === "none" || input.borderStyle === "solid" || input.borderStyle === "subtle"
        ? input.borderStyle
        : base.borderStyle,
    shadowStyle:
      input.shadowStyle === "none" ||
      input.shadowStyle === "soft" ||
      input.shadowStyle === "medium" ||
      input.shadowStyle === "strong"
        ? input.shadowStyle
        : base.shadowStyle,
    density:
      input.density === "compact" || input.density === "comfortable" || input.density === "spacious"
        ? input.density
        : base.density,
    controlHeight:
      typeof input.controlHeight === "number" && Number.isFinite(input.controlHeight)
        ? clamp(Math.round(input.controlHeight), 20, 96)
        : base.controlHeight,
    fillStyle:
      input.fillStyle === "solid" ||
      input.fillStyle === "tint" ||
      input.fillStyle === "outline" ||
      input.fillStyle === "ghost" ||
      input.fillStyle === "mixed"
        ? input.fillStyle
        : base.fillStyle,
    iconStyle: typeof input.iconStyle === "string" && input.iconStyle.trim().length > 0 ? input.iconStyle.trim() : base.iconStyle,
    spacing:
      typeof input.spacing === "number" && Number.isFinite(input.spacing)
        ? clamp(Math.round(input.spacing), 2, 64)
        : base.spacing,
    states: states.length > 0 ? states : base.states,
    evidence: uniqueStrings(Array.isArray(input.evidence) ? input.evidence : base.evidence),
    confidence: clampConfidence(input.confidence, base.confidence)
  };
}

export function buildComponentRecipesFromContext(
  styleContext: ReferenceStyleContext,
  overrideRecipes?: ComponentRecipe[] | null
): ComponentRecipe[] {
  const fallbackInput: RecipeFallbackInput = {
    cornerRadius: styleContext.typography.cornerRadius,
    spacingScale: normalizeScale(styleContext.spacingScale, [4, 8, 12, 16, 20, 24, 32]),
    componentPatterns: styleContext.componentPatterns
  };

  const overrideMap = new Map<DesignSystemComponentFamily, Partial<ComponentRecipe>>();
  for (const recipe of overrideRecipes ?? styleContext.componentRecipes ?? []) {
    if (!recipe || typeof recipe !== "object" || !recipe.family) {
      continue;
    }
    overrideMap.set(recipe.family, recipe);
  }

  return ALL_COMPONENT_FAMILIES.map((family) =>
    normalizeRecipe(overrideMap.get(family) ?? {}, family, fallbackInput)
  );
}

export function buildQualityReportFromRecipes(
  recipes: ComponentRecipe[],
  fallbackEvidence: string[] = [],
  explicitScore?: number | null,
  options?: {
    colorsDetected?: number | null;
    componentFamiliesDetected?: number | null;
    qualityReasons?: string[] | null;
  }
): DesignSystemQualityReport {
  const familyConfidence = recipes.map((recipe) => ({
    family: recipe.family,
    confidence: clampConfidence(recipe.confidence),
    mismatch: recipe.confidence < 0.65 ? [`Low confidence for ${recipe.family} morphology.`] : [],
    evidence: recipe.evidence.length > 0 ? recipe.evidence.slice(0, 3) : fallbackEvidence.slice(0, 2)
  }));

  const average =
    familyConfidence.length > 0
      ? familyConfidence.reduce((sum, item) => sum + item.confidence, 0) / familyConfidence.length
      : 0.6;
  const fidelityScore = clampConfidence(explicitScore, average);
  const globalConfidence = clampConfidence(average, fidelityScore);
  const status = fidelityScore >= 0.82 ? "high" : fidelityScore >= 0.65 ? "medium" : "low";
  const confidentFamilies = familyConfidence.filter((item) => item.confidence >= 0.66).length;
  const colorsDetected = Math.max(0, Math.round(options?.colorsDetected ?? 5));
  const componentFamiliesDetected = Math.max(
    0,
    Math.round(options?.componentFamiliesDetected ?? confidentFamilies)
  );
  const qualityReasons = uniqueStrings([
    ...(options?.qualityReasons ?? []),
    ...(colorsDetected < 3 ? ["Limited reliable color extraction from references."] : []),
    ...(componentFamiliesDetected < 4 ? ["Limited component-family confidence from references."] : []),
    ...familyConfidence.flatMap((item) => item.mismatch)
  ]);
  const referenceQuality: DesignSystemQualityReport["referenceQuality"] =
    status === "high" && colorsDetected >= 4 && componentFamiliesDetected >= 5
      ? "good"
      : status === "low" || colorsDetected < 2 || componentFamiliesDetected < 3
        ? "poor"
        : "medium";
  const recommendations: string[] = [];
  if (referenceQuality === "poor") {
    recommendations.push("Add clearer references or calibrate component shape/border/elevation in chat.");
  } else if (referenceQuality === "medium") {
    recommendations.push("Review key component families and calibrate if shape drift remains.");
  }
  if (qualityReasons.length === 0 && referenceQuality === "good") {
    recommendations.push("Reference quality is strong; proceed with strict design-system generation.");
  }
  if (qualityReasons.length > 0) {
    recommendations.push(...qualityReasons.slice(0, 3));
  }

  return {
    fidelityScore,
    globalConfidence,
    status,
    referenceQuality,
    detectionCoverage: {
      colorsDetected,
      componentFamiliesDetected
    },
    qualityReasons,
    familyConfidence,
    recommendations: uniqueStrings(recommendations)
  };
}

function resolveSourceType(styleContext: ReferenceStyleContext, fallback: DesignSystemSourceType) {
  if (styleContext.source === "figma-public-link") {
    return "figma-reference";
  }
  return fallback;
}

function buildColorTokens(styleContext: ReferenceStyleContext): DesignMdColorToken[] {
  const tokens = [
    {
      name: "Primary",
      hex: normalizeHexColor(styleContext.palette.primary),
      role: "CTAs, active states, key interactive elements"
    },
    {
      name: "Secondary",
      hex: normalizeHexColor(styleContext.palette.secondary),
      role: "Supporting actions and selection controls"
    },
    {
      name: "Accent",
      hex: normalizeHexColor(styleContext.palette.accent),
      role: "Highlights, badges, decorative accents"
    },
    {
      name: "Background",
      hex: normalizeHexColor(styleContext.palette.background ?? styleContext.palette.surface),
      role: "Primary page and app background"
    },
    {
      name: "Surface",
      hex: normalizeHexColor(styleContext.palette.surface),
      role: "Cards, panels, and container surfaces"
    },
    {
      name: "Text",
      hex: normalizeHexColor(styleContext.palette.text),
      role: "Primary readable text and icon ink"
    }
  ];

  return tokens
    .filter((token): token is DesignMdColorToken => Boolean(token.hex))
    .map((token) => ({
      ...token,
      hex: token.hex
    }));
}

function buildTypographyTokens(styleContext: ReferenceStyleContext): DesignMdTypographyToken {
  return {
    headlineFont: styleContext.typography.headingFamily,
    bodyFont: styleContext.typography.bodyFamily,
    labelFont: styleContext.typography.bodyFamily,
    notes: [
      "Use heading family for titles and high-emphasis labels.",
      "Use body family for body copy and supporting metadata.",
      "Keep label size compact and consistent across controls."
    ]
  };
}

export function buildStyleProfileFromStyleContext(input: {
  styleContext: ReferenceStyleContext;
  sourceType?: DesignSystemSourceType;
  componentRecipes?: ComponentRecipe[] | null;
  extractionEvidence?: string[];
  explicitQualityScore?: number | null;
}): { styleProfile: StyleProfile; qualityReport: DesignSystemQualityReport } {
  const styleContext = input.styleContext;
  const colors = buildColorTokens(styleContext);
  const typography = buildTypographyTokens(styleContext);
  const spacingScale = normalizeScale(styleContext.spacingScale, [4, 8, 12, 16, 20, 24, 32]);
  const componentRecipes = buildComponentRecipesFromContext(styleContext, input.componentRecipes);
  const sourceType = resolveSourceType(styleContext, input.sourceType ?? "manual");

  const extractionEvidence = uniqueStrings([
    ...(input.extractionEvidence ?? []),
    ...(styleContext.extractionEvidence ?? []),
    ...styleContext.componentPatterns.slice(0, 4),
    ...styleContext.layoutMotifs.slice(0, 3)
  ]);

  const qualityReport = buildQualityReportFromRecipes(
    componentRecipes,
    extractionEvidence,
    input.explicitQualityScore ?? styleContext.qualityReport?.fidelityScore ?? null,
    {
      colorsDetected: colors.length,
      componentFamiliesDetected: componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
    }
  );

  return {
    styleProfile: {
      sourceType,
      foundations: {
        toneKeywords: uniqueStrings([
          ...styleContext.layoutMotifs
            .join(", ")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 5),
          "clear",
          "focused"
        ]).slice(0, 6),
        density: inferDensity(spacingScale),
        contrast: inferContrastLevel(styleContext)
      },
      tokens: {
        colors,
        typography,
        spacingScale,
        radiusScale: normalizeScale([styleContext.typography.cornerRadius, styleContext.typography.cornerRadius * 1.5], [
          styleContext.typography.cornerRadius,
          Math.max(0, styleContext.typography.cornerRadius - 4),
          styleContext.typography.cornerRadius + 6
        ]),
        borderWidths: normalizeScale(
          componentRecipes.map((recipe) => recipe.borderWidth),
          [0, 1, 2]
        ),
        shadows: uniqueStrings(componentRecipes.map((recipe) => recipe.shadowStyle)),
        opacityScale: [0.38, 0.62, 0.82, 1]
      },
      componentRecipes,
      extractionEvidence
    },
    qualityReport
  };
}

export function mergeStyleProfiles(profiles: StyleProfile[]): StyleProfile | null {
  if (profiles.length === 0) {
    return null;
  }

  const ordered = profiles.filter((profile) => profile.componentRecipes.length > 0);
  if (ordered.length === 0) {
    return profiles[0];
  }

  const primary = ordered[0];
  const mergedRecipes: ComponentRecipe[] = ALL_COMPONENT_FAMILIES.map((family) => {
    const candidates = ordered
      .map((profile, index) => {
        const recipe = profile.componentRecipes.find((row) => row.family === family);
        if (!recipe) {
          return null;
        }
        return {
          recipe,
          priority: index
        };
      })
      .filter((item): item is { recipe: ComponentRecipe; priority: number } => Boolean(item))
      .sort((left, right) => {
        if (right.recipe.confidence !== left.recipe.confidence) {
          return right.recipe.confidence - left.recipe.confidence;
        }
        return left.priority - right.priority;
      });

    return candidates[0]?.recipe ?? primary.componentRecipes.find((row) => row.family === family)!;
  });

  return {
    ...primary,
    tokens: {
      ...primary.tokens,
      colors: primary.tokens.colors.length > 0 ? primary.tokens.colors : ordered[0].tokens.colors
    },
    componentRecipes: mergedRecipes,
    extractionEvidence: uniqueStrings(ordered.flatMap((profile) => profile.extractionEvidence)).slice(0, 16)
  };
}

function recipeSpecificityScore(recipe: ComponentRecipe) {
  let score = 0;
  if (recipe.shape !== "rounded") {
    score += 0.05;
  }
  if (recipe.fillStyle !== "solid") {
    score += 0.04;
  }
  if (recipe.borderStyle !== "solid") {
    score += 0.03;
  }
  if (recipe.shadowStyle !== "none") {
    score += 0.03;
  }
  if (recipe.controlHeight >= 48) {
    score += 0.02;
  }
  return score;
}

function recipeStrengthScore(recipe: ComponentRecipe) {
  const confidence = clampConfidence(recipe.confidence, 0.6);
  const evidenceScore = Math.min(0.1, recipe.evidence.length * 0.02);
  return confidence + evidenceScore + recipeSpecificityScore(recipe);
}

function mergeRecipePair(primary: ComponentRecipe, secondary: ComponentRecipe) {
  const primaryScore = recipeStrengthScore(primary);
  const secondaryScore = recipeStrengthScore(secondary);
  const winner = secondaryScore > primaryScore + 0.03 ? secondary : primary;
  const runnerUp = winner === primary ? secondary : primary;
  const states = winner.states.length > 0 ? winner.states : runnerUp.states;
  return {
    ...winner,
    states,
    evidence: uniqueStrings([...winner.evidence, ...runnerUp.evidence]).slice(0, 6),
    confidence: clampConfidence(Math.max(primary.confidence, secondary.confidence, winner.confidence))
  };
}

export function mergeComponentRecipeSets(
  primary: ComponentRecipe[] | null | undefined,
  secondary: ComponentRecipe[] | null | undefined
): ComponentRecipe[] {
  const primaryMap = new Map((primary ?? []).map((recipe) => [recipe.family, recipe]));
  const secondaryMap = new Map((secondary ?? []).map((recipe) => [recipe.family, recipe]));

  return ALL_COMPONENT_FAMILIES.reduce<ComponentRecipe[]>((accumulator, family) => {
    const left = primaryMap.get(family);
    const right = secondaryMap.get(family);
    if (left && right) {
      accumulator.push(mergeRecipePair(left, right));
      return accumulator;
    }
    if (left) {
      accumulator.push(left);
      return accumulator;
    }
    if (right) {
      accumulator.push(right);
      return accumulator;
    }
    return accumulator;
  }, []);
}

export type StyleCalibrationUpdate = {
  family: DesignSystemComponentFamily;
  field:
    | "shape"
    | "cornerRadius"
    | "borderWidth"
    | "borderStyle"
    | "shadowStyle"
    | "density"
    | "controlHeight"
    | "fillStyle"
    | "iconStyle";
  value: string | number;
};

export function applyStyleCalibration(profile: StyleProfile, updates: StyleCalibrationUpdate[]) {
  const byFamily = new Map<DesignSystemComponentFamily, ComponentRecipe>(
    profile.componentRecipes.map((recipe) => [recipe.family, { ...recipe }])
  );
  const applied: string[] = [];

  for (const update of updates) {
    const current = byFamily.get(update.family);
    if (!current) {
      continue;
    }

    switch (update.field) {
      case "shape":
        if (
          update.value === "pill" ||
          update.value === "rounded" ||
          update.value === "sharp" ||
          update.value === "mixed"
        ) {
          current.shape = update.value;
          applied.push(`${update.family}.shape=${update.value}`);
        }
        break;
      case "cornerRadius":
        if (typeof update.value === "number" && Number.isFinite(update.value)) {
          current.cornerRadius = clamp(Math.round(update.value), 0, 48);
          applied.push(`${update.family}.cornerRadius=${current.cornerRadius}`);
        }
        break;
      case "borderWidth":
        if (typeof update.value === "number" && Number.isFinite(update.value)) {
          current.borderWidth = clamp(Math.round(update.value), 0, 8);
          applied.push(`${update.family}.borderWidth=${current.borderWidth}`);
        }
        break;
      case "borderStyle":
        if (update.value === "none" || update.value === "solid" || update.value === "subtle") {
          current.borderStyle = update.value;
          applied.push(`${update.family}.borderStyle=${update.value}`);
        }
        break;
      case "shadowStyle":
        if (
          update.value === "none" ||
          update.value === "soft" ||
          update.value === "medium" ||
          update.value === "strong"
        ) {
          current.shadowStyle = update.value;
          applied.push(`${update.family}.shadowStyle=${update.value}`);
        }
        break;
      case "density":
        if (update.value === "compact" || update.value === "comfortable" || update.value === "spacious") {
          current.density = update.value;
          applied.push(`${update.family}.density=${update.value}`);
        }
        break;
      case "controlHeight":
        if (typeof update.value === "number" && Number.isFinite(update.value)) {
          current.controlHeight = clamp(Math.round(update.value), 20, 96);
          applied.push(`${update.family}.controlHeight=${current.controlHeight}`);
        }
        break;
      case "fillStyle":
        if (
          update.value === "solid" ||
          update.value === "tint" ||
          update.value === "outline" ||
          update.value === "ghost" ||
          update.value === "mixed"
        ) {
          current.fillStyle = update.value;
          applied.push(`${update.family}.fillStyle=${update.value}`);
        }
        break;
      case "iconStyle":
        if (typeof update.value === "string" && update.value.trim().length > 0) {
          current.iconStyle = update.value.trim();
          applied.push(`${update.family}.iconStyle=${current.iconStyle}`);
        }
        break;
      default:
        break;
    }

    current.confidence = clampConfidence(current.confidence + 0.08);
    byFamily.set(update.family, current);
  }

  const updatedRecipes = ALL_COMPONENT_FAMILIES.map(
    (family) => byFamily.get(family) ?? profile.componentRecipes.find((row) => row.family === family)!
  );

  return {
    profile: {
      ...profile,
      componentRecipes: updatedRecipes,
      extractionEvidence: uniqueStrings([...profile.extractionEvidence, `Calibration updates: ${applied.join(", ")}`])
    },
    applied
  };
}
