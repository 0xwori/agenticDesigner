import crypto from "node:crypto";
import { diffLines } from "diff";
import {
  type ComponentFamilyConfidence,
  type ComponentRecipe,
  type ComponentStateRecipe,
  type ComposerAttachment,
  type AgentRole,
  type DesignSystemChecklist,
  type DesignSystemComponentFamily,
  type DesignSystemMode,
  PIPELINE_STAGES,
  type DesignMode,
  type DevicePreset,
  type PipelineEvent,
  type PipelineStage,
  type PromptIntentType,
  type ProjectDesignSystem,
  type ProviderId,
  type ReferenceStyleContext,
  type SelectedFrameContext,
  type SurfaceTarget,
  type RunStatus
} from "@designer/shared";
import {
  appendChatMessage,
  appendPipelineEvent,
  createFrameRecord,
  createFrameVersionRecord,
  getFrame,
  getLatestSyncedReference,
  getLatestFrameVersion,
  upsertProjectDesignSystem,
  getProjectBundle,
  getProjectStyleContexts,
  updateFrameStatus,
  updatePipelineRun,
  updateReferenceSource
} from "../db.js";
import {
  buildDesignSystemChecklistFromStyleContext,
  normalizeDesignSystemChecklist
} from "./figmaReference.js";
import { generateDesignMarkdownFromStyleContext, parseDesignMarkdown } from "./designSystemMd.js";
import {
  buildQualityReportFromRecipes,
  buildStyleProfileFromStyleContext,
  mergeComponentRecipeSets
} from "./designSystemProfile.js";
import { buildDesignSystemComponentsArtifacts as buildDesignSystemComponentsArtifactsFromProfile } from "./designSystemArtifacts.js";
import { requestCompletion } from "./llmProviders.js";
import type { RunHub } from "./runHub.js";
import {
  classifyPromptIntent as classifyPromptIntentViaRouter,
  detectIntentHeuristic as detectIntentHeuristicViaRouter
} from "./pipeline/intentRouter.js";
import {
  computeFrameSize as computeFrameSizeViaLayout,
  computeNextFramePosition as computeNextFramePositionViaLayout,
  hasFrameCollision as hasFrameCollisionViaLayout
} from "./pipeline/layout.js";
import {
  buildRetryPromptAddition as buildRetryPromptAdditionViaValidators,
  enforceStrictDesignSystemAlignment as enforceStrictDesignSystemAlignmentViaValidators,
  validateArtifactsAgainstImageSpec as validateArtifactsAgainstImageSpecViaValidators,
  validateArtifactsForDevice as validateArtifactsForDeviceViaValidators,
  validateDesignSystemAdherence as validateDesignSystemAdherenceViaValidators
} from "./pipeline/validators.js";
import { deriveStyleContextFromArtifacts } from "./styleContextArtifacts.js";

type PipelineInput = {
  runId: string;
  projectId: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  devicePreset: DevicePreset;
  mode: DesignMode;
  surfaceTarget?: SurfaceTarget;
  designSystemMode?: DesignSystemMode;
  variation?: number;
  tailwindEnabled?: boolean;
  attachments?: ComposerAttachment[];
  selectedFrameContext?: SelectedFrameContext;
  frameId?: string;
  editing: boolean;
};

type PipelineContext = {
  hub: RunHub;
};

type EnhanceResult = {
  title: string;
  intent: string;
  audience: string;
  uxGoals: string[];
  constraints: string[];
};

type PlanResult = {
  frameName: string;
  subtitle: string;
  sections: Array<{ title: string; description: string }>;
  keyActions: string[];
};

type FrameArtifacts = {
  frameName: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
};

type GenerateArtifactsResult = {
  artifacts: FrameArtifacts;
  strategy: "model";
  usedProvider: ProviderId;
  reason: string;
};

type ImageRebuildSpec = {
  specVersion: string;
  frameName: string;
  confidence: number;
  assumptions: string[];
  clarificationQuestions: string[];
  layoutRegions: Array<{
    name: string;
    role: string;
    hierarchyLevel: number;
    description: string;
  }>;
  typography: {
    headingFamily: string;
    bodyFamily: string;
    headingScale: string[];
  };
  colorTokens: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
  };
  spacing: {
    baseUnit: number;
    radius: number;
    elevation: string;
  };
  componentCandidates: string[];
  interactionHints: string[];
  fidelityTargets: string[];
  componentRecipes: ComponentRecipe[];
  extractionEvidence: string[];
  qualityReport: {
    fidelityScore: number;
    globalConfidence: number;
    status: "high" | "medium" | "low";
    referenceQuality: "good" | "medium" | "poor";
    detectionCoverage: {
      colorsDetected: number;
      componentFamiliesDetected: number;
    };
    qualityReasons: string[];
    familyConfidence: ComponentFamilyConfidence[];
    recommendations: string[];
  } | null;
};

type ValidationCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

type ValidationResult = {
  valid: boolean;
  issues: string[];
  checks: ValidationCheck[];
};

type PromptIntent = {
  type: PromptIntentType;
  reason: string;
  shouldTakeAction: boolean;
  designSystemAction: "none" | "approve" | "iterate";
};

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asJsonObject<T extends object>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeIdentifier(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildFallbackStyleContext(): ReferenceStyleContext {
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
      cornerRadius: 14
    },
    spacingScale: [4, 8, 12, 16, 20, 24, 32],
    componentPatterns: ["soft panel", "pill actions", "split emphasis"],
    layoutMotifs: ["guided narrative column", "dense detail cards", "status-first messaging"]
  };
}

