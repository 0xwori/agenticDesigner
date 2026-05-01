import type { DeckSlideCount, FrameVersion, ReferenceStyleContext } from "@designer/shared";

export type DeckSlideLayout = "title" | "section" | "content" | "comparison" | "quote" | "closing";
export type DeckSlideVisualType =
  | "illustration"
  | "diagram"
  | "timeline"
  | "metrics"
  | "image"
  | "icons"
  | "chart"
  | "process"
  | "none";

export interface DeckSpec {
  specVersion: 1;
  title: string;
  subtitle?: string;
  audience?: string;
  theme: {
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    primary: string;
    secondary: string;
    accent: string;
    headingFont: string;
    bodyFont: string;
  };
  slides: DeckSlideSpec[];
}

export interface DeckSlideVisualSpec {
  type: DeckSlideVisualType;
  title?: string;
  items: string[];
  assetId?: string;
  caption?: string;
}

export interface DeckSlideSpec {
  id: string;
  blockId: string;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  body: string[];
  callout?: string;
  speakerNotes?: string;
  layout: DeckSlideLayout;
  visual: DeckSlideVisualSpec;
}

type FrameArtifacts = {
  frameName: string;
  sourceCode: string;
  cssCode: string;
  exportHtml: string;
};

const VALID_LAYOUTS: DeckSlideLayout[] = ["title", "section", "content", "comparison", "quote", "closing"];
const VALID_VISUALS: DeckSlideVisualType[] = [
  "illustration",
  "diagram",
  "timeline",
  "metrics",
  "image",
  "icons",
  "chart",
  "process",
  "none"
];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, 6);
}

function slug(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return normalized || fallback;
}

function normalizeHex(value: unknown, fallback: string) {
  const raw = text(value).toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
  }
  return fallback;
}

function defaultVisualType(index: number): DeckSlideVisualType {
  return index === 0
    ? "illustration"
    : index % 4 === 0
      ? "chart"
      : index % 3 === 0
        ? "timeline"
        : index % 2 === 0
          ? "process"
          : "diagram";
}

