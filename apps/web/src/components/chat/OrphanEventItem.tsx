import React from "react";
import type { PipelineEvent } from "@designer/shared";
import { EventStageIcon, stageLabel } from "../pipelineVisuals";

type OrphanEventItemProps = {
  event: PipelineEvent;
};

export function OrphanEventItem({ event }: OrphanEventItemProps) {
  return (
    <article className={`timeline-item timeline-item--${event.status}`}>
      <span className="timeline-icon">
        <EventStageIcon stage={event.stage} />
      </span>
      <div>
        <p className="timeline-message">{event.message}</p>
        <p className="timeline-meta">{stageLabel(event.stage)}</p>
      </div>
    </article>
  );
}
