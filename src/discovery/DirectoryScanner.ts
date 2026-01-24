import { readdir, readFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ToolSpec } from "../types/ToolSpec.js";
import type {
  ToolManifest,
  DirectoryScannerOptions,
  LoadedTool,
} from "./types.js";
import { DiscoveryError } from "./errors.js";
import { loadMCPTool } from "./loaders/MCPLoader.js";
import { loadLangChainTool } from "./loaders/LangChainLoader.js";
import { loadSkillTool } from "./loaders/SkillLoader.js";
import { loadN8nTool } from "./loaders/N8nLoader.js";
import { resolveEntryPoint } from "./loaders/resolveEntry.js";

const DEFAULT_EXTENSIONS = [".js", ".mjs"];

/**
 * Scans filesystem directories for tool definitions.
 * A tool can be declared via tool.json or inferred from conventional files
 * (SKILL.md, workflow.json, mcp.json, or an index entry point).
 */
export class DirectoryScanner {
  private readonly roots: Array<{ path: string; namespace: string }>;
  private readonly extensions: string[];
  private readonly onError?: (toolDir: string, error: Error) => void;

  constructor(options: DirectoryScannerOptions) {
    const defaultNamespace = options.namespace ?? "dir";
    this.roots = options.roots.map((root) => {
      if (typeof root === "string") {
        return { path: root, namespace: defaultNamespace };
      }
      return {
        path: root.path,
        namespace: root.namespace ?? defaultNamespace,
      };
    });
    this.extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    this.onError = options.onError;
  }

  /**
   * Scan all root directories and return discovered ToolSpecs.
   * Errors in individual tool directories are reported via onError
   * and do not prevent other tools from loading.
   */
  async scan(): Promise<ToolSpec[]> {
    const specs: ToolSpec[] = [];

    for (const root of this.roots) {
      const rootSpecs = await this.scanRoot(root.path, root.namespace);
      specs.push(...rootSpecs);
    }

    return specs;
  }

  private async scanRoot(rootPath: string, namespace: string): Promise<ToolSpec[]> {
    return this.scanRecursive(rootPath, namespace);
  }

  /**
   * Recursively scan directories for tool definitions.
   * Directories can be detected via tool.json or inferred markers.
   */
  private async scanRecursive(dirPath: string, namespace: string): Promise<ToolSpec[]> {
    const specs: ToolSpec[] = [];

    let dirEntries: Array<{ name: string; isDirectory: boolean }>;
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      dirEntries = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch (error) {
      this.onError?.(dirPath, error as Error);
      return specs;
    }

    const dirName = basename(dirPath);
    try {
      const loadedSpecs = await this.loadToolDir(dirPath, dirName, namespace);
      if (loadedSpecs.length > 0) {
        specs.push(...loadedSpecs);
      }
    } catch (error) {
      this.onError?.(dirPath, error as Error);
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory) {
        continue;
      }
      const childPath = join(dirPath, entry.name);
      try {
        const childSpecs = await this.scanRecursive(childPath, namespace);
        specs.push(...childSpecs);
      } catch (error) {
        this.onError?.(childPath, error as Error);
      }
    }

