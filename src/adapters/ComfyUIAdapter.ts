import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

/**
 * ComfyUI queue prompt response.
 */
export interface ComfyUIQueueResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
}

/**
 * ComfyUI history entry.
 */
export interface ComfyUIHistoryEntry {
  status: { status_str: string; completed: boolean };
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
}

/**
 * Injectable HTTP client for ComfyUI API.
 */
export interface ComfyUIHttpClient {
  fetch(
    url: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}

/**
 * Default HTTP client using global fetch.
 */
class DefaultComfyUIHttpClient implements ComfyUIHttpClient {
  async fetch(url: string, options: { method: string; headers?: Record<string, string>; body?: string }) {
    const response = await globalThis.fetch(url, options);
    return {
      status: response.status,
      json: () => response.json() as Promise<unknown>,
      text: () => response.text(),
    };
  }
}

/**
 * ComfyUI adapter options.
 */
export interface ComfyUIAdapterOptions {
  /** Injectable HTTP client */
  httpClient?: ComfyUIHttpClient;
  /** ComfyUI server base URL */
  baseUrl?: string;
  /** Polling interval in ms for async jobs */
  pollIntervalMs?: number;
  /** Max poll attempts before timeout */
  maxPollAttempts?: number;
  /** Client ID for ComfyUI WebSocket */
  clientId?: string;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

/**
 * Adapter for ComfyUI image generation workflows.
 * Submits prompts to the queue, polls for completion, and retrieves artifacts.
 */
export class ComfyUIAdapter implements ToolAdapter {
  readonly kind = "comfyui" as const;
  private readonly httpClient: ComfyUIHttpClient;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly clientId: string;
  private readonly logger: Logger;

  constructor(options: ComfyUIAdapterOptions = {}) {
    this.httpClient = options.httpClient ?? new DefaultComfyUIHttpClient();
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:8188";
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPollAttempts = options.maxPollAttempts ?? 150; // 5 min at 2s intervals
    this.clientId = options.clientId ?? `tools-${Date.now()}`;
    this.logger = createLogger({ ...options.debug, prefix: "ComfyUIAdapter" });
  }

  /**
   * Invoke a ComfyUI workflow.
   * Queues the prompt and polls for completion.
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
    // Build the prompt from the workflow template and args
    const prompt = this.buildPrompt(spec, args);

    // Queue the prompt
    try {
      const queueResponse = await this.queuePrompt(prompt);

      if (queueResponse.node_errors && Object.keys(queueResponse.node_errors).length > 0) {
        throw new Error(
          `ComfyUI node errors: ${JSON.stringify(queueResponse.node_errors)}`,
        );
      }

      // If spec indicates async, return job info immediately
      if (spec.costHints?.isAsync) {
        const asyncResult = {
          jobId: queueResponse.prompt_id,
          status: "queued",
          queueNumber: queueResponse.number,
        };
        this.logger.debug("invoke.queued", {
          tool: spec.name,
          result: this.logger.options.includeResults
            ? summarizeForLog(asyncResult)
            : undefined,
        });
        return {
          result: asyncResult,
          raw: queueResponse,
        };
      }

      // Otherwise poll for completion
      const history = await this.pollForCompletion(queueResponse.prompt_id);
      const result = this.extractResult(history, queueResponse.prompt_id);

      if (this.logger.isEnabled("debug")) {
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          result: this.logger.options.includeResults
            ? summarizeForLog(result)
            : undefined,
          raw: this.logger.options.includeRaw
            ? summarizeForLog(history)
            : undefined,
        });
      }

      return { result, raw: history };
    } catch (error) {
      this.logger.warn("invoke.error", {
        tool: spec.name,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get the status of a queued prompt.
   */
  async getStatus(promptId: string): Promise<{ completed: boolean; status: string }> {
    const history = await this.getHistory(promptId);
    if (!history) {
      return { completed: false, status: "queued" };
    }
    return {
      completed: history.status.completed,
      status: history.status.status_str,
    };
  }

  /**
   * Get the result of a completed prompt.
   */
  async getResult(promptId: string): Promise<unknown> {
    const history = await this.getHistory(promptId);
    if (!history || !history.status.completed) {
      return undefined;
    }
    return this.extractResult(history, promptId);
  }

  private buildPrompt(spec: ToolSpec, args: unknown): object {
    // If args contains a complete prompt workflow, use it directly
    if (args && typeof args === "object" && "prompt" in args) {
      return (args as Record<string, unknown>).prompt as object;
    }

    // If spec has a resourceId pointing to a workflow template,
    // merge args into the template
    if (spec.impl && typeof spec.impl === "object") {
      return this.mergeWorkflowArgs(spec.impl as object, args);
    }

    // Otherwise treat args as the prompt itself
    return (args as object) ?? {};
  }

  private mergeWorkflowArgs(template: object, args: unknown): object {
    if (!args || typeof args !== "object") return template;

    // Deep merge args into template nodes
    const merged = structuredClone(template) as Record<string, unknown>;
    const argsObj = args as Record<string, unknown>;

    for (const [key, value] of Object.entries(argsObj)) {
      // Support node-level overrides: { "3": { inputs: { seed: 123 } } }
      if (typeof value === "object" && value !== null && key in merged) {
        merged[key] = this.deepMerge(
          merged[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        result[key] !== null
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private async queuePrompt(prompt: object): Promise<ComfyUIQueueResponse> {
    const url = `${this.baseUrl}/prompt`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        client_id: this.clientId,
      }),
    });

    if (response.status >= 400) {
      const errorText = await response.text();
      throw new Error(
        `ComfyUI queue failed (${response.status}): ${errorText.slice(0, 200)}`,
      );
    }

    return (await response.json()) as ComfyUIQueueResponse;
  }

  private async getHistory(promptId: string): Promise<ComfyUIHistoryEntry | undefined> {
    const url = `${this.baseUrl}/history/${promptId}`;
    const response = await this.httpClient.fetch(url, { method: "GET" });

    if (response.status === 404) return undefined;
    if (response.status >= 400) {
      throw new Error(`ComfyUI history failed (${response.status})`);
    }

    const data = (await response.json()) as Record<string, ComfyUIHistoryEntry>;
    return data[promptId];
  }

  private async pollForCompletion(promptId: string): Promise<ComfyUIHistoryEntry> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      await this.sleep(this.pollIntervalMs);

      const history = await this.getHistory(promptId);
      if (history && history.status.completed) {
        return history;
      }
    }

    throw new Error(
      `ComfyUI prompt ${promptId} did not complete within ${this.maxPollAttempts * this.pollIntervalMs}ms`,
    );
  }

  private extractResult(history: ComfyUIHistoryEntry, promptId: string): unknown {
    const outputs: Array<{
      nodeId: string;
      images: Array<{ filename: string; url: string }>;
    }> = [];

    for (const [nodeId, output] of Object.entries(history.outputs)) {
      if (output.images && output.images.length > 0) {
        outputs.push({
          nodeId,
          images: output.images.map((img) => ({
            filename: img.filename,
            url: `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`,
          })),
        });
      }
    }

    return {
      promptId,
      status: history.status.status_str,
      outputs,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
