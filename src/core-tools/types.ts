import type { ExecContext } from "../types/ToolIntent.js";
import type { Evidence } from "../types/ToolResult.js";

/**
 * Configuration for core tools runtime.
 */
export interface CoreToolsConfig {
  /** Absolute path. All FS operations are confined within this root. */
  sandboxRoot: string;
  /** Only these hosts may be fetched. Supports wildcard prefix (e.g. "*.github.com"). */
  allowedHosts: string[];
  /** Maximum bytes for fs.readText (default: 5MB) */
  maxReadBytes: number;
  /** Maximum bytes for HTTP response body (default: 5MB) */
  maxHttpBytes: number;
  /** Maximum bytes for http.downloadFile (default: 100MB) */
  maxDownloadBytes: number;
  /** CIDR ranges to block. Defaults include RFC1918 + loopback + link-local. */
  blockedCidrs: string[];
  /** Default HTTP timeout in ms (default: 15000) */
  defaultTimeoutMs: number;
  /** User-Agent header for HTTP requests */
  httpUserAgent: string;
  /** If true, large HTTP responses are auto-written to sandbox and a file ref is returned */
  enableAutoWriteLargeResponses: boolean;
}

/**
 * Default configuration values for core tools.
 */
export const DEFAULT_CORE_TOOLS_CONFIG: Omit<CoreToolsConfig, "sandboxRoot" | "allowedHosts"> = {
  maxReadBytes: 5 * 1024 * 1024,
  maxHttpBytes: 5 * 1024 * 1024,
  maxDownloadBytes: 100 * 1024 * 1024,
  blockedCidrs: [
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
  ],
  defaultTimeoutMs: 15_000,
  httpUserAgent: "agent-tool-hub-core/1.0",
  enableAutoWriteLargeResponses: false,
};

/**
 * Context passed to each core tool handler.
 */
export interface CoreToolContext {
  execCtx: ExecContext;
  config: CoreToolsConfig;
}

/**
 * Structured result from a core tool handler.
 */
export interface CoreToolResult {
  result: unknown;
  evidence: Evidence[];
}

/**
 * A core tool handler function.
 */
export type CoreToolHandler = (
  args: Record<string, unknown>,
  ctx: CoreToolContext,
) => Promise<CoreToolResult>;
