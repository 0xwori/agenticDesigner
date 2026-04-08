const CAPTURE_SCRIPT_URL = "https://mcp.figma.com/mcp/html-to-design/capture.js";

export type CaptureLogStage = "script" | "api" | "capture";
export type CaptureLogStatus = "info" | "success" | "error";

export type CaptureLogEntry = {
  timestamp: string;
  stage: CaptureLogStage;
  status: CaptureLogStatus;
  message: string;
  data?: string;
};

export type CaptureLogger = (entry: CaptureLogEntry) => void;

type CaptureRequest = {
  selector: string;
  delayMs?: number;
  logger?: CaptureLogger;
};

type CaptureForDesignArgs = {
  selector: string;
};

declare global {
  interface Window {
    figma?: {
      captureForDesign?: (args: CaptureForDesignArgs) => unknown | Promise<unknown>;
    };
  }
}

let captureScriptPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function emit(logger: CaptureLogger | undefined, entry: Omit<CaptureLogEntry, "timestamp">) {
  if (!logger) {
    return;
  }

  logger({
    timestamp: nowIso(),
    ...entry
  });
}

function safeSerialize(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  return safeSerialize(error);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isCaptureApiAvailable() {
  return typeof window.figma?.captureForDesign === "function";
}

function loadCaptureScript(logger?: CaptureLogger) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Figma capture requires a browser environment."));
  }

  if (isCaptureApiAvailable()) {
    emit(logger, {
      stage: "script",
      status: "success",
      message: "Capture script already available."
    });
    return Promise.resolve();
  }

  if (captureScriptPromise) {
    emit(logger, {
      stage: "script",
      status: "info",
      message: "Capture script load already in progress."
    });
    return captureScriptPromise;
  }

  emit(logger, {
    stage: "script",
    status: "info",
    message: "Loading Figma capture runtime.",
    data: CAPTURE_SCRIPT_URL
  });

  captureScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${CAPTURE_SCRIPT_URL}"]`);
    if (existingScript) {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load ${CAPTURE_SCRIPT_URL}`));
      };
      const cleanup = () => {
        existingScript.removeEventListener("load", onReady);
        existingScript.removeEventListener("error", onError);
      };

      existingScript.addEventListener("load", onReady);
      existingScript.addEventListener("error", onError);

      window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while waiting for existing capture script to load."));
      }, 8000);
      return;
    }

    const script = document.createElement("script");
    script.src = CAPTURE_SCRIPT_URL;
    script.async = true;

    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load ${CAPTURE_SCRIPT_URL}`));
    };
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    document.head.appendChild(script);
  }).catch((error) => {
    emit(logger, {
      stage: "script",
      status: "error",
      message: "Failed to load Figma capture runtime.",
      data: serializeError(error)
    });
    captureScriptPromise = null;
    throw error;
  });

  return captureScriptPromise;
}

export async function captureCurrentPageToFigmaClipboard({ selector, delayMs = 900, logger }: CaptureRequest) {
  await loadCaptureScript(logger);
  emit(logger, {
    stage: "script",
    status: "success",
    message: "Figma capture runtime loaded."
  });

  if (!isCaptureApiAvailable()) {
    const error = new Error("window.figma.captureForDesign is unavailable after script load.");
    emit(logger, {
      stage: "api",
      status: "error",
      message: "Capture API not detected.",
      data: error.message
    });
    throw error;
  }

  emit(logger, {
    stage: "api",
    status: "success",
    message: "Capture API detected.",
    data: "window.figma.captureForDesign"
  });

  const target = document.querySelector(selector);
  if (!target) {
    const error = new Error(`Capture selector did not match any element: ${selector}`);
    emit(logger, {
      stage: "capture",
      status: "error",
      message: "Capture target not found.",
      data: error.message
    });
    throw error;
  }

  const bounds = target.getBoundingClientRect();
  const url = new URL(window.location.href);
  const page = url.searchParams.get("page") ?? "system";
  const payloadData = safeSerialize({
    selector,
    page,
    delayMs,
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight)
    },
    target: {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    }
  });

  emit(logger, {
    stage: "capture",
    status: "info",
    message: "Starting Figma capture.",
    data: payloadData
  });

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  let response: unknown;
  try {
    response = await window.figma!.captureForDesign!({ selector });
  } catch (error) {
    emit(logger, {
      stage: "capture",
      status: "error",
      message: "Capture API call failed.",
      data: serializeError(error)
    });
    throw error;
  }

  emit(logger, {
    stage: "capture",
    status: "success",
    message: "Capture call completed.",
    data: safeSerialize(response)
  });

  return response;
}
