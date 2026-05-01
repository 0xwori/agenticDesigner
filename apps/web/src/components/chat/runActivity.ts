import type { PipelineEvent } from "@designer/shared";

export type RunActivity = {
  state: "running" | "done" | "failed";
  stage: PipelineEvent["stage"];
  statusDetail: string | null;
};

export function resolveRunActivity(events: PipelineEvent[]): RunActivity {
  if (events.length === 0) {
    return { state: "running", stage: "system", statusDetail: null };
  }

  const latest = events[events.length - 1];
  const latestStep = typeof latest.payload?.step === "string" ? latest.payload.step : null;
  const isTerminalSuccess = latestStep === "run-complete";
  const isTerminalFailure =
    latestStep === "run-failed" || (latest.stage === "system" && latest.status === "error");
  const stageSource = [...events].reverse().find((e) => e.stage !== "system") ?? latest;
  const statusDetail =
    typeof latest.payload?.statusDetail === "string"
      ? latest.payload.statusDetail
      : typeof latest.payload?.nextStep === "string"
        ? `Next: ${latest.payload.nextStep.replaceAll("-", " ")}`
        : null;

  if (isTerminalFailure) {
    return { state: "failed", stage: stageSource.stage, statusDetail };
  }

  if (isTerminalSuccess || (latest.stage === "system" && latest.status === "success")) {
    return { state: "done", stage: stageSource.stage, statusDetail };
  }

  return { state: "running", stage: stageSource.stage, statusDetail };
}
