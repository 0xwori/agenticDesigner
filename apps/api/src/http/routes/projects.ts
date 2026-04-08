import type { Express } from "express";
import type {
  ComponentRecipe,
  ComponentStateRecipe,
  DesignSystemComponentFamily,
  DesignSystemQualityReport,
  StyleProfile
} from "@designer/shared";
import type { ApiDeps } from "../deps.js";
import { sendApiError } from "../errors.js";
import { parseOptionalProvider } from "../parsers.js";
import {
  applyStyleCalibration,
  buildQualityReportFromRecipes,
  buildStyleProfileFromStyleContext,
  mergeComponentRecipeSets,
  mergeStyleProfiles,
  type StyleCalibrationUpdate
} from "../../services/designSystemProfile.js";

type ProjectBundle = NonNullable<Awaited<ReturnType<ApiDeps["getProjectBundle"]>>>;
type NonNullStyleContext = NonNullable<ProjectBundle["references"][number]["extractedStyleContext"]>;

const DESIGN_SYSTEM_FAMILIES: DesignSystemComponentFamily[] = [
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

function normalizeComponentFamily(value: string | null): DesignSystemComponentFamily | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  const alias =
    normalized === "data" || normalized === "data display" || normalized === "data_display"
      ? "data-display"
      : normalized.replaceAll(" ", "-").replaceAll("_", "-");
  return DESIGN_SYSTEM_FAMILIES.find((family) => family === alias) ?? null;
}

function normalizeComponentStateName(value: string | null): ComponentStateRecipe["name"] | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return COMPONENT_STATE_NAMES.find((entry) => entry === normalized) ?? null;
}

function normalizeComponentStateEmphasis(value: string | null): ComponentStateRecipe["emphasis"] | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return COMPONENT_STATE_EMPHASIS.find((entry) => entry === normalized) ?? null;
}

async function upsertDesignSystemFromStyleContext(
  deps: ApiDeps,
  input: {
    projectId: string;
    styleContext: NonNullStyleContext;
    sourceType: "manual" | "figma-reference" | "image-reference" | "chat";
    sourceReferenceId?: string | null;
    status?: "empty" | "draft" | "approved";
    overview?: string;
    styleProfile?: StyleProfile | null;
  }
) {
  const normalizedSourceReferenceId =
    input.sourceType === "figma-reference" ? (input.sourceReferenceId ?? null) : null;
  const profileBundle = buildStyleProfileFromStyleContext({
    styleContext: input.styleContext,
    sourceType: input.sourceType,
    componentRecipes: input.styleProfile?.componentRecipes ?? input.styleContext.componentRecipes,
    extractionEvidence: input.styleProfile?.extractionEvidence ?? input.styleContext.extractionEvidence,
    explicitQualityScore: input.styleContext.qualityReport?.fidelityScore ?? null
  });
  const styleProfile = input.styleProfile ?? profileBundle.styleProfile;
  const qualityReport = buildQualityReportFromRecipes(
    styleProfile.componentRecipes,
    styleProfile.extractionEvidence,
    input.styleContext.qualityReport?.fidelityScore ?? profileBundle.qualityReport.fidelityScore,
    {
      colorsDetected: styleProfile.tokens.colors.length,
      componentFamiliesDetected: styleProfile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
    }
  );
  const markdown = deps.generateDesignMarkdownFromStyleContext(
    input.styleContext,
    input.overview,
    styleProfile,
    qualityReport
  );
  const parsed = deps.parseDesignMarkdown(markdown, input.styleContext, {
    styleProfile,
    qualityReport
  });
  return deps.upsertProjectDesignSystem({
    projectId: input.projectId,
    markdown: parsed.markdown,
    structuredTokens: parsed.structuredTokens,
    status: input.status ?? "draft",
    sourceType: input.sourceType,
    sourceReferenceId: normalizedSourceReferenceId
  });
}

