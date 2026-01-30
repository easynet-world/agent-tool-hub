import { readFile } from "node:fs/promises";
import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";
import type { Evidence } from "../types/ToolResult.js";
import type { SkillDefinition, SkillResource } from "../discovery/loaders/SkillManifest.js";
import { createLogger, sanitizeForLog, summarizeForLog } from "../observability/Logger.js";
import type { DebugOptions, Logger } from "../observability/Logger.js";

/**
 * Skill handler function signature.
 * A skill handler provides programmatic execution when bundled scripts need
 * to run as part of skill invocation.
 */
export type SkillHandler = (
  args: unknown,
  ctx: SkillContext,
) => Promise<SkillOutput>;

/**
 * Context passed to skill handlers.
 * Provides access to the skill's progressive disclosure levels and sub-tool invocation.
 */
export interface SkillContext {
  requestId: string;
  taskId: string;
  traceId?: string;
  userId?: string;

  /** The skill definition with all three disclosure levels */
  skill: SkillInvocationContext;

  /** Invoke a sub-tool (if needed by the skill) */
  invokeTool?: (toolName: string, args: unknown) => Promise<unknown>;
}

/**
 * Skill invocation context providing progressive disclosure access.
 * Mirrors the three-level loading model from the Anthropic spec.
 */
export interface SkillInvocationContext {
  /** Level 1: Metadata (name + description) — always available */
  name: string;
  description: string;

  /** Level 2: Instructions from SKILL.md body — loaded when triggered */
  instructions: string;

  /** Level 3: Resource access — loaded as needed */
  resources: SkillResource[];

  /** Read a resource file by relative path */
  readResource: (relativePath: string) => Promise<string>;

  /** Get resources filtered by type */
  getResourcesByType: (type: "instructions" | "code" | "data") => SkillResource[];

  /** Absolute path to the skill directory (for script execution) */
  dirPath: string;
}

/**
 * Structured output from a skill handler.
 */
export interface SkillOutput {
  result: unknown;
  evidence?: Evidence[];
  metadata?: Record<string, unknown>;
}

/**
 * Result returned when a skill is invoked in instruction-only mode
 * (no handler function, just SKILL.md content for an agent to consume).
 */
export interface SkillInstructionResult {
  /** The skill name */
  name: string;
  /** The skill description */
  description: string;
  /** The full instructions from SKILL.md body */
  instructions: string;
  /** List of available resources with paths and types */
  resources: Array<{
    path: string;
    type: "instructions" | "code" | "data";
  }>;
  /** The skill directory path for resource access */
  dirPath: string;
}

/**
 * Options for creating a SkillAdapter.
 */
export interface SkillAdapterOptions {
  /** Map of skill names to their SkillDefinitions (from SKILL.md) */
  definitions?: Map<string, SkillDefinition>;
  /** Map of skill names to their handler functions (optional per skill) */
  handlers?: Map<string, SkillHandler>;
  /** Optional sub-tool invoker for skills that need to call other tools */
  toolInvoker?: (toolName: string, args: unknown, ctx: ExecContext) => Promise<unknown>;
  /** Debug/logging configuration */
  debug?: DebugOptions;
}

/**
 * Adapter for SKILL type tools following Anthropic's Agent Skills specification.
 *
 * Implements the three-level progressive disclosure model:
 * - Level 1 (metadata): name + description, used for discovery (~100 tokens)
 * - Level 2 (instructions): SKILL.md body, loaded when skill is triggered (<5k tokens)
 * - Level 3 (resources): bundled files, loaded as needed (unlimited)
 *
 * Skills can operate in two modes:
 * 1. **Instruction-only**: Returns SKILL.md content for an agent/model to consume
 * 2. **Handler mode**: Executes a bundled handler function with full context
 *
 * This implementation is model-agnostic — any model can consume the skill instructions.
 *
 * @see https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 */
export class SkillAdapter implements ToolAdapter {
  readonly kind = "skill" as const;
  private readonly definitions: Map<string, SkillDefinition>;
  private readonly handlers: Map<string, SkillHandler>;
  private readonly toolInvoker?: (
    toolName: string,
    args: unknown,
    ctx: ExecContext,
  ) => Promise<unknown>;
  private readonly logger: Logger;

  constructor(options: SkillAdapterOptions = {}) {
    this.definitions = options.definitions ?? new Map();
    this.handlers = options.handlers ?? new Map();
    this.toolInvoker = options.toolInvoker;
    this.logger = createLogger({ ...options.debug, prefix: "SkillAdapter" });
  }

