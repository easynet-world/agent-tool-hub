/**
 * Parsed SKILL.md manifest following Anthropic's Agent Skills specification.
 *
 * A SKILL.md file has:
 * - YAML frontmatter with `name` and `description` (Level 1: metadata, always loaded)
 * - Markdown body with instructions (Level 2: loaded when triggered)
 * - Bundled resource files referenced from the body (Level 3: loaded as needed)
 *
 * @see https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 */

/**
 * YAML frontmatter from SKILL.md.
 * This is Level 1 (metadata) — always loaded at startup for discovery.
 */
export interface SkillFrontmatter {
  /**
   * Skill name identifier.
   * - Max 64 characters
   * - Lowercase letters, numbers, and hyphens only
   */
  name: string;

  /**
   * What the skill does and when to use it.
   * - Max 1024 characters
   * - Should include triggers/contexts for activation
   * - Written in third person
   */
  description: string;
}

/**
 * A resource file bundled with the skill.
 * Resources are Level 3 — loaded only as needed during execution.
 */
export interface SkillResource {
  /** Relative path from the skill directory */
  relativePath: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** File extension (e.g., ".md", ".py", ".json") */
  extension: string;
  /** Resource type inferred from extension */
  type: "instructions" | "code" | "data";
}

/**
 * Full parsed SKILL.md with progressive disclosure levels.
 */
export interface SkillDefinition {
  /** Level 1: Metadata from YAML frontmatter (always loaded, ~100 tokens) */
  frontmatter: SkillFrontmatter;

  /** Level 2: Markdown body instructions (loaded when skill triggered, <5k tokens recommended) */
  instructions: string;

  /** Level 3: Bundled resource files (loaded as needed, effectively unlimited) */
  resources: SkillResource[];

  /** Absolute path to the skill directory */
  dirPath: string;

  /** Absolute path to the SKILL.md file */
  skillMdPath: string;
}

/**
 * Validation error for SKILL.md parsing.
 */
export class SkillManifestError extends Error {
  constructor(
    public readonly path: string,
    public readonly field: string,
    message: string,
  ) {
    super(`SKILL.md error in ${path}: ${message}`);
    this.name = "SkillManifestError";
  }
}

// --- Validation helpers ---

const NAME_PATTERN = /^[a-z0-9-]+$/;
const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 1024;
const RESERVED_WORDS = ["anthropic", "claude"];
const XML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/;

/**
 * Validate a SkillFrontmatter object.
 * Throws SkillManifestError if invalid.
 */
export function validateFrontmatter(
  fm: Partial<SkillFrontmatter>,
  filePath: string,
): asserts fm is SkillFrontmatter {
  // name: required
  if (!fm.name || typeof fm.name !== "string") {
    throw new SkillManifestError(filePath, "name", "name is required");
  }
  if (fm.name.length > NAME_MAX_LENGTH) {
    throw new SkillManifestError(
      filePath,
      "name",
      `name must be at most ${NAME_MAX_LENGTH} characters (got ${fm.name.length})`,
    );
  }
  if (!NAME_PATTERN.test(fm.name)) {
    throw new SkillManifestError(
      filePath,
      "name",
      "name must contain only lowercase letters, numbers, and hyphens",
    );
  }
  if (XML_TAG_PATTERN.test(fm.name)) {
    throw new SkillManifestError(filePath, "name", "name cannot contain XML tags");
  }
  for (const reserved of RESERVED_WORDS) {
    if (fm.name.includes(reserved)) {
      throw new SkillManifestError(
        filePath,
        "name",
        `name cannot contain reserved word "${reserved}"`,
      );
    }
  }

  // description: required
  if (!fm.description || typeof fm.description !== "string") {
    throw new SkillManifestError(
      filePath,
      "description",
      "description is required and must be non-empty",
    );
  }
  if (fm.description.length > DESCRIPTION_MAX_LENGTH) {
    throw new SkillManifestError(
      filePath,
      "description",
      `description must be at most ${DESCRIPTION_MAX_LENGTH} characters (got ${fm.description.length})`,
    );
  }
  if (XML_TAG_PATTERN.test(fm.description)) {
    throw new SkillManifestError(
      filePath,
      "description",
      "description cannot contain XML tags",
    );
  }
}
