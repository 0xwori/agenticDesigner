import React, { createContext, useContext } from "react";
import type { PipelineEvent } from "@designer/shared";
import type { FlowMutationReviewState, PromptEntry } from "../../types/ui";

type ChatContextValue = {
  eventsByRun: Map<string, PipelineEvent[]>;
  flowMutationReviews: Record<string, FlowMutationReviewState>;
  formatThoughtDuration: (startedAt: string, events: PipelineEvent[]) => string;
  onApproveFlowMutationReview: (runId: string) => void;
  onRejectFlowMutationReview: (runId: string) => void;
  onSetComposerPrompt: (value: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext used outside <ChatContextProvider>");
  return ctx;
}

export function ChatContextProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ChatContextValue;
}) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
