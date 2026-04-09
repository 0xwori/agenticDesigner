/**
 * Per-provider circuit breaker.
 *
 * After `maxFailures` consecutive failures the circuit opens and subsequent
 * calls fail fast without hitting the provider.  The circuit auto-resets to
 * half-open after `cooldownMs` and allows one probe request through.
 */

export interface CircuitBreakerOptions {
  maxFailures?: number;
  cooldownMs?: number;
}

interface ProviderState {
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private readonly maxFailures: number;
  private readonly cooldownMs: number;
  private readonly states = new Map<string, ProviderState>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.maxFailures = options.maxFailures ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
  }

  private getState(provider: string): ProviderState {
    let state = this.states.get(provider);
    if (!state) {
      state = { consecutiveFailures: 0, openedAt: null };
      this.states.set(provider, state);
    }
    return state;
  }

  /**
   * Returns true when the circuit is open (provider should NOT be called).
   * Returns false when closed or half-open (provider can be called).
   */
  isOpen(provider: string): boolean {
    const state = this.getState(provider);
    if (state.consecutiveFailures < this.maxFailures) {
      return false;
    }
    if (state.openedAt === null) {
      return false;
    }
    // Cooldown elapsed → half-open: allow one probe
    if (Date.now() - state.openedAt >= this.cooldownMs) {
      return false;
    }
    return true;
  }

  recordSuccess(provider: string): void {
    const state = this.getState(provider);
    state.consecutiveFailures = 0;
    state.openedAt = null;
  }

  recordFailure(provider: string): void {
    const state = this.getState(provider);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.maxFailures) {
      state.openedAt = Date.now();
    }
  }

  /** Visible for testing. */
  getFailureCount(provider: string): number {
    return this.getState(provider).consecutiveFailures;
  }

  reset(provider: string): void {
    this.states.delete(provider);
  }
}

/** Singleton circuit breaker shared across all pipeline runs. */
export const providerCircuit = new CircuitBreaker();
