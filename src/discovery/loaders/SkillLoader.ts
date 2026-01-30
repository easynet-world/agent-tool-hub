import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ToolManifest, LoadedTool } from "../types.js";
import { DiscoveryError } from "../errors.js";
import { resolveEntryPoint } from "./resolveEntry.js";
import { loadSkillDefinition } from "./SkillMdParser.js";
import type { SkillDefinition } from "./SkillManifest.js";

const DEFAULT_EXTENSIONS = [".js", ".mjs"];

/**
 * List top-level .js/.mjs files in the skill directory (exclude lib/, node_modules/, hidden, test files).
 * Used to auto-discover multiple programs when tool.json has no "programs" map.
 */
async function listSkillProgramFiles(
  dirPath: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
): Promise<string[]> {
  let entries: Array<{ name: string; isFile: boolean }>;
  try {
    const dirEntries = await readdir(dirPath, { withFileTypes: true });
    entries = dirEntries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
    }));
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile)
    .map((e) => e.name)
    .filter((name) => {
      if (name.startsWith(".") || name.startsWith("_")) return false;
      if (name.includes(".test.") || name.includes(".spec.")) return false;
      return extensions.some((ext) => name.endsWith(ext));
    })
    .sort((a, b) => {
      // Prefer handler.js or index.js as first (default program)
      if (a === "handler.js" || a === "index.js") return -1;
      if (b === "handler.js" || b === "index.js") return 1;
      return a.localeCompare(b);
    });
}

/**
 * Check if a value is a LangChain-like tool (object with invoke function).
 * Includes instances of StructuredTool and plain { name?, description?, schema?, invoke }.
 */
function isLangChainLikeTool(val: unknown): val is { name?: string; description?: string; schema?: object; invoke: (args: unknown) => Promise<unknown> } {
  return (
    val != null &&
    typeof val === "object" &&
    "invoke" in val &&
    typeof (val as { invoke: unknown }).invoke === "function"
  );
}

/**
 * Check if a value is a class (constructor) that can be instantiated.
 * Used to detect "class Foo extends StructuredTool" exports.
 */
function isConstructable(val: unknown): val is new (...args: unknown[]) => { invoke?: (args: unknown) => Promise<unknown> } {
  return typeof val === "function" && typeof (val as { prototype?: unknown }).prototype === "object";
}

/**
 * Load a single skill program (one entry point) and return a LoadedTool.
 * Supports:
 * - Class extending StructuredTool: loader instantiates with new ToolClass(), uses instance.
 * - LangChain-like object (or instance): { name?, description?, schema?, invoke(args) }.
 * - Function: (args, ctx) => Promise<{ result, evidence? }> — name/description from SKILL.md.
 */
async function loadOneSkillProgram(
  dirPath: string,
  manifest: ToolManifest,
  entryFile: string,
  skillDef: SkillDefinition,
  programKey: string | undefined,
  extensions: string[] | undefined,
): Promise<LoadedTool> {
  let impl: unknown;
  try {
    const fullPath = await resolveEntryPoint(dirPath, entryFile, extensions ?? [".js", ".mjs"]);
    const mod = (await import(pathToFileURL(fullPath).href)) as Record<string, unknown>;
    const fn = mod.default ?? mod.handler ?? mod.Tool;
    if (isLangChainLikeTool(fn)) {
      impl = fn;
    } else if (isConstructable(fn)) {
      const instance = new (fn as new () => { invoke: (args: unknown) => Promise<unknown> })();
      if (isLangChainLikeTool(instance)) impl = instance;
    } else if (typeof fn === "function") {
      impl = fn;
    }
  } catch {
    // Handler is optional — skills can be instruction-only
  }
  return {
    manifest,
    dirPath,
    impl,
    skillDefinition: skillDef,
    programKey,
  };
}

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
  const loaded = await loadSkillTools(dirPath, manifest, extensions);
  if (loaded.length === 0) {
    throw new DiscoveryError(dirPath, "load", "No skill programs loaded", new Error("empty"));
  }
  return loaded[0]!;
}

/**
 * Load one or more skill programs from a directory.
 * When manifest.programs is set (e.g. { "default": "handler.js", "report": "report.js" }),
 * returns one LoadedTool per program; otherwise returns a single LoadedTool (entryPoint or "handler").
 */
export async function loadSkillTools(
  dirPath: string,
  manifest: ToolManifest,
  extensions?: string[],
): Promise<LoadedTool[]> {
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

  const programs = manifest.programs;
  if (programs && typeof programs === "object" && Object.keys(programs).length > 0) {
    const result: LoadedTool[] = [];
    for (const [programKey, entryFile] of Object.entries(programs)) {
      const loaded = await loadOneSkillProgram(
        dirPath,
        manifest,
        entryFile,
        skillDef,
        programKey,
        extensions,
      );
      result.push(loaded);
    }
    return result;
  }

  // Auto-discover: list top-level .js/.mjs; if multiple, treat each as a program
  const exts = extensions ?? DEFAULT_EXTENSIONS;
  const files = await listSkillProgramFiles(dirPath, exts);
  if (files.length >= 2) {
    const result: LoadedTool[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const programKey = i === 0 ? "default" : file.replace(/\.[^.]+$/, "");
      const loaded = await loadOneSkillProgram(
        dirPath,
        manifest,
        file,
        skillDef,
        programKey,
        extensions,
      );
      result.push(loaded);
    }
    return result;
  }

  // Single program: entryPoint or "handler" (or only one file found)
  const entryFile = manifest.entryPoint ?? files[0] ?? "handler";
  const loaded = await loadOneSkillProgram(
    dirPath,
    manifest,
    entryFile,
    skillDef,
    undefined,
    extensions,
  );
  return [loaded];
}
