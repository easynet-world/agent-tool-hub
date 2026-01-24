import type { ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import type { Evidence } from "../types/ToolResult.js";

/**
 * Options for building evidence from a tool invocation.
 */
export interface BuildEvidenceOptions {
  spec: ToolSpec;
  args: unknown;
  result: unknown;
  raw?: unknown;
  ctx: ExecContext;
  durationMs?: number;
}

/**
 * Build evidence records from a tool invocation result.
 */
export function buildEvidence(options: BuildEvidenceOptions): Evidence[] {
  const { spec, args, result, ctx, durationMs } = options;
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];

  // Primary tool evidence
  evidence.push({
    type: "tool",
    ref: `${spec.name}@${spec.version}`,
    summary: summarizeToolCall(spec, args, result, durationMs),
    createdAt: now,
  });

  // If result contains a URL, add url evidence
  if (result && typeof result === "object") {
    const urls = extractUrls(result);
    for (const url of urls) {
      evidence.push({
        type: "url",
        ref: url,
        summary: `Output URL from ${spec.name}`,
        createdAt: now,
      });
    }

    // If result contains file paths, add file evidence
    const files = extractFilePaths(result);
    for (const file of files) {
      evidence.push({
        type: "file",
        ref: file,
        summary: `Output file from ${spec.name}`,
        createdAt: now,
      });
    }
  }

  // Add metric evidence if duration is significant
  if (durationMs !== undefined && durationMs > 0) {
    evidence.push({
      type: "metric",
      ref: `latency:${spec.name}`,
      summary: `Completed in ${durationMs}ms (request: ${ctx.requestId})`,
      createdAt: now,
    });
  }

  return evidence;
}

function summarizeToolCall(
  spec: ToolSpec,
  args: unknown,
  result: unknown,
  durationMs?: number,
): string {
  const argKeys =
    args && typeof args === "object" ? Object.keys(args).join(", ") : "none";
  const duration = durationMs ? ` in ${durationMs}ms` : "";
  const resultPreview = summarizeValue(result, 100);
  return `${spec.kind}:${spec.name} called with [${argKeys}]${duration} → ${resultPreview}`;
}

function summarizeValue(value: unknown, maxLen: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    return value.length > maxLen ? value.slice(0, maxLen) + "..." : value;
  }
  const str = JSON.stringify(value);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

function extractUrls(obj: object): string[] {
  const urls: string[] = [];
  const walk = (val: unknown) => {
    if (typeof val === "string" && /^https?:\/\//i.test(val)) {
      urls.push(val);
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val)) {
        walk(v);
      }
    }
  };
  walk(obj);
  return urls.slice(0, 10); // Limit to prevent explosion
}

function extractFilePaths(obj: object): string[] {
  const paths: string[] = [];
  const walk = (val: unknown) => {
    if (
      typeof val === "string" &&
      (val.startsWith("/") || val.startsWith("./")) &&
      val.includes(".")
    ) {
      paths.push(val);
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val)) {
        walk(v);
      }
    }
  };
  walk(obj);
  return paths.slice(0, 10);
}
