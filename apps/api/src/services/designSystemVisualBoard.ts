import type {
  DesignMdColorToken,
  DesignMdTypographyToken,
  DesignSystemComponentFamily,
  DesignSystemQualityReport,
  DesignSystemVisualBoard,
  DesignSystemVisualItem,
  DesignSystemVisualSection,
  StyleProfile
} from "@designer/shared";

const CORE_SECTION_IDS = [
  "brand-foundations",
  "color-system",
  "typography-system",
  "spacing-layout",
  "shape-visual-rules",
  "core-components",
  "navigation",
  "dos-and-donts",
  "imagery-atmosphere"
] as const;

const OPTIONAL_CONFIDENCE_THRESHOLD = 0.62;

function normalizeHex(value: string) {
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
  }
  if (/^#[0-9a-f]{8}$/.test(raw)) {
    return raw.slice(0, 7);
  }
  return null;
}

function familyConfidence(quality: DesignSystemQualityReport, family: DesignSystemComponentFamily) {
  return quality.familyConfidence.find((entry) => entry.family === family)?.confidence ?? 0;
}

function recipeByFamily(profile: StyleProfile, family: DesignSystemComponentFamily) {
  return profile.componentRecipes.find((recipe) => recipe.family === family) ?? null;
}

function keepSection(sectionId: string, blocksLength: number, required: boolean) {
  if (required) {
    return true;
  }
  return blocksLength > 0;
}

function colorSwatches(colors: DesignMdColorToken[]) {
  return colors
    .map((token): DesignSystemVisualItem | null => {
      const hex = normalizeHex(token.hex);
      if (!hex) {
        return null;
      }
      return {
        label: token.name,
        hex,
        value: token.role,
        family: "brand"
      };
    })
    .filter((item): item is DesignSystemVisualItem => Boolean(item));
}

