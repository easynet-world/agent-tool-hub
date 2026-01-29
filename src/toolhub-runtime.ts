import path from "node:path";
import { ToolHub, createToolHub } from "./tool-hub/ToolHub.js";
import { loadToolHubConfig } from "./config/ToolHubConfig.js";
import { DEFAULT_CONFIG_FILE } from "./config/ToolHubConfig.js";
import type {
  ToolHubInitOptions,
  ToolMetadata,
  ToolDescription,
  InvokeOptions,
} from "./tool-hub/ToolHub.js";
import type { ToolSpec } from "./types/ToolSpec.js";
import type { ToolIntent } from "./types/ToolIntent.js";
import type { ExecContext } from "./types/ToolIntent.js";
import type { ToolResult } from "./types/ToolResult.js";
import type { ToolRegistry } from "./registry/ToolRegistry.js";
import type { PTCRuntime } from "./core/PTCRuntime.js";

export { ToolHub, createToolHub };
export type { ToolHubInitOptions, InvokeOptions } from "./tool-hub/ToolHub.js";

/**
 * High-level facade for initializing and using the tool hub from a config file.
 * Supports two constructor forms:
 * - `new AgentToolHub()` — uses default config path (toolhub.yaml in cwd).
 * - `new AgentToolHub(configPath)` — uses the given config file path.
 *
 * Call `await toolHub.init()` after construction to load config and discover tools.
 * Then use the same API as ToolHub (invokeTool, listToolMetadata, etc.).
 */
export class AgentToolHub {
  private readonly configPath: string;
  private hub: ToolHub | null = null;

  /**
   * @param configPath Optional path to toolhub config (YAML). If omitted, uses
   *   default "toolhub.yaml" resolved from process.cwd().
   */
  constructor(configPath?: string) {
    this.configPath = configPath
      ? path.resolve(process.cwd(), configPath)
      : path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
  }

  /**
   * Load config from the path given at construction, create the underlying ToolHub,
   * and initialize all tools. Must be called before using invokeTool, listToolMetadata, etc.
   */
  async init(): Promise<ToolSpec[]> {
    const { options } = await loadToolHubConfig(this.configPath);
    this.hub = createToolHub(options);
    return this.hub.initAllTools();
  }

  private requireHub(): ToolHub {
    if (!this.hub) {
      throw new Error(
        "AgentToolHub not initialized. Call await toolHub.init() first.",
      );
    }
    return this.hub;
  }

  listToolMetadata(): ToolMetadata[] {
    return this.requireHub().listToolMetadata();
  }

  getToolDescription(toolName: string): ToolDescription {
    return this.requireHub().getToolDescription(toolName);
  }

  async invokeTool(
    toolName: string,
    args: unknown,
    options: InvokeOptions = {},
  ): Promise<ToolResult> {
    return this.requireHub().invokeTool(toolName, args, options);
  }

  async invokeIntent(intent: ToolIntent, ctx: ExecContext): Promise<ToolResult> {
    return this.requireHub().invokeIntent(intent, ctx);
  }

  getRegistry(): ToolRegistry {
    return this.requireHub().getRegistry();
  }

  getRuntime(): PTCRuntime {
    return this.requireHub().getRuntime();
  }

  async refreshTools(): Promise<ToolSpec[]> {
    return this.requireHub().refreshTools();
  }

  async addRoots(
    roots: Array<string | { path: string; namespace?: string }>,
    refresh = true,
  ): Promise<ToolSpec[] | void> {
    return this.requireHub().addRoots(roots, refresh);
  }

  async setRoots(
    roots: Array<string | { path: string; namespace?: string }>,
    refresh = true,
  ): Promise<ToolSpec[] | void> {
    return this.requireHub().setRoots(roots, refresh);
  }

  watchRoots(options: { debounceMs?: number; persistent?: boolean } = {}): void {
    this.requireHub().watchRoots(options);
  }

  unwatchRoots(): void {
    this.requireHub().unwatchRoots();
  }

  async shutdown(): Promise<void> {
    if (this.hub) {
      await this.hub.shutdown();
      this.hub = null;
    }
  }

  /** Config path used for init (resolved absolute path). */
  getConfigPath(): string {
    return this.configPath;
  }
}

export async function createToolHubAndInit(
  options: ToolHubInitOptions,
) {
  const hub = createToolHub(options);
  await hub.initAllTools();
  return hub;
}

export async function createToolHubAndInitFromConfig(configPath: string) {
  const { options } = await loadToolHubConfig(configPath);
  return createToolHubAndInit(options);
}

/**
 * Create an AgentToolHub from a config path, run init(), and return the instance.
 * Equivalent to: `const hub = new AgentToolHub(configPath); await hub.init(); return hub;`
 */
export async function createAgentToolHub(configPath: string): Promise<AgentToolHub> {
  const hub = new AgentToolHub(configPath);
  await hub.init();
  return hub;
}
