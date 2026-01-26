import type { ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext, ToolIntent } from "../types/ToolIntent.js";
import type { Evidence, ToolResult } from "../types/ToolResult.js";
import type {
  ToolCalledEvent,
  ToolResultEvent,
} from "../types/Events.js";
import { EventLog } from "../observability/EventLog.js";
import { Metrics } from "../observability/Metrics.js";
import { Tracing } from "../observability/Tracing.js";
import { sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { Logger } from "../observability/Logger.js";

export interface ObservabilityDependencies {
  eventLog: EventLog;
  metrics: Metrics;
  tracing: Tracing;
  logger: Logger;
}

/**
 * Emit TOOL_CALLED event.
 */
export function emitToolCalled(
  intent: ToolIntent,
  ctx: ExecContext,
  deps: ObservabilityDependencies,
): void {
  const event: ToolCalledEvent = {
    type: "TOOL_CALLED",
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
    taskId: ctx.taskId,
    toolName: intent.tool,
    traceId: ctx.traceId,
    userId: ctx.userId,
    argsSummary: sanitizeArgs(intent.args),
    purpose: intent.purpose,
    idempotencyKey: intent.idempotencyKey,
  };
  deps.eventLog.append(event);
}

/**
 * Record successful tool invocation.
 */
export function recordSuccess(
  spec: ToolSpec,
  durationMs: number,
  evidence: Evidence[],
  spanId: string,
  deps: ObservabilityDependencies,
): void {
  deps.metrics.recordInvocation(spec.name, true, durationMs);
  deps.tracing.setAttributes(spanId, {
    "tool.duration_ms": durationMs,
    "tool.ok": true,
  });
  deps.tracing.endSpan(spanId, "ok");
}

/**
 * Handle error and return ToolResult.
 */
export function handleError(
  error: unknown,
  intent: ToolIntent,
  ctx: ExecContext,
  durationMs: number,
  spanId: string,
  deps: ObservabilityDependencies,
): ToolResult {
  const kind = (error as any)?.kind ?? "UPSTREAM_ERROR";
  const message =
    error instanceof Error ? error.message : String(error);
  const details = (error as any)?.details;

  // Metrics & tracing
  deps.metrics.recordInvocation(intent.tool, false, durationMs);
  deps.tracing.setAttributes(spanId, {
    "tool.duration_ms": durationMs,
    "tool.ok": false,
    "tool.error_kind": kind,
  });
  deps.tracing.endSpan(spanId, "error");

  // Event log
  const event: ToolResultEvent = {
    type: "TOOL_RESULT",
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
    taskId: ctx.taskId,
    toolName: intent.tool,
    traceId: ctx.traceId,
    userId: ctx.userId,
    ok: false,
    durationMs,
    resultSummary: message,
    evidence: [],
    error: { kind, message, details },
  };
  deps.eventLog.append(event);

  deps.logger.warn("invoke.error", {
    tool: intent.tool,
    requestId: ctx.requestId,
    taskId: ctx.taskId,
    traceId: ctx.traceId,
    kind,
    message,
    durationMs,
    details: deps.logger.options.includeResults
      ? summarizeForLog(details)
      : undefined,
  });

  return {
    ok: false,
    evidence: [],
    error: { kind, message, details },
  };
}

function sanitizeArgs(args: unknown): string {
  if (!args) return "{}";
  return sanitizeForLog(args);
}
