import type { ToolSpec } from "../types/ToolSpec.js";
import type { SkillDefinition } from "../discovery/loaders/SkillManifest.js";
import type { ToolDescription } from "./ToolHub.js";

/**
 * Extract SkillDefinition from a tool spec if it is a skill with impl.
 */
export function extractSkillDefinitionFromSpec(spec: ToolSpec): SkillDefinition | undefined {
  if (spec.impl && typeof spec.impl === "object" && "frontmatter" in spec.impl) {
    return spec.impl as SkillDefinition;
  }
  return undefined;
}

/**
 * Build ToolDescription from a tool spec (skill or generic).
 */
export function specToToolDescription(
  spec: ToolSpec,
  extractSkillDef: (s: ToolSpec) => SkillDefinition | undefined,
): ToolDescription {
  if (spec.kind === "skill") {
    const def = extractSkillDef(spec);
    if (def) {
      return {
        name: def.frontmatter.name,
        description: def.frontmatter.description,
        instructions: def.instructions,
        resources: def.resources.map((r) => ({
          path: r.relativePath,
          type: r.type,
        })),
        dirPath: def.dirPath,
      };
    }
  }

  return {
    name: spec.name,
    description: spec.description,
    kind: spec.kind,
    version: spec.version,
    tags: spec.tags,
    capabilities: spec.capabilities,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    costHints: spec.costHints,
    endpoint: spec.endpoint,
    resourceId: spec.resourceId,
  };
}
