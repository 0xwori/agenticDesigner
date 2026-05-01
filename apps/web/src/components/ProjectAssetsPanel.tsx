import React, { useRef } from "react";
import type { ProjectAsset } from "@designer/shared";
import { Boxes, FileText, ImagePlus, Loader2, Trash2, X } from "lucide-react";

type ProjectAssetsPanelProps = {
  open: boolean;
  assets: ProjectAsset[];
  busy: boolean;
  onClose: () => void;
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
};

function formatSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function ProjectAssetsPanel(props: ProjectAssetsPanelProps) {
  const { open, assets, busy, onClose, onUpload, onDelete } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function onFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    await onUpload(files);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="asset-panel-backdrop" role="presentation">
      <section className="asset-panel" role="dialog" aria-modal="true" aria-label="Project assets">
        <header className="asset-panel__header">
          <div>
            <p>Project Assets</p>
            <h2>Reusable source material</h2>
          </div>
          <button type="button" className="asset-panel__close" onClick={onClose} aria-label="Close assets">
            <X size={15} />
          </button>
        </header>

        <div className="asset-panel__intro">
          <Boxes size={16} />
          <p>Images and documents here are available to the agent for desktop, mobile, and deck prompts.</p>
        </div>

        <div className="asset-panel__actions">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={14} /> : <ImagePlus size={14} />}
            Upload assets
          </button>
          <input
            ref={fileInputRef}
            className="composer-hidden-file-input"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,.txt,.md,text/plain,text/markdown"
            onChange={onFilesSelected}
          />
        </div>

        <div className="asset-panel__list">
          {assets.length === 0 ? (
            <div className="asset-panel__empty">Upload images, SVGs, text, or Markdown to give the agent reusable material.</div>
          ) : (
            assets.map((asset) => (
              <article key={asset.id} className="asset-card">
                <div className="asset-card__preview">
                  {asset.kind === "image" && asset.dataUrl ? (
                    <img src={asset.dataUrl} alt={asset.name} />
                  ) : (
                    <FileText size={18} />
                  )}
                </div>
                <div className="asset-card__body">
                  <strong>{asset.name}</strong>
                  <span>{asset.kind} / {asset.mimeType} / {formatSize(asset.size)}</span>
                  <code>asset://{asset.id}</code>
                </div>
                <button type="button" onClick={() => void onDelete(asset.id)} aria-label={`Delete ${asset.name}`}>
                  <Trash2 size={13} />
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
