import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

/**
 * HTTP client interface for n8n API/webhook calls.
 */
export interface HttpClient {
  fetch(
    url: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}

/**
 * Default HTTP client using global fetch.
 */
class DefaultHttpClient implements HttpClient {
  async fetch(
    url: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ) {
    const response = await globalThis.fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: options.signal,
    });
    return {
      status: response.status,
      json: () => response.json() as Promise<unknown>,
      text: () => response.text(),
    };
  }
}

/**
 * n8n invocation mode.
 */
export type N8nInvokeMode = "webhook" | "api";

/**
 * n8n adapter configuration.
 */
export interface N8nAdapterOptions {
  /** Injectable HTTP client */
  httpClient?: HttpClient;
  /** n8n API base URL (for API mode) */
  apiBaseUrl?: string;
  /** n8n API key */
  apiKey?: string;
  /** Default invocation mode */
  defaultMode?: N8nInvokeMode;
  /** Threshold in ms: if workflow takes longer, treat as async */
  asyncThresholdMs?: number;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

/**
 * n8n workflow invocation result.
 */
interface N8nResult {
  /** If async, returns a jobId for polling */
  jobId?: string;
  /** Workflow execution data */
  data?: unknown;
  /** Execution status */
  status?: string;
}

/**
 * Adapter for n8n workflows.
 * Supports webhook trigger and API invocation modes.
 * Handles idempotency keys and sync/async detection.
 */
export class N8nAdapter implements ToolAdapter {
  readonly kind = "n8n" as const;
  private readonly httpClient: HttpClient;
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultMode: N8nInvokeMode;
  private readonly asyncThresholdMs: number;
  private readonly idempotencyStore = new Map<string, unknown>(); // Simple dedup store
  private readonly logger: Logger;

  constructor(options: N8nAdapterOptions = {}) {
    this.httpClient = options.httpClient ?? new DefaultHttpClient();
    this.apiBaseUrl = options.apiBaseUrl ?? "http://localhost:5678";
    this.apiKey = options.apiKey;
    this.defaultMode = options.defaultMode ?? "webhook";
    this.asyncThresholdMs = options.asyncThresholdMs ?? 30_000;
    this.logger = createLogger({ ...options.debug, prefix: "N8nAdapter" });
  }

  /**
   * Invoke an n8n workflow.
   */
  async invoke(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    if (this.logger.isEnabled("debug")) {
      this.logger.debug("invoke.start", {
        tool: spec.name,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        args: this.logger.options.includeArgs ? sanitizeForLog(args) : undefined,
      });
    }
    // Check idempotency
    const idempotencyKey = this.buildIdempotencyKey(spec, ctx);
    if (idempotencyKey) {
      const cached = this.idempotencyStore.get(idempotencyKey);
      if (cached !== undefined) {
        this.logger.debug("invoke.cache.hit", {
          tool: spec.name,
          idempotencyKey,
        });
        return { result: cached, raw: { cached: true, idempotencyKey } };
      }
    }

    const mode = this.getInvokeMode(spec);
    let raw: unknown;

    try {
      if (mode === "webhook") {
        raw = await this.invokeWebhook(spec, args, ctx, idempotencyKey);
      } else {
        raw = await this.invokeApi(spec, args, ctx, idempotencyKey);
      }

      const result = this.normalizeResult(raw as N8nResult);

      // Store idempotency result
      if (idempotencyKey && result) {
        this.idempotencyStore.set(idempotencyKey, result);
        // Auto-cleanup after 1 hour
        setTimeout(() => this.idempotencyStore.delete(idempotencyKey), 3600_000).unref?.();
      }

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          mode,
          result: this.logger.options.includeResults
            ? summarizeForLog(result)
            : undefined,
          raw: this.logger.options.includeRaw ? summarizeForLog(raw) : undefined,
        });
      }

      return { result, raw };
    } catch (error) {
      this.logger.warn("invoke.error", {
        tool: spec.name,
        mode,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async invokeWebhook(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const url = spec.endpoint;
    if (!url) {
      throw new Error(`n8n webhook URL not configured for tool: ${spec.name}`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (idempotencyKey) {
      headers["X-Idempotency-Key"] = idempotencyKey;
    }

    const body: Record<string, unknown> = {
      ...(args && typeof args === "object" ? args : { input: args }),
      _metadata: {
        requestId: ctx.requestId,
        taskId: ctx.taskId,
        idempotencyKey,
      },
    };

    const response = await this.httpClient.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      throw new Error(
        `n8n webhook failed (${response.status}): ${errorText.slice(0, 200)}`,
      );
    }

    return response.json();
  }

  private async invokeApi(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const workflowId = spec.resourceId;
    if (!workflowId) {
      throw new Error(`n8n workflowId not configured for tool: ${spec.name}`);
    }

    const url = `${this.apiBaseUrl}/api/v1/workflows/${workflowId}/execute`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-N8N-API-KEY"] = this.apiKey;
    }
    if (idempotencyKey) {
      headers["X-Idempotency-Key"] = idempotencyKey;
    }

    const body = {
      data: args,
      _metadata: {
        requestId: ctx.requestId,
        taskId: ctx.taskId,
      },
    };

    const response = await this.httpClient.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      throw new Error(
        `n8n API failed (${response.status}): ${errorText.slice(0, 200)}`,
      );
    }

    return response.json();
  }

  private getInvokeMode(spec: ToolSpec): N8nInvokeMode {
    // If endpoint is set, use webhook mode; otherwise use API mode
    if (spec.endpoint) return "webhook";
    if (spec.resourceId) return "api";
    return this.defaultMode;
  }

  private buildIdempotencyKey(spec: ToolSpec, ctx: ExecContext): string | undefined {
    return `${ctx.requestId}:${ctx.taskId}:${spec.name}`;
  }

  private normalizeResult(raw: N8nResult): unknown {
    // If it's an async job, return job info
    if (raw.jobId) {
      return { jobId: raw.jobId, status: raw.status ?? "queued" };
    }
    // Return data or the raw response
    return raw.data ?? raw;
  }
}