function buildFallbackStyleContext(): NonNullStyleContext {
  return {
    source: "heuristic",
    palette: {
      primary: "#8b8f98",
      secondary: "#6f7785",
      accent: "#9b8f82",
      surface: "#f5f5f6",
      text: "#202327"
    },
    typography: {
      headingFamily: "Sora, ui-sans-serif, system-ui",
      bodyFamily: "Manrope, ui-sans-serif, system-ui",
      cornerRadius: 12
    },
    spacingScale: [4, 8, 12, 16, 20, 24, 32],
    componentPatterns: ["buttons", "inputs", "cards", "navigation", "data display"],
    layoutMotifs: ["content + rail", "stacked sections", "safe-area mobile layout"]
  };
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function toNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function buildImageStyleContextFromPassOutputs(
  passOutputs: Record<string, unknown> | null,
  fallback: NonNullStyleContext
): NonNullStyleContext | null {
  if (!passOutputs) {
    return null;
  }
  const imageSpecRaw = passOutputs.imageSpec;
  if (!imageSpecRaw || typeof imageSpecRaw !== "object") {
    return null;
  }

  const imageSpec = imageSpecRaw as Record<string, unknown>;
  const colorTokens =
    imageSpec.colorTokens && typeof imageSpec.colorTokens === "object"
      ? (imageSpec.colorTokens as Record<string, unknown>)
      : {};
  const typography =
    imageSpec.typography && typeof imageSpec.typography === "object"
      ? (imageSpec.typography as Record<string, unknown>)
      : {};
  const spacing =
    imageSpec.spacing && typeof imageSpec.spacing === "object"
      ? (imageSpec.spacing as Record<string, unknown>)
      : {};
  const layoutRegions = Array.isArray(imageSpec.layoutRegions)
    ? imageSpec.layoutRegions
        .map((region) => {
          if (!region || typeof region !== "object") {
            return null;
          }
          const row = region as Record<string, unknown>;
          const role = toNonEmptyString(row.role);
          const name = toNonEmptyString(row.name);
          if (!role || !name) {
            return null;
          }
          return `${role}: ${name}`;
        })
        .filter((item): item is string => Boolean(item))
    : [];

  const baseUnit = Math.max(4, Math.min(16, Math.round(toNumber(spacing.baseUnit, fallback.spacingScale[1] ?? 8))));
  const spacingScale = [0.5, 1, 1.5, 2, 2.5, 3, 4].map((multiplier) => Math.max(2, Math.round(baseUnit * multiplier)));

  const primary =
    toNonEmptyString(colorTokens.primary) ??
    toNonEmptyString(colorTokens.accent) ??
    fallback.palette.primary;
  const secondary =
    toNonEmptyString(colorTokens.secondary) ??
    toNonEmptyString(colorTokens.textSecondary) ??
    fallback.palette.secondary;
  const accent =
    toNonEmptyString(colorTokens.accent) ??
    toNonEmptyString(colorTokens.primary) ??
    fallback.palette.accent;

  return {
    source: "heuristic",
    palette: {
      primary,
      secondary,
      accent,
      surface:
        toNonEmptyString(colorTokens.background) ??
        toNonEmptyString(colorTokens.surface) ??
        fallback.palette.surface,
      text: toNonEmptyString(colorTokens.textPrimary) ?? fallback.palette.text
    },
    typography: {
      headingFamily: toNonEmptyString(typography.headingFamily) ?? fallback.typography.headingFamily,
      bodyFamily: toNonEmptyString(typography.bodyFamily) ?? fallback.typography.bodyFamily,
      cornerRadius: Math.max(4, Math.min(32, Math.round(toNumber(spacing.radius, fallback.typography.cornerRadius))))
    },
    spacingScale,
    componentPatterns: toStringArray(imageSpec.componentCandidates).slice(0, 7),
    layoutMotifs: [...layoutRegions, ...toStringArray(imageSpec.interactionHints)].slice(0, 6),
    componentRecipes: Array.isArray(imageSpec.componentRecipes)
      ? imageSpec.componentRecipes.reduce<ComponentRecipe[]>((accumulator, recipe) => {
          if (!recipe || typeof recipe !== "object") {
            return accumulator;
          }
          const row = recipe as Record<string, unknown>;
          const family = normalizeComponentFamily(toNonEmptyString(row.family));
          if (!family) {
            return accumulator;
          }
          const states = Array.isArray(row.states)
            ? row.states.reduce<ComponentStateRecipe[]>((stateAccumulator, state) => {
                if (!state || typeof state !== "object") {
                  return stateAccumulator;
                }
                const stateRow = state as Record<string, unknown>;
                const name = normalizeComponentStateName(toNonEmptyString(stateRow.name));
                const emphasis = normalizeComponentStateEmphasis(toNonEmptyString(stateRow.emphasis));
                if (!name || !emphasis) {
                  return stateAccumulator;
                }
                const notes = toNonEmptyString(stateRow.notes);
                stateAccumulator.push({
                  name,
                  emphasis,
                  ...(notes ? { notes } : {})
                });
                return stateAccumulator;
              }, [])
            : [];

          const shape = toNonEmptyString(row.shape);
          const borderStyle = toNonEmptyString(row.borderStyle);
          const shadowStyle = toNonEmptyString(row.shadowStyle);
          const density = toNonEmptyString(row.density);
          const fillStyle = toNonEmptyString(row.fillStyle);

          accumulator.push({
            family,
            shape:
              shape === "pill" || shape === "rounded" || shape === "sharp" || shape === "mixed"
                ? shape
                : "rounded",
            cornerRadius: Math.max(0, Math.round(toNumber(row.cornerRadius, fallback.typography.cornerRadius))),
            borderWidth: Math.max(0, Math.round(toNumber(row.borderWidth, 1))),
            borderStyle:
              borderStyle === "none" || borderStyle === "solid" || borderStyle === "subtle"
                ? borderStyle
                : "solid",
            shadowStyle:
              shadowStyle === "none" || shadowStyle === "soft" || shadowStyle === "medium" || shadowStyle === "strong"
                ? shadowStyle
                : "soft",
            density: density === "compact" || density === "comfortable" || density === "spacious" ? density : "comfortable",
            controlHeight: Math.max(20, Math.round(toNumber(row.controlHeight, 44))),
            fillStyle:
              fillStyle === "solid" ||
              fillStyle === "tint" ||
              fillStyle === "outline" ||
              fillStyle === "ghost" ||
              fillStyle === "mixed"
                ? fillStyle
                : "solid",
            iconStyle: toNonEmptyString(row.iconStyle) ?? undefined,
            confidence: Math.max(0, Math.min(1, toNumber(row.confidence, 0.6))),
            evidence: toStringArray(row.evidence),
            states
          });
          return accumulator;
        }, [])
      : [],
    extractionEvidence: toStringArray(imageSpec.extractionEvidence),
    qualityReport:
      imageSpec.qualityReport && typeof imageSpec.qualityReport === "object"
        ? (() => {
            const report = imageSpec.qualityReport as Record<string, unknown>;
            const statusRaw = toNonEmptyString(report.status) ?? "medium";
            const status: DesignSystemQualityReport["status"] =
              statusRaw === "high" || statusRaw === "medium" || statusRaw === "low" ? statusRaw : "medium";
            const familyConfidence = Array.isArray(report.familyConfidence)
              ? report.familyConfidence.reduce<DesignSystemQualityReport["familyConfidence"]>((accumulator, item) => {
                  if (!item || typeof item !== "object") {
                    return accumulator;
                  }
                  const row = item as Record<string, unknown>;
                  const family = normalizeComponentFamily(toNonEmptyString(row.family));
                  if (!family) {
                    return accumulator;
                  }
                  accumulator.push({
                    family,
                    confidence: Math.max(0, Math.min(1, toNumber(row.confidence, 0.6))),
                    mismatch: toStringArray(row.mismatch),
                    evidence: toStringArray(row.evidence)
                  });
                  return accumulator;
                }, [])
              : [];
            return {
              fidelityScore: Math.max(0, Math.min(1, toNumber(report.fidelityScore, 0.6))),
              globalConfidence: Math.max(0, Math.min(1, toNumber(report.globalConfidence, 0.6))),
              status,
              referenceQuality:
                report.referenceQuality === "good" ||
                report.referenceQuality === "medium" ||
                report.referenceQuality === "poor"
                  ? report.referenceQuality
                  : status === "high"
                    ? "good"
                    : status === "low"
                      ? "poor"
                      : "medium",
              detectionCoverage:
                report.detectionCoverage && typeof report.detectionCoverage === "object"
                  ? {
                      colorsDetected: Math.max(
                        0,
                        Math.round(
                          toNumber(
                            (report.detectionCoverage as Record<string, unknown>).colorsDetected,
                            0
                          )
                        )
                      ),
                      componentFamiliesDetected: Math.max(
                        0,
                        Math.round(
                          toNumber(
                            (report.detectionCoverage as Record<string, unknown>).componentFamiliesDetected,
                            0
                          )
                        )
                      )
                    }
                  : {
                      colorsDetected: 0,
                      componentFamiliesDetected: 0
                    },
              qualityReasons: toStringArray(report.qualityReasons),
              familyConfidence,
              recommendations: toStringArray(report.recommendations)
            } satisfies DesignSystemQualityReport;
          })()
        : null
  };
}

function buildStyleContextFromProfile(profile: StyleProfile, fallback: NonNullStyleContext): NonNullStyleContext {
  const color = (names: string[], defaultValue: string) => {
    const token = profile.tokens.colors.find((entry) =>
      names.some((name) => entry.name.toLowerCase().includes(name))
    );
    return token?.hex ?? defaultValue;
  };

  const buttonRecipe = profile.componentRecipes.find((recipe) => recipe.family === "buttons");

  return {
    source: profile.sourceType === "figma-reference" ? "figma-public-link" : "heuristic",
    palette: {
      primary: color(["primary", "brand"], fallback.palette.primary),
      secondary: color(["secondary", "support"], fallback.palette.secondary),
      accent: color(["accent", "tertiary"], fallback.palette.accent),
      surface: color(["surface", "neutral", "background"], fallback.palette.surface),
      text: color(["text", "ink", "on"], fallback.palette.text)
    },
    typography: {
      headingFamily: profile.tokens.typography.headlineFont || fallback.typography.headingFamily,
      bodyFamily: profile.tokens.typography.bodyFont || fallback.typography.bodyFamily,
      cornerRadius: buttonRecipe?.cornerRadius ?? fallback.typography.cornerRadius
    },
    spacingScale:
      profile.tokens.spacingScale.length > 0 ? profile.tokens.spacingScale : fallback.spacingScale,
    componentPatterns:
      profile.componentRecipes.length > 0
        ? profile.componentRecipes.map((recipe) => `${recipe.family}:${recipe.shape}`).slice(0, 8)
        : fallback.componentPatterns,
    layoutMotifs:
      profile.foundations.toneKeywords.length > 0
        ? profile.foundations.toneKeywords.slice(0, 6)
        : fallback.layoutMotifs,
    componentRecipes: profile.componentRecipes,
    extractionEvidence: profile.extractionEvidence,
    qualityReport: buildQualityReportFromRecipes(profile.componentRecipes, profile.extractionEvidence, undefined, {
      colorsDetected: profile.tokens.colors.length,
      componentFamiliesDetected: profile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
    })
  };
}

function parseCalibrationUpdates(rawValue: unknown): StyleCalibrationUpdate[] {
  const parseToken = (token: string): StyleCalibrationUpdate | null => {
    const normalized = token.trim();
    if (!normalized.includes("=") || !normalized.includes(".")) {
      return null;
    }
    const [left, right] = normalized.split("=");
    const [familyRaw, fieldRaw] = left.split(".");
    const family = familyRaw?.trim() ?? "";
    const field = fieldRaw?.trim() ?? "";
    const value = right?.trim() ?? "";
    if (!family || !field || !value) {
      return null;
    }

    const normalizedFamily = normalizeComponentFamily(family);
    const normalizedField = field.replaceAll("_", "");
    if (!normalizedFamily) {
      return null;
    }

    const numeric = Number(value);
    const maybeNumber = Number.isFinite(numeric) ? numeric : value;

    const fieldMap: Record<string, StyleCalibrationUpdate["field"] | undefined> = {
      shape: "shape",
      cornerradius: "cornerRadius",
      borderwidth: "borderWidth",
      borderstyle: "borderStyle",
      shadowstyle: "shadowStyle",
      density: "density",
      controlheight: "controlHeight",
      fillstyle: "fillStyle",
      iconstyle: "iconStyle"
    };
    const mappedField = fieldMap[normalizedField.toLowerCase()];
    if (!mappedField) {
      return null;
    }

    return {
      family: normalizedFamily as StyleCalibrationUpdate["family"],
      field: mappedField,
      value: maybeNumber
    };
  };

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as Record<string, unknown>;
        const family = toNonEmptyString(row.family);
        const field = toNonEmptyString(row.field);
        const value = row.value;
        if (!family || !field || value === undefined || value === null) {
          return null;
        }
        return parseToken(`${family}.${field}=${String(value)}`);
      })
      .filter((item): item is StyleCalibrationUpdate => Boolean(item));
  }

  if (typeof rawValue === "string") {
    return rawValue
      .split(/\s+/)
      .map((token) => parseToken(token))
      .filter((item): item is StyleCalibrationUpdate => Boolean(item));
  }

  return [];
}