function uniqueNumberList(values: number[]) {
  const seen = new Set<number>();
  const output: number[] = [];
  for (const value of values) {
    const rounded = Math.max(2, Math.round(value));
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

function buildStyleContextFromImageSpec(base: ReferenceStyleContext, spec: ImageRebuildSpec): ReferenceStyleContext {
  const primary = spec.colorTokens.primary || spec.colorTokens.accent || base.palette.primary;
  const accent = spec.colorTokens.accent || spec.colorTokens.primary || base.palette.accent;
  const textPrimary = spec.colorTokens.textPrimary || base.palette.text;
  const secondary =
    spec.colorTokens.secondary ||
    (spec.colorTokens.textSecondary && spec.colorTokens.textSecondary !== textPrimary
      ? spec.colorTokens.textSecondary
      : base.palette.secondary);
  const surface = spec.colorTokens.background || spec.colorTokens.surface || base.palette.surface;
  const componentPatterns = spec.componentCandidates.length > 0 ? spec.componentCandidates.slice(0, 7) : base.componentPatterns;
  const layoutMotifs = [
    ...spec.layoutRegions.map((region) => `${region.role}: ${region.name}`),
    ...spec.interactionHints
  ]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 6);

  return {
    source: "heuristic",
    palette: {
      primary,
      secondary,
      accent,
      surface,
      text: textPrimary
    },
    typography: {
      headingFamily: spec.typography.headingFamily || base.typography.headingFamily,
      bodyFamily: spec.typography.bodyFamily || base.typography.bodyFamily,
      cornerRadius: Math.max(4, Math.min(32, spec.spacing.radius || base.typography.cornerRadius))
    },
    spacingScale: buildSpacingScaleFromBase(spec.spacing.baseUnit || base.spacingScale[1] || 8),
    componentPatterns,
    layoutMotifs: layoutMotifs.length > 0 ? layoutMotifs : base.layoutMotifs,
    componentRecipes: spec.componentRecipes.length > 0 ? spec.componentRecipes : base.componentRecipes,
    extractionEvidence: spec.extractionEvidence,
    qualityReport: spec.qualityReport ?? base.qualityReport ?? null
  };
}

function parseDesignSystemCornerRadius(designSystem: ProjectDesignSystem): number | null {
  const profileRadius = designSystem.structuredTokens.styleProfile.componentRecipes.find(
    (recipe) => recipe.family === "buttons"
  )?.cornerRadius;
  if (typeof profileRadius === "number" && Number.isFinite(profileRadius)) {
    return Math.max(4, Math.min(32, Math.round(profileRadius)));
  }

  const value = designSystem.structuredTokens.styleProfile.tokens.radiusScale[0];
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(4, Math.min(32, value));
}

function pickDesignSystemColorToken(
  designSystem: ProjectDesignSystem,
  matchers: string[],
  fallback: string
) {
  const color = designSystem.structuredTokens.colors.find((token) => {
    const name = token.name.toLowerCase();
    return matchers.some((matcher) => name.includes(matcher));
  });
  return color?.hex ?? fallback;
}

function buildStyleContextFromProjectDesignSystem(designSystem: ProjectDesignSystem | null): ReferenceStyleContext | null {
  if (!designSystem) {
    return null;
  }

  const fallback = buildFallbackStyleContext();
  return {
    source: designSystem.sourceType === "figma-reference" ? "figma-public-link" : "heuristic",
    palette: {
      primary: pickDesignSystemColorToken(designSystem, ["primary"], fallback.palette.primary),
      secondary: pickDesignSystemColorToken(designSystem, ["secondary"], fallback.palette.secondary),
      accent: pickDesignSystemColorToken(designSystem, ["tertiary", "accent"], fallback.palette.accent),
      surface: pickDesignSystemColorToken(designSystem, ["neutral", "surface"], fallback.palette.surface),
      text: pickDesignSystemColorToken(designSystem, ["text", "on-", "ink"], fallback.palette.text)
    },
    typography: {
      headingFamily: designSystem.structuredTokens.typography.headlineFont || fallback.typography.headingFamily,
      bodyFamily: designSystem.structuredTokens.typography.bodyFont || fallback.typography.bodyFamily,
      cornerRadius: parseDesignSystemCornerRadius(designSystem) ?? fallback.typography.cornerRadius
    },
    spacingScale:
      designSystem.structuredTokens.styleProfile.tokens.spacingScale.length > 0
        ? designSystem.structuredTokens.styleProfile.tokens.spacingScale
        : [4, 8, 12, 16, 20, 24, 32],
    componentPatterns:
      designSystem.structuredTokens.styleProfile.componentRecipes.length > 0
        ? designSystem.structuredTokens.styleProfile.componentRecipes.map((recipe) => `${recipe.family}:${recipe.shape}`).slice(0, 7)
        : designSystem.structuredTokens.components.length > 0
          ? designSystem.structuredTokens.components.slice(0, 7)
          : fallback.componentPatterns,
    layoutMotifs:
      designSystem.structuredTokens.dos.length > 0
        ? designSystem.structuredTokens.dos.slice(0, 5)
        : fallback.layoutMotifs,
    componentRecipes:
      designSystem.structuredTokens.styleProfile.componentRecipes.length > 0
        ? designSystem.structuredTokens.styleProfile.componentRecipes
        : fallback.componentRecipes,
    qualityReport: designSystem.structuredTokens.qualityReport,
    extractionEvidence: designSystem.structuredTokens.styleProfile.extractionEvidence
  };
}

function getPrimaryAgentForDevice(devicePreset: DevicePreset): AgentRole {
  return devicePreset === "iphone" ? "app-designer" : "web-designer";
}

function normalizeChecklistItems(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function formatChecklistForMessage(checklist: DesignSystemChecklist) {
  return checklist.sections
    .map((section) => {
      const header = `${section.section}:`;
      const items = section.items.map((item) => `- ${item}`).join("\n");
      return `${header}\n${items}`;
    })
    .join("\n\n");
}

function detectIntentHeuristic(prompt: string): PromptIntent {
  return detectIntentHeuristicViaRouter(prompt);
}

async function classifyPromptIntent(
  input: PipelineInput,
  styleContext: ReferenceStyleContext,
  hasSyncedReference: boolean
): Promise<PromptIntent> {
  return classifyPromptIntentViaRouter({
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    editing: input.editing,
    styleContext,
    hasSyncedReference
  });
}

function computeFrameSize(device: DevicePreset) {
  return computeFrameSizeViaLayout(device);
}

type FrameLayoutLike = {
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
};

function hasFrameCollision(candidate: FrameLayoutLike, existing: FrameLayoutLike, gap = 96) {
  return hasFrameCollisionViaLayout(candidate, existing, gap);
}

function computeNextFramePosition(existingFrames: FrameLayoutLike[], frameSize: { width: number; height: number }) {
  return computeNextFramePositionViaLayout(existingFrames, frameSize);
}

function getFirstImageAttachment(attachments?: ComposerAttachment[]): ComposerAttachment | null {
  if (!attachments?.length) {
    return null;
  }
  for (const attachment of attachments) {
    if (attachment.type === "image" && typeof attachment.dataUrl === "string" && attachment.dataUrl.length > 0) {
      return attachment;
    }
  }
  return null;
}

function toNonEmptyString(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function detectPrimaryComponentName(sourceCode: string): string | null {
  const functionMatch = sourceCode.match(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/);
  if (functionMatch?.[1]) {
    return functionMatch[1];
  }

  const constMatch = sourceCode.match(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\(/);
  if (constMatch?.[1]) {
    return constMatch[1];
  }

  return null;
}

function normalizeGeneratedArtifacts(
  input: Record<string, unknown> | null
): FrameArtifacts | null {
  if (!input) {
    return null;
  }

  const frameName = toNonEmptyString(input.frameName);
  const sourceCode = toNonEmptyString(input.sourceCode);
  const cssCode = toNonEmptyString(input.cssCode);
  const exportHtml = toNonEmptyString(input.exportHtml);

  if (!frameName || !sourceCode || !cssCode || !exportHtml) {
    return null;
  }

  return {
    frameName,
    sourceCode,
    cssCode,
    exportHtml
  };
}

function normalizeImageRebuildSpec(input: Record<string, unknown> | null, fallbackFrameName: string): ImageRebuildSpec {
  const safeArray = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length > 0)
      : [];

  const safeNumber = (value: unknown, defaultValue: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const confidenceRaw = safeNumber(input?.confidence, 0.66);
  const confidence = clamp01(confidenceRaw);

  const layoutRegions = Array.isArray(input?.layoutRegions)
    ? input.layoutRegions
        .map((region) => {
          if (!region || typeof region !== "object") {
            return null;
          }
          const row = region as Record<string, unknown>;
          const name = toNonEmptyString(row.name);
          const role = toNonEmptyString(row.role);
          if (!name || !role) {
            return null;
          }
          return {
            name,
            role,
            hierarchyLevel: Math.max(1, Math.floor(safeNumber(row.hierarchyLevel, 1))),
            description: toNonEmptyString(row.description) ?? `${name} section`
          };
        })
        .filter((item): item is ImageRebuildSpec["layoutRegions"][number] => Boolean(item))
    : [];

  const typography = input?.typography && typeof input.typography === "object"
    ? (input.typography as Record<string, unknown>)
    : {};
  const colorTokens = input?.colorTokens && typeof input.colorTokens === "object"
    ? (input.colorTokens as Record<string, unknown>)
    : {};
  const spacing = input?.spacing && typeof input.spacing === "object" ? (input.spacing as Record<string, unknown>) : {};
  const componentRecipes = Array.isArray(input?.componentRecipes)
    ? input.componentRecipes.reduce<ComponentRecipe[]>((accumulator, recipe) => {
        if (!recipe || typeof recipe !== "object") {
          return accumulator;
        }
        const row = recipe as Record<string, unknown>;
        const family = normalizeComponentFamily(toNonEmptyString(row.family));
        if (!family) {
          return accumulator;
        }

        const shape = toNonEmptyString(row.shape);
        const borderStyle = toNonEmptyString(row.borderStyle);
        const shadowStyle = toNonEmptyString(row.shadowStyle);
        const density = toNonEmptyString(row.density);
        const fillStyle = toNonEmptyString(row.fillStyle);
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

        accumulator.push({
          family,
          shape:
            shape === "pill" || shape === "rounded" || shape === "sharp" || shape === "mixed"
              ? shape
              : "rounded",
          cornerRadius: Math.max(0, Math.floor(safeNumber(row.cornerRadius, 12))),
          borderWidth: Math.max(0, Math.floor(safeNumber(row.borderWidth, 1))),
          borderStyle:
            borderStyle === "none" || borderStyle === "solid" || borderStyle === "subtle"
              ? borderStyle
              : "solid",
          shadowStyle:
            shadowStyle === "none" || shadowStyle === "soft" || shadowStyle === "medium" || shadowStyle === "strong"
              ? shadowStyle
              : "soft",
          density: density === "compact" || density === "comfortable" || density === "spacious" ? density : "comfortable",
          controlHeight: Math.max(20, Math.floor(safeNumber(row.controlHeight, 44))),
          fillStyle:
            fillStyle === "solid" ||
            fillStyle === "tint" ||
            fillStyle === "outline" ||
            fillStyle === "ghost" ||
            fillStyle === "mixed"
              ? fillStyle
              : "solid",
          iconStyle: toNonEmptyString(row.iconStyle) ?? undefined,
          confidence: clamp01(Math.max(0, safeNumber(row.confidence, 0.62))),
          evidence: safeArray(row.evidence),
          states
        });
        return accumulator;
      }, [])
    : [];

  const qualityRaw = input?.qualityReport && typeof input.qualityReport === "object"
    ? (input.qualityReport as Record<string, unknown>)
    : null;
  const qualityReport: ImageRebuildSpec["qualityReport"] = qualityRaw
    ? (() => {
        const status: ImageRebuildSpec["qualityReport"] extends { status: infer T }
          ? T
          : "high" | "medium" | "low" =
          qualityRaw.status === "high" || qualityRaw.status === "medium" || qualityRaw.status === "low"
            ? qualityRaw.status
            : confidence >= 0.82
              ? "high"
              : confidence >= 0.65
                ? "medium"
                : "low";
        return {
          fidelityScore: clamp01(safeNumber(qualityRaw.fidelityScore, confidence)),
          globalConfidence: clamp01(safeNumber(qualityRaw.globalConfidence, confidence)),
          status,
          referenceQuality:
            qualityRaw.referenceQuality === "good" ||
            qualityRaw.referenceQuality === "medium" ||
            qualityRaw.referenceQuality === "poor"
              ? qualityRaw.referenceQuality
              : status === "high"
                ? "good"
                : status === "low"
                  ? "poor"
                  : "medium",
          detectionCoverage: {
            colorsDetected: Math.max(
              0,
              Math.round(safeNumber((qualityRaw.detectionCoverage as Record<string, unknown> | null)?.colorsDetected, 0))
            ),
            componentFamiliesDetected: Math.max(
              0,
              Math.round(
                safeNumber(
                  (qualityRaw.detectionCoverage as Record<string, unknown> | null)?.componentFamiliesDetected,
                  0
                )
              )
            )
          },
          qualityReasons: safeArray(qualityRaw.qualityReasons),
          familyConfidence: Array.isArray(qualityRaw.familyConfidence)
            ? qualityRaw.familyConfidence.reduce<ComponentFamilyConfidence[]>((accumulator, entry) => {
                if (!entry || typeof entry !== "object") {
                  return accumulator;
                }
                const row = entry as Record<string, unknown>;
                const family = normalizeComponentFamily(toNonEmptyString(row.family));
                if (!family) {
                  return accumulator;
                }
                accumulator.push({
                  family,
                  confidence: clamp01(safeNumber(row.confidence, confidence)),
                  mismatch: safeArray(row.mismatch),
                  evidence: safeArray(row.evidence)
                });
                return accumulator;
              }, [])
            : [],
          recommendations: safeArray(qualityRaw.recommendations)
        };
      })()
    : null;

  return {
    specVersion: toNonEmptyString(input?.specVersion) ?? "1.0",
    frameName: toNonEmptyString(input?.frameName) ?? fallbackFrameName,
    confidence,
    assumptions: safeArray(input?.assumptions),
    clarificationQuestions: safeArray(input?.clarificationQuestions).slice(0, 2),
    layoutRegions,
    typography: {
      headingFamily: toNonEmptyString(typography.headingFamily) ?? "Sora, ui-sans-serif, system-ui",
      bodyFamily: toNonEmptyString(typography.bodyFamily) ?? "Manrope, ui-sans-serif, system-ui",
      headingScale: safeArray(typography.headingScale)
    },
    colorTokens: {
      primary: toNonEmptyString(colorTokens.primary) ?? toNonEmptyString(colorTokens.accent) ?? "#8b8f98",
      secondary:
        toNonEmptyString(colorTokens.secondary) ??
        toNonEmptyString(colorTokens.textSecondary) ??
        "#6f7785",
      background: toNonEmptyString(colorTokens.background) ?? "#f5f5f6",
      surface: toNonEmptyString(colorTokens.surface) ?? "#ffffff",
      textPrimary: toNonEmptyString(colorTokens.textPrimary) ?? "#202327",
      textSecondary: toNonEmptyString(colorTokens.textSecondary) ?? "#6f7785",
      accent: toNonEmptyString(colorTokens.accent) ?? toNonEmptyString(colorTokens.primary) ?? "#9b8f82"
    },
    spacing: {
      baseUnit: Math.max(2, Math.floor(safeNumber(spacing.baseUnit, 8))),
      radius: Math.max(4, Math.floor(safeNumber(spacing.radius, 12))),
      elevation: toNonEmptyString(spacing.elevation) ?? "soft"
    },
    componentCandidates: safeArray(input?.componentCandidates),
    interactionHints: safeArray(input?.interactionHints),
    fidelityTargets: safeArray(input?.fidelityTargets),
    componentRecipes,
    extractionEvidence: safeArray(input?.extractionEvidence),
    qualityReport
  };
}

function validateArtifactsForDevice(
  artifacts: FrameArtifacts,
  input: { devicePreset: DevicePreset; mode: DesignMode }
): ValidationResult {
  return validateArtifactsForDeviceViaValidators(artifacts, input);
}

function validateDesignSystemAdherence(
  artifacts: FrameArtifacts,
  styleContext: ReferenceStyleContext,
  designSystemMode: DesignSystemMode
): ValidationResult {
  return validateDesignSystemAdherenceViaValidators(artifacts, styleContext, designSystemMode);
}

function enforceStrictDesignSystemAlignment(
  artifacts: FrameArtifacts,
  styleContext: ReferenceStyleContext
): FrameArtifacts {
  return enforceStrictDesignSystemAlignmentViaValidators(artifacts, styleContext);
}

function validateArtifactsAgainstImageSpec(artifacts: FrameArtifacts, spec: ImageRebuildSpec): ValidationResult {
  return validateArtifactsAgainstImageSpecViaValidators(artifacts, spec);
}

function buildRetryPromptAddition(input: {
  mode: "image" | "screen";
  attempt: number;
  issues: string[];
  spec?: ImageRebuildSpec;
  designSystemMode?: DesignSystemMode;
  surfaceTarget?: SurfaceTarget;
}) {
  return buildRetryPromptAdditionViaValidators(input);
}

function formatSelectedFrameContext(input?: SelectedFrameContext) {
  if (!input) {
    return "No selected frame context provided.";
  }
  return JSON.stringify(input, null, 2);
}

function computeDiff(previous: string, next: string) {
  const chunks = diffLines(previous, next);
  let addedLines = 0;
  let removedLines = 0;
  let changedLines = 0;

  for (const chunk of chunks) {
    const count = chunk.count ?? chunk.value.split("\n").length;
    if (chunk.added) {
      addedLines += count;
      changedLines += count;
    } else if (chunk.removed) {
      removedLines += count;
      changedLines += count;
    }
  }

  return { addedLines, removedLines, changedLines };
}

async function emit(context: PipelineContext, event: PipelineEvent) {
  const persisted = await appendPipelineEvent(event);
  context.hub.broadcast(event.runId, persisted);
}

async function emitAgentEvent(
  context: PipelineContext,
  input: {
    runId: string;
    stage: PipelineStage;
    status: PipelineEvent["status"];
    kind: PipelineEvent["kind"];
    message: string;
    agent: AgentRole;
    payload?: Record<string, unknown>;
  }
) {
  const payload = input.payload ?? {};
  await emit(context, {
    runId: input.runId,
    timestamp: new Date().toISOString(),
    stage: input.stage,
    status: input.status,
    kind: input.kind,
    message: input.message,
    payload: {
      agent: input.agent,
      step: typeof payload.step === "string" ? payload.step : `${input.stage}-${input.kind}`,
      target: typeof payload.target === "string" ? payload.target : input.agent,
      artifact: typeof payload.artifact === "string" ? payload.artifact : "ui-artifact",
      attempt: typeof payload.attempt === "number" ? payload.attempt : null,
      statusDetail: typeof payload.statusDetail === "string" ? payload.statusDetail : input.message,
      nextStep: typeof payload.nextStep === "string" ? payload.nextStep : null,
      assumptions: Array.isArray(payload.assumptions) ? payload.assumptions : null,
      fidelityScore: typeof payload.fidelityScore === "number" ? payload.fidelityScore : null,
      ...payload
    }
  });
}

async function setPassStatus(
  runId: string,
  passStatusMap: Record<string, RunStatus | "idle">,
  stage: PipelineStage,
  status: RunStatus
) {
  passStatusMap[stage] = status;
  await updatePipelineRun(runId, { passStatusMap });
}

async function enhancePrompt(
  input: PipelineInput,
  styleContext: ReferenceStyleContext
): Promise<EnhanceResult> {
  const fallback: EnhanceResult = {
    title: "Generated Product Screen",
    intent: input.prompt,
    audience: "Design team",
    uxGoals: ["Clarify information hierarchy", "Preserve brand tone", "Keep interactions intuitive"],
    constraints: [
      `Device target: ${input.devicePreset}`,
      `Design mode: ${input.mode}`,
      `Surface target: ${input.surfaceTarget ?? (input.devicePreset === "iphone" ? "mobile" : "web")}`,
      `Design-system mode: ${input.designSystemMode ?? "strict"}`,
      input.tailwindEnabled ? "Tailwind utility classes enabled" : "React + CSS variable output"
    ]
  };

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    system:
      "You are a senior product designer. Return JSON with keys: title, intent, audience, uxGoals (array), constraints (array).",
    prompt: `User prompt: ${input.prompt}
Surface target: ${input.surfaceTarget ?? (input.devicePreset === "iphone" ? "mobile" : "web")}
Design-system mode: ${input.designSystemMode ?? "strict"}
Selected frame context:
${formatSelectedFrameContext(input.selectedFrameContext)}
Style palette: ${JSON.stringify(styleContext.palette)}
Return strict JSON.`
  });

  const result = asJsonObject<EnhanceResult>(completion.content, fallback);
  return {
    ...fallback,
    ...result,
    uxGoals: Array.isArray(result.uxGoals) && result.uxGoals.length > 0 ? result.uxGoals : fallback.uxGoals,
    constraints:
      Array.isArray(result.constraints) && result.constraints.length > 0 ? result.constraints : fallback.constraints
  };
}

async function createPlan(
  input: PipelineInput,
  enhanced: EnhanceResult,
  styleContext: ReferenceStyleContext
): Promise<PlanResult> {
  const fallback: PlanResult = {
    frameName: enhanced.title,
    subtitle: "Built with reference-aware style constraints and progressive refinement.",
    sections: [
      { title: "Hero Summary", description: "Immediate understanding of purpose and primary action." },
      { title: "Core Metrics", description: "Visual cards highlighting key outcomes and current status." },
      { title: "Execution Queue", description: "Actionable items with clear ownership and next steps." }
    ],
    keyActions: ["Primary CTA", "Secondary exploration", "Contextual edit affordance"]
  };

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    jsonMode: true,
    system:
      "You output concise planning JSON. Keys: frameName, subtitle, sections[{title,description}], keyActions[]. No markdown.",
    prompt: `Enhanced brief: ${JSON.stringify(enhanced)}
Surface target: ${input.surfaceTarget ?? (input.devicePreset === "iphone" ? "mobile" : "web")}
Design-system mode: ${input.designSystemMode ?? "strict"}
Selected frame context:
${formatSelectedFrameContext(input.selectedFrameContext)}
Style motifs: ${styleContext.layoutMotifs.join(", ")}`
  });

  const parsed = asJsonObject<PlanResult>(completion.content, fallback);
  return {
    ...fallback,
    ...parsed,
    sections: Array.isArray(parsed.sections) && parsed.sections.length > 0 ? parsed.sections : fallback.sections,
    keyActions: Array.isArray(parsed.keyActions) && parsed.keyActions.length > 0 ? parsed.keyActions : fallback.keyActions
  };
}

