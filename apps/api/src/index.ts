import "dotenv/config";
import { createServer } from "node:http";
import {
  getDatabaseConnectionInfo,
  getPipelineEvents,
  initDatabase
} from "./db.js";
import { RunHub } from "./services/runHub.js";
import { WebSocketServer } from "ws";
import { createApp } from "./http/createApp.js";

const API_PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);

const runHub = new RunHub(getPipelineEvents);
const app = createApp({ runHub });
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const match = request.url?.match(/^\/runs\/([^/]+)\/stream$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const runId = decodeURIComponent(match[1]);
  wss.handleUpgrade(request, socket, head, (ws) => {
    (ws as unknown as { runId: string }).runId = runId;
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  const runId = (ws as unknown as { runId?: string }).runId;
  if (!runId) {
    ws.close();
    return;
  }

  void runHub.attach(runId, ws);
});

initDatabase()
  .then(() => {
    server.listen(API_PORT, () => {
      console.log(`Designer API listening on http://localhost:${API_PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize API", error);
    const code = (error as { code?: string }).code;
    console.error(`Database connection: ${getDatabaseConnectionInfo()}`);

    if (code === "28000") {
      console.error(
        "Postgres authentication failed. Set DATABASE_URL with a valid local role, e.g. postgresql://<user>@localhost:5432/<database>"
      );
    } else if (code === "3D000") {
      console.error(
        "Postgres database does not exist. Create it first, or set DATABASE_URL/PGDATABASE to an existing database."
      );
    }

    process.exit(1);
  });
