import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MCPServerConfig, ToolManifest, LoadedTool } from "../types.js";
import { DiscoveryError } from "../errors.js";

/**
 * Cursor-compatible mcpServers wrapper format.
 * Example: { "mcpServers": { "server-name": { "command": "npx", "args": [...] } } }
 */
interface CursorMCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Check if the parsed JSON is in Cursor's mcpServers wrapper format.
 */
function isCursorFormat(obj: unknown): obj is CursorMCPConfig {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "mcpServers" in obj &&
    typeof (obj as CursorMCPConfig).mcpServers === "object" &&
    (obj as CursorMCPConfig).mcpServers !== null
  );
}

/**
 * Extract MCPServerConfig from either Cursor wrapper format or bare format.
 * - Cursor format: { "mcpServers": { "name": { command/url/args/env } } }
 *   Uses the first server entry (or the one matching the tool name).
 * - Bare format: { "command": "...", "args": [...] } or { "url": "..." }
 */
function extractMCPConfig(
  parsed: unknown,
  toolName: string | undefined,
): MCPServerConfig {
  if (isCursorFormat(parsed)) {
    const servers = parsed.mcpServers;
    const keys = Object.keys(servers);
    if (keys.length === 0) {
      return {};
    }
    // Prefer server matching tool name, otherwise use first entry
    const name = toolName && keys.includes(toolName) ? toolName : keys[0]!;
    return servers[name]!;
  }
  return parsed as MCPServerConfig;
}

/**
 * Load an MCP tool from its directory.
 * Reads mcp.json and validates it has either command or url.
 * Supports both Cursor's mcpServers wrapper format and bare server config.
 */
export async function loadMCPTool(
  dirPath: string,
  manifest: ToolManifest,
): Promise<LoadedTool> {
  const mcpPath = join(dirPath, manifest.entryPoint ?? "mcp.json");

  let raw: string;
  try {
    raw = await readFile(mcpPath, "utf-8");
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Failed to read MCP config: ${mcpPath}`,
      err as Error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Invalid JSON in ${mcpPath}`,
      err as Error,
    );
  }

  // Extract server config from Cursor wrapper or bare format
  const baseName = manifest.name?.split("/").pop();
  const config = extractMCPConfig(parsed, baseName);

  if (!config.command && !config.url) {
    throw new DiscoveryError(
      dirPath,
      "validate",
      `mcp.json must have either "command" or "url" field`,
    );
  }

  return { manifest, dirPath, mcpConfig: config };
}
