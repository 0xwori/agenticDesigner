import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  DesignSystemVisualBlock,
  DesignSystemVisualItem,
  ProjectDesignSystem,
  ReferenceSource
} from "@designer/shared";
import { ImagePlus, Link2, Loader2, Palette, RefreshCw, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { getDesignSystemVisualSections } from "../lib/designSystemModal";

type ProjectDesignSystemModalProps = {
  open: boolean;
  designSystem: ProjectDesignSystem | null;
  references: ReferenceSource[];
  referenceItems: DesignSystemReferenceItem[];
  warnings: string[];
  busy: boolean;
  busyLabel?: string | null;
  regeneratingReferenceId?: string | null;
  onClose: () => void;
  onBootstrap: (mode: "manual" | "reference") => Promise<void>;
  onResetAndRegenerate: () => Promise<void>;
  onSaveMarkdown: (markdown: string) => Promise<void>;
  onRegenerateFromReference: (item: DesignSystemReferenceItem) => Promise<void>;
  onRegenerateAllReferences: () => Promise<void>;
  onAddFigmaReference: (figmaUrl: string) => Promise<void>;
  onAddImageReferences: (files: File[]) => Promise<void>;
};

export type DesignSystemReferenceItem = {
  id: string;
  frameId: string | null;
  title: string;
  subtitle: string;
  sourceType: "figma-reference" | "image-reference";
  referenceSourceId: string | null;
  referenceUrl: string | null;
  previewLabel: string;
};

type DesignSystemTab = "visual" | "design-md" | "references";

type VisualPalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
};

function pickColorByName(
  colors: Array<{ name: string; hex: string; role?: string; _subsection?: string }>,
  candidates: string[],
  fallbackIndex?: number,
  options?: { skipForegroundRoles?: boolean }
) {
  const shouldSkip = (item: { role?: string; _subsection?: string }) =>
    options?.skipForegroundRoles === true && isForegroundColorRole(item);

  for (const candidate of candidates) {
    const needle = candidate.toLowerCase();
    const token = colors.find((item) => {
      const haystack = `${item.name} ${item.role ?? ""} ${item._subsection ?? ""}`.toLowerCase();
      return haystack.includes(needle) && !shouldSkip(item);
    });
    if (token?.hex) {
      return token.hex;
    }
  }
  if (typeof fallbackIndex === "number" && colors[fallbackIndex]?.hex) {
    return colors[fallbackIndex].hex;
  }
  return null;
}

function isForegroundColorRole(item: { role?: string; _subsection?: string }) {
  const text = `${item.role ?? ""} ${item._subsection ?? ""}`.toLowerCase();
  return (
    /\b(text|copy|heading|foreground|ink)\b/.test(text) ||
    /\bon\s+(?:light|dark|brand|colored|neutral)?\s*backgrounds?\b/.test(text)
  );
}

function buildPalette(designSystem: ProjectDesignSystem | null): VisualPalette | null {
  const tokens = designSystem?.structuredTokens.colors ?? [];
  if (tokens.length === 0) {
    return null;
  }
  const background =
    pickColorByName(tokens, ["background", "page", "canvas"], undefined, { skipForegroundRoles: true }) ??
    pickColorByName(tokens, ["surface", "container", "panel", "card", "neutral"], undefined, { skipForegroundRoles: true }) ??
    "#f5f5f6";
  return {
    primary: pickColorByName(tokens, ["primary", "brand"], 0, { skipForegroundRoles: true }) ?? tokens[0].hex,
    secondary: pickColorByName(tokens, ["secondary", "support"], 1, { skipForegroundRoles: true }) ?? tokens[0].hex,
    accent: pickColorByName(tokens, ["accent", "tertiary"], 2, { skipForegroundRoles: true }) ?? tokens[0].hex,
    background,
    surface:
      pickColorByName(tokens, ["surface", "container", "panel", "card", "neutral"], undefined, { skipForegroundRoles: true }) ??
      background,
    text: pickColorByName(tokens, ["text", "ink", "on"], 4) ?? tokens[0].hex
  };
}

