import { randomUUID } from "node:crypto";
import type { FSWatcher } from "node:fs";
import type { Capability, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext, ToolIntent, BudgetConfig } from "../types/ToolIntent.js";
import type { ToolResult } from "../types/ToolResult.js";
import type { DirectoryScannerOptions } from "../discovery/types.js";
import type {
  SkillInstructionResult,
  SkillAdapterOptions,
} from "../adapters/SkillAdapter.js";
import { extractSkillDefinitionFromSpec, specToToolDescription } from "./ToolHubDescription.js";
import type { LangChainAdapterOptions } from "../adapters/LangChainAdapter.js";
import type { MCPAdapterOptions } from "../adapters/MCPAdapter.js";
import type { N8nAdapterOptions } from "../adapters/N8nAdapter.js";
import type { N8nLocalAdapter, N8nLocalAdapterOptions } from "../adapters/N8nLocalAdapter.js";
import type { ComfyUIAdapterOptions } from "../adapters/ComfyUIAdapter.js";
import type { PTCRuntimeConfig } from "../core/PTCRuntime.js";
import type { CoreToolsUserConfig } from "../core-tools/CoreToolsModule.js";
import { PTCRuntime } from "../core/PTCRuntime.js";
import { ToolRegistry } from "../registry/ToolRegistry.js";
import { DirectoryScanner } from "../discovery/DirectoryScanner.js";
import { createLogger } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";
import { LangChainAdapter } from "../adapters/LangChainAdapter.js";
import { MCPAdapter } from "../adapters/MCPAdapter.js";
import { N8nAdapter } from "../adapters/N8nAdapter.js";
import { ComfyUIAdapter } from "../adapters/ComfyUIAdapter.js";
import { SkillAdapter } from "../adapters/SkillAdapter.js";
import { registerCoreTools } from "../core-tools/CoreToolsModule.js";
import { initAllTools, refreshTools, splitRoots } from "./ToolHubDiscovery.js";
import { watchRoots, unwatchRoots } from "./ToolHubWatcher.js";
import { rootKey } from "./ToolHubHelpers.js";
import { createMCPClient } from "../adapters/createMCPClientFromConfig.js";
import type { MCPServerConfig } from "../discovery/types.js";

export interface ToolMetadata {
  name: string;
  description: string;
}

export type ToolDescription =
  | SkillInstructionResult
  | {
      name: string;
      description?: string;
      kind: ToolSpec["kind"];
      version: string;
      tags?: string[];
      capabilities: Capability[];
      inputSchema: object;
      outputSchema: object;
      costHints?: ToolSpec["costHints"];
      endpoint?: string;
      resourceId?: string;
    };

export interface ToolHubInitOptions {
  roots: Array<
    | string
    | { path: string; namespace?: string }
    | { path: "coreTools"; namespace?: string; config?: CoreToolsUserConfig }
  >;
  namespace?: string;
  extensions?: string[];
  onDiscoverError?: (dir: string, err: Error) => void;
  includeCoreTools?: boolean;
  coreTools?: CoreToolsUserConfig;
  runtimeConfig?: PTCRuntimeConfig;
  debug?: DebugOptions;
  watch?: {
    enabled?: boolean;
    debounceMs?: number;
    persistent?: boolean;
  };
  langchain?: LangChainAdapterOptions;
  mcp?: MCPAdapterOptions;
  n8n?: N8nAdapterOptions;
  n8nLocal?: N8nLocalAdapterOptions;
  n8nMode?: "local" | "api";
  comfyui?: ComfyUIAdapterOptions;
  skill?: SkillAdapterOptions;
}

export interface InvokeOptions {
  purpose?: string;
  requestId?: string;
  taskId?: string;
  traceId?: string;
  userId?: string;
  permissions?: Capability[];
  budget?: BudgetConfig;
  dryRun?: boolean;
  idempotencyKey?: string;
}

export class ToolHub {
  private readonly registry: ToolRegistry;
  private readonly runtime: PTCRuntime;
  private readonly logger: Logger;
  private scanner: DirectoryScanner;
  private readonly scannerOptions: DirectoryScannerOptions;
  private readonly skillAdapter: SkillAdapter;
  private n8nLocalAdapter?: N8nLocalAdapter;
  private readonly n8nLocalOptions?: N8nLocalAdapterOptions;
  private readonly n8nMode: "local" | "api";
  private readonly includeCoreTools: boolean;
  private readonly coreToolsConfig?: CoreToolsUserConfig;
  private readonly watchConfig?: ToolHubInitOptions["watch"];
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watchTimers = new Map<string, NodeJS.Timeout>();
  private mcpClientClose: (() => Promise<void>) | null = null;
  private mcpSignalHandlersRegistered = false;

