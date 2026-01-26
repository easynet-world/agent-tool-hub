import pTimeout from "p-timeout";
import type { ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import type { ToolAdapter } from "../types/ToolSpec.js";
import { SchemaValidator, SchemaValidationError } from "./SchemaValidator.js";
import { PolicyEngine, PolicyDeniedError } from "./PolicyEngine.js";
import { BudgetManager } from "./Budget.js";
import { withRetry, createTaggedError } from "./Retry.js";
import type { PolicyDeniedEvent, RetryEvent } from "../types/Events.js";
import { EventLog } from "../observability/EventLog.js";
import { Metrics } from "../observability/Metrics.js";
import { Tracing } from "../observability/Tracing.js";
import type { Logger } from "../observability/Logger.js";

export interface PipelineDependencies {
  registry: { get(name: string): ToolSpec | undefined; snapshot(): ToolSpec[] };
  adapters: Map<string, ToolAdapter>;
  validator: SchemaValidator;
  policy: PolicyEngine;
  budget: BudgetManager;
  eventLog: EventLog;
  metrics: Metrics;
  tracing: Tracing;
  logger: Logger;
  defaultMaxRetries?: number;
}

/**
 * Pipeline step: Resolve tool from registry.
 */
export function resolveTool(
  toolName: string,
  registry: PipelineDependencies["registry"],
): ToolSpec {
  const spec = registry.get(toolName);
  if (!spec) {
    throw createTaggedError(
      "TOOL_NOT_FOUND",
      `Tool not found: ${toolName}`,
      { availableTools: registry.snapshot().slice(0, 20).map(s => s.name) },
    );
  }
  return spec;
}

/**
 * Pipeline step: Validate input against schema.
 */
export function validateInput(
  spec: ToolSpec,
  args: unknown,
  validator: SchemaValidator,
): unknown {
  try {
    return validator.validateOrThrow(
      spec.inputSchema,
      args,
      `Input validation failed for ${spec.name}`,
    );
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw createTaggedError("INPUT_SCHEMA_INVALID", error.message, {
        errors: error.errors,
        schema: spec.inputSchema,
      });
    }
    throw error;
  }
}

/**
 * Pipeline step: Enrich args with defaults from schema.
 */
export function enrichDefaults(
  spec: ToolSpec,
  args: unknown,
  validator: SchemaValidator,
): unknown {
  return validator.enrichDefaults(spec.inputSchema, args);
}

/**
 * Pipeline step: Enforce policy checks.
 */
export function enforcePolicy(
  spec: ToolSpec,
  args: unknown,
  ctx: ExecContext,
  deps: Pick<
    PipelineDependencies,
    "policy" | "eventLog" | "metrics" | "tracing"
  >,
): void {
  try {
    deps.policy.enforce(spec, args, ctx);
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      // Emit policy denied event
      const event: PolicyDeniedEvent = {
        type: "POLICY_DENIED",
        timestamp: new Date().toISOString(),
        requestId: ctx.requestId,
        taskId: ctx.taskId,
        toolName: spec.name,
        traceId: ctx.traceId,
        userId: ctx.userId,
        reason: error.message,
        missingCapabilities: error.missingCapabilities?.map(String),
      };
      deps.eventLog.append(event);
      deps.metrics.recordPolicyDenied(spec.name, error.message);
    }
    throw error;
  }
}

/**
 * Pipeline step: Execute tool with budget, retry, and timeout.
 */
export async function executeWithBudget(
  spec: ToolSpec,
  args: unknown,
  ctx: ExecContext,
  spanId: string,
  deps: PipelineDependencies,
): Promise<{ result: unknown; raw?: unknown }> {
  const adapter = deps.adapters.get(spec.kind);
  if (!adapter) {
    throw createTaggedError(
      "TOOL_NOT_FOUND",
      `No adapter registered for kind: ${spec.kind}`,
    );
  }

  const timeoutMs = deps.budget.getTimeout(
    spec.name,
    ctx.budget?.timeoutMs,
  );
  const maxRetries = ctx.budget?.maxRetries ?? deps.defaultMaxRetries ?? 2;

  const executeFn = async () => {
    return deps.budget.execute(spec.name, async () => {
      deps.tracing.addEvent(spanId, "execute_start");
      deps.logger.trace("execute.start", {
        tool: spec.name,
        requestId: ctx.requestId,
        timeoutMs,
        maxRetries,
      });
      const result = await adapter.invoke(spec, args, ctx);
      deps.tracing.addEvent(spanId, "execute_end");
      deps.logger.trace("execute.end", {
        tool: spec.name,
        requestId: ctx.requestId,
      });
      return result;
    });
  };

  // Wrap with retry
  const retryFn = () =>
    withRetry(executeFn, {
      maxRetries,
      onRetry: (error, attempt) => {
        deps.metrics.recordRetry(spec.name);
        const event: RetryEvent = {
          type: "RETRY",
          timestamp: new Date().toISOString(),
          requestId: ctx.requestId,
          taskId: ctx.taskId,
          toolName: spec.name,
          traceId: ctx.traceId,
          userId: ctx.userId,
          attempt,
          maxRetries,
          reason: error.message,
        };
        deps.eventLog.append(event);
        deps.tracing.addEvent(spanId, "retry", { attempt, reason: error.message });
      },
    });

  // Wrap with timeout
  try {
    return await pTimeout(retryFn(), {
      milliseconds: timeoutMs,
      message: `Tool ${spec.name} timed out after ${timeoutMs}ms`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      throw createTaggedError("TIMEOUT", error.message);
    }
    throw error;
  }
}

/**
 * Pipeline step: Validate output against schema.
 */
export function validateOutput(
  spec: ToolSpec,
  result: unknown,
  validator: SchemaValidator,
): unknown {
  try {
    return validator.validateOrThrow(
      spec.outputSchema,
      result,
      `Output validation failed for ${spec.name}`,
    );
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw createTaggedError("OUTPUT_SCHEMA_INVALID", error.message, {
        errors: error.errors,
      });
    }
    throw error;
  }
}
