import type { DesignSystemStatus, ReferenceScope, SyncStatus } from "./core.js";
import type { ComponentRecipe, DesignSystemQualityReport } from "./designSystem.js";

export interface ReferenceStyleContext {
  source: "figma-public-link" | "heuristic";
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background?: string;
    surface: string;
    text: string;
  };
  typography: {
    headingFamily: string;
    bodyFamily: string;
    cornerRadius: number;
  };
  spacingScale: number[];
  componentPatterns: string[];
  layoutMotifs: string[];
  componentRecipes?: ComponentRecipe[];
  qualityReport?: DesignSystemQualityReport | null;
  extractionEvidence?: string[];
}

export interface DesignSystemChecklistSection {
  section: string;
  items: string[];
}

export interface DesignSystemChecklist {
  source: "figma-link-seeded" | "chat-refined";
  sections: DesignSystemChecklistSection[];
}

export interface ReferenceSource {
  id: string;
  projectId: string;
  figmaUrl: string;
  fileKey: string;
  nodeId: string | null;
  scope: ReferenceScope;
  syncStatus: SyncStatus;
  syncError?: string | null;
  extractedStyleContext: ReferenceStyleContext | null;
  designSystemStatus: DesignSystemStatus | null;
  designSystemChecklist: DesignSystemChecklist | null;
  designSystemNotes: string | null;
  designSystemUpdatedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