  constructor(options: ToolHubInitOptions) {
    this.registry = new ToolRegistry();
    this.logger = createLogger({ ...options.debug, prefix: "agent-tool-hub" });

    const sharedDebug = options.debug;
    const withDebug = <T extends { debug?: DebugOptions }>(
      opts?: T,
    ): T | undefined => {
      if (!sharedDebug) return opts;
      if (!opts) return { debug: sharedDebug } as T;
      if (opts.debug) return opts;
      return { ...opts, debug: sharedDebug };
    };

    const runtimeConfig: PTCRuntimeConfig = {
      ...(options.runtimeConfig ?? {}),
      debug: options.runtimeConfig?.debug ?? options.debug,
    };

    this.runtime = new PTCRuntime({
      registry: this.registry,
      config: runtimeConfig,
    });

    const { scannerRoots, includeCoreTools, coreToolsConfig } = splitRoots(
      options.roots,
      options.includeCoreTools,
    );

    this.scannerOptions = {
      roots: scannerRoots,
      namespace: options.namespace,
      extensions: options.extensions,
      onError: options.onDiscoverError,
    };
    this.scanner = new DirectoryScanner(this.scannerOptions);

    this.skillAdapter = new SkillAdapter({
      ...withDebug(options.skill),
      toolInvoker: async (toolName, args, ctx) => {
        const result = await this.runtime.invoke(
          {
            tool: toolName,
            args,
            purpose: `skill:${toolName}`,
            idempotencyKey: `${ctx.requestId}:${ctx.taskId}:${toolName}`,
          },
          ctx,
        );
        if (!result.ok) {
          throw new Error(result.error?.message ?? "Tool invocation failed");
        }
        return result.result;
      },
    });

    this.runtime.registerAdapter(new LangChainAdapter(withDebug(options.langchain)));
    this.runtime.registerAdapter(new MCPAdapter(withDebug(options.mcp)));
    this.n8nMode = options.n8nMode ?? "local";
    if (this.n8nMode === "api") {
      this.runtime.registerAdapter(new N8nAdapter(withDebug(options.n8n)));
    } else {
      this.n8nLocalOptions = withDebug(options.n8nLocal);
    }
    this.runtime.registerAdapter(new ComfyUIAdapter(withDebug(options.comfyui)));
    this.runtime.registerAdapter(this.skillAdapter);

    this.includeCoreTools = includeCoreTools;
    this.coreToolsConfig = coreToolsConfig ?? options.coreTools;
    this.watchConfig = options.watch;

    if (this.includeCoreTools) {
      if (!this.coreToolsConfig) {
        throw new Error("coreTools config is required when includeCoreTools is true");
      }
      const coreAdapter = registerCoreTools(this.registry, this.coreToolsConfig);
      this.runtime.registerAdapter(coreAdapter);
    }
  }

  /**
   * Initialize all tools by scanning the configured roots.
   * n8n-local is started only when there are n8n specs (lazy start).
   */
  async initAllTools(): Promise<ToolSpec[]> {
    const specs = await this.scanner.scan();
    if (this.n8nMode === "local" && specs.some((s) => s.kind === "n8n")) {
      await this.ensureN8nLocalAdapter();
    }
    const result = await initAllTools(
      this.scanner,
      {
        registry: this.registry,
        logger: this.logger,
        includeCoreTools: this.includeCoreTools,
        coreToolsConfig: this.coreToolsConfig,
        roots: this.scannerOptions.roots,
      },
      this.n8nLocalAdapter,
      specs,
    );

    if (this.watchConfig?.enabled) {
      this.watchRoots({
        debounceMs: this.watchConfig.debounceMs,
        persistent: this.watchConfig.persistent,
      });
    }
    return result;
  }

