import cors from "cors";
import express from "express";
import type { RunHub } from "../services/runHub.js";
import { defaultApiDeps, type ApiDeps } from "./deps.js";
import { sendApiError } from "./errors.js";
import { registerFrameRunRoutes } from "./routes/framesRuns.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerReferenceRoutes } from "./routes/references.js";

type CreateAppOptions = {
  corsOrigin?: string;
  deps?: Partial<ApiDeps>;
  runHub: RunHub;
};

export function createApp(options: CreateAppOptions) {
  const corsOrigin = options.corsOrigin ?? process.env.CORS_ORIGIN ?? "*";
  const deps = {
    ...defaultApiDeps,
    ...(options.deps ?? {})
  } as ApiDeps;

  const app = express();
  app.use(
    cors({
      origin: corsOrigin === "*" ? true : corsOrigin
    })
  );
  app.use(express.json({ limit: "15mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  registerProjectRoutes(app, deps);
  registerReferenceRoutes(app, deps);
  registerFrameRunRoutes(app, deps, options.runHub);

  app.use((_request, response) => {
    sendApiError(response, 404, "Not found.", "not_found");
  });

  return app;
}
