import type { CSSProperties } from "react";
import type { FrameVersion, PipelineEvent } from "@designer/shared";
import { buildGoogleFontsLink, extractFontFamiliesFromCss } from "@designer/shared";
import { DEFAULT_API_BASE, getApiBaseUrl } from "../api";
import type { LocalPreferences } from "../types/ui";

export const PROJECT_STORAGE_KEY = "designer.project.id";
export const PREF_STORAGE_KEY = "designer.preferences.v1";

export const DEFAULT_PREFERENCES: LocalPreferences = {
  apiBaseUrl: DEFAULT_API_BASE,
  provider: "openai",
  model: "gpt-5.4-mini",
  apiKey: "",
  figmaClientId: "",
  figmaClientSecret: "",
  tailwindDefault: false,
  deviceDefault: "desktop",
  modeDefault: "high-fidelity"
};

export const VIEWPORT_MIN_SCALE = 0.05;
export const VIEWPORT_MAX_SCALE = 2.4;
export const VIEWPORT_DEFAULT = { x: 120, y: 92, scale: 1 };

export function loadPreferences(): LocalPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Partial<LocalPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      apiBaseUrl: getApiBaseUrl(parsed.apiBaseUrl)
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: LocalPreferences) {
  window.localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(preferences));
}

export function clampScale(scale: number) {
  return Math.min(VIEWPORT_MAX_SCALE, Math.max(VIEWPORT_MIN_SCALE, scale));
}

export function formatThoughtDuration(startedAt: string, events: PipelineEvent[]) {
  const endTimestamp = events[events.length - 1]?.timestamp ?? startedAt;
  const durationMs = new Date(endTimestamp).getTime() - new Date(startedAt).getTime();
  const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
  return `${durationSeconds}s`;
}

export function createLocalRunId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function extractFigmaUrl(input: string): string | null {
  const match = input.match(/https?:\/\/(?:www\.)?figma\.com\/design\/[^\s)]+/i);
  return match?.[0] ?? null;
}

export function parseFigmaCredentialsCommand(input: string): { clientId: string; clientSecret: string } | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith("/figma-credentials")) {
    return null;
  }

  const inline = trimmed.slice("/figma-credentials".length).trim();
  if (inline.length > 0) {
    const [clientId, ...secretParts] = inline.split(/\s+/);
    const clientSecret = secretParts.join(" ").trim();
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
  }

  const idMatch = trimmed.match(/client[_ -]?id\s*[:=]\s*([^\s]+)/i);
  const secretMatch = trimmed.match(/client[_ -]?secret\s*[:=]\s*([^\s]+)/i);
  if (idMatch?.[1] && secretMatch?.[1]) {
    return { clientId: idMatch[1], clientSecret: secretMatch[1] };
  }

  return { clientId: "", clientSecret: "" };
}

export function parseDesignSystemCalibrationCommand(input: string): { updates: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const commandPattern = /^\/(?:ds-calibrate|design-calibrate)\b/i;
  if (!commandPattern.test(trimmed)) {
    return null;
  }

  const updates = trimmed.replace(commandPattern, "").trim();
  return { updates };
}

