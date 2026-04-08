import type { DevicePreset } from "@designer/shared";

export type FrameLayoutLike = {
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
};

export function computeFrameSize(device: DevicePreset) {
  if (device === "iphone") {
    return { width: 393, height: 852 };
  }
  return { width: 1240, height: 880 };
}

export function hasFrameCollision(candidate: FrameLayoutLike, existing: FrameLayoutLike, gap = 96) {
  const aLeft = candidate.position.x - gap;
  const aTop = candidate.position.y - gap;
  const aRight = candidate.position.x + candidate.size.width + gap;
  const aBottom = candidate.position.y + candidate.size.height + gap;

  const bLeft = existing.position.x;
  const bTop = existing.position.y;
  const bRight = existing.position.x + existing.size.width;
  const bBottom = existing.position.y + existing.size.height;

  return !(aRight <= bLeft || aLeft >= bRight || aBottom <= bTop || aTop >= bBottom);
}

export function computeNextFramePosition(existingFrames: FrameLayoutLike[], frameSize: { width: number; height: number }) {
  const originX = 120;
  const originY = 120;
  const columnCount = 4;
  const xStep = Math.max(frameSize.width + 150, 560);
  const yStep = Math.max(frameSize.height + 140, 480);

  for (let row = 0; row < 120; row += 1) {
    for (let col = 0; col < columnCount; col += 1) {
      const candidate: FrameLayoutLike = {
        position: {
          x: originX + col * xStep,
          y: originY + row * yStep
        },
        size: frameSize
      };
      const collision = existingFrames.some((existing) => hasFrameCollision(candidate, existing));
      if (!collision) {
        return candidate.position;
      }
    }
  }

  const maxBottom = existingFrames.reduce((max, frame) => Math.max(max, frame.position.y + frame.size.height), originY);
  return {
    x: originX,
    y: maxBottom + 160
  };
}
