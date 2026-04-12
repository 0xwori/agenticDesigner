import type { FrameVersion, FrameWithVersions } from "@designer/shared";

export interface FlowDesignFrameContext {
  id: string;
  name: string;
  summary?: string;
}

const MAX_SIGNAL_COUNT = 6;
const MAX_SUMMARY_LENGTH = 260;

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  "#39": "'",
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&([a-z0-9#]+);/gi, (match, entity: string) => HTML_ENTITY_MAP[entity] ?? match);
}

function normalizeSnippet(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function collectMatches(source: string, pattern: RegExp, limit = MAX_SIGNAL_COUNT) {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(pattern)) {
    const rawValue = match[1] ?? match[2] ?? "";
    const normalized = normalizeSnippet(rawValue);
    if (normalized.length < 2) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    values.push(normalized);

    if (values.length >= limit) {
      break;
    }
  }

  return values;
}

function stripHtml(value: string) {
  return normalizeSnippet(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " "),
  );
}

function extractSourceStrings(sourceCode: string) {
  return collectMatches(sourceCode, /"([^"\n]{4,80})"|'([^'\n]{4,80})'/g, 4).filter(
    (value) => /[a-z]/i.test(value) && /\s/.test(value),
  );
}

function selectCurrentVersion(frame: FrameWithVersions): FrameVersion | undefined {
  const current = frame.currentVersionId
    ? frame.versions.find((version) => version.id === frame.currentVersionId)
    : undefined;
  if (current) {
    return current;
  }

  return frame.versions.length > 0 ? frame.versions[frame.versions.length - 1] : undefined;
}

function buildFrameSummary(version?: FrameVersion) {
  if (!version) {
    return undefined;
  }

  const htmlSignals = [
    ...collectMatches(version.exportHtml, /<(?:h1|h2|h3|button|label|legend)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|button|label|legend)>/gi),
    ...collectMatches(version.exportHtml, /\b(?:aria-label|placeholder|alt|title)=['"]([^'"]+)['"]/gi),
  ].slice(0, MAX_SIGNAL_COUNT);
  const visibleText = stripHtml(version.exportHtml);
  const sourceSignals = htmlSignals.length === 0 ? extractSourceStrings(version.sourceCode) : [];

  const parts: string[] = [];
  if (htmlSignals.length > 0) {
    parts.push(`key UI copy: ${htmlSignals.join(", ")}`);
  }
  if (visibleText.length > 0) {
    parts.push(`screen text: ${truncateText(visibleText, 160)}`);
  }
  if (sourceSignals.length > 0) {
    parts.push(`source cues: ${sourceSignals.join(", ")}`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return truncateText(parts.join("; "), MAX_SUMMARY_LENGTH);
}

export function buildFlowDesignFrameContexts(frames: FrameWithVersions[]): FlowDesignFrameContext[] {
  return frames
    .filter((frame) => frame.frameKind !== "flow")
    .map((frame) => ({
      id: frame.id,
      name: frame.name,
      summary: buildFrameSummary(selectCurrentVersion(frame)),
    }));
}