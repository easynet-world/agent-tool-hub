/**
 * Error thrown during directory-based tool discovery.
 */
export class DiscoveryError extends Error {
  /** Absolute path to the tool directory that caused the error */
  readonly toolDir: string;
  /** Phase in which the error occurred */
  readonly phase: "manifest" | "load" | "validate";
  /** The underlying cause */
  readonly cause?: Error;

  constructor(
    toolDir: string,
    phase: "manifest" | "load" | "validate",
    message: string,
    cause?: Error,
  ) {
    super(`[${phase}] ${toolDir}: ${message}`);
    this.name = "DiscoveryError";
    this.toolDir = toolDir;
    this.phase = phase;
    this.cause = cause;
  }
}
