import { describe, expect, it } from "vitest";
import type { PipelineEvent } from "@designer/shared";
import { annotateClientOrder, sortPipelineEvents } from "./eventOrdering";

function event(input: Partial<PipelineEvent> & Pick<PipelineEvent, "runId" | "message">): PipelineEvent {
  return {
    runId: input.runId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    stage: input.stage ?? "system",
    status: input.status ?? "info",
    kind: input.kind ?? "summary",
    message: input.message,
    payload: input.payload,
    id: input.id
  };
}

describe("event ordering", () => {
  it("orders server events by persisted id", () => {
    const events = [
      event({ runId: "r1", id: 3, timestamp: "2026-03-22T10:00:03.000Z", message: "third" }),
      event({ runId: "r1", id: 1, timestamp: "2026-03-22T10:00:01.000Z", message: "first" }),
      event({ runId: "r1", id: 2, timestamp: "2026-03-22T10:00:02.000Z", message: "second" })
    ];

    const sorted = sortPipelineEvents(events);
    expect(sorted.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("orders local events by client append order", () => {
    const first = annotateClientOrder(event({ runId: "r1", message: "first-local" }), 1);
    const second = annotateClientOrder(event({ runId: "r1", message: "second-local" }), 2);
    const sorted = sortPipelineEvents([second, first]);

    expect(sorted.map((entry) => entry.message)).toEqual(["first-local", "second-local"]);
  });

  it("keeps deterministic order for mixed local and server events", () => {
    const localStart = annotateClientOrder(event({ runId: "r1", message: "start" }), 1);
    const server1 = annotateClientOrder(
      event({ runId: "r1", id: 11, timestamp: "2026-03-22T10:01:00.000Z", message: "server-1" }),
      2
    );
    const server2 = annotateClientOrder(
      event({ runId: "r1", id: 12, timestamp: "2026-03-22T10:01:01.000Z", message: "server-2" }),
      3
    );

    const sorted = sortPipelineEvents([server2, localStart, server1]);
    expect(sorted.map((entry) => entry.message)).toEqual(["start", "server-1", "server-2"]);
  });
});
