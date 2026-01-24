import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolManifest, LoadedTool } from "../types.js";
import { DiscoveryError } from "../errors.js";

/**
 * Load an n8n tool from its directory.
 * Reads workflow.json and validates it has a "nodes" array.
 */
export async function loadN8nTool(
  dirPath: string,
  manifest: ToolManifest,
): Promise<LoadedTool> {
  const workflowPath = join(dirPath, manifest.entryPoint ?? "workflow.json");

  let raw: string;
  try {
    raw = await readFile(workflowPath, "utf-8");
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Failed to read workflow: ${workflowPath}`,
      err as Error,
    );
  }

  let workflowDef: Record<string, unknown>;
  try {
    workflowDef = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Invalid JSON in ${workflowPath}`,
      err as Error,
    );
  }

  if (!workflowDef.nodes || !Array.isArray(workflowDef.nodes)) {
    throw new DiscoveryError(
      dirPath,
      "validate",
      `workflow.json must have a "nodes" array`,
    );
  }

  return { manifest, dirPath, workflowDef };
}
