export interface DesignMdColorToken {
  name: string;
  hex: string;
  role: string;
}

export interface DesignMdTypographyHierarchyEntry {
  role: string;
  sizePx: number;
  weight: number;
  lineHeight?: number;
  letterSpacing?: string;
  fontVariant?: string;
  notes?: string;
}

export interface DesignMdTypographyToken {
  headlineFont: string;
  bodyFont: string;
  labelFont: string;
  notes: string[];
  hierarchy?: DesignMdTypographyHierarchyEntry[];
}

export type DesignSystemVisualSectionId =
  | "brand-foundations"
  | "color-system"
  | "typography-system"
  | "spacing-layout"
  | "shape-visual-rules"
  | "core-components"
  | "navigation"
  | "feedback-status"
  | "data-display"
  | "iconography-imagery"
  | "dos-and-donts"
  | "imagery-atmosphere";

export type DesignSystemVisualBlockKind =
  | "chips"
  | "swatches"
  | "type-samples"
  | "spacing-scale"
  | "component-states"
  | "navigation-items"
  | "metric-cards"
  | "icons"
  | "rules"
  | "dos-donts"
  | "prose";

export interface DesignSystemVisualItem {
  label: string;
  value?: string;
  hex?: string;
  family?: DesignSystemComponentFamily | "spacing" | "typography" | "brand";
  state?: "default" | "active" | "disabled" | "error" | "success" | "focus";
  fontFamily?: string;
  sizePx?: number;
  weight?: number;
}

export interface DesignSystemVisualBlock {
  kind: DesignSystemVisualBlockKind;
  title?: string;
  items: DesignSystemVisualItem[];
}

export interface DesignSystemVisualSection {
  id: DesignSystemVisualSectionId;
  label: string;
  required: boolean;
  blocks: DesignSystemVisualBlock[];
}

export interface DesignSystemVisualBoard {
  version: 1;
  sections: DesignSystemVisualSection[];
}

export type DesignSystemSourceType = "manual" | "figma-reference" | "image-reference" | "chat";

export type DesignSystemComponentFamily =
  | "buttons"
  | "inputs"
  | "cards"
  | "navigation"
  | "feedback"
  | "data-display"
  | "templates"
  | "interaction-states"
  | "iconography";

export type DesignDensity = "compact" | "comfortable" | "spacious";
export type DesignContrast = "low" | "medium" | "high";
export type ComponentShape = "pill" | "rounded" | "sharp" | "mixed";
export type ComponentBorderStyle = "none" | "solid" | "subtle";
export type ComponentShadowStyle = "none" | "soft" | "medium" | "strong";
export type ComponentFillStyle = "solid" | "tint" | "outline" | "ghost" | "mixed";

export interface ComponentStateRecipe {
  name: "default" | "hover" | "focus" | "active" | "disabled" | "error" | "success";
  emphasis: "high" | "medium" | "low";
  notes?: string;
}

export interface ComponentRecipe {
  family: DesignSystemComponentFamily;
  shape: ComponentShape;
  cornerRadius: number;
  borderWidth: number;
  borderStyle: ComponentBorderStyle;
  shadowStyle: ComponentShadowStyle;
  density: DesignDensity;
  controlHeight: number;
  fillStyle: ComponentFillStyle;
  iconStyle?: string;
  spacing?: number;
  states: ComponentStateRecipe[];
  evidence: string[];
  confidence: number;
}

export interface ComponentFamilyConfidence {
  family: DesignSystemComponentFamily;
  confidence: number;
  mismatch: string[];
  evidence: string[];
}

export interface DesignSystemQualityReport {
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
}

export interface StyleProfile {
  sourceType: DesignSystemSourceType;
  foundations: {
    toneKeywords: string[];
    density: DesignDensity;
    contrast: DesignContrast;
  };
  tokens: {
    colors: DesignMdColorToken[];
    typography: DesignMdTypographyToken;
    spacingScale: number[];
    radiusScale: number[];
    borderWidths: number[];
    shadows: string[];
    opacityScale: number[];
  };
  componentRecipes: ComponentRecipe[];
  extractionEvidence: string[];
}

export interface DesignMdStructuredTokens {
  overview: string;
  colors: DesignMdColorToken[];
  typography: DesignMdTypographyToken;
  elevation: string;
  components: string[];
  dos: string[];
  donts: string[];
  layout: string;
  responsive: string;
  imagery: string;
  styleProfile: StyleProfile;
  qualityReport: DesignSystemQualityReport;
  visualBoard: DesignSystemVisualBoard;
}

export interface ProjectDesignSystem {
  projectId: string;
  markdown: string;
  structuredTokens: DesignMdStructuredTokens;
  status: "empty" | "draft" | "approved";
  sourceType: DesignSystemSourceType;
  sourceReferenceId: string | null;
  createdAt: string;
  updatedAt: string;
}