  /**
   * Register a skill definition (from SKILL.md parsing).
   */
  registerSkill(name: string, definition: SkillDefinition, handler?: SkillHandler): void {
    this.definitions.set(name, definition);
    if (handler) {
      this.handlers.set(name, handler);
    }
  }

  /**
   * Unregister a skill.
   */
  unregisterSkill(name: string): boolean {
    this.handlers.delete(name);
    return this.definitions.delete(name);
  }

  /**
   * List registered skills with Level 1 metadata.
   * Returns ToolSpecs with name and description from YAML frontmatter.
   */
  async listTools(): Promise<ToolSpec[]> {
    const specs: ToolSpec[] = [];
    for (const [name, def] of this.definitions.entries()) {
      specs.push({
        name,
        version: "1.0.0",
        kind: "skill",
        description: def.frontmatter.description,
        inputSchema: { type: "object", additionalProperties: true },
        outputSchema: { type: "object", additionalProperties: true },
        capabilities: [],
      });
    }
    return specs;
  }

  /**
   * Get Level 1 metadata for all registered skills.
   * This is what gets loaded at startup (~100 tokens per skill).
   */
  getMetadata(): Array<{ name: string; description: string }> {
    const metadata: Array<{ name: string; description: string }> = [];
    for (const def of this.definitions.values()) {
      metadata.push({
        name: def.frontmatter.name,
        description: def.frontmatter.description,
      });
    }
    return metadata;
  }

  /**
   * Get Level 2 instructions for a specific skill.
   * This is loaded when the skill is triggered.
   */
  getInstructions(name: string): string | undefined {
    return this.definitions.get(name)?.instructions;
  }

  /**
   * Get Level 3 resources for a specific skill.
   */
  getResources(name: string): SkillResource[] {
    return this.definitions.get(name)?.resources ?? [];
  }

  /**
   * Read a specific resource file from a skill.
   */
  async readResource(skillName: string, relativePath: string): Promise<string> {
    const def = this.definitions.get(skillName);
    if (!def) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    const resource = def.resources.find((r) => r.relativePath === relativePath);
    if (!resource) {
      throw new Error(
        `Resource not found: ${relativePath} in skill ${skillName}. ` +
        `Available: ${def.resources.map((r) => r.relativePath).join(", ")}`,
      );
    }

    return readFile(resource.absolutePath, "utf-8");
  }