async function answerDesignQuestion(input: PipelineInput, styleContext: ReferenceStyleContext): Promise<string> {
  const fallback =
    "Here is the short answer: keep one primary action, reduce visual density, and anchor spacing/typography to your design-system tokens before generating new screens.";

  const completion = await requestCompletion({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    allowMock: false,
    system:
      "You are a product design assistant. The user asked a question and does not want generation. Reply in concise plain text with practical guidance.",
    prompt: `User question: ${input.prompt}
Style context: ${JSON.stringify(styleContext)}
Do not generate code.`
  });

  const content = completion.content.trim();
  return content.length > 0 ? content : fallback;
}

async function refineDesignSystemChecklist(args: {
  input: PipelineInput;
  styleContext: ReferenceStyleContext;
  currentChecklist: DesignSystemChecklist | null;
}): Promise<DesignSystemChecklist> {
  const fallback = args.currentChecklist ?? buildDesignSystemChecklistFromStyleContext(args.styleContext);

  const completion = await requestCompletion({
    provider: args.input.provider,
    model: args.input.model,
    apiKey: args.input.apiKey,
    allowMock: false,
    jsonMode: true,
    system:
      "You are a design-system designer. Return STRICT JSON only with key 'sections'. sections must be an array of {section:string, items:string[]}. Keep scope minimal but complete. No prose outside checklist.",
    prompt: `Current checklist JSON:
${JSON.stringify(fallback)}

User edit request:
${args.input.prompt}

Mandatory sections that must exist:
Brand foundations
Color system
Typography system
Spacing and layout
Shape and visual rules
Core components
Navigation

Optional sections (only include when supported by strong evidence):
Iconography and imagery
Feedback/status
Data display`
  });

  const parsed = asJsonObject<{ sections?: Array<{ section?: unknown; items?: unknown }> }>(
    completion.content,
    { sections: fallback.sections }
  );

  const sections = Array.isArray(parsed.sections)
    ? parsed.sections
        .map((section) => {
          const label = typeof section.section === "string" ? section.section.trim() : "";
          return {
            section: label,
            items: normalizeChecklistItems(section.items)
          };
        })
        .filter((section) => section.section.length > 0)
    : fallback.sections;

  return normalizeDesignSystemChecklist({
    source: "chat-refined",
    sections: sections.length > 0 ? sections : fallback.sections
  });
}

async function runQuestionRoute(args: {
  input: PipelineInput;
  context: PipelineContext;
  styleContext: ReferenceStyleContext;
  passStatusMap: Record<string, RunStatus | "idle">;
  intent: PromptIntent;
}) {
  await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "running");
  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "enhance",
    status: "info",
    kind: "summary",
    agent: "orchestrator",
    message: "Intent router classified this message as a design question. No generation actions will run.",
    payload: { reason: args.intent.reason }
  });

  const answer = await answerDesignQuestion(args.input, args.styleContext);

  await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "plan", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "generate", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "repair", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "diff-repair", "completed");

  await appendChatMessage({
    projectId: args.input.projectId,
    runId: args.input.runId,
    role: "agent",
    content: answer
  });

  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "plan",
    status: "success",
    kind: "summary",
    agent: "design-system-designer",
    message: answer
  });
}

async function runDesignSystemRoute(args: {
  input: PipelineInput;
  context: PipelineContext;
  styleContext: ReferenceStyleContext;
  passStatusMap: Record<string, RunStatus | "idle">;
  intent: PromptIntent;
}) {
  await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "running");
  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "enhance",
    status: "info",
    kind: "summary",
    agent: "orchestrator",
    message: "Routing request to the design-system pipeline (Figma researcher + DS designer).",
    payload: { designSystemAction: args.intent.designSystemAction }
  });

  const latestReference = await getLatestSyncedReference(args.input.projectId);
  if (!latestReference) {
    throw new Error("No synced Figma reference found. Attach a public Figma link first.");
  }

  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "plan",
    status: "info",
    kind: "action",
    agent: "design-system-figma-researcher",
    message: "Loaded latest synced Figma reference context for design-system alignment.",
    payload: {
      referenceId: latestReference.id,
      fileKey: latestReference.fileKey,
      scope: latestReference.scope
    }
  });

  if (args.intent.designSystemAction === "approve") {
    await updateReferenceSource(latestReference.id, {
      designSystemStatus: "approved",
      designSystemNotes: "Approved through chat.",
      updateDesignSystemAt: true
    });
    await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "completed");
    await setPassStatus(args.input.runId, args.passStatusMap, "plan", "completed");
    await setPassStatus(args.input.runId, args.passStatusMap, "generate", "completed");
    await setPassStatus(args.input.runId, args.passStatusMap, "repair", "completed");
    await setPassStatus(args.input.runId, args.passStatusMap, "diff-repair", "completed");

    await emitAgentEvent(args.context, {
      runId: args.input.runId,
      stage: "diff-repair",
      status: "success",
      kind: "summary",
      agent: "design-system-designer",
      message: "Design system approved. New generations will lock to this approved checklist."
    });
    return;
  }

  await setPassStatus(args.input.runId, args.passStatusMap, "plan", "running");
  const checklist = await refineDesignSystemChecklist({
    input: args.input,
    styleContext: latestReference.extractedStyleContext ?? args.styleContext,
    currentChecklist: latestReference.designSystemChecklist
  });
  await setPassStatus(args.input.runId, args.passStatusMap, "plan", "completed");

  await updateReferenceSource(latestReference.id, {
    designSystemChecklist: checklist,
    designSystemStatus: "needs-edits",
    designSystemNotes: args.input.prompt.trim(),
    updateDesignSystemAt: true
  });

  await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "generate", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "repair", "completed");
  await setPassStatus(args.input.runId, args.passStatusMap, "diff-repair", "completed");

  await appendChatMessage({
    projectId: args.input.projectId,
    runId: args.input.runId,
    role: "agent",
    content: formatChecklistForMessage(checklist)
  });

  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "diff-repair",
    status: "success",
    kind: "summary",
    agent: "design-system-designer",
    message: formatChecklistForMessage(checklist),
    payload: {
      referenceId: latestReference.id,
      sectionCount: checklist.sections.length
    }
  });
}

async function extractImageRebuildSpec(args: {
  input: PipelineInput;
  styleContext: ReferenceStyleContext;
  attachment: ComposerAttachment;
}): Promise<ImageRebuildSpec> {
  const fallbackFrameName = toNonEmptyString(args.input.prompt) ?? "Image Rebuild Screen";

  const completion = await requestCompletion({
    provider: args.input.provider,
    model: args.input.model,
    apiKey: args.input.apiKey,
    allowMock: false,
    jsonMode: true,
    attachments: [args.attachment],
    system:
      `You are a senior UI/UX designer specializing in exact visual reconstruction.
Return STRICT JSON only with keys:
- specVersion (string)
- frameName (string)
- confidence (0..1 number)
- assumptions (string[])
- clarificationQuestions (string[], max 2)
- layoutRegions ({name, role, hierarchyLevel, description}[])
- typography ({headingFamily, bodyFamily, headingScale:string[]})
- colorTokens ({primary, secondary, accent, background, surface, textPrimary, textSecondary})
- spacing ({baseUnit:number, radius:number, elevation:string})
- componentCandidates (string[])
- interactionHints (string[])
- fidelityTargets (string[])
- componentRecipes ({family,shape,cornerRadius,borderWidth,borderStyle,shadowStyle,density,controlHeight,fillStyle,iconStyle,evidence:string[],confidence:number,states:{name,emphasis,notes?}[]}[])
- extractionEvidence (string[])
- qualityReport ({fidelityScore:number,globalConfidence:number,status:\"high\"|\"medium\"|\"low\",referenceQuality:\"good\"|\"medium\"|\"poor\",detectionCoverage:{colorsDetected:number,componentFamiliesDetected:number},qualityReasons:string[],familyConfidence:{family,confidence,mismatch:string[],evidence:string[]}[],recommendations:string[]})

Focus on structure and visual fidelity extraction from the image. No markdown.`,
    prompt: `User prompt: ${args.input.prompt}
Device: ${args.input.devicePreset}
Mode: ${args.input.mode}
Style context: ${JSON.stringify(args.styleContext)}
Return strict JSON only.`
  });

  const parsed = asJsonObject<Record<string, unknown>>(completion.content, {});
  return normalizeImageRebuildSpec(parsed, fallbackFrameName);
}

