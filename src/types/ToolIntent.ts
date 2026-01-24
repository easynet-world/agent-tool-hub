import type { Capability } from "./ToolSpec.js";

/**
 * Budget constraints for a tool invocation.
 */
export interface BudgetConfig {
  timeoutMs?: number;
  maxRetries?: number;
  maxToolCalls?: number;
}

/**
 * Execution context passed from agent-orchestra.
 * Contains permissions, budget, and observability context.
 */
export interface ExecContext {
  requestId: string;
  taskId: string;

  /** Allowed capabilities for this invocation */
  permissions: Capability[];
  budget?: BudgetConfig;

  /** OpenTelemetry-compatible trace ID */
  traceId?: string;
  userId?: string;

  /** Optional: enable dry-run mode for two-phase commit */
  dryRun?: boolean;
}

/**
 * Tool invocation intent from agent-orchestra.
 * Represents what the agent wants to do (untrusted input).
 */
export interface ToolIntent {
  /** ToolSpec.name reference */
  tool: string;
  /** Untrusted input arguments */
  args: unknown;
  /** Human-readable purpose for audit trail */
  purpose: string;
  /** Idempotency key: recommended format requestId:taskId:tool */
  idempotencyKey?: string;
}