  /**
   * Invoke a skill.
   *
   * If the skill has a handler function, executes it with full context.
   * Otherwise, returns the skill's instruction content (Level 2 + Level 3 manifest)
   * for an agent/model to consume and act upon.
   */
  async invoke(
    spec: ToolSpec,
    args: unknown,
    ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    if (this.logger.isEnabled("debug")) {
      this.logger.debug("invoke.start", {
        tool: spec.name,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        args: this.logger.options.includeArgs ? sanitizeForLog(args) : undefined,
      });
    }
    const def = this.resolveDefinition(spec);
    if (!def) {
      throw new Error(
        `Skill definition not found: ${spec.name}. ` +
        `Register with registerSkill() or ensure SKILL.md is loaded.`,
      );
    }

    const handler = this.resolveHandler(spec);

    try {
      if (handler) {
        // Handler mode: execute the handler with full context
        const result = await this.invokeWithHandler(spec, def, handler, args, ctx);
        this.logger.debug("invoke.ok", {
          tool: spec.name,
          mode: "handler",
          result: this.logger.options.includeResults
            ? summarizeForLog(result.result)
            : undefined,
        });
        return result;
      }

      // Instruction-only mode: return skill content for agent consumption
      const result = this.invokeInstructionOnly(def);
      this.logger.debug("invoke.ok", {
        tool: spec.name,
        mode: "instruction",
        result: this.logger.options.includeResults
          ? summarizeForLog(result.result)
          : undefined,
      });
      return result;
    } catch (error) {
      this.logger.warn("invoke.error", {
        tool: spec.name,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async invokeWithHandler(
    spec: ToolSpec,
    def: SkillDefinition,
    handler: SkillHandler,
    args: unknown,
    ctx: ExecContext,
  ): Promise<{ result: unknown; raw?: unknown }> {
    const allowedTools = parseAllowedTools(def.frontmatter.allowedTools);
    const skillCtx: SkillContext = {
      requestId: ctx.requestId,
      taskId: ctx.taskId,
      traceId: ctx.traceId,
      userId: ctx.userId,
      skill: this.buildInvocationContext(def),
      invokeTool: this.toolInvoker
        ? (toolName, toolArgs) => this.invokeToolWithAllowlist(toolName, toolArgs, ctx, spec.name, allowedTools)
        : undefined,
    };

    const output = await handler(args, skillCtx);

    if (!output || typeof output !== "object" || !("result" in output)) {
      throw new Error(
        `Skill ${spec.name} handler must return { result, evidence? } but returned: ${typeof output}`,
      );
    }

    return {
      result: output.result,
      raw: {
        evidence: output.evidence,
        metadata: output.metadata,
      },
    };
  }

  private invokeInstructionOnly(
    def: SkillDefinition,
  ): { result: unknown; raw?: unknown } {
    const instructionResult: SkillInstructionResult = {
      name: def.frontmatter.name,
      description: def.frontmatter.description,
      instructions: def.instructions,
      resources: def.resources.map((r) => ({
        path: r.relativePath,
        type: r.type,
      })),
      dirPath: def.dirPath,
    };

    return {
      result: instructionResult,
      raw: { mode: "instruction-only", resourceCount: def.resources.length },
    };
  }

  private buildInvocationContext(def: SkillDefinition): SkillInvocationContext {
    return {
      name: def.frontmatter.name,
      description: def.frontmatter.description,
      instructions: def.instructions,
      resources: def.resources,
      dirPath: def.dirPath,
      readResource: async (relativePath: string) => {
        const resource = def.resources.find((r) => r.relativePath === relativePath);
        if (!resource) {
          throw new Error(
            `Resource not found: ${relativePath}. ` +
            `Available: ${def.resources.map((r) => r.relativePath).join(", ")}`,
          );
        }
        return readFile(resource.absolutePath, "utf-8");
      },
      getResourcesByType: (type) => {
        return def.resources.filter((r) => r.type === type);
      },
    };
  }

  private resolveDefinition(spec: ToolSpec): SkillDefinition | undefined {
    // Check if spec.impl is a SkillDefinition (set by DirectoryScanner)
    if (spec.impl && typeof spec.impl === "object" && "frontmatter" in (spec.impl as object)) {
      return spec.impl as unknown as SkillDefinition;
    }
    return this.definitions.get(spec.name);
  }

  private resolveHandler(spec: ToolSpec): SkillHandler | undefined {
    // Check if spec carries a handler reference
    if (spec.impl && typeof spec.impl === "object") {
      const implObj = spec.impl as { handler?: unknown };
      const h = implObj.handler;
      if (typeof h === "function") {
        return h as SkillHandler;
      }
      // LangChain-like tool: { name?, description?, schema?, invoke(args) }
      if (h && typeof h === "object" && "invoke" in h && typeof (h as { invoke: unknown }).invoke === "function") {
        const tool = h as { invoke: (args: unknown) => Promise<unknown> };
        return (args: unknown, _ctx: SkillContext): Promise<SkillOutput> =>
          tool.invoke(args).then((r) => {
            if (r != null && typeof r === "object" && "result" in r) {
              return r as SkillOutput;
            }
            return { result: r };
          });
      }
    }
    return this.handlers.get(spec.name);
  }

  private async invokeToolWithAllowlist(
    toolName: string,
    toolArgs: unknown,
    ctx: ExecContext,
    skillName: string,
    allowedTools: Set<string> | null,
  ): Promise<unknown> {
    // No allowed-tools frontmatter → allow all tools
    if (allowedTools !== null && !allowedTools.has(toolName)) {
      const list = [...allowedTools].sort().join(", ");
      throw new Error(
        `Skill "${skillName}" is not allowed to invoke tool "${toolName}". ` +
          `Allowed tools: ${list || "(none)"}. Set allowed-tools in SKILL.md frontmatter to restrict sub-tool access.`,
      );
    }
    return this.toolInvoker!(toolName, toolArgs, ctx);
  }
}

/**
 * Parse allowed-tools frontmatter (space-delimited) into a set of tool names.
 * Returns null if not set or empty → no restriction, allow all tools.
 */
function parseAllowedTools(allowedTools: string | undefined): Set<string> | null {
  if (allowedTools == null || typeof allowedTools !== "string") {
    return null;
  }
  const trimmed = allowedTools.trim();
  if (trimmed === "") {
    return null;
  }
  const names = trimmed.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  return names.length === 0 ? null : new Set(names);
}