type DesignSystemReferenceSelection =
  | {
      sourceType: "figma-reference";
      referenceSourceId: string;
    }
  | {
      sourceType: "image-reference";
      frameId: string;
    };

type StyleProfileCandidate = {
  sourceType: "figma-reference" | "image-reference";
  sourceReferenceId: string | null;
  styleContext: NonNullStyleContext;
  styleProfile: StyleProfile;
  statusRank: number;
  recencyRank: number;
  label: string;
};

function normalizeReferenceSelections(raw: unknown): DesignSystemReferenceSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      const sourceType =
        row.sourceType === "figma-reference" || row.sourceType === "image-reference"
          ? row.sourceType
          : null;
      if (!sourceType) {
        return null;
      }
      if (sourceType === "figma-reference") {
        const referenceSourceId = toNonEmptyString(row.referenceSourceId);
        if (!referenceSourceId) {
          return null;
        }
        return { sourceType, referenceSourceId };
      }
      const frameId = toNonEmptyString(row.frameId);
      if (!frameId) {
        return null;
      }
      return { sourceType, frameId };
    })
    .filter((entry): entry is DesignSystemReferenceSelection => Boolean(entry));
}

function buildStyleProfileFromContextCandidate(
  context: NonNullStyleContext,
  sourceType: "figma-reference" | "image-reference"
): StyleProfile {
  return buildStyleProfileFromStyleContext({
    styleContext: context,
    sourceType,
    componentRecipes: context.componentRecipes,
    extractionEvidence: context.extractionEvidence,
    explicitQualityScore: context.qualityReport?.fidelityScore ?? null
  }).styleProfile;
}

