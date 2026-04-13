import type { FrameWithVersions } from "@designer/shared";
import { Plus } from "lucide-react";

type FlowWorkspaceToolbarArea = {
  id: string;
  name: string;
};

type FlowWorkspaceToolbarProps = {
  frameName: string;
  boardSubtitle: string;
  focusMode: boolean;
  allFlowFrames: FrameWithVersions[];
  selectedBoardId: string;
  hasLegacyAreas: boolean;
  areas: FlowWorkspaceToolbarArea[];
  focusedAreaId: string | null;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetViewport: () => void;
  onFitWorkspace: () => void;
  onExitFocusMode: () => void;
  onSelectFlowBoard: (frameId: string) => Promise<void> | void;
  onCreateFlowBoard?: () => Promise<void> | void;
  onFocusArea: (areaId: string) => void;
};

export function FlowWorkspaceToolbar({
  frameName,
  boardSubtitle,
  focusMode,
  allFlowFrames,
  selectedBoardId,
  hasLegacyAreas,
  areas,
  focusedAreaId,
  onZoomOut,
  onZoomIn,
  onResetViewport,
  onFitWorkspace,
  onExitFocusMode,
  onSelectFlowBoard,
  onCreateFlowBoard,
  onFocusArea,
}: FlowWorkspaceToolbarProps) {
  return (
    <div className="flow-workspace__toolbar">
      <div className="flow-workspace__toolbar-main">
        <div className="flow-workspace__toolbar-title">
          <strong>{frameName}</strong>
          <span>{boardSubtitle}</span>
        </div>
        <div className="flow-workspace__toolbar-actions">
          <div className="flow-workspace__toolbar-group flow-workspace__toolbar-group--general" aria-label="General canvas controls">
            <button type="button" onClick={onZoomOut} aria-label="Zoom out">
              -
            </button>
            <button type="button" onClick={onZoomIn} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={onResetViewport}>
              Reset
            </button>
            <button type="button" onClick={onFitWorkspace}>
              Fit
            </button>
          </div>
          {focusMode ? (
            <div className="flow-workspace__toolbar-group flow-workspace__toolbar-group--focus" aria-label="Focus mode controls">
              <button type="button" className="flow-workspace__focus-btn" onClick={onExitFocusMode}>
                Exit focus
              </button>
            </div>
          ) : null}
          <div className="flow-workspace__toolbar-group flow-workspace__toolbar-group--board" aria-label="Flow board controls">
            <button
              type="button"
              onClick={() => {
                void onCreateFlowBoard?.();
              }}
              className="flow-workspace__new-board-btn"
            >
              <Plus size={13} /> New board
            </button>
          </div>
        </div>
      </div>
      <div className="flow-workspace__toolbar-secondary">
        <div className="flow-workspace__toolbar-fields">
          <label className="flow-workspace__field">
            <span>Board</span>
            <select value={selectedBoardId} onChange={(event) => void onSelectFlowBoard(event.target.value)}>
              {allFlowFrames.map((flowFrame) => (
                <option key={flowFrame.id} value={flowFrame.id}>
                  {flowFrame.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {hasLegacyAreas ? (
          <span className="flow-workspace__legacy-note">
            Legacy imported areas stay readable, but new boards are standalone.
          </span>
        ) : null}
      </div>
      {hasLegacyAreas ? (
        <div className="flow-workspace__area-chips" aria-label="Legacy flow areas">
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              className={`flow-workspace__area-chip ${focusedAreaId === area.id ? "is-active" : ""}`}
              onClick={() => onFocusArea(area.id)}
            >
              {area.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}