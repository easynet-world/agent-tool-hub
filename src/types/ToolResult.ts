/**
 * Evidence attached to a tool result for audit trail.
 */
export interface Evidence {
  type: "tool" | "file" | "url" | "text" | "metric";
  ref: string;
  summary: string;
  createdAt: string; // ISO 8601
}

/**
 * Error information in a tool result.
 */
export interface ToolError {
  kind?:
    | "TOOL_NOT_FOUND"
    | "INPUT_SCHEMA_INVALID"
    | "POLICY_DENIED"
    | "BUDGET_EXCEEDED"
    | "TIMEOUT"
    | "UPSTREAM_ERROR"
    | "OUTPUT_SCHEMA_INVALID"
    | "PATH_OUTSIDE_SANDBOX"
    | "FILE_TOO_LARGE"
    | "HTTP_DISALLOWED_HOST"
    | "HTTP_TIMEOUT"
    | "HTTP_TOO_LARGE";
  message: string;
  details?: unknown;
}

/**
 * Unified tool result returned to agent-orchestra.
 * Always structured, never throws raw exceptions.
 */
export interface ToolResult {
  ok: boolean;
  result?: unknown;
  evidence: Evidence[];
  error?: ToolError;
  /** Raw response for debugging (can be disabled in production) */
  raw?: unknown;
}
