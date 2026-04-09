import { useState } from "react";
import { Link2, X } from "lucide-react";
import { extractFigmaUrl } from "../lib/appHelpers";

type FigmaImportPopoverProps = {
  onImport: (figmaUrl: string) => Promise<void>;
  onClose: () => void;
};

export function FigmaImportPopover({ onImport, onClose }: FigmaImportPopoverProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const validUrl = extractFigmaUrl(url.trim());

  const handleSubmit = async () => {
    if (!validUrl) return;
    setBusy(true);
    try {
      await onImport(validUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="figma-import-popover" onClick={(e) => e.stopPropagation()}>
      <h3><Link2 size={13} /> Import Figma Screen</h3>
      <p>Paste a Figma frame link to import it as an editable screen on your artboard.</p>

      <div className="figma-import__input-group">
        <label>Figma Link</label>
        <input
          type="text"
          placeholder="https://figma.com/design/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && validUrl) void handleSubmit(); }}
          autoFocus
          disabled={busy}
        />
      </div>

      {busy ? (
        <div className="gradient-loader">
          <div className="gradient-loader__bar" />
          <span className="gradient-loader__label">Importing screen — this may take 15–30 seconds...</span>
        </div>
      ) : (
        <div className="figma-import__actions">
          <button className="figma-import__cancel" onClick={onClose}>Cancel</button>
          <button
            className="figma-import__submit"
            disabled={!validUrl}
            onClick={() => void handleSubmit()}
          >
            Import Screen
          </button>
        </div>
      )}
    </div>
  );
}
