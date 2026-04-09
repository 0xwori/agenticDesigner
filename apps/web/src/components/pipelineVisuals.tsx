import type { PipelineEvent, RunStatus } from "@designer/shared";
import { PIPELINE_STAGES } from "@designer/shared";
import { CheckCircle2, AlertCircle, CircleDot, GitCompare, ListTodo, LoaderCircle, PenLine, WandSparkles, Wrench } from "lucide-react";

export function stageLabel(stage: PipelineEvent["stage"]) {
  if (stage === "enhance") return "Enhance";
  if (stage === "plan") return "Plan";
  if (stage === "generate") return "Generate";
  if (stage === "repair") return "Repair";
  if (stage === "diff-repair") return "Diff repair";
  return "System";
}

export function EventStageIcon({ stage, size = 12 }: { stage: PipelineEvent["stage"]; size?: number }) {
  if (stage === "enhance") return <WandSparkles size={size} />;
  if (stage === "plan") return <ListTodo size={size} />;
  if (stage === "generate") return <PenLine size={size} />;
  if (stage === "repair") return <Wrench size={size} />;
  if (stage === "diff-repair") return <GitCompare size={size} />;
  return <CircleDot size={size} />;
}

export function derivePassStatusMap(events: PipelineEvent[]): Record<string, RunStatus | "idle"> {
  const map: Record<string, RunStatus | "idle"> = {};
  for (const stage of PIPELINE_STAGES) {
    const stageEvents = events.filter((e) => e.stage === stage);
    if (stageEvents.length === 0) {
      map[stage] = "idle";
    } else if (stageEvents.some((e) => e.status === "error")) {
      map[stage] = "failed";
    } else if (stageEvents.some((e) => e.status === "success")) {
      map[stage] = "completed";
    } else {
      map[stage] = "running";
    }
  }
  return map;
}

export function PipelineStageBar({ events }: { events: PipelineEvent[] }) {
  const passStatusMap = derivePassStatusMap(events);
  const allIdle = PIPELINE_STAGES.every((s) => passStatusMap[s] === "idle");

  if (allIdle) {
    return null;
  }

  return (
    <div className="pipeline-stage-bar" role="list" aria-label="Pipeline stages">
      {PIPELINE_STAGES.map((stage) => {
        const status = passStatusMap[stage] ?? "idle";
        return (
          <div
            key={stage}
            role="listitem"
            className={`pipeline-stage-chip pipeline-stage-chip--${status}`}
            title={`${stageLabel(stage)}: ${status}`}
          >
            <span className="pipeline-stage-chip__icon" aria-hidden="true">
              {status === "running" ? (
                <LoaderCircle size={10} />
              ) : status === "completed" ? (
                <CheckCircle2 size={10} />
              ) : status === "failed" ? (
                <AlertCircle size={10} />
              ) : (
                <EventStageIcon stage={stage} size={10} />
              )}
            </span>
            <span className="pipeline-stage-chip__label">{stageLabel(stage)}</span>
          </div>
        );
      })}
    </div>
  );
}

const ERROR_HINTS: Record<string, string> = {
  "auth-error": "Check your API key in Workspace Settings — it may be invalid or expired.",
  "rate-limit": "You have hit the provider rate limit. Wait 60 s then retry.",
  "llm-timeout": "The request timed out. Try again or switch to a faster model.",
  "validation-failure": "The generated output failed validation. Try simplifying your prompt.",
  "network-error": "Network error reaching the provider. Check your connection and retry.",
  "unknown": "An unexpected error occurred. Check the debug logs for details."
};

export function ErrorHint({ errorCode }: { errorCode: string }) {
  const hint = ERROR_HINTS[errorCode] ?? ERROR_HINTS["unknown"];
  return (
    <p className="error-hint">
      <AlertCircle size={11} aria-hidden="true" />
      {hint}
    </p>
  );
}
