import { useCallback, useEffect, useState } from "react";
import { Button } from "./design-system";
import { OnboardingFlowPage } from "./demo/OnboardingFlowPage";
import { DesignSystemShowcase } from "./demo/TapwiseOverviewDemo";
import { captureCurrentPageToFigmaClipboard, type CaptureLogEntry } from "./lib/figmaCapture";

type PageKey = "system" | "onboarding";
type CopyState = "idle" | "capturing" | "copied" | "failed";

function readPageFromUrl(): PageKey {
  if (typeof window === "undefined") {
    return "system";
  }

  const url = new URL(window.location.href);
  const page = url.searchParams.get("page");

  if (page === "onboarding") {
    return "onboarding";
  }

  if (window.location.hash === "#onboarding") {
    return "onboarding";
  }

  return "system";
}

function writePageToUrl(page: PageKey, replace = false) {
  const url = new URL(window.location.href);
  url.searchParams.set("page", page);

  if (url.hash === "#onboarding" || url.hash === "#system") {
    url.hash = "";
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;

  if (replace) {
    window.history.replaceState({}, "", nextUrl);
    return;
  }

  window.history.pushState({}, "", nextUrl);
}

function normalizeLegacyHashRoute() {
  const hash = window.location.hash;
  if (hash !== "#onboarding" && hash !== "#system") {
    return;
  }

  writePageToUrl(hash === "#onboarding" ? "onboarding" : "system", true);
}

function formatLogLine(log: CaptureLogEntry) {
  const data = log.data ? ` | ${log.data}` : "";
  return `[${log.timestamp}] [${log.stage}] [${log.status}] ${log.message}${data}`;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export default function App() {
  const [page, setPage] = useState<PageKey>(readPageFromUrl);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [copyLogs, setCopyLogs] = useState<CaptureLogEntry[]>([]);

  const appendLog = useCallback((entry: CaptureLogEntry) => {
    setCopyLogs((previous) => [...previous, entry].slice(-80));
  }, []);

  useEffect(() => {
    normalizeLegacyHashRoute();
    setPage(readPageFromUrl());

    function onPopState() {
      setPage(readPageFromUrl());
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }

    const timeout = window.setTimeout(() => setCopyState("idle"), 2200);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  function goTo(next: PageKey) {
    writePageToUrl(next);
    setPage(next);
  }

  async function copyToFigma() {
    setCopyLogs([]);
    setCopyState("capturing");

    appendLog({
      timestamp: new Date().toISOString(),
      stage: "capture",
      status: "info",
      message: `Capture requested for page '${page}'`,
      data: "selector=.app-stage"
    });

    try {
      await captureCurrentPageToFigmaClipboard({
        selector: ".app-stage",
        delayMs: 900,
        logger: appendLog
      });
      setCopyState("copied");
    } catch (error) {
      appendLog({
        timestamp: new Date().toISOString(),
        stage: "capture",
        status: "error",
        message: "Capture pipeline failed.",
        data: serializeError(error)
      });
      setCopyState("failed");
    }
  }

  return (
    <div>
      <nav className="app-page-nav">
        <Button variant={page === "system" ? "accent" : "surface"} size="sm" onClick={() => goTo("system")}>
          Design System
        </Button>
        <Button variant={page === "onboarding" ? "accent" : "surface"} size="sm" onClick={() => goTo("onboarding")}>
          Onboarding Flow
        </Button>
        <div className="app-page-nav__spacer" />
        <Button variant="accent" size="sm" onClick={copyToFigma} disabled={copyState === "capturing"}>
          {copyState === "capturing"
            ? "CAPTURING..."
            : copyState === "copied"
              ? "COPIED"
              : copyState === "failed"
                ? "COPY FAILED"
                : "COPY TO FIGMA"}
        </Button>
      </nav>

      <details className="copy-debug" open={copyState === "failed"}>
        <summary>Copy Debug Logs</summary>
        <pre>{copyLogs.length > 0 ? copyLogs.map(formatLogLine).join("\n") : "No logs yet."}</pre>
      </details>

      {page === "system" ? <DesignSystemShowcase /> : <OnboardingFlowPage />}
    </div>
  );
}
