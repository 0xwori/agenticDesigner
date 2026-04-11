import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import type { FrameVersion, FrameWithVersions } from "@designer/shared";

// ── Snapshot cache ────────────────────────────────────────

const SNAPSHOT_RETRY_DELAYS_MS = [700, 1400, 2200] as const;
const SNAPSHOT_FAILED_CACHE_TTL_MS = 12_000;

type SnapshotCacheEntry =
  | {
      status: "ready";
      dataUrl: string;
    }
  | {
      status: "failed";
      failedAt: number;
    };

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const pendingSnapshotCaptures = new Map<string, Promise<string | null>>();

export type FrameSnapshotStatus = "loading" | "retrying" | "ready" | "failed";

export interface FrameSnapshotState {
  status: FrameSnapshotStatus;
  versionId: string | null;
  attemptCount: number;
}

export interface FrameSnapshotStore {
  snapshots: Map<string, string | null>;
  states: Map<string, FrameSnapshotState>;
}

type CaptureFrameSnapshotCallbacks = {
  onAttemptStart?: (attemptIndex: number) => void;
};

function cacheKey(frameId: string, versionId?: string): string {
  return `${frameId}:${versionId ?? "none"}`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readCachedSnapshot(key: string, now = Date.now()): string | null | undefined {
  const cached = snapshotCache.get(key);
  if (!cached) {
    return undefined;
  }

  if (cached.status === "ready") {
    return cached.dataUrl;
  }

  if (now - cached.failedAt <= SNAPSHOT_FAILED_CACHE_TTL_MS) {
    return null;
  }

  snapshotCache.delete(key);
  return undefined;
}

function readFailedSnapshotEntry(key: string, now = Date.now()): Extract<SnapshotCacheEntry, { status: "failed" }> | undefined {
  const cached = snapshotCache.get(key);
  if (!cached || cached.status !== "failed") {
    return undefined;
  }

  if (now - cached.failedAt > SNAPSHOT_FAILED_CACHE_TTL_MS) {
    snapshotCache.delete(key);
    return undefined;
  }

  return cached;
}

function areSnapshotMapsEqual(left: Map<string, string | null>, right: Map<string, string | null>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [frameId, value] of right.entries()) {
    if (left.get(frameId) !== value) {
      return false;
    }
  }

  return true;
}

