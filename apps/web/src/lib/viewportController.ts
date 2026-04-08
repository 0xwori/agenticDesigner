export type ViewportState = {
  x: number;
  y: number;
  scale: number;
};

type SmoothPanControllerOptions = {
  readViewport: () => ViewportState;
  applyViewport: (next: ViewportState) => void;
  isPanAllowed: (event: WheelEvent) => boolean;
  damping?: number;
};

export type SmoothPanController = {
  onWheel: (event: WheelEvent) => void;
  dispose: () => void;
};

export function createSmoothPanController(options: SmoothPanControllerOptions): SmoothPanController {
  const damping = options.damping ?? 0.82;

  let pendingX = 0;
  let pendingY = 0;
  let velocityX = 0;
  let velocityY = 0;
  let rafId: number | null = null;

  const stopIfSettled = () => {
    const pendingMagnitude = Math.abs(pendingX) + Math.abs(pendingY);
    const velocityMagnitude = Math.abs(velocityX) + Math.abs(velocityY);
    if (pendingMagnitude < 0.05 && velocityMagnitude < 0.08) {
      pendingX = 0;
      pendingY = 0;
      velocityX = 0;
      velocityY = 0;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      return true;
    }
    return false;
  };

  const tick = () => {
    velocityX = velocityX * damping + pendingX * (1 - damping);
    velocityY = velocityY * damping + pendingY * (1 - damping);
    pendingX *= damping;
    pendingY *= damping;

    if (stopIfSettled()) {
      return;
    }

    const current = options.readViewport();
    options.applyViewport({
      x: current.x - velocityX,
      y: current.y - velocityY,
      scale: current.scale
    });

    rafId = window.requestAnimationFrame(tick);
  };

  const ensureTicking = () => {
    if (rafId !== null) {
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  };

  return {
    onWheel(event: WheelEvent) {
      if (!options.isPanAllowed(event)) {
        return;
      }

      event.preventDefault();
      pendingX += event.deltaX;
      pendingY += event.deltaY;
      ensureTicking();
    },
    dispose() {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
  };
}
