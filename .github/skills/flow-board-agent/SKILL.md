---
name: flow-board-agent
description: "Use when: reviewing, editing, expanding, or exporting a flow board as a user journey. Covers missed happy-path steps, unhappy paths, edge cases, and concise technical briefings for API, SDK, auth, session, cache, and refresh-on-load behavior."
---

# Flow Board Agent

## Purpose

This skill describes how the flow-mode board agent should reason about a single selected flow board.

## Scope

- Only operate on the currently selected flow board.
- Never read from or mutate sibling flow boards.
- Treat the board as one journey artifact containing user journey, normal flow, unhappy path, and technical briefing lanes.

## What Good Looks Like

- Review the whole board before deciding on mutations.
- Preserve strong existing structure when possible.
- Add missing happy-path steps when a sequence skips key user actions.
- Add unhappy-path branches for obvious failure or recovery cases.
- Add concise technical briefs when the flow implies implementation constraints.
- Keep technical briefs short and delivery-focused.

## Technical Brief Topics

- API calls and payload expectations.
- SDK or third-party integration hooks.
- Auth, session, and token refresh behavior.
- Cache, optimistic state, and refresh-on-load requirements.
- Retry, timeout, and fallback behavior.

## Export Guidance

- A board-to-story export should produce one implementation-ready user story.
- Include clear acceptance criteria.
- Include technical notes only when they materially affect delivery.