/**
 * Brand template manifest.
 * Each entry references a DESIGN.md that ships bundled (Vite ?raw import).
 */

export type BrandCategory =
  | "AI & ML"
  | "Developer Tools"
  | "Infrastructure"
  | "Design & Productivity"
  | "Fintech & Crypto"
  | "Enterprise & Consumer"
  | "Automotive";

export interface BrandEntry {
  /** Unique slug (matches filename without extension) */
  id: string;
  /** Display name */
  name: string;
  category: BrandCategory;
  /** Short tagline for the card */
  tagline: string;
  /** Brand accent hex for the preview strip */
  accent: string;
}

export const BRAND_TEMPLATES: BrandEntry[] = [
  // ───── AI & ML ─────
  { id: "claude", name: "Claude", category: "AI & ML", tagline: "Warm terracotta, editorial layout", accent: "#c96442" },
  { id: "cohere", name: "Cohere", category: "AI & ML", tagline: "Vibrant gradients, data-rich dashboards", accent: "#39594d" },
  { id: "elevenlabs", name: "ElevenLabs", category: "AI & ML", tagline: "Dark cinematic, audio-wave aesthetics", accent: "#000000" },
  { id: "minimax", name: "Minimax", category: "AI & ML", tagline: "Bold dark interface, neon accents", accent: "#1456f0" },
  { id: "mistral.ai", name: "Mistral AI", category: "AI & ML", tagline: "French-engineered minimalism, purple-toned", accent: "#fa520f" },
  { id: "ollama", name: "Ollama", category: "AI & ML", tagline: "Terminal-first, monochrome simplicity", accent: "#000000" },
  { id: "opencode.ai", name: "OpenCode AI", category: "AI & ML", tagline: "Developer-centric dark theme", accent: "#3b82f6" },
  { id: "replicate", name: "Replicate", category: "AI & ML", tagline: "Clean white canvas, code-forward", accent: "#ea2804" },
  { id: "runwayml", name: "RunwayML", category: "AI & ML", tagline: "Cinematic dark UI, media-rich", accent: "#000000" },
  { id: "together.ai", name: "Together AI", category: "AI & ML", tagline: "Technical blueprint-style design", accent: "#ef2cc1" },
  { id: "voltagent", name: "VoltAgent", category: "AI & ML", tagline: "Void-black canvas, emerald accent", accent: "#00d992" },
  { id: "x.ai", name: "xAI", category: "AI & ML", tagline: "Stark monochrome, futuristic minimalism", accent: "#1da1f2" },

  // ───── Developer Tools ─────
  { id: "cursor", name: "Cursor", category: "Developer Tools", tagline: "AI-first code editor, gradient accents", accent: "#7b61ff" },
  { id: "expo", name: "Expo", category: "Developer Tools", tagline: "Dark theme, code-centric React Native", accent: "#4630eb" },
  { id: "linear.app", name: "Linear", category: "Developer Tools", tagline: "Ultra-minimal, precise, purple accent", accent: "#5e6ad2" },
  { id: "lovable", name: "Lovable", category: "Developer Tools", tagline: "Playful gradients, friendly dev aesthetic", accent: "#ff6b6b" },
  { id: "mintlify", name: "Mintlify", category: "Developer Tools", tagline: "Clean documentation, green-accented", accent: "#0d9373" },
  { id: "posthog", name: "PostHog", category: "Developer Tools", tagline: "Playful hedgehog, developer-friendly", accent: "#F54E00" },
  { id: "raycast", name: "Raycast", category: "Developer Tools", tagline: "Sleek dark chrome, vibrant gradients", accent: "#FF6363" },
  { id: "resend", name: "Resend", category: "Developer Tools", tagline: "Minimal dark theme, monospace accents", accent: "#000000" },
  { id: "sentry", name: "Sentry", category: "Developer Tools", tagline: "Dark dashboard, pink-purple accent", accent: "#6c5fc7" },
  { id: "supabase", name: "Supabase", category: "Developer Tools", tagline: "Dark emerald, open-source Firebase", accent: "#3ecf8e" },
  { id: "superhuman", name: "Superhuman", category: "Developer Tools", tagline: "Premium dark, keyboard-first", accent: "#6c5ce7" },
  { id: "vercel", name: "Vercel", category: "Developer Tools", tagline: "Black and white precision, Geist font", accent: "#000000" },
  { id: "warp", name: "Warp", category: "Developer Tools", tagline: "Modern terminal, block-based command UI", accent: "#01a4ff" },
  { id: "zapier", name: "Zapier", category: "Developer Tools", tagline: "Warm orange, illustration-driven", accent: "#ff4f00" },

  // ───── Infrastructure ─────
  { id: "clickhouse", name: "ClickHouse", category: "Infrastructure", tagline: "Yellow-accented analytics database", accent: "#faff69" },
  { id: "composio", name: "Composio", category: "Infrastructure", tagline: "Modern dark, colorful integrations", accent: "#0007cd" },
  { id: "hashicorp", name: "HashiCorp", category: "Infrastructure", tagline: "Enterprise-clean, black and white", accent: "#7b42bc" },
  { id: "mongodb", name: "MongoDB", category: "Infrastructure", tagline: "Green leaf, developer docs focus", accent: "#00ed64" },
  { id: "sanity", name: "Sanity", category: "Infrastructure", tagline: "Red accent, content-first editorial", accent: "#f03e2f" },
  { id: "stripe", name: "Stripe", category: "Infrastructure", tagline: "Purple gradients, weight-300 elegance", accent: "#635bff" },

  // ───── Design & Productivity ─────
  { id: "airtable", name: "Airtable", category: "Design & Productivity", tagline: "Colorful, structured data aesthetic", accent: "#2d7ff9" },
  { id: "cal", name: "Cal.com", category: "Design & Productivity", tagline: "Clean neutral, developer-oriented", accent: "#292929" },
  { id: "clay", name: "Clay", category: "Design & Productivity", tagline: "Organic shapes, soft gradients", accent: "#84e7a5" },
  { id: "figma", name: "Figma", category: "Design & Productivity", tagline: "Vibrant multi-color, playful yet pro", accent: "#a259ff" },
  { id: "framer", name: "Framer", category: "Design & Productivity", tagline: "Bold black and blue, motion-first", accent: "#0099ff" },
  { id: "intercom", name: "Intercom", category: "Design & Productivity", tagline: "Friendly blue, conversational UI", accent: "#286efa" },
  { id: "miro", name: "Miro", category: "Design & Productivity", tagline: "Bright yellow, infinite canvas", accent: "#ffd02f" },
  { id: "notion", name: "Notion", category: "Design & Productivity", tagline: "Warm minimalism, serif headings", accent: "#0075de" },
  { id: "pinterest", name: "Pinterest", category: "Design & Productivity", tagline: "Red accent, masonry grid, image-first", accent: "#e60023" },
  { id: "webflow", name: "Webflow", category: "Design & Productivity", tagline: "Blue-accented, polished marketing", accent: "#146ef5" },

  // ───── Fintech & Crypto ─────
  { id: "coinbase", name: "Coinbase", category: "Fintech & Crypto", tagline: "Clean blue identity, institutional", accent: "#0052ff" },
  { id: "kraken", name: "Kraken", category: "Fintech & Crypto", tagline: "Purple dark UI, data-dense dashboards", accent: "#7132f5" },
  { id: "revolut", name: "Revolut", category: "Fintech & Crypto", tagline: "Sleek dark, gradient cards, fintech", accent: "#e23b4a" },
  { id: "wise", name: "Wise", category: "Fintech & Crypto", tagline: "Bright green, friendly and clear", accent: "#9fe870" },

  // ───── Enterprise & Consumer ─────
  { id: "airbnb", name: "Airbnb", category: "Enterprise & Consumer", tagline: "Warm coral, photography-driven", accent: "#ff385c" },
  { id: "apple", name: "Apple", category: "Enterprise & Consumer", tagline: "Premium white space, SF Pro", accent: "#0071e3" },
  { id: "ibm", name: "IBM", category: "Enterprise & Consumer", tagline: "Carbon design system, structured blue", accent: "#0f62fe" },
  { id: "nvidia", name: "NVIDIA", category: "Enterprise & Consumer", tagline: "Green-black, technical power", accent: "#76b900" },
  { id: "spacex", name: "SpaceX", category: "Enterprise & Consumer", tagline: "Stark black and white, futuristic", accent: "#005288" },
  { id: "spotify", name: "Spotify", category: "Enterprise & Consumer", tagline: "Vibrant green on dark, bold type", accent: "#1db954" },
  { id: "uber", name: "Uber", category: "Enterprise & Consumer", tagline: "Bold black and white, urban energy", accent: "#000000" },

  // ───── Automotive ─────
  { id: "bmw", name: "BMW", category: "Automotive", tagline: "Dark premium, German engineering", accent: "#1c69d4" },
  { id: "ferrari", name: "Ferrari", category: "Automotive", tagline: "Chiaroscuro editorial, Rosso Corsa", accent: "#DA291C" },
  { id: "lamborghini", name: "Lamborghini", category: "Automotive", tagline: "True black cathedral, gold accent", accent: "#FFC000" },
  { id: "renault", name: "Renault", category: "Automotive", tagline: "Aurora gradients, NouvelR typeface", accent: "#EFDF00" },
  { id: "tesla", name: "Tesla", category: "Automotive", tagline: "Radical subtraction, cinematic photos", accent: "#3E6AE1" },
];

