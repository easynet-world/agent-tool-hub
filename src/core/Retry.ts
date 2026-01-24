import pRetry, { type Options as PRetryOptions } from "p-retry";

/**
 * Retry configuration.
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 2) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in ms (default: 10000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 (default: 0.1) */
  jitter?: number;
  /** Error filter: return true to retry, false to abort */
  shouldRetry?: (error: Error) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Default errors that should NOT be retried (deterministic failures).
 */
const NON_RETRYABLE_ERRORS = new Set([
  "TOOL_NOT_FOUND",
  "INPUT_SCHEMA_INVALID",
  "POLICY_DENIED",
  "OUTPUT_SCHEMA_INVALID",
  "PATH_OUTSIDE_SANDBOX",
  "FILE_TOO_LARGE",
  "HTTP_DISALLOWED_HOST",
  "HTTP_TOO_LARGE",
]);

/**
 * Determine if an error is retryable.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const kind = (error as Error & { kind?: string }).kind;
    if (kind && NON_RETRYABLE_ERRORS.has(kind)) return false;
  }
  return true;
}

/**
 * Execute a function with retry logic using exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    maxDelayMs = 10_000,
    jitter = 0.1,
    shouldRetry,
    onRetry,
  } = options;

  if (maxRetries <= 0) {
    return fn();
  }

  const pRetryOptions: PRetryOptions = {
    retries: maxRetries,
    minTimeout: baseDelayMs,
    maxTimeout: maxDelayMs,
    randomize: true,
    factor: 2,
    onFailedAttempt: (error) => {
      // Apply jitter
      if (jitter > 0 && error.retriesLeft > 0) {
        const jitterMs = Math.random() * jitter * baseDelayMs;
        // p-retry handles backoff internally; we just notify
      }

      // Check if should retry
      if (shouldRetry && !shouldRetry(error)) {
        throw error; // Abort retry
      }

      if (!isRetryable(error)) {
        throw error; // Non-retryable error kind
      }

      onRetry?.(error, maxRetries - error.retriesLeft);
    },
  };

  return pRetry(fn, pRetryOptions);
}

/**
 * Create a tagged error with a kind field for retry classification.
 */
export function createTaggedError(
  kind: string,
  message: string,
  details?: unknown,
): Error & { kind: string; details?: unknown } {
  const error = new Error(message) as Error & {
    kind: string;
    details?: unknown;
  };
  error.kind = kind;
  error.details = details;
  return error;
}
