import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

/** Minimal interface for an n8n-local instance (avoids top-level dependency on @easynet/n8n-local). */
export interface N8nLocalInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  workflow: {
    listWorkflows(): Promise<{ id: unknown; name: string }[]>;
    importWorkflow(w: unknown): Promise<{ id: unknown }>;
    updateWorkflow(id: unknown, w: unknown): Promise<unknown>;
  };
  runWorkflow(workflowId: string, args: unknown): Promise<unknown>;
}

export interface N8nLocalAdapterOptions {
  /** Reuse an existing n8n-local instance (avoids loading @easynet/n8n-local when not needed). */
  instance?: N8nLocalInstance;
  /** Auto-start n8n-local on first invoke (default: true) */
  autoStart?: boolean;
  /** Whether to start the internal HTTP server (default: false) */
  startHttpServer?: boolean;
  /** SQLite database file path (default: "database.sqlite") */
  sqliteDatabase?: string;
  /** Optional data folder for workflow sync */
  dataFolder?: string;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

const N8N_LOCAL_PKG = "@easynet/n8n-local";
const N8N_LOCAL_HINT =
  "Install it with: npm install @easynet/n8n-local (or omit --omit=optional for full install).";

/**
 * Adapter for n8n-local (embedded) workflow execution.
 * Uses in-process instance, no HTTP API calls.
 * @easynet/n8n-local is optional: only loaded when an instance is created without options.instance.
 */
export class N8nLocalAdapter implements ToolAdapter {
  readonly kind = "n8n" as const;
  private instance: N8nLocalInstance | null = null;
  private instancePromise: Promise<N8nLocalInstance> | null = null;
  private readonly autoStart: boolean;
  private startPromise?: Promise<void>;
  private readonly workflowMap = new Map<string, string>(); // toolName -> workflowId
  private readonly logger: Logger;
  private readonly options: N8nLocalAdapterOptions;

  constructor(options: N8nLocalAdapterOptions = {}) {
    this.options = options;
    if (process.env.N8N_START_HTTP_SERVER === undefined) {
      const start = options.startHttpServer ?? false;
      process.env.N8N_START_HTTP_SERVER = start ? "true" : "false";
    }
    process.env.DB_TYPE = "sqlite";
    if (options.sqliteDatabase) {
      process.env.DB_SQLITE_DATABASE = options.sqliteDatabase;
    } else if (!process.env.DB_SQLITE_DATABASE) {
      process.env.DB_SQLITE_DATABASE = "database.sqlite";
    }
    if (options.dataFolder) {
      process.env.N8N_DATA_FOLDER = options.dataFolder;
    }

    if (options.instance) {
      this.instance = options.instance;
    }
    this.autoStart = options.autoStart ?? true;
    this.logger = createLogger({ ...options.debug, prefix: "N8nLocalAdapter" });
  }

  /** Resolve workflow API from @easynet/n8n-local instance (supports .workflow or .workflowManager). */
  private getWorkflowApi(instance: N8nLocalInstance): N8nLocalInstance["workflow"] {
    const raw = instance as unknown as Record<string, unknown>;
    const candidates = [
      raw.workflowManager,
      raw.workflow,
      (raw.serverManager as Record<string, unknown>)?.workflow,
      (raw.managers as Record<string, unknown>)?.workflow,
    ].filter(Boolean);
    for (const api of candidates) {
      const a = api as { listWorkflows?: unknown };
      if (a && typeof a.listWorkflows === "function") return api as N8nLocalInstance["workflow"];
    }
    const keys = Object.keys(raw).filter((k) => typeof raw[k] === "object" || typeof raw[k] === "function");
    throw new Error(
      `${N8N_LOCAL_PKG} API mismatch: no workflow API with listWorkflows found. Instance keys: ${keys.join(", ") || "(none)"}. Ensure @easynet/n8n-local is a compatible version.`
    );
  }

  private async ensureInstance(): Promise<N8nLocalInstance> {
    if (this.instance) return this.instance;
    if (!this.instancePromise) {
      this.instancePromise = (async () => {
        try {
          const mod = await import(/* @vite-ignore */ N8N_LOCAL_PKG);
          const N8nLocal = mod.N8nLocal ?? mod.default;
          if (!N8nLocal) throw new Error(`${N8N_LOCAL_PKG} did not export N8nLocal`);
          this.instance = new N8nLocal() as N8nLocalInstance;
          return this.instance;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Cannot find module") || msg.includes("ERR_MODULE_NOT_FOUND")) {
            throw new Error(
              `${N8N_LOCAL_PKG} is not installed. ${N8N_LOCAL_HINT}`,
              { cause: err }
            );
          }
          throw err;
        }
      })();
    }
    return this.instancePromise;
  }

