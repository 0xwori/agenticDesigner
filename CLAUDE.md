# AGENTS Guide - AgenticDesigner (Root)

## Project context
AgenticDesigner is a standalone conversational UI design app:
- Prompt-first screen generation through a chat-style prompter.
- Reference-aware design via Figma links (public-link sync).
- Per-frame editable copy-to-Figma using the official code-to-canvas flow.
- Multi-pass generation pipeline (`enhance -> plan -> generate -> repair -> diff-repair`) orchestrated by the backend API.

## Core principle (KISS)
- Keep It Simple, Stupid: prefer small, understandable modules and predictable behavior over complex abstractions.
- Choose the least-complex implementation that satisfies reliability and product requirements.
- If a fix can be isolated without touching unrelated flows, isolate it.

## Workspace map
- `apps/web`: React + Vite frontend (prompter, artboard, frames, Figma copy flow).
- `apps/api`: Express + WebSocket backend (pipeline orchestration + Postgres persistence).
- `packages/shared`: shared contracts/types for web and API.
- `docs/figma-capture-learnings.md`: proven capture flow and diagnostics notes.
- `docs/reliability-audit.md`: reliability issue matrix and remediation status.
- `skills.md`: design-agent persona and style constraints.

## Current architecture rules
- Keep `apps/web/src/App.tsx` as orchestration/state container.
- UI rendering belongs in components (`PromptPanel`, `ArtboardPane`, `FrameCard`, `DesignSystemBoard`, etc.).
- Shared API/data contracts must live in `packages/shared`.
- Avoid re-introducing monolithic UI logic in a single file.
- Prefer feature-oriented component boundaries over utility-heavy inline JSX.

## Backend and database rules
- Database connection precedence:
  1. `DATABASE_URL`
  2. `POSTGRES_URL`
  3. fallback `postgresql://localhost:5432/<PGDATABASE or postgres>`
- Common startup failures and exact remediation:
  - `role "postgres" does not exist` (`28000`):
    Use a valid local role, e.g. `DATABASE_URL=postgresql://$USER@localhost:5432/postgres`.
  - `database "<name>" does not exist` (`3D000`):
    Create it first (`createdb <name>`) or point `DATABASE_URL`/`PGDATABASE` to an existing DB.
- Keep API startup diagnostics explicit and redact secrets in connection logs.

## Frontend and Figma rules
- Preserve the official Figma code-to-canvas copy path (`capture.js` + `window.figma.captureForDesign`).
- Keep copy diagnostics visible and copyable for debugging.
- Reference ingestion is link-first (`+ Figma` / reference link input), not file upload in v1.
- Render synced style context visibly on artboard (design-system board: colors, type, spacing, radius, patterns).
- Do not add screenshot fallback paths for copy-to-Figma failures.

## Agent run rules (current scripts only)
- Use only existing root scripts:
  - `npm run dev`
  - `npm run dev:api`
  - `npm run dev:web`
  - `npm run build`
  - `npm run test`
  - `npm run start:api`
- After code changes, run `npm run build` and then `npm run test` at repo root unless explicitly told to skip.
- Do not document or require nonexistent root scripts (`format`, `check`).

## Electron migration guidance (non-binding)
- Keep renderer logic platform-agnostic so it can move into an Electron renderer without rewrite.
- Keep side effects isolated behind modules/services (API layer, capture bridge, persistence adapters).
- Avoid direct Node/Electron API usage inside React components.
- Treat desktop-specific integrations as adapters around existing web app boundaries.