async function runImageReferenceRoute(args: {
  input: PipelineInput;
  context: PipelineContext;
  styleContext: ReferenceStyleContext;
  passStatusMap: Record<string, RunStatus | "idle">;
  imageAttachment: ComposerAttachment;
}) {
  const sourceGroupId = crypto.randomUUID();
  const attachmentName = toNonEmptyString(args.imageAttachment.name) ?? "Attached Image";

  await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "running");
  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "enhance",
    status: "info",
    kind: "summary",
    agent: "orchestrator",
    message: "I’m reading your image and extracting the visual structure so we can rebuild it as editable React UI.",
    payload: {
      step: "image-analysis",
      artifact: attachmentName
    }
  });

  const imageSpec = await extractImageRebuildSpec({
    input: args.input,
    styleContext: args.styleContext,
    attachment: args.imageAttachment
  });
  const imageStyleContext = buildStyleContextFromImageSpec(args.styleContext, imageSpec);

  const assumptions = [...imageSpec.assumptions];
  const lowConfidence = imageSpec.confidence < 0.72 || imageSpec.layoutRegions.length < 2;
  if (lowConfidence) {
    const questions =
      imageSpec.clarificationQuestions.length > 0
        ? imageSpec.clarificationQuestions.slice(0, 2)
        : [
            "Should the rebuilt screen prioritize visual exactness over responsive adaptation?",
            "Should interactions remain static mock states or include richer motion/state transitions?"
          ];

    assumptions.push(
      "Proceed with strict visual fidelity first and adapt only where required for editability.",
      "Use inferred interaction states based on visible controls in the source image."
    );

    await emitAgentEvent(args.context, {
      runId: args.input.runId,
      stage: "enhance",
      status: "info",
      kind: "action",
      agent: "orchestrator",
      message: `Low-confidence areas detected. Quick checks: ${questions.join(" | ")}`,
      payload: {
        step: "confidence-check",
        statusDetail: "Continuing with assumptions after surfacing clarification questions.",
        assumptions,
        fidelityScore: imageSpec.confidence,
        confidence: imageSpec.confidence,
        family: "global",
        mismatch: [
          "Component morphology confidence is below target.",
          "Reference quality may be too low for exact control geometry."
        ],
        nextStep: "spec-generate",
        nextAction:
          "Reply in chat with /ds-calibrate buttons.shape=pill buttons.borderStyle=none buttons.fillStyle=solid (adjust values as needed).",
        calibrationOptions: [
          "buttons.shape=pill",
          "buttons.shape=rounded",
          "buttons.borderStyle=none",
          "buttons.borderStyle=solid",
          "buttons.fillStyle=solid",
          "buttons.fillStyle=outline",
          "cards.shadowStyle=none",
          "cards.shadowStyle=soft"
        ]
      }
    });
  }
  await setPassStatus(args.input.runId, args.passStatusMap, "enhance", "completed");

  await setPassStatus(args.input.runId, args.passStatusMap, "plan", "running");
  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "plan",
    status: "info",
    kind: "summary",
    agent: getPrimaryAgentForDevice(args.input.devicePreset),
    message: "I’m converting the extracted spec into a deterministic rebuild plan and linked DS board.",
    payload: {
      step: "spec-plan",
      target: imageSpec.frameName,
      fidelityScore: imageSpec.confidence,
      assumptions
    }
  });

  const enhanced: EnhanceResult = {
    title: imageSpec.frameName,
    intent: `Rebuild attached image with strict fidelity. Targets: ${imageSpec.fidelityTargets.join(", ") || "visual hierarchy and spacing"}`,
    audience: "Design team",
    uxGoals: imageSpec.componentCandidates.length > 0 ? imageSpec.componentCandidates : ["Preserve image layout hierarchy"],
    constraints: [
      `Device target: ${args.input.devicePreset}`,
      `Design mode: ${args.input.mode}`,
      "Preserve visual structure from source image with editability constraints",
      `Confidence score: ${imageSpec.confidence}`
    ]
  };
  const plan = await createPlan(args.input, enhanced, imageStyleContext);
  await setPassStatus(args.input.runId, args.passStatusMap, "plan", "completed");

  await setPassStatus(args.input.runId, args.passStatusMap, "generate", "running");
  let generation: GenerateArtifactsResult | null = null;
  let attemptCount = 0;
  let lastIssues: string[] = [];
  let lastDeviceValidation: ValidationResult = { valid: false, issues: [], checks: [] };
  let lastImageValidation: ValidationResult = { valid: false, issues: [], checks: [] };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptCount = attempt;
    await emitAgentEvent(args.context, {
      runId: args.input.runId,
      stage: "generate",
      status: "info",
      kind: "action",
      agent: getPrimaryAgentForDevice(args.input.devicePreset),
      message: `Building image-derived screen (attempt ${attempt}/3).`,
      payload: {
        step: "spec-generate",
        artifact: "reference-screen",
        attempt,
        assumptions,
        fidelityScore: imageSpec.confidence
      }
    });

    const attemptPrompt =
      attempt === 1
        ? args.input.prompt
        : `${args.input.prompt}\n\n${buildRetryPromptAddition({
            mode: "image",
            attempt,
            issues: lastIssues,
            spec: imageSpec,
            designSystemMode: args.input.designSystemMode ?? "strict",
            surfaceTarget: args.input.surfaceTarget ?? (args.input.devicePreset === "iphone" ? "mobile" : "web")
          })}`;

    generation = await generateScreenArtifacts({
      input: {
        ...args.input,
        prompt: `${attemptPrompt}

Image reconstruction spec:
${JSON.stringify(imageSpec, null, 2)}
`.trim()
      },
      styleContext: imageStyleContext,
      enhanced,
      plan,
      iterationLabel: "",
      previousSourceCode: "",
      previousCssCode: "",
      previousExportHtml: ""
    });

    lastDeviceValidation = validateArtifactsForDevice(generation.artifacts, {
      devicePreset: args.input.devicePreset,
      mode: args.input.mode
    });
    lastImageValidation = validateArtifactsAgainstImageSpec(generation.artifacts, imageSpec);

    lastIssues = [...lastDeviceValidation.issues, ...lastImageValidation.issues];
    if (lastIssues.length === 0) {
      break;
    }

    await emitAgentEvent(args.context, {
      runId: args.input.runId,
      stage: "repair",
      status: "info",
      kind: "action",
      agent: "orchestrator",
      message: `Validation failed on attempt ${attempt}. Retrying with stricter constraints.`,
      payload: {
        step: "spec-validate",
        attempt,
        statusDetail: lastIssues.join("; "),
        nextStep: attempt < 3 ? "retry-generate" : "stop-with-error",
        assumptions,
        fidelityScore: imageSpec.confidence
      }
    });
  }

  if (!generation || lastIssues.length > 0) {
    throw new Error(
      `Image rebuild could not meet fidelity checks after ${attemptCount} attempts. ${lastIssues.join("; ")}`
    );
  }

  const bundle = await getProjectBundle(args.input.projectId);
  if (!bundle) {
    throw new Error("Project not found while creating image reference frames.");
  }

  const screenSize = computeFrameSize(args.input.devicePreset);
  const screenPosition = computeNextFramePosition(bundle.frames, screenSize);
  const screenFrame = await createFrameRecord({
    projectId: args.input.projectId,
    name: generation.artifacts.frameName || imageSpec.frameName,
    devicePreset: args.input.devicePreset,
    mode: args.input.mode,
    position: screenPosition,
    size: screenSize,
    status: "building",
    selected: true
  });

  await updatePipelineRun(args.input.runId, {
    frameId: screenFrame.id
  });

  const versionGenerate = await persistVersion({
    frameId: screenFrame.id,
    previousSourceCode: "",
    artifacts: generation.artifacts,
    tailwindEnabled: args.input.tailwindEnabled ?? false,
    passName: "generate",
    passOutput: {
      sourceType: "image-reference",
      sourceRole: "reference-screen",
      sourceGroupId,
      attachmentId: args.imageAttachment.id,
      attachmentName,
      imageSpec,
      fidelityScore: imageSpec.confidence,
      assumptions,
      specVersion: imageSpec.specVersion,
      attemptCount,
      strategy: generation.strategy,
      usedProvider: generation.usedProvider,
      reason: generation.reason,
      mobileQualityChecks: lastDeviceValidation.checks,
      specQualityChecks: lastImageValidation.checks
    }
  });

  const artifactDerivedStyle = deriveStyleContextFromArtifacts(imageStyleContext, generation.artifacts);
  const mergedRecipes = mergeComponentRecipeSets(
    imageStyleContext.componentRecipes,
    artifactDerivedStyle.componentRecipes
  );
  const mergedExtractionEvidence = [
    ...(imageSpec.extractionEvidence ?? []),
    ...(artifactDerivedStyle.extractionEvidence ?? [])
  ];
  const mergedQualityReport = buildQualityReportFromRecipes(
    mergedRecipes.length > 0 ? mergedRecipes : artifactDerivedStyle.componentRecipes ?? [],
    mergedExtractionEvidence,
    Math.max(
      imageSpec.qualityReport?.fidelityScore ?? 0,
      artifactDerivedStyle.qualityReport?.fidelityScore ?? 0,
      imageSpec.confidence
    ),
    {
      colorsDetected: 5,
      componentFamiliesDetected: mergedRecipes.filter((recipe) => recipe.confidence >= 0.66).length
    }
  );
  const dsStyleContext: ReferenceStyleContext = {
    ...artifactDerivedStyle,
    source: imageStyleContext.source,
    palette: imageStyleContext.palette,
    typography: {
      headingFamily:
        artifactDerivedStyle.typography.headingFamily || imageStyleContext.typography.headingFamily,
      bodyFamily:
        artifactDerivedStyle.typography.bodyFamily || imageStyleContext.typography.bodyFamily,
      cornerRadius:
        mergedRecipes.find((recipe) => recipe.family === "buttons")?.cornerRadius ??
        artifactDerivedStyle.typography.cornerRadius ??
        imageStyleContext.typography.cornerRadius
    },
    spacingScale:
      artifactDerivedStyle.spacingScale.length >= imageStyleContext.spacingScale.length
        ? artifactDerivedStyle.spacingScale
        : imageStyleContext.spacingScale,
    componentPatterns:
      artifactDerivedStyle.componentPatterns.length > 0
        ? artifactDerivedStyle.componentPatterns
        : imageStyleContext.componentPatterns,
    layoutMotifs:
      imageStyleContext.layoutMotifs.length > 0
        ? imageStyleContext.layoutMotifs
        : artifactDerivedStyle.layoutMotifs,
    componentRecipes: mergedRecipes.length > 0 ? mergedRecipes : artifactDerivedStyle.componentRecipes,
    extractionEvidence: mergedExtractionEvidence,
    qualityReport: mergedQualityReport
  };
  const profileBundle = buildStyleProfileFromStyleContext({
    styleContext: dsStyleContext,
    sourceType: "image-reference",
    componentRecipes: dsStyleContext.componentRecipes,
    extractionEvidence: dsStyleContext.extractionEvidence,
    explicitQualityScore:
      imageSpec.qualityReport?.fidelityScore ??
      dsStyleContext.qualityReport?.fidelityScore ??
      imageSpec.confidence
  });
  const qualityReport =
    imageSpec.qualityReport ??
    dsStyleContext.qualityReport ??
    buildQualityReportFromRecipes(
      profileBundle.styleProfile.componentRecipes,
      profileBundle.styleProfile.extractionEvidence,
      imageSpec.confidence,
      {
        colorsDetected: profileBundle.styleProfile.tokens.colors.length,
        componentFamiliesDetected: profileBundle.styleProfile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
      }
    );
  const checklist = buildDesignSystemChecklistFromStyleContext(dsStyleContext);
  const designSystemMarkdown = generateDesignMarkdownFromStyleContext(
    dsStyleContext,
    "Design system extracted from attached image rebuild.",
    profileBundle.styleProfile,
    qualityReport
  );
  const parsedDesignSystem = parseDesignMarkdown(designSystemMarkdown, dsStyleContext, {
    styleProfile: profileBundle.styleProfile,
    qualityReport
  });
  await upsertProjectDesignSystem({
    projectId: args.input.projectId,
    markdown: parsedDesignSystem.markdown,
    structuredTokens: parsedDesignSystem.structuredTokens,
    status: "draft",
    sourceType: "image-reference",
    sourceReferenceId: null
  });

  const dsFrameResult = await upsertCanonicalDesignSystemFrame({
    projectId: args.input.projectId,
    bundle: {
      ...bundle,
      frames: [...bundle.frames, { ...screenFrame, versions: [] }]
    },
    styleContext: dsStyleContext,
    styleProfile: parsedDesignSystem.structuredTokens.styleProfile,
    qualityReport: parsedDesignSystem.structuredTokens.qualityReport,
    sourceType: "image-reference",
    scope: "frame",
    sourceLabel: "Image Reference",
    sourceDescription: `attached image "${attachmentName}"`,
    preferredSourceGroupId: sourceGroupId
  });
  await setPassStatus(args.input.runId, args.passStatusMap, "generate", "completed");

  await emitAgentEvent(args.context, {
    runId: args.input.runId,
    stage: "generate",
    status: "success",
    kind: "action",
    agent: getPrimaryAgentForDevice(args.input.devicePreset),
    message: "I created the rebuilt image frame and refreshed the canonical design-system board.",
    payload: {
      step: "image-pair-created",
      frameId: screenFrame.id,
      linkedFrameId: dsFrameResult.frameId,
      sourceGroupId: dsFrameResult.sourceGroupId,
      attempt: attemptCount,
      fidelityScore: imageSpec.confidence
    }
  });

  if (parsedDesignSystem.structuredTokens.qualityReport.status !== "high") {
    await emitAgentEvent(args.context, {
      runId: args.input.runId,
      stage: "generate",
      status: "info",
      kind: "action",
      agent: "design-system-designer",
      message: "I saved this design system as draft because component-form confidence is below target.",
      payload: {
        step: "design-system-confidence",
        family: "global",
        confidence: parsedDesignSystem.structuredTokens.qualityReport.globalConfidence,
        mismatch: parsedDesignSystem.structuredTokens.qualityReport.familyConfidence
          .flatMap((entry) => entry.mismatch)
          .slice(0, 4),
        nextAction:
          "Attach a cleaner reference or calibrate in chat with /ds-calibrate buttons.shape=<pill|rounded|sharp> buttons.fillStyle=<solid|outline|ghost>."
      }
    });
  }

  await setPassStatus(args.input.runId, args.passStatusMap, "repair", "running");
  const repaired = repairArtifacts(generation.artifacts);
  const versionRepair = await persistVersion({
    frameId: screenFrame.id,
    previousSourceCode: versionGenerate.sourceCode,
    artifacts: repaired,
    tailwindEnabled: args.input.tailwindEnabled ?? false,
    passName: "repair",
    passOutput: {
      sourceType: "image-reference",
      sourceRole: "reference-screen",
      sourceGroupId,
      note: "Image-derived repair safeguards applied.",
      imageSpec,
      assumptions,
      fidelityScore: imageSpec.confidence,
      mobileQualityChecks: lastDeviceValidation.checks,
      specQualityChecks: lastImageValidation.checks
    }
  });
  await setPassStatus(args.input.runId, args.passStatusMap, "repair", "completed");

  await setPassStatus(args.input.runId, args.passStatusMap, "diff-repair", "running");
  const diffRepaired = applyDiffRepair(repaired, args.input.editing ? args.input.prompt : undefined);
  await persistVersion({
    frameId: screenFrame.id,
    previousSourceCode: versionRepair.sourceCode,
    artifacts: diffRepaired,
    tailwindEnabled: args.input.tailwindEnabled ?? false,
    passName: "diff-repair",
    passOutput: {
      sourceType: "image-reference",
      sourceRole: "reference-screen",
      sourceGroupId,
      prompt: args.input.prompt,
      imageSpec,
      assumptions,
      fidelityScore: imageSpec.confidence,
      attemptCount,
      mobileQualityChecks: lastDeviceValidation.checks,
      specQualityChecks: lastImageValidation.checks
    }
  });
  await setPassStatus(args.input.runId, args.passStatusMap, "diff-repair", "completed");

  await updateFrameStatus(screenFrame.id, "ready");
  await updateFrameStatus(dsFrameResult.frameId, "ready");

  await appendChatMessage({
    projectId: args.input.projectId,
    runId: args.input.runId,
    role: "agent",
    content: `I rebuilt ${attachmentName} into an editable React frame with fidelity score ${Math.round(
      imageSpec.confidence * 100
    )}% and refreshed the canonical visual design-system board.`
  });
}

type ScreenArchetype = "login" | "onboarding" | "dashboard" | "settings" | "landing" | "generic";

function detectScreenArchetype(prompt: string): ScreenArchetype {
  const normalized = prompt.toLowerCase();
  if (/\b(login|sign in|signin|authentication|auth)\b/.test(normalized)) {
    return "login";
  }
  if (/\b(onboarding|onboard|welcome flow|getting started|first run)\b/.test(normalized)) {
    return "onboarding";
  }
  if (/\b(dashboard|analytics|overview|metrics|kpi)\b/.test(normalized)) {
    return "dashboard";
  }
  if (/\b(settings|preferences|profile settings|account settings)\b/.test(normalized)) {
    return "settings";
  }
  if (/\b(landing page|marketing page|hero section|homepage|home page)\b/.test(normalized)) {
    return "landing";
  }
  return "generic";
}

