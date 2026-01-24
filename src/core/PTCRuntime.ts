import pTimeout from "p-timeout";
import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext, ToolIntent } from "../types/ToolIntent.js";
import type { Evidence, ToolResult } from "../types/ToolResult.js";
import type {
  ToolCalledEvent,
  ToolResultEvent,
  PolicyDeniedEvent,
  RetryEvent,
} from "../types/Events.js";
import { ToolRegistry } from "../registry/ToolRegistry.js";
import { SchemaValidator, SchemaValidationError } from "./SchemaValidator.js";
import { PolicyEngine, PolicyDeniedError } from "./PolicyEngine.js";
import { BudgetManager } from "./Budget.js";
import { withRetry, createTaggedError } from "./Retry.js";
import { buildEvidence } from "./Evidence.js";
import { EventLog } from "../observability/EventLog.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";
import { Metrics } from "../observability/Metrics.js";
import { Tracing } from "../observability/Tracing.js";
import type { PolicyConfig } from "./PolicyEngine.js";
import type { BudgetOptions } from "./Budget.js";

/**
 * PTC Runtime configuration.
 */
export interface PTCRuntimeConfig {
  policy?: PolicyConfig;
  budget?: BudgetOptions;
  /** Include raw response in ToolResult (default: true, disable in production) */
  includeRaw?: boolean;
  /** Maximum retries if not specified in context (default: 2) */
  defaultMaxRetries?: number;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

/**
 * PTC Runtime: the unified execution kernel for all tool invocations.
 *
 * Enforces the mandatory 9-step pipeline:
 * 1. Resolve (Registry lookup)
 * 2. Input Validate (AJV)
 * 3. Defaults Enrich
 * 4. Policy Gate
 * 5. Budget check
 * 6. Execute (adapter.invoke())
 * 7. Output Validate (AJV)
 * 8. Evidence Build
 * 9. Audit & Metrics
 *
 * Never throws to callers - always returns ToolResult.
 */
export class PTCRuntime {
  private readonly registry: ToolRegistry;
  private readonly adapters = new Map<string, ToolAdapter>();
  private readonly validator: SchemaValidator;
  private readonly policy: PolicyEngine;
  private readonly budget: BudgetManager;
  private readonly eventLog: EventLog;
  private readonly metrics: Metrics;
  private readonly tracing: Tracing;
  private readonly config: PTCRuntimeConfig;
  private readonly logger: Logger;

  constructor(
    options: {
      registry?: ToolRegistry;
      validator?: SchemaValidator;
      policy?: PolicyEngine;
      budget?: BudgetManager;
      eventLog?: EventLog;
      metrics?: Metrics;
      tracing?: Tracing;
      config?: PTCRuntimeConfig;
    } = {},
  ) {
    this.config = options.config ?? {};
    this.registry = options.registry ?? new ToolRegistry();
    this.validator = options.validator ?? new SchemaValidator();
    this.policy = options.policy ?? new PolicyEngine(this.config.policy);
    this.budget = options.budget ?? new BudgetManager(this.config.budget);
    this.eventLog = options.eventLog ?? new EventLog();
    this.metrics = options.metrics ?? new Metrics();
    this.tracing = options.tracing ?? new Tracing();
    this.logger = createLogger({ ...this.config.debug, prefix: "PTCRuntime" });

    if (this.logger.options.logEvents) {
      this.eventLog.on((entry) => {
        const event = entry.event;
        this.logger.debug("event", {
          seq: entry.seq,
          type: event.type,
          toolName: event.toolName,
          requestId: event.requestId,
          taskId: event.taskId,
          ok: "ok" in event ? event.ok : undefined,
        });
      });
    }
  }

