import type { PipelineEvent } from "@designer/shared";
import type { WebSocket } from "ws";

type EventLoader = (runId: string) => Promise<PipelineEvent[]>;

export class RunHub {
  private readonly channels = new Map<string, Set<WebSocket>>();

  constructor(private readonly loadBacklog: EventLoader) {}

  async attach(runId: string, socket: WebSocket) {
    const channel = this.channels.get(runId) ?? new Set<WebSocket>();
    channel.add(socket);
    this.channels.set(runId, channel);

    socket.on("close", () => {
      const current = this.channels.get(runId);
      if (!current) {
        return;
      }

      current.delete(socket);
      if (current.size === 0) {
        this.channels.delete(runId);
      }
    });

    try {
      const backlog = await this.loadBacklog(runId);
      for (const event of backlog) {
        this.send(socket, event);
      }
    } catch (error) {
      this.send(socket, {
        runId,
        timestamp: new Date().toISOString(),
        stage: "system",
        status: "error",
        kind: "status",
        message: "Failed to load event backlog.",
        payload: {
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  broadcast(runId: string, event: PipelineEvent) {
    const channel = this.channels.get(runId);
    if (!channel || channel.size === 0) {
      return;
    }

    for (const socket of channel) {
      this.send(socket, event);
    }
  }

  private send(socket: WebSocket, event: PipelineEvent) {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(event));
  }
}
