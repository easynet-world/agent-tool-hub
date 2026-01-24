import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

/**
 * MCP tool definition as returned by MCP server.
 */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: object;
}

/**
 * MCP call result from MCP server.
 */
export interface MCPCallResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}

/**
 * Injectable MCP client interface.
 * Matches the core methods of @modelcontextprotocol/sdk Client.
 */
export interface MCPClientLike {
  listTools(): Promise<{ tools: MCPToolDefinition[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<MCPCallResult>;
}

/**
 * Options for creating an MCPAdapter.
 */
export interface MCPAdapterOptions {
  /** Injectable MCP client instance */
  client?: MCPClientLike;
  /** Endpoint URL for the MCP server (used in ToolSpec) */
  endpoint?: string;
  /** Tool name prefix for namespacing */
  prefix?: string;
  /** Auth token for MCP server */
  authToken?: string;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

/**
 * Adapter for MCP (Model Context Protocol) servers.
 * Supports tool discovery and invocation via injectable MCP client.
 */
export class MCPAdapter implements ToolAdapter {
  readonly kind = "mcp" as const;
  private client: MCPClientLike | undefined;
  private readonly endpoint: string;
  private readonly prefix: string;
  private readonly authToken?: string;
  private cachedTools: ToolSpec[] | undefined;
  private cacheExpiry = 0;
  private readonly cacheTtlMs = 30_000; // 30s cache
  private readonly logger: Logger;

  constructor(options: MCPAdapterOptions = {}) {
    this.client = options.client;
    this.endpoint = options.endpoint ?? "";
    this.prefix = options.prefix ?? "mcp";
    this.authToken = options.authToken;
    this.logger = createLogger({ ...options.debug, prefix: "MCPAdapter" });
  }

  /**
   * Set or replace the MCP client.
   */
  setClient(client: MCPClientLike): void {
    this.client = client;
    this.invalidateCache();
  }

  /**
   * Discover tools from the MCP server.
   */
  async listTools(): Promise<ToolSpec[]> {
    if (!this.client) {
      throw new Error("MCP client not configured. Call setClient() first.");
    }

    // Check cache
    if (this.cachedTools && Date.now() < this.cacheExpiry) {
      return this.cachedTools;
    }

    const response = await this.client.listTools();
    const specs = response.tools.map((tool) => this.mapToToolSpec(tool));

    this.cachedTools = specs;
    this.cacheExpiry = Date.now() + this.cacheTtlMs;

    return specs;
  }

  /**
   * Invoke an MCP tool.
   */
  async invoke(
    spec: ToolSpec,
    args: unknown,
    _ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    if (!this.client) {
      throw new Error("MCP client not configured. Call setClient() first.");
    }

    if (this.logger.isEnabled("debug")) {
      this.logger.debug("invoke.start", {
        tool: spec.name,
        args: this.logger.options.includeArgs ? sanitizeForLog(args) : undefined,
      });
    }

    // Extract the original MCP tool name (remove prefix)
    const mcpToolName = this.extractMCPName(spec.name);

    try {
      const response = await this.client.callTool({
        name: mcpToolName,
        arguments: (args as Record<string, unknown>) ?? {},
      });

      if (response.isError) {
        const errorText = response.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        throw new Error(`MCP tool error: ${errorText || "Unknown error"}`);
      }

      // Parse result from content
      const result = this.parseResult(response);

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          result: this.logger.options.includeResults
            ? summarizeForLog(result)
            : undefined,
          raw: this.logger.options.includeRaw
            ? summarizeForLog(response)
            : undefined,
        });
      }

      return { result, raw: response };
    } catch (error) {
      this.logger.warn("invoke.error", {
        tool: spec.name,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Invalidate the tool cache.
   */
  invalidateCache(): void {
    this.cachedTools = undefined;
    this.cacheExpiry = 0;
  }

  private mapToToolSpec(tool: MCPToolDefinition): ToolSpec {
    return {
      name: `${this.prefix}/${tool.name}`,
      version: "1.0.0",
      kind: "mcp",
      description: tool.description ?? `MCP tool: ${tool.name}`,
      inputSchema: tool.inputSchema ?? {
        type: "object",
        additionalProperties: true,
      },
      outputSchema: { type: "object", additionalProperties: true },
      capabilities: ["network"],
      endpoint: this.endpoint,
    };
  }

  private extractMCPName(specName: string): string {
    const prefix = `${this.prefix}/`;
    if (specName.startsWith(prefix)) {
      return specName.slice(prefix.length);
    }
    return specName;
  }

  private parseResult(response: MCPCallResult): unknown {
    const textParts = response.content.filter((c) => c.type === "text");
    const dataParts = response.content.filter((c) => c.data !== undefined);

    // If there's structured data, prefer it
    if (dataParts.length > 0) {
      return dataParts.length === 1 ? dataParts[0]!.data : dataParts.map((d) => d.data);
    }

    // Otherwise parse text as JSON or return as string
    if (textParts.length > 0) {
      const text = textParts.map((t) => t.text).join("\n");
      try {
        return JSON.parse(text);
      } catch {
        return { output: text };
      }
    }

    return { content: response.content };
  }
}