function normalizeVisual(value: unknown, fallbackItems: string[], index: number, allowNone = false): DeckSlideVisualSpec {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawType = text(record.type);
  const requestedType = VALID_VISUALS.includes(rawType as DeckSlideVisualType)
    ? rawType as DeckSlideVisualType
    : "";
  const type = requestedType && requestedType !== "none"
    ? requestedType
    : allowNone
      ? "none"
      : defaultVisualType(index);
  return {
    type,
    title: text(record.title, type === "none" ? "" : "Visual summary"),
    items: list(record.items).length > 0 ? list(record.items).slice(0, 5) : fallbackItems.slice(0, 4),
    assetId: text(record.assetId).startsWith("asset://") ? text(record.assetId) : "",
    caption: text(record.caption)
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function visualItems(visual: DeckSlideVisualSpec, fallbackTitle: string) {
  const items = visual.items
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, 5);
  return items.length > 0 ? items : [fallbackTitle, visual.title || "Signal", visual.caption || "Action"].filter(Boolean).slice(0, 4);
}

function renderVisualMetaHtml(visual: DeckSlideVisualSpec) {
  if (!visual.title && !visual.caption) {
    return "";
  }
  return `<div class="deck-visual__meta">${visual.title ? `<strong>${escapeHtml(visual.title)}</strong>` : ""}${visual.caption ? `<small>${escapeHtml(visual.caption)}</small>` : ""}</div>`;
}

function renderDeckIllustrationSvg(slide: DeckSlideSpec, index: number) {
  const gradientId = `deck-illustration-gradient-${index + 1}`;
  const glowId = `deck-illustration-glow-${index + 1}`;
  return `
    <svg class="deck-illustration-svg" viewBox="0 0 420 250" role="img" aria-label="${escapeHtml(slide.visual.title || slide.title)}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--deck-primary)" />
          <stop offset="100%" stop-color="var(--deck-accent)" />
        </linearGradient>
        <filter id="${glowId}" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="12" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect class="deck-illustration-bg" x="18" y="26" width="384" height="198" rx="18" />
      <path class="deck-illustration-path" d="M72 168 C118 102 158 192 206 122 S312 86 352 144" />
      <g class="deck-illustration-window deck-illustration-window--main">
        <rect x="78" y="68" width="158" height="112" rx="14" fill="url(#${gradientId})" filter="url(#${glowId})" />
        <rect x="98" y="94" width="92" height="12" rx="6" />
        <rect x="98" y="120" width="116" height="10" rx="5" />
        <rect x="98" y="144" width="66" height="10" rx="5" />
      </g>
      <g class="deck-illustration-window deck-illustration-window--side">
        <rect x="232" y="88" width="110" height="82" rx="14" />
        <circle cx="258" cy="116" r="14" />
        <rect x="282" y="106" width="36" height="9" rx="5" />
        <rect x="282" y="126" width="46" height="9" rx="5" />
      </g>
      <circle class="deck-illustration-orb deck-illustration-orb--one" cx="336" cy="66" r="18" />
      <circle class="deck-illustration-orb deck-illustration-orb--two" cx="72" cy="202" r="13" />
      <circle class="deck-illustration-orb deck-illustration-orb--three" cx="354" cy="190" r="9" />
    </svg>
  `;
}

export function normalizeDeckSpec(raw: unknown, input: {
  prompt: string;
  slideCount: DeckSlideCount;
  styleContext: ReferenceStyleContext;
}): DeckSpec {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawTheme = record.theme && typeof record.theme === "object" ? record.theme as Record<string, unknown> : {};
  const title = text(record.title, text(record.frameName, input.prompt || "Generated Deck"));
  const slidesRaw = Array.isArray(record.slides) ? record.slides : [];
  const fallbackLayouts: DeckSlideLayout[] = ["title", "content", "content", "comparison", "closing"];

  const slides: DeckSlideSpec[] = [];
  for (let index = 0; index < input.slideCount; index += 1) {
    const slideRaw = slidesRaw[index] && typeof slidesRaw[index] === "object"
      ? slidesRaw[index] as Record<string, unknown>
      : {};
    const slideTitle = text(slideRaw.title, index === 0 ? title : `${title} ${index + 1}`);
    const layoutValue = text(slideRaw.layout);
    const layout = VALID_LAYOUTS.includes(layoutValue as DeckSlideLayout)
      ? layoutValue as DeckSlideLayout
      : index === 0
        ? "title"
        : index === input.slideCount - 1
          ? "closing"
          : fallbackLayouts[index % fallbackLayouts.length] ?? "content";
    const blockId = slug(text(slideRaw.blockId, text(slideRaw.id, `slide-${index + 1}`)), `slide-${index + 1}`);
    const body = list(slideRaw.body);
    const finalBody = body.length > 0 ? body : [`Key point for ${slideTitle}`, "Supporting detail", "Recommended next step"];
    slides.push({
      id: text(slideRaw.id, `slide-${index + 1}`),
      blockId,
      title: slideTitle,
      eyebrow: text(slideRaw.eyebrow, index === 0 ? "Presentation" : `Slide ${index + 1}`),
      subtitle: text(slideRaw.subtitle),
      body: finalBody,
      callout: text(slideRaw.callout),
      speakerNotes: text(slideRaw.speakerNotes),
      layout,
      visual: normalizeVisual(slideRaw.visual, finalBody, index, layout === "closing")
    });
  }

  const palette = input.styleContext.palette;
  return {
    specVersion: 1,
    title,
    subtitle: text(record.subtitle),
    audience: text(record.audience, "Presentation audience"),
    theme: {
      background: normalizeHex(rawTheme.background, palette.background || palette.surface || "#f8fafc"),
      surface: normalizeHex(rawTheme.surface, palette.surface || "#ffffff"),
      text: normalizeHex(rawTheme.text, palette.text || "#172033"),
      mutedText: normalizeHex(rawTheme.mutedText, palette.secondary || "#64748b"),
      primary: normalizeHex(rawTheme.primary, palette.primary || "#2f7ef7"),
      secondary: normalizeHex(rawTheme.secondary, palette.secondary || "#64748b"),
      accent: normalizeHex(rawTheme.accent, palette.accent || "#1f9b62"),
      headingFont: text(rawTheme.headingFont, input.styleContext.typography.headingFamily || "Sora, ui-sans-serif, system-ui"),
      bodyFont: text(rawTheme.bodyFont, input.styleContext.typography.bodyFamily || "Manrope, ui-sans-serif, system-ui")
    },
    slides
  };
}

function renderSlideHtml(slide: DeckSlideSpec, index: number) {
  const body = slide.body
    .map((item, itemIndex) => `<li data-designer-block="${escapeHtml(slide.blockId)}-point-${itemIndex + 1}" data-designer-block-label="Slide ${index + 1} point ${itemIndex + 1}">${escapeHtml(item)}</li>`)
    .join("");
  return `
    <section class="deck-slide deck-slide--${escapeHtml(slide.layout)}" data-designer-block="${escapeHtml(slide.blockId)}" data-designer-block-label="Slide ${index + 1}: ${escapeHtml(slide.title)}">
      <div class="deck-slide__kicker">${escapeHtml(slide.eyebrow || `Slide ${index + 1}`)}</div>
      <h2 data-designer-block="${escapeHtml(slide.blockId)}-title" data-designer-block-label="Slide ${index + 1} title">${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="deck-slide__subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
      <div class="deck-slide__body">
        <ul>${body}</ul>
        ${renderSlideVisualHtml(slide, index)}
      </div>
      ${slide.callout ? `<aside data-designer-block="${escapeHtml(slide.blockId)}-callout" data-designer-block-label="Slide ${index + 1} callout">${escapeHtml(slide.callout)}</aside>` : ""}
      <span class="deck-slide__number">${index + 1}</span>
    </section>
  `;
}

function renderSlideVisualHtml(slide: DeckSlideSpec, index: number) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") {
    return "";
  }
  const block = `${slide.blockId}-visual`;
  const meta = renderVisualMetaHtml(visual);
  const items = visualItems(visual, slide.title);
  if (visual.type === "image" && visual.assetId) {
    return `<figure class="deck-visual deck-visual--image" data-visual-artifact="image" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} visual"><img src="${escapeHtml(visual.assetId)}" alt="${escapeHtml(visual.caption || visual.title || slide.title)}" />${visual.caption ? `<figcaption>${escapeHtml(visual.caption)}</figcaption>` : ""}</figure>`;
  }
  if (visual.type === "illustration") {
    return `<div class="deck-visual deck-visual--illustration" data-visual-artifact="illustration" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} illustration">${renderDeckIllustrationSvg(slide, index)}${meta}<div class="deck-visual__labels">${items.slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div>`;
  }
  if (visual.type === "chart") {
    return `<div class="deck-visual deck-visual--chart" data-visual-artifact="chart" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} chart">${meta}${items.map((item, itemIndex) => `<span style="--bar:${44 + itemIndex * 10}%"><i></i><b>${escapeHtml(item)}</b></span>`).join("")}</div>`;
  }
  if (visual.type === "timeline") {
    return `<div class="deck-visual deck-visual--timeline" data-visual-artifact="timeline" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} timeline">${meta}<div class="deck-visual__line">${items.map((item, itemIndex) => `<span style="--dot:${itemIndex + 1}"><i></i><b>${escapeHtml(item)}</b></span>`).join("")}</div></div>`;
  }
  if (visual.type === "metrics") {
    return `<div class="deck-visual deck-visual--metrics" data-visual-artifact="metrics" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} metrics">${meta}${items.slice(0, 4).map((item, itemIndex) => `<span><i>${String(itemIndex + 1).padStart(2, "0")}</i><b>${escapeHtml(item)}</b></span>`).join("")}</div>`;
  }
  if (visual.type === "process") {
    return `<div class="deck-visual deck-visual--process" data-visual-artifact="process" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} process">${meta}<div class="deck-visual__flow">${items.slice(0, 4).map((item, itemIndex) => `<span><i>${itemIndex + 1}</i><b>${escapeHtml(item)}</b></span>`).join("")}</div></div>`;
  }
  if (visual.type === "diagram") {
    return `<div class="deck-visual deck-visual--diagram" data-visual-artifact="diagram" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} diagram">${meta}<div class="deck-visual__diagram"><strong>${escapeHtml(visual.title || slide.title)}</strong>${items.slice(0, 4).map((item, itemIndex) => `<span><i>${itemIndex + 1}</i><b>${escapeHtml(item)}</b></span>`).join("")}</div></div>`;
  }
  return `<div class="deck-visual deck-visual--icons" data-visual-artifact="icons" data-designer-block="${escapeHtml(block)}" data-designer-block-label="Slide ${index + 1} icon system">${meta}<div class="deck-visual__icons">${items.map((item, itemIndex) => `<span><i>${escapeHtml(item.slice(0, 1).toUpperCase() || String(itemIndex + 1))}</i><b>${escapeHtml(item)}</b></span>`).join("")}</div></div>`;
}