  /**
   * Refresh tools by re-scanning current roots.
   * n8n-local is started only when there are n8n specs (lazy start).
   */
  async refreshTools(): Promise<ToolSpec[]> {
    if (this.includeCoreTools) {
      if (!this.coreToolsConfig) {
        throw new Error("coreTools config is required when includeCoreTools is true");
      }
      const coreAdapter = registerCoreTools(this.registry, this.coreToolsConfig);
      this.runtime.registerAdapter(coreAdapter);
    }
    const specs = await this.scanner.scan();
    if (this.n8nMode === "local" && specs.some((s) => s.kind === "n8n")) {
      await this.ensureN8nLocalAdapter();
    }
    return refreshTools(
      this.scanner,
      {
        registry: this.registry,
        logger: this.logger,
        includeCoreTools: this.includeCoreTools,
        coreToolsConfig: this.coreToolsConfig,
        roots: this.scannerOptions.roots,
      },
      this.n8nLocalAdapter,
      specs,
    );
  }

  /**
   * Add additional roots and optionally refresh.
   */
  async addRoots(
    roots: Array<string | { path: string; namespace?: string }>,
    refresh = true,
  ): Promise<ToolSpec[] | void> {
    const merged = new Map<string, string | { path: string; namespace?: string }>();
    for (const root of this.scannerOptions.roots) {
      merged.set(rootKey(root), root);
    }
    for (const root of roots) {
      merged.set(rootKey(root), root);
    }
    this.scannerOptions.roots = Array.from(merged.values());
    this.scanner = new DirectoryScanner(this.scannerOptions);
    this.logger.info("roots.added", { roots, refresh });
    if (refresh) {
      return this.refreshTools();
    }
  }

  /**
   * Replace roots and optionally refresh.
   */
  async setRoots(
    roots: Array<string | { path: string; namespace?: string }>,
    refresh = true,
  ): Promise<ToolSpec[] | void> {
    this.scannerOptions.roots = [...roots];
    this.scanner = new DirectoryScanner(this.scannerOptions);
    this.logger.info("roots.set", { roots, refresh });
    if (refresh) {
      return this.refreshTools();
    }
  }

  /**
   * Watch all current roots and auto-refresh on changes.
   */
  watchRoots(options: { debounceMs?: number; persistent?: boolean } = {}): void {
    watchRoots(
      {
        logger: this.logger,
        scannerOptions: this.scannerOptions,
        refreshTools: () => this.refreshTools(),
      },
      this.watchers,
      this.watchTimers,
      options,
    );
  }

  /**
   * Stop watching all roots.
   */
  unwatchRoots(): void {
    unwatchRoots(this.watchers, this.watchTimers, this.logger);
  }

  /**
   * Return tool metadata in SKILL-like format (name + description).
   */
  listToolMetadata(): ToolMetadata[] {
    return this.registry.snapshot().map((spec) => ({
      name: spec.name,
      description: spec.description ?? "",
    }));
  }

  /**
   * Get a tool's full description. For skills, returns full SKILL content.
   */
  getToolDescription(toolName: string): ToolDescription {
    const spec = this.registry.get(toolName);
    if (!spec) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    return specToToolDescription(spec, extractSkillDefinitionFromSpec);
  }

  /**
   * Invoke a tool through PTC Runtime.
   */
  async invokeTool(
    toolName: string,
    args: unknown,
    options: InvokeOptions = {},
  ): Promise<ToolResult> {
    let spec = this.registry.get(toolName);
    if (this.n8nMode === "local" && spec?.kind === "n8n") {
      await this.ensureN8nLocalAdapter();
    }
    if (spec?.kind === "mcp") {
      await this.ensureMCPClientStarted();
      // After sync, placeholder may have been replaced by server tools; resolve tool name again
      spec = this.registry.get(toolName);
      if (!spec) {
        const firstMcp = this.registry.snapshot().find((s) => s.kind === "mcp");
        if (firstMcp) toolName = firstMcp.name;
      }
    }
    const requestId = options.requestId ?? `req_${randomUUID()}`;
    const taskId = options.taskId ?? `task_${randomUUID()}`;

    const intent: ToolIntent = {
      tool: toolName,
      args,
      purpose: options.purpose ?? "agent-tool-hub.invoke",
      idempotencyKey:
        options.idempotencyKey ?? `${requestId}:${taskId}:${toolName}`,
    };

    const ctx: ExecContext = {
      requestId,
      taskId,
      traceId: options.traceId,
      userId: options.userId,
      permissions: options.permissions ?? [],
      budget: options.budget,
      dryRun: options.dryRun,
    };

    return this.runtime.invoke(intent, ctx);
  }

