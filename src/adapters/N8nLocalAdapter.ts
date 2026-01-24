import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import { N8nLocal } from "@easynet/n8n-local";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

export interface N8nLocalAdapterOptions {
  /** Reuse an existing N8nLocal instance */
  instance?: N8nLocal;
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

/**
 * Adapter for n8n-local (embedded) workflow execution.
 * Uses in-process instance, no HTTP API calls.
 */
export class N8nLocalAdapter implements ToolAdapter {
  readonly kind = "n8n" as const;
  private readonly instance: N8nLocal;
  private readonly autoStart: boolean;
  private startPromise?: Promise<void>;
  private readonly workflowMap = new Map<string, string>(); // toolName -> workflowId
  private readonly logger: Logger;

  constructor(options: N8nLocalAdapterOptions = {}) {
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

    this.instance = options.instance ?? new N8nLocal();
    this.autoStart = options.autoStart ?? true;
    this.logger = createLogger({ ...options.debug, prefix: "N8nLocalAdapter" });
  }

  async listTools(): Promise<ToolSpec[]> {
    return [];
  }

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
      await this.ensureStarted();
      const workflowId = await this.ensureWorkflowImported(spec);
      const result = await this.instance.runWorkflow(workflowId, args);

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          workflowId,
          result: this.logger.options.includeResults
            ? summarizeForLog(result)
            : undefined,
        });
      }

      return { result, raw: result };
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
    await this.instance.stop();
  }

  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.instance.start();
    }
    this.logger.info("n8nlocal.start", {});
    await this.startPromise;
  }

  async syncWorkflows(specs: ToolSpec[]): Promise<void> {
    this.logger.info("n8nlocal.sync.start", { count: specs.length });
    await this.ensureStarted();
    const workflows = await this.instance.workflow.listWorkflows();
    const byId = new Map(workflows.map((wf: any) => [String(wf.id), wf]));
    const byName = new Map(workflows.map((wf: any) => [String(wf.name), wf]));

    for (const spec of specs) {
      if (spec.kind !== "n8n") continue;
      const normalized = this.normalizeWorkflow(this.getWorkflowDefinition(spec), spec);
      const id = String(normalized.id);
      const name = String(normalized.name);
      const existing = byId.get(id) ?? byName.get(name);

      if (existing) {
        const updated = await this.instance.workflow.updateWorkflow(existing.id, normalized as any);
        this.workflowMap.set(spec.name, String(updated.id));
      } else {
        const imported = await this.instance.workflow.importWorkflow(normalized as any);
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
      this.startPromise = this.instance.start();
    }
    await this.startPromise;
  }

  private async ensureWorkflowImported(spec: ToolSpec): Promise<string> {
    const cached = this.workflowMap.get(spec.name);
    if (cached) return cached;

    const workflowDef = this.getWorkflowDefinition(spec);
    const normalized = this.normalizeWorkflow(workflowDef, spec);
    const imported = await this.instance.workflow.importWorkflow(normalized as any);
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
