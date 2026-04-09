import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND_CATEGORIES, BRAND_TEMPLATES, loadBrandMarkdown } from "../brands/brandIndex";
import type { BrandCategory, BrandEntry } from "../brands/brandIndex";
import { Search, X, Sparkles, Check, ImagePlus, Link2, Upload, Trash2 } from "lucide-react";
import { extractFigmaUrl } from "../lib/appHelpers";

// ---------------------------------------------------------------------------
// Gradient Loader
// ---------------------------------------------------------------------------

function GradientLoader({ label }: { label?: string }) {
  return (
    <div className="gradient-loader">
      <div className="gradient-loader__bar" />
      {label ? <span className="gradient-loader__label">{label}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reference attachment item (image file, image URL, or Figma link)
// ---------------------------------------------------------------------------

type RefAttachment =
  | { kind: "image-file"; id: string; file: File; previewUrl: string }
  | { kind: "image-url"; id: string; url: string }
  | { kind: "figma-link"; id: string; url: string };

let _refIdCounter = 0;
function nextRefId() {
  return `ref-${++_refIdCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "textCustom" | "referenceCustom";

type BrandPickerModalProps = {
  open: boolean;
  onClose: () => void;
  onApply: (markdown: string, brandName: string) => void;
  currentBrandId?: string | null;
  hasExistingDesignSystem?: boolean;
  onApplyFromReferences?: (refs: {
    figmaUrls: string[];
    imageFiles: File[];
    imageUrls: string[];
    styleNotes: string;
  }) => Promise<void>;
  onOpenVisualBoard?: () => void;
};

export function BrandPickerModal({
  open,
  onClose,
  onApply,
  currentBrandId,
  hasExistingDesignSystem,
  onApplyFromReferences,
  onOpenVisualBoard
}: BrandPickerModalProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<BrandCategory | "All">("All");
  const [selectedBrand, setSelectedBrand] = useState<BrandEntry | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Reference-custom state
  const [refAttachments, setRefAttachments] = useState<RefAttachment[]>([]);
  const [figmaInput, setFigmaInput] = useState("");
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const [refBusy, setRefBusy] = useState(false);
  const [refBusyLabel, setRefBusyLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DS replacement confirmation
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSearch("");
      setActiveCategory("All");
      setSelectedBrand(null);
      setPreview(null);
      setViewMode("grid");
      setCustomPrompt("");
      setRefAttachments([]);
      setFigmaInput("");
      setImageUrlInput("");
      setStyleNotes("");
      setRefBusy(false);
      setRefBusyLabel(null);
      setPendingAction(null);
    }
  }, [open]);

  // Load preview when a brand is selected
  useEffect(() => {
    if (!selectedBrand) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadBrandMarkdown(selectedBrand.id).then((md) => {
      if (!cancelled) {
        setPreview(md);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBrand]);

  const filtered = useMemo(() => {
    let list = BRAND_TEMPLATES;
    if (activeCategory !== "All") {
      list = list.filter((b) => b.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.tagline.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeCategory, search]);

  // ---------------------------------------------------------------------------
  // Reference helpers
  // ---------------------------------------------------------------------------

  const addFigmaLink = useCallback(() => {
    const url = extractFigmaUrl(figmaInput.trim());
    if (!url) return;
    if (refAttachments.some((a) => a.kind === "figma-link" && a.url === url)) return;
    setRefAttachments((prev) => [...prev, { kind: "figma-link", id: nextRefId(), url }]);
    setFigmaInput("");
  }, [figmaInput, refAttachments]);

  const addImageUrl = useCallback(() => {
    const raw = imageUrlInput.trim();
    if (!raw) return;
    try {
      new URL(raw);
    } catch {
      return;
    }
    if (refAttachments.some((a) => a.kind === "image-url" && a.url === raw)) return;
    setRefAttachments((prev) => [...prev, { kind: "image-url", id: nextRefId(), url: raw }]);
    setImageUrlInput("");
  }, [imageUrlInput, refAttachments]);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const allowed = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);
    const newItems: RefAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!allowed.has(file.type) || file.size > 8 * 1024 * 1024) continue;
      newItems.push({ kind: "image-file", id: nextRefId(), file, previewUrl: URL.createObjectURL(file) });
    }
    setRefAttachments((prev) => [...prev, ...newItems]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setRefAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item?.kind === "image-file") URL.revokeObjectURL(item.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // DS replacement guard
  // ---------------------------------------------------------------------------

  function guardDsReplace(action: () => void) {
    if (hasExistingDesignSystem) {
      setPendingAction(() => action);
    } else {
      action();
    }
  }

  // ---------------------------------------------------------------------------
  // Apply actions
  // ---------------------------------------------------------------------------

  const handleApplyBrand = () => {
    if (!preview || !selectedBrand) return;
    guardDsReplace(() => onApply(preview, selectedBrand.name));
  };

  const handleApplyCustomText = () => {
    if (!customPrompt.trim()) return;
    guardDsReplace(() => {
      const header = `# Custom Design System\n\n> Generated from prompt: "${customPrompt.trim()}"\n\n`;
      const body = `## Visual Theme & Atmosphere\n${customPrompt.trim()}\n\n## Agent Prompt Guide\nFollow the theme described above. Maintain consistency across all screens.\n`;
      onApply(header + body, "Custom");
    });
  };

  const handleApplyReferences = async () => {
    if (!onApplyFromReferences) return;
    const figmaUrls = refAttachments.filter((a) => a.kind === "figma-link").map((a) => (a as { url: string }).url);
    const imageFiles = refAttachments.filter((a): a is RefAttachment & { kind: "image-file" } => a.kind === "image-file").map((a) => a.file);
    const imageUrls = refAttachments.filter((a): a is RefAttachment & { kind: "image-url" } => a.kind === "image-url").map((a) => a.url);
    if (figmaUrls.length === 0 && imageFiles.length === 0 && imageUrls.length === 0) return;

    const doApply = async () => {
      setRefBusy(true);
      setRefBusyLabel("Syncing references and generating design system...");
      try {
        await onApplyFromReferences({ figmaUrls, imageFiles, imageUrls, styleNotes });
      } finally {
        setRefBusy(false);
        setRefBusyLabel(null);
      }
    };

    if (hasExistingDesignSystem) {
      setPendingAction(() => () => void doApply());
    } else {
      await doApply();
    }
  };

  if (!open) return null;

  const refCount = refAttachments.length;

  return (
    <div className="brand-picker-overlay" onClick={onClose}>
      <div className="brand-picker-modal" onClick={(e) => e.stopPropagation()}>
        {/* DS replacement warning overlay */}
        {pendingAction ? (
          <div className="brand-picker__confirm-overlay">
            <div className="brand-picker__confirm-card">
              <h3>Replace existing design system?</h3>
              <p>Your current design system will be replaced. Generated frames will use the new style tokens going forward. This cannot be undone.</p>
              <div className="brand-picker__confirm-actions">
                <button className="brand-picker__confirm-cancel" onClick={() => setPendingAction(null)}>
                  Cancel
                </button>
                <button
                  className="brand-picker__confirm-proceed"
                  onClick={() => {
                    const action = pendingAction;
                    setPendingAction(null);
                    action();
                  }}
                >
                  Replace Design System
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Header */}
        <header className="brand-picker__header">
          <div>
            <h2>Brand Templates</h2>
            <p>Choose a design system from 58 curated brands, or create your own.</p>
          </div>
          <button className="brand-picker__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {/* Search + Category tabs (only in grid mode) */}
        {viewMode === "grid" ? (
          <div className="brand-picker__toolbar">
            <div className="brand-picker__search">
              <Search size={13} />
              <input
                type="text"
                placeholder="Search brands..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="brand-picker__categories">
              <button
                className={`brand-category-tab ${activeCategory === "All" ? "is-active" : ""}`}
                onClick={() => setActiveCategory("All")}
              >
                All
              </button>
              {BRAND_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`brand-category-tab ${activeCategory === cat ? "is-active" : ""}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="brand-picker__toolbar brand-picker__toolbar--back">
            <button className="brand-picker__back-btn" onClick={() => { setViewMode("grid"); setSelectedBrand(null); }}>
              ← Back to templates
            </button>
          </div>
        )}

        {/* Body */}
        <div className="brand-picker__body">
          {viewMode === "grid" ? (
            <>
              {/* Scrollable grid */}
              <div className="brand-picker__grid-scroll">
                <div className="brand-picker__grid">
                  {/* Custom text card */}
                  <div
                    className="brand-card brand-card--custom"
                    role="button"
                    tabIndex={0}
                    onClick={() => { setViewMode("textCustom"); setSelectedBrand(null); }}
                  >
                    <div className="brand-card__swatch" style={{ background: "linear-gradient(135deg, #7b61ff, #ff6b6b, #ffd02f)" }} />
                    <div className="brand-card__text">
                      <span className="brand-card__name"><Sparkles size={11} /> Custom Brand</span>
                      <span className="brand-card__tagline">Create from a prompt</span>
                    </div>
                  </div>

                  {/* From Reference card */}
                  <div
                    className="brand-card brand-card--reference"
                    role="button"
                    tabIndex={0}
                    onClick={() => { setViewMode("referenceCustom"); setSelectedBrand(null); }}
                  >
                    <div className="brand-card__swatch" style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6, #ec4899)" }} />
                    <div className="brand-card__text">
                      <span className="brand-card__name"><ImagePlus size={11} /> From Reference</span>
                      <span className="brand-card__tagline">Image or Figma link</span>
                    </div>
                  </div>

                  {filtered.map((brand) => (
                    <div
                      key={brand.id}
                      className={`brand-card ${selectedBrand?.id === brand.id ? "is-selected" : ""} ${currentBrandId === brand.id ? "is-current" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setViewMode("grid"); setSelectedBrand(brand); }}
                    >
                      <div className="brand-card__swatch" style={{ background: brand.accent }} />
                      <div className="brand-card__text">
                        <span className="brand-card__name">
                          {brand.name}
                          {currentBrandId === brand.id ? <Check size={11} /> : null}
                        </span>
                        <span className="brand-card__tagline">{brand.tagline}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <aside className="brand-picker__preview">
                {selectedBrand ? (
                  <div className="brand-picker__brand-preview">
                    <div className="brand-preview__header">
                      <div className="brand-preview__accent-strip" style={{ background: selectedBrand.accent }} />
                      <h3>{selectedBrand.name}</h3>
                      <span className="brand-preview__category">{selectedBrand.category}</span>
                      <p>{selectedBrand.tagline}</p>
                    </div>
                    {loading ? (
                      <GradientLoader label="Loading preview..." />
                    ) : preview ? (
                      <>
                        <pre className="brand-preview__markdown">{preview}</pre>
                        <button className="brand-picker__apply-btn" onClick={handleApplyBrand}>
                          Apply {selectedBrand.name} Design System
                        </button>
                        {hasExistingDesignSystem && onOpenVisualBoard ? (
                          <button className="brand-picker__preview-board-btn" onClick={onOpenVisualBoard}>
                            Preview Visual Board
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="brand-picker__empty-preview">
                    <p>Select a brand to preview its design system.</p>
                  </div>
                )}
              </aside>
            </>
          ) : viewMode === "textCustom" ? (
            <>
              <div className="brand-picker__full-pane">
                <div className="brand-picker__custom">
                  <h3>Create Custom Brand</h3>
                  <p>Describe your brand's visual identity and the AI will generate a DESIGN.md for you.</p>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="E.g. Modern SaaS dashboard with deep navy background, electric blue accents, Inter font family, rounded corners, generous spacing..."
                    rows={6}
                  />
                  <button
                    className="brand-picker__apply-btn"
                    disabled={!customPrompt.trim()}
                    onClick={handleApplyCustomText}
                  >
                    <Sparkles size={12} />
                    Generate &amp; Apply
                  </button>
                </div>
              </div>
              <aside className="brand-picker__preview">
                <div className="brand-picker__empty-preview">
                  <p>Your custom design system will be generated from the prompt you write.</p>
                </div>
              </aside>
            </>
          ) : (
            <>
              {/* Reference custom pane */}
              <div className="brand-picker__full-pane brand-picker__reference-pane">
                {refBusy ? (
                  <div className="brand-picker__ref-busy">
                    <GradientLoader label={refBusyLabel ?? "Processing..."} />
                    <p className="brand-picker__ref-busy-hint">Syncing references and generating your design system. This may take 15–30 seconds.</p>
                  </div>
                ) : (
                  <>
                    <h3>Create from References</h3>
                    <p>Add images or Figma links to generate a custom design system that matches your visual identity.</p>

                    {/* Figma link input */}
                    <div className="brand-picker__ref-section">
                      <label className="brand-picker__ref-label"><Link2 size={11} /> Figma Link</label>
                      <div className="brand-picker__ref-row">
                        <input
                          type="text"
                          placeholder="https://figma.com/design/..."
                          value={figmaInput}
                          onChange={(e) => setFigmaInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addFigmaLink(); }}
                        />
                        <button onClick={addFigmaLink} disabled={!extractFigmaUrl(figmaInput.trim())}>Add</button>
                      </div>
                    </div>

                    {/* Image inputs: file upload + URL */}
                    <div className="brand-picker__ref-section">
                      <label className="brand-picker__ref-label"><ImagePlus size={11} /> Images</label>
                      <div className="brand-picker__ref-row">
                        <input
                          type="text"
                          placeholder="Paste image URL..."
                          value={imageUrlInput}
                          onChange={(e) => setImageUrlInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addImageUrl(); }}
                        />
                        <button onClick={addImageUrl} disabled={!imageUrlInput.trim()}>Add</button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        multiple
                        hidden
                        onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ""; }}
                      />
                      <button className="brand-picker__ref-upload-btn" onClick={() => fileInputRef.current?.click()}>
                        <Upload size={12} /> Upload images
                      </button>
                    </div>

                    {/* Style notes */}
                    <div className="brand-picker__ref-section">
                      <label className="brand-picker__ref-label">Style Notes (optional)</label>
                      <textarea
                        value={styleNotes}
                        onChange={(e) => setStyleNotes(e.target.value)}
                        placeholder="E.g. Use rounded corners, prefer dark mode, keep the color palette from the Figma file..."
                        rows={3}
                      />
                    </div>

                    {/* Apply */}
                    <button
                      className="brand-picker__apply-btn"
                      disabled={refCount === 0}
                      onClick={() => void handleApplyReferences()}
                    >
                      <Sparkles size={12} />
                      Generate Design System ({refCount} reference{refCount !== 1 ? "s" : ""})
                    </button>
                  </>
                )}
              </div>

              {/* Attachments preview */}
              <aside className="brand-picker__preview">
                {refAttachments.length === 0 ? (
                  <div className="brand-picker__empty-preview">
                    <p>Add references to see them here. At least one image or Figma link is required.</p>
                  </div>
                ) : (
                  <div className="brand-picker__ref-preview-list">
                    <h4>{refAttachments.length} Reference{refAttachments.length !== 1 ? "s" : ""}</h4>
                    {refAttachments.map((att) => (
                      <div key={att.id} className="brand-picker__ref-chip">
                        <div className="brand-picker__ref-chip-info">
                          {att.kind === "figma-link" ? (
                            <><Link2 size={11} /> <span className="brand-picker__ref-chip-text">{att.url.slice(0, 60)}...</span></>
                          ) : att.kind === "image-url" ? (
                            <><ImagePlus size={11} /> <span className="brand-picker__ref-chip-text">{att.url.slice(0, 60)}...</span></>
                          ) : (
                            <>
                              <img src={att.previewUrl} alt={att.file.name} className="brand-picker__ref-thumb" />
                              <span className="brand-picker__ref-chip-text">{att.file.name}</span>
                            </>
                          )}
                        </div>
                        <button className="brand-picker__ref-chip-remove" onClick={() => removeAttachment(att.id)} aria-label="Remove">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
