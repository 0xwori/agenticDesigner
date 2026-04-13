import type { FrameVersion, FrameWithVersions } from "@designer/shared";
import { load } from "cheerio";

function resolveLatestFrameVersion(frame: FrameWithVersions): FrameVersion | null {
  if (frame.currentVersionId) {
    const currentVersion = frame.versions.find((version) => version.id === frame.currentVersionId);
    if (currentVersion) {
      return currentVersion;
    }
  }

  return frame.versions.length > 0 ? frame.versions[frame.versions.length - 1] ?? null : null;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimSummary(value: string, maxLength = 420): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function uniqueNonEmpty(values: Array<string | undefined>, limit: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = typeof value === "string" ? normalizeInlineText(value) : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    items.push(normalized);
    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function detectLayoutSignals(html: string) {
  const $ = load(html);
  $("script, style, noscript").remove();

  const headings = uniqueNonEmpty(
    $("h1, h2, h3")
      .toArray()
      .map((element) => $(element).text()),
    4,
  );

  const actions = uniqueNonEmpty(
    $("button, [role='button'], a[href]")
      .toArray()
      .map((element) => $(element).text()),
    4,
  );

  const fields = uniqueNonEmpty(
    $("input, textarea, select")
      .toArray()
      .map((element) => {
        const node = $(element);
        return node.attr("placeholder") || node.attr("aria-label") || node.attr("name") || node.attr("id") || undefined;
      }),
    4,
  );

  const visibleSnippets = uniqueNonEmpty(
    $("body")
      .text()
      .split(/(?<=[.!?])\s+|\s{2,}/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 3),
    4,
  );

  const layoutKinds: string[] = [];
  if ($("form").length > 0 || fields.length >= 2) {
    layoutKinds.push("form flow");
  }
  if ($("nav").length > 0) {
    layoutKinds.push("navigation");
  }
  if ($("table, [role='table'], [role='grid']").length > 0) {
    layoutKinds.push("data table");
  }
  if ($("ul li, ol li").length >= 3) {
    layoutKinds.push("list view");
  }
  if ($("article, section, [data-card], .card").length >= 3) {
    layoutKinds.push("card layout");
  }
  if ($("aside").length > 0) {
    layoutKinds.push("sidebar layout");
  }
  if ($("dialog, [role='dialog'], [aria-modal='true']").length > 0) {
    layoutKinds.push("modal or overlay");
  }
  if ($("header, main, footer").length >= 2) {
    layoutKinds.push("page shell");
  }

  return {
    headings,
    actions,
    fields,
    visibleSnippets,
    layoutKinds: uniqueNonEmpty(layoutKinds, 3),
  };
}

export function buildDesignFrameSummary(frame: FrameWithVersions): string | undefined {
  const version = resolveLatestFrameVersion(frame);
  if (!version) {
    return undefined;
  }

  const htmlSignals = detectLayoutSignals(version.exportHtml);
  const combinedSignals = `${version.exportHtml}\n${version.sourceCode}`;
  const parts: string[] = [];

  if (htmlSignals.visibleSnippets.length > 0) {
    parts.push(`Visible content: ${htmlSignals.visibleSnippets.join(" / ")}`);
  }
  if (htmlSignals.headings.length > 0) {
    parts.push(`Headings: ${htmlSignals.headings.join(", ")}`);
  }
  if (htmlSignals.actions.length > 0) {
    parts.push(`Actions: ${htmlSignals.actions.join(", ")}`);
  }
  if (htmlSignals.fields.length > 0) {
    parts.push(`Fields: ${htmlSignals.fields.join(", ")}`);
  }
  if (htmlSignals.layoutKinds.length > 0) {
    parts.push(`Layout: ${htmlSignals.layoutKinds.join(", ")}`);
  }
  if (/fetch\(|axios|graphql|mutation|query|api/i.test(version.sourceCode)) {
    parts.push("Includes API or data-fetching logic");
  }
  if (/auth|session|token|password|login|sign in|sign up|mfa|otp/i.test(combinedSignals)) {
    parts.push("Contains auth or session-related UI");
  }
  if (/loading|processing|verifying|pending|syncing|refresh/i.test(combinedSignals)) {
    parts.push("Shows loading or async processing states");
  }
  if (/error|retry|failed|invalid|empty state|no results|try again/i.test(combinedSignals)) {
    parts.push("Shows error, retry, or validation handling");
  }
  if (/success|done|confirmed|complete|submitted/i.test(combinedSignals)) {
    parts.push("Contains confirmation or success feedback");
  }

  if (parts.length === 0) {
    return undefined;
  }

  return trimSummary(parts.join(". "));
}