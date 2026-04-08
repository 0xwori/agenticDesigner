# Reliability Audit Matrix

Date: 2026-03-22

## Scope
- Prompt -> run start
- Timeline event ordering
- Reference attach/resync
- iPhone quality validation
- Frame placement/focus
- Copy-to-Figma diagnostics

## Matrix

| Flow | Symptom | Root Cause | Fix Applied | Status |
| --- | --- | --- | --- | --- |
| Prompt -> run | Local/system timeline items could appear out of order vs streamed events | Client sorted mostly by timestamp; mixed local/server event ordering was unstable | Added shared ordering utility with server `id` priority and client append-order fallback; all local+stream events are annotated with client order | Fixed |
| Timeline rendering | Prompt panel had separate sort logic from app container | Duplicate ordering logic diverged | Prompt panel now uses shared `sortPipelineEvents` utility | Fixed |
| iPhone generation validation | Valid mobile screens were failing with "desktop/marketing" and "mobile composition" errors | Validator keyword checks were too broad (false positives from copy text) and mobile cues were too narrow | Tightened marketing detection to structural cues; relaxed mobile composition detection to include app-layout markers and practical touch-target ranges | Fixed |
| Canvas pan/zoom feel | Trackpad pan felt jumpy and zoom gesture detection was inconsistent | Direct wheel -> immediate transform updates and ctrl-only pinch filter | Added smooth rAF/damping pan controller; zoom now accepts `ctrl` or `meta` gesture modifiers with tuned deltas | Fixed |
| Attach/resync troubleshooting | Failures were hard to triage from chat | Inconsistent guidance between fallback paths | Chat now consistently surfaces fallback retry guidance and credential path from API responses | Improved |
| Frame placement | Potential near-collision when many frames exist | Placement and collision logic needed deterministic reuse across flows | Pipeline now routes through shared layout utilities (`layout.ts`) used by manual, reference, and run creation paths | Improved |
| Copy-to-Figma diagnostics | Debugging relied on per-frame logs only | No single source-of-truth note for operators | Existing diagnostics retained; AGENTS and docs now enforce explicit build/test discipline before release | Improved |

## Follow-up candidates
1. Add optimistic placement reservation to avoid overlap in highly concurrent multi-run scenarios.
2. Add integration tests for attach/resync fallback branches with mocked MCP failures.
3. Add dedicated canvas interaction tests in browser-mode E2E.