  /**
   * Register an adapter for a tool kind.
   */
  registerAdapter(adapter: ToolAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  /**
   * Get the tool registry.
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * Get the event log.
   */
  getEventLog(): EventLog {
    return this.eventLog;
  }

  /**
   * Get the metrics collector.
   */
  getMetrics(): Metrics {
    return this.metrics;
  }

  /**
   * Get the tracing system.
   */
  getTracing(): Tracing {
    return this.tracing;
  }

  /**
   * Invoke a tool through the PTC pipeline.
   * Never throws - always returns a structured ToolResult.
   */
  async invoke(intent: ToolIntent, ctx: ExecContext): Promise<ToolResult> {
    const startTime = Date.now();
    if (this.logger.isEnabled("debug")) {
      this.logger.debug("invoke.start", {
        tool: intent.tool,
        requestId: ctx.requestId,
        taskId: ctx.taskId,
        traceId: ctx.traceId,
        purpose: intent.purpose,
        args: this.logger.options.includeArgs
          ? sanitizeForLog(intent.args)
          : undefined,
      });
    }
    const span = this.tracing.startSpan({
      name: `tool:${intent.tool}`,
      traceId: ctx.traceId,
      attributes: {
        "tool.name": intent.tool,
        "tool.purpose": intent.purpose,
        requestId: ctx.requestId,
        taskId: ctx.taskId,
      },
    });

    // Emit TOOL_CALLED event
    this.emitToolCalled(intent, ctx);

    try {
      // Step 1: Resolve
      const spec = this.resolve(intent.tool);

      this.tracing.addEvent(span.spanId, "resolved", {
        kind: spec.kind,
        version: spec.version,
      });

      // Step 2: Input Validate
      const validatedArgs = this.validateInput(spec, intent.args);

      // Step 3: Defaults Enrich
      const enrichedArgs = this.enrichDefaults(spec, validatedArgs);

      // Step 4: Policy Gate
      this.enforcePolicy(spec, enrichedArgs, ctx);

      // Step 5: Budget check
      if (!this.budget.checkRateLimit(spec.name)) {
        throw createTaggedError(
          "BUDGET_EXCEEDED",
          `Rate limit exceeded for tool: ${spec.name}`,
        );
      }

      // Dry-run mode: return without execution
      if (ctx.dryRun) {
        return this.buildDryRunResult(spec, enrichedArgs, ctx, startTime, span.spanId);
      }

      // Step 6: Execute with budget (timeout + retry + circuit breaker)
      const { result, raw } = await this.executeWithBudget(
        spec,
        enrichedArgs,
        ctx,
        span.spanId,
      );

      // Step 7: Output Validate
      const validatedOutput = this.validateOutput(spec, result);

      // Step 8: Evidence Build
      const durationMs = Date.now() - startTime;
      const evidence = buildEvidence({
        spec,
        args: enrichedArgs,
        result: validatedOutput,
        raw,
        ctx,
        durationMs,
      });

      // Step 9: Audit & Metrics
      this.recordSuccess(spec, durationMs, evidence, span.spanId);

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          durationMs,
          result: this.logger.options.includeResults
            ? summarizeForLog(validatedOutput)
            : undefined,
          raw: this.logger.options.includeRaw
            ? summarizeForLog(raw)
            : undefined,
        });
      }

      return {
        ok: true,
        result: validatedOutput,
        evidence,
        raw: this.config.includeRaw !== false ? raw : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return this.handleError(error, intent, ctx, durationMs, span.spanId);
    }
  }

  /**
   * Search for tools in the registry.
   */
  searchTools(
    query: string,
    filters?: { kind?: string; capabilities?: string[]; tags?: string[] },
  ): ToolSpec[] {
    return this.registry.search({
      text: query,
      kind: filters?.kind as any,
      capabilities: filters?.capabilities as any,
      tags: filters?.tags,
    });
  }

  /**
   * Get the schema for a tool.
   */
  getToolSchema(toolName: string): { input: object; output: object } | undefined {
    const spec = this.registry.get(toolName);
    if (!spec) return undefined;
    return { input: spec.inputSchema, output: spec.outputSchema };
  }

  // --- Pipeline Steps ---

  private resolve(toolName: string): ToolSpec {
    const spec = this.registry.get(toolName);
    if (!spec) {
      throw createTaggedError(
        "TOOL_NOT_FOUND",
        `Tool not found: ${toolName}`,
        { availableTools: this.registry.list().slice(0, 20) },
      );
    }
    return spec;
  }

