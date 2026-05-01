# Product

## Register
product

## Product Purpose
AgenticDesigner is a conversational UI design tool. Designers and product teams describe a screen in plain language, and the tool generates production-grade React/HTML+CSS in a live artboard. Designs stay reference-aware — users can attach Figma links to pull in a real design system (colors, typography, spacing, component recipes) and the generator respects it as a binding contract.

## Users
- Product designers who want to prototype ideas faster without hand-coding.
- Frontend engineers who want a starting point that already matches the project's design system.
- Product managers sketching flows for stakeholder reviews.
- Small product teams without dedicated design resources.

## Core Flows
1. **Prompt → screen**: type a description, get a rendered screen in seconds.
2. **Reference-aware generation**: attach a Figma link, the tool extracts the design system, subsequent screens respect it.
3. **Edit in place**: click a block on the artboard, describe the change, the screen updates.
4. **Copy to Figma**: push a generated frame to Figma canvas via the official code-to-canvas API.
5. **Flow board**: string screens together into a user journey flow.

## Brand Tone
Precise, fast, honest. The UI gets out of the way. No empty flourishes — the generated screen IS the product. Trust the designer to know what they want; don't oversimplify or add guardrails they didn't ask for.

## Anti-References
Designs to explicitly NOT look like:
- Generic SaaS dashboards (cluttered, sidebar-heavy, dark blue + orange CTA)
- Notion-clone off-white editors (too quiet, no visual hierarchy)
- Figma plugin UIs (grey forms with tight padding)
- AI-chatbot interfaces with oversized input fields and chat bubbles as the primary UI

## Strategic Principles
- Speed is the product. Latency kills trust. The artboard must feel live.
- Prompt → screen is the golden path. Everything else is secondary.
- The design system is a binding contract, not a suggestion.
- Artboard fidelity matters — the generated screen must look like a real screen, not a demo.
- Figma is the exit, not the source of truth during generation.