function buildArtifacts(args: {
  prompt: string;
  mode: DesignMode;
  devicePreset: DevicePreset;
  tailwindEnabled: boolean;
  styleContext: ReferenceStyleContext;
  enhanced: EnhanceResult;
  plan: PlanResult;
  iterationLabel: string;
}): FrameArtifacts {
  const { styleContext, mode, enhanced, plan } = args;
  const isWireframe = mode === "wireframe";
  const palette = isWireframe
    ? {
        primary: "#5f646d",
        secondary: "#717783",
        accent: "#8e949f",
        surface: "#f4f5f7",
        text: "#151922"
      }
    : styleContext.palette;

  const sectionHtml = plan.sections
    .map(
      (section) => `
      <article class="tw-card">
        <h3>${escapeHtml(section.title)}</h3>
        <p>${escapeHtml(section.description)}</p>
      </article>
    `
    )
    .join("\n");

  const sectionJsx = plan.sections
    .map(
      (section) => `
        <article className="tw-card">
          <h3>${JSON.stringify(section.title)}</h3>
          <p>${JSON.stringify(section.description)}</p>
        </article>
      `
    )
    .join("\n");

  const actions = plan.keyActions.slice(0, 3);
  const actionHtml = actions.map((action) => `<button>${escapeHtml(action)}</button>`).join("");
  const actionJsx = actions.map((action) => `<button>${JSON.stringify(action)}</button>`).join("");

  const headerTitle = `${plan.frameName} ${args.iterationLabel}`.trim();
  const subtitle = plan.subtitle;

  const exportHtml = `
    <div class="tw-screen${args.tailwindEnabled ? " tw-tailwind-mode" : ""}">
      <header class="tw-hero">
        <div>
          <p class="tw-kicker">${escapeHtml(args.devicePreset.toUpperCase())} • ${escapeHtml(mode.toUpperCase())}</p>
          <h1>${escapeHtml(headerTitle)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      <section class="tw-grid">
        ${sectionHtml}
      </section>
      <footer class="tw-actions">${actionHtml}</footer>
    </div>
  `.trim();

  const cssCode = `
    :root {
      --tw-primary: ${palette.primary};
      --tw-secondary: ${palette.secondary};
      --tw-accent: ${palette.accent};
      --tw-surface: ${palette.surface};
      --tw-text: ${palette.text};
      --tw-radius: ${styleContext.typography.cornerRadius}px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ${styleContext.typography.bodyFamily};
      background: var(--tw-surface);
      color: var(--tw-text);
      min-height: 100vh;
      padding: 20px;
    }

    .tw-screen {
      border: 1px solid color-mix(in srgb, var(--tw-secondary) 18%, white);
      border-radius: calc(var(--tw-radius) + 8px);
      background: linear-gradient(180deg, #ffffff 0%, color-mix(in srgb, var(--tw-surface) 85%, white) 100%);
      box-shadow: 0 18px 44px rgba(24, 28, 40, 0.08);
      min-height: ${args.devicePreset === "iphone" ? "820px" : "680px"};
      padding: 26px;
      display: grid;
      gap: 18px;
      align-content: start;
    }

    .tw-hero h1 {
      margin: 6px 0 6px;
      font-family: ${styleContext.typography.headingFamily};
      font-size: ${args.devicePreset === "iphone" ? "30px" : "36px"};
      letter-spacing: -0.03em;
      line-height: 1.08;
    }

    .tw-hero p {
      margin: 0;
      color: color-mix(in srgb, var(--tw-text) 72%, white);
      font-size: 15px;
      line-height: 1.45;
      max-width: 64ch;
    }

    .tw-kicker {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--tw-primary);
    }

    .tw-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(${args.devicePreset === "iphone" ? "240px" : "280px"}, 1fr));
    }

    .tw-card {
      background: rgba(255, 255, 255, 0.86);
      border: 1px solid color-mix(in srgb, var(--tw-secondary) 12%, white);
      border-radius: var(--tw-radius);
      padding: 14px 15px;
      display: grid;
      gap: 8px;
    }

    .tw-card h3 {
      margin: 0;
      font-family: ${styleContext.typography.headingFamily};
      font-size: 17px;
      letter-spacing: -0.01em;
    }

    .tw-card p {
      margin: 0;
      font-size: 14px;
      line-height: 1.45;
      color: color-mix(in srgb, var(--tw-text) 75%, white);
    }

    .tw-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tw-actions button {
      border: 1px solid color-mix(in srgb, var(--tw-primary) 24%, white);
      background: color-mix(in srgb, var(--tw-primary) 18%, white);
      color: var(--tw-text);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 600;
    }

    .tw-tailwind-mode .tw-card {
      outline: 1px dashed color-mix(in srgb, var(--tw-accent) 42%, white);
    }
  `.trim();

  const sourceCode = `
    function GeneratedScreen() {
      return (
        <div className="tw-screen${args.tailwindEnabled ? " tw-tailwind-mode" : ""}">
          <header className="tw-hero">
            <div>
              <p className="tw-kicker">${JSON.stringify(args.devicePreset.toUpperCase())} + " • " + ${JSON.stringify(mode.toUpperCase())}</p>
              <h1>${JSON.stringify(headerTitle)}</h1>
              <p>${JSON.stringify(subtitle)}</p>
            </div>
          </header>
          <section className="tw-grid">
            ${sectionJsx}
          </section>
          <footer className="tw-actions">
            ${actionJsx}
          </footer>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<GeneratedScreen />);
  `.trim();

  return {
    frameName: headerTitle,
    sourceCode,
    cssCode,
    exportHtml
  };
}

function buildPromptAwareFallbackArtifacts(args: {
  prompt: string;
  mode: DesignMode;
  devicePreset: DevicePreset;
  tailwindEnabled: boolean;
  styleContext: ReferenceStyleContext;
  enhanced: EnhanceResult;
  plan: PlanResult;
  iterationLabel: string;
}): FrameArtifacts {
  const archetype = detectScreenArchetype(`${args.prompt} ${args.enhanced.title}`);
  if (archetype === "generic") {
    return buildArtifacts(args);
  }

  const palette = args.mode === "wireframe"
    ? {
        primary: "#636b78",
        secondary: "#848b99",
        accent: "#a3a9b4",
        surface: "#f4f5f7",
        text: "#151922"
      }
    : args.styleContext.palette;
  const frameName = `${args.enhanced.title} ${args.iterationLabel}`.trim();
  const subtitle = args.plan.subtitle || args.enhanced.intent;
  const mobile = args.devicePreset === "iphone";

  let bodyHtml = "";
  let bodyJsx = "";
  let extraCss = "";

  if (archetype === "login") {
    bodyHtml = `
      <section class="tw-auth-shell">
        <article class="tw-auth-card">
          <h2>Welcome back</h2>
          <p>Sign in to continue to your workspace.</p>
          <label>Email<input type="email" placeholder="name@company.com" /></label>
          <label>Password<input type="password" placeholder="••••••••" /></label>
          <button class="tw-primary-btn">Sign in</button>
          <button class="tw-link-btn">Forgot password?</button>
        </article>
        <aside class="tw-auth-side">
          <h3>Secure access</h3>
          <ul>
            <li>Single sign-on support</li>
            <li>Session and device controls</li>
            <li>Audit-ready authentication logs</li>
          </ul>
        </aside>
      </section>
    `.trim();
    bodyJsx = `
      <section className="tw-auth-shell">
        <article className="tw-auth-card">
          <h2>Welcome back</h2>
          <p>Sign in to continue to your workspace.</p>
          <label>Email<input type="email" placeholder="name@company.com" /></label>
          <label>Password<input type="password" placeholder="••••••••" /></label>
          <button className="tw-primary-btn">Sign in</button>
          <button className="tw-link-btn">Forgot password?</button>
        </article>
        <aside className="tw-auth-side">
          <h3>Secure access</h3>
          <ul>
            <li>Single sign-on support</li>
            <li>Session and device controls</li>
            <li>Audit-ready authentication logs</li>
          </ul>
        </aside>
      </section>
    `.trim();
    extraCss = `
      .tw-auth-shell { display: grid; grid-template-columns: ${mobile ? "1fr" : "1.1fr 0.9fr"}; gap: 16px; }
      .tw-auth-card, .tw-auth-side { background: #fff; border: 1px solid color-mix(in srgb, var(--tw-secondary) 16%, white); border-radius: var(--tw-radius); padding: 18px; display: grid; gap: 10px; align-content: start; }
      .tw-auth-card h2 { margin: 0; font-family: ${args.styleContext.typography.headingFamily}; font-size: ${mobile ? "26px" : "30px"}; }
      .tw-auth-card p { margin: 0; color: color-mix(in srgb, var(--tw-text) 72%, white); }
      .tw-auth-card label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: color-mix(in srgb, var(--tw-text) 85%, white); }
      .tw-auth-card input { border: 1px solid color-mix(in srgb, var(--tw-secondary) 22%, white); background: color-mix(in srgb, var(--tw-surface) 70%, white); border-radius: calc(var(--tw-radius) - 4px); padding: 10px 12px; font-size: 14px; color: var(--tw-text); }
      .tw-primary-btn { border: 0; border-radius: calc(var(--tw-radius) - 4px); padding: 11px 14px; background: var(--tw-primary); color: #fff; font-weight: 700; }
      .tw-link-btn { border: 0; background: transparent; color: var(--tw-primary); padding: 4px 0; justify-self: start; font-weight: 600; }
      .tw-auth-side h3 { margin: 0; font-size: 18px; font-family: ${args.styleContext.typography.headingFamily}; }
      .tw-auth-side ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
    `;
  } else if (archetype === "onboarding") {
    bodyHtml = `
      <section class="tw-onboarding-shell">
        <article class="tw-onboarding-progress">
          <h2>Step 2 of 4</h2>
          <p>Tell us your goals so the assistant can tailor the workspace.</p>
          <div class="tw-progress-track"><span style="width: 50%"></span></div>
        </article>
        <article class="tw-onboarding-question">
          <h3>What do you want to design first?</h3>
          <div class="tw-choice-grid">
            <button class="is-active">App onboarding flow</button>
            <button>Marketing landing page</button>
            <button>Internal dashboard</button>
            <button>Design system refresh</button>
          </div>
          <footer>
            <button class="tw-secondary-btn">Back</button>
            <button class="tw-primary-btn">Continue</button>
          </footer>
        </article>
      </section>
    `.trim();
    bodyJsx = `
      <section className="tw-onboarding-shell">
        <article className="tw-onboarding-progress">
          <h2>Step 2 of 4</h2>
          <p>Tell us your goals so the assistant can tailor the workspace.</p>
          <div className="tw-progress-track"><span style={{ width: "50%" }} /></div>
        </article>
        <article className="tw-onboarding-question">
          <h3>What do you want to design first?</h3>
          <div className="tw-choice-grid">
            <button className="is-active">App onboarding flow</button>
            <button>Marketing landing page</button>
            <button>Internal dashboard</button>
            <button>Design system refresh</button>
          </div>
          <footer>
            <button className="tw-secondary-btn">Back</button>
            <button className="tw-primary-btn">Continue</button>
          </footer>
        </article>
      </section>
    `.trim();
    extraCss = `
      .tw-onboarding-shell { display: grid; gap: 14px; align-content: start; }
      .tw-onboarding-progress, .tw-onboarding-question { border: 1px solid color-mix(in srgb, var(--tw-secondary) 16%, white); background: #fff; border-radius: var(--tw-radius); padding: 16px; display: grid; gap: 10px; }
      .tw-onboarding-progress h2, .tw-onboarding-question h3 { margin: 0; font-family: ${args.styleContext.typography.headingFamily}; letter-spacing: -0.02em; }
      .tw-progress-track { height: 10px; border-radius: 999px; background: color-mix(in srgb, var(--tw-surface) 60%, white); overflow: hidden; }
      .tw-progress-track span { display: block; height: 100%; background: linear-gradient(90deg, var(--tw-primary), var(--tw-accent)); border-radius: inherit; }
      .tw-choice-grid { display: grid; grid-template-columns: repeat(${mobile ? "1" : "2"}, minmax(0, 1fr)); gap: 10px; }
      .tw-choice-grid button { border: 1px solid color-mix(in srgb, var(--tw-secondary) 18%, white); background: #fff; color: var(--tw-text); border-radius: calc(var(--tw-radius) - 4px); min-height: 54px; text-align: left; padding: 10px 12px; font-size: 14px; }
      .tw-choice-grid .is-active { border-color: color-mix(in srgb, var(--tw-primary) 62%, white); background: color-mix(in srgb, var(--tw-primary) 14%, white); }
      .tw-onboarding-question footer { display: flex; justify-content: space-between; gap: 10px; }
      .tw-secondary-btn { border: 1px solid color-mix(in srgb, var(--tw-secondary) 24%, white); background: #fff; color: var(--tw-text); border-radius: calc(var(--tw-radius) - 4px); padding: 10px 14px; }
      .tw-primary-btn { border: 0; border-radius: calc(var(--tw-radius) - 4px); padding: 10px 14px; background: var(--tw-primary); color: #fff; font-weight: 700; }
    `;
  } else if (archetype === "settings") {
    bodyHtml = `
      <section class="tw-settings-shell">
        <article class="tw-settings-card">
          <h2>Workspace settings</h2>
          <label>Workspace name<input type="text" value="Publisher's Workshop" /></label>
          <label>Primary domain<input type="text" value="publisher.example.com" /></label>
          <label>Default mode<select><option>High-fidelity</option><option>Wireframe</option></select></label>
        </article>
        <article class="tw-settings-card">
          <h2>Preferences</h2>
          <div class="tw-toggle-row"><span>Enable live collaboration</span><button>On</button></div>
          <div class="tw-toggle-row"><span>Email notifications</span><button>Off</button></div>
          <div class="tw-toggle-row"><span>Allow external invites</span><button>On</button></div>
        </article>
      </section>
    `.trim();
    bodyJsx = `
      <section className="tw-settings-shell">
        <article className="tw-settings-card">
          <h2>Workspace settings</h2>
          <label>Workspace name<input type="text" defaultValue="Publisher's Workshop" /></label>
          <label>Primary domain<input type="text" defaultValue="publisher.example.com" /></label>
          <label>Default mode<select defaultValue="High-fidelity"><option>High-fidelity</option><option>Wireframe</option></select></label>
        </article>
        <article className="tw-settings-card">
          <h2>Preferences</h2>
          <div className="tw-toggle-row"><span>Enable live collaboration</span><button>On</button></div>
          <div className="tw-toggle-row"><span>Email notifications</span><button>Off</button></div>
          <div className="tw-toggle-row"><span>Allow external invites</span><button>On</button></div>
        </article>
      </section>
    `.trim();
    extraCss = `
      .tw-settings-shell { display: grid; grid-template-columns: repeat(${mobile ? "1" : "2"}, minmax(0, 1fr)); gap: 14px; }
      .tw-settings-card { border: 1px solid color-mix(in srgb, var(--tw-secondary) 15%, white); background: #fff; border-radius: var(--tw-radius); padding: 16px; display: grid; gap: 12px; align-content: start; }
      .tw-settings-card h2 { margin: 0; font-family: ${args.styleContext.typography.headingFamily}; font-size: 20px; }
      .tw-settings-card label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
      .tw-settings-card input, .tw-settings-card select { border: 1px solid color-mix(in srgb, var(--tw-secondary) 20%, white); border-radius: calc(var(--tw-radius) - 4px); padding: 10px 12px; font-size: 14px; }
      .tw-toggle-row { display: flex; justify-content: space-between; align-items: center; border: 1px solid color-mix(in srgb, var(--tw-secondary) 14%, white); border-radius: calc(var(--tw-radius) - 4px); padding: 10px 12px; background: color-mix(in srgb, var(--tw-surface) 78%, white); }
      .tw-toggle-row button { border: 0; border-radius: 999px; padding: 6px 12px; background: var(--tw-primary); color: #fff; font-size: 12px; font-weight: 700; }
    `;
  } else if (archetype === "landing") {
    bodyHtml = `
      <section class="tw-landing-hero">
        <div>
          <p class="tw-kicker">Built with your brand system</p>
          <h2>Design faster with a conversational UI builder.</h2>
          <p>Generate complete, editable interface screens directly from natural language prompts.</p>
          <div class="tw-actions">
            <button class="tw-primary-btn">Start designing</button>
            <button class="tw-secondary-btn">Watch preview</button>
          </div>
        </div>
      </section>
      <section class="tw-feature-grid">
        <article><h3>Prompt-driven creation</h3><p>Turn intent into production-grade screens.</p></article>
        <article><h3>Reference aware</h3><p>Keep all generated UI aligned with existing brand visuals.</p></article>
        <article><h3>Figma-ready output</h3><p>Copy editable frame content into Figma.</p></article>
      </section>
    `.trim();
    bodyJsx = `
      <>
        <section className="tw-landing-hero">
          <div>
            <p className="tw-kicker">Built with your brand system</p>
            <h2>Design faster with a conversational UI builder.</h2>
            <p>Generate complete, editable interface screens directly from natural language prompts.</p>
            <div className="tw-actions">
              <button className="tw-primary-btn">Start designing</button>
              <button className="tw-secondary-btn">Watch preview</button>
            </div>
          </div>
        </section>
        <section className="tw-feature-grid">
          <article><h3>Prompt-driven creation</h3><p>Turn intent into production-grade screens.</p></article>
          <article><h3>Reference aware</h3><p>Keep all generated UI aligned with existing brand visuals.</p></article>
          <article><h3>Figma-ready output</h3><p>Copy editable frame content into Figma.</p></article>
        </section>
      </>
    `.trim();
    extraCss = `
      .tw-landing-hero { background: linear-gradient(155deg, color-mix(in srgb, var(--tw-primary) 18%, white), #fff 58%); border: 1px solid color-mix(in srgb, var(--tw-primary) 20%, white); border-radius: var(--tw-radius); padding: ${mobile ? "18px" : "26px"}; }
      .tw-landing-hero h2 { margin: 0 0 8px; font-family: ${args.styleContext.typography.headingFamily}; font-size: ${mobile ? "30px" : "42px"}; line-height: 1.06; letter-spacing: -0.03em; max-width: 18ch; }
      .tw-landing-hero p { margin: 0; max-width: 56ch; color: color-mix(in srgb, var(--tw-text) 74%, white); }
      .tw-feature-grid { display: grid; gap: 12px; grid-template-columns: repeat(${mobile ? "1" : "3"}, minmax(0, 1fr)); }
      .tw-feature-grid article { background: #fff; border: 1px solid color-mix(in srgb, var(--tw-secondary) 14%, white); border-radius: calc(var(--tw-radius) - 2px); padding: 14px; display: grid; gap: 6px; }
      .tw-feature-grid h3 { margin: 0; font-family: ${args.styleContext.typography.headingFamily}; font-size: 17px; }
      .tw-feature-grid p { margin: 0; font-size: 14px; color: color-mix(in srgb, var(--tw-text) 74%, white); }
      .tw-primary-btn { border: 0; border-radius: 999px; padding: 10px 14px; background: var(--tw-primary); color: #fff; font-weight: 700; }
      .tw-secondary-btn { border: 1px solid color-mix(in srgb, var(--tw-primary) 28%, white); border-radius: 999px; padding: 10px 14px; background: #fff; color: var(--tw-text); font-weight: 600; }
    `;
  } else {
    bodyHtml = `
      <section class="tw-dashboard-grid">
        <article class="tw-stat"><h3>Active users</h3><p>14,208</p><span>+8.4% this week</span></article>
        <article class="tw-stat"><h3>Conversion rate</h3><p>6.2%</p><span>+0.9pp</span></article>
        <article class="tw-stat"><h3>Retention</h3><p>78%</p><span>Stable</span></article>
      </section>
      <section class="tw-dashboard-table">
        <header><strong>Recent activity</strong><span>Today</span></header>
        <table>
          <thead><tr><th>User</th><th>Flow</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            <tr><td>Alex Chen</td><td>Onboarding</td><td>Completed</td><td>2m ago</td></tr>
            <tr><td>Jordan Kim</td><td>Checkout</td><td>In progress</td><td>9m ago</td></tr>
            <tr><td>Taylor Reed</td><td>Profile setup</td><td>Blocked</td><td>17m ago</td></tr>
          </tbody>
        </table>
      </section>
    `.trim();
    bodyJsx = `
      <>
        <section className="tw-dashboard-grid">
          <article className="tw-stat"><h3>Active users</h3><p>14,208</p><span>+8.4% this week</span></article>
          <article className="tw-stat"><h3>Conversion rate</h3><p>6.2%</p><span>+0.9pp</span></article>
          <article className="tw-stat"><h3>Retention</h3><p>78%</p><span>Stable</span></article>
        </section>
        <section className="tw-dashboard-table">
          <header><strong>Recent activity</strong><span>Today</span></header>
          <table>
            <thead><tr><th>User</th><th>Flow</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>
              <tr><td>Alex Chen</td><td>Onboarding</td><td>Completed</td><td>2m ago</td></tr>
              <tr><td>Jordan Kim</td><td>Checkout</td><td>In progress</td><td>9m ago</td></tr>
              <tr><td>Taylor Reed</td><td>Profile setup</td><td>Blocked</td><td>17m ago</td></tr>
            </tbody>
          </table>
        </section>
      </>
    `.trim();
    extraCss = `
      .tw-dashboard-grid { display: grid; gap: 12px; grid-template-columns: repeat(${mobile ? "1" : "3"}, minmax(0, 1fr)); }
      .tw-stat { border: 1px solid color-mix(in srgb, var(--tw-secondary) 16%, white); background: #fff; border-radius: var(--tw-radius); padding: 14px; display: grid; gap: 4px; }
      .tw-stat h3 { margin: 0; font-size: 13px; color: color-mix(in srgb, var(--tw-text) 76%, white); text-transform: uppercase; letter-spacing: 0.08em; }
      .tw-stat p { margin: 0; font-family: ${args.styleContext.typography.headingFamily}; font-size: 28px; line-height: 1.05; }
      .tw-stat span { font-size: 13px; color: color-mix(in srgb, var(--tw-text) 68%, white); }
      .tw-dashboard-table { border: 1px solid color-mix(in srgb, var(--tw-secondary) 16%, white); background: #fff; border-radius: var(--tw-radius); overflow: hidden; }
      .tw-dashboard-table header { display: flex; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid color-mix(in srgb, var(--tw-secondary) 12%, white); }
      .tw-dashboard-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .tw-dashboard-table th, .tw-dashboard-table td { text-align: left; padding: 10px 16px; border-bottom: 1px solid color-mix(in srgb, var(--tw-secondary) 8%, white); }
      .tw-dashboard-table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: color-mix(in srgb, var(--tw-text) 62%, white); }
    `;
  }

  const exportHtml = `
    <div class="tw-screen${args.tailwindEnabled ? " tw-tailwind-mode" : ""}">
      <header class="tw-hero">
        <div>
          <p class="tw-kicker">${escapeHtml(args.devicePreset.toUpperCase())} • ${escapeHtml(args.mode.toUpperCase())}</p>
          <h1>${escapeHtml(frameName)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      ${bodyHtml}
    </div>
  `.trim();

  const cssCode = `
    :root {
      --tw-primary: ${palette.primary};
      --tw-secondary: ${palette.secondary};
      --tw-accent: ${palette.accent};
      --tw-surface: ${palette.surface};
      --tw-text: ${palette.text};
      --tw-radius: ${args.styleContext.typography.cornerRadius}px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 18px;
      font-family: ${args.styleContext.typography.bodyFamily};
      color: var(--tw-text);
      background: var(--tw-surface);
    }
    .tw-screen {
      border: 1px solid color-mix(in srgb, var(--tw-secondary) 18%, white);
      border-radius: calc(var(--tw-radius) + 8px);
      background: linear-gradient(180deg, #fff 0%, color-mix(in srgb, var(--tw-surface) 86%, white) 100%);
      box-shadow: 0 16px 38px rgba(21, 25, 33, 0.08);
      min-height: ${mobile ? "820px" : "700px"};
      padding: 20px;
      display: grid;
      gap: 14px;
      align-content: start;
    }
    .tw-hero h1 {
      margin: 6px 0;
      font-family: ${args.styleContext.typography.headingFamily};
      font-size: ${mobile ? "31px" : "40px"};
      line-height: 1.05;
      letter-spacing: -0.03em;
    }
    .tw-hero p { margin: 0; color: color-mix(in srgb, var(--tw-text) 72%, white); }
    .tw-kicker {
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tw-primary);
    }
    .tw-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .tw-tailwind-mode .tw-screen { outline: 1px dashed color-mix(in srgb, var(--tw-accent) 42%, white); }
    ${extraCss}
  `.trim();

  const sourceCode = `
    function GeneratedScreen() {
      return (
        <div className="tw-screen${args.tailwindEnabled ? " tw-tailwind-mode" : ""}">
          <header className="tw-hero">
            <div>
              <p className="tw-kicker">${JSON.stringify(args.devicePreset.toUpperCase())} + " • " + ${JSON.stringify(
                args.mode.toUpperCase()
              )}</p>
              <h1>${JSON.stringify(frameName)}</h1>
              <p>${JSON.stringify(subtitle)}</p>
            </div>
          </header>
          ${bodyJsx}
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<GeneratedScreen />);
  `.trim();

  return {
    frameName,
    sourceCode,
    cssCode,
    exportHtml
  };
}