  private validateInput(spec: ToolSpec, args: unknown): unknown {
    try {
      return this.validator.validateOrThrow(
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

  private enrichDefaults(spec: ToolSpec, args: unknown): unknown {
    return this.validator.enrichDefaults(spec.inputSchema, args);
  }

  private enforcePolicy(spec: ToolSpec, args: unknown, ctx: ExecContext): void {
    try {
      this.policy.enforce(spec, args, ctx);
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
        this.eventLog.append(event);
        this.metrics.recordPolicyDenied(spec.name, error.message);
      }
      throw error;
    }
  }

  private async executeWithBudget(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
    spanId: string,
  ): Promise<{ result: unknown; raw?: unknown }> {
    const adapter = this.adapters.get(spec.kind);
    if (!adapter) {
      throw createTaggedError(
        "TOOL_NOT_FOUND",
        `No adapter registered for kind: ${spec.kind}`,
      );
    }

    const timeoutMs = this.budget.getTimeout(
      spec.name,
      ctx.budget?.timeoutMs,
    );
    const maxRetries = ctx.budget?.maxRetries ?? this.config.defaultMaxRetries ?? 2;

    const executeFn = async () => {
      return this.budget.execute(spec.name, async () => {
        this.tracing.addEvent(spanId, "execute_start");
        this.logger.trace("execute.start", {
          tool: spec.name,
          requestId: ctx.requestId,
          timeoutMs,
          maxRetries,
        });
        const result = await adapter.invoke(spec, args, ctx);
        this.tracing.addEvent(spanId, "execute_end");
        this.logger.trace("execute.end", {
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
          this.metrics.recordRetry(spec.name);
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
          this.eventLog.append(event);
          this.tracing.addEvent(spanId, "retry", { attempt, reason: error.message });
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

  private validateOutput(spec: ToolSpec, result: unknown): unknown {
    try {
      return this.validator.validateOrThrow(
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

  private buildDryRunResult(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
    startTime: number,
    spanId: string,
  ): ToolResult {
    const durationMs = Date.now() - startTime;
    this.tracing.endSpan(spanId, "ok");

    return {
      ok: true,
      result: {
        dryRun: true,
        tool: spec.name,
        kind: spec.kind,
        args,
        capabilities: spec.capabilities,
      },
      evidence: [
        {
          type: "tool",
          ref: `${spec.name}@${spec.version}`,
          summary: `Dry-run: would execute ${spec.kind}:${spec.name}`,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  // --- Observability Helpers ---

  private emitToolCalled(intent: ToolIntent, ctx: ExecContext): void {
    const event: ToolCalledEvent = {
      type: "TOOL_CALLED",
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId,
      taskId: ctx.taskId,
      toolName: intent.tool,
      traceId: ctx.traceId,
      userId: ctx.userId,
      argsSummary: this.sanitizeArgs(intent.args),
      purpose: intent.purpose,
      idempotencyKey: intent.idempotencyKey,
    };
    this.eventLog.append(event);
  }

  private recordSuccess(
    spec: ToolSpec,
    durationMs: number,
    evidence: Evidence[],
    spanId: string,
  ): void {
    this.metrics.recordInvocation(spec.name, true, durationMs);
    this.tracing.setAttributes(spanId, {
      "tool.duration_ms": durationMs,
      "tool.ok": true,
    });
    this.tracing.endSpan(spanId, "ok");
  }

  private handleError(
    error: unknown,
    intent: ToolIntent,
    ctx: ExecContext,
    durationMs: number,
    spanId: string,
  ): ToolResult {
    const kind = (error as any)?.kind ?? "UPSTREAM_ERROR";
    const message =
      error instanceof Error ? error.message : String(error);
    const details = (error as any)?.details;

    // Metrics & tracing
    this.metrics.recordInvocation(intent.tool, false, durationMs);
    this.tracing.setAttributes(spanId, {
      "tool.duration_ms": durationMs,
      "tool.ok": false,
      "tool.error_kind": kind,
    });
    this.tracing.endSpan(spanId, "error");

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
    this.eventLog.append(event);

    this.logger.warn("invoke.error", {
      tool: intent.tool,
      requestId: ctx.requestId,
      taskId: ctx.taskId,
      traceId: ctx.traceId,
      kind,
      message,
      durationMs,
      details: this.logger.options.includeResults
        ? summarizeForLog(details)
        : undefined,
    });

    return {
      ok: false,
      evidence: [],
      error: { kind, message, details },
    };
  }

  private sanitizeArgs(args: unknown): string {
    if (!args) return "{}";
    return sanitizeForLog(args);
  }
}
