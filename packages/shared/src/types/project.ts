import type { DesignMode, DesignSystemMode, DevicePreset, ProviderId, SurfaceTarget } from "./core.js";

export interface ProjectSettings {
  provider: ProviderId;
  model: string;
  tailwindDefault: boolean;
  modeDefault: DesignMode;
  deviceDefault: DevicePreset;
  designSystemModeDefault: DesignSystemMode;
  surfaceDefault: SurfaceTarget;
}

export interface Project {
  id: string;
  name: string;
  token: string;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  provider: "openai",
  model: "gpt-5.4-mini",
  tailwindDefault: false,
  modeDefault: "high-fidelity",
  deviceDefault: "desktop",
  designSystemModeDefault: "strict",
  surfaceDefault: "web"
};
