import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
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

  // Parse simple YAML (name: value pairs)
  const frontmatter = parseSimpleYaml(yamlBlock, filePath);
  validateFrontmatter(frontmatter, filePath);

  return { frontmatter, instructions: body };
}

/**
 * Minimal YAML parser for frontmatter fields.
 * Handles: simple key: value pairs, quoted strings, multiline with |/>.
 * Does NOT handle: nested objects, arrays, anchors, etc.
 */
function parseSimpleYaml(
  yaml: string,
  _filePath: string,
): Partial<SkillFrontmatter> {
  const result: Record<string, string> = {};
  const lines = yaml.split("\n");

  let currentKey: string | null = null;
  let multilineValue: string[] = [];
  let multilineMode: "literal" | "folded" | null = null;

  for (const line of lines) {
    // Check if this is a new key: value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)/);

    if (kvMatch && multilineMode === null) {
      // Flush previous multiline if any
      if (currentKey && multilineValue.length > 0) {
        result[currentKey] = multilineValue.join(
          multilineMode === "folded" ? " " : "\n",
        );
        multilineValue = [];
      }

      const key = kvMatch[1]!;
      const value = (kvMatch[2] ?? "").trim();

      if (value === "|") {
        currentKey = key;
        multilineMode = "literal";
      } else if (value === ">") {
        currentKey = key;
        multilineMode = "folded";
      } else {
        // Simple value — strip quotes if present
        result[key] = stripQuotes(value);
        currentKey = null;
      }
    } else if (multilineMode !== null && currentKey) {
      // Continuation of multiline value
      if (line.match(/^\s/) || line === "") {
        multilineValue.push(line.replace(/^\s{2}/, ""));
      } else {
        // End of multiline block, process this line as new key
        result[currentKey] = multilineValue.join(
          multilineMode === "literal" ? "\n" : " ",
        ).trim();
        multilineValue = [];
        multilineMode = null;

        const newKv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)/);
        if (newKv) {
          const newKey = newKv[1]!;
          const val = (newKv[2] ?? "").trim();
          if (val === "|") {
            currentKey = newKey;
            multilineMode = "literal";
          } else if (val === ">") {
            currentKey = newKey;
            multilineMode = "folded";
          } else {
            result[newKey] = stripQuotes(val);
            currentKey = null;
          }
        }
      }
    }
  }

  // Flush final multiline
  if (currentKey && multilineValue.length > 0) {
    result[currentKey] = multilineValue.join(
      multilineMode === "literal" ? "\n" : " ",
    ).trim();
  }

  return result as Partial<SkillFrontmatter>;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
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
