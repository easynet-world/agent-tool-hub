import { rm, unlink, rmdir, stat } from "node:fs/promises";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { resolveSandboxedPath } from "../security/sandbox.js";

export const deletePathInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File or directory path relative to sandbox root" },
    recursive: {
      type: "boolean",
      default: false,
      description: "Recursively delete directory contents",
    },
    confirm: {
      type: "boolean",
      description: "Must be true to confirm deletion (safety gate)",
    },
  },
  required: ["path", "confirm"],
  additionalProperties: false,
} as const;

export const deletePathOutputSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    deleted: { type: "boolean" },
    type: { type: "string", enum: ["file", "directory"] },
  },
  required: ["path", "deleted", "type"],
  additionalProperties: false,
} as const;

export const deletePathSpec: ToolSpec = {
  name: "core/fs.deletePath",
  version: "1.0.0",
  kind: "core",
  description: "Delete a file or directory in the sandbox (dangerous, requires explicit confirmation)",
  tags: ["filesystem", "delete", "dangerous", "core"],
  inputSchema: deletePathInputSchema,
  outputSchema: deletePathOutputSchema,
  capabilities: ["danger:destructive", "write:fs"],
};

export const deletePathHandler: CoreToolHandler = async (args, ctx) => {
  const inputPath = args.path as string;
  const recursive = (args.recursive as boolean | undefined) ?? false;
  const confirm = args.confirm as boolean;

  if (!confirm) {
    throw new Error(
      "Deletion not confirmed. Set confirm=true to proceed with deletion.",
    );
  }

  const resolvedPath = await resolveSandboxedPath(inputPath, ctx.config.sandboxRoot);

  // Prevent deleting the sandbox root itself (compare resolved paths)
  let realSandboxRoot: string;
  try {
    const { realpath: rp } = await import("node:fs/promises");
    realSandboxRoot = await rp(ctx.config.sandboxRoot);
  } catch {
    realSandboxRoot = ctx.config.sandboxRoot;
  }
  if (resolvedPath === realSandboxRoot) {
    throw new Error("Cannot delete the sandbox root directory.");
  }

  const fileStat = await stat(resolvedPath);
  const isDirectory = fileStat.isDirectory();

  if (isDirectory) {
    if (recursive) {
      await rm(resolvedPath, { recursive: true, force: true });
    } else {
      await rmdir(resolvedPath);
    }
  } else {
    await unlink(resolvedPath);
  }

  return {
    result: {
      path: resolvedPath,
      deleted: true,
      type: isDirectory ? "directory" : "file",
    },
    evidence: [
      {
        type: "file",
        ref: resolvedPath,
        summary: `Deleted ${isDirectory ? "directory" : "file"}: ${resolvedPath}${recursive ? " (recursive)" : ""}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