  /**
   * Invoke a tool using a pre-built ToolIntent and ExecContext.
   */
  async invokeIntent(intent: ToolIntent, ctx: ExecContext): Promise<ToolResult> {
    let spec = this.registry.get(intent.tool);
    if (this.n8nMode === "local" && spec?.kind === "n8n") {
      await this.ensureN8nLocalAdapter();
    }
    if (spec?.kind === "mcp") {
      await this.ensureMCPClientStarted();
      if (!this.registry.get(intent.tool)) {
        const firstMcp = this.registry.snapshot().find((s) => s.kind === "mcp");
        if (firstMcp) {
          intent = { ...intent, tool: firstMcp.name };
        }
      }
    }
    return this.runtime.invoke(intent, ctx);
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getRuntime(): PTCRuntime {
    return this.runtime;
  }

  /**
   * Sync MCP tool specs from the MCP adapter (server) into the registry.
   * Call after setClient() so tool names, descriptions, and schemas come from the MCP server.
   * Replaces discovery-placeholder MCP specs with the real list from the server.
   */
  async syncMCPToolsFromAdapter(): Promise<ToolSpec[]> {
    const mcpAdapter = this.runtime.getAdapter("mcp");
    if (!mcpAdapter?.listTools) {
      return [];
    }
    const specs = await mcpAdapter.listTools();
    const mcpNames = this.registry
      .snapshot()
      .filter((s) => s.kind === "mcp")
      .map((s) => s.name);
    for (const name of mcpNames) {
      this.registry.unregister(name);
    }
    this.registry.bulkRegister(specs);
    this.logger.info("mcp.sync", { count: specs.length, names: specs.map((s) => s.name) });
    return specs;
  }

  async shutdown(): Promise<void> {
    this.unwatchRoots();
    if (this.mcpClientClose) {
      await this.mcpClientClose().catch((err) => {
        this.logger.warn("mcp.close", { message: err instanceof Error ? err.message : String(err) });
      });
      this.mcpClientClose = null;
    }
    if (this.n8nLocalAdapter) {
      await this.n8nLocalAdapter.stop();
    }
  }

  private async ensureN8nLocalAdapter(): Promise<void> {
    if (this.n8nLocalAdapter) return;
    const { N8nLocalAdapter } = await import("../adapters/N8nLocalAdapter.js");
    this.n8nLocalAdapter = new N8nLocalAdapter(this.n8nLocalOptions);
    this.runtime.registerAdapter(this.n8nLocalAdapter);
  }

  /**
   * Lazy start: only start the MCP client when an MCP tool is actually invoked
   * and a stdio-based MCP config was discovered. If no MCP definition exists
   * in the registry, this is a no-op.
   * Uses the first MCP spec's impl (mcpConfig); ignores URL-only configs.
   */
  private async ensureMCPClientStarted(): Promise<void> {
    if (this.mcpClientClose) return;
    const mcpSpec = this.registry.snapshot().find((s) => s.kind === "mcp");
    const config = mcpSpec?.impl as MCPServerConfig | undefined;
    if (!config || typeof config !== "object" || config.url) return;
    try {
      const result = await createMCPClient(config);
      if (!result) return;
      const mcpAdapter = this.runtime.getAdapter("mcp") as { setClient: (c: import("../adapters/MCPAdapter.js").MCPClientLike) => void } | undefined;
      if (mcpAdapter?.setClient) {
        mcpAdapter.setClient(result.client);
        await this.syncMCPToolsFromAdapter();
        this.mcpClientClose = result.close;
        this.logger.info("mcp.autoStart", { tool: mcpSpec?.name });
        // When process receives SIGINT/SIGTERM, close MCP so process and MCP shut down together.
        if (!this.mcpSignalHandlersRegistered) {
          this.mcpSignalHandlersRegistered = true;
          const shutdown = () => this.shutdown().catch(() => {});
          process.once("SIGINT", shutdown);
          process.once("SIGTERM", shutdown);
        }
      }
    } catch (err) {
      this.logger.warn("mcp.autoStart", {
        message: err instanceof Error ? err.message : String(err),
        hint: "Install @modelcontextprotocol/sdk and ensure MCP server command is available.",
      });
    }
  }

}

export function createToolHub(options: ToolHubInitOptions): ToolHub {
  return new ToolHub(options);
}
