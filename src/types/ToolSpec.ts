/**
 * Unified tool kinds supported by the tools package.
 */
export type ToolKind = "mcp" | "langchain" | "n8n" | "comfyui" | "skill" | "core";

/**
 * Capability declarations for tools.
 * Used by PolicyEngine for permission gating.
 */
export type Capability =
  | "read:web"
  | "read:fs"
  | "write:fs"
  | "read:db"
  | "write:db"
  | "network"
  | "gpu"
  | "workflow"
  | "danger:destructive";

/**
 * Cost hints for tools, used by Budget and routing.
 */
export interface CostHints {
  latencyMsP50?: number;
  latencyMsP95?: number;
  isAsync?: boolean;
}

/**
 * Unified tool specification.
 * All tool types (MCP, LangChain, n8n, ComfyUI, SKILL) are described by this interface.
 */
export interface ToolSpec {
  /** Globally unique name, recommended format: namespace/name */
  name: string;
  /** Semver version */
  version: string;
  /** Tool kind determines which adapter handles execution */
  kind: ToolKind;

  description?: string;
  tags?: string[];

  /** JSON Schema for input validation */
  inputSchema: object;
  /** JSON Schema for output validation */
  outputSchema: object;

  /** Required capabilities for this tool */
  capabilities: Capability[];
  costHints?: CostHints;

  /** Adapter-specific: endpoint URL (MCP/n8n/ComfyUI) */
  endpoint?: string;
  /** Adapter-specific: resource identifier (workflowId, promptId, etc.) */
  resourceId?: string;
  /** Adapter-specific: implementation reference (LangChain Tool instance, skill handler) */
  impl?: unknown;
}

/**
 * Unified adapter interface.
 * Each protocol adapter (MCP, LangChain, n8n, ComfyUI, SKILL) implements this.
 */
export interface ToolAdapter {
  kind: ToolKind;
  /** Optional: supports dynamic tool discovery */
  listTools?(): Promise<ToolSpec[]>;
  /** Execute the tool with validated args */
  invoke(
    spec: ToolSpec,
    args: unknown,
    ctx: import("./ToolIntent.js").ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }>;
}
