import type { Capability, ToolKind, ToolSpec } from "../types/ToolSpec.js";

/**
 * Search query for tools.
 */
export interface ToolSearchQuery {
  /** Text search in name/description/tags */
  text?: string;
  /** Filter by tool kind */
  kind?: ToolKind;
  /** Filter by required capabilities */
  capabilities?: Capability[];
  /** Filter by tags */
  tags?: string[];
}

/**
 * Tool Registry: manages tool registration, lookup, and search.
 * Supports both static registration and dynamic discovery via adapters.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();
  private readonly tagIndex = new Map<string, Set<string>>(); // tag → tool names
  private readonly kindIndex = new Map<ToolKind, Set<string>>(); // kind → tool names

  /**
   * Register a single tool spec.
   * Overwrites if same name already exists.
   */
  register(spec: ToolSpec): void {
    this.validateSpec(spec);
    this.tools.set(spec.name, spec);
    this.indexTool(spec);
  }

  /**
   * Register multiple tool specs at once.
   */
  bulkRegister(specs: ToolSpec[]): void {
    for (const spec of specs) {
      this.register(spec);
    }
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): boolean {
    const spec = this.tools.get(name);
    if (!spec) return false;
    this.tools.delete(name);
    this.deindexTool(spec);
    return true;
  }

  /**
   * Get a tool spec by name.
   */
  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Search tools by query.
   */
  search(query: ToolSearchQuery): ToolSpec[] {
    let candidates: ToolSpec[];

    // Start with kind filter if specified (uses index)
    if (query.kind) {
      const names = this.kindIndex.get(query.kind);
      if (!names || names.size === 0) return [];
      candidates = [...names]
        .map((n) => this.tools.get(n))
        .filter((s): s is ToolSpec => s !== undefined);
    } else {
      candidates = [...this.tools.values()];
    }

    // Filter by tags (uses index for initial candidates if no kind filter)
    if (query.tags && query.tags.length > 0) {
      candidates = candidates.filter((spec) =>
        query.tags!.some((tag) => spec.tags?.includes(tag)),
      );
    }

    // Filter by capabilities
    if (query.capabilities && query.capabilities.length > 0) {
      candidates = candidates.filter((spec) =>
        query.capabilities!.every((cap) => spec.capabilities.includes(cap)),
      );
    }

    // Filter by text (name, description, tags)
    if (query.text) {
      const lower = query.text.toLowerCase();
      candidates = candidates.filter(
        (spec) =>
          spec.name.toLowerCase().includes(lower) ||
          spec.description?.toLowerCase().includes(lower) ||
          spec.tags?.some((t) => t.toLowerCase().includes(lower)),
      );
    }

    return candidates;
  }

  /**
   * List all registered tool names.
   */
  list(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Get count of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Export a snapshot of all registered tools (for debugging/routing).
   */
  snapshot(): ToolSpec[] {
    return [...this.tools.values()];
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
    this.tagIndex.clear();
    this.kindIndex.clear();
  }

  private validateSpec(spec: ToolSpec): void {
    if (!spec.name) throw new Error("ToolSpec.name is required");
    if (!spec.version) throw new Error("ToolSpec.version is required");
    if (!spec.kind) throw new Error("ToolSpec.kind is required");
    if (!spec.inputSchema) throw new Error("ToolSpec.inputSchema is required");
    if (!spec.outputSchema) throw new Error("ToolSpec.outputSchema is required");
    if (!spec.capabilities) throw new Error("ToolSpec.capabilities is required");
  }

  private indexTool(spec: ToolSpec): void {
    // Kind index
    let kindSet = this.kindIndex.get(spec.kind);
    if (!kindSet) {
      kindSet = new Set();
      this.kindIndex.set(spec.kind, kindSet);
    }
    kindSet.add(spec.name);

    // Tag index
    if (spec.tags) {
      for (const tag of spec.tags) {
        let tagSet = this.tagIndex.get(tag);
        if (!tagSet) {
          tagSet = new Set();
          this.tagIndex.set(tag, tagSet);
        }
        tagSet.add(spec.name);
      }
    }
  }

  private deindexTool(spec: ToolSpec): void {
    this.kindIndex.get(spec.kind)?.delete(spec.name);
    if (spec.tags) {
      for (const tag of spec.tags) {
        this.tagIndex.get(tag)?.delete(spec.name);
      }
    }
  }
}
