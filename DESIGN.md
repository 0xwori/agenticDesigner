# Design System

## Visual Theme & Atmosphere
Clean, tool-first UI. Dense information display without feeling crowded. The chrome (navigation, panels, controls) should recede so the artboard — the generated screen — stays the hero. Dark or neutral surfaces for the shell; the artboard itself is always lit.

## Color Palette
- Background: `oklch(14% 0.008 260)` — near-black with a faint blue-gray tint
- Surface: `oklch(18% 0.008 260)` — panel and card surfaces
- Elevated: `oklch(22% 0.01 260)` — modals, popovers, active states
- Border: `oklch(30% 0.008 260)` — subtle separators
- Text primary: `oklch(95% 0.005 260)` — main text on dark
- Text secondary: `oklch(65% 0.005 260)` — captions, labels, metadata
- Accent: `oklch(62% 0.22 265)` — interactive elements, primary actions (muted indigo-blue)
- Accent hover: `oklch(68% 0.22 265)`
- Success: `oklch(70% 0.18 145)` — green for pipeline complete, diffs
- Warning: `oklch(75% 0.18 75)` — amber for partial states
- Destructive: `oklch(60% 0.22 25)` — red for errors

## Typography
- UI font: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`) — native, fast, no FOUT
- Code / output: `"JetBrains Mono", "Fira Code", monospace`
- Body size: 13–14px for dense tool UI
- Line-height: 1.5 for readable labels; 1.4 for compact panel rows
- Font weights: 400 body, 500 labels/buttons, 600 headings

## Spacing Scale
4pt base: 4, 8, 12, 16, 24, 32, 48, 64px
Panel padding: 12–16px. Inline element gaps: 8px. Section separation: 24–32px.

## Border Radius
- Controls (inputs, buttons): 6px
- Cards / panels: 8px
- Modals / sheets: 12px
- Pill badges: 999px

## Elevation
- Flat: border only — `oklch(30% 0.008 260)`
- Raised: `0 1px 3px oklch(0% 0 0 / 0.3)` — panel headers
- Floating: `0 8px 24px oklch(0% 0 0 / 0.5), 0 2px 6px oklch(0% 0 0 / 0.2)` — modals, dropdowns

## Component Patterns
- **Buttons**: filled accent for primary, ghost (border + text) for secondary, text-only for tertiary. Height 32px compact / 36px default.
- **Inputs**: dark surface fill, 1px border, 36px height, 6px radius.
- **Panels**: no card shadow — use border + surface color difference for hierarchy.
- **Badges/tags**: pill shape, 12px font, tight horizontal padding.
- **Artboard**: white/light background always — contrast with the dark shell.

## Do's
- Let the artboard breathe — minimal chrome around it.
- Use accent color sparingly (≤10% surface); it signals interactivity.
- Prefer border + surface difference over shadows for panel depth.
- Monospace for any generated code, file paths, frame IDs.

## Don'ts
- No decorative gradients on the shell UI.
- No excessive rounded corners on tool panels (feels consumer, not professional).
- No full-bleed color in the chrome — keep it neutral so artboard colors pop.
- No loading spinners where skeleton or progress indicators work better.
