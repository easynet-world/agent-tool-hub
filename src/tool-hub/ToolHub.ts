import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import type { Capability, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext, ToolIntent, BudgetConfig } from "../types/ToolIntent.js";
import type { ToolResult } from "../types/ToolResult.js";
import type { DirectoryScannerOptions } from "../discovery/types.js";
import type { SkillDefinition } from "../discovery/loaders/SkillManifest.js";
import type {
  SkillInstructionResult,
  SkillAdapterOptions,
} from "../adapters/SkillAdapter.js";
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

    const { scannerRoots, includeCoreTools, coreToolsConfig } = this.splitRoots(
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
   */
  async initAllTools(): Promise<ToolSpec[]> {
    this.logger.info("init.tools.start", {
      roots: this.scannerOptions.roots,
    });
    const specs = await this.scanner.scan();
    this.registry.bulkRegister(specs);
    if (this.n8nMode === "local") {
      await this.ensureN8nLocalAdapter();
    }
    if (this.n8nLocalAdapter) {
      await this.n8nLocalAdapter.start();
      await this.n8nLocalAdapter.syncWorkflows(
        specs.filter((spec) => spec.kind === "n8n"),
      );
    }
    if (this.watchConfig?.enabled) {
      this.watchRoots({
        debounceMs: this.watchConfig.debounceMs,
        persistent: this.watchConfig.persistent,
      });
    }
    this.logger.info("init.tools.done", { count: specs.length });
    return specs;
  }

  /**
   * Refresh tools by re-scanning current roots.
   */
  async refreshTools(): Promise<ToolSpec[]> {
    this.logger.info("refresh.tools.start", {
      roots: this.scannerOptions.roots,
    });
    const specs = await this.scanner.scan();
    this.registry.clear();
    if (this.includeCoreTools) {
      if (!this.coreToolsConfig) {
        throw new Error("coreTools config is required when includeCoreTools is true");
      }
      const coreAdapter = registerCoreTools(this.registry, this.coreToolsConfig);
      this.runtime.registerAdapter(coreAdapter);
    }
    this.registry.bulkRegister(specs);
    if (this.n8nMode === "local") {
      await this.ensureN8nLocalAdapter();
    }
    if (this.n8nLocalAdapter) {
      await this.n8nLocalAdapter.start();
      await this.n8nLocalAdapter.syncWorkflows(
        specs.filter((spec) => spec.kind === "n8n"),
      );
    }
    this.logger.info("refresh.tools.done", { count: specs.length });
    return specs;
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
      merged.set(this.rootKey(root), root);
    }
    for (const root of roots) {
      merged.set(this.rootKey(root), root);
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
    const debounceMs = options.debounceMs ?? 200;
    const persistent = options.persistent ?? true;

    for (const root of this.scannerOptions.roots) {
      const rootPath = this.rootPath(root);
      if (this.watchers.has(rootPath)) {
        continue;
      }
      this.logger.info("watch.start", { root: rootPath, debounceMs, persistent });
      const watcher = watch(
        rootPath,
        { recursive: true, persistent },
        () => {
          const existing = this.watchTimers.get(rootPath);
          if (existing) {
            clearTimeout(existing);
          }
          const timer = setTimeout(() => {
            this.refreshTools().catch((err) => {
              this.logger.warn("watch.refresh.error", {
                root: rootPath,
                message: err instanceof Error ? err.message : String(err),
              });
              this.scannerOptions.onError?.(rootPath, err as Error);
            });
          }, debounceMs);
          this.watchTimers.set(rootPath, timer);
        },
      );
      this.watchers.set(rootPath, watcher);
    }
  }

  /**
   * Stop watching all roots.
   */
  unwatchRoots(): void {
    for (const [root, watcher] of this.watchers) {
      watcher.close();
      this.watchers.delete(root);
      const timer = this.watchTimers.get(root);
      if (timer) {
        clearTimeout(timer);
        this.watchTimers.delete(root);
      }
      this.logger.info("watch.stop", { root });
    }
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

    if (spec.kind === "skill") {
      const def = this.extractSkillDefinition(spec);
      if (def) {
        return {
          name: def.frontmatter.name,
          description: def.frontmatter.description,
          instructions: def.instructions,
          resources: def.resources.map((r) => ({
            path: r.relativePath,
            type: r.type,
          })),
          dirPath: def.dirPath,
        };
      }
    }

    return {
      name: spec.name,
      description: spec.description,
      kind: spec.kind,
      version: spec.version,
      tags: spec.tags,
      capabilities: spec.capabilities,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      costHints: spec.costHints,
      endpoint: spec.endpoint,
      resourceId: spec.resourceId,
    };
  }

  /**
   * Invoke a tool through PTC Runtime.
   */
  async invokeTool(
    toolName: string,
    args: unknown,
    options: InvokeOptions = {},
  ): Promise<ToolResult> {
    if (this.n8nMode === "local") {
      await this.ensureN8nLocalAdapter();
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
    if (this.n8nMode === "local") {
      await this.ensureN8nLocalAdapter();
    }
    return this.runtime.invoke(intent, ctx);
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getRuntime(): PTCRuntime {
    return this.runtime;
  }

  async shutdown(): Promise<void> {
    this.unwatchRoots();
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

  private extractSkillDefinition(spec: ToolSpec): SkillDefinition | undefined {
    if (spec.impl && typeof spec.impl === "object" && "frontmatter" in spec.impl) {
      return spec.impl as SkillDefinition;
    }
    return undefined;
  }

  private splitRoots(
    roots: ToolHubInitOptions["roots"],
    includeCoreTools?: boolean,
  ): {
    scannerRoots: Array<string | { path: string; namespace?: string }>;
    includeCoreTools: boolean;
    coreToolsConfig?: CoreToolsUserConfig;
  } {
    const scannerRoots: Array<string | { path: string; namespace?: string }> = [];
    let hasCoreTools = false;
    let coreToolsConfig: CoreToolsUserConfig | undefined;

    for (const root of roots) {
      if (typeof root === "string") {
        if (root === "coreTools") {
          hasCoreTools = true;
        } else {
          scannerRoots.push(root);
        }
        continue;
      }
      if (root.path === "coreTools") {
        hasCoreTools = true;
        if ("config" in root && root.config) {
          coreToolsConfig = root.config;
        }
        continue;
      }
      scannerRoots.push(root);
    }

    return {
      scannerRoots,
      includeCoreTools: includeCoreTools ?? hasCoreTools,
      coreToolsConfig,
    };
  }

  private rootPath(root: string | { path: string; namespace?: string }): string {
    return typeof root === "string" ? root : root.path;
  }

  private rootKey(root: string | { path: string; namespace?: string }): string {
    const path = this.rootPath(root);
    const namespace = typeof root === "string" ? "" : root.namespace ?? "";
    return `${path}::${namespace}`;
  }
}

export function createToolHub(options: ToolHubInitOptions): ToolHub {
  return new ToolHub(options);
}
