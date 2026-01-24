import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { resolveSandboxedPath } from "../security/sandbox.js";

export const writeTextInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path relative to sandbox root" },
    text: { type: "string", description: "UTF-8 text content to write" },
    overwrite: {
      type: "boolean",
      default: false,
      description: "Allow overwriting existing files",
    },
    mkdirp: {
      type: "boolean",
      default: true,
      description: "Create parent directories if they do not exist",
    },
  },
  required: ["path", "text"],
  additionalProperties: false,
} as const;

export const writeTextOutputSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    bytes: { type: "integer" },
    sha256: { type: "string" },
  },
  required: ["path", "bytes", "sha256"],
  additionalProperties: false,
} as const;

export const writeTextSpec: ToolSpec = {
  name: "core/fs.writeText",
  version: "1.0.0",
  kind: "core",
  description: "Write UTF-8 text to a file in the sandbox",
  tags: ["filesystem", "write", "core"],
  inputSchema: writeTextInputSchema,
  outputSchema: writeTextOutputSchema,
  capabilities: ["write:fs"],
};

export const writeTextHandler: CoreToolHandler = async (args, ctx) => {
  const inputPath = args.path as string;
  const text = args.text as string;
  const overwrite = (args.overwrite as boolean | undefined) ?? false;
  const mkdirp = (args.mkdirp as boolean | undefined) ?? true;

  const resolvedPath = await resolveSandboxedPath(inputPath, ctx.config.sandboxRoot);

  // Check overwrite
  if (!overwrite) {
    const { access } = await import("node:fs/promises");
    try {
      await access(resolvedPath);
      throw new Error(
        `File already exists: ${resolvedPath}. Set overwrite=true to allow overwriting.`,
      );
    } catch (err) {
      // File not found is expected — proceed
      if (err instanceof Error && !err.message.includes("already exists")) {
        // access threw ENOENT — file doesn't exist, continue
      } else {
        throw err;
      }
    }
  }

  // Create parent directories if needed
  if (mkdirp) {
    await mkdir(dirname(resolvedPath), { recursive: true });
  }

  // Write file
  await writeFile(resolvedPath, text, "utf-8");

  const bytes = Buffer.byteLength(text, "utf-8");
  const sha256 = createHash("sha256").update(text).digest("hex");

  return {
    result: {
      path: resolvedPath,
      bytes,
      sha256,
    },
    evidence: [
      {
        type: "file",
        ref: resolvedPath,
        summary: `Wrote ${bytes} bytes to ${resolvedPath} (sha256: ${sha256.slice(0, 12)}...)`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
