import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { resolveSandboxedPath } from "../security/sandbox.js";

export const listDirInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "Directory path relative to sandbox root" },
    maxEntries: {
      type: "integer",
      minimum: 1,
      maximum: 5000,
      default: 2000,
      description: "Maximum number of entries to return",
    },
    includeHidden: {
      type: "boolean",
      default: false,
      description: "Include hidden files (starting with .)",
    },
    recursive: {
      type: "boolean",
      default: false,
      description: "Recurse into subdirectories",
    },
    maxDepth: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      default: 5,
      description: "Maximum recursion depth (only used when recursive=true)",
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mtime: string;
}

export const listDirOutputSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["file", "directory", "symlink", "other"] },
          size: { type: "integer" },
          mtime: { type: "string" },
        },
        required: ["name", "type", "size", "mtime"],
        additionalProperties: false,
      },
    },
    totalEntries: { type: "integer" },
    truncated: { type: "boolean" },
  },
  required: ["path", "entries", "totalEntries", "truncated"],
  additionalProperties: false,
} as const;

export const listDirSpec: ToolSpec = {
  name: "core/fs.listDir",
  version: "1.0.0",
  kind: "core",
  description: "List directory contents in the sandbox",
  tags: ["filesystem", "read", "core"],
  inputSchema: listDirInputSchema,
  outputSchema: listDirOutputSchema,
  capabilities: ["read:fs"],
};

export const listDirHandler: CoreToolHandler = async (args, ctx) => {
  const inputPath = args.path as string;
  const maxEntries = (args.maxEntries as number | undefined) ?? 2000;
  const includeHidden = (args.includeHidden as boolean | undefined) ?? false;
  const recursive = (args.recursive as boolean | undefined) ?? false;
  const maxDepth = (args.maxDepth as number | undefined) ?? 5;

  const resolvedPath = await resolveSandboxedPath(inputPath, ctx.config.sandboxRoot);

  const entries: DirEntry[] = [];
  let truncated = false;

  await walkDir(resolvedPath, "", entries, {
    maxEntries,
    includeHidden,
    recursive,
    maxDepth,
    currentDepth: 0,
    onTruncate: () => { truncated = true; },
  });

  return {
    result: {
      path: resolvedPath,
      entries,
      totalEntries: entries.length,
      truncated,
    },
    evidence: [
      {
        type: "tool",
        ref: `core/fs.listDir:${resolvedPath}`,
        summary: `Listed ${entries.length} entries in ${resolvedPath}${truncated ? " (truncated)" : ""}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};

interface WalkOptions {
  maxEntries: number;
  includeHidden: boolean;
  recursive: boolean;
  maxDepth: number;
  currentDepth: number;
  onTruncate: () => void;
}

async function walkDir(
  basePath: string,
  relativePath: string,
  entries: DirEntry[],
  options: WalkOptions,
): Promise<void> {
  if (entries.length >= options.maxEntries) {
    options.onTruncate();
    return;
  }

  const fullPath = relativePath ? resolve(basePath, relativePath) : basePath;
  const dirEntries = await readdir(fullPath, { withFileTypes: true });

  for (const dirent of dirEntries) {
    if (entries.length >= options.maxEntries) {
      options.onTruncate();
      return;
    }

    if (!options.includeHidden && dirent.name.startsWith(".")) {
      continue;
    }

    const entryPath = join(fullPath, dirent.name);
    const entryRelative = relativePath ? join(relativePath, dirent.name) : dirent.name;

    let entryType: DirEntry["type"];
    if (dirent.isSymbolicLink()) {
      entryType = "symlink";
    } else if (dirent.isDirectory()) {
      entryType = "directory";
    } else if (dirent.isFile()) {
      entryType = "file";
    } else {
      entryType = "other";
    }

    let size = 0;
    let mtime = "";
    try {
      const entryStat = await stat(entryPath);
      size = entryStat.size;
      mtime = entryStat.mtime.toISOString();
    } catch {
      // Best effort stat
    }

    entries.push({
      name: entryRelative,
      type: entryType,
      size,
      mtime,
    });

    // Recurse into directories
    if (
      options.recursive &&
      entryType === "directory" &&
      options.currentDepth < options.maxDepth
    ) {
      await walkDir(basePath, entryRelative, entries, {
        ...options,
        currentDepth: options.currentDepth + 1,
      });
    }
  }
}
