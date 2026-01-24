import { pathToFileURL } from "node:url";
import type { ToolManifest, LoadedTool } from "../types.js";
import { DiscoveryError } from "../errors.js";
import { resolveEntryPoint } from "./resolveEntry.js";
import { loadSkillDefinition } from "./SkillMdParser.js";
import type { SkillDefinition } from "./SkillManifest.js";

/**
 * Load a Skill tool from its directory following Anthropic's Agent Skills spec.
 *
 * Requires a SKILL.md file with YAML frontmatter (name, description).
 * The SKILL.md body provides instructions (Level 2), and bundled files
 * in the directory provide resources (Level 3).
 *
 * Optionally loads a handler function (handler.js/mjs) for programmatic execution.
 *
 * @see https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 */
export async function loadSkillTool(
  dirPath: string,
  manifest: ToolManifest,
  extensions?: string[],
): Promise<LoadedTool> {
  let skillDef: SkillDefinition;
  try {
    skillDef = await loadSkillDefinition(dirPath);
  } catch (err) {
    throw new DiscoveryError(
      dirPath,
      "load",
      `Failed to parse SKILL.md: ${(err as Error).message}`,
      err as Error,
    );
  }

  // Try to load an optional handler function for programmatic execution
  let handler: unknown;
  try {
    const entryFile = await resolveEntryPoint(
      dirPath,
      manifest.entryPoint ?? "handler",
      extensions,
    );
    const mod = (await import(pathToFileURL(entryFile).href)) as Record<string, unknown>;
    const fn = mod.default ?? mod.handler;
    if (typeof fn === "function") {
      handler = fn;
    }
  } catch {
    // Handler is optional — skills can be instruction-only
  }

  return {
    manifest,
    dirPath,
    impl: handler,
    skillDefinition: skillDef,
  };
}
