import type { DesignMode, DevicePreset } from "./core.js";
import type { FrameKind, FlowDocument } from "./flow.js";

export interface Frame {
  id: string;
  projectId: string;
  name: string;
  devicePreset: DevicePreset;
  mode: DesignMode;
  selected: boolean;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  currentVersionId: string | null;
  status: "building" | "ready";
  frameKind?: FrameKind;
  flowDocument?: FlowDocument;
  createdAt: string;
  updatedAt: string;
}

export interface FrameVersion {
  id: string;
  frameId: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
  tailwindEnabled: boolean;
  passOutputs: Record<string, unknown>;
  diffFromPrevious: {
    addedLines: number;
    removedLines: number;
    changedLines: number;
  };
  createdAt: string;
}

export interface FrameWithVersions extends Frame {
  versions: FrameVersion[];
}
