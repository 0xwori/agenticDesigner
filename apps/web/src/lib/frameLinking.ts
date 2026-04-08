import type { FrameVersion, FrameWithVersions, ReferenceSource } from "@designer/shared";

export type FrameSourceMeta = {
  sourceType: string | null;
  sourceRole: string | null;
  sourceGroupId: string | null;
  referenceSourceId: string | null;
  fileKey: string | null;
  nodeId: string | null;
  scope: string | null;
};

export type FramePairLink = {
  sourceGroupId: string;
  sourceType: string;
  fromFrameId: string;
  toFrameId: string;
  toIsDesignSystem: boolean;
};

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getMetaFromVersion(version?: FrameVersion): FrameSourceMeta | null {
  if (!version) {
    return null;
  }

  const pass = version.passOutputs;
  if (!pass || typeof pass !== "object") {
    return null;
  }

  const sourceType = toStringOrNull(pass.sourceType);
  const sourceRole = toStringOrNull(pass.sourceRole);
  const sourceGroupId = toStringOrNull(pass.sourceGroupId);
  const referenceSourceId = toStringOrNull(pass.referenceSourceId);
  const fileKey = toStringOrNull(pass.fileKey);
  const nodeId =
    typeof pass.nodeId === "string"
      ? pass.nodeId.trim().length > 0
        ? pass.nodeId.trim()
        : null
      : pass.nodeId === null
        ? null
        : null;
  const scope = toStringOrNull(pass.scope);

  if (!sourceType && !sourceGroupId && !referenceSourceId && !fileKey) {
    return null;
  }

  return {
    sourceType,
    sourceRole,
    sourceGroupId,
    referenceSourceId,
    fileKey,
    nodeId,
    scope
  };
}

export function extractFrameSourceMeta(frame: FrameWithVersions): FrameSourceMeta | null {
  for (let index = frame.versions.length - 1; index >= 0; index -= 1) {
    const meta = getMetaFromVersion(frame.versions[index]);
    if (meta) {
      return meta;
    }
  }
  return null;
}

export function buildFrameMetaMap(frames: FrameWithVersions[]) {
  const map = new Map<string, FrameSourceMeta>();
  for (const frame of frames) {
    const meta = extractFrameSourceMeta(frame);
    if (meta) {
      map.set(frame.id, meta);
    }
  }
  return map;
}

export function buildFramePairLinks(
  frames: FrameWithVersions[],
  frameMetaById: Map<string, FrameSourceMeta>
): FramePairLink[] {
  const grouped = new Map<string, Array<{ frameId: string; role: string; sourceType: string }>>();

  for (const frame of frames) {
    const meta = frameMetaById.get(frame.id);
    if (!meta?.sourceGroupId || !meta.sourceRole || !meta.sourceType) {
      continue;
    }

    const existing = grouped.get(meta.sourceGroupId) ?? [];
    existing.push({
      frameId: frame.id,
      role: meta.sourceRole,
      sourceType: meta.sourceType
    });
    grouped.set(meta.sourceGroupId, existing);
  }

  const links: FramePairLink[] = [];
  for (const [sourceGroupId, items] of grouped.entries()) {
    const referenceScreens = items.filter((item) => item.role === "reference-screen");
    const designSystems = items.filter((item) => item.role === "design-system");

    if (referenceScreens.length === 0 || designSystems.length === 0) {
      continue;
    }

    for (const referenceScreen of referenceScreens) {
      for (const designSystem of designSystems) {
        links.push({
          sourceGroupId,
          sourceType: referenceScreen.sourceType,
          fromFrameId: referenceScreen.frameId,
          toFrameId: designSystem.frameId,
          toIsDesignSystem: true
        });
      }
    }
  }

  return links;
}

export function resolveReferenceForFrame(
  frameMeta: FrameSourceMeta | null,
  references: ReferenceSource[]
): ReferenceSource | null {
  if (!frameMeta || frameMeta.sourceType !== "figma-reference") {
    return null;
  }

  if (frameMeta.referenceSourceId) {
    const direct = references.find((reference) => reference.id === frameMeta.referenceSourceId);
    if (direct) {
      return direct;
    }
  }

  if (!frameMeta.fileKey) {
    return null;
  }

  const fallback = references.find((reference) => {
    if (reference.fileKey !== frameMeta.fileKey) {
      return false;
    }

    const referenceNode = reference.nodeId ?? null;
    const frameNode = frameMeta.nodeId ?? null;
    return referenceNode === frameNode;
  });

  return fallback ?? null;
}
