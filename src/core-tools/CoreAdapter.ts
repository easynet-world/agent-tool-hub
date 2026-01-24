import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import type { CoreToolHandler, CoreToolContext, CoreToolsConfig } from "./types.js";

/**
 * Adapter for core tools (kind="core").
 * Dispatches to registered handler functions by tool name.
 *
 * Core tools are local, atomic operations (filesystem, HTTP, utilities)
 * that enforce their own security constraints (sandbox, SSRF) in addition
 * to the PolicyEngine capability gating.
 */
export class CoreAdapter implements ToolAdapter {
  readonly kind = "core" as const;
  private readonly handlers = new Map<string, CoreToolHandler>();
  private readonly config: CoreToolsConfig;

  constructor(config: CoreToolsConfig) {
    this.config = config;
  }

  /**
   * Register a handler for a specific core tool name.
   */
  registerHandler(toolName: string, handler: CoreToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  /**
   * Unregister a handler.
   */
  unregisterHandler(toolName: string): boolean {
    return this.handlers.delete(toolName);
  }

  /**
   * List registered core tool names.
   */
  getRegisteredTools(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Invoke dispatches to the appropriate handler by spec.name.
   */
  async invoke(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    const handler = this.handlers.get(spec.name);
    if (!handler) {
      throw new Error(
        `Core tool handler not found: ${spec.name}. Available: [${this.getRegisteredTools().join(", ")}]`,
      );
    }

    const coreCtx: CoreToolContext = {
      execCtx: ctx,
      config: this.config,
    };

    const output = await handler(args as Record<string, unknown>, coreCtx);

    return {
      result: output.result,
      raw: { evidence: output.evidence },
    };
  }
}
