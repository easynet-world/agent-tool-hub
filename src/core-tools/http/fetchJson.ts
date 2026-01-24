import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { validateUrl } from "../security/ssrf.js";
import { createTaggedError } from "../../core/Retry.js";

export const fetchJsonInputSchema = {
  type: "object",
  properties: {
    url: { type: "string", format: "uri", description: "URL to fetch" },
    method: {
      type: "string",
      enum: ["GET", "POST"],
      default: "GET",
      description: "HTTP method",
    },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Request headers",
    },
    body: {
      type: ["string", "null"],
      description: "Request body (for POST)",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1000,
      maximum: 60000,
      description: "Request timeout in milliseconds (default: from config)",
    },
    maxBytes: {
      type: "integer",
      minimum: 1024,
      maximum: 10485760,
      description: "Maximum response size in bytes (default: from config)",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export const fetchJsonOutputSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    status: { type: "integer" },
    json: {},
    bytes: { type: "integer" },
  },
  required: ["url", "status", "json", "bytes"],
  additionalProperties: false,
} as const;

export const fetchJsonSpec: ToolSpec = {
  name: "core/http.fetchJson",
  version: "1.0.0",
  kind: "core",
  description: "Fetch a URL and return the response as parsed JSON",
  tags: ["http", "network", "json", "core"],
  inputSchema: fetchJsonInputSchema,
  outputSchema: fetchJsonOutputSchema,
  capabilities: ["network"],
};

export const fetchJsonHandler: CoreToolHandler = async (args, ctx) => {
  const url = args.url as string;
  const method = (args.method as string | undefined) ?? "GET";
  const headers = (args.headers as Record<string, string> | undefined) ?? {};
  const body = args.body as string | null | undefined;
  const timeoutMs = (args.timeoutMs as number | undefined) ?? ctx.config.defaultTimeoutMs;
  const maxBytes = (args.maxBytes as number | undefined) ?? ctx.config.maxHttpBytes;

  // SSRF validation
  await validateUrl(url, ctx.config.allowedHosts, ctx.config.blockedCidrs);

  // Set headers
  if (!headers["Accept"] && !headers["accept"]) {
    headers["Accept"] = "application/json";
  }
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = ctx.config.httpUserAgent;
  }

  // Execute fetch with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw createTaggedError(
        "HTTP_TIMEOUT",
        `Request to ${url} timed out after ${timeoutMs}ms`,
        { url, timeoutMs },
      );
    }
    throw createTaggedError(
      "UPSTREAM_ERROR",
      `Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { url },
    );
  } finally {
    clearTimeout(timer);
  }

  // Check content-length
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw createTaggedError(
      "HTTP_TOO_LARGE",
      `Response Content-Length ${contentLength} exceeds limit of ${maxBytes} bytes`,
      { url, contentLength: parseInt(contentLength, 10), limit: maxBytes },
    );
  }

  // Read text and parse JSON
  const text = await response.text();
  const bytes = Buffer.byteLength(text, "utf-8");

  if (bytes > maxBytes) {
    throw createTaggedError(
      "HTTP_TOO_LARGE",
      `Response body ${bytes} bytes exceeds limit of ${maxBytes} bytes`,
      { url, bytes, limit: maxBytes },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw createTaggedError(
      "UPSTREAM_ERROR",
      `Failed to parse JSON response from ${url}: ${text.slice(0, 200)}`,
      { url, status: response.status, textPreview: text.slice(0, 500) },
    );
  }

  return {
    result: {
      url,
      status: response.status,
      json,
      bytes,
    },
    evidence: [
      {
        type: "url",
        ref: url,
        summary: `${method} ${url} → ${response.status} JSON (${bytes} bytes)`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