export function buildDeckPreviewArtifacts(deckSpec: DeckSpec): FrameArtifacts {
  const safeSpec = JSON.stringify(deckSpec).replaceAll("</script>", "<\\/script>");
  const cssCode = `
:root {
  --deck-bg: ${deckSpec.theme.background};
  --deck-surface: ${deckSpec.theme.surface};
  --deck-text: ${deckSpec.theme.text};
  --deck-muted: ${deckSpec.theme.mutedText};
  --deck-primary: ${deckSpec.theme.primary};
  --deck-secondary: ${deckSpec.theme.secondary};
  --deck-accent: ${deckSpec.theme.accent};
  --deck-heading: ${deckSpec.theme.headingFont};
  --deck-body: ${deckSpec.theme.bodyFont};
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--deck-bg); color: var(--deck-text); font-family: var(--deck-body); }
.deck-preview { min-height: 100vh; padding: 32px; display: grid; gap: 28px; background: linear-gradient(135deg, color-mix(in srgb, var(--deck-primary) 9%, var(--deck-bg)), var(--deck-bg)); }
.deck-preview__header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; max-width: 1280px; width: 100%; margin: 0 auto; }
.deck-preview__header h1 { margin: 0; font-family: var(--deck-heading); font-size: 28px; line-height: 1.1; }
.deck-preview__header p { margin: 5px 0 0; color: var(--deck-muted); font-size: 13px; }
.deck-preview__count { font-size: 12px; font-weight: 700; color: var(--deck-primary); }
.deck-slide { width: min(1280px, calc(100vw - 64px)); aspect-ratio: 16 / 9; margin: 0 auto; position: relative; overflow: hidden; border-radius: 18px; background: var(--deck-surface); border: 1px solid color-mix(in srgb, var(--deck-primary) 18%, transparent); box-shadow: 0 18px 40px rgba(15, 23, 42, 0.10); padding: 64px 72px; display: grid; align-content: center; gap: 20px; }
.deck-slide::before { content: ""; position: absolute; inset: 0; background: linear-gradient(120deg, color-mix(in srgb, var(--deck-primary) 14%, transparent), transparent 44%), radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--deck-accent) 18%, transparent), transparent 24%); pointer-events: none; }
.deck-slide > * { position: relative; z-index: 1; }
.deck-slide__kicker { width: fit-content; border-radius: 999px; padding: 7px 12px; background: color-mix(in srgb, var(--deck-primary) 12%, var(--deck-surface)); color: var(--deck-primary); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0; }
.deck-slide h2 { margin: 0; max-width: 820px; font-family: var(--deck-heading); font-size: 52px; line-height: 1.02; letter-spacing: 0; }
.deck-slide__subtitle { margin: 0; max-width: 760px; color: var(--deck-muted); font-size: 20px; line-height: 1.45; }
.deck-slide__body { display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(280px, 0.72fr); gap: 28px; align-items: start; max-width: 1030px; }
.deck-slide ul { margin: 4px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; max-width: 760px; }
.deck-slide li { padding: 13px 16px; border-radius: 8px; background: color-mix(in srgb, var(--deck-primary) 7%, var(--deck-surface)); border: 1px solid color-mix(in srgb, var(--deck-primary) 12%, transparent); font-size: 18px; line-height: 1.35; }
@keyframes deck-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes deck-path { from { stroke-dashoffset: 540; } to { stroke-dashoffset: 0; } }
@keyframes deck-pulse { 0%, 100% { opacity: 0.35; transform: scale(1); } 50% { opacity: 0.78; transform: scale(1.04); } }
@keyframes deck-bar-grow { from { transform: scaleX(0.2); } to { transform: scaleX(1); } }
.deck-visual { min-height: 240px; position: relative; overflow: hidden; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--deck-primary) 18%, transparent); background: linear-gradient(145deg, color-mix(in srgb, var(--deck-surface) 84%, var(--deck-primary)), color-mix(in srgb, var(--deck-surface) 88%, var(--deck-accent))); padding: 18px; display: grid; gap: 12px; align-content: center; animation: deck-float 8s ease-in-out infinite; }
.deck-visual::after { content: ""; position: absolute; width: 180px; height: 180px; right: -70px; top: -70px; border-radius: 50%; background: color-mix(in srgb, var(--deck-accent) 22%, transparent); animation: deck-pulse 7s ease-in-out infinite; pointer-events: none; }
.deck-visual > * { position: relative; z-index: 1; }
.deck-visual__meta { display: grid; gap: 4px; }
.deck-visual__meta strong { color: var(--deck-text); font-family: var(--deck-heading); font-size: 16px; line-height: 1.1; }
.deck-visual__meta small { color: var(--deck-muted); font-size: 12px; line-height: 1.3; }
.deck-visual span { display: flex; align-items: center; gap: 10px; min-height: 42px; border-radius: 8px; padding: 10px 12px; background: color-mix(in srgb, var(--deck-surface) 82%, var(--deck-primary)); font-size: 14px; font-weight: 700; }
.deck-visual i { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--deck-primary); color: #ffffff; font-style: normal; font-size: 12px; }
.deck-visual__labels { display: flex; flex-wrap: wrap; gap: 8px; }
.deck-visual__labels span { min-height: 0; padding: 8px 10px; }
.deck-illustration-svg { width: 100%; min-height: 160px; display: block; }
.deck-illustration-bg { fill: color-mix(in srgb, var(--deck-surface) 78%, var(--deck-primary)); }
.deck-illustration-path { fill: none; stroke: var(--deck-accent); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 540; animation: deck-path 5s ease-out both; }
.deck-illustration-window { animation: deck-float 9s ease-in-out infinite; transform-origin: center; }
.deck-illustration-window--side { animation-delay: -2s; }
.deck-illustration-window--main rect:not(:first-child), .deck-illustration-window--side rect:not(:first-child) { fill: color-mix(in srgb, var(--deck-surface) 72%, #ffffff); }
.deck-illustration-window--side rect:first-child { fill: color-mix(in srgb, var(--deck-secondary) 20%, var(--deck-surface)); }
.deck-illustration-window--side circle { fill: var(--deck-accent); }
.deck-illustration-orb { fill: color-mix(in srgb, var(--deck-primary) 62%, var(--deck-surface)); animation: deck-pulse 6s ease-in-out infinite; transform-origin: center; }
.deck-illustration-orb--two { animation-delay: -1.4s; }
.deck-illustration-orb--three { animation-delay: -2.6s; }
.deck-visual--chart span { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5px; background: transparent; padding: 0; }
.deck-visual--chart i { width: var(--bar); max-width: 100%; height: 16px; border-radius: 999px; background: linear-gradient(90deg, var(--deck-primary), var(--deck-accent)); transform-origin: left center; animation: deck-bar-grow 900ms ease-out both; }
.deck-visual--chart b { color: var(--deck-text); font-size: 12px; }
.deck-visual__line { display: grid; gap: 8px; }
.deck-visual--timeline span { min-height: 36px; background: transparent; border-left: 3px solid var(--deck-primary); border-radius: 0; padding-left: 16px; }
.deck-visual--timeline i { width: 14px; height: 14px; background: var(--deck-accent); animation: deck-pulse 5s ease-in-out infinite; }
.deck-visual--metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: stretch; }
.deck-visual--metrics .deck-visual__meta { grid-column: 1 / -1; }
.deck-visual--metrics span { min-height: 78px; align-items: flex-start; flex-direction: column; }
.deck-visual--metrics i { width: auto; min-width: 42px; padding: 0 9px; font-size: 17px; }
.deck-visual__flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: stretch; }
.deck-visual__flow span { min-height: 92px; position: relative; align-items: flex-start; flex-direction: column; }
.deck-visual__flow span:not(:last-child)::after { content: ""; position: absolute; top: 50%; right: -12px; width: 14px; height: 2px; background: linear-gradient(90deg, var(--deck-primary), var(--deck-accent)); }
.deck-visual__diagram { min-height: 178px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: stretch; }
.deck-visual__diagram strong { grid-column: 1 / -1; display: grid; place-items: center; min-height: 48px; border-radius: 8px; background: linear-gradient(90deg, var(--deck-primary), var(--deck-accent)); color: #ffffff; font-family: var(--deck-heading); font-size: 15px; text-align: center; }
.deck-visual__diagram span { min-height: 58px; }
.deck-visual__icons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.deck-visual__icons span { min-height: 70px; align-items: flex-start; flex-direction: column; }
.deck-visual--image { padding: 0; overflow: hidden; background: color-mix(in srgb, var(--deck-surface) 90%, var(--deck-bg)); }
.deck-visual--image img { width: 100%; height: 100%; min-height: 220px; object-fit: cover; display: block; }
.deck-visual--image figcaption { padding: 10px 14px; color: var(--deck-muted); font-size: 13px; }
.deck-slide aside { align-self: end; max-width: 560px; padding: 18px 20px; border-left: 4px solid var(--deck-accent); border-radius: 8px; background: color-mix(in srgb, var(--deck-accent) 9%, var(--deck-surface)); font-size: 18px; font-weight: 700; }
.deck-slide__number { position: absolute; right: 32px; bottom: 28px; color: color-mix(in srgb, var(--deck-muted) 80%, transparent); font-weight: 800; }
.deck-slide--title h2 { font-size: 64px; max-width: 920px; }
.deck-slide--quote { place-items: center start; }
.deck-slide--quote aside { font-size: 28px; max-width: 860px; }
@media (max-width: 760px) {
  .deck-preview { padding: 16px; gap: 18px; }
  .deck-preview__header { align-items: flex-start; flex-direction: column; }
  .deck-slide { width: calc(100vw - 32px); min-height: 640px; aspect-ratio: auto; padding: 34px 24px; }
  .deck-slide h2, .deck-slide--title h2 { font-size: 34px; }
  .deck-slide__subtitle { font-size: 17px; }
  .deck-slide__body { grid-template-columns: 1fr; }
  .deck-visual__flow, .deck-visual--metrics, .deck-visual__icons { grid-template-columns: 1fr; }
  .deck-visual__flow span:not(:last-child)::after { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .deck-visual, .deck-visual::after, .deck-illustration-window, .deck-illustration-path, .deck-illustration-orb, .deck-visual--chart i, .deck-visual--timeline i { animation: none; }
}
`.trim();

  const exportHtml = `
    <main class="deck-preview" data-designer-block="deck" data-designer-block-label="${escapeHtml(deckSpec.title)} deck">
      <header class="deck-preview__header" data-designer-block="deck-overview" data-designer-block-label="Deck overview">
        <div>
          <h1>${escapeHtml(deckSpec.title)}</h1>
          ${deckSpec.subtitle ? `<p>${escapeHtml(deckSpec.subtitle)}</p>` : ""}
        </div>
        <span class="deck-preview__count">${deckSpec.slides.length} slides</span>
      </header>
      ${deckSpec.slides.map(renderSlideHtml).join("\n")}
    </main>
  `;

  const sourceCode = `
const deckSpec = ${safeSpec};
function visualItems(visual, title) {
  const items = Array.isArray(visual.items) ? visual.items.filter(Boolean).slice(0, 5) : [];
  return items.length > 0 ? items : [title, visual.title || "Signal", visual.caption || "Action"].filter(Boolean).slice(0, 4);
}
function VisualMeta({ visual }) {
  if (!visual.title && !visual.caption) {
    return null;
  }
  return (
    <div className="deck-visual__meta">
      {visual.title ? <strong>{visual.title}</strong> : null}
      {visual.caption ? <small>{visual.caption}</small> : null}
    </div>
  );
}
function VisualArtifact({ slide, index }) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") {
    return null;
  }
  const items = visualItems(visual, slide.title);
  const block = slide.blockId + "-visual";
  if (visual.type === "image" && visual.assetId) {
    return (
      <figure className="deck-visual deck-visual--image" data-visual-artifact="image" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " visual"}>
        <img src={visual.assetId} alt={visual.caption || visual.title || slide.title} />
        {visual.caption ? <figcaption>{visual.caption}</figcaption> : null}
      </figure>
    );
  }
  if (visual.type === "illustration") {
    const gradientId = "deck-illustration-gradient-" + (index + 1);
    const glowId = "deck-illustration-glow-" + (index + 1);
    return (
      <div className="deck-visual deck-visual--illustration" data-visual-artifact="illustration" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " illustration"}>
        <svg className="deck-illustration-svg" viewBox="0 0 420 250" role="img" aria-label={visual.title || slide.title} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--deck-primary)" />
              <stop offset="100%" stopColor="var(--deck-accent)" />
            </linearGradient>
            <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="12" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect className="deck-illustration-bg" x="18" y="26" width="384" height="198" rx="18" />
          <path className="deck-illustration-path" d="M72 168 C118 102 158 192 206 122 S312 86 352 144" />
          <g className="deck-illustration-window deck-illustration-window--main">
            <rect x="78" y="68" width="158" height="112" rx="14" fill={"url(#" + gradientId + ")"} filter={"url(#" + glowId + ")"} />
            <rect x="98" y="94" width="92" height="12" rx="6" />
            <rect x="98" y="120" width="116" height="10" rx="5" />
            <rect x="98" y="144" width="66" height="10" rx="5" />
          </g>
          <g className="deck-illustration-window deck-illustration-window--side">
            <rect x="232" y="88" width="110" height="82" rx="14" />
            <circle cx="258" cy="116" r="14" />
            <rect x="282" y="106" width="36" height="9" rx="5" />
            <rect x="282" y="126" width="46" height="9" rx="5" />
          </g>
          <circle className="deck-illustration-orb deck-illustration-orb--one" cx="336" cy="66" r="18" />
          <circle className="deck-illustration-orb deck-illustration-orb--two" cx="72" cy="202" r="13" />
          <circle className="deck-illustration-orb deck-illustration-orb--three" cx="354" cy="190" r="9" />
        </svg>
        <VisualMeta visual={visual} />
        <div className="deck-visual__labels">{items.slice(0, 3).map((item, itemIndex) => <span key={itemIndex}>{item}</span>)}</div>
      </div>
    );
  }
  if (visual.type === "chart") {
    return (
      <div className="deck-visual deck-visual--chart" data-visual-artifact="chart" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " chart"}>
        <VisualMeta visual={visual} />
        {items.map((item, itemIndex) => <span key={itemIndex} style={{ "--bar": String(44 + itemIndex * 10) + "%" }}><i></i><b>{item}</b></span>)}
      </div>
    );
  }
  if (visual.type === "timeline") {
    return (
      <div className="deck-visual deck-visual--timeline" data-visual-artifact="timeline" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " timeline"}>
        <VisualMeta visual={visual} />
        <div className="deck-visual__line">{items.map((item, itemIndex) => <span key={itemIndex} style={{ "--dot": itemIndex + 1 }}><i></i><b>{item}</b></span>)}</div>
      </div>
    );
  }
  if (visual.type === "metrics") {
    return (
      <div className="deck-visual deck-visual--metrics" data-visual-artifact="metrics" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " metrics"}>
        <VisualMeta visual={visual} />
        {items.slice(0, 4).map((item, itemIndex) => <span key={itemIndex}><i>{String(itemIndex + 1).padStart(2, "0")}</i><b>{item}</b></span>)}
      </div>
    );
  }
  if (visual.type === "process") {
    return (
      <div className="deck-visual deck-visual--process" data-visual-artifact="process" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " process"}>
        <VisualMeta visual={visual} />
        <div className="deck-visual__flow">{items.slice(0, 4).map((item, itemIndex) => <span key={itemIndex}><i>{itemIndex + 1}</i><b>{item}</b></span>)}</div>
      </div>
    );
  }
  if (visual.type === "diagram") {
    return (
      <div className="deck-visual deck-visual--diagram" data-visual-artifact="diagram" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " diagram"}>
        <VisualMeta visual={visual} />
        <div className="deck-visual__diagram">
          <strong>{visual.title || slide.title}</strong>
          {items.slice(0, 4).map((item, itemIndex) => <span key={itemIndex}><i>{itemIndex + 1}</i><b>{item}</b></span>)}
        </div>
      </div>
    );
  }
  return (
    <div className="deck-visual deck-visual--icons" data-visual-artifact="icons" data-designer-block={block} data-designer-block-label={"Slide " + (index + 1) + " icon system"}>
      <VisualMeta visual={visual} />
      <div className="deck-visual__icons">{items.map((item, itemIndex) => <span key={itemIndex}><i>{String(item).slice(0, 1).toUpperCase() || itemIndex + 1}</i><b>{item}</b></span>)}</div>
    </div>
  );
}
function DeckPreview() {
  return (
    <main className="deck-preview" data-designer-block="deck" data-designer-block-label={deckSpec.title + " deck"}>
      <header className="deck-preview__header" data-designer-block="deck-overview" data-designer-block-label="Deck overview">
        <div>
          <h1>{deckSpec.title}</h1>
          {deckSpec.subtitle ? <p>{deckSpec.subtitle}</p> : null}
        </div>
        <span className="deck-preview__count">{deckSpec.slides.length} slides</span>
      </header>
      {deckSpec.slides.map((slide, index) => (
        <section key={slide.id} className={"deck-slide deck-slide--" + slide.layout} data-designer-block={slide.blockId} data-designer-block-label={"Slide " + (index + 1) + ": " + slide.title}>
          <div className="deck-slide__kicker">{slide.eyebrow || "Slide " + (index + 1)}</div>
          <h2 data-designer-block={slide.blockId + "-title"} data-designer-block-label={"Slide " + (index + 1) + " title"}>{slide.title}</h2>
          {slide.subtitle ? <p className="deck-slide__subtitle">{slide.subtitle}</p> : null}
          <div className="deck-slide__body">
            <ul>
              {slide.body.map((item, itemIndex) => (
                <li key={itemIndex} data-designer-block={slide.blockId + "-point-" + (itemIndex + 1)} data-designer-block-label={"Slide " + (index + 1) + " point " + (itemIndex + 1)}>{item}</li>
              ))}
            </ul>
            <VisualArtifact slide={slide} index={index} />
          </div>
          {slide.callout ? <aside data-designer-block={slide.blockId + "-callout"} data-designer-block-label={"Slide " + (index + 1) + " callout"}>{slide.callout}</aside> : null}
          <span className="deck-slide__number">{index + 1}</span>
        </section>
      ))}
    </main>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<DeckPreview />);
`.trim();

  return {
    frameName: deckSpec.title,
    sourceCode,
    cssCode,
    exportHtml
  };
}

export function readDeckSpecFromVersion(version: FrameVersion | undefined): DeckSpec | null {
  const raw = version?.passOutputs?.deckSpec;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return normalizeDeckSpec(raw, {
    prompt: "Deck",
    slideCount: Array.isArray((raw as { slides?: unknown }).slides)
      ? ((raw as { slides: unknown[] }).slides.length === 5 || (raw as { slides: unknown[] }).slides.length === 25 ? (raw as { slides: unknown[] }).slides.length as DeckSlideCount : 10)
      : 10,
    styleContext: {
      source: "heuristic",
      palette: { primary: "#2f7ef7", secondary: "#64748b", accent: "#1f9b62", background: "#f8fafc", surface: "#ffffff", text: "#172033" },
      typography: { headingFamily: "Sora, ui-sans-serif, system-ui", bodyFamily: "Manrope, ui-sans-serif, system-ui", cornerRadius: 12 },
      spacingScale: [4, 8, 12, 16, 24, 32],
      componentPatterns: [],
      layoutMotifs: []
    }
  });
}
