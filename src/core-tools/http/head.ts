import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { validateUrl } from "../security/ssrf.js";
import { createTaggedError } from "../../core/Retry.js";

export const headInputSchema = {
  type: "object",
  properties: {
    url: { type: "string", format: "uri", description: "URL to send HEAD request to" },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Request headers",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1000,
      maximum: 60000,
      description: "Request timeout in milliseconds (default: from config)",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export const headOutputSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    status: { type: "integer" },
    headers: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["url", "status", "headers"],
  additionalProperties: false,
} as const;

export const headSpec: ToolSpec = {
  name: "core/http.head",
  version: "1.0.0",
  kind: "core",
  description: "Send a HEAD request to get response headers without body",
  tags: ["http", "network", "core"],
  inputSchema: headInputSchema,
  outputSchema: headOutputSchema,
  capabilities: ["network"],
};

export const headHandler: CoreToolHandler = async (args, ctx) => {
  const url = args.url as string;
  const headers = (args.headers as Record<string, string> | undefined) ?? {};
  const timeoutMs = (args.timeoutMs as number | undefined) ?? ctx.config.defaultTimeoutMs;

  // SSRF validation
  await validateUrl(url, ctx.config.allowedHosts, ctx.config.blockedCidrs);

  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = ctx.config.httpUserAgent;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw createTaggedError(
        "HTTP_TIMEOUT",
        `HEAD request to ${url} timed out after ${timeoutMs}ms`,
        { url, timeoutMs },
      );
    }
    throw createTaggedError(
      "UPSTREAM_ERROR",
      `HEAD request failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { url },
    );
  } finally {
    clearTimeout(timer);
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    result: {
      url,
      status: response.status,
      headers: responseHeaders,
    },
    evidence: [
      {
        type: "url",
        ref: url,
        summary: `HEAD ${url} → ${response.status}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
