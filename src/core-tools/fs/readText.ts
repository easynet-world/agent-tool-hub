import { readFile, stat } from "node:fs/promises";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { resolveSandboxedPath } from "../security/sandbox.js";
import { createTaggedError } from "../../core/Retry.js";

export const readTextInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path relative to sandbox root" },
    maxBytes: {
      type: "integer",
      minimum: 1024,
      maximum: 10485760,
      description: "Maximum bytes to read (default: from config)",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export const readTextOutputSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    text: { type: "string" },
    bytes: { type: "integer" },
  },
  required: ["path", "text", "bytes"],
  additionalProperties: false,
} as const;

export const readTextSpec: ToolSpec = {
  name: "core/fs.readText",
  version: "1.0.0",
  kind: "core",
  description: "Read a UTF-8 text file from the sandbox",
  tags: ["filesystem", "read", "core"],
  inputSchema: readTextInputSchema,
  outputSchema: readTextOutputSchema,
  capabilities: ["read:fs"],
};

export const readTextHandler: CoreToolHandler = async (args, ctx) => {
  const inputPath = args.path as string;
  const maxBytes = (args.maxBytes as number | undefined) ?? ctx.config.maxReadBytes;

  const resolvedPath = await resolveSandboxedPath(inputPath, ctx.config.sandboxRoot);

  const fileStat = await stat(resolvedPath);
  if (fileStat.size > maxBytes) {
    throw createTaggedError(
      "FILE_TOO_LARGE",
      `File size ${fileStat.size} bytes exceeds limit of ${maxBytes} bytes`,
      { path: resolvedPath, size: fileStat.size, limit: maxBytes },
    );
  }

  const text = await readFile(resolvedPath, "utf-8");

  return {
    result: {
      path: resolvedPath,
      text,
      bytes: fileStat.size,
    },
    evidence: [
      {
        type: "file",
        ref: resolvedPath,
        summary: `Read ${fileStat.size} bytes from ${resolvedPath}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