export function buildPreviewDocument(frameId: string, version?: FrameVersion, isBuilding?: boolean) {
  if (!version) {
    if (isBuilding) {
      return `<!doctype html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;height:100vh;background:#faf8f4;overflow:hidden}
.loader-wrap{display:flex;flex-direction:column;align-items:center;gap:18px}
.gradient-ring{width:48px;height:48px;border-radius:999px;background:conic-gradient(from 0deg,#6366f1,#a855f7,#ec4899,#f97316,#eab308,#22c55e,#06b6d4,#6366f1);padding:3px;animation:ring-spin 1.8s linear infinite}
.gradient-ring-inner{width:100%;height:100%;border-radius:999px;background:#faf8f4}
@keyframes ring-spin{to{transform:rotate(360deg)}}
.loader-label{font-size:13px;font-weight:600;color:#64748b;letter-spacing:0.01em}
.loader-dots{display:inline-flex;gap:2px}
.loader-dots span{animation:dot-blink 1.4s infinite both}
.loader-dots span:nth-child(2){animation-delay:0.2s}
.loader-dots span:nth-child(3){animation-delay:0.4s}
@keyframes dot-blink{0%,80%,100%{opacity:0.2}40%{opacity:1}}
</style></head><body>
<div class="loader-wrap">
<div class="gradient-ring"><div class="gradient-ring-inner"></div></div>
<div class="loader-label">Designing your screen<span class="loader-dots"><span>.</span><span>.</span><span>.</span></span></div>
</div>
</body></html>`;
    }
    return `<!doctype html><html><body style="font-family: ui-sans-serif,system-ui;display:grid;place-items:center;height:100vh;color:#5d6372;background:#faf8f4;">No content yet.</body></html>`;
  }

  const safeCss = version.cssCode.replaceAll("</style>", "<\\/style>");
  const safeSource = version.sourceCode.replaceAll("</script>", "<\\/script>");
  const tailwindRuntime = version.tailwindEnabled ? `<script src="https://cdn.tailwindcss.com"></script>` : "";
  const safeFrameId = JSON.stringify(frameId);
  const safeVersionId = JSON.stringify(version.id);
  const googleFontsTag = buildGoogleFontsLink(extractFontFamiliesFromCss(version.cssCode));

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        ${googleFontsTag}
        <style>${safeCss}</style>
        ${tailwindRuntime}
      </head>
      <body>
        <div id="root"></div>
        <div id="preview-error" style="display:none;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#8f1239;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;margin:12px;"></div>
        <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
        <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
        <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
        <script type="text/babel" data-presets="typescript,react">
          const __designerFrameId = ${safeFrameId};
          const __designerVersionId = ${safeVersionId};
          const __heightTrackingWindowMs = 1800;
          let __lastReportedHeight = 0;
          let __heightRaf = null;
          let __heightTrackingStopped = false;
          let __heightObserver = null;
          let __resizeObserver = null;
          let __designerBlockOverlay = null;
          let __designerSelectedBlockId = null;

          const __blockAttr = "data-designer-block";
          const __blockLabelAttr = "data-designer-block-label";

          const __cssEscape = (value) => {
            if (window.CSS && typeof window.CSS.escape === "function") {
              return window.CSS.escape(value);
            }
            return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
          };

          const __textSnippet = (element) => (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 420);

          const __blockIdForElement = (element, index) => {
            const explicit = element.getAttribute(__blockAttr);
            if (explicit) {
              return explicit;
            }
            const label = element.getAttribute(__blockLabelAttr) || element.getAttribute("aria-label") || element.id || element.className || element.tagName;
            return String(label || "block").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "block-" + index;
          };

          const __labelForElement = (element, blockId) =>
            element.getAttribute(__blockLabelAttr) ||
            element.getAttribute("aria-label") ||
            element.getAttribute("data-section") ||
            element.id ||
            __textSnippet(element).slice(0, 64) ||
            blockId;

          const __selectorForElement = (element, blockId) => {
            if (element.getAttribute(__blockAttr)) {
              return "[" + __blockAttr + "='" + String(blockId).replace(/'/g, "\\\\'") + "']";
            }
            if (element.id) {
              return "#" + __cssEscape(element.id);
            }
            const parts = [];
            let node = element;
            while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement && parts.length < 6) {
              const tag = node.tagName.toLowerCase();
              const parent = node.parentElement;
              if (!parent) {
                parts.unshift(tag);
                break;
              }
              const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
              const index = sameTag.indexOf(node) + 1;
              parts.unshift(sameTag.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
              node = parent;
            }
            return parts.join(" > ");
          };

          const __isViableBlock = (element) => {
            if (!(element instanceof HTMLElement) || element.id === "preview-error" || element.id === "root") {
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width < 44 || rect.height < 36) {
              return false;
            }
            const style = window.getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
              return false;
            }
            return true;
          };

          const __getDesignerBlocks = () => {
            const explicit = Array.from(document.querySelectorAll("[" + __blockAttr + "]")).filter(__isViableBlock);
            if (explicit.length > 0) {
              return explicit.slice(0, 96);
            }
            const fallbackSelector = [
              "main",
              "header",
              "nav",
              "section",
              "article",
              "aside",
              "footer",
              "form",
              "[role='region']",
              "[class*='hero']",
              "[class*='card']",
              "[class*='panel']",
              "[class*='section']",
              "[class*='slide']"
            ].join(",");
            return Array.from(new Set(Array.from(document.querySelectorAll(fallbackSelector)).filter(__isViableBlock))).slice(0, 96);
          };

          const __ensureBlockOverlay = () => {
            if (__designerBlockOverlay) {
              return __designerBlockOverlay;
            }
            const overlay = document.createElement("div");
            overlay.setAttribute("data-designer-block-overlay", "true");
            overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none;";
            document.body.appendChild(overlay);
            __designerBlockOverlay = overlay;
            return overlay;
          };

          const __paintBlockOverlays = (hoverElement) => {
            const overlay = __ensureBlockOverlay();
            overlay.textContent = "";
            overlay.style.display = "block";
            const blocks = __getDesignerBlocks();
            blocks.forEach((element, index) => {
              const rect = element.getBoundingClientRect();
              const blockId = __blockIdForElement(element, index);
              const isHover = element === hoverElement;
              const isSelected = blockId === __designerSelectedBlockId;
              const box = document.createElement("div");
              box.style.cssText = [
                "position:fixed",
                "left:" + Math.max(0, rect.left - 4) + "px",
                "top:" + Math.max(0, rect.top - 4) + "px",
                "width:" + Math.max(0, rect.width + 8) + "px",
                "height:" + Math.max(0, rect.height + 8) + "px",
                "border:" + (isSelected ? "3px solid #1f9b62" : isHover ? "3px solid #2f7ef7" : "1px dashed rgba(47,126,247,0.55)"),
                "background:" + (isSelected ? "rgba(31,155,98,0.10)" : isHover ? "rgba(47,126,247,0.10)" : "rgba(47,126,247,0.04)"),
                "box-shadow:0 0 0 2px rgba(255,255,255,0.82)",
                "border-radius:8px",
                "box-sizing:border-box"
              ].join(";");
              if (isHover || isSelected) {
                const label = document.createElement("div");
                label.textContent = __labelForElement(element, blockId);
                label.style.cssText = "position:absolute;left:0;top:-24px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#172033;color:white;border-radius:6px;padding:4px 7px;font:600 11px ui-sans-serif,system-ui;";
                box.appendChild(label);
              }
              overlay.appendChild(box);
            });
          };

          const __hideBlockOverlays = () => {
            if (__designerBlockOverlay) {
              __designerBlockOverlay.style.display = "none";
            }
          };

          const __findDesignerBlockAtPoint = (clientX, clientY) => {
            const blocks = __getDesignerBlocks();
            const explicit = document.elementFromPoint(clientX, clientY);
            if (explicit) {
              const explicitBlock = explicit.closest("[" + __blockAttr + "]");
              if (explicitBlock && blocks.includes(explicitBlock)) {
                return explicitBlock;
              }
              for (const candidate of blocks) {
                if (candidate === explicit || candidate.contains(explicit)) {
                  return candidate;
                }
              }
            }
            return blocks
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .filter(({ rect }) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom)
              .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0]?.element || null;
          };

          const __postSelectedBlock = (element) => {
            const blocks = __getDesignerBlocks();
            const index = Math.max(0, blocks.indexOf(element));
            const rect = element.getBoundingClientRect();
            const blockId = __blockIdForElement(element, index);
            __designerSelectedBlockId = blockId;
            __paintBlockOverlays(element);
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(
                {
                  type: "designer.block-selected",
                  frameId: __designerFrameId,
                  versionId: __designerVersionId,
                  blockId,
                  label: __labelForElement(element, blockId),
                  selector: __selectorForElement(element, blockId),
                  tagName: element.tagName.toLowerCase(),
                  className: typeof element.className === "string" ? element.className : "",
                  textSnippet: __textSnippet(element),
                  outerHtml: element.outerHTML.slice(0, 6000),
                  rect: {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height
                  }
                },
                "*"
              );
            }
          };

          const __installBlockSelection = () => {
            document.addEventListener("pointermove", (event) => {
              if (!event.altKey) {
                __hideBlockOverlays();
                return;
              }
              const block = __findDesignerBlockAtPoint(event.clientX, event.clientY);
              __paintBlockOverlays(block);
            }, true);
            document.addEventListener("click", (event) => {
              if (!event.altKey) {
                return;
              }
              const block = __findDesignerBlockAtPoint(event.clientX, event.clientY);
              if (!block) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              __postSelectedBlock(block);
            }, true);
            document.addEventListener("mouseleave", __hideBlockOverlays);
          };

          const __postHeight = () => {
            const root = document.getElementById("root");
            let nextHeight = 0;
            if (root && root.children.length > 0) {
              // Measure the bottom of the last rendered child for precision
              const lastChild = root.children[root.children.length - 1];
              const rect = lastChild.getBoundingClientRect();
              nextHeight = Math.ceil(rect.bottom);
            }
            if (nextHeight < 120) {
              // Fallback to scrollHeight
              nextHeight = Math.ceil(
                Math.max(
                  root ? root.scrollHeight : 0,
                  document.documentElement ? document.documentElement.scrollHeight : 0,
                  document.body ? document.body.scrollHeight : 0
                )
              );
            }
            if (!Number.isFinite(nextHeight) || nextHeight < 120 || Math.abs(nextHeight - __lastReportedHeight) < 2) {
              return;
            }
            __lastReportedHeight = nextHeight;
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(
                {
                  type: "designer.frame-content-height",
                  frameId: __designerFrameId,
                  versionId: __designerVersionId,
                  height: nextHeight
                },
                "*"
              );
            }
          };

          const __scheduleHeight = () => {
            if (__heightTrackingStopped) {
              return;
            }
            if (__heightRaf !== null) {
              return;
            }
            __heightRaf = window.requestAnimationFrame(() => {
              __heightRaf = null;
              __postHeight();
            });
          };

          const __stopHeightTracking = () => {
            if (__heightTrackingStopped) {
              return;
            }

            __heightTrackingStopped = true;
            if (__heightObserver) {
              __heightObserver.disconnect();
            }
            if (__resizeObserver) {
              __resizeObserver.disconnect();
            }
            window.removeEventListener("load", __scheduleHeight);
            window.removeEventListener("resize", __scheduleHeight);
          };

          try {
            ${safeSource}
          } catch (error) {
            const message = error instanceof Error ? error.stack ?? error.message : String(error);
            const target = document.getElementById("preview-error");
            if (target) {
              target.style.display = "block";
              target.textContent = message;
            }
          } finally {
            __installBlockSelection();
            __scheduleHeight();
            window.requestAnimationFrame(() => window.requestAnimationFrame(__scheduleHeight));
            window.setTimeout(__scheduleHeight, 200);
            window.setTimeout(__scheduleHeight, 600);
            window.setTimeout(__scheduleHeight, 1200);
            window.setTimeout(__stopHeightTracking, __heightTrackingWindowMs);
          }

          __heightObserver = new MutationObserver(() => __scheduleHeight());
          if (document.body) {
            __heightObserver.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
            if (typeof ResizeObserver !== "undefined") {
              __resizeObserver = new ResizeObserver(() => __scheduleHeight());
              __resizeObserver.observe(document.body);
            }
          }
          window.addEventListener("load", __scheduleHeight);
          window.addEventListener("resize", __scheduleHeight);
        </script>
      </body>
    </html>
  `;
}

export function createArtboardBackgroundStyle(viewport: { x: number; y: number; scale: number }) {
  return {
    "--dot-offset-x": `${viewport.x}px`,
    "--dot-offset-y": `${viewport.y}px`,
    "--dot-size": `${Math.max(10, 24 * viewport.scale)}px`
  } as CSSProperties;
}
