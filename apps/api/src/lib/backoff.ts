/**
 * Exponential backoff with jitter for retry loops.
 *
 * Formula: min(baseMs * 2^(attempt-1) + jitter, maxMs)
 * Jitter is ±20% of the calculated delay to spread concurrent retries.
 */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 30_000): number {
  const exponential = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
  return Math.min(Math.round(exponential + jitter), maxMs);
}

export type PipelineErrorCode =
  | "auth-error"
  | "rate-limit"
  | "llm-timeout"
  | "validation-failure"
  | "network-error"
  | "unknown";

const RETRIABLE_CODES: ReadonlySet<PipelineErrorCode> = new Set([
  "rate-limit",
  "llm-timeout",
  "network-error"
]);

export function isRetriableError(code: PipelineErrorCode): boolean {
  return RETRIABLE_CODES.has(code);
}
