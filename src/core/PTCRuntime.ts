import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext, ToolIntent } from "../types/ToolIntent.js";
import type { ToolResult, Evidence } from "../types/ToolResult.js";
import { ToolRegistry } from "../registry/ToolRegistry.js";
import { SchemaValidator } from "./SchemaValidator.js";
import { PolicyEngine } from "./PolicyEngine.js";
import { BudgetManager } from "./Budget.js";
import { buildEvidence } from "./Evidence.js";
import { EventLog } from "../observability/EventLog.js";
import { createLogger, summarizeForLog, sanitizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";
import { Metrics } from "../observability/Metrics.js";
import { Tracing } from "../observability/Tracing.js";
import type { PolicyConfig } from "./PolicyEngine.js";
import type { BudgetOptions } from "./Budget.js";
import { createTaggedError } from "./Retry.js";
import {
  resolveTool,
  validateInput,
  enrichDefaults,
  enforcePolicy,
  executeWithBudget,
  validateOutput,
  type PipelineDependencies,
} from "./PTCRuntimePipeline.js";
import {
  emitToolCalled,
  recordSuccess,
  handleError,
  type ObservabilityDependencies,
} from "./PTCRuntimeObservability.js";

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
   * Get an adapter by kind (e.g. "mcp"). Use to set MCP client via adapter.setClient().
   */
  getAdapter(kind: string): ToolAdapter | undefined {
    return this.adapters.get(kind);
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
    emitToolCalled(intent, ctx, this.getObservabilityDeps());

    try {
      // Step 1: Resolve
      const spec = resolveTool(intent.tool, this.registry);

      this.tracing.addEvent(span.spanId, "resolved", {
        kind: spec.kind,
        version: spec.version,
      });

      // Step 2: Input Validate
      const validatedArgs = validateInput(spec, intent.args, this.validator);

      // Step 3: Defaults Enrich
      const enrichedArgs = enrichDefaults(spec, validatedArgs, this.validator);

      // Step 4: Policy Gate
      enforcePolicy(spec, enrichedArgs, ctx, {
        policy: this.policy,
        eventLog: this.eventLog,
        metrics: this.metrics,
        tracing: this.tracing,
      });

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
      const { result, raw } = await executeWithBudget(
        spec,
        enrichedArgs,
        ctx,
        span.spanId,
        this.getPipelineDeps(),
      );

      // Step 7: Output Validate
      const validatedOutput = validateOutput(spec, result, this.validator);

      // Step 8: Evidence Build (merge adapter-provided evidence with built evidence)
      const durationMs = Date.now() - startTime;
      const builtEvidence = buildEvidence({
        spec,
        args: enrichedArgs,
        result: validatedOutput,
        raw,
        ctx,
        durationMs,
      });
      const adapterEvidence: Evidence[] =
        raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { evidence?: Evidence[] }).evidence)
          ? ((raw as { evidence: Evidence[] }).evidence as Evidence[])
          : [];
      const evidence = [...adapterEvidence, ...builtEvidence];

      // Step 9: Audit & Metrics
      recordSuccess(spec, durationMs, evidence, span.spanId, this.getObservabilityDeps());

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
      return handleError(error, intent, ctx, durationMs, span.spanId, this.getObservabilityDeps());
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

  // --- Helper Methods ---

  private getPipelineDeps(): PipelineDependencies {
    return {
      registry: this.registry,
      adapters: this.adapters,
      validator: this.validator,
      policy: this.policy,
      budget: this.budget,
      eventLog: this.eventLog,
      metrics: this.metrics,
      tracing: this.tracing,
      logger: this.logger,
      defaultMaxRetries: this.config.defaultMaxRetries,
    };
  }

  private getObservabilityDeps(): ObservabilityDependencies {
    return {
      eventLog: this.eventLog,
      metrics: this.metrics,
      tracing: this.tracing,
      logger: this.logger,
    };
  }

  private buildDryRunResult(
    spec: ToolSpec,
    args: unknown,
    _ctx: ExecContext,
    startTime: number,
    spanId: string,
  ): ToolResult {
    void (Date.now() - startTime); // durationMs calculated but not used in dry-run
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

}
