import type { DesignMode, DesignSystemMode, DevicePreset, ReferenceStyleContext, SurfaceTarget } from "@designer/shared";

export type FrameArtifacts = {
  frameName: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
};

export type ImageRebuildSpec = {
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
};

export type ValidationCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: string[];
  checks: ValidationCheck[];
};

export function validateArtifactsForDevice(
  artifacts: FrameArtifacts,
  input: { devicePreset: DevicePreset; mode: DesignMode }
): ValidationResult {
  const checks: ValidationCheck[] = [];
  const sourceBlob = `${artifacts.sourceCode}\n${artifacts.cssCode}\n${artifacts.exportHtml}`.toLowerCase();

  checks.push({
    id: "react-mount",
    passed: artifacts.sourceCode.includes("ReactDOM.createRoot"),
    detail: "Source mounts using ReactDOM.createRoot."
  });

  checks.push({
    id: "non-empty-html",
    passed: artifacts.exportHtml.trim().length > 80,
    detail: "Export HTML is non-empty and substantial."
  });

  if (input.devicePreset === "iphone") {
    const explicitMarketingPattern =
      /\b(tw-landing-hero|tw-feature-grid|tw-pricing|tw-testimonial|tw-newsletter|tw-waitlist|pricing table|newsletter signup)\b/i;
    const marketingCueMatches = sourceBlob.match(/\b(pricing|testimonial|newsletter|waitlist|conversion)\b/gi) ?? [];
    const appCueMatches =
      sourceBlob.match(/\b(login|sign in|onboarding|dashboard|settings|profile|tab bar|bottom nav|safe-area|touch)\b/gi) ??
      [];
    const heroWithMarketingCues =
      /\bhero\b/i.test(sourceBlob) && marketingCueMatches.length >= 2 && appCueMatches.length === 0;
    const avoidsDesktopHero = !(explicitMarketingPattern.test(sourceBlob) || heroWithMarketingCues);
    const hasSafeArea = /safe-area-inset|env\(safe-area-inset/i.test(sourceBlob);
    const hasMobileScale =
      /(?:max|min)?-?width:\s*(3\d{2}|4\d{2})px|min-height:\s*(6|7|8|9)\d{2}px/i.test(sourceBlob) ||
      /\b(iphone|mobile app|tab bar|bottom nav|safe-area|tw-auth-shell|tw-onboarding-shell|tw-settings-shell|tw-dashboard-grid)\b/i.test(
        sourceBlob
      ) ||
      hasSafeArea;
    const hasTouchTargets = /min-height:\s*(4[0-9]|5[0-9])px|padding:\s*(10|11|12|13|14|15|16)px/i.test(sourceBlob);

    checks.push({
      id: "iphone-no-desktop-marketing",
      passed: avoidsDesktopHero,
      detail: "Avoid desktop/marketing hero patterns in iPhone mode."
    });
    checks.push({
      id: "iphone-safe-area",
      passed: hasSafeArea,
      detail: "Includes safe-area aware spacing."
    });
    checks.push({
      id: "iphone-mobile-scale",
      passed: hasMobileScale,
      detail: "Uses mobile frame dimensions/composition."
    });
    checks.push({
      id: "iphone-touch-targets",
      passed: hasTouchTargets,
      detail: "Uses touch-friendly controls."
    });
  }

  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  return {
    valid: issues.length === 0,
    issues,
    checks
  };
}

export function validateDesignSystemAdherence(
  artifacts: FrameArtifacts,
  styleContext: ReferenceStyleContext,
  designSystemMode: DesignSystemMode
): ValidationResult {
  if (designSystemMode === "creative") {
    return {
      valid: true,
      issues: [],
      checks: [
        {
          id: "ds-creative-mode",
          passed: true,
          detail: "Creative mode allows broader visual exploration."
        }
      ]
    };
  }

  const checks: ValidationCheck[] = [];
  const blob = `${artifacts.sourceCode}\n${artifacts.cssCode}\n${artifacts.exportHtml}`.toLowerCase();

  const primaryMatch = blob.includes(styleContext.palette.primary.toLowerCase()) || blob.includes("--tw-primary");
  const headingMatch = blob.includes(styleContext.typography.headingFamily.split(",")[0].trim().toLowerCase());
  const bodyMatch = blob.includes(styleContext.typography.bodyFamily.split(",")[0].trim().toLowerCase());
  const radiusMatch = blob.includes(String(styleContext.typography.cornerRadius));

  checks.push({
    id: "ds-primary-token",
    passed: primaryMatch,
    detail: "Uses design system primary token or mapped variable."
  });
  checks.push({
    id: "ds-heading-font",
    passed: headingMatch,
    detail: "Uses heading type family from design system."
  });
  checks.push({
    id: "ds-body-font",
    passed: bodyMatch,
    detail: "Uses body type family from design system."
  });
  checks.push({
    id: "ds-radius-token",
    passed: radiusMatch,
    detail: "Uses corner radius values aligned to design system."
  });

  const failed = checks.filter((check) => !check.passed);
  return {
    valid: failed.length <= 1,
    issues: failed.map((check) => check.detail),
    checks
  };
}

export function enforceStrictDesignSystemAlignment(
  artifacts: FrameArtifacts,
  styleContext: ReferenceStyleContext
): FrameArtifacts {
  const rootTokens = `
:root {
  --tw-primary: ${styleContext.palette.primary};
  --tw-secondary: ${styleContext.palette.secondary};
  --tw-accent: ${styleContext.palette.accent};
  --tw-surface: ${styleContext.palette.surface};
  --tw-text: ${styleContext.palette.text};
  --tw-radius: ${styleContext.typography.cornerRadius}px;
}
`.trim();

  const hasRoot = /:root\s*\{/.test(artifacts.cssCode);
  const cssCode = hasRoot ? artifacts.cssCode : `${rootTokens}\n\n${artifacts.cssCode}`;
  const sourceCode = artifacts.sourceCode
    .replace(/font-family:\s*[^;]+;/gi, `font-family: ${styleContext.typography.bodyFamily};`)
    .replace(/--tw-radius:\s*[^;]+;/gi, `--tw-radius: ${styleContext.typography.cornerRadius}px;`);

  return {
    ...artifacts,
    cssCode,
    sourceCode
  };
}

export function validateArtifactsAgainstImageSpec(artifacts: FrameArtifacts, spec: ImageRebuildSpec): ValidationResult {
  const checks: ValidationCheck[] = [];
  const sourceBlob = `${artifacts.sourceCode}\n${artifacts.cssCode}\n${artifacts.exportHtml}`.toLowerCase();

  checks.push({
    id: "spec-frame-name",
    passed: artifacts.frameName.toLowerCase().includes(spec.frameName.toLowerCase().slice(0, 8)),
    detail: "Frame name aligns with extracted image spec intent."
  });

  checks.push({
    id: "spec-region-coverage",
    passed: spec.layoutRegions.length === 0 || spec.layoutRegions.some((region) => sourceBlob.includes(region.name.toLowerCase())),
    detail: "Generated output reflects at least one named layout region from the spec."
  });

  checks.push({
    id: "spec-components",
    passed:
      spec.componentCandidates.length === 0 ||
      spec.componentCandidates.some((component) => sourceBlob.includes(component.toLowerCase().split(" ")[0])),
    detail: "Generated output includes component cues from extracted spec."
  });

  checks.push({
    id: "spec-accent-color",
    passed: sourceBlob.includes(spec.colorTokens.accent.toLowerCase().replace("#", "")) || sourceBlob.includes("accent"),
    detail: "Accent token from image spec is represented."
  });

  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  return {
    valid: issues.length === 0,
    issues,
    checks
  };
}

export function buildRetryPromptAddition(input: {
  mode: "image" | "screen";
  attempt: number;
  issues: string[];
  spec?: ImageRebuildSpec;
  designSystemMode?: DesignSystemMode;
  surfaceTarget?: SurfaceTarget;
}) {
  const lines: string[] = [];
  lines.push(`Retry attempt ${input.attempt} after validation failure.`);
  if (input.issues.length > 0) {
    lines.push(`Fix these issues exactly: ${input.issues.join("; ")}`);
  }
  if (input.mode === "image" && input.spec) {
    lines.push(`Image fidelity targets: ${input.spec.fidelityTargets.join("; ") || "Preserve visual hierarchy and styling."}`);
    lines.push(`Assumptions to honor: ${input.spec.assumptions.join("; ") || "No assumptions provided."}`);
  }
  if (input.designSystemMode) {
    lines.push(`Design-system mode: ${input.designSystemMode}`);
  }
  if (input.surfaceTarget) {
    lines.push(`Surface target: ${input.surfaceTarget}`);
  }
  lines.push("Do not simplify to a generic template.");
  return lines.join("\n");
}
