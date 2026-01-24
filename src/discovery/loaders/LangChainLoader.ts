import { pathToFileURL } from "node:url";
import type { ToolManifest, LoadedTool } from "../types.js";
import { DiscoveryError } from "../errors.js";
import { resolveEntryPoint } from "./resolveEntry.js";

/**
 * Load a LangChain tool from its directory.
 * Dynamically imports the entry point and validates it has an invoke() method.
 */
export async function loadLangChainTool(
  dirPath: string,
  manifest: ToolManifest,
  extensions?: string[],
): Promise<LoadedTool> {
  let entryFile: string;
  try {
    entryFile = await resolveEntryPoint(
      dirPath,
      manifest.entryPoint ?? "index",
      extensions,
    );
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Cannot find LangChain entry point`,
      err as Error,
    );
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(entryFile).href)) as Record<string, unknown>;
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Failed to import ${entryFile}`,
      err as Error,
    );
  }

  // Resolve the tool instance: default export > named "tool" > module itself
  const tool = (mod.default ?? mod.tool ?? mod) as Record<string, unknown>;

  if (!tool || typeof tool.invoke !== "function") {
    throw new DiscoveryError(
      dirPath,
      "validate",
      `Entry point must export an object with invoke() method (LangChainToolLike)`,
    );
  }

  return { manifest, dirPath, impl: tool };
}
