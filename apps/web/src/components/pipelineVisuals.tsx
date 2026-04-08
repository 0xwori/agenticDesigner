import type { PipelineEvent } from "@designer/shared";
import { CircleDot, GitCompare, ListTodo, PenLine, WandSparkles, Wrench } from "lucide-react";

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
