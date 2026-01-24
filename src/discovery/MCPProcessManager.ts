import type { MCPServerConfig } from "./types.js";

/**
 * Connection info for an MCP server.
 */
export interface MCPConnectionInfo {
  /** Transport type: "url" for SSE/HTTP, "stdio" for command-based */
  type: "url" | "stdio";
  /** SSE/HTTP URL (when type="url") */
  url?: string;
  /** Command to spawn (when type="stdio") */
  command?: string;
  /** Command arguments (when type="stdio") */
  args?: string[];
  /** Environment variables (when type="stdio") */
  env?: Record<string, string>;
}

/**
 * Manages MCP server connection information extracted from directory discovery.
 *
 * This class provides connection configuration for MCP servers discovered
 * from mcp.json files. The actual MCP client creation and lifecycle management
 * is the consumer's responsibility (using @modelcontextprotocol/sdk or similar).
 *
 * Usage:
 * ```ts
 * const manager = new MCPProcessManager();
 * const info = manager.getConnectionInfo("my-tool", mcpConfig);
 * if (info.type === "stdio") {
 *   // Spawn process with info.command, info.args, info.env
 * } else {
 *   // Connect SSE client to info.url
 * }
 * ```
 */
export class MCPProcessManager {
  private readonly connections = new Map<string, MCPConnectionInfo>();

  /**
   * Get connection info for an MCP tool based on its config.
   * Caches the result by tool name.
   */
  getConnectionInfo(toolName: string, config: MCPServerConfig): MCPConnectionInfo {
    const cached = this.connections.get(toolName);
    if (cached) return cached;

    const info: MCPConnectionInfo = config.url
      ? { type: "url", url: config.url }
      : {
          type: "stdio",
          command: config.command!,
          args: config.args,
          env: config.env,
        };

    this.connections.set(toolName, info);
    return info;
  }

  /**
   * Remove cached connection info for a tool.
   */
  remove(toolName: string): boolean {
    return this.connections.delete(toolName);
  }

  /**
   * Get all registered tool names.
   */
  getToolNames(): string[] {
    return [...this.connections.keys()];
  }

  /**
   * Clear all cached connection info.
   */
  dispose(): void {
    this.connections.clear();
  }
}
