import type { Capability, CostHints, ToolKind } from "../types/ToolSpec.js";
import type { SkillDefinition } from "./loaders/SkillManifest.js";

/**
 * Cursor-compatible MCP server configuration.
 * Supports command-based (stdio) and URL-based (SSE/HTTP) servers.
 */
export interface MCPServerConfig {
  /** Command to spawn the MCP server process */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables for the spawned process */
  env?: Record<string, string>;
  /** SSE/HTTP URL for remote MCP server */
  url?: string;
}

/**
 * Discoverable tool kinds (subset of ToolKind that can be directory-discovered).
 */
export type DiscoverableKind = Extract<ToolKind, "mcp" | "langchain" | "skill" | "n8n">;

/**
 * Tool manifest read from tool.json or inferred from conventional files.
 */
export interface ToolManifest {
  /** Tool kind — determines which loader and adapter handle this tool */
  kind: DiscoverableKind;
  /** Tool name override (default: "<namespace>/<dirname>") */
  name?: string;
  /** Semver version (default: "1.0.0") */
  version?: string;
  /** Human-readable description */
  description?: string;
  /** Searchable tags */
  tags?: string[];
  /** Required capabilities for PolicyEngine gating */
  capabilities?: Capability[];
  /** Cost hints for routing/budgeting */
  costHints?: CostHints;
  /**
   * Entry point file relative to tool directory.
   * Defaults per kind:
   *   mcp → "mcp.json"
   *   langchain → "index" (or all *.js/*.mjs files when inside a "langchain" folder)
   *   skill → "handler"
   *   n8n → "workflow.json"
   */
  entryPoint?: string;
  /** JSON Schema for input validation */
  inputSchema?: object;
  /** JSON Schema for output validation */
  outputSchema?: object;
  /** Whether this tool is enabled (default: true). Set false to skip. */
  enabled?: boolean;
}

/**
 * Configuration for the DirectoryScanner.
 */
export interface DirectoryScannerOptions {
  /** One or more root directories to scan for tool subdirectories */
  roots: Array<string | { path: string; namespace?: string }>;
  /** Namespace prefix for discovered tool names (default: "dir") */
  namespace?: string;
  /** File extensions to try for JS/TS entry points (default: [".js", ".mjs"]) */
  extensions?: string[];
  /** Callback for non-fatal errors during scan (tool dir path, error) */
  onError?: (toolDir: string, error: Error) => void;
}

/**
 * Result from loading a single tool directory.
 */
export interface LoadedTool {
  /** The parsed manifest */
  manifest: ToolManifest;
  /** Absolute path to the tool directory */
  dirPath: string;
  /** Loaded implementation (LangChainToolLike instance or SkillHandler function) */
  impl?: unknown;
  /** For MCP tools: the parsed server config from mcp.json */
  mcpConfig?: MCPServerConfig;
  /** For n8n tools: the parsed workflow definition */
  workflowDef?: unknown;
  /** For Skill tools: the parsed SKILL.md definition with progressive disclosure levels */
  skillDefinition?: SkillDefinition;
}
