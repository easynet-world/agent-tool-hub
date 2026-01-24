import { join } from "node:path";
import { stat } from "node:fs/promises";

const DEFAULT_EXTENSIONS = [".js", ".mjs"];

/**
 * Resolve the entry point file for a tool directory.
 * If baseName already has an extension, verifies the file exists.
 * Otherwise tries each extension in order.
 */
export async function resolveEntryPoint(
  dirPath: string,
  baseName: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
): Promise<string> {
  // If baseName already has a recognized extension, use it directly
  if (extensions.some((ext) => baseName.endsWith(ext))) {
    const fullPath = join(dirPath, baseName);
    await stat(fullPath); // throws ENOENT if not found
    return fullPath;
  }

  // Try each extension
  for (const ext of extensions) {
    const fullPath = join(dirPath, `${baseName}${ext}`);
    try {
      await stat(fullPath);
      return fullPath;
    } catch {
      // try next extension
    }
  }

  throw new Error(
    `Could not find entry point in ${dirPath}. Tried: ${extensions.map((e) => baseName + e).join(", ")}`,
  );
}
