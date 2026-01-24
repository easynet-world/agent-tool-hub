import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { validateUrl } from "../security/ssrf.js";
import { createTaggedError } from "../../core/Retry.js";

export const fetchTextInputSchema = {
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

export const fetchTextOutputSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    status: { type: "integer" },
    headers: { type: "object", additionalProperties: { type: "string" } },
    text: { type: "string" },
    bytes: { type: "integer" },
  },
  required: ["url", "status", "text", "bytes"],
  additionalProperties: false,
} as const;

export const fetchTextSpec: ToolSpec = {
  name: "core/http.fetchText",
  version: "1.0.0",
  kind: "core",
  description: "Fetch a URL and return the response as text",
  tags: ["http", "network", "core"],
  inputSchema: fetchTextInputSchema,
  outputSchema: fetchTextOutputSchema,
  capabilities: ["network"],
};

export const fetchTextHandler: CoreToolHandler = async (args, ctx) => {
  const url = args.url as string;
  const method = (args.method as string | undefined) ?? "GET";
  const headers = (args.headers as Record<string, string> | undefined) ?? {};
  const body = args.body as string | null | undefined;
  const timeoutMs = (args.timeoutMs as number | undefined) ?? ctx.config.defaultTimeoutMs;
  const maxBytes = (args.maxBytes as number | undefined) ?? ctx.config.maxHttpBytes;

  // SSRF validation
  await validateUrl(url, ctx.config.allowedHosts, ctx.config.blockedCidrs);

  // Set User-Agent if not provided
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

  // Check content-length before reading body
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw createTaggedError(
      "HTTP_TOO_LARGE",
      `Response Content-Length ${contentLength} exceeds limit of ${maxBytes} bytes`,
      { url, contentLength: parseInt(contentLength, 10), limit: maxBytes },
    );
  }

  // Read text body with size limit
  const text = await readResponseWithLimit(response, maxBytes, url);
  const bytes = Buffer.byteLength(text, "utf-8");

  // Collect response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    result: {
      url,
      status: response.status,
      headers: responseHeaders,
      text,
      bytes,
    },
    evidence: [
      {
        type: "url",
        ref: url,
        summary: `${method} ${url} → ${response.status} (${bytes} bytes)`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};

async function readResponseWithLimit(
  response: Response,
  maxBytes: number,
  url: string,
): Promise<string> {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel();
        throw createTaggedError(
          "HTTP_TOO_LARGE",
          `Response body exceeded limit of ${maxBytes} bytes while reading from ${url}`,
          { url, bytesRead: totalBytes, limit: maxBytes },
        );
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  return chunks.join("");
}