export function buildDesignSystemVisualBoard(input: {
  styleProfile: StyleProfile;
  qualityReport: DesignSystemQualityReport;
  overview: string;
  colors: DesignMdColorToken[];
  typography: DesignMdTypographyToken;
  components: string[];
  dos: string[];
  donts: string[];
}): DesignSystemVisualBoard {
  const { styleProfile, qualityReport, colors, typography } = input;
  const sections: DesignSystemVisualBoard["sections"] = [];

  const toneKeywords = styleProfile.foundations.toneKeywords.slice(0, 6).map((keyword) => ({
    label: keyword,
    family: "brand" as const
  }));
  const brandBlocks = toneKeywords.length > 0 ? [{ kind: "chips" as const, items: toneKeywords }] : [];
  sections.push({
    id: "brand-foundations",
    label: "Brand Foundations",
    required: true,
    blocks: brandBlocks
  });

  const swatches = colorSwatches(colors);
  sections.push({
    id: "color-system",
    label: "Color System",
    required: true,
    blocks: swatches.length > 0 ? [{ kind: "swatches", items: swatches }] : []
  });

  // Use real hierarchy from markdown if available, otherwise fall back to defaults
  const typeSamples: DesignSystemVisualItem[] =
    typography.hierarchy && typography.hierarchy.length > 0
      ? typography.hierarchy.slice(0, 8).map((entry) => {
          const isDisplay = /hero|display/i.test(entry.role);
          const isHeading = /heading|title|product|promo/i.test(entry.role);
          return {
            label: entry.role,
            value: `${entry.sizePx}px / ${entry.weight}`,
            fontFamily: isDisplay || isHeading ? typography.headlineFont : typography.bodyFont,
            sizePx: entry.sizePx,
            weight: entry.weight,
            family: "typography" as const
          };
        })
      : [
          {
            label: "Display",
            value: "Display",
            fontFamily: typography.headlineFont,
            sizePx: 28,
            weight: 700,
            family: "typography" as const
          },
          {
            label: "Heading",
            value: "Heading",
            fontFamily: typography.headlineFont,
            sizePx: 22,
            weight: 650,
            family: "typography" as const
          },
          {
            label: "Body",
            value: "Body copy",
            fontFamily: typography.bodyFont,
            sizePx: 14,
            weight: 500,
            family: "typography" as const
          },
          {
            label: "Label",
            value: "Label",
            fontFamily: typography.labelFont,
            sizePx: 11,
            weight: 700,
            family: "typography" as const
          }
        ];
  sections.push({
    id: "typography-system",
    label: "Typography System",
    required: true,
    blocks: [{ kind: "type-samples", items: typeSamples }]
  });

  const spacingItems = (styleProfile.tokens.spacingScale.length > 0 ? styleProfile.tokens.spacingScale : [4, 8, 12, 16, 24, 32]).map((value) => ({
    label: `${value}px`,
    value: String(value),
    sizePx: value,
    family: "spacing" as const
  }));
  sections.push({
    id: "spacing-layout",
    label: "Spacing + Layout",
    required: true,
    blocks: [
      {
        kind: "spacing-scale",
        items: spacingItems
      },
      {
        kind: "rules",
        items: [
          { label: "Grid", value: "12-col / 4-col" },
          { label: "Containers", value: "Responsive max-width" },
          { label: "Breakpoints", value: "Mobile / Tablet / Desktop" }
        ]
      }
    ]
  });

  const shapeItems: DesignSystemVisualItem[] = [];
  for (const radius of styleProfile.tokens.radiusScale.slice(0, 5)) {
    shapeItems.push({
      label: "Radius",
      value: `${radius}px`,
      sizePx: radius
    });
  }
  for (const width of styleProfile.tokens.borderWidths.slice(0, 4)) {
    shapeItems.push({
      label: "Border",
      value: `${width}px`,
      sizePx: width
    });
  }
  for (const shadow of styleProfile.tokens.shadows.slice(0, 4)) {
    shapeItems.push({
      label: "Shadow",
      value: shadow
    });
  }
  for (const opacity of styleProfile.tokens.opacityScale.slice(0, 4)) {
    shapeItems.push({
      label: "Opacity",
      value: `${Math.round(opacity * 100)}%`
    });
  }
  sections.push({
    id: "shape-visual-rules",
    label: "Shape + Visual Rules",
    required: true,
    blocks: shapeItems.length > 0 ? [{ kind: "rules", items: shapeItems }] : []
  });

  const coreFamilies: DesignSystemComponentFamily[] = ["buttons", "inputs", "cards"];
  const coreItems: DesignSystemVisualItem[] = [];
  for (const family of coreFamilies) {
    const recipe = recipeByFamily(styleProfile, family);
    const confidence = familyConfidence(qualityReport, family);
    if (!recipe || confidence < 0.48) {
      continue;
    }
    coreItems.push({
      label: family.replaceAll("-", " "),
      value: `${recipe.shape} / ${recipe.fillStyle}`,
      family,
      state: "default"
    });
    const states = recipe.states.slice(0, 3);
    for (const state of states) {
      coreItems.push({
        label: `${family.replaceAll("-", " ")} ${state.name}`,
        family,
        state: state.name === "hover" ? "active" : state.name,
        value: state.emphasis
      });
    }
  }
  sections.push({
    id: "core-components",
    label: "Core Components",
    required: true,
    blocks: coreItems.length > 0 ? [{ kind: "component-states", items: coreItems }] : []
  });

  const navRecipe = recipeByFamily(styleProfile, "navigation");
  const navConfidence = familyConfidence(qualityReport, "navigation");
  const navItems: DesignSystemVisualItem[] =
    navRecipe && navConfidence >= 0.48
      ? [
          { label: "Overview", family: "navigation", state: "active" },
          { label: "Screens", family: "navigation", state: "default" },
          { label: "Components", family: "navigation", state: "default" },
          { label: "Settings", family: "navigation", state: "default" }
        ]
      : [];
  sections.push({
    id: "navigation",
    label: "Navigation",
    required: true,
    blocks: navItems.length > 0 ? [{ kind: "navigation-items", items: navItems }] : []
  });

  const feedbackRecipe = recipeByFamily(styleProfile, "feedback");
  const feedbackConfidence = familyConfidence(qualityReport, "feedback");
  if (feedbackRecipe && feedbackConfidence >= OPTIONAL_CONFIDENCE_THRESHOLD) {
    sections.push({
      id: "feedback-status",
      label: "Feedback + Status",
      required: false,
      blocks: [
        {
          kind: "component-states",
          items: [
            { label: "Success", family: "feedback", state: "success" },
            { label: "Warning", family: "feedback", state: "focus" },
            { label: "Error", family: "feedback", state: "error" },
            { label: "Info", family: "feedback", state: "default" }
          ]
        }
      ]
    });
  }

  const dataRecipe = recipeByFamily(styleProfile, "data-display");
  const dataConfidence = familyConfidence(qualityReport, "data-display");
  if (dataRecipe && dataConfidence >= OPTIONAL_CONFIDENCE_THRESHOLD) {
    sections.push({
      id: "data-display",
      label: "Data Display",
      required: false,
      blocks: [
        {
          kind: "metric-cards",
          items: [
            { label: "Active users", value: "12,480", family: "data-display" },
            { label: "Completion", value: "76%", family: "data-display" },
            { label: "Conversion", value: "4.9%", family: "data-display" }
          ]
        }
      ]
    });
  }

  const iconRecipe = recipeByFamily(styleProfile, "iconography");
  const iconConfidence = familyConfidence(qualityReport, "iconography");
  if (iconRecipe && iconConfidence >= OPTIONAL_CONFIDENCE_THRESHOLD) {
    sections.push({
      id: "iconography-imagery",
      label: "Iconography + Imagery",
      required: false,
      blocks: [
        {
          kind: "icons",
          items: [
            { label: "circle", family: "iconography" },
            { label: "square", family: "iconography" },
            { label: "diamond", family: "iconography" },
            { label: "triangle", family: "iconography" }
          ]
        }
      ]
    });
  }

  // Do's and Don'ts section
  const dosItems: DesignSystemVisualItem[] = input.dos.slice(0, 6).map((line) => ({
    label: line.replace(/^do\s+/i, "").replace(/\.$/, ""),
    value: "do",
    family: "brand" as const
  }));
  const dontsItems: DesignSystemVisualItem[] = input.donts.slice(0, 6).map((line) => ({
    label: line.replace(/^don'?t\s+/i, "").replace(/\.$/, ""),
    value: "dont",
    family: "brand" as const
  }));
  const dosdontsBlocks = [];
  if (dosItems.length > 0) dosdontsBlocks.push({ kind: "dos-donts" as const, title: "Do", items: dosItems });
  if (dontsItems.length > 0) dosdontsBlocks.push({ kind: "dos-donts" as const, title: "Don't", items: dontsItems });
  if (dosdontsBlocks.length > 0) {
    sections.push({
      id: "dos-and-donts",
      label: "Do's & Don'ts",
      required: true,
      blocks: dosdontsBlocks
    });
  }

  // Imagery & Atmosphere section (overview excerpt)
  const overviewText = input.overview.trim();
  if (overviewText.length > 0 && overviewText !== "A calm, modern interface with strong hierarchy, brand consistency, and clear interaction affordances.") {
    // Extract key sentences (first 2-3 sentences as prose)
    const sentences = overviewText.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
    sections.push({
      id: "imagery-atmosphere",
      label: "Imagery & Atmosphere",
      required: true,
      blocks: [{ kind: "prose" as const, items: [{ label: sentences, family: "brand" as const }] }]
    });
  }

  return {
    version: 1,
    sections: sections.filter((section) => {
      const required = CORE_SECTION_IDS.includes(section.id as (typeof CORE_SECTION_IDS)[number]);
      return keepSection(section.id, section.blocks.length, required);
    })
  };
}
