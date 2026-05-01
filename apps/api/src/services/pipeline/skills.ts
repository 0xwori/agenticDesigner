import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevicePreset, SurfaceTarget } from "@designer/shared";
import { isMobilePreset } from "@designer/shared";
import { WEB_DESIGN_SKILL } from "./skills-web.js";
import { MOBILE_DESIGN_SKILL } from "./skills-mobile.js";

const FALLBACK_DECK_SKILL = `
PRESENTATION DECK DESIGN SKILL:
You are a senior presentation designer. Create structured, editable business decks with clear narrative progression.
- Use exactly the requested slide count.
- Every slide needs one focused message, editable text blocks, and speaker notes.
- Use the project design system for colors, type, spacing, radius, and visual motifs.
- Prefer concise slide copy, strong hierarchy, and reusable blocks.
- Never include implementation details or mention AI/tooling in the slide content.
`;

function readSkill(name: string, fallback: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "skills", name),
    join(process.cwd(), "apps/api/src/services/pipeline/skills", name)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  return fallback;
}

export function getDesignSkill(input: { surfaceTarget?: SurfaceTarget; devicePreset: DevicePreset }) {
  const surface = input.surfaceTarget ?? (isMobilePreset(input.devicePreset) ? "mobile" : "web");
  const impeccable = readSkill("impeccable-design.md", "");

  let surfaceSkill: string;
  if (surface === "deck") {
    surfaceSkill = readSkill("deck-skill.md", FALLBACK_DECK_SKILL);
  } else if (surface === "mobile" || isMobilePreset(input.devicePreset)) {
    surfaceSkill = readSkill("mobile-skill.md", MOBILE_DESIGN_SKILL);
  } else {
    surfaceSkill = readSkill("web-skill.md", WEB_DESIGN_SKILL);
  }

  return impeccable ? `${surfaceSkill}\n\n${impeccable}` : surfaceSkill;
}
