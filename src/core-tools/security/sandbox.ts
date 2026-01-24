import { resolve, normalize, dirname, basename } from "node:path";
import { realpath, access } from "node:fs/promises";
import { createTaggedError } from "../../core/Retry.js";

/**
 * Resolve an input path to an absolute path within the sandbox.
 * Throws PATH_OUTSIDE_SANDBOX if the resolved path escapes the sandbox root.
 *
 * For existing files: uses realpath to resolve symlinks.
 * For non-existing files (write targets): resolves the parent directory.
 */
export async function resolveSandboxedPath(
  inputPath: string,
  sandboxRoot: string,
): Promise<string> {
  // Resolve the sandbox root itself with realpath to handle platform symlinks
  // (e.g. macOS /var -> /private/var)
  let normalizedRoot: string;
  try {
    normalizedRoot = await realpath(resolve(sandboxRoot));
  } catch {
    normalizedRoot = normalize(resolve(sandboxRoot));
  }

  // Resolve against sandbox root
  const resolved = resolve(normalizedRoot, inputPath);

  let real: string;
  try {
    // Try to resolve symlinks for existing paths
    await access(resolved);
    real = await realpath(resolved);
  } catch {
    // Path does not exist — resolve parent to check containment
    const parentDir = dirname(resolved);
    let realParent: string;
    try {
      await access(parentDir);
      realParent = await realpath(parentDir);
    } catch {
      // Parent also doesn't exist — use normalized resolved path
      // (will fail at actual FS operation if truly invalid)
      realParent = normalize(parentDir);
    }
    real = resolve(realParent, basename(resolved));
  }

  if (!isWithinRoot(real, normalizedRoot)) {
    throw createTaggedError(
      "PATH_OUTSIDE_SANDBOX",
      `Path "${inputPath}" resolves to "${real}" which is outside sandbox "${normalizedRoot}"`,
      { inputPath, resolvedPath: real, sandboxRoot: normalizedRoot },
    );
  }

  return real;
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalize(path);
  const normalizedRoot = normalize(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
}
