IMPECCABLE DESIGN LAWS:
The following laws apply to every screen. They exist to prevent "AI slop" — predictable, generic, or broken patterns that make interfaces look machine-generated.

## ABSOLUTE BANS — never write these

- **Side-stripe borders**: `border-left` or `border-right` >1px as a colored accent on cards, callouts, or alerts. Use full borders, background tints, or leading icons instead.
- **Gradient text**: `background-clip: text` + gradient. Use a solid color. Emphasis via weight or size only.
- **Glassmorphism as default**: Blurs and glass cards used decoratively everywhere. Only when purposeful.
- **Hero-metric template**: Big number + small label + supporting stats + gradient accent. SaaS cliché — redesign the element.
- **Identical card grids**: Same-sized cards with icon + heading + text, repeated endlessly.
- **Modal as first thought**: Exhaust inline and progressive-disclosure alternatives first.
- **Nested cards**: Never place cards inside cards. Use spacing, typography, and subtle dividers for inner hierarchy.
- **Pure black or white**: Never `#000` or `#fff`. Tint every neutral toward the brand hue (chroma 0.005–0.01 minimum).
- **Bounce or elastic easing**: Amateurish. Use exponential ease-out curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Gray text on colored backgrounds**: Gray looks dead on color. Use a darker shade of the background color instead.
- **Same padding everywhere**: Uniform spacing is monotony. Vary spacing intentionally for rhythm and hierarchy.
- **Wrapping everything in a container**: Most things don't need one. Be selective.
- **Em dashes in copy**: Use commas, colons, semicolons, or parentheses instead.

## COLOR

- Use OKLCH. Reduce chroma as lightness approaches 0 or 100 — high chroma at extremes looks garish.
- Choose a **color strategy** before picking colors: Restrained (tinted neutrals + one accent ≤10%), Committed (one saturated color at 30–60%), Full palette (3–4 named roles), or Drenched. Don't collapse every design to Restrained by reflex.
- Add a tiny chroma (0.005–0.015) to all neutrals, hued toward THIS project's brand color — not generic warm-orange or cool-blue.
- Dark mode: depth from surface lightness (15%/20%/25% steps), never pure black. Desaturate accents slightly. Reduce body text weight (e.g. 350 instead of 400).
- Placeholder text must pass 4.5:1 contrast — that light gray placeholder almost always fails.

## TYPOGRAPHY

- Line-height is the base unit for ALL vertical spacing. Body at 16px × 1.5 = 24px; all spacing multiples flow from that.
- Use fewer sizes with more contrast: xs / sm / base / lg / xl+. Don't create many sizes that are too close together.
- Cap body line length at 65–75ch with `max-width: 65ch`.
- Dark backgrounds require three compensations: bump line-height +0.05–0.1, add letter-spacing +0.01–0.02em, step body weight up one notch.
- ALL-CAPS labels need letter-spacing: 0.05–0.12em. They sit too tight at default.
- Use `text-wrap: balance` on headings; `text-wrap: pretty` on long prose.
- Tabular numbers in data tables: `font-variant-numeric: tabular-nums`.
- One well-chosen font in multiple weights beats two competing typefaces. Never pair fonts that are similar but not identical.

## LAYOUT & SPACE

- 4pt base scale: 4, 8, 12, 16, 24, 32, 48, 64, 96px. Name tokens semantically (`--space-sm`, not `--spacing-8`).
- The squint test: blur your eyes — you must still identify the #1 and #2 most important elements. If everything looks the same weight blurred, you have a hierarchy problem.
- Best hierarchy uses 2–3 dimensions at once: a heading that is larger, bolder, AND has more space above it.
- Cards are overused. Spacing and alignment create grouping naturally. Only use cards when content is truly distinct, actionable, or needs visual comparison.
- Container queries for components: use `container-type: inline-size` so cards adapt to their container, not the viewport.
- `gap` instead of margins for sibling spacing — eliminates margin collapse.

## MOTION

- Duration guide: 100–150ms instant feedback, 200–300ms state changes, 300–500ms layout changes, 500–800ms entrance animations. Exit is ~75% of enter duration.
- Default easing for entering: `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out). Never `ease` — it's a compromise that's rarely optimal.
- Prefer `transform` + `opacity`. For premium effects: blur/filter reveals, clip-path wipes, shadow bloom — but only when it stays smooth on target viewports.
- `prefers-reduced-motion` is not optional. Vestibular disorders affect ~35% of adults over 40. Provide fade alternatives, not just disable.
- Never animate layout-driving properties casually (`width`, `height`, `top`, `left`, margins).

## THE AI SLOP TEST

Before finishing a screen, check two questions:
1. Could someone guess the theme and palette just from knowing the product category? ("Observability → dark blue", "Healthcare → white + teal") — if yes, rework it.
2. Could they guess the aesthetic family one step deeper? — if yes, rework again.
The answer to both must be non-obvious for the screen to pass.
