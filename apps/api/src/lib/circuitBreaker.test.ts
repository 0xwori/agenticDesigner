import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker } from "./circuitBreaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ maxFailures: 3, cooldownMs: 5_000 });
  });

  it("starts closed", () => {
    expect(cb.isOpen("openai")).toBe(false);
  });

  it("stays closed after 1-2 failures", () => {
    cb.recordFailure("openai");
    expect(cb.isOpen("openai")).toBe(false);
    cb.recordFailure("openai");
    expect(cb.isOpen("openai")).toBe(false);
  });

  it("opens after maxFailures consecutive failures", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.isOpen("openai")).toBe(true);
  });

  it("resets on success", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordSuccess("openai");
    cb.recordFailure("openai");
    expect(cb.isOpen("openai")).toBe(false);
    expect(cb.getFailureCount("openai")).toBe(1);
  });

  it("tracks providers independently", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.isOpen("openai")).toBe(true);
    expect(cb.isOpen("anthropic")).toBe(false);
  });

  it("transitions to half-open after cooldown", () => {
    vi.useFakeTimers();
    try {
      cb.recordFailure("openai");
      cb.recordFailure("openai");
      cb.recordFailure("openai");
      expect(cb.isOpen("openai")).toBe(true);

      vi.advanceTimersByTime(5_000);
      // After cooldown, circuit is half-open → isOpen returns false to allow probe
      expect(cb.isOpen("openai")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-opens if probe fails", () => {
    vi.useFakeTimers();
    try {
      cb.recordFailure("openai");
      cb.recordFailure("openai");
      cb.recordFailure("openai");
      vi.advanceTimersByTime(5_000);
      expect(cb.isOpen("openai")).toBe(false); // half-open

      cb.recordFailure("openai"); // probe failed
      expect(cb.isOpen("openai")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes if probe succeeds", () => {
    vi.useFakeTimers();
    try {
      cb.recordFailure("openai");
      cb.recordFailure("openai");
      cb.recordFailure("openai");
      vi.advanceTimersByTime(5_000);

      cb.recordSuccess("openai"); // probe succeeded
      expect(cb.isOpen("openai")).toBe(false);
      expect(cb.getFailureCount("openai")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset clears provider state", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.reset("openai");
    expect(cb.isOpen("openai")).toBe(false);
    expect(cb.getFailureCount("openai")).toBe(0);
  });
});
