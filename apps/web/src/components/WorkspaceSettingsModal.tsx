import React from "react";
import type {
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  ProjectBundle,
  ProjectSettings,
  ReferenceSource,
  ProviderId,
  SurfaceTarget
} from "@designer/shared";
import { Copy, Palette, RefreshCw, Settings2, X } from "lucide-react";
import type { DebugLogEntry, LocalPreferences } from "../types/ui";

type WorkspaceSettingsModalProps = {
  open: boolean;
  bundle: ProjectBundle | null;
  preferences: LocalPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<LocalPreferences>>;
  initializeProject: () => Promise<void> | void;
  persistProjectSettings: (patch: Partial<ProjectSettings>) => Promise<void>;
  handleResyncReference: (reference: ReferenceSource) => Promise<void>;
  handleCreateManualFrame: (devicePreset: DevicePreset) => Promise<void>;
  updateDeviceDefault: (devicePreset: DevicePreset) => void;
  updateModeDefault: (mode: DesignMode) => void;
  updateDesignSystemModeDefault: (mode: DesignSystemMode) => void;
  updateSurfaceDefault: (surface: SurfaceTarget) => void;
  handleClearBoard: () => Promise<void>;
  copyDebugLogs: () => Promise<void>;
  debugLogs: DebugLogEntry[];
  isCopyingLogs: boolean;
  error: string;
  onClose: () => void;
  onOpenBrandPicker: () => void;
  onOpenVisualBoard: () => void;
  activeBrandName: string | null;
};

type SettingsFieldProps = {
  label: string;
  children: React.ReactNode;
};

