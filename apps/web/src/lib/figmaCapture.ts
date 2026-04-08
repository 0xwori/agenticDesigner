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

type CaptureLogger = (entry: CaptureLogEntry) => void;

declare global {
  interface Window {
    figma?: {
      captureForDesign?: (args: { selector: string }) => unknown | Promise<unknown>;
    };
  }
}

let loadPromise: Promise<void> | null = null;

function emit(logger: CaptureLogger | undefined, entry: Omit<CaptureLogEntry, "timestamp">) {
  logger?.({
    timestamp: new Date().toISOString(),
    ...entry
  });
}

function serialize(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function hasCaptureApi() {
  return typeof window.figma?.captureForDesign === "function";
}

async function loadCaptureScript(logger?: CaptureLogger) {
  if (hasCaptureApi()) {
    emit(logger, {
      stage: "script",
      status: "success",
      message: "Capture runtime already loaded."
    });
    return;
  }

  if (!loadPromise) {
    emit(logger, {
      stage: "script",
      status: "info",
      message: "Loading Figma capture runtime.",
      data: CAPTURE_SCRIPT_URL
    });

    loadPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${CAPTURE_SCRIPT_URL}"]`);
      if (existing) {
        if (hasCaptureApi()) {
          resolve();
          return;
        }

        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Existing capture script failed to load.")), {
          once: true
        });
        return;
      }

      const script = document.createElement("script");
      script.src = CAPTURE_SCRIPT_URL;
      script.async = true;
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error(`Failed to load ${CAPTURE_SCRIPT_URL}`)), {
        once: true
      });
      document.head.appendChild(script);
    }).catch((error) => {
      loadPromise = null;
      emit(logger, {
        stage: "script",
        status: "error",
        message: "Capture runtime load failed.",
        data: serialize(error)
      });
      throw error;
    });
  }

  await loadPromise;
  emit(logger, {
    stage: "script",
    status: "success",
    message: "Capture runtime loaded."
  });
}

export async function captureSelectorToFigmaClipboard(input: {
  selector: string;
  delayMs?: number;
  logger?: CaptureLogger;
}) {
  await loadCaptureScript(input.logger);

  if (!hasCaptureApi()) {
    const error = new Error("window.figma.captureForDesign is not available.");
    emit(input.logger, {
      stage: "api",
      status: "error",
      message: "Capture API unavailable.",
      data: serialize(error)
    });
    throw error;
  }

  emit(input.logger, {
    stage: "api",
    status: "success",
    message: "Capture API detected.",
    data: "window.figma.captureForDesign"
  });

  const target = document.querySelector(input.selector);
  if (!target) {
    const error = new Error(`Selector not found: ${input.selector}`);
    emit(input.logger, {
      stage: "capture",
      status: "error",
      message: "Capture target missing.",
      data: serialize(error)
    });
    throw error;
  }

  const bounds = target.getBoundingClientRect();
  emit(input.logger, {
    stage: "capture",
    status: "info",
    message: "Starting capture call.",
    data: JSON.stringify({
      selector: input.selector,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    })
  });

  if ((input.delayMs ?? 0) > 0) {
    await sleep(input.delayMs ?? 0);
  }

  try {
    const result = await window.figma!.captureForDesign!({ selector: input.selector });
    emit(input.logger, {
      stage: "capture",
      status: "success",
      message: "Capture call completed.",
      data: serialize(result)
    });
    return result;
  } catch (error) {
    emit(input.logger, {
      stage: "capture",
      status: "error",
      message: "Capture call failed.",
      data: serialize(error)
    });
    throw error;
  }
}
