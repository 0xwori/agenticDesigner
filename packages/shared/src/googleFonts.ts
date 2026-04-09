/**
 * Map known font families to Google Fonts slugs.
 * When a font isn't in this map we attempt a best-effort slug from the name.
 */

const KNOWN_FONTS: Record<string, string> = {
  // Sans-serif
  "inter": "Inter",
  "sora": "Sora",
  "manrope": "Manrope",
  "plus jakarta sans": "Plus+Jakarta+Sans",
  "dm sans": "DM+Sans",
  "poppins": "Poppins",
  "open sans": "Open+Sans",
  "lato": "Lato",
  "roboto": "Roboto",
  "montserrat": "Montserrat",
  "nunito": "Nunito",
  "nunito sans": "Nunito+Sans",
  "work sans": "Work+Sans",
  "source sans 3": "Source+Sans+3",
  "source sans pro": "Source+Sans+Pro",
  "raleway": "Raleway",
  "outfit": "Outfit",
  "figtree": "Figtree",
  "geist": "Geist",
  "space grotesk": "Space+Grotesk",
  "instrument sans": "Instrument+Sans",
  "lexend": "Lexend",
  "be vietnam pro": "Be+Vietnam+Pro",
  "albert sans": "Albert+Sans",
  "red hat display": "Red+Hat+Display",
  "red hat text": "Red+Hat+Text",
  "barlow": "Barlow",
  "rubik": "Rubik",
  "karla": "Karla",
  "mulish": "Mulish",
  "urbanist": "Urbanist",
  "cabin": "Cabin",
  "quicksand": "Quicksand",
  "josefin sans": "Josefin+Sans",
  "archivo": "Archivo",
  "overpass": "Overpass",
  "ubuntu": "Ubuntu",
  "pt sans": "PT+Sans",
  "noto sans": "Noto+Sans",
  "ibm plex sans": "IBM+Plex+Sans",
  "ibm plex mono": "IBM+Plex+Mono",
  "oxanium": "Oxanium",
  "exo 2": "Exo+2",
  "maven pro": "Maven+Pro",
  "space mono": "Space+Mono",
  "fira code": "Fira+Code",
  "jetbrains mono": "JetBrains+Mono",
  // Serif
  "playfair display": "Playfair+Display",
  "merriweather": "Merriweather",
  "lora": "Lora",
  "libre baskerville": "Libre+Baskerville",
  "dm serif display": "DM+Serif+Display",
  "dm serif text": "DM+Serif+Text",
  "crimson text": "Crimson+Text",
  "bitter": "Bitter",
  "source serif 4": "Source+Serif+4",
  "cormorant garamond": "Cormorant+Garamond",
  "eb garamond": "EB+Garamond",
  "pt serif": "PT+Serif",
  "noto serif": "Noto+Serif",
  "fraunces": "Fraunces",
  // Display
  "bebas neue": "Bebas+Neue",
  "orbitron": "Orbitron",
  "rajdhani": "Rajdhani",
  "teko": "Teko",
  "righteous": "Righteous",
  "anton": "Anton",
  "oswald": "Oswald",
  "archivo black": "Archivo+Black",
  "permanent marker": "Permanent+Marker",
};

/** System / generic families that should never hit Google Fonts */
const SYSTEM_FAMILIES = new Set([
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "helvetica", "helvetica neue",
  "arial", "sans-serif", "serif", "monospace", "cursive",
  "sf pro", "sf pro display", "sf pro text", "sf pro rounded",
  "apple color emoji", "segoe ui emoji", "noto color emoji",
]);

function stripFallbacks(fontFamily: string): string {
  // Take first family from comma-separated list
  const first = fontFamily.split(",")[0]?.trim() ?? "";
  // Remove quotes
  return first.replace(/^["']|["']$/g, "").trim();
}

function isSystemFont(family: string): boolean {
  return SYSTEM_FAMILIES.has(family.toLowerCase());
}

/**
 * Build a Google Fonts slug from a font family name,
 * returning null for system fonts or unrecognized names.
 */
function fontToGoogleSlug(family: string): string | null {
  const clean = stripFallbacks(family);
  if (!clean || isSystemFont(clean)) return null;

  const lower = clean.toLowerCase();
  const known = KNOWN_FONTS[lower];
  if (known) return known;

  // Best-effort: capitalize each word and join with +
  // Only attempt if it looks like a real font name (2+ chars, no special chars)
  if (lower.length < 2 || /[{}()[\]@#$%^&*=<>]/.test(lower)) return null;
  return clean
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("+");
}

/**
 * Build a Google Fonts <link> tag for the given font families (if any match).
 * Returns empty string if no fonts need loading.
 */
export function buildGoogleFontsLink(families: string[]): string {
  const slugs = new Set<string>();
  for (const family of families) {
    const slug = fontToGoogleSlug(family);
    if (slug) slugs.add(slug);
  }
  if (slugs.size === 0) return "";
  const params = [...slugs].map((s) => `family=${s}:wght@300;400;500;600;700;800`).join("&");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${params}&display=swap" rel="stylesheet">`;
}

/**
 * Extract unique non-system font families from a CSS string.
 */
export function extractFontFamiliesFromCss(css: string): string[] {
  const families = new Set<string>();
  const matches = css.matchAll(/font-family\s*:\s*([^;}{]+)/gi);
  for (const m of matches) {
    const raw = m[1]?.trim() ?? "";
    // Each comma-separated family
    for (const part of raw.split(",")) {
      const clean = part.trim().replace(/^["']|["']$/g, "").trim();
      if (clean && !isSystemFont(clean)) {
        families.add(clean);
      }
    }
  }
  return [...families];
}
