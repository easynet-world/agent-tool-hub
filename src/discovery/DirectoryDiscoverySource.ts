import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import type { DirectoryScannerOptions } from "./types.js";
import type { DiscoverySource } from "../registry/Discovery.js";
import { DirectoryScanner } from "./DirectoryScanner.js";

/**
 * A ToolAdapter that discovers tools from filesystem directories.
 * Used as the adapter within a DiscoverySource for the Discovery system.
 *
 * Note: This adapter's invoke() is not called directly. Discovered tools
 * retain their original kind (mcp/langchain/skill/n8n) and are invoked
 * by the kind-specific adapter registered on PTCRuntime.
 */
export class DirectoryToolAdapter implements ToolAdapter {
  readonly kind = "mcp" as const; // Required by ToolAdapter but not used for routing
  private readonly scanner: DirectoryScanner;

  constructor(options: DirectoryScannerOptions) {
    this.scanner = new DirectoryScanner(options);
  }

  /**
   * Scan directories and return discovered tool specs.
   * Called by Discovery.refresh().
   */
  async listTools(): Promise<ToolSpec[]> {
    return this.scanner.scan();
  }

  /**
   * Not used — actual invocation routes through kind-specific adapters.
   */
  async invoke(
    _spec: ToolSpec,
    _args: unknown,
    _ctx: ExecContext,
  ): Promise<{ result: unknown }> {
    throw new Error(
      "DirectoryToolAdapter.invoke() should not be called directly. " +
        "Tool execution is handled by the kind-specific adapter (MCPAdapter, LangChainAdapter, etc.).",
    );
  }

  /**
   * Get the underlying scanner for direct usage.
   */
  getScanner(): DirectoryScanner {
    return this.scanner;
  }
}

/**
 * Options for creating a directory discovery source.
 */
export interface DirectoryDiscoveryOptions extends DirectoryScannerOptions {
  /** Refresh interval in ms (0 = manual only, default: 0) */
  refreshIntervalMs?: number;
  /** Whether to auto-discover on startup (default: true) */
  autoDiscover?: boolean;
}

/**
 * Factory: create a DiscoverySource for directory-based tool discovery.
 *
 * Usage:
 * ```ts
 * const discovery = new Discovery(registry);
 * discovery.addSource(
 *   createDirectoryDiscoverySource("local-tools", {
 *     roots: ["/path/to/tools"],
 *     namespace: "local",
 *     refreshIntervalMs: 60_000,
 *     autoDiscover: true,
 *   })
 * );
 * ```
 */
export function createDirectoryDiscoverySource(
  id: string,
  options: DirectoryDiscoveryOptions,
): DiscoverySource {
  const { refreshIntervalMs, autoDiscover, ...scannerOptions } = options;

  return {
    id,
    adapter: new DirectoryToolAdapter(scannerOptions),
    refreshIntervalMs: refreshIntervalMs ?? 0,
    autoDiscover: autoDiscover ?? true,
  };
}
