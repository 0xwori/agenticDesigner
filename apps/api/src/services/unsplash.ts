/**
 * Unsplash image search service.
 *
 * When UNSPLASH_ACCESS_KEY is set, queries the Unsplash Search API.
 * Otherwise falls back to placehold.co placeholder URLs.
 */

export type UnsplashPhoto = {
  id: string;
  url: string;
  thumbUrl: string;
  alt: string;
  photographer: string;
};

const UNSPLASH_API = "https://api.unsplash.com";

function getAccessKey(): string | null {
  return process.env.UNSPLASH_ACCESS_KEY?.trim() || null;
}

export async function searchPhotos(
  query: string,
  count = 3
): Promise<UnsplashPhoto[]> {
  const key = getAccessKey();
  if (!key) {
    return buildPlaceholders(query, count);
  }

  try {
    const url = new URL("/search/photos", UNSPLASH_API);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(Math.min(count, 10)));
    url.searchParams.set("orientation", "landscape");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Client-ID ${key}`,
        "Accept-Version": "v1"
      },
      signal: AbortSignal.timeout(8_000)
    });

    if (!response.ok) {
      console.warn(`Unsplash search failed (${response.status}): ${query}`);
      return buildPlaceholders(query, count);
    }

    const data = (await response.json()) as {
      results?: Array<{
        id: string;
        alt_description?: string | null;
        description?: string | null;
        urls: { regular: string; small: string };
        user: { name: string };
      }>;
    };

    if (!Array.isArray(data.results) || data.results.length === 0) {
      return buildPlaceholders(query, count);
    }

    return data.results.slice(0, count).map((photo) => ({
      id: photo.id,
      url: photo.urls.regular,
      thumbUrl: photo.urls.small,
      alt: photo.alt_description || photo.description || query,
      photographer: photo.user.name
    }));
  } catch (error) {
    console.warn("Unsplash search error:", error instanceof Error ? error.message : error);
    return buildPlaceholders(query, count);
  }
}

/**
 * Selects images for a set of named slots (e.g. "hero", "card-1").
 * Batches everything into a single search per unique query to stay within rate limits.
 */
export async function selectImagesForPlan(
  slots: Array<{ slot: string; query: string }>
): Promise<Map<string, UnsplashPhoto>> {
  const results = new Map<string, UnsplashPhoto>();
  if (slots.length === 0) return results;

  // Group slots by query to avoid duplicate searches
  const queryGroups = new Map<string, string[]>();
  for (const { slot, query } of slots) {
    const normalised = query.toLowerCase().trim();
    const existing = queryGroups.get(normalised) ?? [];
    existing.push(slot);
    queryGroups.set(normalised, existing);
  }

  for (const [query, slotNames] of queryGroups) {
    const photos = await searchPhotos(query, slotNames.length);
    for (let i = 0; i < slotNames.length; i++) {
      const photo = photos[i] ?? photos[photos.length - 1];
      if (photo) {
        results.set(slotNames[i], photo);
      }
    }
  }

  return results;
}

/**
 * Builds an image-context block string that can be injected into LLM prompts.
 */
export function buildImageContextBlock(
  images: Map<string, UnsplashPhoto>,
  wrapWidth = 1200
): string {
  if (images.size === 0) return "";

  const lines = [
    "AVAILABLE IMAGES — use these exact URLs in <img> tags where appropriate:",
    ""
  ];

  for (const [slot, photo] of images) {
    const sized = appendSizeParams(photo.url, wrapWidth);
    lines.push(`- ${slot}: ${sized}`);
    lines.push(`  alt: "${photo.alt}" | photo by ${photo.photographer}`);
  }

  lines.push("");
  lines.push(
    "Rules: Use <img src=\"…\" alt=\"…\" /> with object-fit: cover, aspect-ratio, and border-radius matching the design system. Do NOT use placeholder services."
  );

  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPlaceholders(query: string, count: number): UnsplashPhoto[] {
  const palettes = [
    { bg: "e0e7ff", fg: "4338ca" },
    { bg: "dbeafe", fg: "1d4ed8" },
    { bg: "d1fae5", fg: "047857" },
    { bg: "fef3c7", fg: "b45309" },
    { bg: "fce7f3", fg: "be185d" }
  ];

  return Array.from({ length: count }, (_, i) => {
    const p = palettes[i % palettes.length];
    const label = encodeURIComponent(query.slice(0, 40));
    return {
      id: `placeholder-${i}`,
      url: `https://placehold.co/1200x800/${p.bg}/${p.fg}?text=${label}`,
      thumbUrl: `https://placehold.co/400x300/${p.bg}/${p.fg}?text=${label}`,
      alt: query,
      photographer: "Placeholder"
    };
  });
}

function appendSizeParams(url: string, width: number): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("unsplash.com")) {
      parsed.searchParams.set("w", String(width));
      parsed.searchParams.set("q", "80");
      parsed.searchParams.set("auto", "format");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
