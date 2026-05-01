import React from "react";
import { useMessage } from "@assistant-ui/react";
import type { PipelineEvent } from "@designer/shared";
import type { PromptEntry } from "../../types/ui";
import { ThoughtBlock } from "./ThoughtBlock";
import { OrphanEventItem } from "./OrphanEventItem";
import { useChatContext } from "./ChatContext";

type PipelineResponseMeta = {
  kind: "pipeline-response";
  runId: string;
  promptEntry: PromptEntry;
};

type OrphanEventMeta = {
  kind: "orphan-event";
  event: PipelineEvent;
};

export function AssistantMessage() {
  const message = useMessage();
  const {
    eventsByRun,
    flowMutationReviews,
    formatThoughtDuration,
    onApproveFlowMutationReview,
    onRejectFlowMutationReview,
    onSetComposerPrompt,
  } = useChatContext();

  const custom = message.metadata?.custom as PipelineResponseMeta | OrphanEventMeta | undefined;

  if (custom?.kind === "pipeline-response") {
    const events = eventsByRun.get(custom.runId) ?? [];
    const flowMutationReview = flowMutationReviews[custom.runId] ?? null;
    return (
      <ThoughtBlock
        entry={custom.promptEntry}
        events={events}
        formatDuration={formatThoughtDuration}
        flowMutationReview={flowMutationReview}
        onApproveFlowMutationReview={onApproveFlowMutationReview}
        onRejectFlowMutationReview={onRejectFlowMutationReview}
        onSetComposerPrompt={onSetComposerPrompt}
      />
    );
  }

  if (custom?.kind === "orphan-event") {
    return <OrphanEventItem event={custom.event} />;
  }

  return null;
}