function stateClass(item: DesignSystemVisualItem) {
  if (item.state === "active") {
    return "is-active";
  }
  if (item.state === "success") {
    return "is-success";
  }
  if (item.state === "error") {
    return "is-error";
  }
  if (item.state === "disabled") {
    return "is-disabled";
  }
  if (item.state === "focus") {
    return "is-focus";
  }
  return "";
}

function renderBlock(block: DesignSystemVisualBlock) {
  if (block.kind === "swatches") {
    return (
      <div className="ds-swatch-grid">
        {block.items.map((item) => (
          <article key={`${item.label}-${item.hex}`} className="ds-swatch">
            <span className="ds-swatch__color" style={{ background: item.hex ?? "#d7dce4" }} />
            <p>{item.label}</p>
            {item.hex ? <code>{item.hex}</code> : null}
          </article>
        ))}
      </div>
    );
  }

  if (block.kind === "chips") {
    return (
      <div className="ds-chip-row">
        {block.items.map((item) => (
          <span key={`${item.label}-${item.value ?? ""}`} className="ds-chip">
            {item.label}
          </span>
        ))}
      </div>
    );
  }

  if (block.kind === "type-samples") {
    return (
      <div className="ds-type-grid">
        {block.items.map((item) => (
          <article key={`${item.label}-${item.fontFamily ?? ""}`} className="ds-type-card">
            <p className="ds-type-card__label">{item.label}</p>
            <p
              className="ds-type-card__sample"
              style={{
                fontFamily: item.fontFamily,
                fontSize: item.sizePx,
                fontWeight: item.weight
              }}
            >
              {item.value ?? item.label}
            </p>
          </article>
        ))}
      </div>
    );
  }

  if (block.kind === "spacing-scale") {
    return (
      <div className="ds-spacing-row">
        {block.items.map((item) => {
          const width = Math.max(4, Math.min(64, Math.round(item.sizePx ?? 8)));
          return (
            <span key={`${item.label}-${item.sizePx ?? ""}`} className="ds-spacing-chip">
              <i style={{ width }} />
              {item.label}
            </span>
          );
        })}
      </div>
    );
  }

  if (block.kind === "component-states") {
    return (
      <div className="ds-component-row">
        {block.items.map((item) => (
          <span key={`${item.label}-${item.state ?? ""}`} className={`ds-component-pill ${stateClass(item)}`}>
            {item.label}
          </span>
        ))}
      </div>
    );
  }

  if (block.kind === "navigation-items") {
    return (
      <nav className="ds-nav-row">
        {block.items.map((item) => (
          <a key={`${item.label}-${item.state ?? ""}`} className={stateClass(item)}>
            {item.label}
          </a>
        ))}
      </nav>
    );
  }

  if (block.kind === "metric-cards") {
    return (
      <div className="ds-metric-grid">
        {block.items.map((item) => (
          <article key={`${item.label}-${item.value ?? ""}`} className="ds-metric-card">
            <p>{item.label}</p>
            {item.value ? <strong>{item.value}</strong> : null}
          </article>
        ))}
      </div>
    );
  }

  if (block.kind === "icons") {
    return (
      <div className="ds-icon-row">
        {block.items.map((item) => (
          <span key={item.label} className="ds-icon-dot">
            {item.label.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="ds-rule-grid">
      {block.items.map((item) => (
        <article key={`${item.label}-${item.value ?? ""}`} className="ds-rule-chip">
          <span>{item.label}</span>
          {item.value ? <b>{item.value}</b> : null}
        </article>
      ))}
    </div>
  );
}

export function ProjectDesignSystemModal(props: ProjectDesignSystemModalProps) {
  const {
    open,
    designSystem,
    references,
    referenceItems,
    warnings,
    busy,
    busyLabel,
    regeneratingReferenceId,
    onClose,
    onBootstrap,
    onResetAndRegenerate,
    onSaveMarkdown,
    onRegenerateFromReference,
    onRegenerateAllReferences,
    onAddFigmaReference,
    onAddImageReferences
  } = props;

  const [activeTab, setActiveTab] = useState<DesignSystemTab>("visual");
  const [activeVisualSection, setActiveVisualSection] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [figmaInput, setFigmaInput] = useState("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const visualContentRef = useRef<HTMLDivElement | null>(null);

  const visualSections = useMemo(() => {
    return getDesignSystemVisualSections(designSystem);
  }, [designSystem?.structuredTokens.visualBoard?.sections]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const markdown = designSystem?.markdown ?? "";
    setDraft(markdown);
    setHasUnsavedChanges(false);
  }, [designSystem?.markdown, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || activeTab !== "visual") {
      return;
    }
    const root = visualContentRef.current;
    if (!root) {
      return;
    }

    const sectionElements = visualSections
      .map((section) => root.querySelector<HTMLElement>(`[data-ds-section-id="${section.id}"]`))
      .filter((element): element is HTMLElement => Boolean(element));

    if (sectionElements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let nextId: string | null = null;
        let bestRatio = 0;

        for (const entry of entries) {
          const id = entry.target.getAttribute("data-ds-section-id");
          if (!id || !entry.isIntersecting || entry.intersectionRatio < bestRatio) {
            continue;
          }
          nextId = id;
          bestRatio = entry.intersectionRatio;
        }

        if (nextId) {
          setActiveVisualSection(nextId);
        }
      },
      {
        root,
        threshold: [0.2, 0.4, 0.6, 0.8],
        rootMargin: "-6% 0px -55% 0px"
      }
    );

    sectionElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [activeTab, open, visualSections]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!activeVisualSection && visualSections[0]) {
      setActiveVisualSection(visualSections[0].id);
    }
  }, [activeVisualSection, open, visualSections]);

  const hasReferences = referenceItems.length > 0 || references.length > 0;
  const hasDesignSystem = Boolean(designSystem);
  const showTabs = hasReferences || hasDesignSystem;

  const visualPalette = useMemo(() => buildPalette(designSystem), [designSystem]);
  const visualVars = useMemo(
    () =>
      ({
        "--ds-primary": visualPalette?.primary ?? "#8b8f98",
        "--ds-secondary": visualPalette?.secondary ?? "#6f7785",
        "--ds-accent": visualPalette?.accent ?? "#9b8f82",
        "--ds-background": visualPalette?.background ?? "#f5f5f6",
        "--ds-surface": visualPalette?.surface ?? "#f5f5f6",
        "--ds-text": visualPalette?.text ?? "#202327"
      }) as CSSProperties,
    [visualPalette]
  );

  if (!open) {
    return null;
  }

  function scrollToVisualSection(sectionId: string) {
    setActiveVisualSection(sectionId);
    const root = visualContentRef.current;
    if (!root) {
      return;
    }
    const section = root.querySelector<HTMLElement>(`[data-ds-section-id="${sectionId}"]`);
    if (!section) {
      return;
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="workspace-modal-overlay" role="dialog" aria-modal="true">
      <div className="workspace-modal workspace-modal--design-system">
        <header className="workspace-modal__header">
          <div className="workspace-modal__title">
            <Palette size={15} />
            <div>
              <h2>Project Design System</h2>
              <p>Visual board + canonical design.md</p>
            </div>
          </div>
          <div className="workspace-modal__header-actions">
            <button
              onClick={() => {
                void onResetAndRegenerate();
              }}
              title="Full reset and regenerate"
              disabled={busy || !hasReferences}
            >
              <RotateCcw size={13} />
            </button>
            <button
              onClick={() => {
                void onBootstrap("reference");
              }}
              title="Generate from reference"
              disabled={busy || !hasReferences}
            >
              <RefreshCw size={13} />
            </button>
            <button onClick={onClose} title="Close design system">
              <X size={13} />
            </button>
          </div>
        </header>

        <div className="workspace-modal__body">
          {showTabs ? (
            <section className="design-system-modal__tabs">
              <button
                type="button"
                className={activeTab === "visual" ? "is-active" : ""}
                onClick={() => setActiveTab("visual")}
              >
                Visual System
              </button>
              <button
                type="button"
                className={activeTab === "design-md" ? "is-active" : ""}
                onClick={() => setActiveTab("design-md")}
              >
                design.md
              </button>
              <button
                type="button"
                className={activeTab === "references" ? "is-active" : ""}
                onClick={() => setActiveTab("references")}
              >
                References
              </button>
            </section>
          ) : null}

          {busy ? (
            <section className="workspace-modal__section design-system-modal__busy">
              <Loader2 size={14} />
              <p>{busyLabel ?? "Working on the design system..."}</p>
            </section>
          ) : null}

          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpg,image/jpeg,image/webp,image/svg+xml"
            multiple
            onChange={(event) => {
              const files = event.target.files ? [...event.target.files] : [];
              if (files.length === 0) {
                return;
              }
              void onAddImageReferences(files);
              event.currentTarget.value = "";
            }}
            hidden
          />

          <section className="workspace-modal__section design-system-modal__reference-tools">
            <div className="design-system-modal__reference-tools-header">
              <h3>References</h3>
              <p className="workspace-modal__hint">
                {hasReferences ? `${referenceItems.length || references.length} linked` : "No references linked yet"}
              </p>
            </div>
            <div className="design-system-modal__reference-row">
              <input
                value={figmaInput}
                onChange={(event) => setFigmaInput(event.target.value)}
                placeholder="Add Figma link..."
              />
              <button
                type="button"
                onClick={() => {
                  void onAddFigmaReference(figmaInput.trim());
                  setFigmaInput("");
                }}
                disabled={busy || figmaInput.trim().length === 0}
              >
                <Link2 size={12} />
                Add Figma
              </button>
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busy}>
                <ImagePlus size={12} />
                Add images
              </button>
            </div>
          </section>

          {!hasReferences && !hasDesignSystem ? (
            <section className="workspace-modal__section design-system-modal__empty">
              <div className="design-system-modal__empty-hero">
                <div className="design-system-modal__empty-icon">
                  <Palette size={20} />
                </div>
                <div>
                  <h3>No references yet</h3>
                  <p className="workspace-modal__hint">Add a Figma link or images to seed this project design system.</p>
                </div>
              </div>
              <div className="workspace-frame-actions design-system-modal__empty-actions">
                <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busy}>
                  <ImagePlus size={12} />
                  Add images
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onBootstrap("manual");
                  }}
                  disabled={busy}
                >
                  Create manually
                </button>
              </div>
            </section>
          ) : null}

          {!hasDesignSystem && hasReferences ? (
            <section className="workspace-modal__section design-system-modal__empty">
              <h3>No design system yet</h3>
              <p className="workspace-modal__hint">References are connected. Bootstrap from reference or start from a manual template.</p>
              <div className="design-system-modal__reference-list">
                {referenceItems.slice(0, 4).map((reference) => (
                  <span key={reference.id}>
                    {reference.previewLabel} • {reference.title}
                  </span>
                ))}
              </div>
              <div className="workspace-frame-actions">
                <button
                  type="button"
                  onClick={() => {
                    void onBootstrap("manual");
                  }}
                  disabled={busy}
                >
                  Create manually
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onBootstrap("reference");
                  }}
                  disabled={busy}
                >
                  Generate from reference
                </button>
              </div>
            </section>
          ) : null}

          {hasDesignSystem && activeTab === "visual" ? (
            <section className="workspace-modal__section design-system-visual" style={visualVars}>
              <header className="design-system-visual__header">
                <div>
                  <h3>Visual Board</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onRegenerateAllReferences();
                  }}
                  disabled={busy || !hasReferences}
                >
                  <Sparkles size={12} />
                  Regenerate from reference
                </button>
              </header>

              <div className="design-system-visual-layout">
                <aside className="design-system-doc-nav">
                  {visualSections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={activeVisualSection === section.id ? "is-active" : ""}
                      onClick={() => scrollToVisualSection(section.id)}
                    >
                      <strong>{section.label}</strong>
                    </button>
                  ))}
                </aside>

                <div ref={visualContentRef} className="design-system-visual-content ds-visual-board-content">
                  {visualSections.map((section) => (
                    <article key={section.id} className="design-system-story-card" data-ds-section-id={section.id}>
                      <header>
                        <h4>{section.label}</h4>
                      </header>
                      {section.blocks.length > 0 ? (
                        section.blocks.map((block, index) => <React.Fragment key={`${section.id}-${block.kind}-${index}`}>{renderBlock(block)}</React.Fragment>)
                      ) : (
                        <div className="ds-section-empty" />
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {hasDesignSystem && activeTab === "design-md" ? (
            <section className="workspace-modal__section design-system-markdown">
              <header className="design-system-markdown__header">
                <h3>DESIGN.md</h3>
                <button
                  type="button"
                  onClick={() => {
                    void onSaveMarkdown(draft);
                    setHasUnsavedChanges(false);
                  }}
                  disabled={busy || !hasUnsavedChanges}
                >
                  <Save size={12} />
                  Save
                </button>
              </header>

              <div className="design-system-markdown__meta">
                <span>Source: {designSystem?.sourceType ?? "manual"}</span>
                <span>Status: {designSystem?.status ?? "draft"}</span>
                <span>Updated: {designSystem?.updatedAt ? new Date(designSystem.updatedAt).toLocaleString() : "not saved yet"}</span>
              </div>

              <textarea
                className="design-system-markdown__editor"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setHasUnsavedChanges(true);
                }}
                spellCheck={false}
              />

              {warnings.length > 0 ? (
                <div className="design-system-warnings">
                  {warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {activeTab === "references" ? (
            <section className="workspace-modal__section design-system-references">
              <header className="design-system-markdown__header">
                <h3>Reference Sources</h3>
                <div className="design-system-reference-actions">
                  <span className="workspace-modal__hint">{referenceItems.length} references</span>
                  <button
                    type="button"
                    disabled={busy || referenceItems.length === 0}
                    onClick={() => {
                      void onRegenerateAllReferences();
                    }}
                  >
                    <RefreshCw size={12} />
                    Regenerate all
                  </button>
                </div>
              </header>

              {referenceItems.length > 0 ? (
                <div className="design-system-reference-tiles">
                  {referenceItems.map((item) => {
                    const isRegenerating = busy && regeneratingReferenceId === item.id;
                    return (
                      <article key={item.id} className="design-system-reference-tile">
                        <div className={`design-system-reference-tile__preview is-${item.sourceType}`}>
                          {item.sourceType === "figma-reference" ? <Link2 size={14} /> : <ImagePlus size={14} />}
                          <span>{item.previewLabel}</span>
                        </div>
                        <div className="design-system-reference-tile__body">
                          <p className="design-system-reference-card__title">{item.title}</p>
                          <p className="design-system-reference-card__subtitle">{item.subtitle}</p>
                          {item.referenceUrl ? (
                            <a href={item.referenceUrl} target="_blank" rel="noreferrer">
                              Open source
                            </a>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={busy || (item.sourceType === "figma-reference" && !item.referenceSourceId)}
                          onClick={() => {
                            void onRegenerateFromReference(item);
                          }}
                        >
                          {isRegenerating ? (
                            <>
                              <Loader2 size={11} />
                              Regenerating...
                            </>
                          ) : (
                            "Regenerate DS"
                          )}
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="workspace-modal__hint">No reference frames found yet. Attach images or a Figma link and generate a reference first.</p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
