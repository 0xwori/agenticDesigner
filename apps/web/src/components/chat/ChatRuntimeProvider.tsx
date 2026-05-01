import React, { useMemo } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { PipelineEvent } from "@designer/shared";
import type { PromptEntry } from "../../types/ui";
import { resolveRunActivity } from "./runActivity";

type Props = {
  promptHistory: PromptEntry[];
  eventsByRun: Map<string, PipelineEvent[]>;
  orphanEvents: PipelineEvent[];
  children: React.ReactNode;
};

function buildMessages(
  promptHistory: PromptEntry[],
  eventsByRun: Map<string, PipelineEvent[]>,
  orphanEvents: PipelineEvent[],
  isRunning: boolean,
): ThreadMessageLike[] {
  type Turn = { kind: "turn"; entry: PromptEntry; sortKey: number };
  type System = { kind: "system"; event: PipelineEvent; sortKey: number };

  const turns: Turn[] = promptHistory.map((entry) => ({
    kind: "turn",
    entry,
    sortKey: new Date(entry.submittedAt).getTime(),
  }));

  const systemItems: System[] = orphanEvents.map((event) => ({
    kind: "system",
    event,
    sortKey: new Date(event.timestamp).getTime(),
  }));

  const timeline = ([...turns, ...systemItems] as (Turn | System)[]).sort(
    (a, b) => a.sortKey - b.sortKey,
  );

  const messages: ThreadMessageLike[] = [];

  for (const item of timeline) {
    if (item.kind === "system") {
      messages.push({
        id: `orphan-${item.event.timestamp}-${item.event.message.slice(0, 20)}`,
        role: "assistant",
        content: [{ type: "text", text: item.event.message }],
        metadata: { custom: { kind: "orphan-event", event: item.event } },
      });
    } else {
      const entry = item.entry;
      messages.push({
        id: `user-${entry.runId}`,
        role: "user",
        content: [{ type: "text", text: entry.prompt }],
        createdAt: new Date(entry.submittedAt),
      });
      messages.push({
        id: `assistant-${entry.runId}`,
        role: "assistant",
        content: [{ type: "text", text: "" }],
        status:
          isRunning && entry.runId === promptHistory[promptHistory.length - 1]?.runId
            ? { type: "running" }
            : { type: "complete", reason: "stop" },
        metadata: {
          custom: {
            kind: "pipeline-response",
            runId: entry.runId,
            promptEntry: entry,
          },
        },
      });
    }
  }

  return messages;
}

function ChatRuntimeInner({ promptHistory, eventsByRun, orphanEvents, children }: Props) {
  const isRunning = useMemo(() => {
    if (promptHistory.length === 0) return false;
    const latest = promptHistory[promptHistory.length - 1];
    const events = eventsByRun.get(latest.runId) ?? [];
    return resolveRunActivity(events).state === "running";
  }, [promptHistory, eventsByRun]);

  const messages = useMemo(
    () => buildMessages(promptHistory, eventsByRun, orphanEvents, isRunning),
    [promptHistory, eventsByRun, orphanEvents, isRunning],
  );

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning,
    convertMessage: (msg) => msg,
    onNew: async () => {
      // Submission is handled directly by ChatComposer → handleRun.
    },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function ChatRuntimeProvider(props: Props) {
  return <ChatRuntimeInner {...props} />;
}
