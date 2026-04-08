import { describe, expect, it } from "vitest";
import { computeFrameSize, computeNextFramePosition, hasFrameCollision, type FrameLayoutLike } from "./layout.js";

describe("pipeline layout utilities", () => {
  it("uses deterministic device frame sizes", () => {
    expect(computeFrameSize("desktop")).toEqual({ width: 1240, height: 880 });
    expect(computeFrameSize("iphone")).toEqual({ width: 393, height: 852 });
  });

  it("places new frames without overlapping existing ones", () => {
    const existing: FrameLayoutLike[] = [
      { position: { x: 120, y: 120 }, size: { width: 1240, height: 880 } },
      { position: { x: 1510, y: 120 }, size: { width: 1240, height: 880 } }
    ];

    const next = computeNextFramePosition(existing, { width: 1240, height: 880 });
    const candidate: FrameLayoutLike = {
      position: next,
      size: { width: 1240, height: 880 }
    };

    for (const frame of existing) {
      expect(hasFrameCollision(candidate, frame)).toBe(false);
    }
  });

  it("falls back below existing content when rows are exhausted", () => {
    const existing: FrameLayoutLike[] = Array.from({ length: 520 }, (_, index) => ({
      position: { x: 120 + (index % 4) * 1450, y: 120 + Math.floor(index / 4) * 1020 },
      size: { width: 1240, height: 880 }
    }));

    const next = computeNextFramePosition(existing, { width: 1240, height: 880 });
    const maxBottom = existing.reduce((max, frame) => Math.max(max, frame.position.y + frame.size.height), 120);

    expect(next.x).toBeGreaterThanOrEqual(120);
    expect(next.y).toBeGreaterThanOrEqual(maxBottom + 160);
  });
});
