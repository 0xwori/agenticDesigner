import { describe, it, expect } from "vitest";
import { backoffDelay, isRetriableError } from "./backoff.js";

describe("backoffDelay", () => {
  it("returns baseMs for attempt 1", () => {
    const delay = backoffDelay(1, 1000, 30_000);
    // 1000 ± 20% jitter → [800, 1200]
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });

  it("doubles for attempt 2", () => {
    const delay = backoffDelay(2, 1000, 30_000);
    // 2000 ± 20% → [1600, 2400]
    expect(delay).toBeGreaterThanOrEqual(1600);
    expect(delay).toBeLessThanOrEqual(2400);
  });

  it("quadruples for attempt 3", () => {
    const delay = backoffDelay(3, 1000, 30_000);
    // 4000 ± 20% → [3200, 4800]
    expect(delay).toBeGreaterThanOrEqual(3200);
    expect(delay).toBeLessThanOrEqual(4800);
  });

  it("caps at maxMs", () => {
    const delay = backoffDelay(20, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("handles attempt 0 same as attempt 1", () => {
    const delay = backoffDelay(0, 1000, 30_000);
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });
});

describe("isRetriableError", () => {
  it("returns true for rate-limit", () => {
    expect(isRetriableError("rate-limit")).toBe(true);
  });

  it("returns true for llm-timeout", () => {
    expect(isRetriableError("llm-timeout")).toBe(true);
  });

  it("returns true for network-error", () => {
    expect(isRetriableError("network-error")).toBe(true);
  });

  it("returns false for auth-error", () => {
    expect(isRetriableError("auth-error")).toBe(false);
  });

  it("returns false for validation-failure", () => {
    expect(isRetriableError("validation-failure")).toBe(false);
  });

  it("returns false for unknown", () => {
    expect(isRetriableError("unknown")).toBe(false);
  });
});
