import crypto from "node:crypto";
import type {
  ComposerAttachment,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  ProviderId,
  SelectedFrameContext,
  SurfaceTarget
} from "@designer/shared";

export function parseProvider(value: unknown): ProviderId {
  if (value === "openai" || value === "anthropic" || value === "google") {
    return value;
  }
  return "openai";
}

export function parseOptionalProvider(value: unknown): ProviderId | undefined {
  if (value === "openai" || value === "anthropic" || value === "google") {
    return value;
  }
  return undefined;
}

export function parseDevicePreset(value: unknown): DevicePreset {
  return value === "iphone" ? "iphone" : "desktop";
}

export function parseMode(value: unknown): DesignMode {
  return value === "wireframe" ? "wireframe" : "high-fidelity";
}

export function parseVariation(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(5, Math.floor(value)));
  }
  return 1;
}

export function parseTailwind(value: unknown): boolean {
  return value === true;
}

export function parseDesignSystemMode(value: unknown): DesignSystemMode {
  return value === "creative" ? "creative" : "strict";
}

export function parseSurfaceTarget(value: unknown): SurfaceTarget {
  return value === "mobile" ? "mobile" : "web";
}

export function parseNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseAttachments(value: unknown): ComposerAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed: ComposerAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== "image" && type !== "figma-link") {
      continue;
    }

    const attachment: ComposerAttachment = {
      id: typeof record.id === "string" && record.id.trim().length > 0 ? record.id : crypto.randomUUID(),
      type,
      status:
        record.status === "pending" || record.status === "uploaded" || record.status === "failed"
          ? record.status
          : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
      dataUrl: typeof record.dataUrl === "string" ? record.dataUrl : undefined
    };

    if (attachment.type === "figma-link") {
      const isValidFigmaUrl =
        typeof attachment.url === "string" && /^https?:\/\/(?:www\.)?figma\.com\/design\//i.test(attachment.url);
      if (!isValidFigmaUrl) {
        continue;
      }
    }

    parsed.push(attachment);
  }

  const imageAttachments = parsed.filter((attachment) => attachment.type === "image");
  if (imageAttachments.length > 1) {
    throw new Error("Only one image attachment is supported per message.");
  }

  const image = imageAttachments[0];
  if (image) {
    const allowedMime = new Set(["image/png", "image/jpg", "image/jpeg", "image/webp", "image/svg+xml"]);
    if (!image.mimeType || !allowedMime.has(image.mimeType)) {
      throw new Error("Unsupported image type. Use png, jpg, jpeg, webp, or svg.");
    }
    if (!image.dataUrl || !image.dataUrl.startsWith("data:image/")) {
      throw new Error("Image attachment must include a valid data URL.");
    }
    const approxBytes = Math.floor((image.dataUrl.length * 3) / 4);
    if (approxBytes > 8 * 1024 * 1024) {
      throw new Error("Image attachment is too large. Max supported size is 8 MB.");
    }
  }

  return parsed.length > 0 ? parsed : undefined;
}

export function parseSelectedFrameContext(value: unknown): SelectedFrameContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.frameId !== "string" ||
    typeof record.name !== "string" ||
    (record.devicePreset !== "desktop" && record.devicePreset !== "iphone") ||
    (record.mode !== "wireframe" && record.mode !== "high-fidelity") ||
    typeof record.size !== "object" ||
    record.size === null
  ) {
    return undefined;
  }

  const size = record.size as Record<string, unknown>;
  if (typeof size.width !== "number" || typeof size.height !== "number") {
    return undefined;
  }

  return {
    frameId: record.frameId,
    name: record.name,
    devicePreset: record.devicePreset,
    mode: record.mode,
    size: {
      width: size.width,
      height: size.height
    },
    latestVersionId: typeof record.latestVersionId === "string" ? record.latestVersionId : null,
    sourceType: typeof record.sourceType === "string" ? record.sourceType : null,
    sourceRole: typeof record.sourceRole === "string" ? record.sourceRole : null,
    sourceGroupId: typeof record.sourceGroupId === "string" ? record.sourceGroupId : null
  };
}

export function fallbackCredentialsPrompt() {
  return "MCP attach failed. Send `/figma-credentials <clientId> <clientSecret>` in chat, then resend the same Figma link.";
}
