import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile, rename, access } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Filesystem skill handler.
 */
async function handler(args) {
  const { operation, path, content, target, recursive, ensureDir } = args ?? {};

  if (!operation || typeof operation !== "string") {
    throw new Error("operation is required");
  }
  if (!path || typeof path !== "string") {
    throw new Error("path is required");
  }

  const useRecursive = typeof recursive === "boolean" ? recursive : true;
  const useEnsureDir = typeof ensureDir === "boolean" ? ensureDir : false;

  switch (operation) {
    case "read": {
      const data = await readFile(path, "utf-8");
      return {
        result: {
          operation,
          path,
          content: data,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-read",
            summary: `Read ${data.length} bytes from ${path}`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "write": {
      if (typeof content !== "string") {
        throw new Error("content is required for write operation");
      }
      if (useEnsureDir) {
        await mkdir(dirname(path), { recursive: true });
      }
      await writeFile(path, content, "utf-8");
      return {
        result: {
          operation,
          path,
          content,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-write",
            summary: `Wrote ${content.length} bytes to ${path}`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "list": {
      const items = await listEntries(path, useRecursive);
      return {
        result: {
          operation,
          path,
          items,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-list",
            summary: `Listed ${items.length} item(s) in ${path}`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "stat": {
      const info = await stat(path);
      return {
        result: {
          operation,
          path,
          stat: {
            size: info.size,
            mtimeMs: info.mtimeMs,
            isFile: info.isFile(),
            isDirectory: info.isDirectory(),
          },
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-stat",
            summary: `Stat ${path} (${info.isDirectory() ? "directory" : "file"})`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "exists": {
      let exists = true;
      try {
        await access(path);
      } catch {
        exists = false;
      }
      return {
        result: {
          operation,
          path,
          exists,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-exists",
            summary: `${path} exists: ${exists}`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "mkdir": {
      await mkdir(path, { recursive: useRecursive });
      return {
        result: {
          operation,
          path,
          recursive: useRecursive,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-mkdir",
            summary: `Created directory ${path} (recursive=${useRecursive})`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "delete": {
      await rm(path, { recursive: useRecursive, force: true });
      return {
        result: {
          operation,
          path,
          recursive: useRecursive,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-delete",
            summary: `Deleted ${path} (recursive=${useRecursive})`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "copy": {
      if (!target || typeof target !== "string") {
        throw new Error("target is required for copy operation");
      }
      if (useEnsureDir) {
        await mkdir(dirname(target), { recursive: true });
      }
      await copyFile(path, target);
      return {
        result: {
          operation,
          path,
          target,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-copy",
            summary: `Copied ${path} -> ${target}`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    case "move": {
      if (!target || typeof target !== "string") {
        throw new Error("target is required for move operation");
      }
      if (useEnsureDir) {
        await mkdir(dirname(target), { recursive: true });
      }
      try {
        await rename(path, target);
      } catch (err) {
        const error = err && typeof err === "object" ? err : {};
        if (error.code === "EXDEV") {
          await copyFile(path, target);
          await rm(path, { recursive: true, force: true });
        } else {
          throw err;
        }
      }
      return {
        result: {
          operation,
          path,
          target,
        },
        evidence: [
          {
            type: "text",
            ref: "filesystem-move",
            summary: `Moved ${path} -> ${target}`,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

export default handler;

async function listEntries(basePath, recursive) {
  const entries = await readdir(basePath, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    const item = {
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      path: `${basePath}/${entry.name}`,
    };
    items.push(item);
    if (recursive && entry.isDirectory()) {
      const childItems = await listEntries(item.path, true);
      items.push(...childItems);
    }
  }
  return items;
}
