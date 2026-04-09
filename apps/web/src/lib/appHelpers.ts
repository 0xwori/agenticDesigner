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
          let __lastReportedHeight = 0;
          let __heightRaf = null;

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
            if (__heightRaf !== null) {
              return;
            }
            __heightRaf = window.requestAnimationFrame(() => {
              __heightRaf = null;
              __postHeight();
            });
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
            __scheduleHeight();
            window.requestAnimationFrame(() => window.requestAnimationFrame(__scheduleHeight));
            window.setTimeout(__scheduleHeight, 200);
            window.setTimeout(__scheduleHeight, 600);
            window.setTimeout(__scheduleHeight, 1200);
          }

          const __heightObserver = new MutationObserver(() => __scheduleHeight());
          if (document.body) {
            __heightObserver.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
            if (typeof ResizeObserver !== "undefined") {
              new ResizeObserver(() => __scheduleHeight()).observe(document.body);
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
