import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import yaml from "js-yaml";
import type {
  SkillDefinition,
  SkillFrontmatter,
  SkillResource,
} from "./SkillManifest.js";
import { SkillManifestError, validateFrontmatter } from "./SkillManifest.js";

/**
 * File extensions categorized by resource type.
 */
const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".mjs", ".ts", ".sh", ".bash", ".rb", ".go",
]);
const INSTRUCTION_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/**
 * Files to exclude from resource scanning.
 */
const EXCLUDED_FILES = new Set(["SKILL.md", "tool.json"]);

/**
 * Parse a SKILL.md file into its constituent parts:
 * - YAML frontmatter (metadata)
 * - Markdown body (instructions)
 *
 * Supports the standard YAML frontmatter format:
 * ```
 * ---
 * name: my-skill
 * description: Does something useful
 * ---
 *
 * # Instructions here...
 * ```
 */
export function parseSkillMd(
  content: string,
  filePath: string,
): { frontmatter: SkillFrontmatter; instructions: string } {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith("---")) {
    throw new SkillManifestError(
      filePath,
      "frontmatter",
      "SKILL.md must start with YAML frontmatter (---)",
    );
  }

  // Find the closing ---
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    throw new SkillManifestError(
      filePath,
      "frontmatter",
      "SKILL.md frontmatter is not closed (missing closing ---)",
    );
  }

  const yamlBlock = trimmed.slice(4, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();

  let raw: Record<string, unknown>;
  try {
    const parsed = yaml.load(yamlBlock);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SkillManifestError(
        filePath,
        "frontmatter",
        "YAML frontmatter must be an object (key: value)",
      );
    }
    raw = parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SkillManifestError(
      filePath,
      "frontmatter",
      `Invalid YAML frontmatter: ${message}`,
    );
  }

  const name = stringField(raw, "name", filePath);
  const description = stringField(raw, "description", filePath);
  if (!name || !description) {
    throw new SkillManifestError(
      filePath,
      "frontmatter",
      !name ? "name is required" : "description is required",
    );
  }

  const license = stringField(raw, "license");
  const compatibility = stringField(raw, "compatibility");
  const allowedTools = stringField(raw, "allowed-tools");
  const metadata = normalizeMetadata(raw.metadata);

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    ...(license && { license }),
    ...(compatibility && { compatibility }),
    ...(allowedTools && { allowedTools }),
    ...(metadata && Object.keys(metadata).length > 0 && { metadata }),
  };
  validateFrontmatter(frontmatter, filePath);

  return { frontmatter, instructions: body };
}

function stringField(
  raw: Record<string, unknown>,
  key: string,
  filePath?: string,
): string {
  const v = raw[key];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "string" ? x : String(x))).join("\n");
  }
  if (filePath) {
    throw new SkillManifestError(
      filePath,
      "frontmatter",
      `Frontmatter field "${key}" must be a string, number, boolean, or array`,
    );
  }
  return String(v);
}

/**
 * Normalize frontmatter `metadata` to Record<string, string>.
 * Supports nested YAML: { author: "...", version: "..." } → flat string values.
 */
function normalizeMetadata(val: unknown): Record<string, string> | undefined {
  if (val == null) return undefined;
  if (typeof val === "object" && !Array.isArray(val)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof k === "string" && v !== undefined && v !== null) {
        out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return { value: String(val) };
  }
  return undefined;
}


/**
 * Scan a skill directory for bundled resource files (Level 3).
 * Recursively finds all files except SKILL.md and tool.json.
 */
export async function scanSkillResources(dirPath: string): Promise<SkillResource[]> {
  const resources: SkillResource[] = [];
  await scanDir(dirPath, dirPath, resources);
  return resources;
}

async function scanDir(
  basePath: string,
  currentPath: string,
  resources: SkillResource[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      await scanDir(basePath, fullPath, resources);
    } else if (entry.isFile()) {
      // Skip excluded files
      if (EXCLUDED_FILES.has(entry.name)) {
        continue;
      }

      const ext = extname(entry.name).toLowerCase();
      const relPath = relative(basePath, fullPath);

      resources.push({
        relativePath: relPath,
        absolutePath: fullPath,
        extension: ext,
        type: inferResourceType(ext),
      });
    }
  }
}

function inferResourceType(ext: string): SkillResource["type"] {
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (INSTRUCTION_EXTENSIONS.has(ext)) return "instructions";
  return "data";
}

/**
 * Load and parse a complete skill from a directory containing SKILL.md.
 * Returns the full SkillDefinition with all three progressive disclosure levels.
 */
export async function loadSkillDefinition(dirPath: string): Promise<SkillDefinition> {
  const skillMdPath = join(dirPath, "SKILL.md");

  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch (err) {
    throw new SkillManifestError(
      skillMdPath,
      "file",
      `Cannot read SKILL.md: ${(err as Error).message}`,
    );
  }

  const { frontmatter, instructions } = parseSkillMd(content, skillMdPath);
  const resources = await scanSkillResources(dirPath);

  return {
    frontmatter,
    instructions,
    resources,
    dirPath,
    skillMdPath,
  };
}
