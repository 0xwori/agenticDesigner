import { Boxes, Monitor, Presentation, Smartphone } from "lucide-react";
import type { CanvasMode } from "../types/ui";
import type { SurfaceTarget } from "@designer/shared";

type FloatingDesignControlsProps = {
  canvasMode: CanvasMode;
  selectedSurfaceTarget: SurfaceTarget;
  assetCount: number;
  assetsOpen: boolean;
  onSurfaceTargetChange: (value: SurfaceTarget) => void;
  onOpenAssets: () => void;
};

export function FloatingDesignControls(props: FloatingDesignControlsProps) {
  const { canvasMode, selectedSurfaceTarget, assetCount, assetsOpen, onSurfaceTargetChange, onOpenAssets } = props;
  const isDesignCanvas = canvasMode !== "flow";

  return (
    <nav className="floating-control-rail" aria-label="Design type and assets">
      <div className="floating-control-group" aria-label="Design type">
        <button
          type="button"
          className={`floating-control-button${selectedSurfaceTarget === "web" && isDesignCanvas ? " is-active" : ""}`}
          onClick={() => onSurfaceTargetChange("web")}
        >
          <Monitor size={14} />
          <span>Desktop</span>
        </button>
        <button
          type="button"
          className={`floating-control-button${selectedSurfaceTarget === "mobile" && isDesignCanvas ? " is-active" : ""}`}
          onClick={() => onSurfaceTargetChange("mobile")}
        >
          <Smartphone size={14} />
          <span>Mobile</span>
        </button>
        <button
          type="button"
          className={`floating-control-button${selectedSurfaceTarget === "deck" && isDesignCanvas ? " is-active" : ""}`}
          onClick={() => onSurfaceTargetChange("deck")}
        >
          <Presentation size={14} />
          <span>Deck</span>
        </button>
      </div>
      <div className="floating-control-group floating-control-group--assets">
        <button
          type="button"
          className={`floating-control-button${assetsOpen ? " is-active" : ""}`}
          onClick={onOpenAssets}
        >
          <Boxes size={14} />
          <span>Assets</span>
          {assetCount > 0 ? <b>{assetCount}</b> : null}
        </button>
      </div>
    </nav>
  );
}
