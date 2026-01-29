import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

/**
 * Interface for LangChain-compatible tool instances.
 * Matches @langchain/core BaseTool.invoke() signature.
 *
 * Return value: can be any value, or { result, evidence? } (same as Skill) to attach
 * custom evidence; the runtime merges adapter evidence into ToolResult.evidence.
 */
export interface LangChainToolLike {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
  name?: string;
  description?: string;
  schema?: object;
}

/**
 * Options for creating a LangChainAdapter.
 */
export interface LangChainAdapterOptions {
  /** Map of tool names to their implementations */
  tools?: Map<string, LangChainToolLike>;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

/**
 * Adapter for LangChain-compatible tools.
 * Wraps local tool instances with the unified ToolAdapter interface.
 */
export class LangChainAdapter implements ToolAdapter {
  readonly kind = "langchain" as const;
  private readonly tools: Map<string, LangChainToolLike>;
  private readonly logger: Logger;

  constructor(options: LangChainAdapterOptions = {}) {
    this.tools = options.tools ?? new Map();
    this.logger = createLogger({ ...options.debug, prefix: "LangChainAdapter" });
  }

  /**
   * Register a LangChain tool instance.
   */
  registerTool(name: string, tool: LangChainToolLike): void {
    this.tools.set(name, tool);
  }

  /**
   * Unregister a tool.
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * List available tools (from registered instances).
   */
  async listTools(): Promise<ToolSpec[]> {
    const specs: ToolSpec[] = [];
    for (const [name, tool] of this.tools) {
      specs.push({
        name,
        version: "1.0.0",
        kind: "langchain",
        description: tool.description ?? `LangChain tool: ${name}`,
        inputSchema: (tool.schema as object) ?? {
          type: "object",
          additionalProperties: true,
        },
        outputSchema: { type: "object", additionalProperties: true },
        capabilities: [],
        impl: tool,
      });
    }
    return specs;
  }

  /**
   * Invoke a LangChain tool.
   */
  async invoke(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    if (this.logger.isEnabled("debug")) {
      this.logger.debug("invoke.start", {
        tool: spec.name,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        args: this.logger.options.includeArgs ? sanitizeForLog(args) : undefined,
      });
    }
    // Get tool instance from spec.impl or local registry
    const tool = this.resolveTool(spec);

    if (!tool) {
      throw new Error(
        `LangChain tool not found: ${spec.name}. Register it with registerTool() or provide via spec.impl.`,
      );
    }

    try {
      // Invoke the tool
      const raw = await tool.invoke(args, {
        metadata: {
          requestId: ctx.requestId,
          taskId: ctx.taskId,
          traceId: ctx.traceId,
        },
      });

      // Support { result, evidence? } convention (same as Skill) only when evidence is present
      const hasEvidence =
        raw &&
        typeof raw === "object" &&
        "evidence" in raw &&
        Array.isArray((raw as { evidence: unknown }).evidence);
      const result = hasEvidence && "result" in raw
        ? (raw as { result: unknown }).result
        : this.normalizeResult(raw);

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          result: this.logger.options.includeResults
            ? summarizeForLog(result)
            : undefined,
          raw: this.logger.options.includeRaw ? summarizeForLog(raw) : undefined,
        });
      }

      return { result, raw };
    } catch (error) {
      this.logger.warn("invoke.error", {
        tool: spec.name,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private resolveTool(spec: ToolSpec): LangChainToolLike | undefined {
    // Priority: spec.impl > local registry
    if (spec.impl && typeof spec.impl === "object" && "invoke" in spec.impl) {
      return spec.impl as LangChainToolLike;
    }
    return this.tools.get(spec.name);
  }

  private normalizeResult(raw: unknown): unknown {
    // If the result is a string, wrap it in an object
    if (typeof raw === "string") {
      return { output: raw };
    }
    // If it's already an object, use as-is
    if (raw && typeof raw === "object") {
      return raw;
    }
    // Wrap primitives
    return { output: raw };
  }
}