  async listTools(): Promise<ToolSpec[]> {
    return [];
  }

  /**
   * Invoke an n8n workflow locally.
   * If the workflow returns { result, evidence? } (same as Skill/LangChain), the adapter
   * uses result as the main result and passes evidence through raw for the runtime to merge.
   */
  async invoke(
    spec: ToolSpec,
    args: unknown,
    _ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    if (this.logger.isEnabled("debug")) {
      this.logger.debug("invoke.start", {
        tool: spec.name,
        args: this.logger.options.includeArgs ? sanitizeForLog(args) : undefined,
      });
    }
    try {
      const instance = await this.ensureInstance();
      await this.ensureStarted();
      const workflowId = await this.ensureWorkflowImported(spec);
      const raw = await instance.runWorkflow(workflowId, args);

      // Support { result, evidence? } convention (same as Skill/LangChain) when evidence is present
      const hasEvidence =
        raw &&
        typeof raw === "object" &&
        "evidence" in raw &&
        Array.isArray((raw as { evidence: unknown }).evidence);
      const result =
        hasEvidence && "result" in raw
          ? (raw as { result: unknown }).result
          : raw;

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          workflowId,
          result: this.logger.options.includeResults
            ? summarizeForLog(result)
            : undefined,
        });
      }

      return { result, raw };
    } catch (error) {
      this.logger.warn("invoke.error", {
        tool: spec.name,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info("n8nlocal.stop", {});
    const instance = this.instance ?? (await this.ensureInstance().catch(() => null));
    if (instance) await instance.stop();
  }

  async start(): Promise<void> {
    const instance = await this.ensureInstance();
    if (!this.startPromise) {
      this.startPromise = instance.start();
    }
    this.logger.info("n8nlocal.start", {});
    await this.startPromise;
  }

  async syncWorkflows(specs: ToolSpec[]): Promise<void> {
    this.logger.info("n8nlocal.sync.start", { count: specs.length });
    const instance = await this.ensureInstance();
    await this.ensureStarted();
    const workflowApi = this.getWorkflowApi(instance);
    const workflows = await workflowApi.listWorkflows();
    const byId = new Map(workflows.map((wf: { id: unknown; name: string }) => [String(wf.id), wf]));
    const byName = new Map(workflows.map((wf: { id: unknown; name: string }) => [String(wf.name), wf]));

    for (const spec of specs) {
      if (spec.kind !== "n8n") continue;
      const normalized = this.normalizeWorkflow(this.getWorkflowDefinition(spec), spec);
      const id = String(normalized.id);
      const name = String(normalized.name);
      const existing = byId.get(id) ?? byName.get(name);

      if (existing) {
        await workflowApi.updateWorkflow(existing.id, normalized as any);
        this.workflowMap.set(spec.name, String(existing.id));
      } else {
        const imported = await workflowApi.importWorkflow(normalized as any);
        this.workflowMap.set(spec.name, String(imported.id));
      }
    }
    this.logger.info("n8nlocal.sync.done", { count: specs.length });
  }

  private async ensureStarted(): Promise<void> {
    if (!this.autoStart) {
      throw new Error("n8n-local instance not started. Call start() or enable autoStart.");
    }

    if (!this.startPromise) {
      const instance = await this.ensureInstance();
      this.startPromise = instance.start();
    }
    await this.startPromise;
  }

  private async ensureWorkflowImported(spec: ToolSpec): Promise<string> {
    const cached = this.workflowMap.get(spec.name);
    if (cached) return cached;

    const instance = await this.ensureInstance();
    const workflowApi = this.getWorkflowApi(instance);
    const workflowDef = this.getWorkflowDefinition(spec);
    const normalized = this.normalizeWorkflow(workflowDef, spec);
    const imported = await workflowApi.importWorkflow(normalized as any);
    const workflowId = String(imported.id);
    this.workflowMap.set(spec.name, workflowId);
    return workflowId;
  }

  private getWorkflowDefinition(spec: ToolSpec): Record<string, unknown> {
    if (spec.impl && typeof spec.impl === "object") {
      return spec.impl as Record<string, unknown>;
    }
    throw new Error(`n8n workflow definition missing for tool: ${spec.name}`);
  }

  private normalizeWorkflow(
    workflow: Record<string, unknown>,
    spec: ToolSpec,
  ): Record<string, unknown> {
    const normalized = { ...workflow };
    if (!normalized.id) {
      normalized.id = spec.resourceId ?? spec.name;
    }
    if (!normalized.name) {
      normalized.name = spec.name;
    }
    if (!normalized.nodes) normalized.nodes = [];
    if (!normalized.connections) normalized.connections = {};
    return normalized;
  }
}
