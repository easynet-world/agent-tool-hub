/**
 * Simple counter metric.
 */
export interface CounterValue {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * Histogram bucket.
 */
export interface HistogramValue {
  name: string;
  labels: Record<string, string>;
  count: number;
  sum: number;
  buckets: Map<number, number>; // upper bound → count
}

/**
 * Lightweight metrics collector for tool invocations.
 * Provides counters and histograms with label support.
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<
    string,
    { count: number; sum: number; values: number[] }
  >();

  private readonly defaultBuckets = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  /**
   * Increment a counter.
   */
  increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = this.makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  /**
   * Record a value in a histogram.
   */
  observe(name: string, labels: Record<string, string>, value: number): void {
    const key = this.makeKey(name, labels);
    let hist = this.histograms.get(key);
    if (!hist) {
      hist = { count: 0, sum: 0, values: [] };
      this.histograms.set(key, hist);
    }
    hist.count++;
    hist.sum += value;
    hist.values.push(value);
  }

  /**
   * Get a counter value.
   */
  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.makeKey(name, labels)) ?? 0;
  }

  /**
   * Get histogram stats.
   */
  getHistogram(
    name: string,
    labels: Record<string, string>,
  ): HistogramValue | undefined {
    const key = this.makeKey(name, labels);
    const hist = this.histograms.get(key);
    if (!hist) return undefined;

    const buckets = new Map<number, number>();
    for (const bound of this.defaultBuckets) {
      buckets.set(bound, hist.values.filter((v) => v <= bound).length);
    }

    return { name, labels, count: hist.count, sum: hist.sum, buckets };
  }

  /**
   * Get all counter values.
   */
  getAllCounters(): CounterValue[] {
    const results: CounterValue[] = [];
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parseKey(key);
      results.push({ name, labels, value });
    }
    return results;
  }

  /**
   * Get all histogram values.
   */
  getAllHistograms(): HistogramValue[] {
    const results: HistogramValue[] = [];
    for (const [key, hist] of this.histograms) {
      const { name, labels } = this.parseKey(key);
      const buckets = new Map<number, number>();
      for (const bound of this.defaultBuckets) {
        buckets.set(bound, hist.values.filter((v) => v <= bound).length);
      }
      results.push({ name, labels, count: hist.count, sum: hist.sum, buckets });
    }
    return results;
  }

  /**
   * Record standard tool invocation metrics.
   */
  recordInvocation(toolName: string, ok: boolean, durationMs: number): void {
    this.increment("tool_invocations_total", {
      toolName,
      ok: String(ok),
    });
    this.observe("tool_latency_ms", { toolName }, durationMs);
  }

  /**
   * Record a retry event.
   */
  recordRetry(toolName: string): void {
    this.increment("tool_retries_total", { toolName });
  }

  /**
   * Record a policy denial.
   */
  recordPolicyDenied(toolName: string, reason: string): void {
    this.increment("policy_denied_total", { toolName, reason });
  }

  /**
   * Reset all metrics (for testing).
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  private makeKey(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${sortedLabels}}`;
  }

  private parseKey(key: string): {
    name: string;
    labels: Record<string, string>;
  } {
    const match = key.match(/^(.+?)\{(.*)\}$/);
    if (!match) return { name: key, labels: {} };
    const labels: Record<string, string> = {};
    if (match[2]) {
      for (const part of match[2].split(",")) {
        const [k, v] = part.split("=");
        if (k && v !== undefined) labels[k] = v;
      }
    }
    return { name: match[1]!, labels };
  }
}
