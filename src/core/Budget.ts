import {
  bulkhead,
  circuitBreaker,
  ConsecutiveBreaker,
  handleAll,
  type CircuitBreakerPolicy,
  type BulkheadPolicy,
} from "cockatiel";

/**
 * Budget configuration for a tool or global scope.
 */
export interface BudgetOptions {
  /** Default timeout in ms for tool invocations */
  defaultTimeoutMs?: number;
  /** Max concurrent invocations per tool */
  maxConcurrency?: number;
  /** Rate limit: max calls per window */
  rateLimit?: { maxCalls: number; windowMs: number };
  /** Circuit breaker config */
  circuitBreaker?: {
    /** Number of consecutive failures before opening */
    threshold: number;
    /** Half-open reset time in ms */
    halfOpenAfterMs: number;
  };
}

/**
 * Per-tool rate limiter using sliding window.
 */
class RateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxCalls: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(): boolean {
    const now = Date.now();
    // Remove expired timestamps
    while (this.timestamps.length > 0 && this.timestamps[0]! <= now - this.windowMs) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maxCalls) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }

  get remaining(): number {
    const now = Date.now();
    const active = this.timestamps.filter((t) => t > now - this.windowMs);
    return Math.max(0, this.maxCalls - active.length);
  }
}

/**
 * Budget manager that provides timeout, rate limiting, concurrency control,
 * and circuit breaker per tool.
 */
export class BudgetManager {
  private readonly defaultTimeoutMs: number;
  private readonly bulkheads = new Map<string, BulkheadPolicy>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerPolicy>();
  private readonly rateLimiters = new Map<string, RateLimiter>();
  private readonly options: BudgetOptions;

  constructor(options: BudgetOptions = {}) {
    this.options = options;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  /**
   * Get effective timeout for a tool invocation.
   */
  getTimeout(_toolName: string, contextTimeoutMs?: number): number {
    return contextTimeoutMs ?? this.defaultTimeoutMs;
  }

  /**
   * Check rate limit for a tool. Returns true if allowed.
   */
  checkRateLimit(toolName: string): boolean {
    if (!this.options.rateLimit) return true;
    let limiter = this.rateLimiters.get(toolName);
    if (!limiter) {
      limiter = new RateLimiter(
        this.options.rateLimit.maxCalls,
        this.options.rateLimit.windowMs,
      );
      this.rateLimiters.set(toolName, limiter);
    }
    return limiter.tryAcquire();
  }

  /**
   * Get or create a bulkhead (concurrency limiter) for a tool.
   */
  getBulkhead(toolName: string): BulkheadPolicy | undefined {
    if (!this.options.maxConcurrency) return undefined;
    let bh = this.bulkheads.get(toolName);
    if (!bh) {
      bh = bulkhead(this.options.maxConcurrency, 0);
      this.bulkheads.set(toolName, bh);
    }
    return bh;
  }

  /**
   * Get or create a circuit breaker for a tool.
   */
  getCircuitBreaker(toolName: string): CircuitBreakerPolicy | undefined {
    if (!this.options.circuitBreaker) return undefined;
    let breaker = this.circuitBreakers.get(toolName);
    if (!breaker) {
      breaker = circuitBreaker(handleAll, {
        breaker: new ConsecutiveBreaker(this.options.circuitBreaker.threshold),
        halfOpenAfter: this.options.circuitBreaker.halfOpenAfterMs,
      });
      this.circuitBreakers.set(toolName, breaker);
    }
    return breaker;
  }

  /**
   * Execute a function within budget constraints (bulkhead + circuit breaker).
   */
  async execute<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
    const bh = this.getBulkhead(toolName);
    const breaker = this.getCircuitBreaker(toolName);

    let wrapped: () => Promise<T> = fn;

    if (breaker) {
      const prevWrapped = wrapped;
      wrapped = () => breaker.execute(() => prevWrapped());
    }

    if (bh) {
      const prevWrapped = wrapped;
      wrapped = () => bh.execute(() => prevWrapped());
    }

    return wrapped();
  }

  /**
   * Reset all policies for a tool (useful for testing).
   */
  reset(toolName: string): void {
    this.bulkheads.delete(toolName);
    this.circuitBreakers.delete(toolName);
    this.rateLimiters.delete(toolName);
  }

  /**
   * Reset all policies globally.
   */
  resetAll(): void {
    this.bulkheads.clear();
    this.circuitBreakers.clear();
    this.rateLimiters.clear();
  }
}