    return specs;
  }

  private async loadToolDir(
    dirPath: string,
    dirName: string,
    namespace: string,
  ): Promise<ToolSpec[]> {
    // Read tool.json manifest if present, otherwise infer.
    const manifestPath = join(dirPath, "tool.json");
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(manifestPath, "utf-8");
    } catch {
      const inferred = await this.inferManifest(dirPath, dirName);
      if (!inferred) {
        return [];
      }
      if (inferred.kind === "langchain") {
        if (inferred.entryPoint) {
          const loaded = await loadLangChainTool(dirPath, inferred, this.extensions);
          return [this.toToolSpec(loaded, dirName, dirPath, namespace)];
        }
        return this.loadLangChainTools(dirPath, dirName, inferred, false, namespace);
      }
      const loaded = await this.loadByKind(dirPath, inferred);
      return [this.toToolSpec(loaded, dirName, dirPath, namespace)];
    }

    let manifest: ToolManifest;
    try {
      manifest = JSON.parse(manifestRaw) as ToolManifest;
    } catch (err) {
      throw new DiscoveryError(
        dirPath,
        "manifest",
        "Invalid JSON in tool.json",
        err as Error,
      );
    }

    // Validate required field
    if (!manifest.kind) {
      throw new DiscoveryError(
        dirPath,
        "manifest",
        `tool.json must have a "kind" field`,
      );
    }

    // Skip disabled tools
    if (manifest.enabled === false) {
      return [];
    }

    // Load based on kind
    if (manifest.kind === "langchain") {
      if (manifest.entryPoint) {
        const loaded = await loadLangChainTool(dirPath, manifest, this.extensions);
        return [this.toToolSpec(loaded, dirName, dirPath, namespace)];
      }
      return this.loadLangChainTools(dirPath, dirName, manifest, true, namespace);
    }
    const loaded = await this.loadByKind(dirPath, manifest);

    // Convert to ToolSpec
    return [this.toToolSpec(loaded, dirName, dirPath, namespace)];
  }

  private async inferManifest(
    dirPath: string,
    dirName: string,
  ): Promise<ToolManifest | null> {
    const hasSkill = await this.fileExists(join(dirPath, "SKILL.md"));
    const hasN8n = await this.fileExists(join(dirPath, "workflow.json"));
    const hasMcp = await this.fileExists(join(dirPath, "mcp.json"));
    const isLangchainDir = dirName === "langchain";
    const hasLangchain = isLangchainDir
      ? await this.hasLangchainFiles(dirPath)
      : await this.hasEntryPoint(dirPath, "index");

    const kinds = [
      hasSkill ? "skill" : null,
      hasN8n ? "n8n" : null,
      hasMcp ? "mcp" : null,
      hasLangchain ? "langchain" : null,
    ].filter(Boolean) as ToolManifest["kind"][];

    if (kinds.length === 0) return null;
    if (kinds.length > 1) {
      throw new DiscoveryError(
        dirPath,
        "manifest",
        `Ambiguous tool kind (found ${kinds.join(", ")}). Add tool.json to disambiguate.`,
      );
    }

    const kind = kinds[0]!;
    const manifest: ToolManifest = { kind };
    if (kind === "n8n") manifest.entryPoint = "workflow.json";
    if (kind === "mcp") manifest.entryPoint = "mcp.json";
    if (kind === "langchain" && !isLangchainDir) manifest.entryPoint = "index";
    if (kind === "skill") manifest.entryPoint = "handler";
    return manifest;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async hasEntryPoint(dirPath: string, baseName: string): Promise<boolean> {
    try {
      await resolveEntryPoint(dirPath, baseName, this.extensions);
      return true;
    } catch {
      return false;
    }
  }

  private async hasLangchainFiles(dirPath: string): Promise<boolean> {
    const entryFiles = await this.listLangchainEntryFiles(dirPath);
    return entryFiles.length > 0;
  }

  private async listLangchainEntryFiles(dirPath: string): Promise<string[]> {
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
      .filter((entry) => entry.isFile)
      .map((entry) => entry.name)
      .filter((name) => {
        if (name.startsWith(".") || name.startsWith("_")) return false;
        if (name.endsWith(".d.ts")) return false;
        if (name.includes(".test.") || name.includes(".spec.")) return false;
        return this.extensions.some((ext) => name.endsWith(ext));
      });
  }

  private async loadByKind(
    dirPath: string,
    manifest: ToolManifest,
  ): Promise<LoadedTool> {
    switch (manifest.kind) {
      case "mcp":
        return loadMCPTool(dirPath, manifest);
      case "langchain":
        return loadLangChainTool(dirPath, manifest, this.extensions);
      case "skill":
        return loadSkillTool(dirPath, manifest, this.extensions);
      case "n8n":
        return loadN8nTool(dirPath, manifest);
      default:
        throw new DiscoveryError(
          dirPath,
          "manifest",
          `Unknown tool kind: "${(manifest as { kind: string }).kind}"`,
        );
    }
  }

  private async loadLangChainTools(
    dirPath: string,
    dirName: string,
    manifest: ToolManifest,
    strict: boolean,
    namespace: string,
  ): Promise<ToolSpec[]> {
    const entryFiles = await this.listLangchainEntryFiles(dirPath);
    if (entryFiles.length === 0) {
      if (strict) {
        throw new DiscoveryError(
          dirPath,
          "load",
          "No LangChain entry files found",
        );
      }
      return [];
    }

    const specs: ToolSpec[] = [];
    const useDirNameForSingle = dirName !== "langchain";
    for (const entryFile of entryFiles) {
      const fileManifest: ToolManifest = {
        ...manifest,
        entryPoint: entryFile,
      };
      try {
        const loaded = await loadLangChainTool(dirPath, fileManifest, this.extensions);
        const fileBase = basename(entryFile).replace(/\.[^.]+$/, "");
        const nameHint =
          entryFiles.length === 1 && useDirNameForSingle ? dirName : fileBase;
        specs.push(this.toToolSpec(loaded, nameHint, dirPath, namespace));
      } catch (error) {
        const err = error as Error;
        if (err instanceof DiscoveryError && err.phase === "validate") {
          if (strict) {
            throw err;
          }
          continue;
        }
        this.onError?.(join(dirPath, entryFile), err);
        if (strict) {
          throw err;
        }
      }
    }

    return specs;
  }

  private toToolSpec(
    loaded: LoadedTool,
    dirName: string,
    dirPath: string,
    namespace: string,
  ): ToolSpec {
    const { manifest } = loaded;
    const kindDirNames = new Set(["mcp", "langchain", "skill", "n8n"]);
    const parentName = basename(join(dirPath, ".."));
    const isKindDir = kindDirNames.has(dirName);
    const defaultDirName = isKindDir ? parentName : dirName;
    const inferredName = isKindDir
      ? `${namespace}/${defaultDirName}-${dirName}`
      : `${namespace}/${defaultDirName}`;
    const name = manifest.name ?? inferredName;

    const spec: ToolSpec = {
      name,
      version: manifest.version ?? "1.0.0",
      kind: manifest.kind,
      description: manifest.description ?? `${manifest.kind} tool: ${dirName}`,
      tags: manifest.tags,
      inputSchema: manifest.inputSchema ?? {
        type: "object",
        additionalProperties: true,
      },
      outputSchema: manifest.outputSchema ?? {
        type: "object",
        additionalProperties: true,
      },
      capabilities: manifest.capabilities ?? [],
      costHints: manifest.costHints,
    };

    // Kind-specific fields
    switch (manifest.kind) {
      case "mcp":
        if (loaded.mcpConfig?.url) {
          spec.endpoint = loaded.mcpConfig.url;
        }
        // Store full MCP config for adapter to consume
        spec.impl = loaded.mcpConfig;
        break;
      case "langchain":
        spec.impl = loaded.impl;
        if (!manifest.name) {
          const toolName = (loaded.impl as { name?: string } | undefined)?.name;
          if (toolName) {
            spec.name = `${namespace}/${toolName}`;
          }
        }
        if (!manifest.description) {
          const toolDescription = (loaded.impl as { description?: string } | undefined)
            ?.description;
          if (toolDescription) {
            spec.description = toolDescription;
          }
        }
        // Extract schema from tool instance if not in manifest
        if (!manifest.inputSchema && loaded.impl) {
          const tool = loaded.impl as { schema?: object };
          if (tool.schema) {
            spec.inputSchema = tool.schema;
          }
        }
        break;
      case "skill": {
        // For skills, store the full SkillDefinition + optional handler
        // The SkillAdapter resolves these via spec.impl
        if (loaded.skillDefinition) {
          // Use SKILL.md frontmatter for name and description (overrides tool.json)
          spec.name = manifest.name ?? loaded.skillDefinition.frontmatter.name;
          spec.description = loaded.skillDefinition.frontmatter.description;
          spec.impl = {
            ...loaded.skillDefinition,
            handler: loaded.impl,
          };
        } else {
          spec.impl = loaded.impl;
        }
        break;
      }
      case "n8n": {
        const workflow = loaded.workflowDef as { id?: string } | undefined;
        if (workflow?.id) {
          spec.resourceId = String(workflow.id);
        }
        spec.impl = loaded.workflowDef;
        break;
      }
    }

    return spec;
  }
}
