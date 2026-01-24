import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { validateUrl } from "../security/ssrf.js";
import { resolveSandboxedPath } from "../security/sandbox.js";
import { createTaggedError } from "../../core/Retry.js";

export const downloadFileInputSchema = {
  type: "object",
  properties: {
    url: { type: "string", format: "uri", description: "URL to download from" },
    destPath: { type: "string", description: "Destination path relative to sandbox root" },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Request headers",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1000,
      maximum: 120000,
      description: "Request timeout in milliseconds (default: from config)",
    },
    maxBytes: {
      type: "integer",
      minimum: 1024,
      maximum: 104857600,
      description: "Maximum download size in bytes (default: from config)",
    },
    overwrite: {
      type: "boolean",
      default: false,
      description: "Allow overwriting existing files",
    },
  },
  required: ["url", "destPath"],
  additionalProperties: false,
} as const;

export const downloadFileOutputSchema = {
  type: "object",
  properties: {
    destPath: { type: "string" },
    bytes: { type: "integer" },
    sha256: { type: "string" },
    status: { type: "integer" },
    url: { type: "string" },
  },
  required: ["destPath", "bytes", "sha256", "status", "url"],
  additionalProperties: false,
} as const;

export const downloadFileSpec: ToolSpec = {
  name: "core/http.downloadFile",
  version: "1.0.0",
  kind: "core",
  description: "Download a file from a URL to the sandbox",
  tags: ["http", "network", "download", "core"],
  inputSchema: downloadFileInputSchema,
  outputSchema: downloadFileOutputSchema,
  capabilities: ["network", "write:fs"],
};

export const downloadFileHandler: CoreToolHandler = async (args, ctx) => {
  const url = args.url as string;
  const destPath = args.destPath as string;
  const headers = (args.headers as Record<string, string> | undefined) ?? {};
  const timeoutMs = (args.timeoutMs as number | undefined) ?? ctx.config.defaultTimeoutMs;
  const maxBytes = (args.maxBytes as number | undefined) ?? ctx.config.maxDownloadBytes;
  const overwrite = (args.overwrite as boolean | undefined) ?? false;

  // SSRF validation
  await validateUrl(url, ctx.config.allowedHosts, ctx.config.blockedCidrs);

  // Sandbox validation for destination
  const resolvedDest = await resolveSandboxedPath(destPath, ctx.config.sandboxRoot);

  // Check overwrite
  if (!overwrite) {
    const { access } = await import("node:fs/promises");
    try {
      await access(resolvedDest);
      throw new Error(
        `File already exists: ${resolvedDest}. Set overwrite=true to allow overwriting.`,
      );
    } catch (err) {
      if (err instanceof Error && !err.message.includes("already exists")) {
        // ENOENT — file doesn't exist, proceed
      } else {
        throw err;
      }
    }
  }

  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = ctx.config.httpUserAgent;
  }

  // Execute fetch
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw createTaggedError(
        "HTTP_TIMEOUT",
        `Download from ${url} timed out after ${timeoutMs}ms`,
        { url, timeoutMs },
      );
    }
    throw createTaggedError(
      "UPSTREAM_ERROR",
      `Download failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
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
      `Download Content-Length ${contentLength} exceeds limit of ${maxBytes} bytes`,
      { url, contentLength: parseInt(contentLength, 10), limit: maxBytes },
    );
  }

  // Read body with size limit
  if (!response.body) {
    throw createTaggedError("UPSTREAM_ERROR", `No response body from ${url}`, { url });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const hasher = createHash("sha256");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel();
        throw createTaggedError(
          "HTTP_TOO_LARGE",
          `Download from ${url} exceeded limit of ${maxBytes} bytes (received ${totalBytes})`,
          { url, bytesRead: totalBytes, limit: maxBytes },
        );
      }

      chunks.push(value);
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  const sha256 = hasher.digest("hex");

  // Write to sandbox
  await mkdir(dirname(resolvedDest), { recursive: true });
  const buffer = Buffer.concat(chunks);
  await writeFile(resolvedDest, buffer);

  return {
    result: {
      destPath: resolvedDest,
      bytes: totalBytes,
      sha256,
      status: response.status,
      url,
    },
    evidence: [
      {
        type: "url",
        ref: url,
        summary: `Downloaded ${totalBytes} bytes from ${url}`,
        createdAt: new Date().toISOString(),
      },
      {
        type: "file",
        ref: resolvedDest,
        summary: `Saved to ${resolvedDest} (sha256: ${sha256.slice(0, 12)}...)`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
