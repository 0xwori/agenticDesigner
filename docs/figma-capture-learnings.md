# Figma Capture Learnings (POC)

## What worked reliably
- Editable paste required Figma's official Code-to-Canvas runtime: `https://mcp.figma.com/mcp/html-to-design/capture.js`.
- Clipboard capture worked when triggering `window.figma.captureForDesign({ selector })` from a visible DOM target.
- A strict diagnostics trail made troubleshooting practical: script load, API detection, payload, completion/error.

## What failed repeatedly
- Custom clipboard payloads (`image/svg+xml`, PNG fallbacks) were not reliable for the editable paste goal.
- Silent fallbacks masked root causes and created false positives.
- Hash-based app routing conflicted with Figma capture hash flags in some flows.

## Operational requirements we keep
- No screenshot/image fallback path.
- Capture errors must be explicit and include error message/stack when available.
- The user should be able to paste directly into an open Figma file immediately after capture succeeds.

## Current policy
- Per-frame copy action calls official capture runtime.
- Failures stay visible in frame-level debug logs.
- Auto-layout optimization is treated as a follow-up optimization, not a v1 hard gate.