function sortCandidates(candidates: StyleProfileCandidate[]) {
  return [...candidates].sort((left, right) => {
    if (left.statusRank !== right.statusRank) {
      return right.statusRank - left.statusRank;
    }
    if (left.sourceType !== right.sourceType) {
      return left.sourceType === "figma-reference" ? -1 : 1;
    }
    return right.recencyRank - left.recencyRank;
  });
}

async function collectStyleProfileCandidates(
  deps: ApiDeps,
  bundle: ProjectBundle,
  selections: DesignSystemReferenceSelection[]
): Promise<StyleProfileCandidate[]> {
  const fallback = buildFallbackStyleContext();
  const referenceById = new Map(bundle.references.map((reference) => [reference.id, reference]));
  const selectedFigmaIds = new Set(
    selections.filter((item): item is Extract<DesignSystemReferenceSelection, { sourceType: "figma-reference" }> => item.sourceType === "figma-reference").map((item) => item.referenceSourceId)
  );
  const selectedImageFrameIds = new Set(
    selections.filter((item): item is Extract<DesignSystemReferenceSelection, { sourceType: "image-reference" }> => item.sourceType === "image-reference").map((item) => item.frameId)
  );
  const useSelectionFilter = selections.length > 0;

  const candidates: StyleProfileCandidate[] = [];
  const figmaDerivedByReferenceId = new Map<
    string,
    {
      styleContext: NonNullStyleContext;
      recencyRank: number;
      frameName: string;
    }
  >();
  const orphanFigmaFrameCandidates: StyleProfileCandidate[] = [];

  for (const frame of bundle.frames) {
    const latestVersion = frame.versions[frame.versions.length - 1];
    if (!latestVersion || !latestVersion.passOutputs || typeof latestVersion.passOutputs !== "object") {
      continue;
    }
    const passOutputs = latestVersion.passOutputs as Record<string, unknown>;
    const sourceType = toNonEmptyString(passOutputs.sourceType);
    const sourceRole = toNonEmptyString(passOutputs.sourceRole);
    if (sourceType !== "figma-reference" || sourceRole !== "reference-screen") {
      continue;
    }

    const referenceSourceId = toNonEmptyString(passOutputs.referenceSourceId);
    if (useSelectionFilter && selectedFigmaIds.size > 0) {
      if (!referenceSourceId || !selectedFigmaIds.has(referenceSourceId)) {
        continue;
      }
    }

    const baseContext =
      (referenceSourceId ? referenceById.get(referenceSourceId)?.extractedStyleContext : null) ?? fallback;
    const derived = deps.deriveStyleContextFromArtifacts(baseContext, {
      sourceCode: latestVersion.sourceCode,
      cssCode: latestVersion.cssCode,
      exportHtml: latestVersion.exportHtml
    });
    const recencyRank = new Date(frame.updatedAt).getTime();

    if (referenceSourceId) {
      const existing = figmaDerivedByReferenceId.get(referenceSourceId);
      if (!existing || recencyRank > existing.recencyRank) {
        figmaDerivedByReferenceId.set(referenceSourceId, {
          styleContext: derived,
          recencyRank: Number.isFinite(recencyRank) ? recencyRank : 0,
          frameName: frame.name
        });
      }
      continue;
    }

    const styleProfile = buildStyleProfileFromContextCandidate(derived, "figma-reference");
    orphanFigmaFrameCandidates.push({
      sourceType: "figma-reference",
      sourceReferenceId: null,
      styleContext: derived,
      styleProfile,
      statusRank: 1,
      recencyRank: Number.isFinite(recencyRank) ? recencyRank : 0,
      label: `Figma frame ${frame.name}`
    });
  }

  for (const reference of bundle.references) {
    if (reference.syncStatus !== "synced" || !reference.extractedStyleContext) {
      continue;
    }
    if (useSelectionFilter && !selectedFigmaIds.has(reference.id)) {
      continue;
    }
    const derivedFromFrame = figmaDerivedByReferenceId.get(reference.id);
    const context = derivedFromFrame?.styleContext ?? reference.extractedStyleContext;
    const styleProfile = buildStyleProfileFromContextCandidate(context, "figma-reference");
    const statusRank = reference.designSystemStatus === "approved" ? 3 : reference.designSystemStatus === "needs-edits" ? 2 : 1;
    const recencyRank = Math.max(
      new Date(reference.lastSyncedAt ?? reference.updatedAt ?? reference.createdAt).getTime(),
      derivedFromFrame?.recencyRank ?? 0
    );
    candidates.push({
      sourceType: "figma-reference",
      sourceReferenceId: reference.id,
      styleContext: context,
      styleProfile,
      statusRank,
      recencyRank: Number.isFinite(recencyRank) ? recencyRank : 0,
      label: `Figma ${reference.fileKey}${reference.nodeId ? `:${reference.nodeId}` : ""}${derivedFromFrame ? " (frame-derived)" : ""}`
    });
  }

  candidates.push(...orphanFigmaFrameCandidates);

  for (const frame of bundle.frames) {
    if (useSelectionFilter && !selectedImageFrameIds.has(frame.id)) {
      continue;
    }
    const latestVersion = frame.versions[frame.versions.length - 1];
    if (!latestVersion || !latestVersion.passOutputs || typeof latestVersion.passOutputs !== "object") {
      continue;
    }
    const passOutputs = latestVersion.passOutputs as Record<string, unknown>;
    const sourceType = toNonEmptyString(passOutputs.sourceType);
    const sourceRole = toNonEmptyString(passOutputs.sourceRole);
    if (sourceType !== "image-reference" || sourceRole !== "reference-screen") {
      continue;
    }

    const fromSpec = buildImageStyleContextFromPassOutputs(passOutputs, fallback);
    const derived = deps.deriveStyleContextFromArtifacts(fromSpec ?? fallback, {
      sourceCode: latestVersion.sourceCode,
      cssCode: latestVersion.cssCode,
      exportHtml: latestVersion.exportHtml
    });
    const mergedRecipes = mergeComponentRecipeSets(
      fromSpec?.componentRecipes,
      derived.componentRecipes
    );
    const mergedEvidence = [
      ...(fromSpec?.extractionEvidence ?? []),
      ...(derived.extractionEvidence ?? [])
    ];
    const mergedQualityReport = buildQualityReportFromRecipes(
      mergedRecipes.length > 0 ? mergedRecipes : derived.componentRecipes ?? [],
      mergedEvidence,
      Math.max(fromSpec?.qualityReport?.fidelityScore ?? 0, derived.qualityReport?.fidelityScore ?? 0) || null,
      {
        colorsDetected: 5,
        componentFamiliesDetected: mergedRecipes.filter((recipe) => recipe.confidence >= 0.66).length
      }
    );
    const styleContext: NonNullStyleContext = fromSpec
      ? {
          ...derived,
          source: fromSpec.source,
          palette: fromSpec.palette,
          typography: {
            headingFamily:
              fromSpec.typography.headingFamily === fallback.typography.headingFamily &&
              derived.typography.headingFamily !== fallback.typography.headingFamily
                ? derived.typography.headingFamily
                : fromSpec.typography.headingFamily,
            bodyFamily:
              fromSpec.typography.bodyFamily === fallback.typography.bodyFamily &&
              derived.typography.bodyFamily !== fallback.typography.bodyFamily
                ? derived.typography.bodyFamily
                : fromSpec.typography.bodyFamily,
            cornerRadius:
              mergedRecipes.find((recipe) => recipe.family === "buttons")?.cornerRadius ??
              fromSpec.typography.cornerRadius
          },
          spacingScale: fromSpec.spacingScale,
          componentPatterns: fromSpec.componentPatterns.length > 0 ? fromSpec.componentPatterns : derived.componentPatterns,
          layoutMotifs: fromSpec.layoutMotifs.length > 0 ? fromSpec.layoutMotifs : derived.layoutMotifs,
          componentRecipes: mergedRecipes.length > 0 ? mergedRecipes : derived.componentRecipes,
          extractionEvidence: mergedEvidence,
          qualityReport: mergedQualityReport
        }
      : derived;

    const styleProfile = buildStyleProfileFromContextCandidate(styleContext, "image-reference");
    const recencyRank = new Date(frame.updatedAt).getTime();
    candidates.push({
      sourceType: "image-reference",
      sourceReferenceId: null,
      styleContext,
      styleProfile,
      statusRank: 1,
      recencyRank: Number.isFinite(recencyRank) ? recencyRank : 0,
      label: `Image ${frame.name}`
    });
  }

  return sortCandidates(candidates);
}