async function generateScreenArtifacts(args: {
  input: PipelineInput;
  styleContext: ReferenceStyleContext;
  enhanced: EnhanceResult;
  plan: PlanResult;
  iterationLabel: string;
  previousSourceCode: string;
  previousCssCode?: string;
  previousExportHtml?: string;
}): Promise<GenerateArtifactsResult> {
  const isIphone = args.input.devicePreset === "iphone";
  const surfaceTarget = args.input.surfaceTarget ?? (isIphone ? "mobile" : "web");
  const designSystemMode = args.input.designSystemMode ?? "strict";

  const completion = await requestCompletion({
    provider: args.input.provider,
    model: args.input.model,
    apiKey: args.input.apiKey,
    allowMock: false,
    jsonMode: true,
    attachments: args.input.attachments,
    system: `You are a senior UI engineer and product designer.
Return STRICT JSON only with keys:
- frameName (string)
- sourceCode (string)
- cssCode (string)
- exportHtml (string)

Hard constraints:
- Build a real, concrete screen that matches the user prompt intent (login, onboarding, dashboard, etc.).
- Never return a generic template card layout.
- sourceCode must run in browser Babel with global React and ReactDOM; no imports/exports.
- sourceCode must call ReactDOM.createRoot(document.getElementById("root")).render(...)
- cssCode must be valid CSS.
- exportHtml must be static HTML for the same initial UI state and must not contain <script> tags.
- Keep output production-like and brand-aligned using provided style context.
- If device preset is iphone or surfaceTarget is mobile: output native app-like IA (safe-area aware top area, mobile sections, touch-friendly controls), no desktop marketing hero patterns.
- In strict mode, prefer style-context tokens (color, fonts, radius) and avoid unexplained drift.
- In creative mode, keep recognizable brand cues while allowing broader visual exploration.
- Return JSON only.`,
    prompt: `User prompt:
${args.input.prompt}

Enhanced brief:
${JSON.stringify(args.enhanced, null, 2)}

Screen plan:
${JSON.stringify(args.plan, null, 2)}

Design constraints:
- Device preset: ${args.input.devicePreset}
- Mode: ${args.input.mode}
- Surface target: ${surfaceTarget}
- Design-system mode: ${designSystemMode}
- Tailwind enabled: ${args.input.tailwindEnabled ? "yes" : "no"}
- Editing existing frame: ${args.input.editing ? "yes" : "no"}

Selected frame context:
${formatSelectedFrameContext(args.input.selectedFrameContext)}

Style context:
${JSON.stringify(args.styleContext, null, 2)}

Existing frame source (for edit runs, patch/replace with improved version):
${args.previousSourceCode.slice(0, 8500)}

Existing frame css:
${(args.previousCssCode ?? "").slice(0, 3500)}

Existing frame html:
${(args.previousExportHtml ?? "").slice(0, 3500)}`
  });

  const parsed = asJsonObject<Record<string, unknown>>(completion.content, {});
  const candidate = normalizeGeneratedArtifacts(parsed);

  if (!candidate) {
    throw new Error("Model response was missing required frame artifact fields (frameName/sourceCode/cssCode/exportHtml).");
  }

  if (isIphone) {
    const withSafeAreaCss = candidate.cssCode.includes("safe-area-inset")
      ? candidate.cssCode
      : `${candidate.cssCode}

.tw-screen {
  padding-top: calc(20px + env(safe-area-inset-top));
  padding-bottom: calc(18px + env(safe-area-inset-bottom));
}
`;
    candidate.cssCode = withSafeAreaCss;
  }

  return {
    artifacts: candidate,
    strategy: "model",
    usedProvider: completion.usedProvider as ProviderId,
    reason: "Model generated prompt-specific frame artifacts."
  };
}

function repairArtifacts(input: FrameArtifacts): FrameArtifacts {
  let cssCode = input.cssCode;
  if (!cssCode.includes("* { box-sizing: border-box; }")) {
    cssCode = `* { box-sizing: border-box; }\n${cssCode}`;
  }

  let sourceCode = input.sourceCode;
  if (!sourceCode.includes("ReactDOM.createRoot")) {
    const componentName = detectPrimaryComponentName(sourceCode) ?? "GeneratedScreen";
    sourceCode = `${sourceCode}\n\nReactDOM.createRoot(document.getElementById("root")).render(<${componentName} />);`;
  }

  let exportHtml = input.exportHtml;
  if (!toNonEmptyString(exportHtml)) {
    exportHtml = `<div style="padding:16px;font-family:ui-sans-serif,system-ui;">${escapeHtml(input.frameName)}</div>`;
  }

  return {
    ...input,
    cssCode,
    sourceCode,
    exportHtml
  };
}