function areSnapshotStateMapsEqual(left: Map<string, FrameSnapshotState>, right: Map<string, FrameSnapshotState>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [frameId, value] of right.entries()) {
    const other = left.get(frameId);
    if (
      !other ||
      other.status !== value.status ||
      other.versionId !== value.versionId ||
      other.attemptCount !== value.attemptCount
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Capture a frame's rendered HTML as a PNG data-URL.
 * Renders into a hidden iframe, waits for content to settle, then captures.
 */
export async function captureFrameSnapshot(
  htmlDoc: string,
  frameId: string,
  versionId: string | undefined,
  width: number,
  height: number,
  callbacks: CaptureFrameSnapshotCallbacks = {},
): Promise<string | null> {
  const key = cacheKey(frameId, versionId);
  const cached = readCachedSnapshot(key);
  if (typeof cached === "string" || cached === null) {
    return cached;
  }

  const pending = pendingSnapshotCaptures.get(key);
  if (pending) {
    return pending;
  }

  const capturePromise = new Promise<string | null>((resolve) => {
    let settled = false;
    let started = false;
    const container = document.createElement("div");
    container.style.cssText = `
      position: fixed; left: -9999px; top: -9999px;
      width: ${width}px; height: ${height}px;
      overflow: hidden; pointer-events: none; opacity: 0;
    `;
    document.body.appendChild(container);

    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.cssText = `
      width: ${width}px; height: ${height}px;
      border: none; background: #fff;
    `;
    container.appendChild(iframe);
    iframe.srcdoc = htmlDoc;

    const cleanup = () => {
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    };

    const finish = (dataUrl: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (typeof dataUrl === "string" && dataUrl.length > 0) {
        snapshotCache.set(key, { status: "ready", dataUrl });
      } else {
        snapshotCache.set(key, { status: "failed", failedAt: Date.now() });
      }
      cleanup();
      resolve(dataUrl);
    };

    const attemptCapture = async () => {
      let lastError: unknown = null;

      for (let attemptIndex = 0; attemptIndex <= SNAPSHOT_RETRY_DELAYS_MS.length; attemptIndex += 1) {
        callbacks.onAttemptStart?.(attemptIndex);
        if (attemptIndex > 0) {
          await wait(SNAPSHOT_RETRY_DELAYS_MS[attemptIndex - 1] ?? SNAPSHOT_RETRY_DELAYS_MS[SNAPSHOT_RETRY_DELAYS_MS.length - 1]);
        }

        if (settled) {
          return;
        }

        try {
          const body = iframe.contentDocument?.body;
          if (!body) {
            lastError = new Error("Frame body was not ready for snapshot capture.");
            continue;
          }

          const dataUrl = await toPng(body, {
            width,
            height,
            backgroundColor: "#ffffff",
            skipFonts: true,
          });

          if (typeof dataUrl === "string" && dataUrl.length > 0) {
            finish(dataUrl);
            return;
          }

          lastError = new Error("Snapshot capture returned an empty image.");
        } catch (err) {
          lastError = err;
        }
      }

      console.warn(`[frameSnapshot] capture failed for ${frameId}:`, lastError);
      finish(null);
    };

    const startCapture = () => {
      if (started || settled) {
        return;
      }

      started = true;
      void attemptCapture();
    };

    // Wait for iframe to load and content to settle
    iframe.onload = () => {
      window.setTimeout(startCapture, 500);
    };

    // Fallback timeout
    window.setTimeout(startCapture, 2400);
  });

  pendingSnapshotCaptures.set(key, capturePromise);
  return capturePromise.finally(() => {
    pendingSnapshotCaptures.delete(key);
  });
}

// ── React hook ────────────────────────────────────────────

export function useFrameSnapshots(
  allDesignFrames: FrameWithVersions[],
  frameLookup: Map<string, FrameVersion | undefined>,
  buildPreviewDocument: (
    frameId: string,
    version?: FrameVersion,
    isBuilding?: boolean,
  ) => string,
): FrameSnapshotStore {
  const [snapshots, setSnapshots] = useState<Map<string, string | null>>(new Map());
  const [states, setStates] = useState<Map<string, FrameSnapshotState>>(new Map());
  const pendingRef = useRef(new Set<string>());
  const stateRef = useRef(states);
  const retryTimersRef = useRef(new Map<string, number>());
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    stateRef.current = states;
  }, [states]);

  useEffect(() => {
    return () => {
      for (const timer of retryTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      retryTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const activeKeys = new Set<string>();

    const nextSnapshots = new Map<string, string | null>();
    const nextStates = new Map<string, FrameSnapshotState>();

    const clearRetryTimer = (key: string) => {
      const timer = retryTimersRef.current.get(key);
      if (typeof timer === "number") {
        window.clearTimeout(timer);
        retryTimersRef.current.delete(key);
      }
    };

    const scheduleRetryRefresh = (key: string, failedAt: number) => {
      if (retryTimersRef.current.has(key)) {
        return;
      }

      const remainingMs = Math.max(48, SNAPSHOT_FAILED_CACHE_TTL_MS - (Date.now() - failedAt) + 48);
      const timer = window.setTimeout(() => {
        retryTimersRef.current.delete(key);
        setRefreshToken((value) => value + 1);
      }, remainingMs);

      retryTimersRef.current.set(key, timer);
    };

    for (const frame of allDesignFrames) {
      const version = frameLookup.get(frame.id);
      const versionId = version?.id ?? null;
      const key = cacheKey(frame.id, versionId ?? undefined);
      const cached = readCachedSnapshot(key, now);
      const existingState = stateRef.current.get(frame.id);
      activeKeys.add(key);

      if (typeof cached === "string") {
        nextSnapshots.set(frame.id, cached);
        nextStates.set(frame.id, {
          status: "ready",
          versionId,
          attemptCount: Math.max(existingState?.versionId === versionId ? existingState.attemptCount : 0, 1),
        });
        clearRetryTimer(key);
        continue;
      }

      if (cached === null) {
        nextSnapshots.set(frame.id, null);
        nextStates.set(frame.id, {
          status: "failed",
          versionId,
          attemptCount: Math.max(existingState?.versionId === versionId ? existingState.attemptCount : 0, SNAPSHOT_RETRY_DELAYS_MS.length + 1),
        });
        const failedEntry = readFailedSnapshotEntry(key, now);
        if (failedEntry) {
          scheduleRetryRefresh(key, failedEntry.failedAt);
        }
        continue;
      }

      clearRetryTimer(key);
      nextStates.set(
        frame.id,
        existingState?.versionId === versionId
          ? existingState
          : {
              status: "loading",
              versionId,
              attemptCount: 0,
            },
      );
    }

    for (const [key, timer] of retryTimersRef.current.entries()) {
      if (activeKeys.has(key)) {
        continue;
      }
      window.clearTimeout(timer);
      retryTimersRef.current.delete(key);
    }

    setSnapshots((previous) => {
      if (areSnapshotMapsEqual(previous, nextSnapshots)) {
        return previous;
      }
      return nextSnapshots;
    });

    setStates((previous) => {
      if (areSnapshotStateMapsEqual(previous, nextStates)) {
        return previous;
      }
      return nextStates;
    });

    for (const frame of allDesignFrames) {
      const version = frameLookup.get(frame.id);
      const versionId = version?.id ?? null;
      const key = cacheKey(frame.id, versionId ?? undefined);
      const cached = readCachedSnapshot(key);

      // Skip if already captured or in progress
      if (typeof cached === "string" || cached === null) continue;
      if (pendingRef.current.has(key)) continue;

      pendingRef.current.add(key);
      setStates((previous) => {
        const existing = previous.get(frame.id);
        const next = new Map(previous);
        next.set(frame.id, {
          status: "loading",
          versionId,
          attemptCount: existing?.versionId === versionId ? existing.attemptCount : 0,
        });
        return next;
      });

      const htmlDoc = buildPreviewDocument(frame.id, version, false);
      captureFrameSnapshot(
        htmlDoc,
        frame.id,
        versionId ?? undefined,
        frame.size.width,
        frame.size.height,
        {
          onAttemptStart: (attemptIndex) => {
            if (cancelled) {
              return;
            }

            setStates((previous) => {
              const next = new Map(previous);
              next.set(frame.id, {
                status: attemptIndex === 0 ? "loading" : "retrying",
                versionId,
                attemptCount: attemptIndex + 1,
              });
              return next;
            });
          },
        },
      ).then((dataUrl) => {
        pendingRef.current.delete(key);
        if (cancelled) return;

        if (typeof dataUrl === "string") {
          clearRetryTimer(key);
        } else {
          const failedEntry = readFailedSnapshotEntry(key);
          if (failedEntry) {
            scheduleRetryRefresh(key, failedEntry.failedAt);
          }
        }

        setSnapshots((prev) => {
          const previousValue = prev.get(frame.id);
          if (previousValue === dataUrl) {
            return prev;
          }
          const next = new Map(prev);
          next.set(frame.id, dataUrl);
          return next;
        });

        setStates((previous) => {
          const next = new Map(previous);
          const previousState = previous.get(frame.id);
          next.set(frame.id, {
            status: typeof dataUrl === "string" ? "ready" : "failed",
            versionId,
            attemptCount: Math.max(previousState?.attemptCount ?? 0, 1),
          });
          return next;
        });
      });
    }

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDesignFrames, buildPreviewDocument, frameLookup, refreshToken]);

  return {
    snapshots,
    states,
  };
}