export function registerProjectRoutes(app: Express, deps: ApiDeps) {
  app.post("/projects", async (request, response) => {
    try {
      const rawName = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      const name = rawName.length > 0 ? rawName : `Project ${new Date().toLocaleDateString("en-US")}`;
      const bundle = await deps.createProject(name);
      response.status(201).json(bundle);
    } catch (error) {
      sendApiError(response, 500, error instanceof Error ? error.message : String(error), "internal_error");
    }
  });

  app.get("/projects/:id", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    response.json(bundle);
  });

  app.post("/projects/:id/clear-board", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    try {
      await deps.clearProjectBoard(request.params.id);
      const refreshed = await deps.getProjectBundle(request.params.id);
      if (!refreshed) {
        sendApiError(response, 500, "Project cleared but failed to reload project.", "internal_error");
        return;
      }
      response.json(refreshed);
    } catch (error) {
      sendApiError(response, 500, error instanceof Error ? error.message : String(error), "internal_error");
    }
  });

  app.patch("/projects/:id/settings", async (request, response) => {
    const project = await deps.updateProjectSettings(request.params.id, {
      provider: parseOptionalProvider(request.body?.provider),
      model: typeof request.body?.model === "string" ? request.body.model : undefined,
      tailwindDefault:
        typeof request.body?.tailwindDefault === "boolean" ? request.body.tailwindDefault : undefined,
      modeDefault:
        request.body?.modeDefault === "wireframe" || request.body?.modeDefault === "high-fidelity"
          ? request.body.modeDefault
          : undefined,
      deviceDefault:
        request.body?.deviceDefault === "desktop" || request.body?.deviceDefault === "iphone"
          ? request.body.deviceDefault
          : undefined,
      designSystemModeDefault:
        request.body?.designSystemModeDefault === "strict" || request.body?.designSystemModeDefault === "creative"
          ? request.body.designSystemModeDefault
          : undefined,
      surfaceDefault:
        request.body?.surfaceDefault === "web" || request.body?.surfaceDefault === "mobile"
          ? request.body.surfaceDefault
          : undefined
    });

    if (!project) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    response.json(project);
  });

  app.get("/projects/:id/design-system", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const designSystem = await deps.getProjectDesignSystem(request.params.id);
    response.json({ designSystem });
  });

  app.put("/projects/:id/design-system", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const markdown = typeof request.body?.markdown === "string" ? request.body.markdown : "";
    const fallbackStyleContext =
      bundle.references.find((reference) => reference.syncStatus === "synced")?.extractedStyleContext ?? undefined;
    const currentDesignSystem = await deps.getProjectDesignSystem(request.params.id);
    const fallbackContext = fallbackStyleContext ?? buildFallbackStyleContext();
    const baseStyleProfile =
      currentDesignSystem?.structuredTokens.styleProfile ??
      buildStyleProfileFromStyleContext({
        styleContext: fallbackContext,
        sourceType: "manual",
        componentRecipes: fallbackContext.componentRecipes,
        extractionEvidence: fallbackContext.extractionEvidence,
        explicitQualityScore: fallbackContext.qualityReport?.fidelityScore ?? null
      }).styleProfile;
    const baseQualityReport =
      currentDesignSystem?.structuredTokens.qualityReport ??
      buildQualityReportFromRecipes(baseStyleProfile.componentRecipes, baseStyleProfile.extractionEvidence, undefined, {
        colorsDetected: baseStyleProfile.tokens.colors.length,
        componentFamiliesDetected: baseStyleProfile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
      });
    const parsed = deps.parseDesignMarkdown(markdown, fallbackContext, {
      styleProfile: baseStyleProfile,
      qualityReport: baseQualityReport
    });
    const status =
      request.body?.status === "approved" || request.body?.status === "draft" || request.body?.status === "empty"
        ? request.body.status
        : "draft";

    const sourceType =
      request.body?.sourceType === "figma-reference" ||
      request.body?.sourceType === "image-reference" ||
      request.body?.sourceType === "chat" ||
      request.body?.sourceType === "manual"
        ? request.body.sourceType
        : "manual";
    const rawSourceReferenceId =
      typeof request.body?.sourceReferenceId === "string" ? request.body.sourceReferenceId : null;
    const sourceReferenceId = sourceType === "figma-reference" ? rawSourceReferenceId : null;

    const updated = await deps.upsertProjectDesignSystem({
      projectId: request.params.id,
      markdown: parsed.markdown,
      structuredTokens: parsed.structuredTokens,
      status,
      sourceType,
      sourceReferenceId
    });
    await deps.syncProjectDesignSystemFrame({
      projectId: request.params.id,
      designSystem: updated,
      sourceType: updated.sourceType,
      sourceReferenceId: updated.sourceReferenceId,
      sourceLabel: "Project Design System",
      sourceDescription: "Synced from canonical DESIGN.md"
    });

    response.json({
      designSystem: updated,
      warnings: parsed.warnings
    });
  });

  app.post("/projects/:id/design-system/bootstrap", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const mode = request.body?.mode === "manual" ? "manual" : "reference";
    if (mode === "manual") {
      const fallbackStyleContext =
        bundle.references.find((reference) => reference.syncStatus === "synced")?.extractedStyleContext ?? undefined;
      const fallbackContext = fallbackStyleContext ?? buildFallbackStyleContext();
      const styleProfile = buildStyleProfileFromStyleContext({
        styleContext: fallbackContext,
        sourceType: "manual",
        componentRecipes: fallbackContext.componentRecipes,
        extractionEvidence: fallbackContext.extractionEvidence,
        explicitQualityScore: fallbackContext.qualityReport?.fidelityScore ?? null
      }).styleProfile;
      const qualityReport = buildQualityReportFromRecipes(
        styleProfile.componentRecipes,
        styleProfile.extractionEvidence,
        undefined,
        {
          colorsDetected: styleProfile.tokens.colors.length,
          componentFamiliesDetected: styleProfile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
        }
      );
      const parsed = deps.parseDesignMarkdown(deps.DEFAULT_DESIGN_MD_TEMPLATE, fallbackContext, {
        styleProfile,
        qualityReport
      });
      const designSystem = await deps.upsertProjectDesignSystem({
        projectId: request.params.id,
        markdown: parsed.markdown,
        structuredTokens: parsed.structuredTokens,
        status: "draft",
        sourceType: "manual",
        sourceReferenceId: null
      });
      await deps.syncProjectDesignSystemFrame({
        projectId: request.params.id,
        designSystem,
        sourceType: "manual",
        sourceLabel: "Manual Design System",
        sourceDescription: "Seeded manually from DESIGN.md template"
      });
      response.json({ designSystem, warnings: parsed.warnings });
      return;
    }

    const candidates = await collectStyleProfileCandidates(deps, bundle, []);
    if (candidates.length === 0) {
      sendApiError(
        response,
        400,
        "No synced references found. Add a Figma/image reference first.",
        "bad_request"
      );
      return;
    }

    const mergedProfile = mergeStyleProfiles(candidates.map((candidate) => candidate.styleProfile)) ?? candidates[0].styleProfile;
    const primaryCandidate = candidates[0];
    const mergedContext = buildStyleContextFromProfile(mergedProfile, primaryCandidate.styleContext);
    const designSystem = await upsertDesignSystemFromStyleContext(deps, {
      projectId: request.params.id,
      styleContext: mergedContext,
      styleProfile: mergedProfile,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      overview: `Brand system regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}.`
    });
    await deps.syncProjectDesignSystemFrame({
      projectId: request.params.id,
      designSystem,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      sourceLabel: "Reference Blend",
      sourceDescription: `Merged from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}`
    });

    if (primaryCandidate.sourceType === "figma-reference" && primaryCandidate.sourceReferenceId) {
      const checklist = deps.normalizeDesignSystemChecklist(
        deps.buildDesignSystemChecklistFromStyleContext(primaryCandidate.styleContext)
      );
      await deps.updateReferenceSource(primaryCandidate.sourceReferenceId, {
        designSystemChecklist: checklist,
        designSystemStatus: "draft",
        updateDesignSystemAt: true
      });
    }

    const bootstrapReport = designSystem.structuredTokens.qualityReport;
    const bootstrapWarnings =
      bootstrapReport.referenceQuality === "good"
        ? []
        : [
            `Reference quality ${bootstrapReport.referenceQuality}. ${bootstrapReport.qualityReasons[0] ?? "Attach clearer references or calibrate component recipes in chat."}`
          ];

    response.json({ designSystem, warnings: bootstrapWarnings });
  });

  app.post("/projects/:id/design-system/reset-regenerate", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    await deps.clearProjectDesignSystem(request.params.id);
    await deps.resetReferenceDesignSystemMetadata(request.params.id);

    const refreshed = await deps.getProjectBundle(request.params.id);
    if (!refreshed) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const candidates = await collectStyleProfileCandidates(deps, refreshed, []);
    if (candidates.length === 0) {
      sendApiError(
        response,
        400,
        "No usable references found for regeneration. Re-sync Figma references or generate an image reference frame first.",
        "bad_request"
      );
      return;
    }

    const mergedProfile = mergeStyleProfiles(candidates.map((candidate) => candidate.styleProfile)) ?? candidates[0].styleProfile;
    const primaryCandidate = candidates[0];
    const mergedContext = buildStyleContextFromProfile(mergedProfile, primaryCandidate.styleContext);
    const designSystem = await upsertDesignSystemFromStyleContext(deps, {
      projectId: refreshed.project.id,
      styleContext: mergedContext,
      styleProfile: mergedProfile,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      overview: `Brand system regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}.`
    });
    await deps.syncProjectDesignSystemFrame({
      projectId: refreshed.project.id,
      designSystem,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      sourceLabel: "Reference Regeneration",
      sourceDescription: `Regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}`
    });

    const resetReport = designSystem.structuredTokens.qualityReport;
    const warnings =
      resetReport.referenceQuality === "good"
        ? []
        : [
            `Saved as draft because reference quality is ${resetReport.referenceQuality}. ${resetReport.qualityReasons[0] ?? "Attach cleaner references or calibrate in chat."}`
          ];

    response.json({ designSystem, warnings });
  });

  app.post("/projects/:id/design-system/regenerate", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const selections = normalizeReferenceSelections(request.body?.references);
    const candidates = await collectStyleProfileCandidates(deps, bundle, selections);
    if (candidates.length === 0) {
      sendApiError(
        response,
        400,
        "No usable references found for regeneration. Re-sync Figma references or generate an image reference frame first.",
        "bad_request"
      );
      return;
    }

    const mergedProfile = mergeStyleProfiles(candidates.map((candidate) => candidate.styleProfile)) ?? candidates[0].styleProfile;
    const primaryCandidate = candidates[0];
    const mergedContext = buildStyleContextFromProfile(mergedProfile, primaryCandidate.styleContext);
    const designSystem = await upsertDesignSystemFromStyleContext(deps, {
      projectId: bundle.project.id,
      styleContext: mergedContext,
      styleProfile: mergedProfile,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      overview: `Brand system regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}.`
    });
    await deps.syncProjectDesignSystemFrame({
      projectId: bundle.project.id,
      designSystem,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      sourceLabel: "Reference Regeneration",
      sourceDescription: `Regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}`
    });

    const regenerateReport = designSystem.structuredTokens.qualityReport;
    const warnings =
      regenerateReport.referenceQuality === "good"
        ? []
        : [
            `Saved as draft because reference quality is ${regenerateReport.referenceQuality}. ${regenerateReport.qualityReasons[0] ?? "Attach cleaner references or calibrate in chat."}`
          ];

    response.json({ designSystem, warnings });
  });

  app.post("/projects/:id/design-system/regenerate-from-reference", async (request, response) => {
    const sourceType =
      request.body?.sourceType === "figma-reference" || request.body?.sourceType === "image-reference"
        ? request.body.sourceType
        : null;
    if (!sourceType) {
      sendApiError(response, 400, "sourceType must be figma-reference or image-reference.", "bad_request");
      return;
    }

    const selection =
      sourceType === "figma-reference"
        ? [{ sourceType, referenceSourceId: toNonEmptyString(request.body?.referenceSourceId) ?? "" }]
        : [{ sourceType, frameId: toNonEmptyString(request.body?.frameId) ?? "" }];

    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const candidates = await collectStyleProfileCandidates(deps, bundle, normalizeReferenceSelections(selection));
    if (candidates.length === 0) {
      sendApiError(
        response,
        400,
        "No usable references found for regeneration. Re-sync references first.",
        "bad_request"
      );
      return;
    }

    const mergedProfile = mergeStyleProfiles(candidates.map((candidate) => candidate.styleProfile)) ?? candidates[0].styleProfile;
    const primaryCandidate = candidates[0];
    const mergedContext = buildStyleContextFromProfile(mergedProfile, primaryCandidate.styleContext);
    const designSystem = await upsertDesignSystemFromStyleContext(deps, {
      projectId: bundle.project.id,
      styleContext: mergedContext,
      styleProfile: mergedProfile,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      overview: `Brand system regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}.`
    });
    await deps.syncProjectDesignSystemFrame({
      projectId: bundle.project.id,
      designSystem,
      sourceType: primaryCandidate.sourceType,
      sourceReferenceId: primaryCandidate.sourceReferenceId,
      sourceLabel: "Reference Regeneration",
      sourceDescription: `Regenerated from references: ${candidates.map((candidate) => candidate.label).slice(0, 3).join(", ")}`
    });

    const regenerateSingleReport = designSystem.structuredTokens.qualityReport;
    const warnings =
      regenerateSingleReport.referenceQuality === "good"
        ? []
        : [
            `Saved as draft because reference quality is ${regenerateSingleReport.referenceQuality}. ${regenerateSingleReport.qualityReasons[0] ?? "Attach cleaner references or calibrate in chat."}`
          ];

    response.json({ designSystem, warnings });
  });

  app.post("/projects/:id/design-system/calibrate", async (request, response) => {
    const bundle = await deps.getProjectBundle(request.params.id);
    if (!bundle) {
      sendApiError(response, 404, "Project not found.", "not_found");
      return;
    }

    const designSystem = await deps.getProjectDesignSystem(request.params.id);
    if (!designSystem) {
      sendApiError(
        response,
        400,
        "No design system to calibrate. Generate or bootstrap a design system first.",
        "bad_request"
      );
      return;
    }

    const updates = parseCalibrationUpdates(request.body?.updates ?? request.body?.prompt ?? request.body?.command);
    if (updates.length === 0) {
      sendApiError(
        response,
        400,
        "No valid calibration updates found. Example: buttons.shape=pill buttons.borderStyle=none",
        "bad_request"
      );
      return;
    }

    const calibrated = applyStyleCalibration(designSystem.structuredTokens.styleProfile, updates);
    const fallbackContext = bundle.references.find((reference) => reference.syncStatus === "synced")?.extractedStyleContext ??
      buildFallbackStyleContext();
    const styleContext = buildStyleContextFromProfile(calibrated.profile, fallbackContext);
    const qualityReport = buildQualityReportFromRecipes(
      calibrated.profile.componentRecipes,
      calibrated.profile.extractionEvidence,
      designSystem.structuredTokens.qualityReport.fidelityScore + 0.04,
      {
        colorsDetected: calibrated.profile.tokens.colors.length,
        componentFamiliesDetected: calibrated.profile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
      }
    );
    const markdown = deps.generateDesignMarkdownFromStyleContext(
      styleContext,
      designSystem.structuredTokens.overview,
      calibrated.profile,
      qualityReport
    );
    const parsed = deps.parseDesignMarkdown(markdown, styleContext, {
      styleProfile: calibrated.profile,
      qualityReport
    });

    const updated = await deps.upsertProjectDesignSystem({
      projectId: request.params.id,
      markdown: parsed.markdown,
      structuredTokens: parsed.structuredTokens,
      status: "draft",
      sourceType: designSystem.sourceType,
      sourceReferenceId: designSystem.sourceType === "figma-reference" ? designSystem.sourceReferenceId : null
    });
    await deps.syncProjectDesignSystemFrame({
      projectId: request.params.id,
      designSystem: updated,
      sourceType: updated.sourceType,
      sourceReferenceId: updated.sourceReferenceId,
      sourceLabel: "Calibration",
      sourceDescription: "Updated from chat calibration and DESIGN.md"
    });

    response.json({
      designSystem: updated,
      warnings: parsed.warnings,
      applied: calibrated.applied
    });
  });
}
