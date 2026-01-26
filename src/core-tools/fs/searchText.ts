import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, relative } from "node:path";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";
import { resolveSandboxedPath } from "../security/sandbox.js";

export const searchTextInputSchema = {
  type: "object",
  properties: {
    root: { type: "string", description: "Directory path relative to sandbox root" },
    query: { type: "string", description: "Text pattern to search for (plain string or regex)" },
    glob: {
      type: "string",
      default: "**/*.{md,txt,log,json,ts,js,py,java,scala}",
      description: "Glob pattern to filter files",
    },
    maxMatches: {
      type: "integer",
      minimum: 1,
      maximum: 5000,
      default: 100,
      description: "Maximum number of matches to return",
    },
    maxFiles: {
      type: "integer",
      minimum: 1,
      maximum: 2000,
      default: 500,
      description: "Maximum number of files to scan",
    },
  },
  required: ["root", "query"],
  additionalProperties: false,
} as const;

interface SearchMatch {
  file: string;
  lineNo: number;
  excerpt: string;
}

export const searchTextOutputSchema = {
  type: "object",
  properties: {
    root: { type: "string" },
    query: { type: "string" },
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          lineNo: { type: "integer" },
          excerpt: { type: "string" },
        },
        required: ["file", "lineNo", "excerpt"],
        additionalProperties: false,
      },
    },
    totalMatches: { type: "integer" },
    filesScanned: { type: "integer" },
    truncated: { type: "boolean" },
  },
  required: ["root", "query", "matches", "totalMatches", "filesScanned", "truncated"],
  additionalProperties: false,
} as const;

export const searchTextSpec: ToolSpec = {
  name: "core/fs.searchText",
  version: "1.0.0",
  kind: "core",
  description: "Search for text patterns in files within the sandbox",
  tags: ["filesystem", "search", "core"],
  inputSchema: searchTextInputSchema,
  outputSchema: searchTextOutputSchema,
  capabilities: ["read:fs"],
};

export const searchTextHandler: CoreToolHandler = async (args, ctx) => {
  const rootPath = args.root as string;
  const query = args.query as string;
  const glob = (args.glob as string | undefined) ?? "**/*.{md,txt,log,json,ts,js,py,java,scala}";
  const maxMatches = (args.maxMatches as number | undefined) ?? 100;
  const maxFiles = (args.maxFiles as number | undefined) ?? 500;

  const resolvedRoot = await resolveSandboxedPath(rootPath, ctx.config.sandboxRoot);

  // Build regex from query
  let regex: RegExp;
  try {
    regex = new RegExp(query, "i");
  } catch {
    // If not a valid regex, escape and use as literal
    regex = new RegExp(escapeRegExp(query), "i");
  }

  // Collect matching file extensions from glob
  const extensions = parseGlobExtensions(glob);

  // Walk directory and collect files
  const files: string[] = [];
  await collectFiles(resolvedRoot, files, { maxFiles, extensions });

  // Search through files
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  for (const filePath of files) {
    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
    filesScanned++;
    await searchFile(filePath, resolvedRoot, regex, matches, maxMatches);
  }

  if (matches.length >= maxMatches) {
    truncated = true;
  }

  return {
    result: {
      root: resolvedRoot,
      query,
      matches,
      totalMatches: matches.length,
      filesScanned,
      truncated,
    },
    evidence: [
      {
        type: "tool",
        ref: `core/fs.searchText:${resolvedRoot}`,
        summary: `Found ${matches.length} matches in ${filesScanned} files under ${resolvedRoot}${truncated ? " (truncated)" : ""}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};

async function collectFiles(
  dirPath: string,
  files: string[],
  options: { maxFiles: number; extensions: Set<string> },
): Promise<void> {
  if (files.length >= options.maxFiles) return;

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= options.maxFiles) return;

    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      await collectFiles(fullPath, files, options);
    } else if (entry.isFile()) {
      if (options.extensions.size > 0) {
        const ext = getExtension(entry.name);
        if (!ext || !options.extensions.has(ext)) continue;
      }
      files.push(fullPath);
    }
  }
}

async function searchFile(
  filePath: string,
  root: string,
  regex: RegExp,
  matches: SearchMatch[],
  maxMatches: number,
): Promise<void> {
  const fileStat = await stat(filePath).catch(() => null);
  // Skip large files (>1MB)
  if (!fileStat || fileStat.size > 1024 * 1024) return;

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (matches.length >= maxMatches) {
      stream.destroy();
      break;
    }
    if (regex.test(line)) {
      matches.push({
        file: relative(root, filePath),
        lineNo,
        excerpt: line.slice(0, 200),
      });
    }
  }
}

function parseGlobExtensions(glob: string): Set<string> {
  const extensions = new Set<string>();
  // Match patterns like *.{ts,js,py} or *.ts
  const braceMatch = glob.match(/\*\.\{([^}]+)\}/);
  if (braceMatch) {
    for (const ext of braceMatch[1]!.split(",")) {
      extensions.add(ext.trim());
    }
  } else {
    const simpleMatch = glob.match(/\*\.(\w+)/);
    if (simpleMatch) {
      extensions.add(simpleMatch[1]!);
    }
  }
  return extensions;
}

function getExtension(filename: string): string | null {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === 0) return null;
  return filename.slice(dotIdx + 1);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