/** All categories in display order. */
export const BRAND_CATEGORIES: BrandCategory[] = [
  "AI & ML",
  "Developer Tools",
  "Infrastructure",
  "Design & Productivity",
  "Fintech & Crypto",
  "Enterprise & Consumer",
  "Automotive",
];

/**
 * Lazy-load a brand's DESIGN.md content.
 * Vite resolves the `?raw` import at build time, tree-shaking unused files
 * out of the initial bundle, and code-splitting into per-brand chunks.
 */
const BRAND_LOADERS: Record<string, () => Promise<string>> = {
  airbnb: () => import("./design-md/airbnb.md?raw").then((m) => m.default),
  airtable: () => import("./design-md/airtable.md?raw").then((m) => m.default),
  apple: () => import("./design-md/apple.md?raw").then((m) => m.default),
  bmw: () => import("./design-md/bmw.md?raw").then((m) => m.default),
  cal: () => import("./design-md/cal.md?raw").then((m) => m.default),
  claude: () => import("./design-md/claude.md?raw").then((m) => m.default),
  clay: () => import("./design-md/clay.md?raw").then((m) => m.default),
  clickhouse: () => import("./design-md/clickhouse.md?raw").then((m) => m.default),
  cohere: () => import("./design-md/cohere.md?raw").then((m) => m.default),
  coinbase: () => import("./design-md/coinbase.md?raw").then((m) => m.default),
  composio: () => import("./design-md/composio.md?raw").then((m) => m.default),
  cursor: () => import("./design-md/cursor.md?raw").then((m) => m.default),
  elevenlabs: () => import("./design-md/elevenlabs.md?raw").then((m) => m.default),
  expo: () => import("./design-md/expo.md?raw").then((m) => m.default),
  ferrari: () => import("./design-md/ferrari.md?raw").then((m) => m.default),
  figma: () => import("./design-md/figma.md?raw").then((m) => m.default),
  framer: () => import("./design-md/framer.md?raw").then((m) => m.default),
  hashicorp: () => import("./design-md/hashicorp.md?raw").then((m) => m.default),
  ibm: () => import("./design-md/ibm.md?raw").then((m) => m.default),
  intercom: () => import("./design-md/intercom.md?raw").then((m) => m.default),
  kraken: () => import("./design-md/kraken.md?raw").then((m) => m.default),
  lamborghini: () => import("./design-md/lamborghini.md?raw").then((m) => m.default),
  "linear.app": () => import("./design-md/linear.app.md?raw").then((m) => m.default),
  lovable: () => import("./design-md/lovable.md?raw").then((m) => m.default),
  minimax: () => import("./design-md/minimax.md?raw").then((m) => m.default),
  mintlify: () => import("./design-md/mintlify.md?raw").then((m) => m.default),
  miro: () => import("./design-md/miro.md?raw").then((m) => m.default),
  "mistral.ai": () => import("./design-md/mistral.ai.md?raw").then((m) => m.default),
  mongodb: () => import("./design-md/mongodb.md?raw").then((m) => m.default),
  notion: () => import("./design-md/notion.md?raw").then((m) => m.default),
  nvidia: () => import("./design-md/nvidia.md?raw").then((m) => m.default),
  ollama: () => import("./design-md/ollama.md?raw").then((m) => m.default),
  "opencode.ai": () => import("./design-md/opencode.ai.md?raw").then((m) => m.default),
  pinterest: () => import("./design-md/pinterest.md?raw").then((m) => m.default),
  posthog: () => import("./design-md/posthog.md?raw").then((m) => m.default),
  raycast: () => import("./design-md/raycast.md?raw").then((m) => m.default),
  renault: () => import("./design-md/renault.md?raw").then((m) => m.default),
  replicate: () => import("./design-md/replicate.md?raw").then((m) => m.default),
  resend: () => import("./design-md/resend.md?raw").then((m) => m.default),
  revolut: () => import("./design-md/revolut.md?raw").then((m) => m.default),
  runwayml: () => import("./design-md/runwayml.md?raw").then((m) => m.default),
  sanity: () => import("./design-md/sanity.md?raw").then((m) => m.default),
  sentry: () => import("./design-md/sentry.md?raw").then((m) => m.default),
  spacex: () => import("./design-md/spacex.md?raw").then((m) => m.default),
  spotify: () => import("./design-md/spotify.md?raw").then((m) => m.default),
  stripe: () => import("./design-md/stripe.md?raw").then((m) => m.default),
  supabase: () => import("./design-md/supabase.md?raw").then((m) => m.default),
  superhuman: () => import("./design-md/superhuman.md?raw").then((m) => m.default),
  tesla: () => import("./design-md/tesla.md?raw").then((m) => m.default),
  "together.ai": () => import("./design-md/together.ai.md?raw").then((m) => m.default),
  uber: () => import("./design-md/uber.md?raw").then((m) => m.default),
  vercel: () => import("./design-md/vercel.md?raw").then((m) => m.default),
  voltagent: () => import("./design-md/voltagent.md?raw").then((m) => m.default),
  warp: () => import("./design-md/warp.md?raw").then((m) => m.default),
  webflow: () => import("./design-md/webflow.md?raw").then((m) => m.default),
  wise: () => import("./design-md/wise.md?raw").then((m) => m.default),
  "x.ai": () => import("./design-md/x.ai.md?raw").then((m) => m.default),
  zapier: () => import("./design-md/zapier.md?raw").then((m) => m.default),
};

/** Load a brand's DESIGN.md markdown. Returns null if id is unknown. */
export async function loadBrandMarkdown(id: string): Promise<string | null> {
  const loader = BRAND_LOADERS[id];
  if (!loader) return null;
  return loader();
}
