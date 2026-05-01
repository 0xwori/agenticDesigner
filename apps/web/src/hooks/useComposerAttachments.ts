import { useCallback } from "react";
import type { ComposerAttachment } from "@designer/shared";
import { extractFigmaUrl } from "../lib/appHelpers";
import { useInputState } from "../lib/store";
import type { PipelineEventsApi } from "./usePipelineEvents";

export type ComposerAttachmentsApi = {
  removeComposerAttachment: (attachmentId: string) => void;
  addFigmaAttachment: (rawUrl: string) => void;
  addImageAttachment: (file: File) => Promise<void>;
  addTextAttachment: (file: File) => Promise<void>;
};

export function useComposerAttachments(
  appendSystemEvent: PipelineEventsApi["appendSystemEvent"]
): ComposerAttachmentsApi {
  const { composerAttachments, setComposerAttachments } = useInputState();

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((current) => current.filter((a) => a.id !== attachmentId));
  }, [setComposerAttachments]);

  const addFigmaAttachment = useCallback(
    (rawUrl: string) => {
      const figmaUrl = extractFigmaUrl(rawUrl);
      if (!figmaUrl) {
        appendSystemEvent({ status: "error", kind: "action", message: "Invalid Figma URL. Use a figma.com/design link." });
        return;
      }
      const attachment: ComposerAttachment = {
        id: `figma-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "figma-link",
        url: figmaUrl,
        status: "uploaded",
        name: "Figma reference"
      };
      setComposerAttachments((current) => {
        const withoutExisting = current.filter((item) => item.type !== "figma-link");
        return [...withoutExisting, attachment];
      });
      appendSystemEvent({ status: "success", kind: "action", message: "Figma link attached to composer.", payload: { url: figmaUrl } });
    },
    [appendSystemEvent, setComposerAttachments]
  );

  const addImageAttachment = useCallback(
    async (file: File) => {
      const allowedMime = new Set(["image/png", "image/jpg", "image/jpeg", "image/webp", "image/svg+xml"]);
      if (!allowedMime.has(file.type)) {
        appendSystemEvent({ status: "error", kind: "action", message: "Unsupported image type. Use png, jpg, jpeg, webp, or svg." });
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        appendSystemEvent({ status: "error", kind: "action", message: "Image is too large. Max supported size is 8 MB." });
        return;
      }
      if (composerAttachments.some((a) => a.type === "image" && a.status !== "failed")) {
        appendSystemEvent({ status: "error", kind: "action", message: "Only one image attachment is supported per message." });
        return;
      }

      const provisionalId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setComposerAttachments((current) => [
        ...current.filter((a) => !(a.type === "image" && a.status === "failed")),
        { id: provisionalId, type: "image", status: "pending", name: file.name, mimeType: file.type }
      ]);

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") resolve(reader.result);
          else reject(new Error("File reader did not return a data URL."));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read image attachment."));
        reader.readAsDataURL(file);
      }).catch((reason) => {
        appendSystemEvent({ status: "error", kind: "action", message: reason instanceof Error ? reason.message : String(reason) });
        return null;
      });

      if (!dataUrl) {
        setComposerAttachments((current) =>
          current.map((a) => (a.id !== provisionalId ? a : { ...a, status: "failed" }))
        );
        return;
      }

      setComposerAttachments((current) =>
        current.map((a) => (a.id !== provisionalId ? a : { ...a, status: "uploaded", dataUrl }))
      );
      appendSystemEvent({ status: "success", kind: "action", message: "Image attached. I can rebuild it into editable React UI on send.", payload: { name: file.name } });
    },
    [appendSystemEvent, composerAttachments, setComposerAttachments]
  );

  const addTextAttachment = useCallback(
    async (file: File) => {
      const normalizedName = file.name.toLowerCase();
      if (!normalizedName.endsWith(".txt") && !normalizedName.endsWith(".md")) {
        appendSystemEvent({ status: "error", kind: "action", message: "Unsupported deck source. Use .txt or .md." });
        return;
      }
      if (file.size > 300 * 1024) {
        appendSystemEvent({ status: "error", kind: "action", message: "Text source is too large. Max supported size is 300 KB." });
        return;
      }
      if (composerAttachments.some((a) => a.type === "text" && a.status !== "failed")) {
        appendSystemEvent({ status: "error", kind: "action", message: "Only one text source is supported per message." });
        return;
      }

      const provisionalId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setComposerAttachments((current) => [
        ...current.filter((a) => !(a.type === "text" && a.status === "failed")),
        { id: provisionalId, type: "text", status: "pending", name: file.name, mimeType: file.type || "text/plain" }
      ]);

      const textContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") resolve(reader.result);
          else reject(new Error("File reader did not return text."));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read text source."));
        reader.readAsText(file);
      }).catch((reason) => {
        appendSystemEvent({ status: "error", kind: "action", message: reason instanceof Error ? reason.message : String(reason) });
        return null;
      });

      if (!textContent) {
        setComposerAttachments((current) =>
          current.map((a) => (a.id !== provisionalId ? a : { ...a, status: "failed" }))
        );
        return;
      }

      setComposerAttachments((current) =>
        current.map((a) => (a.id !== provisionalId ? a : { ...a, status: "uploaded", textContent }))
      );
      appendSystemEvent({ status: "success", kind: "action", message: "Text source attached for deck generation.", payload: { name: file.name } });
    },
    [appendSystemEvent, composerAttachments, setComposerAttachments]
  );

  return { removeComposerAttachment, addFigmaAttachment, addImageAttachment, addTextAttachment };
}
