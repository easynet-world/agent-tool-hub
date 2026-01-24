import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { resolveSandboxedPath } from "../security/sandbox.js";

export const sha256InputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path relative to sandbox root" },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export const sha256OutputSchema = {
  type: "object",
  properties: {
    sha256: { type: "string" },
    path: { type: "string" },
    bytes: { type: "integer" },
  },
  required: ["sha256", "path", "bytes"],
  additionalProperties: false,
} as const;

export const sha256Spec: ToolSpec = {
  name: "core/fs.sha256",
  version: "1.0.0",
  kind: "core",
  description: "Compute SHA-256 hash of a file in the sandbox",
  tags: ["filesystem", "hash", "core"],
  inputSchema: sha256InputSchema,
  outputSchema: sha256OutputSchema,
  capabilities: ["read:fs"],
};

export const sha256Handler: CoreToolHandler = async (args, ctx) => {
  const inputPath = args.path as string;

  const resolvedPath = await resolveSandboxedPath(inputPath, ctx.config.sandboxRoot);
  const fileStat = await stat(resolvedPath);

  const hash = await new Promise<string>((resolve, reject) => {
    const hasher = createHash("sha256");
    const stream = createReadStream(resolvedPath);
    stream.on("data", (chunk) => hasher.update(chunk));
    stream.on("end", () => resolve(hasher.digest("hex")));
    stream.on("error", reject);
  });

  return {
    result: {
      sha256: hash,
      path: resolvedPath,
      bytes: fileStat.size,
    },
    evidence: [
      {
        type: "file",
        ref: resolvedPath,
        summary: `SHA-256 of ${resolvedPath} (${fileStat.size} bytes): ${hash.slice(0, 16)}...`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