function applyDiffRepair(input: FrameArtifacts, editPrompt?: string): FrameArtifacts {
  if (!editPrompt) {
    return input;
  }

  const lowered = editPrompt.toLowerCase();
  let cssCode = input.cssCode;
  let exportHtml = input.exportHtml;
  let sourceCode = input.sourceCode;

  if (lowered.includes("dark")) {
    cssCode = cssCode.replace("--tw-surface: #f7f4ef;", "--tw-surface: #141922;");
    cssCode = cssCode.replace("--tw-text: #1f2430;", "--tw-text: #f5f8ff;");
  }

  if (lowered.includes("minimal")) {
    exportHtml = exportHtml.replace(/<section class=\"tw-grid\">[\s\S]*?<\/section>/, "<section class=\"tw-grid\"></section>");
    sourceCode = sourceCode.replace(/<section className=\"tw-grid\">[\s\S]*?<\/section>/, "<section className=\"tw-grid\"></section>");
  }

  return { ...input, cssCode, exportHtml, sourceCode };
}

function buildDesignSystemComponentsArtifacts(args: {
  styleContext: ReferenceStyleContext;
  frameName: string;
  scope: "frame" | "page";
  sourceLabel?: string;
  sourceDescription?: string;
  styleProfile?: ProjectDesignSystem["structuredTokens"]["styleProfile"];
  qualityReport?: ProjectDesignSystem["structuredTokens"]["qualityReport"];
}): FrameArtifacts {
  return buildDesignSystemComponentsArtifactsFromProfile(args);
}

type BundleFrame = NonNullable<Awaited<ReturnType<typeof getProjectBundle>>>["frames"][number];

function latestFramePassOutputs(frame: BundleFrame): Record<string, unknown> | null {
  const latestVersion = frame.versions[frame.versions.length - 1];
  if (!latestVersion || typeof latestVersion.passOutputs !== "object" || !latestVersion.passOutputs) {
    return null;
  }
  return latestVersion.passOutputs;
}

function frameSourceRole(frame: BundleFrame): string | null {
  const passOutputs = latestFramePassOutputs(frame);
  const sourceRole = passOutputs?.sourceRole;
  return typeof sourceRole === "string" ? sourceRole : null;
}

function frameSourceGroupId(frame: BundleFrame): string | null {
  const passOutputs = latestFramePassOutputs(frame);
  const sourceGroupId = passOutputs?.sourceGroupId;
  return typeof sourceGroupId === "string" ? sourceGroupId : null;
}

function findCanonicalDesignSystemFrame(frames: BundleFrame[]) {
  const candidates = frames.filter((frame) => frameSourceRole(frame) === "design-system");
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )[0];
}

async function upsertCanonicalDesignSystemFrame(input: {
  projectId: string;
  styleContext: ReferenceStyleContext;
  styleProfile: ProjectDesignSystem["structuredTokens"]["styleProfile"];
  qualityReport: ProjectDesignSystem["structuredTokens"]["qualityReport"];
  sourceType: "figma-reference" | "image-reference" | "manual" | "chat";
  scope: "frame" | "page";
  sourceLabel: string;
  sourceDescription: string;
  sourceReferenceId?: string | null;
  preferredSourceGroupId?: string | null;
  bundle?: NonNullable<Awaited<ReturnType<typeof getProjectBundle>>>;
}): Promise<{ frameId: string; sourceGroupId: string; created: boolean }> {
  const bundle = input.bundle ?? (await getProjectBundle(input.projectId));
  if (!bundle) {
    throw new Error("Project not found while updating design system frame.");
  }

  const existing = findCanonicalDesignSystemFrame(bundle.frames);
  const frameSize = existing?.size ?? { width: 1080, height: 840 };
  const framePosition =
    existing?.position ?? computeNextFramePosition(bundle.frames, frameSize);
  const frame =
    existing ??
    (await createFrameRecord({
      projectId: input.projectId,
      name: "Design System",
      devicePreset: "desktop",
      mode: "high-fidelity",
      position: framePosition,
      size: frameSize,
      status: "ready",
      selected: false
    }));

  const sourceGroupId =
    input.preferredSourceGroupId ??
    (existing ? frameSourceGroupId(existing) : null) ??
    crypto.randomUUID();

  const artifacts = buildDesignSystemComponentsArtifacts({
    styleContext: input.styleContext,
    frameName: frame.name || "Design System",
    scope: input.scope,
    sourceLabel: input.sourceLabel,
    sourceDescription: input.sourceDescription,
    styleProfile: input.styleProfile,
    qualityReport: input.qualityReport
  });

  await createFrameVersionRecord({
    frameId: frame.id,
    sourceCode: artifacts.sourceCode,
    cssCode: artifacts.cssCode,
    exportHtml: artifacts.exportHtml,
    tailwindEnabled: false,
    passOutputs: {
      pass: "design-system-sync",
      sourceType: input.sourceType,
      sourceRole: "design-system",
      sourceGroupId,
      sourceReferenceId: input.sourceType === "figma-reference" ? input.sourceReferenceId ?? null : null,
      canonicalDesignSystem: true,
      styleProfile: input.styleProfile,
      qualityReport: input.qualityReport
    },
    diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 }
  });

  return {
    frameId: frame.id,
    sourceGroupId,
    created: !existing
  };
}

async function persistVersion(args: {
  frameId: string;
  previousSourceCode: string;
  artifacts: FrameArtifacts;
  tailwindEnabled: boolean;
  passName: string;
  passOutput: Record<string, unknown>;
}) {
  const diffFromPrevious = computeDiff(args.previousSourceCode, args.artifacts.sourceCode);

  return createFrameVersionRecord({
    frameId: args.frameId,
    sourceCode: args.artifacts.sourceCode,
    cssCode: args.artifacts.cssCode,
    exportHtml: args.artifacts.exportHtml,
    tailwindEnabled: args.tailwindEnabled,
    passOutputs: {
      pass: args.passName,
      ...args.passOutput
    },
    diffFromPrevious
  });
}

export async function createManualFrame(input: {
  projectId: string;
  devicePreset: DevicePreset;
  mode: DesignMode;
  tailwindEnabled: boolean;
}) {
  const bundle = await getProjectBundle(input.projectId);
  if (!bundle) {
    throw new Error("Project not found.");
  }

  const style = (await getProjectStyleContexts(input.projectId))[0] ?? buildFallbackStyleContext();
  const existingCount = bundle.frames.length;
  const frameSize = computeFrameSize(input.devicePreset);
  const framePosition = computeNextFramePosition(bundle.frames, frameSize);
  const frame = await createFrameRecord({
    projectId: input.projectId,
    name: `Blank Screen ${existingCount + 1}`,
    devicePreset: input.devicePreset,
    mode: input.mode,
    position: framePosition,
    size: frameSize,
    status: "ready",
    selected: true
  });

  const artifacts = buildArtifacts({
    prompt: "Blank screen template",
    mode: input.mode,
    devicePreset: input.devicePreset,
    tailwindEnabled: input.tailwindEnabled,
    styleContext: style,
    enhanced: {
      title: frame.name,
      intent: "Blank layout",
      audience: "Designer",
      uxGoals: ["Provide a clean base"],
      constraints: ["No generated data"]
    },
    plan: {
      frameName: frame.name,
      subtitle: "A blank, editable scaffold ready for prompt-driven edits.",
      sections: [{ title: "Placeholder", description: "Use chat to generate full content." }],
      keyActions: ["Generate", "Edit", "Copy to Figma"]
    },
    iterationLabel: ""
  });

  await createFrameVersionRecord({
    frameId: frame.id,
    sourceCode: artifacts.sourceCode,
    cssCode: artifacts.cssCode,
    exportHtml: artifacts.exportHtml,
    tailwindEnabled: input.tailwindEnabled,
    passOutputs: { pass: "manual-create" },
    diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 }
  });

  return frame.id;
}

export async function createReferenceStarterFrames(input: {
  projectId: string;
  referenceSourceId?: string;
  fileKey: string;
  nodeId: string | null;
  scope: "frame" | "page";
  styleContext: ReferenceStyleContext;
  designSystemChecklist?: DesignSystemChecklist | null;
  referenceScreen: {
    frameName: string;
    sourceCode: string;
    cssCode: string;
    exportHtml: string;
    tailwindEnabled: boolean;
    passOutputs?: Record<string, unknown>;
  };
}): Promise<{ screenFrameId: string; componentsFrameId: string }> {
  const bundle = await getProjectBundle(input.projectId);
  if (!bundle) {
    throw new Error("Project not found.");
  }

  const baseCount = bundle.frames.length;
  const preferredDevice: DevicePreset = bundle.project.settings.deviceDefault === "iphone" ? "iphone" : "desktop";
  const preferredMode: DesignMode = bundle.project.settings.modeDefault === "wireframe" ? "wireframe" : "high-fidelity";
  const screenSize = computeFrameSize(preferredDevice);
  const screenPosition = computeNextFramePosition(bundle.frames, screenSize);

  const sourceGroupId = crypto.randomUUID();

  const screenFrame = await createFrameRecord({
    projectId: input.projectId,
    name: input.referenceScreen.frameName || `Reference Screen ${baseCount + 1}`,
    devicePreset: preferredDevice,
    mode: preferredMode,
    position: screenPosition,
    size: screenSize,
    status: "ready",
    selected: true
  });

  const screenArtifacts = {
    frameName: input.referenceScreen.frameName || (input.nodeId ? `Figma Frame ${input.nodeId}` : "Figma Reference"),
    sourceCode: input.referenceScreen.sourceCode,
    cssCode: input.referenceScreen.cssCode,
    exportHtml: input.referenceScreen.exportHtml
  };
  const referenceDerivedStyleContext = deriveStyleContextFromArtifacts(input.styleContext, screenArtifacts);

  await createFrameVersionRecord({
    frameId: screenFrame.id,
    sourceCode: screenArtifacts.sourceCode,
    cssCode: screenArtifacts.cssCode,
    exportHtml: screenArtifacts.exportHtml,
    tailwindEnabled: input.referenceScreen.tailwindEnabled,
    passOutputs: {
      pass: "reference-bootstrap-screen",
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      scope: input.scope,
      ...(input.referenceScreen.passOutputs ?? {}),
      sourceType: "figma-reference",
      sourceRole: "reference-screen",
      sourceGroupId,
      referenceSourceId: input.referenceSourceId ?? null
    },
    diffFromPrevious: { addedLines: 0, removedLines: 0, changedLines: 0 }
  });

  const designSystemForFrame = bundle.designSystem;
  const dsStyleContext = designSystemForFrame
    ? buildStyleContextFromProjectDesignSystem(designSystemForFrame) ?? referenceDerivedStyleContext
    : referenceDerivedStyleContext;
  const dsStyleProfile =
    designSystemForFrame?.structuredTokens.styleProfile ??
    buildStyleProfileFromStyleContext({
      styleContext: dsStyleContext,
      sourceType: "figma-reference",
      componentRecipes: dsStyleContext.componentRecipes,
      extractionEvidence: dsStyleContext.extractionEvidence,
      explicitQualityScore: dsStyleContext.qualityReport?.fidelityScore ?? null
    }).styleProfile;
  const dsQualityReport =
    designSystemForFrame?.structuredTokens.qualityReport ??
    buildQualityReportFromRecipes(
      dsStyleProfile.componentRecipes,
      dsStyleProfile.extractionEvidence,
      dsStyleContext.qualityReport?.fidelityScore ?? null,
      {
        colorsDetected: dsStyleProfile.tokens.colors.length,
        componentFamiliesDetected: dsStyleProfile.componentRecipes.filter((recipe) => recipe.confidence >= 0.66).length
      }
    );

  const componentsFrame = await upsertCanonicalDesignSystemFrame({
    projectId: input.projectId,
    bundle: {
      ...bundle,
      frames: [...bundle.frames, { ...screenFrame, versions: [] }]
    },
    styleContext: dsStyleContext,
    styleProfile: dsStyleProfile,
    qualityReport: dsQualityReport,
    sourceType: "figma-reference",
    scope: input.scope,
    sourceLabel: "Figma Reference",
    sourceDescription: input.nodeId
      ? `Figma file ${input.fileKey}, node ${input.nodeId}`
      : `Figma file ${input.fileKey}`,
    sourceReferenceId: input.referenceSourceId ?? null,
    preferredSourceGroupId: sourceGroupId
  });

  return {
    screenFrameId: screenFrame.id,
    componentsFrameId: componentsFrame.frameId
  };
}

export async function syncProjectDesignSystemFrame(input: {
  projectId: string;
  designSystem: ProjectDesignSystem;
  sourceType?: "figma-reference" | "image-reference" | "manual" | "chat";
  sourceReferenceId?: string | null;
  scope?: "frame" | "page";
  sourceLabel?: string;
  sourceDescription?: string;
  preferredSourceGroupId?: string | null;
}) {
  const styleContext =
    buildStyleContextFromProjectDesignSystem(input.designSystem) ?? buildFallbackStyleContext();
  return upsertCanonicalDesignSystemFrame({
    projectId: input.projectId,
    styleContext,
    styleProfile: input.designSystem.structuredTokens.styleProfile,
    qualityReport: input.designSystem.structuredTokens.qualityReport,
    sourceType: input.sourceType ?? input.designSystem.sourceType,
    scope: input.scope ?? "frame",
    sourceLabel: input.sourceLabel ?? "Project Design System",
    sourceDescription: input.sourceDescription ?? "Canonical board generated from DESIGN.md",
    sourceReferenceId: input.sourceReferenceId ?? input.designSystem.sourceReferenceId ?? null,
    preferredSourceGroupId: input.preferredSourceGroupId ?? null
  });
}

export async function startPipeline(input: PipelineInput, context: PipelineContext) {
  void runPipeline(input, context);
}

