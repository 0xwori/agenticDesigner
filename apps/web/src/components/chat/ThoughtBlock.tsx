import React from "react";
import type { PipelineEvent } from "@designer/shared";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import type { FlowMutationReviewState, PromptEntry } from "../../types/ui";
import { ErrorHint, EventStageIcon, stageLabel } from "../pipelineVisuals";
import { sortPipelineEvents } from "../../lib/eventOrdering";
import { resolveRunActivity } from "./runActivity";

type ThoughtBlockProps = {
  entry: PromptEntry;
  events: PipelineEvent[];
  formatDuration: (startedAt: string, events: PipelineEvent[]) => string;
  flowMutationReview: FlowMutationReviewState | null;
  onApproveFlowMutationReview: (runId: string) => void;
  onRejectFlowMutationReview: (runId: string) => void;
  onSetComposerPrompt: (value: string) => void;
};

export function ThoughtBlock({
  entry,
  events: rawEvents,
  formatDuration,
  flowMutationReview,
  onApproveFlowMutationReview,
  onRejectFlowMutationReview,
  onSetComposerPrompt,
}: ThoughtBlockProps) {
  const events = sortPipelineEvents(rawEvents);
  const summaryEvent = [...events].reverse().find((e) => e.kind === "summary") ?? events[0];
  const actionEvents = events.filter((e) => e.kind !== "summary");
  const runActivity = resolveRunActivity(events);
  const runStage = stageLabel(runActivity.stage);
  const runElapsed =
    runActivity.state === "running"
      ? `${Math.max(1, Math.round((Date.now() - new Date(entry.submittedAt).getTime()) / 1000))}s`
      : formatDuration(entry.submittedAt, events);

  if (!summaryEvent) return null;

  return (
    <div className="chat-message chat-message--assistant">
      <span className="chat-avatar chat-avatar--assistant">
        <Bot size={12} />
      </span>
      <div className="thought-block">
        <p className="thought-block__label">Thought for {formatDuration(entry.submittedAt, events)}</p>
        <article className="thought-card">
          <div className="thought-card__summary">
            <span className="thought-card__summary-icon">
              <Sparkles size={12} />
            </span>
            <div>
              <p>{summaryEvent.message}</p>
              {typeof summaryEvent.payload?.reason === "string" ? (
                <span className="thought-card__meta">{summaryEvent.payload.reason}</span>
              ) : null}
              {flowMutationReview ? (
                <div className={`flow-review-card flow-review-card--${flowMutationReview.status}`}>
                  <div className="flow-review-card__header">
                    <strong>Review required before apply</strong>
                    <span>
                      {flowMutationReview.status === "pending"
                        ? `${flowMutationReview.commands.length} pending`
                        : flowMutationReview.status === "applying"
                          ? "Applying..."
                          : flowMutationReview.status === "applied"
                            ? "Applied"
                            : flowMutationReview.status === "rejected"
                              ? "Rejected"
                              : "Failed"}
                    </span>
                  </div>
                  <p className="flow-review-card__summary">{flowMutationReview.summary}</p>
                  {flowMutationReview.status === "pending" ? (
                    <p className="flow-review-card__hint">
                      These edits are not on the board yet. Click Apply changes to update the selected board.
                    </p>
                  ) : null}
                  <div className="flow-review-card__list">
                    {flowMutationReview.commands.map((item, index) => (
                      <div
                        key={`${flowMutationReview.runId}-${index}`}
                        className={`flow-review-card__item flow-review-card__item--${item.severity}`}
                      >
                        <span>{item.severity === "remove" ? "Remove" : "Change"}</span>
                        <p>{item.summary}</p>
                      </div>
                    ))}
                  </div>
                  {flowMutationReview.error ? (
                    <p className="flow-review-card__error">{flowMutationReview.error}</p>
                  ) : null}
                  <div className="flow-review-card__actions">
                    <button
                      type="button"
                      onClick={() => onApproveFlowMutationReview(entry.runId)}
                      disabled={flowMutationReview.status !== "pending"}
                    >
                      Apply changes
                    </button>
                    <button
                      type="button"
                      className="flow-review-card__reject"
                      onClick={() => onRejectFlowMutationReview(entry.runId)}
                      disabled={flowMutationReview.status !== "pending"}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}
              <div className={`thought-card__run-state thought-card__run-state--${runActivity.state}`}>
                <span className="thought-card__run-state-icon" aria-hidden="true">
                  {runActivity.state === "running" ? (
                    <LoaderCircle size={11} />
                  ) : runActivity.state === "done" ? (
                    <CheckCircle2 size={11} />
                  ) : (
                    <AlertCircle size={11} />
                  )}
                </span>
                <div>
                  <p>
                    {runActivity.state === "running"
                      ? `Running • ${runStage}`
                      : runActivity.state === "done"
                        ? "Done"
                        : "Failed"}
                  </p>
                  <span>{runActivity.statusDetail ?? `Elapsed ${runElapsed}`}</span>
                </div>
              </div>
              {runActivity.state === "failed"
                ? (() => {
                    const errorEvent = [...events].reverse().find((e) => e.status === "error");
                    const errorCode =
                      typeof errorEvent?.payload?.errorCode === "string"
                        ? errorEvent.payload.errorCode
                        : null;
                    const passOutputs = errorEvent?.payload?.passOutputs as
                      | Record<string, unknown>
                      | undefined;
                    const enhanceTitle =
                      typeof passOutputs?.enhance === "object" && passOutputs?.enhance !== null
                        ? (passOutputs.enhance as Record<string, unknown>).title
                        : null;
                    const planName =
                      typeof passOutputs?.plan === "object" && passOutputs?.plan !== null
                        ? (passOutputs.plan as Record<string, unknown>).frameName
                        : null;
                    return (
                      <>
                        {errorCode ? <ErrorHint errorCode={errorCode} /> : null}
                        {enhanceTitle || planName ? (
                          <details className="planned-output">
                            <summary>What was planned before failure</summary>
                            {enhanceTitle ? (
                              <p>
                                <strong>Brief:</strong> {String(enhanceTitle)}
                              </p>
                            ) : null}
                            {planName ? (
                              <p>
                                <strong>Frame:</strong> {String(planName)}
                              </p>
                            ) : null}
                          </details>
                        ) : null}
                      </>
                    );
                  })()
                : null}
              {runActivity.state === "done" ? (
                <div className="suggestion-chips">
                  {[
                    "Refine the colors",
                    "Add dark mode variant",
                    "Make it responsive",
                    "Add hover states",
                    "Simplify the layout",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion-chip"
                      onClick={() => onSetComposerPrompt(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <details className="thought-timeline-toggle">
            <summary>Show details</summary>
            <div className="thought-timeline" role="list">
              {actionEvents.length > 0 ? (
                actionEvents.map((event, index) => {
                  const calibrationOptions = Array.isArray(event.payload?.calibrationOptions)
                    ? event.payload.calibrationOptions.filter(
                        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
                      )
                    : [];
                  return (
                    <article
                      key={`${event.timestamp}-${index}`}
                      role="listitem"
                      className={`timeline-action-card timeline-action-card--${event.status}`}
                    >
                      <span className="timeline-action-card__icon">
                        <EventStageIcon stage={event.stage} />
                      </span>
                      <div className="timeline-action-card__body">
                        <p>{event.message}</p>
                        {calibrationOptions.length > 0 ? (
                          <div className="timeline-action-card__calibration">
                            {calibrationOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => onSetComposerPrompt(`/ds-calibrate ${option}`)}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : runActivity.state === "running" ? (
                <article className="timeline-action-card timeline-action-card--idle">
                  <span className="timeline-action-card__icon">
                    <LoaderCircle size={11} />
                  </span>
                  <div className="timeline-action-card__body">
                    <p>Working on the next step…</p>
                    <span>
                      {entry.mode === "edit-selected"
                        ? "editing selected frame"
                        : "preparing new frame"}
                    </span>
                  </div>
                </article>
              ) : null}
            </div>
          </details>
        </article>
      </div>
    </div>
  );
}
