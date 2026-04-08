import type {
  DesignSystemQualityReport,
  DesignSystemVisualBlock,
  DesignSystemVisualItem,
  DesignSystemVisualSection,
  ReferenceStyleContext,
  StyleProfile
} from "@designer/shared";
import { buildStyleProfileFromStyleContext } from "./designSystemProfile.js";
import { buildDesignSystemVisualBoard } from "./designSystemVisualBoard.js";

type FrameArtifacts = {
  frameName: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
};

type BuildDesignSystemArtifactsInput = {
  styleContext: ReferenceStyleContext;
  frameName: string;
  scope: "frame" | "page";
  sourceLabel?: string;
  sourceDescription?: string;
  styleProfile?: StyleProfile;
  qualityReport?: DesignSystemQualityReport;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function classForState(state: DesignSystemVisualItem["state"]) {
  if (state === "active") {
    return "is-active";
  }
  if (state === "success") {
    return "is-success";
  }
  if (state === "error") {
    return "is-error";
  }
  if (state === "disabled") {
    return "is-disabled";
  }
  if (state === "focus") {
    return "is-focus";
  }
  return "";
}

function styleAttr(item: DesignSystemVisualItem) {
  const styles: string[] = [];
  if (item.fontFamily) {
    styles.push(`font-family:${item.fontFamily}`);
  }
  if (typeof item.sizePx === "number" && Number.isFinite(item.sizePx)) {
    styles.push(`font-size:${Math.max(8, Math.min(48, Math.round(item.sizePx)))}px`);
  }
  if (typeof item.weight === "number" && Number.isFinite(item.weight)) {
    styles.push(`font-weight:${Math.max(300, Math.min(900, Math.round(item.weight)))}`);
  }
  return styles.length > 0 ? ` style="${escapeHtml(styles.join(";"))}"` : "";
}

function renderRulesHtml(items: DesignSystemVisualItem[]) {
  return `<div class="ds-rule-grid">${items
    .map(
      (item) =>
        `<article class="ds-rule-chip"><span>${escapeHtml(item.label)}</span>${
          item.value ? `<b>${escapeHtml(item.value)}</b>` : ""
        }</article>`
    )
    .join("")}</div>`;
}

function renderBlockHtml(block: DesignSystemVisualBlock) {
  if (block.kind === "swatches") {
    return `<div class="ds-swatch-grid">${block.items
      .map(
        (item) =>
          `<article class="ds-swatch"><span class="ds-swatch__color" style="background:${escapeHtml(
            item.hex ?? "#d7dce4"
          )}"></span><p>${escapeHtml(item.label)}</p>${item.hex ? `<code>${escapeHtml(item.hex)}</code>` : ""}</article>`
      )
      .join("")}</div>`;
  }

  if (block.kind === "chips") {
    return `<div class="ds-chip-row">${block.items
      .map((item) => `<span class="ds-chip">${escapeHtml(item.label)}</span>`)
      .join("")}</div>`;
  }

  if (block.kind === "type-samples") {
    return `<div class="ds-type-grid">${block.items
      .map(
        (item) =>
          `<article class="ds-type-card"><p class="ds-type-card__label">${escapeHtml(item.label)}</p><p class="ds-type-card__sample"${styleAttr(
            item
          )}>${escapeHtml(item.value ?? item.label)}</p></article>`
      )
      .join("")}</div>`;
  }

  if (block.kind === "spacing-scale") {
    return `<div class="ds-spacing-row">${block.items
      .map((item) => {
        const width = Math.max(4, Math.min(64, Math.round(item.sizePx ?? 8)));
        return `<span class="ds-spacing-chip"><i style="width:${width}px"></i>${escapeHtml(item.label)}</span>`;
      })
      .join("")}</div>`;
  }

  if (block.kind === "component-states") {
    return `<div class="ds-component-row">${block.items
      .map((item) => {
        const stateClass = classForState(item.state);
        return `<span class="ds-component-pill ${stateClass}">${escapeHtml(item.label)}</span>`;
      })
      .join("")}</div>`;
  }

  if (block.kind === "navigation-items") {
    return `<nav class="ds-nav-row">${block.items
      .map((item) => `<a class="${classForState(item.state)}">${escapeHtml(item.label)}</a>`)
      .join("")}</nav>`;
  }

  if (block.kind === "metric-cards") {
    return `<div class="ds-metric-grid">${block.items
      .map(
        (item) =>
          `<article class="ds-metric-card"><p>${escapeHtml(item.label)}</p>${
            item.value ? `<strong>${escapeHtml(item.value)}</strong>` : ""
          }</article>`
      )
      .join("")}</div>`;
  }

  if (block.kind === "icons") {
    return `<div class="ds-icon-row">${block.items
      .map((item) => `<span class="ds-icon-dot">${escapeHtml(item.label.slice(0, 1).toUpperCase())}</span>`)
      .join("")}</div>`;
  }

  return renderRulesHtml(block.items);
}

function renderBlockJsx(block: DesignSystemVisualBlock) {
  if (block.kind === "swatches") {
    return `<div className="ds-swatch-grid">${block.items
      .map(
        (item) =>
          `<article className="ds-swatch"><span className="ds-swatch__color" style={{ background: ${JSON.stringify(
            item.hex ?? "#d7dce4"
          )} }} /><p>${item.label}</p>${item.hex ? `<code>${item.hex}</code>` : ""}</article>`
      )
      .join("\n")}</div>`;
  }

  if (block.kind === "chips") {
    return `<div className="ds-chip-row">${block.items
      .map((item) => `<span className="ds-chip">${item.label}</span>`)
      .join("\n")}</div>`;
  }

  if (block.kind === "type-samples") {
    return `<div className="ds-type-grid">${block.items
      .map(
        (item) =>
          `<article className="ds-type-card"><p className="ds-type-card__label">${item.label}</p><p className="ds-type-card__sample" style={{ fontFamily: ${JSON.stringify(
            item.fontFamily ?? "inherit"
          )}, fontSize: ${Math.max(8, Math.min(48, Math.round(item.sizePx ?? 14)))}, fontWeight: ${Math.max(
            300,
            Math.min(900, Math.round(item.weight ?? 500))
          )} }}>${item.value ?? item.label}</p></article>`
      )
      .join("\n")}</div>`;
  }

  if (block.kind === "spacing-scale") {
    return `<div className="ds-spacing-row">${block.items
      .map((item) => {
        const width = Math.max(4, Math.min(64, Math.round(item.sizePx ?? 8)));
        return `<span className="ds-spacing-chip"><i style={{ width: ${width} }} />${item.label}</span>`;
      })
      .join("\n")}</div>`;
  }

  if (block.kind === "component-states") {
    return `<div className="ds-component-row">${block.items
      .map((item) => `<span className={${JSON.stringify(`ds-component-pill ${classForState(item.state)}`)}}>${item.label}</span>`)
      .join("\n")}</div>`;
  }

  if (block.kind === "navigation-items") {
    return `<nav className="ds-nav-row">${block.items
      .map((item) => `<a className={${JSON.stringify(classForState(item.state))}}>${item.label}</a>`)
      .join("\n")}</nav>`;
  }

  if (block.kind === "metric-cards") {
    return `<div className="ds-metric-grid">${block.items
      .map(
        (item) =>
          `<article className="ds-metric-card"><p>${item.label}</p>${item.value ? `<strong>${item.value}</strong>` : ""}</article>`
      )
      .join("\n")}</div>`;
  }

  if (block.kind === "icons") {
    return `<div className="ds-icon-row">${block.items
      .map((item) => `<span className="ds-icon-dot">${item.label.slice(0, 1).toUpperCase()}</span>`)
      .join("\n")}</div>`;
  }

  return `<div className="ds-rule-grid">${block.items
    .map((item) => `<article className="ds-rule-chip"><span>${item.label}</span>${item.value ? `<b>${item.value}</b>` : ""}</article>`)
    .join("\n")}</div>`;
}

function renderSectionHtml(section: DesignSystemVisualSection) {
  if (section.blocks.length === 0) {
    return `<section class="ds-section" data-section-id="${escapeHtml(section.id)}"><h2>${escapeHtml(
      section.label
    )}</h2><div class="ds-section-empty"></div></section>`;
  }

  return `<section class="ds-section" data-section-id="${escapeHtml(section.id)}"><h2>${escapeHtml(
    section.label
  )}</h2>${section.blocks.map((block) => renderBlockHtml(block)).join("")}</section>`;
}

function renderSectionJsx(section: DesignSystemVisualSection) {
  if (section.blocks.length === 0) {
    return `<section className="ds-section" data-section-id=${JSON.stringify(section.id)}><h2>${JSON.stringify(
      section.label
    )}</h2><div className="ds-section-empty" /></section>`;
  }

  return `<section className="ds-section" data-section-id=${JSON.stringify(section.id)}><h2>${JSON.stringify(
    section.label
  )}</h2>${section.blocks.map((block) => renderBlockJsx(block)).join("\n")}</section>`;
}

export function buildDesignSystemComponentsArtifacts(args: BuildDesignSystemArtifactsInput): FrameArtifacts {
  const sourceLabel = args.sourceLabel ?? "Reference";

  const derived = buildStyleProfileFromStyleContext({
    styleContext: args.styleContext,
    sourceType: args.styleProfile?.sourceType ?? (args.styleContext.source === "figma-public-link" ? "figma-reference" : "manual"),
    componentRecipes: args.styleProfile?.componentRecipes ?? args.styleContext.componentRecipes,
    extractionEvidence: args.styleProfile?.extractionEvidence ?? args.styleContext.extractionEvidence,
    explicitQualityScore: args.qualityReport?.fidelityScore ?? args.styleContext.qualityReport?.fidelityScore ?? null
  });

  const styleProfile = args.styleProfile ?? derived.styleProfile;
  const qualityReport = args.qualityReport ?? derived.qualityReport;
  const typography = styleProfile.tokens.typography;

  const board = buildDesignSystemVisualBoard({
    styleProfile,
    qualityReport,
    overview: args.frameName,
    colors: styleProfile.tokens.colors,
    typography,
    components: [],
    dos: [],
    donts: []
  });

  const primary = styleProfile.tokens.colors[0]?.hex ?? "#6f7480";
  const secondary = styleProfile.tokens.colors[1]?.hex ?? "#8a909d";
  const accent = styleProfile.tokens.colors[2]?.hex ?? "#9b8f82";
  const surface = styleProfile.tokens.colors.find((token) => token.name.toLowerCase().includes("surface"))?.hex ?? "#f3f4f6";
  const text = styleProfile.tokens.colors.find((token) => token.name.toLowerCase().includes("text"))?.hex ?? "#1f2430";
  const radius = Math.max(8, styleProfile.tokens.radiusScale[0] ?? 12);

  const exportHtml = `
    <div class="ds-kit">
      <header class="ds-header">
        <p class="ds-kicker">${escapeHtml(sourceLabel)} • ${escapeHtml(args.scope.toUpperCase())}</p>
        <h1>${escapeHtml(args.frameName)}</h1>
      </header>
      ${board.sections.map((section) => renderSectionHtml(section)).join("\n")}
    </div>
  `.trim();

  const cssCode = `
    :root {
      --ds-primary: ${primary};
      --ds-secondary: ${secondary};
      --ds-accent: ${accent};
      --ds-surface: ${surface};
      --ds-text: ${text};
      --ds-radius: ${radius}px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 16px;
      background: color-mix(in srgb, var(--ds-surface) 90%, white);
      color: var(--ds-text);
      font-family: ${typography.bodyFont};
    }

    .ds-kit {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 20%, white);
      border-radius: calc(var(--ds-radius) + 8px);
      background: linear-gradient(165deg, #ffffff 0%, color-mix(in srgb, var(--ds-surface) 94%, white) 100%);
      padding: 12px;
      display: grid;
      gap: 10px;
    }

    .ds-header {
      display: grid;
      gap: 4px;
    }

    .ds-kicker {
      margin: 0;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--ds-primary);
    }

    .ds-header h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.1;
      font-family: ${typography.headlineFont};
    }

    .ds-section {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 16%, white);
      border-radius: var(--ds-radius);
      background: rgba(255, 255, 255, 0.92);
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .ds-section h2 {
      margin: 0;
      font-size: 13px;
      font-family: ${typography.headlineFont};
    }

    .ds-section-empty {
      min-height: 18px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ds-secondary) 10%, white);
    }

    .ds-swatch-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
    }

    .ds-swatch {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 20%, white);
      border-radius: 10px;
      padding: 6px;
      background: #fff;
      display: grid;
      gap: 4px;
    }

    .ds-swatch__color {
      display: block;
      height: 28px;
      border-radius: 7px;
      border: 1px solid rgba(15, 23, 42, 0.1);
    }

    .ds-swatch p,
    .ds-swatch code {
      margin: 0;
      font-size: 10px;
    }

    .ds-chip-row,
    .ds-component-row,
    .ds-spacing-row,
    .ds-icon-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }

    .ds-chip,
    .ds-component-pill,
    .ds-spacing-chip,
    .ds-rule-chip {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 22%, white);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 600;
      color: color-mix(in srgb, var(--ds-text) 90%, white);
    }

    .ds-component-pill.is-active,
    .ds-nav-row a.is-active {
      background: color-mix(in srgb, var(--ds-primary) 16%, white);
      border-color: color-mix(in srgb, var(--ds-primary) 34%, white);
      color: color-mix(in srgb, var(--ds-primary) 70%, black);
    }

    .ds-component-pill.is-success {
      background: color-mix(in srgb, #1f9d55 14%, white);
      border-color: color-mix(in srgb, #1f9d55 30%, white);
      color: color-mix(in srgb, #1f9d55 82%, black);
    }

    .ds-component-pill.is-error {
      background: color-mix(in srgb, #d14343 14%, white);
      border-color: color-mix(in srgb, #d14343 28%, white);
      color: color-mix(in srgb, #d14343 80%, black);
    }

    .ds-component-pill.is-disabled {
      opacity: 0.5;
    }

    .ds-component-pill.is-focus {
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--ds-primary) 18%, white);
    }

    .ds-type-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
    }

    .ds-type-card {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 16%, white);
      border-radius: 10px;
      padding: 8px;
      background: #fff;
      display: grid;
      gap: 4px;
    }

    .ds-type-card__label,
    .ds-type-card__sample {
      margin: 0;
    }

    .ds-type-card__label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: color-mix(in srgb, var(--ds-text) 70%, white);
    }

    .ds-rule-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 6px;
    }

    .ds-rule-chip {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-radius: 10px;
    }

    .ds-rule-chip b {
      font-size: 10px;
    }

    .ds-spacing-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .ds-spacing-chip i {
      display: inline-block;
      height: 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ds-accent) 68%, white);
    }

    .ds-nav-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .ds-nav-row a {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 22%, white);
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 10px;
      text-decoration: none;
      color: color-mix(in srgb, var(--ds-text) 82%, white);
      background: rgba(255, 255, 255, 0.92);
    }

    .ds-metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
    }

    .ds-metric-card {
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 16%, white);
      border-radius: 10px;
      padding: 8px;
      background: color-mix(in srgb, var(--ds-surface) 72%, white);
      display: grid;
      gap: 4px;
    }

    .ds-metric-card p,
    .ds-metric-card strong {
      margin: 0;
    }

    .ds-metric-card p {
      font-size: 10px;
      color: color-mix(in srgb, var(--ds-text) 70%, white);
    }

    .ds-metric-card strong {
      font-size: 18px;
      font-family: ${typography.headlineFont};
    }

    .ds-icon-dot {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      border: 1px solid color-mix(in srgb, var(--ds-secondary) 24%, white);
      background: rgba(255, 255, 255, 0.96);
      font-size: 11px;
      font-weight: 700;
      color: color-mix(in srgb, var(--ds-text) 80%, white);
    }
  `.trim();

  const sourceCode = `
    function DesignSystemComponentsFrame() {
      return (
        <div className="ds-kit">
          <header className="ds-header">
            <p className="ds-kicker">${JSON.stringify(`${sourceLabel} • ${args.scope.toUpperCase()}`)}</p>
            <h1>${JSON.stringify(args.frameName)}</h1>
          </header>
          ${board.sections.map((section) => renderSectionJsx(section)).join("\n")}
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<DesignSystemComponentsFrame />);
  `.trim();

  return {
    frameName: args.frameName,
    sourceCode,
    cssCode,
    exportHtml
  };
}
