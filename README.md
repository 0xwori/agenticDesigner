# Conversational UI Designer

Standalone web app for prompt-driven UI generation with a reference-aware design pipeline and per-frame editable copy-to-Figma.

## Architecture
- `apps/web`: React + Vite app with chat panel, artboard, frame runtime, and copy-to-Figma flow.
- `apps/api`: Express + WebSocket orchestration API with Postgres persistence and multi-pass pipeline.
- `packages/shared`: shared types/contracts used by both apps.
- `docs/figma-capture-learnings.md`: practical notes from the POC capture work.
- `skills.md`: design-agent persona and quality constraints.

## Key capabilities
- Chat-first generation UX with warm progress summaries and action blocks.
- Miro-like flexible artboard with desktop/iPhone frame presets, drag, resize, and selection.
- Five-pass pipeline: `enhance -> plan -> generate -> repair -> diff-repair`.
- Per-frame copy-to-Figma using official code-to-canvas capture runtime (`capture.js` + `window.figma.captureForDesign`).
- Reference links from public Figma pages/frames with automatic style-context sync.
- Provider/model selection for OpenAI, Anthropic, and Google.

## Local setup

1. Ensure Postgres is running.
2. Configure DB connection:
   - Preferred: copy `.env.example` to `.env` and set `DATABASE_URL`.
   - Default fallback (if no `DATABASE_URL`): `postgresql://localhost:5432/<your-os-user-or-PGDATABASE>`.
3. Create the target database if needed.
   - Example: `createdb agentic_designer`
   - Or set `PGDATABASE` / `DATABASE_URL` to an existing DB.
4. Install dependencies and build:

```bash
npm install
npm run build
```

5. Run both apps:

```bash
npm run dev
```

Default URLs:
- Web app: `http://localhost:5173`
- API: `http://localhost:8787`

Common local Postgres fix:
- If you see `role "postgres" does not exist`, use your own role instead:
  `DATABASE_URL=postgresql://$USER@localhost:5432/postgres`

## API Surface (v1)
- `POST /projects`
- `GET /projects/:id`
- `PATCH /projects/:id/settings`
- `POST /projects/:id/references`
- `POST /references/:id/resync`
- `POST /projects/:id/frames`
- `PATCH /frames/:id/layout`
- `GET /frames/:id`
- `GET /frames/:id/versions`
- `POST /projects/:id/generate`
- `POST /frames/:id/edit`
- `WS /runs/:runId/stream`

## Copy-to-Figma workflow
1. Generate or select a frame.
2. Click **Copy to Figma** on that frame.
3. Wait for **Copied**.
4. Paste in an open Figma file.

If copy fails, open **Copy Debug Logs** on the frame card and use the stage/error details.
