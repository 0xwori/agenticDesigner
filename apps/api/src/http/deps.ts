import {
  clearProjectDesignSystem,
  clearProjectBoard,
  createPipelineRun,
  createProject,
  createReferenceSource,
  deleteFrame,
  getFrame,
  getFrameVersions,
  getFrameWithVersions,
  getProjectDesignSystem,
  getProjectBundle,
  getReferenceSource,
  resetReferenceDesignSystemMetadata,
  upsertProjectDesignSystem,
  updateFrameLayout,
  updateProjectSettings,
  updateReferenceSource
} from "../db.js";
import {
  buildDesignSystemChecklistFromStyleContext,
  normalizeDesignSystemChecklist,
  parseFigmaLink,
  syncStyleContextFromFigmaLink
} from "../services/figmaReference.js";
import {
  buildPublicLinkFallbackReferenceScreen,
  classifyMcpFailure,
  syncReferenceViaMcp
} from "../services/figmaMcp.js";
import {
  createManualFrame,
  createReferenceStarterFrames,
  syncProjectDesignSystemFrame,
  startPipeline
} from "../services/pipeline.js";
import {
  DEFAULT_DESIGN_MD_TEMPLATE,
  generateDesignMarkdownFromStyleContext,
  parseDesignMarkdown
} from "../services/designSystemMd.js";
import { deriveStyleContextFromArtifacts } from "../services/styleContextArtifacts.js";

export type ApiDeps = {
  createProject: typeof createProject;
  getProjectBundle: typeof getProjectBundle;
  clearProjectBoard: typeof clearProjectBoard;
  clearProjectDesignSystem: typeof clearProjectDesignSystem;
  updateProjectSettings: typeof updateProjectSettings;
  getProjectDesignSystem: typeof getProjectDesignSystem;
  upsertProjectDesignSystem: typeof upsertProjectDesignSystem;
  createReferenceSource: typeof createReferenceSource;
  updateReferenceSource: typeof updateReferenceSource;
  resetReferenceDesignSystemMetadata: typeof resetReferenceDesignSystemMetadata;
  getReferenceSource: typeof getReferenceSource;
  parseFigmaLink: typeof parseFigmaLink;
  syncReferenceViaMcp: typeof syncReferenceViaMcp;
  classifyMcpFailure: typeof classifyMcpFailure;
  syncStyleContextFromFigmaLink: typeof syncStyleContextFromFigmaLink;
  buildDesignSystemChecklistFromStyleContext: typeof buildDesignSystemChecklistFromStyleContext;
  normalizeDesignSystemChecklist: typeof normalizeDesignSystemChecklist;
  buildPublicLinkFallbackReferenceScreen: typeof buildPublicLinkFallbackReferenceScreen;
  createReferenceStarterFrames: typeof createReferenceStarterFrames;
  syncProjectDesignSystemFrame: typeof syncProjectDesignSystemFrame;
  createManualFrame: typeof createManualFrame;
  getFrameWithVersions: typeof getFrameWithVersions;
  updateFrameLayout: typeof updateFrameLayout;
  deleteFrame: typeof deleteFrame;
  getFrame: typeof getFrame;
  getFrameVersions: typeof getFrameVersions;
  createPipelineRun: typeof createPipelineRun;
  startPipeline: typeof startPipeline;
  generateDesignMarkdownFromStyleContext: typeof generateDesignMarkdownFromStyleContext;
  parseDesignMarkdown: typeof parseDesignMarkdown;
  DEFAULT_DESIGN_MD_TEMPLATE: typeof DEFAULT_DESIGN_MD_TEMPLATE;
  deriveStyleContextFromArtifacts: typeof deriveStyleContextFromArtifacts;
};

export const defaultApiDeps: ApiDeps = {
  createProject,
  getProjectBundle,
  clearProjectBoard,
  clearProjectDesignSystem,
  updateProjectSettings,
  getProjectDesignSystem,
  upsertProjectDesignSystem,
  createReferenceSource,
  updateReferenceSource,
  resetReferenceDesignSystemMetadata,
  getReferenceSource,
  parseFigmaLink,
  syncReferenceViaMcp,
  classifyMcpFailure,
  syncStyleContextFromFigmaLink,
  buildDesignSystemChecklistFromStyleContext,
  normalizeDesignSystemChecklist,
  buildPublicLinkFallbackReferenceScreen,
  createReferenceStarterFrames,
  syncProjectDesignSystemFrame,
  createManualFrame,
  deleteFrame,
  getFrameWithVersions,
  updateFrameLayout,
  getFrame,
  getFrameVersions,
  createPipelineRun,
  startPipeline,
  generateDesignMarkdownFromStyleContext,
  parseDesignMarkdown,
  DEFAULT_DESIGN_MD_TEMPLATE,
  deriveStyleContextFromArtifacts
};