async function runPipeline(input: PipelineInput, context: PipelineContext) {
  const passStatusMap: Record<string, RunStatus | "idle"> = {
    enhance: "idle",
    plan: "idle",
    generate: "idle",
    repair: "idle",
    "diff-repair": "idle"
  };

  const variationCount = Math.max(1, input.variation ?? 1);

  await updatePipelineRun(input.runId, {
    status: "running",
    passStatusMap
  });

  await appendChatMessage({
    projectId: input.projectId,
    runId: input.runId,
    role: "user",
    content: input.prompt
  });

  await emitAgentEvent(context, {
    runId: input.runId,
    stage: "system",
    status: "info",
    kind: "summary",
    agent: "orchestrator",
    message: "I’ve started your design run and I’ll guide you step-by-step as I build.",
    payload: {
      step: "run-start",
      provider: input.provider,
      model: input.model,
      variationCount,
      designSystemMode: input.designSystemMode ?? "strict",
      surfaceTarget: input.surfaceTarget ?? (input.devicePreset === "iphone" ? "mobile" : "web"),
      selectedFrameContext: input.selectedFrameContext ?? null
    }
  });

  try {
    const projectBundle = await getProjectBundle(input.projectId);
    if (!projectBundle) {
      throw new Error("Project not found.");
    }
    const projectStyleContexts = await getProjectStyleContexts(input.projectId);
    const designSystemStyleContext = buildStyleContextFromProjectDesignSystem(projectBundle.designSystem);
    const styleContext = projectStyleContexts[0] ?? designSystemStyleContext ?? buildFallbackStyleContext();
    const imageAttachment = getFirstImageAttachment(input.attachments);

    if (imageAttachment) {
      await runImageReferenceRoute({
        input,
        context,
        styleContext,
        passStatusMap,
        imageAttachment
      });

      await updatePipelineRun(input.runId, {
        status: "completed",
        passStatusMap,
        finished: true
      });

      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "system",
        status: "success",
        kind: "summary",
        agent: "orchestrator",
        message: "Image rebuild completed. You can now iterate in chat or copy the frame to Figma.",
        payload: {
          step: "run-complete",
          source: "image-attachment"
        }
      });
      return;
    }

    const hasSyncedReference = projectStyleContexts.length > 0;
    const intent = await classifyPromptIntent(input, styleContext, hasSyncedReference);

    await emitAgentEvent(context, {
      runId: input.runId,
      stage: "system",
      status: "info",
      kind: "summary",
      agent: "orchestrator",
      message: `Intent classified as ${intent.type}.`,
      payload: {
        step: "intent-routing",
        reason: intent.reason,
        shouldTakeAction: intent.shouldTakeAction,
        designSystemAction: intent.designSystemAction
      }
    });

    if (intent.type === "question") {
      await runQuestionRoute({
        input,
        context,
        styleContext,
        passStatusMap,
        intent
      });

      await updatePipelineRun(input.runId, {
        status: "completed",
        passStatusMap,
        finished: true
      });

      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "system",
        status: "success",
        kind: "summary",
        agent: "orchestrator",
        message: "Answered your question without generating or editing frames.",
        payload: {
          step: "run-complete",
          target: "question-answer"
        }
      });
      return;
    }

    if (intent.type === "design-system") {
      await runDesignSystemRoute({
        input,
        context,
        styleContext,
        passStatusMap,
        intent
      });

      await updatePipelineRun(input.runId, {
        status: "completed",
        passStatusMap,
        finished: true
      });

      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "system",
        status: "success",
        kind: "summary",
        agent: "orchestrator",
        message: "Design-system workflow completed. Review the board and approve when ready.",
        payload: {
          step: "run-complete",
          target: "design-system-board"
        }
      });
      return;
    }

    const primaryDesigner = getPrimaryAgentForDevice(input.devicePreset);
    let targetFrameId = input.frameId;

    for (let variationIndex = 0; variationIndex < variationCount; variationIndex += 1) {
      if (input.editing && variationIndex > 0) {
        break;
      }

      const bundle = await getProjectBundle(input.projectId);
      if (!bundle) {
        throw new Error("Project not found.");
      }

      if (!targetFrameId) {
        const frameSize = computeFrameSize(input.devicePreset);
        const framePosition = computeNextFramePosition(bundle.frames, frameSize);
        const frame = await createFrameRecord({
          projectId: input.projectId,
          name: `Screen ${bundle.frames.length + 1}`,
          devicePreset: input.devicePreset,
          mode: input.mode,
          position: framePosition,
          size: frameSize,
          status: "building",
          selected: true
        });
        targetFrameId = frame.id;

        await updatePipelineRun(input.runId, {
          frameId: frame.id
        });

        await emitAgentEvent(context, {
          runId: input.runId,
          stage: "generate",
          status: "info",
          kind: "action",
          agent: "orchestrator",
          message: "I placed a new frame on the canvas so we can start building.",
          payload: {
            step: "frame-create",
            frameId: frame.id,
            frameName: frame.name,
            target: "artboard"
          }
        });
      }

      const frame = await getFrame(targetFrameId);
      if (!frame) {
        throw new Error("Frame not found while running pipeline.");
      }

      const previousVersion = await getLatestFrameVersion(frame.id);
      const previousSource = previousVersion?.sourceCode ?? "";
      const previousCss = previousVersion?.cssCode ?? "";
      const previousExportHtml = previousVersion?.exportHtml ?? "";

      await setPassStatus(input.runId, passStatusMap, "enhance", "running");
      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "enhance",
        status: "info",
        kind: "summary",
        agent: "orchestrator",
        message: "I’m refining your prompt into a concrete brief with goals and constraints.",
        payload: {
          step: "enhance-brief"
        }
      });
      const enhanced = await enhancePrompt(input, styleContext);
      await setPassStatus(input.runId, passStatusMap, "enhance", "completed");
      await appendChatMessage({
        projectId: input.projectId,
        runId: input.runId,
        role: "agent",
        content: `Enhanced brief: ${enhanced.title}`
      });

      await setPassStatus(input.runId, passStatusMap, "plan", "running");
      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "plan",
        status: "info",
        kind: "summary",
        agent: primaryDesigner,
        message:
          primaryDesigner === "app-designer"
            ? "App designer is mapping mobile-first layout, hierarchy, and interaction flow."
            : "Web designer is mapping layout structure, component hierarchy, and visual rhythm.",
        payload: {
          step: "layout-plan",
          target: primaryDesigner
        }
      });
      const plan = await createPlan(input, enhanced, styleContext);
      await setPassStatus(input.runId, passStatusMap, "plan", "completed");

      await setPassStatus(input.runId, passStatusMap, "generate", "running");
      let generation: GenerateArtifactsResult | null = null;
      let attemptCount = 0;
      let validation = {
        valid: false,
        issues: ["Generation not started."],
        checks: [] as ValidationCheck[]
      };
      let designSystemValidation: ValidationResult = {
        valid: false,
        issues: ["Design-system validation not started."],
        checks: []
      };
      let retryIssues: string[] = [];

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        attemptCount = attempt;
        await emitAgentEvent(context, {
          runId: input.runId,
          stage: "generate",
          status: "info",
          kind: "action",
          agent: primaryDesigner,
          message: `I’m generating prompt-specific React + HTML (attempt ${attempt}/3).`,
          payload: {
            step: "artifact-generate",
            artifact: `${normalizeIdentifier(plan.frameName)}.tsx`,
            attempt,
            statusDetail: retryIssues.length > 0 ? retryIssues.join("; ") : "Initial generation attempt.",
            nextStep: "validate-artifact"
          }
        });

        const attemptPrompt =
          attempt === 1
            ? input.prompt
            : `${input.prompt}\n\n${buildRetryPromptAddition({
                mode: "screen",
                attempt,
                issues: retryIssues,
                designSystemMode: input.designSystemMode ?? "strict",
                surfaceTarget: input.surfaceTarget ?? (input.devicePreset === "iphone" ? "mobile" : "web")
              })}`;

        generation = await generateScreenArtifacts({
          input: {
            ...input,
            prompt: attemptPrompt
          },
          styleContext,
          enhanced,
          plan,
          iterationLabel: variationCount > 1 ? `V${variationIndex + 1}` : "",
          previousSourceCode: previousSource,
          previousCssCode: previousCss,
          previousExportHtml
        });

        validation = validateArtifactsForDevice(generation.artifacts, {
          devicePreset: input.devicePreset,
          mode: input.mode
        });
        designSystemValidation = validateDesignSystemAdherence(
          generation.artifacts,
          styleContext,
          input.designSystemMode ?? "strict"
        );
        retryIssues = [...validation.issues, ...designSystemValidation.issues];

        if (validation.valid && designSystemValidation.valid) {
          break;
        }

        await emitAgentEvent(context, {
          runId: input.runId,
          stage: "repair",
          status: "info",
          kind: "action",
          agent: "orchestrator",
          message: `Validation failed on attempt ${attempt}.`,
          payload: {
            step: "artifact-validate",
            attempt,
            statusDetail: retryIssues.join("; "),
            nextStep: attempt < 3 ? "retry-generate" : "stop-with-error"
          }
        });
      }

      if (!generation || !validation.valid || !designSystemValidation.valid) {
        throw new Error(
          `Generated frame failed quality validation after ${attemptCount} attempts. ${retryIssues.join("; ")}`
        );
      }

      const generated = generation.artifacts;
      const versionGenerate = await persistVersion({
        frameId: frame.id,
        previousSourceCode: previousSource,
        artifacts: generated,
        tailwindEnabled: input.tailwindEnabled ?? false,
        passName: "generate",
          passOutput: {
            plan,
            enhanced,
            strategy: generation.strategy,
            usedProvider: generation.usedProvider,
            reason: generation.reason,
            attemptCount,
            mobileQualityChecks: validation.checks,
            designSystemChecks: designSystemValidation.checks,
            designSystemMode: input.designSystemMode ?? "strict",
            surfaceTarget: input.surfaceTarget ?? (input.devicePreset === "iphone" ? "mobile" : "web"),
            selectedFrameContext: input.selectedFrameContext ?? null
          }
        });
      await setPassStatus(input.runId, passStatusMap, "generate", "completed");
      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "generate",
        status: "success",
        kind: "action",
        agent: primaryDesigner,
        message: "Generated first frame version from prompt-specific model output.",
        payload: {
          step: "artifact-generated",
          frameId: frame.id,
          versionId: versionGenerate.id,
          strategy: generation.strategy,
          usedProvider: generation.usedProvider,
          attempt: attemptCount
        }
      });

      await sleep(260);

      await setPassStatus(input.runId, passStatusMap, "repair", "running");
      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "repair",
        status: "info",
        kind: "summary",
        agent: "design-system-designer",
        message: "I’m polishing structure and consistency so this aligns cleanly with your design system.",
        payload: {
          step: "repair-pass"
        }
      });
      const repaired = repairArtifacts(generated);
      const designSystemMode = input.designSystemMode ?? "strict";
      let strictAdjusted = repaired;
      if (designSystemMode === "strict") {
        const strictValidation = validateDesignSystemAdherence(strictAdjusted, styleContext, "strict");
        if (!strictValidation.valid) {
          strictAdjusted = enforceStrictDesignSystemAlignment(strictAdjusted, styleContext);
          await emitAgentEvent(context, {
            runId: input.runId,
            stage: "repair",
            status: "info",
            kind: "action",
            agent: "design-system-designer",
            message: "Applied an extra strict design-system repair pass to reduce style drift.",
            payload: {
              step: "strict-repair-pass",
              statusDetail: strictValidation.issues.join("; "),
              nextStep: "diff-repair-pass"
            }
          });
        }
      }
      const versionRepair = await persistVersion({
        frameId: frame.id,
        previousSourceCode: versionGenerate.sourceCode,
        artifacts: strictAdjusted,
        tailwindEnabled: input.tailwindEnabled ?? false,
        passName: "repair",
        passOutput: {
          note: "Applied structural and style safeguards.",
          attemptCount,
          mobileQualityChecks: validation.checks,
          designSystemChecks: designSystemValidation.checks,
          designSystemMode: input.designSystemMode ?? "strict"
        }
      });
      await setPassStatus(input.runId, passStatusMap, "repair", "completed");
      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "repair",
        status: "success",
        kind: "action",
        agent: "design-system-designer",
        message: "Repaired and normalized generated output.",
        payload: {
          step: "repair-complete",
          frameId: frame.id,
          versionId: versionRepair.id
        }
      });

      await sleep(220);

      await setPassStatus(input.runId, passStatusMap, "diff-repair", "running");
      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "diff-repair",
        status: "info",
        kind: "summary",
        agent: "orchestrator",
        message: "I’m applying a focused diff repair so updates stay stable while matching your request.",
        payload: {
          step: "diff-repair-pass"
        }
      });
      const diffRepaired = applyDiffRepair(strictAdjusted, input.editing ? input.prompt : undefined);
      const versionDiffRepair = await persistVersion({
        frameId: frame.id,
        previousSourceCode: versionRepair.sourceCode,
        artifacts: diffRepaired,
        tailwindEnabled: input.tailwindEnabled ?? false,
        passName: "diff-repair",
        passOutput: {
          prompt: input.prompt,
          attemptCount,
          mobileQualityChecks: validation.checks
        }
      });
      await setPassStatus(input.runId, passStatusMap, "diff-repair", "completed");

      await updateFrameStatus(frame.id, "ready");

      await emitAgentEvent(context, {
        runId: input.runId,
        stage: "diff-repair",
        status: "success",
        kind: "action",
        agent: "orchestrator",
        message: "Finalized version after diff-aware repair.",
        payload: {
          step: "diff-repair-complete",
          frameId: frame.id,
          versionId: versionDiffRepair.id,
          previousVersionId: previousVersion?.id ?? null
        }
      });
    }

    await updatePipelineRun(input.runId, {
      status: "completed",
      passStatusMap,
      finished: true
    });

    await emitAgentEvent(context, {
      runId: input.runId,
      stage: "system",
      status: "success",
      kind: "summary",
      agent: "orchestrator",
      message: "Done. Your frame is ready to iterate, compare versions, or copy to Figma.",
      payload: {
        step: "run-complete"
      }
    });
  } catch (error) {
    await updatePipelineRun(input.runId, {
      status: "failed",
      passStatusMap,
      finished: true
    });

    await emitAgentEvent(context, {
      runId: input.runId,
      stage: "system",
      status: "error",
      kind: "summary",
      agent: "orchestrator",
      message: "Pipeline failed before completion.",
      payload: {
        step: "run-failed",
        error: error instanceof Error ? error.message : String(error),
        statusDetail: error instanceof Error ? error.message : String(error),
        nextStep: "Check provider, model, key, and prompt constraints before retrying."
      }
    });
  }
}
