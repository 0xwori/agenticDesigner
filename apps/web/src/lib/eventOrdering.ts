import type { PipelineEvent } from "@designer/shared";

const CLIENT_ORDER_KEY = "__clientOrder";

function getClientOrder(event: PipelineEvent): number | null {
  const value = event.payload?.[CLIENT_ORDER_KEY];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function hasServerId(event: PipelineEvent): event is PipelineEvent & { id: number } {
  return typeof event.id === "number" && Number.isFinite(event.id);
}

export function annotateClientOrder(event: PipelineEvent, order: number): PipelineEvent {
  return {
    ...event,
    payload: {
      ...(event.payload ?? {}),
      [CLIENT_ORDER_KEY]: order
    }
  };
}

export function comparePipelineEvents(a: PipelineEvent, b: PipelineEvent) {
  const aHasServerId = hasServerId(a);
  const bHasServerId = hasServerId(b);

  // Server events are persisted with monotonic IDs. Prefer that ordering first.
  if (aHasServerId && bHasServerId) {
    return a.id - b.id;
  }

  const aOrder = getClientOrder(a);
  const bOrder = getClientOrder(b);

  // For local/system events, keep append order deterministic.
  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  const byTime = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  if (Number.isFinite(byTime) && byTime !== 0) {
    return byTime;
  }

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  if (aHasServerId !== bHasServerId) {
    return aHasServerId ? -1 : 1;
  }

  return 0;
}

export function sortPipelineEvents(events: PipelineEvent[]) {
  return [...events].sort(comparePipelineEvents);
}
