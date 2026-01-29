import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile, writeFile, readdir, unlink, rmdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const CWD = process.cwd();

function resolveSafe(pathStr) {
  const resolved = resolve(CWD, pathStr);
  if (!resolved.startsWith(CWD)) {
    throw new Error("Path must be under current working directory.");
  }
  return resolved;
}

/**
 * Filesystem CRUD tool using LangChain StructuredTool.
 * Actions: read, write, list, delete. Paths are relative to process.cwd().
 */
class FilesystemTool extends StructuredTool {
  name = "filesystem";
  description =
    "Filesystem CRUD: read file, write file, list directory, or delete file/directory. Paths are relative to current working directory. Use action: read|write|list|delete.";

  schema = z.object({
    action: z
      .enum(["read", "write", "list", "delete"])
      .describe("Operation: read (file), write (file), list (directory), delete (file or empty dir)"),
    path: z.string().describe("File or directory path (relative to cwd)"),
    text: z
      .string()
      .optional()
      .describe("Content to write; required when action is write"),
    encoding: z
      .string()
      .optional()
      .default("utf-8")
      .describe("Encoding for read/write (default utf-8)"),
  });

  async _call({ action, path: pathStr, text, encoding = "utf-8" }) {
    const absPath = resolveSafe(pathStr);

    switch (action) {
      case "read": {
        const content = await readFile(absPath, { encoding });
        const text = typeof content === "string" ? content : content.toString(encoding);
        return { path: pathStr, absolutePath: absPath, text };
      }
      case "write": {
        if (text === undefined) throw new Error("Missing 'text' for action write.");
        await writeFile(absPath, text, { encoding });
        return {
          path: pathStr,
          absolutePath: absPath,
          written: true,
          bytes: Buffer.byteLength(text, encoding),
        };
      }
      case "list": {
        const entries = await readdir(absPath, { withFileTypes: true });
        const list = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        }));
        return { path: pathStr, absolutePath: absPath, entries: list };
      }
      case "delete": {
        const st = await stat(absPath);
        if (st.isDirectory()) {
          const children = await readdir(absPath);
          if (children.length > 0) {
            throw new Error("Cannot delete non-empty directory. Remove contents first.");
          }
          await rmdir(absPath);
        } else {
          await unlink(absPath);
        }
        return { path: pathStr, absolutePath: absPath, deleted: true };
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}

export default new FilesystemTool();