function SettingsField(props: SettingsFieldProps) {
  return (
    <label className="workspace-modal__field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function WorkspaceSettingsModal(props: WorkspaceSettingsModalProps) {
  const {
    open,
    bundle,
    preferences,
    setPreferences,
    initializeProject,
    persistProjectSettings,
    handleResyncReference,
    handleCreateManualFrame,
    updateDeviceDefault,
    updateModeDefault,
    updateDesignSystemModeDefault,
    updateSurfaceDefault,
    handleClearBoard,
    copyDebugLogs,
    debugLogs,
    isCopyingLogs,
    error,
    onClose,
    onOpenBrandPicker,
    onOpenVisualBoard,
    activeBrandName
  } = props;

  if (!open) {
    return null;
  }

  return (
    <div className="workspace-modal-overlay" role="dialog" aria-modal="true">
      <div className="workspace-modal">
        <header className="workspace-modal__header">
          <div className="workspace-modal__title">
            <Settings2 size={15} />
            <div>
              <h2>Workspace settings</h2>
              <p>Project config, references, frame actions, and debug logs.</p>
            </div>
          </div>
          <div className="workspace-modal__header-actions">
            <button onClick={() => void initializeProject()} title="Refresh workspace">
              <RefreshCw size={13} />
            </button>
            <button onClick={onClose} title="Close settings">
              <X size={13} />
            </button>
          </div>
        </header>

        <div className="workspace-modal__body">
          <section className="workspace-modal__section">
            <h3>Design System</h3>
            <p className="workspace-modal__hint">
              Start from a curated design system or create your own brand identity.
            </p>
            <div className="workspace-brand-row">
              {activeBrandName ? (
                <span className="workspace-brand-active">
                  <Palette size={12} />
                  {activeBrandName}
                </span>
              ) : (
                <span className="workspace-modal__muted">No brand selected</span>
              )}
              <button className="workspace-brand-pick-btn" onClick={onOpenBrandPicker}>
                {activeBrandName ? "Change brand" : "Choose brand template"}
              </button>
              {activeBrandName ? (
                <button className="workspace-brand-pick-btn" onClick={onOpenVisualBoard}>
                  Preview Visual Board
                </button>
              ) : null}
            </div>
          </section>

          <section className="workspace-modal__section">
            <h3>Provider and API</h3>
            <div className="workspace-modal__grid">
              <SettingsField label="API base">
                <input
                  value={preferences.apiBaseUrl}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      apiBaseUrl: event.target.value
                    }))
                  }
                />
              </SettingsField>
              <SettingsField label="Provider">
                <select
                  value={preferences.provider}
                  onChange={(event) => {
                    const provider = event.target.value as ProviderId;
                    setPreferences((current) => ({ ...current, provider }));
                    void persistProjectSettings({ provider });
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                </select>
              </SettingsField>
              <SettingsField label="Model">
                <input
                  value={preferences.model}
                  onChange={(event) => setPreferences((current) => ({ ...current, model: event.target.value }))}
                  onBlur={() => void persistProjectSettings({ model: preferences.model })}
                />
              </SettingsField>
              <SettingsField label="API key (local only)">
                <input
                  value={preferences.apiKey}
                  type="password"
                  onChange={(event) => setPreferences((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder="Stored in browser local storage"
                />
              </SettingsField>
              <SettingsField label="Figma client ID (local only)">
                <input
                  value={preferences.figmaClientId}
                  onChange={(event) => setPreferences((current) => ({ ...current, figmaClientId: event.target.value }))}
                />
              </SettingsField>
              <SettingsField label="Figma client secret (local only)">
                <input
                  value={preferences.figmaClientSecret}
                  type="password"
                  onChange={(event) =>
                    setPreferences((current) => ({ ...current, figmaClientSecret: event.target.value }))
                  }
                />
              </SettingsField>
            </div>
          </section>

          <section className="workspace-modal__section">
            <h3>Generation defaults</h3>
            <div className="workspace-modal__grid">
              <SettingsField label="Device default">
                <select
                  value={bundle?.project.settings.deviceDefault ?? "desktop"}
                  onChange={(event) => updateDeviceDefault(event.target.value as DevicePreset)}
                >
                  <option value="desktop">Desktop</option>
                  <option value="iphone">iPhone</option>
                </select>
              </SettingsField>
              <SettingsField label="Mode default">
                <select
                  value={bundle?.project.settings.modeDefault ?? "high-fidelity"}
                  onChange={(event) => updateModeDefault(event.target.value as DesignMode)}
                >
                  <option value="high-fidelity">High-fidelity</option>
                  <option value="wireframe">Wireframe</option>
                </select>
              </SettingsField>
              <SettingsField label="Surface default">
                <select
                  value={bundle?.project.settings.surfaceDefault ?? "web"}
                  onChange={(event) => updateSurfaceDefault(event.target.value as SurfaceTarget)}
                >
                  <option value="web">Web</option>
                  <option value="mobile">Mobile</option>
                </select>
              </SettingsField>
              <SettingsField label="Design system mode default">
                <select
                  value={bundle?.project.settings.designSystemModeDefault ?? "strict"}
                  onChange={(event) => updateDesignSystemModeDefault(event.target.value as DesignSystemMode)}
                >
                  <option value="strict">Strict</option>
                  <option value="creative">Creative</option>
                </select>
              </SettingsField>
            </div>
          </section>

          <section className="workspace-modal__section">
            <h3>References</h3>
            <p className="workspace-modal__hint">
              Attach links via chat (`+ Figma` in composer). Re-sync runs MCP extraction again.
            </p>
            <div className="workspace-modal__reference-list">
              {(bundle?.references ?? []).map((reference) => (
                <article key={reference.id} className={`reference-card reference-card--${reference.syncStatus}`}>
                  <div>
                    <strong>{reference.scope === "page" ? "Page reference" : "Frame reference"}</strong>
                    <p>{reference.fileKey}</p>
                    {reference.designSystemStatus ? <p>DS: {reference.designSystemStatus}</p> : null}
                    {reference.syncError ? <p className="reference-error">{reference.syncError}</p> : null}
                  </div>
                  <button onClick={() => void handleResyncReference(reference)}>Re-sync</button>
                </article>
              ))}
              {(bundle?.references.length ?? 0) === 0 ? (
                <p className="workspace-modal__muted">No references attached yet.</p>
              ) : null}
            </div>
          </section>

          <section className="workspace-modal__section">
            <h3>Frame actions</h3>
            <div className="workspace-frame-actions">
              <button onClick={() => void handleCreateManualFrame("desktop")}>Add desktop frame</button>
              <button onClick={() => void handleCreateManualFrame("iphone")}>Add iPhone frame</button>
              <button className="workspace-frame-actions__danger" onClick={() => void handleClearBoard()}>
                Clean slate
              </button>
            </div>
          </section>

          <section className="workspace-modal__section">
            <div className="workspace-modal__debug-header">
              <h3>Debug logs</h3>
              <button type="button" className="copy-logs-button" onClick={() => void copyDebugLogs()} disabled={debugLogs.length === 0}>
                <Copy size={12} />
                {isCopyingLogs ? "Copied" : `Copy logs (${debugLogs.length})`}
              </button>
            </div>
            {error ? <p className="global-error">{error}</p> : null}
            <div className="workspace-modal__debug-log-list">
              {debugLogs.slice(-80).map((entry) => (
                <article key={entry.id} className={`workspace-modal__debug-log workspace-modal__debug-log--${entry.level}`}>
                  <p>
                    <strong>{entry.level.toUpperCase()}</strong> [{entry.scope}] {entry.message}
                  </p>
                  <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </article>
              ))}
              {debugLogs.length === 0 ? <p className="workspace-modal__muted">No logs recorded yet.</p> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
