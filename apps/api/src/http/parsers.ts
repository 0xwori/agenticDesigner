import crypto from "node:crypto";
import type {
  ComposerAttachment,
  DeckSlideCount,
  DesignMode,
  DesignSystemMode,
  DevicePreset,
  ProviderId,
  SelectedBlockContext,
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

const VALID_DEVICE_PRESETS = new Set<string>(["desktop", "iphone", "iphone-15", "iphone-15-pro", "iphone-15-pro-max"]);

export function parseDevicePreset(value: unknown): DevicePreset {
  if (typeof value === "string" && VALID_DEVICE_PRESETS.has(value)) {
    return value as DevicePreset;
  }
  return "desktop";
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
  if (value === "mobile" || value === "deck") {
    return value;
  }
  return "web";
}

export function parseDeckSlideCount(value: unknown): DeckSlideCount {
  if (value === 5 || value === 10 || value === 25) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (parsed === 5 || parsed === 10 || parsed === 25) {
      return parsed;
    }
  }
  return 10;
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
    if (type !== "image" && type !== "figma-link" && type !== "text") {
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
      dataUrl: typeof record.dataUrl === "string" ? record.dataUrl : undefined,
      textContent: typeof record.textContent === "string" ? record.textContent : undefined
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

  const textAttachments = parsed.filter((attachment) => attachment.type === "text");
  if (textAttachments.length > 1) {
    throw new Error("Only one text attachment is supported per message.");
  }

  const text = textAttachments[0];
  if (text) {
    const allowedMime = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
    const normalizedName = text.name?.toLowerCase() ?? "";
    const hasAllowedExtension = normalizedName.endsWith(".txt") || normalizedName.endsWith(".md");
    if ((text.mimeType && !allowedMime.has(text.mimeType)) && !hasAllowedExtension) {
      throw new Error("Unsupported text attachment type. Use .txt or .md.");
    }
    if (!text.textContent || text.textContent.trim().length === 0) {
      throw new Error("Text attachment must include text content.");
    }
    if (text.textContent.length > 300_000) {
      throw new Error("Text attachment is too large. Max supported size is 300 KB.");
    }
  }

  return parsed.length > 0 ? parsed : undefined;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseSelectedBlockContext(value: unknown): SelectedBlockContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rect = record.rect as Record<string, unknown> | null;
  if (!rect || typeof rect !== "object") {
    return undefined;
  }

  const frameId = typeof record.frameId === "string" ? record.frameId.trim() : "";
  const versionId = typeof record.versionId === "string" ? record.versionId.trim() : "";
  const blockId = typeof record.blockId === "string" ? record.blockId.trim() : "";
  if (!frameId || !versionId || !blockId) {
    return undefined;
  }

  const x = parseFiniteNumber(rect.x);
  const y = parseFiniteNumber(rect.y);
  const width = parseFiniteNumber(rect.width);
  const height = parseFiniteNumber(rect.height);
  if (x === null || y === null || width === null || height === null) {
    return undefined;
  }

  return {
    frameId,
    versionId,
    blockId,
    label: typeof record.label === "string" ? record.label.slice(0, 160) : blockId,
    selector: typeof record.selector === "string" ? record.selector.slice(0, 512) : "",
    tagName: typeof record.tagName === "string" ? record.tagName.slice(0, 32) : "",
    className: typeof record.className === "string" ? record.className.slice(0, 512) : "",
    textSnippet: typeof record.textSnippet === "string" ? record.textSnippet.slice(0, 1000) : "",
    outerHtml: typeof record.outerHtml === "string" ? record.outerHtml.slice(0, 6000) : "",
    rect: { x, y, width, height }
  };
}

export function parseSelectedFrameContext(value: unknown): SelectedFrameContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.frameId !== "string" ||
    typeof record.name !== "string" ||
    !VALID_DEVICE_PRESETS.has(record.devicePreset as string) ||
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
    devicePreset: record.devicePreset as DevicePreset,
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
